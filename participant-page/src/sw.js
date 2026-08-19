import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('New content available. Reload?')) {
      updateSW();
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
  onRegistrationError(registrationError) {
    console.error('SW registration error:', registrationError);
  }
});

// Media Session API for background audio
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    const audio = document.querySelector('audio');
    if (audio) audio.play();
  });

  navigator.mediaSession.setActionHandler('pause', () => {
    const audio = document.querySelector('audio');
    if (audio) audio.pause();
  });

  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    const audio = document.querySelector('audio');
    if (audio) {
      const skipTime = details.seekOffset || 10;
      audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
    }
  });

  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    const audio = document.querySelector('audio');
    if (audio) {
      const skipTime = details.seekOffset || 10;
      audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
    }
  });

  navigator.mediaSession.setActionHandler('seekto', (details) => {
    const audio = document.querySelector('audio');
    if (audio && details.fastSeek && 'fastSeek' in audio) {
      audio.fastSeek(details.seekTime);
    } else if (audio) {
      audio.currentTime = details.seekTime;
    }
  });

  navigator.mediaSession.setActionHandler('stop', () => {
    const audio = document.querySelector('audio');
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  });
}

// Wake Lock API for keeping screen on during camera streaming
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock acquired');
    }
  } catch (err) {
    console.log('Wake Lock not available:', err.message);
  }
}

async function releaseWakeLock() {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
    console.log('Wake Lock released');
  }
}

// Handle visibility change for wake lock
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    // Re-acquire wake lock if needed
    const video = document.querySelector('video');
    if (video && video.srcObject) {
      await requestWakeLock();
    }
  }
});

// Export for use in components
export { requestWakeLock, releaseWakeLock };
