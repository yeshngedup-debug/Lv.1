import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { join } from 'path';
import { pathToFileURL } from 'url';
import * as Sentry from '@sentry/node';

import { config, hostDashboardPath, participantPagePath } from './config.ts';
import { logger } from './logger.ts';
import { redisState, initRedis } from './redis.ts';
import { applySecurityMiddleware } from './middleware.ts';
import { registerHttpRoutes } from './routes.ts';
import { registerSocketHandlers } from './socketHandlers.ts';
import {
  sessions,
  getSession,
  setSession,
  deleteSession,
  hasSession,
  listSessionIds,
  destroySession,
  Session,
  SessionStore,
  getPlaybackSnapshot,
} from './sessions.ts';
import { uploads, sessionFiles, destroyUploadedFiles, cleanOrphanedUploads } from './uploads.ts';
import { pruneJoinFailures } from './config.ts';

// Initialize Sentry
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });
}

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin:
      config.corsOrigin === '*'
        ? true
        : config.corsOrigin
          ? config.corsOrigin.split(',').map((o) => o.trim())
          : false,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 10000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e7,
});

// Initialize Redis adapter for horizontal scaling
initRedis().then(() => {
  if (redisState.ready && redisState.client && redisState.subClient) {
    io.adapter(createAdapter(redisState.client, redisState.subClient));
    logger.info('Socket.IO Redis adapter enabled for horizontal scaling');
  }
});

applySecurityMiddleware(app);

// Serve static files in production.
// The /join static mount serves hashed assets AND service-worker files
// (workbox-*.js hash changes per build, so no hardcoded routes).
if (config.nodeEnv === 'production') {
  // Participant page at /join and /p (PWA alias)
  app.use('/join', express.static(participantPagePath));
  app.use('/p', express.static(participantPagePath));

  // Host dashboard at root
  app.use(express.static(hostDashboardPath));
  // SPA fallback for deep links lives in the wantsHtml middleware below
}

registerHttpRoutes(app);
registerSocketHandlers(io);

// SPA fallback — MUST come after static + API routes.
// Deep links like /join/ABCD1234 have no file on disk; without this,
// every QR code scan returns 404 JSON in production.
const wantsHtml = (req: any) => (req.headers.accept || '').includes('text/html');

if (config.nodeEnv === 'production') {
  app.use((req: any, res: any, next: any) => {
    if (!wantsHtml(req)) return next();
    if (req.path === '/join' || req.path.startsWith('/join/') || req.path.startsWith('/p')) {
      return res.sendFile(join(participantPagePath, 'index.html'));
    }
    if (req.method === 'GET' && !req.path.startsWith('/api') && req.path !== '/socket.io') {
      return res.sendFile(join(hostDashboardPath, 'index.html'));
    }
    next();
  });
}

// Sentry error capture (v10 API) — after routes, before the terminal error handlers
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup intervals
const sessionExpiryInterval = setInterval(async () => {
  for (const sessionId of await listSessionIds()) {
    const session = await getSession(sessionId);
    if (session && session.isExpired()) {
      await destroySession(io, sessionId);
      logger.info('Session expired and cleaned up', { sessionId });
    }
  }
}, 60000);

// Cleanup stale devices (interval/threshold env-configurable for fast test sweeps)
const staleDeviceInterval = setInterval(async () => {
  const now = Date.now();

  for (const sessionId of await listSessionIds()) {
    const session = await getSession(sessionId);
    if (!session) continue;
    for (const [deviceId, device] of session.devices.entries()) {
      if (now - (device.lastPing || device.joinedAt) > config.staleThresholdMs) {
        logger.info('Removing stale device', { deviceId, sessionId });
        session.removeDevice(deviceId);
        io.to(`session:${sessionId}`).emit('device-left', { deviceId });
      }
    }
    await setSession(sessionId, session);
  }

  pruneJoinFailures(now);
}, config.staleCheckIntervalMs);

// Orphaned upload cleanup: boot scan + periodic sweep
cleanOrphanedUploads();
const orphanCleanupInterval = setInterval(cleanOrphanedUploads, 15 * 60 * 1000);

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`${signal} received, starting graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Close all socket connections
    io.close(() => {
      logger.info('Socket.IO server closed');
    });

    // Close Redis connections
    if (redisState.client) {
      await redisState.client.quit();
      logger.info('Redis client closed');
    }
    if (redisState.subClient) {
      await redisState.subClient.quit();
      logger.info('Redis sub client closed');
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejection/error handlers
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error('Unhandled Rejection', { reason: message });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

// Test hook: stop timers + servers without killing the process
function _stopForTests() {
  clearInterval(sessionExpiryInterval);
  clearInterval(staleDeviceInterval);
  clearInterval(orphanCleanupInterval);
  io.close();
  server.close();
  if (redisState.client) redisState.client.disconnect();
  if (redisState.subClient) redisState.subClient.disconnect();
}

// Start server only when executed directly (importing runs tests/tools instead)
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  server.listen(config.port, () => {
    logger.info('Iris SYNCD server started', {
      port: config.port,
      baseUrl: config.baseUrl,
      environment: config.nodeEnv,
      redis: redisState.ready ? 'connected' : 'not configured',
    });
  });
}

export {
  app,
  server,
  io,
  sessions,
  getSession,
  setSession,
  deleteSession,
  hasSession,
  Session,
  SessionStore,
  destroySession,
  destroyUploadedFiles,
  getPlaybackSnapshot,
  uploads,
  sessionFiles,
  _stopForTests,
};
