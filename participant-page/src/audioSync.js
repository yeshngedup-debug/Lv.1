export class AudioSync {
  constructor(audioElement, socket, options = {}) {
    this.audio = audioElement;
    this.socket = socket;
    // Estimated (server - client) clock offset in ms, measured via clock-sync.
    // Without it, serverTimestamp math drifts by the full skew between devices.
    this.clockOffsetMs = Number.isFinite(options.clockOffsetMs) ? options.clockOffsetMs : 0;
    this.audioContext = null;
    this.gainNode = null;
    this.isSyncing = false;
    this.driftThreshold = 0.05; // seconds (tighter threshold)
    this.syncInterval = null;
    this.lastServerTimestamp = 0;
    this.lastKnownPosition = 0;
    this.offsetEstimate = 0;
    this.offsetSamples = [];

    this.init();
  }

  init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);

    // Resume AudioContext on first user interaction
    const resumeAudioContext = () => {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      document.removeEventListener('click', resumeAudioContext);
      document.removeEventListener('keydown', resumeAudioContext);
    };
    document.addEventListener('click', resumeAudioContext);
    document.addEventListener('keydown', resumeAudioContext);

    this.socket.on('playback-started', (data) => this.handlePlaybackStarted(data));
    this.socket.on('playback-paused', (data) => this.handlePlaybackPaused(data));
    this.socket.on('playback-resumed', (data) => this.handlePlaybackResumed(data));
    this.socket.on('playback-seeked', (data) => this.handlePlaybackSeeked(data));
  }

  setClockOffset(ms) {
    this.clockOffsetMs = Number.isFinite(ms) ? ms : 0;
  }

  // Server-clock-adjusted "now"
  _now() {
    return Date.now() + this.clockOffsetMs;
  }

  handlePlaybackStarted(data) {
    if (!data || !data.trackUrl) return;
    const { trackUrl, serverTimestamp } = data;
    this.lastServerTimestamp = serverTimestamp;
    this.lastKnownPosition = data.position || 0;

    const elapsed = (this._now() - serverTimestamp) / 1000;
    this.offsetEstimate = elapsed;
    this.offsetSamples = [elapsed];

    this.audio.src = trackUrl;
    // serverTimestamp marks when {position} became current; mirror the
    // resumed/seeked math so all three handlers share one semantic
    this.audio.currentTime = Math.max(0, this.lastKnownPosition + elapsed);
    this.audio.play().catch(err => console.error('Error playing audio:', err));

    this.startSync();
    this.updateMediaSession();
  }

  handlePlaybackPaused(data) {
    this.audio.pause();
    this.stopSync();
  }

  handlePlaybackResumed(data) {
    const { serverTimestamp, position } = data;
    this.lastServerTimestamp = serverTimestamp;
    this.lastKnownPosition = position;

    const elapsed = (this._now() - serverTimestamp) / 1000;
    const targetTime = position + elapsed;

    this.audio.currentTime = Math.max(0, targetTime);
    this.audio.play().catch(err => console.error('Error playing audio:', err));

    this.startSync();
  }

  handlePlaybackSeeked(data) {
    const { serverTimestamp, position } = data;
    this.lastServerTimestamp = serverTimestamp;
    this.lastKnownPosition = position;

    const elapsed = (this._now() - serverTimestamp) / 1000;
    const targetTime = position + elapsed;

    this.audio.currentTime = Math.max(0, targetTime);
    // Don't restart sync if already syncing
    if (!this.isSyncing) {
      this.startSync();
    }
  }

  startSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    // High-frequency sync (every 2 seconds) for better drift compensation
    this.syncInterval = setInterval(() => this.correctDrift(), 2000);

    // Initial correction
    this.correctDrift();
  }

  stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.isSyncing = false;
  }

  correctDrift() {
    if (!this.audio || this.audio.paused || this.audio.ended) return;

    const now = this._now();
    const elapsed = (now - this.lastServerTimestamp) / 1000;
    const expectedPosition = this.lastKnownPosition + elapsed;
    const actualPosition = this.audio.currentTime;
    const drift = actualPosition - expectedPosition;

    // Update offset estimate with exponential smoothing
    this.offsetSamples.push(elapsed);
    if (this.offsetSamples.length > 10) this.offsetSamples.shift();
    this.offsetEstimate = this.offsetSamples.reduce((a, b) => a + b, 0) / this.offsetSamples.length;

    if (Math.abs(drift) > this.driftThreshold) {
      console.log(`Audio drift detected: ${drift.toFixed(3)}s, correcting...`);
      this.audio.currentTime = Math.max(0, expectedPosition);
    }
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.audio.src) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Synced Playback',
      artist: 'Iris SYNCD'
    });
  }

  setVolume(value) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  destroy() {
    this.stopSync();
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.socket.off('playback-started');
    this.socket.off('playback-paused');
    this.socket.off('playback-resumed');
    this.socket.off('playback-seeked');
  }
}