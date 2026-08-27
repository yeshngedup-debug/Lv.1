import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';
import * as Sentry from '@sentry/node';
import client from 'prom-client';

dotenv.config();

// Initialize Sentry
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });
}

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'iris_' });

// Custom metrics
const activeSessions = new client.Gauge({ name: 'iris_active_sessions', help: 'Number of active sessions', registers: [register] });
const connectedPeers = new client.Gauge({ name: 'iris_connected_peers', help: 'Number of connected peers', registers: [register] });
const iceConnectionState = new client.Counter({ name: 'iris_ice_connection_state_total', help: 'ICE connection state changes', labelNames: ['state'], registers: [register] });
const negotiationDuration = new client.Histogram({ name: 'iris_negotiation_duration_seconds', help: 'WebRTC negotiation duration', buckets: [0.1, 0.5, 1, 2, 5, 10], registers: [register] });
const httpRequests = new client.Counter({ name: 'iris_http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'], registers: [register] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static file paths for production
const hostDashboardPath = join(__dirname, '../../host-dashboard/dist');
const participantPagePath = join(__dirname, '../../participant-page/dist');

// Uploaded track storage (audio broadcast)
const UPLOAD_DIR = join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // must stay in sync with host MAX_AUDIO_SIZE

// Configuration
const config = {
  port: parseInt(process.env.PORT) || 3001,
  baseUrl: process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`,
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 3600000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  redisUrl: process.env.REDIS_URL || null,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Session codes are 8-char uppercase alphanumeric slices of a UUID
const SESSION_ID_RE = /^[A-Z0-9]{8}$/;

// Winston logger
const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'iris-syncd-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Redis clients
let redisClient = null;
let redisSubClient = null;
let redisReady = false;

async function initRedis() {
  if (!config.redisUrl) {
    logger.warn('Redis not configured, running in single-instance mode');
    return;
  }

  try {
    redisClient = createClient({ url: config.redisUrl });
    redisSubClient = redisClient.duplicate();

    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    redisSubClient.on('error', (err) => logger.error('Redis Sub Client Error', { error: err.message }));

    await Promise.all([redisClient.connect(), redisSubClient.connect()]);
    redisReady = true;
    logger.info('Redis connected successfully');
  } catch (err) {
    logger.error('Failed to connect to Redis', { error: err.message });
    redisReady = false;
  }
}

const app = express();
const server = createServer(app);

const PORT = config.port;
const BASE_URL = config.baseUrl;
const SESSION_TIMEOUT = config.sessionTimeout;

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map(o => o.trim()),
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
  if (redisReady && redisClient && redisSubClient) {
    io.adapter(createAdapter(redisClient, redisSubClient));
    logger.info('Socket.IO Redis adapter enabled for horizontal scaling');
  }
});

// Security middleware
// Strict CSP only in production: dev needs Vite HMR (eval + ws), prod does not
app.use(helmet({
  contentSecurityPolicy: config.nodeEnv === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      workerSrc: ["'self'", 'blob:'],
      frameAncestors: ["'none'"],
    },
  } : false,
  crossOriginEmbedderPolicy: config.nodeEnv === 'production' ? 'require-corp' : false,
  crossOriginOpenerPolicy: config.nodeEnv === 'production' ? 'same-origin' : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS configuration - locked down in production
const corsOrigins = config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map(o => o.trim());
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting with Redis store (per-IP)
let rateLimiter;
if (redisReady && redisClient) {
  const { RateLimiterRedis } = await import('rate-limiter-flexible');
  const rateLimiterRedis = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl:',
    points: config.rateLimitMaxRequests,
    duration: config.rateLimitWindowMs / 1000,
  });
  rateLimiter = (req, res, next) => {
    rateLimiterRedis.consume(req.ip)
      .then(() => next())
      .catch(() => res.status(429).json({ error: 'Too many requests' }));
  };
} else {
  // Fallback to in-memory
  rateLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
  });
}
app.use(rateLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust the reverse proxy (Render) so req.protocol/host reflect public URLs
app.set('trust proxy', 1);

// Rate limiting: general API + stricter budget for uploads
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX) || 30,
  message: { error: 'Too many uploads, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  next();
});

// Sentry request handler (must be before other middleware)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
}

// HTTP request metrics
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    httpRequests.inc({ method: req.method, path: req.route?.path || req.path, status: res.statusCode });
  });
  next();
});

// Prometheus metrics endpoint - protected by token if configured
app.get('/api/metrics', async (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (token && req.headers['authorization'] !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    logger.error('Metrics error', { error: ex.message });
    res.status(500).end(ex.message);
  }
});

// Serve static files in production.
// The /join static mount serves hashed assets AND service-worker files
// (workbox-*.js hash changes per build, so no hardcoded routes).
if (config.nodeEnv === 'production') {
  // Participant page at /join and /p (PWA alias)
  app.use('/join', express.static(participantPagePath));
  app.use('/p', express.static(participantPagePath));

  // Host dashboard at root
  app.use(express.static(hostDashboardPath));

  // SPA fallback routes (must come after static mounts)
  app.get(['/join*', '/p*'], (req, res) => {
    res.sendFile(join(participantPagePath, 'index.html'));
  });
  app.get('*', (req, res) => {
    res.sendFile(join(hostDashboardPath, 'index.html'));
  });
}

// Redis-backed session store for horizontal scaling
class SessionStore {
  constructor() {
    this.localCache = new Map();
  }

  async get(sessionId) {
    if (redisReady && redisClient) {
      try {
        const data = await redisClient.get(`session:${sessionId}`);
        if (data) return JSON.parse(data);
      } catch (err) {
        logger.warn('Redis get failed, falling back to local cache', { error: err.message });
      }
    }
    return this.localCache.get(sessionId) || null;
  }

  async set(sessionId, session) {
    if (redisReady && redisClient) {
      try {
        await redisClient.setEx(`session:${sessionId}`, Math.ceil(SESSION_TIMEOUT / 1000), JSON.stringify(session));
      } catch (err) {
        logger.warn('Redis set failed', { error: err.message });
      }
    }
    this.localCache.set(sessionId, session);
  }

  async delete(sessionId) {
    if (redisReady && redisClient) {
      try {
        await redisClient.del(`session:${sessionId}`);
      } catch (err) {
        logger.warn('Redis delete failed', { error: err.message });
      }
    }
    this.localCache.delete(sessionId);
  }

  async has(sessionId) {
    if (redisReady && redisClient) {
      try {
        return await redisClient.exists(`session:${sessionId}`) === 1;
      } catch (err) {
        logger.warn('Redis exists failed', { error: err.message });
      }
    }
    return this.localCache.has(sessionId);
  }
}

const sessionStore = new SessionStore();

class Session {
  constructor(id) {
    this.id = id;
    // Secret held only by the host client; authorizes privileged HTTP routes
    this.hostToken = uuidv4();
    this.hostSocketId = null;
    this.devices = new Map();
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + SESSION_TIMEOUT;
    this.currentTrack = null;
    this.isPlaying = false;
    this.playbackPosition = 0;
    // Server-authoritative playback state machine (audio broadcast)
    this.playback = {
      trackId: null,
      trackName: null,
      trackUrl: null,
      duration: 0,
      isPlaying: false,
      position: 0,       // position at last state change
      startedAt: null,   // Date.now() of last transition to playing
    };
  }

  addDevice(deviceId, socketId, role, nickname, isCameraEnabled, isSpeakerEnabled) {
    this.devices.set(deviceId, {
      id: deviceId,
      socketId,
      role,
      nickname,
      joinedAt: Date.now(),
      isLive: false,
      volume: 1,
      lastPing: Date.now(),
      isCameraEnabled: isCameraEnabled ?? (role === 'camera' || role === 'device'),
      isSpeakerEnabled: isSpeakerEnabled ?? (role === 'speaker' || role === 'device'),
    });
  }

  removeDevice(deviceId) {
    this.devices.delete(deviceId);
  }

  getDevicesByRole(role) {
    return Array.from(this.devices.values()).filter(d => d.role === role);
  }

  isExpired() {
    return Date.now() > this.expiresAt;
  }
}

// In-memory fallback for when Redis is not available
const sessions = new Map();

async function getSession(sessionId) {
  if (redisReady) {
    const data = await sessionStore.get(sessionId);
    if (data) {
      const session = new Session(data.id);
      Object.assign(session, data);
      session.devices = new Map(Object.entries(data.devices || {}));
      return session;
    }
  }
  return sessions.get(sessionId) || null;
}

async function setSession(sessionId, session) {
  if (redisReady) {
    const sessionToSave = { ...session, devices: Object.fromEntries(session.devices) };
    await sessionStore.set(sessionId, sessionToSave);
  }
  sessions.set(sessionId, session);
}

async function deleteSession(sessionId) {
  if (redisReady) {
    await sessionStore.delete(sessionId);
  }
  sessions.delete(sessionId);
}

async function hasSession(sessionId) {
  if (redisReady) {
    return await sessionStore.has(sessionId);
  }
  return sessions.has(sessionId);
}

// Uploaded track registry (per-process; tracks are files on local disk)
const uploads = new Map();      // fileId -> { id, sessionId, filePath, name, mimeType, size }
const sessionFiles = new Map(); // sessionId -> Set<fileId>

function getPlaybackSnapshot(session) {
  const pb = session.playback;
  if (!pb || !pb.trackId) return null;
  const position = pb.isPlaying
    ? Math.min(pb.position + (Date.now() - pb.startedAt) / 1000, pb.duration || Infinity)
    : pb.position;
  return {
    trackUrl: pb.trackUrl,
    trackName: pb.trackName,
    duration: pb.duration,
    isPlaying: pb.isPlaying,
    position,
    serverTimestamp: Date.now(),
  };
}

function setPlaybackState(session, { isPlaying, position }) {
  const pb = session.playback;
  pb.isPlaying = isPlaying;
  pb.position = position;
  pb.startedAt = isPlaying ? Date.now() : null;
  session.isPlaying = isPlaying;
  session.playbackPosition = position;
}

function destroyUploadedFiles(sessionId) {
  const ids = sessionFiles.get(sessionId);
  if (!ids) return;
  for (const id of ids) {
    const meta = uploads.get(id);
    if (!meta) continue;
    // Synchronous so the registry is always consistent with disk afterwards
    try {
      fs.unlinkSync(meta.filePath);
    } catch (err) {
      logger.warn('Failed to delete uploaded track', { fileId: id, error: err.message });
    }
    uploads.delete(id);
  }
  sessionFiles.delete(sessionId);
}

// Single teardown path used by host end-session, host disconnect, and expiry
async function destroySession(sessionId) {
  io.to(`session:${sessionId}`).emit('session-ended');
  await deleteSession(sessionId);
  sessions.delete(sessionId);
  destroyUploadedFiles(sessionId);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id, ip: socket.handshake.address });

  socket.on('create-session', async (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    try {
      const sessionId = uuidv4().slice(0, 8).toUpperCase();
      const session = new Session(sessionId);
      session.hostSocketId = socket.id;
      await setSession(sessionId, session); // FIXED: was local-only, invisible to other instances when Redis is on

      socket.join(`session:${sessionId}`);
      socket.data.sessionId = sessionId;
      socket.data.deviceId = 'host';
      socket.data.role = 'host';
      socket.data.deviceId = socket.id; // Host uses socket.id as deviceId for disconnect handling

      const joinUrl = `${BASE_URL}/join/${sessionId}`;
      const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

      logger.info('Session created', { sessionId, hostSocketId: socket.id });
      callback?.({
        sessionId,
        joinUrl,
        qrCode: qrCodeDataUrl,
        hostToken: session.hostToken,
      });
    } catch (err) {
      logger.error('Failed to create session', { error: err.message });
      callback?.({ error: 'Failed to create session' });
    }
  });

  socket.on('rejoin-session', async (...args) => {
    const { sessionId, hostToken } = args[0] || {};
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    try {
      if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
        return callback?.({ error: 'Invalid session id' });
      }
const session = await getSession(sessionId);
      if (!session) {
        return callback?.({ error: 'Session not found' });
      }

      // If no active host (hostSocketId is null), require valid hostToken
      // This prevents session hijacking after host disconnects
      if (!session.hostSocketId) {
        if (!hostToken || session.hostToken !== hostToken) {
          return callback?.({ error: 'Invalid host token' });
        }
      } else {
        // Active host already connected - reject additional host connections
        return callback?.({ error: 'Host already connected' });
      }

      // Re-issue the host token so a stale holder loses host privileges
      session.hostToken = uuidv4();
      session.hostSocketId = socket.id;
      socket.join(`session:${sessionId}`);
      socket.data.sessionId = sessionId;
      socket.data.deviceId = 'host';
      socket.data.role = 'host';
      sessions.set(sessionId, session);
      await setSession(sessionId, session);

      const joinUrl = `${BASE_URL}/join/${sessionId}`;
      const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

      logger.info('Session rejoined', { sessionId, hostSocketId: socket.id });
      callback?.({
        sessionId,
        joinUrl,
        qrCode: qrCodeDataUrl,
        hostToken: session.hostToken,
        devices: Array.from(session.devices.values()).map(d => ({
          id: d.id,
          role: d.role,
          nickname: d.nickname,
          isCameraEnabled: d.isCameraEnabled,
          isSpeakerEnabled: d.isSpeakerEnabled,
        })),
        isPlaying: session.isPlaying,
        currentTrack: session.currentTrack,
        playbackPosition: session.playbackPosition,
        playback: getPlaybackSnapshot(session),
      });
    } catch (err) {
      logger.error('Failed to rejoin session', { error: err.message });
      callback?.({ error: 'Failed to rejoin session' });
    }
  });

  socket.on('join-session', async (...args) => {
    const { sessionId, role, nickname, isCameraEnabled, isSpeakerEnabled } = args[0] || {};
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    try {
      if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
        return callback?.({ error: 'Invalid session id' });
      }
      const session = await getSession(sessionId);
      if (!session) {
        return callback?.({ error: 'Session not found' });
      }

      const deviceId = socket.id;
      session.addDevice(deviceId, socket.id, role, nickname, isCameraEnabled, isSpeakerEnabled);

      socket.join(`session:${sessionId}`);
      socket.data.sessionId = sessionId;
      socket.data.deviceId = deviceId;
      socket.data.role = role;

      sessions.set(sessionId, session);
      await setSession(sessionId, session);

      logger.info('Device joined session', { sessionId, deviceId, role });

      // Notify host
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('device-joined', {
          deviceId,
          role,
          nickname,
          isCameraEnabled: isCameraEnabled ?? (role === 'camera' || role === 'device'),
          isSpeakerEnabled: isSpeakerEnabled ?? (role === 'speaker' || role === 'device'),
        });
      }

      callback?.({
        sessionId,
        deviceId,
        isHost: false,
      });
    } catch (err) {
      logger.error('Failed to join session', { error: err.message });
      callback?.({ error: 'Failed to join session' });
    }
  });

  socket.on('offer', ({ targetDeviceId, offer }, callback) => {
    const sessionId = socket.data.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return callback?.({ error: 'Session not found' });

    const targetDevice = session.devices.get(targetDeviceId);
    if (targetDevice) {
      io.to(targetDevice.socketId).emit('offer', { offer, fromDeviceId: socket.data.deviceId });
    }
    callback?.({ success: true });
  });

  socket.on('answer', ({ targetDeviceId, answer }) => {
    const sessionId = socket.data.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return;

    const targetDevice = session.devices.get(targetDeviceId);
    if (targetDevice) {
      io.to(targetDevice.socketId).emit('answer', { answer, fromDeviceId: socket.data.deviceId });
    }
  });

  socket.on('ice-candidate', ({ targetDeviceId, candidate }) => {
    const sessionId = socket.data.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return;

    if (targetDeviceId === 'host') {
      const hostSocketId = session.hostSocketId;
      if (hostSocketId) {
        io.to(hostSocketId).emit('ice-candidate', { candidate, fromDeviceId: socket.data.deviceId });
      }
    } else {
      const device = session.devices.get(targetDeviceId);
      if (device) {
        io.to(device.socketId).emit('ice-candidate', {
          candidate,
          // FIXED: fromDeviceId was omitted; the participant filters candidates
          // by `fromDeviceId === targetDeviceId` so host->device candidates were silently dropped
          fromDeviceId: socket.data.role === 'host' ? 'host' : socket.data.deviceId,
        });
      }
    }
  });

  // ===== Camera & device-control relays =====
  // FIXED: clients emitted these events but the server had no handlers,
  // so offers, camera lists, and host control commands never reached their targets

  socket.on('camera-offer', ({ deviceId, offer }, callback) => {
    const session = sessions.get(socket.data.sessionId);
    // Only the owning participant may offer, and only within its own session
    if (!session || !offer || deviceId !== socket.data.deviceId) {
      return callback?.({ error: 'Invalid camera offer' });
    }
    if (session.hostSocketId) {
      io.to(session.hostSocketId).emit('camera-offer', { deviceId, offer });
    }
    callback?.({ success: true });
  });

  socket.on('camera-answer', ({ deviceId, answer }, callback) => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    if (!session || !answer) return;
    const device = session.devices.get(deviceId);
    if (device) {
      io.to(device.socketId).emit('camera-answer', { answer });
    }
    callback?.({ success: true });
  });

  socket.on('device-cameras', ({ cameras }) => {
    const session = sessions.get(socket.data.sessionId);
    if (!session || !Array.isArray(cameras)) return;
    if (session.hostSocketId) {
      io.to(session.hostSocketId).emit('device-cameras-update', { deviceId: socket.data.deviceId, cameras });
    }
  });

  socket.on('camera-switched', ({ cameraId }) => {
    const session = sessions.get(socket.data.sessionId);
    if (!session) return;
    if (session.hostSocketId) {
      io.to(session.hostSocketId).emit('camera-active-update', { deviceId: socket.data.deviceId, cameraId });
    }
  });

  socket.on('switch-camera', ({ deviceId, cameraId }) => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    const device = session && session.devices.get(deviceId);
    if (device && cameraId) {
      io.to(device.socketId).emit('switch-camera', { cameraId });
    }
  });

  socket.on('request-quality', ({ deviceId, quality }) => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    const device = session && session.devices.get(deviceId);
    if (device && quality) {
      io.to(device.socketId).emit('request-quality', { quality });
    }
  });

  socket.on('quality-changed', ({ quality }) => {
    const session = sessions.get(socket.data.sessionId);
    if (!session) return;
    if (session.hostSocketId) {
      io.to(session.hostSocketId).emit('quality-changed', { deviceId: socket.data.deviceId, quality });
    }
  });

  socket.on('remove-device', ({ deviceId }) => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    const device = session && session.devices.get(deviceId);
    const target = device ? io.sockets.sockets.get(device.socketId) : null;
    if (target) {
      target.emit('removed-from-session');
      // Force disconnect; the disconnect handler owns cleanup + notifications
      target.disconnect(true);
    }
  });

  socket.on('end-session', () => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    destroySession(sessionId);
    logger.info('Session ended by host', { sessionId });
  });

  // ===== Audio broadcast: server-authoritative playback state machine =====

  socket.on('start-playing', async ({ trackId, duration } = {}, callback) => {
    // Always ack — a silent return leaves the client awaiting forever
    if (socket.data.role !== 'host') {
      return callback?.({ error: 'Host authorization required' });
    }
    const session = sessions.get(socket.data.sessionId);
    const meta = session && trackId ? uploads.get(trackId) : null;
    if (!meta || meta.sessionId !== session.id) {
      return callback?.({ error: 'Track not uploaded for this session' });
    }

    const pb = session.playback;
    pb.trackId = meta.id;
    pb.trackName = meta.name;
    pb.trackUrl = `${BASE_URL}/api/audio/${meta.id}`;
    // Host reports the real duration so seek clamping and REST snapshots work
    pb.duration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : 0;
    setPlaybackState(session, { isPlaying: true, position: 0 });
    session.currentTrack = { trackId: meta.id, trackName: meta.name, trackUrl: pb.trackUrl };
    await setSession(session.id, session);

    io.to(`session:${session.id}`).emit('playback-started', {
      trackUrl: pb.trackUrl,
      trackName: meta.name,
      position: 0,
      serverTimestamp: Date.now(),
    });
    callback?.({ success: true });
  });

  socket.on('pause-playing', async (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (socket.data.role !== 'host') {
      return callback?.({ error: 'Host authorization required' });
    }
    const session = sessions.get(socket.data.sessionId);
    const pb = session && session.playback;
    if (!session || !pb.trackId || !pb.isPlaying) return;

    const position = Math.min(pb.position + (Date.now() - pb.startedAt) / 1000, pb.duration || Infinity);
    setPlaybackState(session, { isPlaying: false, position });
    await setSession(session.id, session);

    io.to(`session:${session.id}`).emit('playback-paused', { position, serverTimestamp: Date.now() });
    callback?.({ success: true });
  });

  socket.on('resume-playing', async (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (socket.data.role !== 'host') {
      return callback?.({ error: 'Host authorization required' });
    }
    const session = sessions.get(socket.data.sessionId);
    const pb = session && session.playback;
    if (!session || !pb.trackId || pb.isPlaying) return;

    setPlaybackState(session, { isPlaying: true, position: pb.position });
    await setSession(session.id, session);

    io.to(`session:${session.id}`).emit('playback-resumed', {
      position: pb.position,
      serverTimestamp: Date.now(),
    });
    callback?.({ success: true });
  });

  socket.on('seek-playing', async (...args) => {
    const { position } = args[0] || {};
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (socket.data.role !== 'host') {
      return callback?.({ error: 'Host authorization required' });
    }
    const session = sessions.get(socket.data.sessionId);
    const pb = session && session.playback;
    if (!session || !pb.trackId || typeof position !== 'number' || !Number.isFinite(position)) {
      return callback?.({ error: 'Invalid seek position' });
    }

    // Preserve playing state across a seek; clamp into the known duration
    const maxPos = pb.duration > 0 ? pb.duration : Number.MAX_SAFE_INTEGER;
    const clamped = Math.max(0, Math.min(position, maxPos));
    setPlaybackState(session, { isPlaying: pb.isPlaying, position: clamped });
    await setSession(session.id, session);

    io.to(`session:${session.id}`).emit('playback-seeked', { position: clamped, serverTimestamp: Date.now() });
    callback?.({ success: true });
  });

  socket.on('track-ended', async () => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    const pb = session && session.playback;
    if (!session || !pb.trackId) return;

    setPlaybackState(session, { isPlaying: false, position: pb.duration > 0 ? pb.duration : pb.position });
    await setSession(session.id, session);

    io.to(`session:${session.id}`).emit('playback-paused', {
      position: pb.duration > 0 ? pb.duration : pb.position,
      serverTimestamp: Date.now(),
    });
  });

  // NTP-style clock sync so participants can correct server/client clock skew
  socket.on('clock-sync', (callback) => {
    if (typeof callback === 'function') callback(Date.now());
  });

  // ===== Push-to-talk transport =====

  socket.on('push-to-talk-start', () => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    if (session) io.to(`session:${session.id}`).emit('host-mic-active');
  });

  socket.on('push-to-talk-stop', () => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    if (!session) return;
    io.to(`session:${session.id}`).emit('host-mic-inactive');
    io.to(`session:${session.id}`).emit('ptt-stopped');
  });

  socket.on('ptt-offer', ({ deviceId, offer }) => {
    if (socket.data.role !== 'host') return;
    const session = sessions.get(socket.data.sessionId);
    const device = session && deviceId ? session.devices.get(deviceId) : null;
    if (device && offer) {
      io.to(device.socketId).emit('ptt-offer', { offer });
    }
  });

  socket.on('ptt-answer', ({ answer }) => {
    if (socket.data.role === 'host') return; // answers come only from devices
    const session = sessions.get(socket.data.sessionId);
    if (session && session.hostSocketId && answer) {
      io.to(session.hostSocketId).emit('ptt-answer', { deviceId: socket.data.deviceId, answer });
    }
  });

  socket.on('ptt-ice-candidate', ({ targetDeviceId, candidate }) => {
    const session = sessions.get(socket.data.sessionId);
    if (!session || !candidate) return;
    if (socket.data.role === 'host') {
      const device = targetDeviceId ? session.devices.get(targetDeviceId) : null;
      if (device) {
        io.to(device.socketId).emit('ptt-ice-candidate', { candidate, fromDeviceId: 'host' });
      }
    } else if (session.hostSocketId) {
      io.to(session.hostSocketId).emit('ptt-ice-candidate', { candidate, fromDeviceId: socket.data.deviceId });
    }
  });

  socket.on('device-ping', ({ deviceId }) => {
    const sessionId = socket.data.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return;

    const device = session.devices.get(deviceId);
    if (device) {
      device.lastPing = Date.now();
    }
  });

  socket.on('disconnect', async (reason) => {
    const { sessionId, deviceId, role } = socket.data;
    logger.info('Client disconnected', { socketId: socket.id, sessionId, deviceId, role, reason });

    if (!sessionId || !deviceId) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    if (role === 'host') {
      // Host disconnected (e.g., page refresh) - keep session alive for rejoin
      // Only clear hostSocketId; session will be destroyed by expiry or explicit end-session
      session.hostSocketId = null;
      await setSession(sessionId, session);
      io.to(`session:${sessionId}`).emit('host-disconnected');
    } else {
      session.removeDevice(deviceId);
      io.to(`session:${sessionId}`).emit('device-left', { deviceId });

      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('device-left', { deviceId });
      }

      await setSession(sessionId, session); // FIXED: was local-only, Redis copy kept the removed device alive
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sessions: sessions.size,
    redis: redisReady ? 'connected' : 'disconnected',
    memory: process.memoryUsage(),
    version: process.version,
  });
});

// Session info endpoint (host-authorized via query or header)
app.get('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const hostToken = req.headers['x-host-token'] || req.query.hostToken;
  if (!hostToken || hostToken !== session.hostToken) {
    return res.status(403).json({ error: 'Host authorization required' });
  }

  res.json({
    id: session.id,
    deviceCount: session.devices.size,
    devices: Array.from(session.devices.values()).map(d => ({
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
app.post('/api/sessions/:sessionId/upload', uploadLimiter, express.raw({
  type: (req) => String(req.headers['content-type'] || '').startsWith('audio/'),
  limit: MAX_UPLOAD_BYTES + 1,
}), async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (req.headers['x-host-token'] !== session.hostToken) {
    return res.status(403).json({ error: 'Host authorization required' });
  }
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'Empty upload body' });
  }
  if (req.body.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
  }

  const mimeType = String(req.headers['content-type']).split(';')[0].trim();
  // Sanitize the display name; the file on disk uses an opaque id instead
  const safeName = String(req.query.name || 'track')
    .slice(0, 120)
    .replace(/[^A-Za-z0-9 ._()-]/g, '_') || 'track';

  const fileId = uuidv4();
  const filePath = join(UPLOAD_DIR, `${sessionId}-${fileId}`);
  try {
    await fs.promises.writeFile(filePath, req.body);
  } catch (err) {
    logger.error('Failed to write uploaded track', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to store track' });
  }

  uploads.set(fileId, { id: fileId, sessionId, filePath, name: safeName, mimeType, size: req.body.length });
  if (!sessionFiles.has(sessionId)) sessionFiles.set(sessionId, new Set());
  sessionFiles.get(sessionId).add(fileId);

  logger.info('Track uploaded', { sessionId, fileId, name: safeName, size: req.body.length });
  res.json({
    trackId: fileId,
    trackName: safeName,
    // Derive from the request so the URL is correct behind proxies AND in tests
    trackUrl: `${req.protocol}://${req.get('host')}/api/audio/${fileId}`,
    size: req.body.length,
  });
});

