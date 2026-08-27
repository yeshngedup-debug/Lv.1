import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { SESSION_TIMEOUT } from './config.ts';
import { logger } from './logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Uploaded track storage (audio broadcast)
export const UPLOAD_DIR = join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // must stay in sync with host MAX_AUDIO_SIZE

export interface UploadMeta {
  id: string;
  sessionId: string;
  filePath: string;
  name: string;
  mimeType: string;
  size: number;
}

export const uploads = new Map<string, UploadMeta>(); // fileId -> meta
export const sessionFiles = new Map<string, Set<string>>(); // sessionId -> Set<fileId>

export function destroyUploadedFiles(sessionId: string): void {
  const ids = sessionFiles.get(sessionId);
  if (!ids) return;
  for (const id of ids) {
    const meta = uploads.get(id);
    if (!meta) continue;
    // Synchronous so the registry is always consistent with disk afterwards
    try {
      fs.unlinkSync(meta.filePath);
    } catch (err: any) {
      logger.warn('Failed to delete uploaded track', { fileId: id, error: err.message });
    }
    uploads.delete(id);
  }
  sessionFiles.delete(sessionId);
}

// Remove upload files left behind by process restarts (registry is in-memory only)
export function cleanOrphanedUploads(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(UPLOAD_DIR);
  } catch {
    return;
  }
  const known = new Set(Array.from(uploads.values(), (u) => basename(u.filePath)));
  const cutoff = Date.now() - SESSION_TIMEOUT;
  for (const name of entries) {
    if (known.has(name)) continue;
    const filePath = join(UPLOAD_DIR, name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch (err: any) {
      logger.warn('Failed to clean orphaned upload', { file: name, error: err.message });
    }
  }
}
