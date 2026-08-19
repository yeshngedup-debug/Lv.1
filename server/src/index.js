import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : isProduction ? [] : ['http://localhost:5173', 'http://localhost:5174'];

const useCredentials = ALLOWED_ORIGINS.length > 0;

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST'],
    credentials: useCredentials
  }
});

app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true,
  credentials: useCredentials
}));
app.use(express.json());

// Rate limiting for session creation
const createSessionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many session creation requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', createSessionLimiter);

const hostDashboardPath = join(__dirname, '../../host-dashboard/dist');
const participantPagePath = join(__dirname, '../../participant-page/dist');

app.use('/host', express.static(hostDashboardPath));
app.use('/p', express.static(participantPagePath));
app.use(express.static(hostDashboardPath));

const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 3600000; // 1 hour default

const sessions = new Map();

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

  addDevice(deviceId, socketId, role, nickname) {
    this.devices.set(deviceId, {
      id: deviceId,
      socketId,
      role,
      nickname,
      joinedAt: Date.now(),
      isLive: false,
      volume: 1
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

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('create-session', async (callback) => {
    const sessionId = uuidv4().slice(0, 8).toUpperCase();
    const session = new Session(sessionId);
    session.hostSocketId = socket.id;
    sessions.set(sessionId, session);

    socket.join(`session:${sessionId}`);
    socket.data.sessionId = sessionId;
    socket.data.role = 'host';

    const joinUrl = `${BASE_URL}/join/${sessionId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

    console.log(`Session created: ${sessionId}`);
    callback({
      sessionId,
      joinUrl,
      qrCode: qrCodeDataUrl
    });
  });

  socket.on('rejoin-session', ({ sessionId }, callback) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return callback({ error: 'Session not found' });
    }

    if (session.isExpired()) {
      sessions.delete(sessionId);
      return callback({ error: 'Session has expired' });
    }

    // Update host socket ID for reconnection
    session.hostSocketId = socket.id;
    socket.join(`session:${sessionId}`);
    socket.data.sessionId = sessionId;
    socket.data.role = 'host';

    callback({
      devices: Array.from(session.devices.values()).map(d => ({
        id: d.id,
        role: d.role,
        nickname: d.nickname
      })),
      isPlaying: session.isPlaying,
      currentTrack: session.currentTrack,
      playbackPosition: session.playbackPosition,
      playbackStartedAt: session.playbackStartedAt
    });

    console.log(`Host reconnected to session: ${sessionId}`);
  });

  socket.on('join-session', ({ sessionId, role, nickname }, callback) => {
    const session = sessions.get(sessionId);

    if (!session) {
      return callback({ error: 'Session not found' });
    }

    if (session.isExpired()) {
      sessions.delete(sessionId);
      return callback({ error: 'Session has expired' });
    }

    // Validate role
    const validRoles = ['speaker', 'camera'];
    if (!validRoles.includes(role)) {
      return callback({ error: 'Invalid role. Must be "speaker" or "camera"' });
    }

    // Sanitize nickname (max 50 chars, alphanumeric + spaces + basic punctuation)
    const sanitizedNickname = (nickname || `Device ${session.devices.size + 1}`)
      .slice(0, 50)
      .replace(/[<>\"']/g, '');

    const deviceId = uuidv4();
    session.addDevice(deviceId, socket.id, role, sanitizedNickname);

    socket.join(`session:${sessionId}`);
    socket.data.sessionId = sessionId;
    socket.data.deviceId = deviceId;
    socket.data.role = role;

    callback({
      deviceId,
      session: {
        id: sessionId,
        isPlaying: session.isPlaying,
        currentTrack: session.currentTrack,
        playbackPosition: session.playbackPosition,
        playbackStartedAt: session.playbackStartedAt
      }
    });

    io.to(`session:${sessionId}`).emit('device-joined', {
      deviceId,
      role,
      nickname: session.devices.get(deviceId).nickname
    });

    console.log(`Device ${deviceId} joined session ${sessionId} as ${role}`);
  });

  socket.on('disconnect', () => {
    const { sessionId, deviceId, role } = socket.data;

    if (!sessionId) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    if (role === 'host') {
      io.to(`session:${sessionId}`).emit('session-ended');
      sessions.delete(sessionId);
      console.log(`Session ${sessionId} ended (host disconnected)`);
    } else if (deviceId) {
      session.removeDevice(deviceId);
      io.to(`session:${sessionId}`).emit('device-left', { deviceId });
      console.log(`Device ${deviceId} left session ${sessionId}`);
    }
  });

  socket.on('remove-device', ({ deviceId }) => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    const session = sessions.get(sessionId);
    if (!session) return;

    const device = session.devices.get(deviceId);
    if (device) {
      io.to(device.socketId).emit('removed-from-session');
      session.removeDevice(deviceId);
      io.to(`session:${sessionId}`).emit('device-left', { deviceId });
    }
  });

  socket.on('start-playing', ({ trackUrl, trackName, duration }) => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    const session = sessions.get(sessionId);
    if (!session) return;

    session.currentTrack = { url: trackUrl, name: trackName, duration };
    session.isPlaying = true;
    session.playbackPosition = 0;
    session.playbackStartedAt = Date.now();

    io.to(`session:${sessionId}`).emit('playback-started', {
      trackUrl,
      trackName,
      duration,
      serverTimestamp: Date.now()
    });
  });

  socket.on('pause-playing', () => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    const session = sessions.get(sessionId);
    if (!session) return;

    session.isPlaying = false;
    session.playbackPosition = (Date.now() - session.playbackStartedAt) / 1000;

    io.to(`session:${sessionId}`).emit('playback-paused', {
      position: session.playbackPosition
    });
  });

  socket.on('resume-playing', () => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    const session = sessions.get(sessionId);
    if (!session) return;

    session.isPlaying = true;
    session.playbackStartedAt = Date.now() - (session.playbackPosition * 1000);

    io.to(`session:${sessionId}`).emit('playback-resumed', {
      serverTimestamp: Date.now(),
      position: session.playbackPosition
    });
  });

  socket.on('seek-playing', ({ position }) => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    const session = sessions.get(sessionId);
    if (!session) return;

    session.playbackPosition = position;
    session.playbackStartedAt = Date.now() - (position * 1000);

    io.to(`session:${sessionId}`).emit('playback-seeked', {
      position,
      serverTimestamp: Date.now()
    });
  });

  socket.on('update-device-volume', ({ deviceId, volume }) => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    const session = sessions.get(sessionId);
    if (!session) return;

    const device = session.devices.get(deviceId);
    if (device) {
      device.volume = volume;
      io.to(device.socketId).emit('volume-changed', { volume });
    }
  });

  socket.on('push-to-talk-start', () => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    io.to(`session:${sessionId}`).emit('host-mic-active');
  });

  socket.on('push-to-talk-stop', () => {
    const { sessionId, role } = socket.data;
    if (role !== 'host') return;

    io.to(`session:${sessionId}`).emit('host-mic-inactive');
  });

  socket.on('camera-offer', ({ deviceId, offer }) => {
    const { sessionId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session) return;

    // Validate the device belongs to this session and is a camera
    const device = session.devices.get(deviceId);
    if (!device || device.role !== 'camera') return;

    const hostSocketId = session.hostSocketId;
    if (hostSocketId) {
      io.to(hostSocketId).emit('camera-offer', { deviceId, offer });
    }
  });

  socket.on('camera-answer', ({ deviceId, answer }) => {
    const { sessionId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session) return;

    const device = session.devices.get(deviceId);
    if (!device || device.role !== 'camera') return;

    io.to(device.socketId).emit('camera-answer', { answer });
  });

  socket.on('ice-candidate', ({ targetDeviceId, candidate }) => {
    const { sessionId } = socket.data;
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
    sessions.delete(sessionId);
  });
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
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
      isLive: d.isLive
    })),
    currentTrack: session.currentTrack,
    isPlaying: session.isPlaying
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.get('/join/:sessionId', (req, res) => {
  res.sendFile(join(participantPagePath, 'index.html'));
});

app.get('/host/*', (req, res) => {
  res.sendFile(join(hostDashboardPath, 'index.html'));
});

app.get('/p/*', (req, res) => {
  res.sendFile(join(participantPagePath, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(join(hostDashboardPath, 'index.html'));
});

setInterval(() => {
  for (const [sessionId, session] of sessions.entries()) {
    if (session.isExpired()) {
      io.to(`session:${sessionId}`).emit('session-ended');
      sessions.delete(sessionId);
      console.log(`Session ${sessionId} expired and cleaned up`);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`Iris SYNCD server running on port ${PORT}`);
});
