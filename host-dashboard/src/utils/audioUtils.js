export const MAX_AUDIO_SIZE = 50 * 1024 * 1024;
export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
];

export function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function validateAudioFile(file) {
  if (!file) return { valid: false, error: 'No file selected' };
  if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please choose an audio file (MP3, WAV, OGG, MP4, WebM).',
    };
  }
  if (file.size > MAX_AUDIO_SIZE) {
    return { valid: false, error: 'File too large. Maximum size is 50MB.' };
  }
  return { valid: true };
}

export function createAudioUrl(file) {
  return URL.createObjectURL(file);
}

export function revokeAudioUrl(url) {
  URL.revokeObjectURL(url);
}
