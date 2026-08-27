import { randomInt, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Must run before any process.env read below. ESM import hoisting means
// doing this in index.ts would run it AFTER this module already evaluated.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static file paths for production
export const hostDashboardPath = join(__dirname, '../../host-dashboard/dist');
export const participantPagePath = join(__dirname, '../../participant-page/dist');

export const config = {
  port: parseInt(process.env.PORT) || 3001,
  baseUrl:
    process.env.RENDER_EXTERNAL_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 3001}`,
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 3600000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Empty = same-origin only; set CORS_ORIGIN explicitly (dev .env keeps '*')
  corsOrigin: process.env.CORS_ORIGIN || '',
  redisUrl: process.env.REDIS_URL || null,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  logLevel: process.env.LOG_LEVEL || 'info',
  staleCheckIntervalMs: parseInt(process.env.STALE_CHECK_INTERVAL_MS) || 30000,
  staleThresholdMs: parseInt(process.env.STALE_THRESHOLD_MS) || 30000,
};

export const BASE_URL = config.baseUrl;
export const SESSION_TIMEOUT = config.sessionTimeout;

// Session codes: 8 chars from an unambiguous alphabet (~40 bits).
// I/L/O/0/1 are excluded so codes stay readable from a QR fallback.
const SESSION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SESSION_ID_RE = /^[A-Z0-9]{8}$/;

export function generateSessionCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++)
    code += SESSION_CODE_ALPHABET[randomInt(SESSION_CODE_ALPHABET.length)];
  return code;
}

// Timing-safe comparison for host tokens (fixed-length UUID strings)
export function safeEqualToken(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Per-IP session-code brute-force suppression
export const joinFailures = new Map<string, { count: number; blockedUntil: number }>();
const JOIN_FAIL_LIMIT = parseInt(process.env.JOIN_FAIL_LIMIT) || 10;
const JOIN_BLOCK_MS = parseInt(process.env.JOIN_BLOCK_MS) || 5 * 60 * 1000;

export function joinBlocked(ip: string): boolean {
  const rec = joinFailures.get(ip);
  return !!rec && rec.blockedUntil > Date.now();
}

export function recordJoinFail(ip: string): void {
  const rec = joinFailures.get(ip) || { count: 0, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= JOIN_FAIL_LIMIT) {
    rec.blockedUntil = Date.now() + JOIN_BLOCK_MS;
    rec.count = 0;
  }
  joinFailures.set(ip, rec);
}

export function clearJoinFails(ip: string): void {
  joinFailures.delete(ip);
}

export function pruneJoinFailures(now: number): void {
  for (const [ip, rec] of joinFailures.entries()) {
    if (rec.count === 0 && rec.blockedUntil <= now) joinFailures.delete(ip);
  }
}