// Track download: validate id shape before hitting the registry
app.get('/api/audio/:fileId', (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.fileId)) {
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
app.get('/', (req, res) => {
  res.json({
    service: 'Iris SYNCD Server',
    version: '1.0.0',
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

// SPA fallback — MUST come after static + API routes.
// Deep links like /join/ABCD1234 have no file on disk; without this,
// every QR code scan returns 404 JSON in production.
const wantsHtml = (req) => (req.headers.accept || '').includes('text/html');

if (config.nodeEnv === 'production') {
  app.use((req, res, next) => {
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup intervals
const sessionExpiryInterval = setInterval(() => {
  for (const [sessionId, session] of sessions.entries()) {
    if (session.isExpired()) {
      destroySession(sessionId);
      logger.info('Session expired and cleaned up', { sessionId });
    }
  }
}, 60000);

// Cleanup stale devices
const staleDeviceInterval = setInterval(() => {
  const now = Date.now();
  const STALE_THRESHOLD = 30000;

  for (const [sessionId, session] of sessions.entries()) {
    for (const [deviceId, device] of session.devices.entries()) {
      if (now - (device.lastPing || device.joinedAt) > STALE_THRESHOLD) {
        logger.info('Removing stale device', { deviceId, sessionId });
        session.removeDevice(deviceId);
        io.to(`session:${sessionId}`).emit('device-left', { deviceId });
      }
    }
  }
}, 30000);

// Sentry error handler (must be after all other middleware)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} received, starting graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Close all socket connections
    io.close(() => {
      logger.info('Socket.IO server closed');
    });

    // Close Redis connections
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis client closed');
    }
    if (redisSubClient) {
      await redisSubClient.quit();
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
  logger.error('Unhandled Rejection', { reason: reason?.message || String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

// Test hook: stop timers + servers without killing the process
function _stopForTests() {
  clearInterval(sessionExpiryInterval);
  clearInterval(staleDeviceInterval);
  io.close();
  server.close();
  if (redisClient) redisClient.disconnect();
  if (redisSubClient) redisSubClient.disconnect();
}

// Start server only when executed directly (importing runs tests/tools instead)
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  server.listen(config.port, () => {
    logger.info('Iris SYNCD server started', {
      port: config.port,
      baseUrl: config.baseUrl,
      environment: config.nodeEnv,
      redis: redisReady ? 'connected' : 'not configured',
    });
  });
}

export {
  app, server, io, sessions,
  getSession, setSession, deleteSession, hasSession,
  Session, SessionStore, destroySession, destroyUploadedFiles, getPlaybackSnapshot,
  uploads, sessionFiles, _stopForTests,
};