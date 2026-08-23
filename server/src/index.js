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
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static file paths for production
const hostDashboardPath = join(__dirname, '../../host-dashboard/dist');
const participantPagePath = join(__dirname, '../../participant-page/dist');

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
app.use(helmet({
  contentSecurityPolicy: false, // WebSocket needs inline scripts
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS configuration
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map(o => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

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

// Serve static files in production
if (config.nodeEnv === 'production') {
  // Participant page at /join
  app.use('/join/assets', express.static(join(__dirname, '../../participant-page/dist/assets')));
  app.use('/join/manifest.webmanifest', express.static(join(__dirname, '../../participant-page/dist/manifest.webmanifest')));
  app.use('/join/sw.js', express.static(join(__dirname, '../../participant-page/dist/sw.js')));
  app.use('/join/workbox-e4022e15.js', express.static(join(__dirname, '../../participant-page/dist/workbox-e4022e15.js')));
  app.use('/join/favicon.ico', express.static(join(__dirname, '../../participant-page/dist/favicon.ico')));
  app.use('/join', express.static(join(__dirname, '../../participant-page/dist')));

  // Participant page at /p (alias)
  app.use('/p/assets', express.static(join(__dirname, '../../participant-page/dist/assets')));
  app.use('/p/manifest.webmanifest', express.static(join(__dirname, '../../participant-page/dist/manifest.webmanifest')));
  app.use('/p/sw.js', express.static(join(__dirname, '../../participant-page/dist/sw.js')));
  app.use('/p/workbox-e4022e15.js', express.static(join(__dirname, '../../participant-page/dist/workbox-e4022e15.js')));
  app.use('/p/favicon.ico', express.static(join(__dirname, '../../participant-page/dist/favicon.ico')));
  app.use('/p', express.static(join(__dirname, '../../participant-page/dist')));

  // Host dashboard assets
  app.use('/assets', express.static(join(__dirname, '../../host-dashboard/dist/assets')));
  app.use('/favicon.ico', express.static(join(__dirname, '../../host-dashboard/dist/favicon.ico')));

  // Host dashboard HTML fallback
  app.use(express.static(join(__dirname, '../../host-dashboard/dist')));
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
    this.hostSocketId = null;
    this.devices = new Map();
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + SESSION_TIMEOUT;
    this.currentTrack = null;
    this.isPlaying = false;
    this.playbackPosition = 0;
    this.playbackStartedAt = null;
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

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id, ip: socket.handshake.address });

  socket.on('create-session', async (callback) => {
    try {
      const sessionId = uuidv4().slice(0, 8).toUpperCase();
      const session = new Session(sessionId);
      session.hostSocketId = socket.id;
      sessions.set(sessionId, session);

      socket.join(`session:${sessionId}`);
      socket.data.sessionId = sessionId;
      socket.data.role = 'host';

      const joinUrl = `${BASE_URL}/join/${sessionId}`;
      const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

      logger.info('Session created', { sessionId, hostSocketId: socket.id });
      callback({
        sessionId,
        joinUrl,
        qrCode: qrCodeDataUrl,
      });
    } catch (err) {
      logger.error('Failed to create session', { error: err.message });
      callback({ error: 'Failed to create session' });
    }
  });

  socket.on('rejoin-session', async ({ sessionId }, callback) => {
    try {
      const session = await getSession(sessionId);
      if (!session) {
        return callback({ error: 'Session not found' });
      }

      session.hostSocketId = socket.id;
      socket.join(`session:${sessionId}`);
      socket.data.sessionId = sessionId;
      socket.data.role = 'host';
      sessions.set(sessionId, session);
      await setSession(sessionId, session);

      const joinUrl = `${BASE_URL}/join/${sessionId}`;
      const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

      logger.info('Session rejoined', { sessionId, hostSocketId: socket.id });
      callback({
        sessionId,
        joinUrl,
        qrCode: qrCodeDataUrl,
      });
    } catch (err) {
      logger.error('Failed to rejoin session', { error: err.message });
      callback({ error: 'Failed to rejoin session' });
    }
  });

  socket.on('join-session', async ({ sessionId, role, nickname, isCameraEnabled, isSpeakerEnabled }, callback) => {
    try {
      const session = await getSession(sessionId);
      if (!session) {
        return callback({ error: 'Session not found' });
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

      callback({
        sessionId,
        deviceId,
        isHost: false,
      });
    } catch (err) {
      logger.error('Failed to join session', { error: err.message });
      callback({ error: 'Failed to join session' });
    }
  });

  socket.on('offer', ({ targetDeviceId, offer }, callback) => {
    const sessionId = socket.data.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return callback({ error: 'Session not found' });

    const targetDevice = session.devices.get(targetDeviceId);
    if (targetDevice) {
      io.to(targetDevice.socketId).emit('offer', { offer, fromDeviceId: socket.data.deviceId });
    }
    callback({ success: true });
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
        io.to(device.socketId).emit('ice-candidate', { candidate });
      }
    }
  });

  socket.on('end-session', () => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    io.to(`session:${sessionId}`).emit('session-ended');
    deleteSession(sessionId);
    sessions.delete(sessionId);
    logger.info('Session ended by host', { sessionId });
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

  socket.on('disconnect', (reason) => {
    const { sessionId, deviceId, role } = socket.data;
    logger.info('Client disconnected', { socketId: socket.id, sessionId, deviceId, role, reason });

    if (!sessionId || !deviceId) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    if (role === 'host') {
      io.to(`session:${sessionId}`).emit('session-ended');
      deleteSession(sessionId);
      sessions.delete(sessionId);
    } else {
      session.removeDevice(deviceId);
      io.to(`session:${sessionId}`).emit('device-left', { deviceId });

      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('device-left', { deviceId });
      }

      sessions.set(sessionId, session);
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

// Session info endpoint
app.get('/api/sessions/:sessionId', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
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
setInterval(() => {
  for (const [sessionId, session] of sessions.entries()) {
    if (session.isExpired()) {
      io.to(`session:${sessionId}`).emit('session-ended');
      deleteSession(sessionId);
      sessions.delete(sessionId);
      logger.info('Session expired and cleaned up', { sessionId });
    }
  }
}, 60000);

// Cleanup stale devices
setInterval(() => {
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

// Start server
server.listen(PORT, () => {
  logger.info('Iris SYNCD server started', {
    port: PORT,
    baseUrl: BASE_URL,
    environment: config.nodeEnv,
    redis: redisReady ? 'connected' : 'not configured',
  });
});

export { app, server, io, sessions, getSession, setSession, deleteSession, hasSession, Session, SessionStore };