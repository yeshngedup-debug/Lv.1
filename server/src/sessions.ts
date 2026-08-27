import { v4 as uuidv4 } from 'uuid';
import type { Server } from 'socket.io';
import { SESSION_TIMEOUT } from './config.ts';
import { logger } from './logger.ts';
import { redisState } from './redis.ts';

export interface PlaybackState {
  trackId: string | null;
  trackName: string | null;
  trackUrl: string | null;
  duration: number;
  isPlaying: boolean;
  position: number;
  startedAt: number | null;
}

export interface DeviceRecord {
  id: string;
  socketId: string;
  role: string;
  nickname: string;
  joinedAt: number;
  isLive: boolean;
  volume: number;
  lastPing: number;
  isCameraEnabled: boolean;
  isSpeakerEnabled: boolean;
}

export class Session {
  id: string;
  // Secret held only by the host client; authorizes privileged HTTP routes
  hostToken: string;
  hostSocketId: string | null;
  devices: Map<string, DeviceRecord>;
  createdAt: number;
  expiresAt: number;
  currentTrack: any;
  isPlaying: boolean;
  playbackPosition: number;
  // Server-authoritative playback state machine (audio broadcast)
  playback: PlaybackState;

  constructor(id: string) {
    this.id = id;
    this.hostToken = uuidv4();
    this.hostSocketId = null;
    this.devices = new Map();
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + SESSION_TIMEOUT;
    this.currentTrack = null;
    this.isPlaying = false;
    this.playbackPosition = 0;
    this.playback = {
      trackId: null,
      trackName: null,
      trackUrl: null,
      duration: 0,
      isPlaying: false,
      position: 0, // position at last state change
      startedAt: null, // Date.now() of last transition to playing
    };
  }

  addDevice(
    deviceId: string,
    socketId: string,
    role: string,
    nickname: string,
    isCameraEnabled?: boolean,
    isSpeakerEnabled?: boolean,
  ): void {
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

  removeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  getDevicesByRole(role: string): DeviceRecord[] {
    return Array.from(this.devices.values()).filter((d) => d.role === role);
  }

  isExpired(): boolean {
    return Date.now() > this.expiresAt;
  }
}

// Redis-backed persistence for horizontal scaling
export class SessionStore {
  localCache: Map<string, any>;

  constructor() {
    this.localCache = new Map();
  }

  async get(sessionId: string): Promise<any | null> {
    if (redisState.ready && redisState.client) {
      try {
        const data = await redisState.client.get(`session:${sessionId}`);
        if (data) return JSON.parse(data);
      } catch (err: any) {
        logger.warn('Redis get failed, falling back to local cache', { error: err.message });
      }
    }
    return this.localCache.get(sessionId) || null;
  }

  async set(sessionId: string, session: any): Promise<void> {
    if (redisState.ready && redisState.client) {
      try {
        await redisState.client.setEx(
          `session:${sessionId}`,
          Math.ceil(SESSION_TIMEOUT / 1000),
          JSON.stringify(session),
        );
      } catch (err: any) {
        logger.warn('Redis set failed', { error: err.message });
      }
    }
    this.localCache.set(sessionId, session);
  }

  async delete(sessionId: string): Promise<void> {
    if (redisState.ready && redisState.client) {
      try {
        await redisState.client.del(`session:${sessionId}`);
      } catch (err: any) {
        logger.warn('Redis delete failed', { error: err.message });
      }
    }
    this.localCache.delete(sessionId);
  }

  async has(sessionId: string): Promise<boolean> {
    if (redisState.ready && redisState.client) {
      try {
        return (await redisState.client.exists(`session:${sessionId}`)) === 1;
      } catch (err: any) {
        logger.warn('Redis exists failed', { error: err.message });
      }
    }
    return this.localCache.has(sessionId);
  }
}

const sessionStore = new SessionStore();

// L1 identity cache: the in-process Map is authoritative for object identity.
// Single-instance reads never pay Redis round-trips; Redis extends consistency
// across instances (a read miss materializes the session into L1).
export const sessions = new Map<string, Session>();

export async function getSession(sessionId: string): Promise<Session | null> {
  const local = sessions.get(sessionId);
  if (local) return local;

  if (redisState.ready) {
    const data = await sessionStore.get(sessionId);
    if (data) {
      const session = new Session(data.id);
      Object.assign(session, data);
      session.devices = new Map(Object.entries(data.devices || {}));
      sessions.set(sessionId, session);
      return session;
    }
  }
  return null;
}

export async function setSession(sessionId: string, session: Session): Promise<void> {
  if (redisState.ready) {
    const sessionToSave = { ...session, devices: Object.fromEntries(session.devices) };
    await sessionStore.set(sessionId, sessionToSave);
  }
  sessions.set(sessionId, session);
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (redisState.ready) {
    await sessionStore.delete(sessionId);
  }
  sessions.delete(sessionId);
}

export async function hasSession(sessionId: string): Promise<boolean> {
  if (sessions.has(sessionId)) return true;
  if (redisState.ready) {
    return await sessionStore.has(sessionId);
  }
  return false;
}

// Union of L1 and Redis session ids, for the expiry/stale sweeps
export async function listSessionIds(): Promise<string[]> {
  const ids = new Set<string>(sessions.keys());
  if (redisState.ready && redisState.client) {
    try {
      for await (const key of redisState.client.scanIterator({
        MATCH: 'session:*',
        COUNT: 100,
      })) {
        ids.add(String(key).slice('session:'.length));
      }
    } catch (err: any) {
      logger.warn('Redis scan failed, sweeping local sessions only', { error: err.message });
    }
  }
  return Array.from(ids);
}

export function getPlaybackSnapshot(session: Session) {
  const pb = session.playback;
  if (!pb || !pb.trackId) return null;
  const position = pb.isPlaying
    ? Math.min(pb.position + (Date.now() - (pb.startedAt || 0)) / 1000, pb.duration || Infinity)
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

export function setPlaybackState(session: Session, { isPlaying, position }: { isPlaying: boolean; position: number }): void {
  const pb = session.playback;
  pb.isPlaying = isPlaying;
  pb.position = position;
  pb.startedAt = isPlaying ? Date.now() : null;
  session.isPlaying = isPlaying;
  session.playbackPosition = position;
}

// Single teardown path used by host end-session, host disconnect, and expiry.
// Imported lazily to avoid a sessions<->uploads cycle at module load.
export async function destroySession(io: Server, sessionId: string): Promise<void> {
  const { destroyUploadedFiles } = await import('./uploads.ts');
  io.to(`session:${sessionId}`).emit('session-ended');
  await deleteSession(sessionId);
  sessions.delete(sessionId);
  destroyUploadedFiles(sessionId);
}
