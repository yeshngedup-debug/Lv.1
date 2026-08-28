import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import {
  BASE_URL,
  SESSION_ID_RE,
  generateSessionCode,
  safeEqualToken,
  joinBlocked,
  recordJoinFail,
  clearJoinFails,
} from './config.ts';
import { logger } from './logger.ts';
import {
  Session,
  sessions,
  getSession,
  setSession,
  hasSession,
  destroySession,
  getPlaybackSnapshot,
  setPlaybackState,
} from './sessions.ts';
import { uploads } from './uploads.ts';

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    logger.info('Client connected', { socketId: socket.id, ip: socket.handshake.address });

    socket.on('create-session', async (...args: any[]) => {
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      try {
        let sessionId = generateSessionCode();
        while (await hasSession(sessionId)) sessionId = generateSessionCode();
        const session = new Session(sessionId);
        session.hostSocketId = socket.id;
        await setSession(sessionId, session);

        socket.join(`session:${sessionId}`);
        socket.data.sessionId = sessionId;
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
      } catch (err: any) {
        logger.error('Failed to create session', { error: err.message });
        callback?.({ error: 'Failed to create session' });
      }
    });

    socket.on('rejoin-session', async (...args: any[]) => {
      const { sessionId, hostToken } = args[0] || {};
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      const ip = socket.handshake.address;
      try {
        if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
          return callback?.({ error: 'Invalid session id' });
        }
        if (joinBlocked(ip)) {
          return callback?.({ error: 'Too many attempts, try again later' });
        }
        const session = await getSession(sessionId);
        if (!session) {
          recordJoinFail(ip);
          return callback?.({ error: 'Session not found' });
        }

        // If no active host (hostSocketId is null), require valid hostToken
        // This prevents session hijacking after host disconnects
        if (!session.hostSocketId) {
          if (!hostToken || !safeEqualToken(hostToken, session.hostToken)) {
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
        await setSession(sessionId, session);
        clearJoinFails(ip);

        const joinUrl = `${BASE_URL}/join/${sessionId}`;
        const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

        logger.info('Session rejoined', { sessionId, hostSocketId: socket.id });
        callback?.({
          sessionId,
          joinUrl,
          qrCode: qrCodeDataUrl,
          hostToken: session.hostToken,
          devices: Array.from(session.devices.values()).map((d) => ({
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
      } catch (err: any) {
        logger.error('Failed to rejoin session', { error: err.message });
        callback?.({ error: 'Failed to rejoin session' });
      }
    });

    socket.on('join-session', async (...args: any[]) => {
      const { sessionId, role, nickname, isCameraEnabled, isSpeakerEnabled } = args[0] || {};
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      const ip = socket.handshake.address;
      try {
        if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
          return callback?.({ error: 'Invalid session id' });
        }
        if (joinBlocked(ip)) {
          return callback?.({ error: 'Too many attempts, try again later' });
        }
        const session = await getSession(sessionId);
        if (!session) {
          recordJoinFail(ip);
          return callback?.({ error: 'Session not found' });
        }

        const deviceId = socket.id;
        session.addDevice(deviceId, socket.id, role, nickname, isCameraEnabled, isSpeakerEnabled);

        socket.join(`session:${sessionId}`);
        socket.data.sessionId = sessionId;
        socket.data.deviceId = deviceId;
        socket.data.role = role;

        await setSession(sessionId, session);
        clearJoinFails(ip);

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
      } catch (err: any) {
        logger.error('Failed to join session', { error: err.message });
        callback?.({ error: 'Failed to join session' });
      }
    });

    socket.on('offer', async ({ targetDeviceId, offer }: any, callback: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session) return callback?.({ error: 'Session not found' });

      const targetDevice = session.devices.get(targetDeviceId);
      if (targetDevice) {
        io.to(targetDevice.socketId).emit('offer', { offer, fromDeviceId: socket.data.deviceId });
      }
      callback?.({ success: true });
    });

    socket.on('answer', async ({ targetDeviceId, answer }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session) return;

      const targetDevice = session.devices.get(targetDeviceId);
      if (targetDevice) {
        io.to(targetDevice.socketId).emit('answer', { answer, fromDeviceId: socket.data.deviceId });
      }
    });

    socket.on('ice-candidate', async ({ targetDeviceId, candidate }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session) return;

      if (targetDeviceId === 'host') {
        const hostSocketId = session.hostSocketId;
        if (hostSocketId) {
          io.to(hostSocketId).emit('ice-candidate', {
            candidate,
            fromDeviceId: socket.data.deviceId,
          });
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

    socket.on('camera-offer', async ({ deviceId, offer }: any, callback: any) => {
      const session = await getSession(socket.data.sessionId);
      // Only the owning participant may offer, and only within its own session
      if (!session || !offer || deviceId !== socket.data.deviceId) {
        return callback?.({ error: 'Invalid camera offer' });
      }
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('camera-offer', { deviceId, offer });
      }
      callback?.({ success: true });
    });

    socket.on('camera-answer', async ({ deviceId, answer }: any, callback: any) => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      if (!session || !answer) return;
      const device = session.devices.get(deviceId);
      if (device) {
        io.to(device.socketId).emit('camera-answer', { answer });
      }
      callback?.({ success: true });
    });

    // Namespaced ICE relay for camera PCs (keeps camera candidates separate
    // from the generic/ptt ICE channels when a host runs multiple PCs per peer)
    socket.on('camera-ice-candidate', async ({ targetDeviceId, candidate }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session || !candidate) return;
      if (socket.data.role === 'host') {
        const device = targetDeviceId ? session.devices.get(targetDeviceId) : null;
        if (device) {
          io.to(device.socketId).emit('camera-ice-candidate', {
            candidate,
            fromDeviceId: 'host',
          });
        }
      } else if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('camera-ice-candidate', {
          candidate,
          fromDeviceId: socket.data.deviceId,
        });
      }
    });

    socket.on('device-cameras', async ({ cameras }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session || !Array.isArray(cameras)) return;
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('device-cameras-update', {
          deviceId: socket.data.deviceId,
          cameras,
        });
      }
    });

    socket.on('camera-switched', async ({ cameraId }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session) return;
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('camera-active-update', {
          deviceId: socket.data.deviceId,
          cameraId,
        });
      }
    });

    socket.on('switch-camera', async ({ deviceId, cameraId }: any) => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      const device = session && session.devices.get(deviceId);
      if (device && cameraId) {
        io.to(device.socketId).emit('switch-camera', { cameraId });
      }
    });

    socket.on('device-volume', async ({ deviceId, volume }: any) => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      const device = session && deviceId ? session.devices.get(deviceId) : null;
      if (device && typeof volume === 'number' && Number.isFinite(volume)) {
        io.to(device.socketId).emit('device-volume', { volume: Math.max(0, Math.min(1, volume)) });
      }
    });

    socket.on('request-quality', async ({ deviceId, quality }: any) => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      const device = session && session.devices.get(deviceId);
      if (device && quality) {
        io.to(device.socketId).emit('request-quality', { quality });
      }
    });

    socket.on('quality-changed', async ({ quality }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session) return;
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('quality-changed', {
          deviceId: socket.data.deviceId,
          quality,
        });
      }
    });

    socket.on('remove-device', async ({ deviceId }: any) => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
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

      destroySession(io, sessionId);
      logger.info('Session ended by host', { sessionId });
    });

    // ===== Audio broadcast: server-authoritative playback state machine =====

    socket.on('start-playing', async ({ trackId, duration }: any = {}, callback: any) => {
      // Always ack — a silent return leaves the client awaiting forever
      if (socket.data.role !== 'host') {
        return callback?.({ error: 'Host authorization required' });
      }
      const session = await getSession(socket.data.sessionId);
      const meta = session && trackId ? uploads.get(trackId) : null;
      if (!session || !meta || meta.sessionId !== session.id) {
        return callback?.({ error: 'Track not uploaded for this session' });
      }

      const pb = session.playback;
      pb.trackId = meta.id;
      pb.trackName = meta.name;
      pb.trackUrl = `${BASE_URL}/api/audio/${meta.id}`;
      // Host reports the real duration so seek clamping and REST snapshots work
      pb.duration =
        typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0;
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

    socket.on('pause-playing', async (...args: any[]) => {
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      if (socket.data.role !== 'host') {
        return callback?.({ error: 'Host authorization required' });
      }
      const session = await getSession(socket.data.sessionId);
      const pb = session && session.playback;
      if (!session || !pb.trackId || !pb.isPlaying) return;

      const position = Math.min(
        pb.position + (Date.now() - (pb.startedAt || 0)) / 1000,
        pb.duration || Infinity,
      );
      setPlaybackState(session, { isPlaying: false, position });
      await setSession(session.id, session);

      io.to(`session:${session.id}`).emit('playback-paused', {
        position,
        serverTimestamp: Date.now(),
      });
      callback?.({ success: true });
    });

    socket.on('resume-playing', async (...args: any[]) => {
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      if (socket.data.role !== 'host') {
        return callback?.({ error: 'Host authorization required' });
      }
      const session = await getSession(socket.data.sessionId);
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

    socket.on('seek-playing', async (...args: any[]) => {
      const { position } = args[0] || {};
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      if (socket.data.role !== 'host') {
        return callback?.({ error: 'Host authorization required' });
      }
      const session = await getSession(socket.data.sessionId);
      const pb = session && session.playback;
      if (!session || !pb.trackId || typeof position !== 'number' || !Number.isFinite(position)) {
        return callback?.({ error: 'Invalid seek position' });
      }

      // Preserve playing state across a seek; clamp into the known duration
      const maxPos = pb.duration > 0 ? pb.duration : Number.MAX_SAFE_INTEGER;
      const clamped = Math.max(0, Math.min(position, maxPos));
      setPlaybackState(session, { isPlaying: pb.isPlaying, position: clamped });
      await setSession(session.id, session);

      io.to(`session:${session.id}`).emit('playback-seeked', {
        position: clamped,
        serverTimestamp: Date.now(),
      });
      callback?.({ success: true });
    });

    socket.on('track-ended', async () => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      const pb = session && session.playback;
      if (!session || !pb.trackId) return;

      setPlaybackState(session, {
        isPlaying: false,
        position: pb.duration > 0 ? pb.duration : pb.position,
      });
      await setSession(session.id, session);

      io.to(`session:${session.id}`).emit('playback-paused', {
        position: pb.duration > 0 ? pb.duration : pb.position,
        serverTimestamp: Date.now(),
      });
    });

    // NTP-style clock sync so participants can correct server/client clock skew
    socket.on('clock-sync', (callback: any) => {
      if (typeof callback === 'function') callback(Date.now());
    });

    // ===== Push-to-talk transport =====

    socket.on('push-to-talk-start', async () => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      if (session) io.to(`session:${session.id}`).emit('host-mic-active');
    });

    socket.on('push-to-talk-stop', async () => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      if (!session) return;
      io.to(`session:${session.id}`).emit('host-mic-inactive');
      io.to(`session:${session.id}`).emit('ptt-stopped');
    });

    socket.on('ptt-offer', async ({ deviceId, offer }: any) => {
      if (socket.data.role !== 'host') return;
      const session = await getSession(socket.data.sessionId);
      const device = session && deviceId ? session.devices.get(deviceId) : null;
      if (device && offer) {
        io.to(device.socketId).emit('ptt-offer', { offer });
      }
    });

    socket.on('ptt-answer', async ({ answer }: any) => {
      if (socket.data.role === 'host') return; // answers come only from devices
      const session = await getSession(socket.data.sessionId);
      if (session && session.hostSocketId && answer) {
        io.to(session.hostSocketId).emit('ptt-answer', { deviceId: socket.data.deviceId, answer });
      }
    });

    socket.on('ptt-ice-candidate', async ({ targetDeviceId, candidate }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session || !candidate) return;
      if (socket.data.role === 'host') {
        const device = targetDeviceId ? session.devices.get(targetDeviceId) : null;
        if (device) {
          io.to(device.socketId).emit('ptt-ice-candidate', { candidate, fromDeviceId: 'host' });
        }
      } else if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('ptt-ice-candidate', {
          candidate,
          fromDeviceId: socket.data.deviceId,
        });
      }
    });

    socket.on('device-ping', async ({ deviceId }: any) => {
      const session = await getSession(socket.data.sessionId);
      if (!session) return;

      const device = session.devices.get(deviceId);
      if (device) {
        device.lastPing = Date.now();
        await setSession(session.id, session);
      }
    });

    socket.on('disconnect', async (reason: string) => {
      const { sessionId, deviceId, role } = socket.data;
      logger.info('Client disconnected', { socketId: socket.id, sessionId, deviceId, role, reason });

      if (!sessionId || !deviceId) return;

      const session = await getSession(sessionId);
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

        await setSession(sessionId, session);
      }
    });
  });
}
