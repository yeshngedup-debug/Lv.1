import express from 'express';
import type { Express, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import fs from 'fs';
import { SESSION_ID_RE, safeEqualToken } from './config.ts';
import { logger } from './logger.ts';
import { redisState } from './redis.ts';
import { metricsRoute } from './metrics.ts';
import {
  sessions,
  getSession,
  getPlaybackSnapshot,
} from './sessions.ts';
import { UPLOAD_DIR, MAX_UPLOAD_BYTES, uploads, sessionFiles } from './uploads.ts';
import { uploadLimiter } from './middleware.ts';

export function registerHttpRoutes(app: Express): void {
  // Prometheus metrics (token-protected)
  app.get('/api/metrics', metricsRoute);

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    const token = process.env.METRICS_TOKEN;
    const verbose = !!token && req.headers['authorization'] === `Bearer ${token}`;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      sessions: sessions.size,
      redis: redisState.ready ? 'connected' : 'disconnected',
      ...(verbose ? { memory: process.memoryUsage(), version: process.version } : {}),
    });
  });

  // Session info endpoint (host-authorized via query or header)
  app.get('/api/sessions/:sessionId', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session id' });
    }
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const hostToken = req.headers['x-host-token'] || req.query.hostToken;
    if (!hostToken || !safeEqualToken(hostToken, session.hostToken)) {
      return res.status(403).json({ error: 'Host authorization required' });
    }

    res.json({
      id: session.id,
      deviceCount: session.devices.size,
      devices: Array.from(session.devices.values()).map((d) => ({
        id: d.id,
        role: d.role,
        nickname: d.nickname,
        isLive: d.isLive,
      })),
      currentTrack: session.currentTrack,
      isPlaying: session.isPlaying,
      playback: getPlaybackSnapshot(session),
    });
  });

  // Track upload: raw body keeps this dependency-free (no multer needed).
  // Requires the host token issued at session create/rejoin — otherwise anyone
  // who guesses an 8-char code could fill the disk.
  app.post(
    '/api/sessions/:sessionId/upload',
    uploadLimiter,
    express.raw({
      type: (req) => String(req.headers['content-type'] || '').startsWith('audio/'),
      limit: MAX_UPLOAD_BYTES + 1,
    }),
    async (req: Request, res: Response) => {
      const { sessionId } = req.params;
      if (!SESSION_ID_RE.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
      }
      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (!safeEqualToken(req.headers['x-host-token'], session.hostToken)) {
        return res.status(403).json({ error: 'Host authorization required' });
      }
      const body = req.body as Buffer;
      if (!body || body.length === 0) {
        return res.status(400).json({ error: 'Empty upload body' });
      }
      if (body.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
      }

      const mimeType = String(req.headers['content-type']).split(';')[0].trim();
      // Sanitize the display name; the file on disk uses an opaque id instead
      const safeName =
        String(req.query.name || 'track')
          .slice(0, 120)
          .replace(/[^A-Za-z0-9 ._()-]/g, '_') || 'track';

      const fileId = uuidv4();
      const filePath = join(UPLOAD_DIR, `${sessionId}-${fileId}`);
      try {
        await fs.promises.writeFile(filePath, body);
      } catch (err: any) {
        logger.error('Failed to write uploaded track', { sessionId, error: err.message });
        return res.status(500).json({ error: 'Failed to store track' });
      }

      uploads.set(fileId, {
        id: fileId,
        sessionId,
        filePath,
        name: safeName,
        mimeType,
        size: body.length,
      });
      if (!sessionFiles.has(sessionId)) sessionFiles.set(sessionId, new Set());
      sessionFiles.get(sessionId)!.add(fileId);

      logger.info('Track uploaded', { sessionId, fileId, name: safeName, size: body.length });
      res.json({
        trackId: fileId,
        trackName: safeName,
        // Derive from the request so the URL is correct behind proxies AND in tests
        trackUrl: `${req.protocol}://${req.get('host')}/api/audio/${fileId}`,
        size: body.length,
      });
    },
  );

  // Track download: validate id shape before hitting the registry
  app.get('/api/audio/:fileId', (req: Request, res: Response) => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.fileId)
    ) {
      return res.status(400).json({ error: 'Invalid track id' });
    }
    const meta = uploads.get(req.params.fileId);
    if (!meta) {
      return res.status(404).json({ error: 'Track not found' });
    }
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(meta.filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Track not found' });
    });
  });

  // Root endpoint with service info
  app.get('/', (req: Request, res: Response) => {
    res.json({
      service: 'Iris SYNCD Server',
      version: '2.0.0',
      status: 'running',
      endpoints: {
        health: '/api/health',
        websocket: '/socket.io',
        hostDashboard: '/',
        participantPage: '/join',
        api: {
          health: 'GET /api/health',
          session: 'GET /api/sessions/:sessionId',
        },
      },
    });
  });
}
