export class AudioSync {
  constructor(audioElement, socket) {
    this.audio = audioElement;
    this.socket = socket;
    this.audioContext = null;
    this.gainNode = null;
    this.isSyncing = false;
    this.driftThreshold = 0.1; // seconds
    this.syncInterval = null;

    this.init();
  }

  init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);

    this.socket.on('playback-started', (data) => {
      this.handlePlaybackStarted(data);
    });

    this.socket.on('playback-paused', (data) => {
      this.handlePlaybackPaused(data);
    });

    this.socket.on('playback-resumed', (data) => {
      this.handlePlaybackResumed(data);
    });

    this.socket.on('playback-seeked', (data) => {
      this.handlePlaybackSeeked(data);
    });
  }

  handlePlaybackStarted(data) {
    const { trackUrl, serverTimestamp } = data;
    const elapsed = (Date.now() - serverTimestamp) / 1000;

    this.audio.src = trackUrl;
    this.audio.currentTime = elapsed;
    this.audio.play().catch(err => {
      console.error('Error playing audio:', err);
    });

    this.startSync();
    this.updateMediaSession();
  }

  handlePlaybackPaused(data) {
    this.audio.pause();
    this.stopSync();
  }

  handlePlaybackResumed(data) {
    const { serverTimestamp, position } = data;
    const elapsed = (Date.now() - serverTimestamp) / 1000;
    this.audio.currentTime = position + elapsed;

    this.audio.play().catch(err => {
      console.error('Error playing audio:', err);
    });

    this.startSync();
  }

  handlePlaybackSeeked(data) {
    const { position, serverTimestamp } = data;
    const elapsed = (Date.now() - serverTimestamp) / 1000;
    this.audio.currentTime = position + elapsed;
  }

  startSync() {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      this.checkDrift();
    }, 5000);
  }

  stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  checkDrift() {
    if (!this.audio.paused) {
      const currentPos = this.audio.currentTime;
      const expectedPos = this.getExpectedPosition();
      const drift = Math.abs(currentPos - expectedPos);

      if (drift > this.driftThreshold) {
        this.correctDrift(expectedPos);
      }
    }
  }

  getExpectedPosition() {
    const lastSyncTime = this.lastSyncTime || 0;
    const lastSyncPosition = this.lastSyncPosition || 0;
    const elapsed = (Date.now() - lastSyncTime) / 1000;
    return lastSyncPosition + elapsed;
  }

  correctDrift(targetPosition) {
    const diff = targetPosition - this.audio.currentTime;

    if (Math.abs(diff) > 0.5) {
      this.audio.currentTime = targetPosition;
    } else {
      this.audio.playbackRate = 1 + (diff > 0 ? 0.1 : -0.1);
      setTimeout(() => {
        this.audio.playbackRate = 1;
      }, 1000);
    }
  }

  setVolume(volume) {
    if (this.gainNode) {
      this.gainNode.gain.value = volume;
    }
  }

  updateMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Iris SYNCD Audio',
        artist: 'Party Session',
        album: 'Live Stream'
      });
    }
  }

  destroy() {
    this.stopSync();
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
