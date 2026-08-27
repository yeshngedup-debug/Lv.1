import { create } from 'zustand';

/**
 * Session store — holds host session state
 */
export const useSessionStore = create((set) => ({
  sessionId: null,
  joinUrl: null,
  isHost: false,
  isJoined: false,
  reconnecting: false,
  connectionStatus: 'disconnected',

  setSession: (id, url) => set({ sessionId: id, joinUrl: url, isHost: true }),
  clearSession: () =>
    set({
      sessionId: null,
      joinUrl: null,
      isHost: false,
      isJoined: false,
      connectionStatus: 'disconnected',
    }),
  setJoined: (joined) => set({ isJoined: joined }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));

/**
 * Device fleet store — holds all connected devices
 */
export const useDeviceStore = create((set, get) => ({
  devices: new Map(),
  activeCameraId: null,
  listeningDeviceId: null,
  motionDetectionEnabled: true,
  fullscreenDeviceId: null,

  setDevices: (devices) => {
    const map = new Map();
    devices.forEach((d) => map.set(d.id, d));
    set({ devices: map });
  },

  updateDevice: (id, updates) => {
    const { devices } = get();
    const newDevices = new Map(devices);
    const existing = newDevices.get(id);
    if (existing) {
      newDevices.set(id, { ...existing, ...updates });
    }
    set({ devices: newDevices });
  },

  removeDevice: (id) => {
    const { devices } = get();
    const newDevices = new Map(devices);
    newDevices.delete(id);
    set({ devices: newDevices });
  },

  setActiveCamera: (deviceId) => set({ activeCameraId: deviceId }),
  setListening: (deviceId) => set({ listeningDeviceId: deviceId }),
  setMotionDetection: (enabled) => set({ motionDetectionEnabled: enabled }),
  setFullscreen: (deviceId) => set({ fullscreenDeviceId: deviceId }),
  clearFullscreen: () => set({ fullscreenDeviceId: null }),
}));

/**
 * Audio store — playback state and equalizer
 */
export const useAudioStore = create((set, get) => ({
  audioFile: null,
  audioUrl: null,
  isPlaying: false,
  isTalking: false,
  playbackPosition: 0,
  duration: 0,
  volume: 1.0,
  uploading: false,
  uploadedTrack: null,
  equalizerLevels: [],

  setAudioFile: (file) => set({ audioFile: file }),
  setAudioUrl: (url) => set({ audioUrl: url }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setTalking: (talking) => set({ isTalking: talking }),
  setPlaybackPosition: (pos) => set({ playbackPosition: pos }),
  setDuration: (dur) => set({ duration: dur }),
  setVolume: (vol) => set({ volume: vol }),
  setUploading: (uploading) => set({ uploading: uploading }),
  setUploadedTrack: (track) => set({ uploadedTrack: track }),
  setEqualizerLevels: (levels) => set({ equalizerLevels: levels }),
  reset: () =>
    set({
      audioFile: null,
      audioUrl: null,
      isPlaying: false,
      isTalking: false,
      playbackPosition: 0,
      duration: 0,
      uploading: false,
      uploadedTrack: null,
      equalizerLevels: [],
    }),
}));

/**
 * UI store — tab, modal, sidebar state
 */
export const useUIStore = create((set) => ({
  activeTab: 'overview',
  sidebarCollapsed: false,
  showJoinModal: false,
  showEndSessionConfirm: false,
  copied: false,
  showSettings: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setShowJoinModal: (show) => set({ showJoinModal: show }),
  setShowEndSessionConfirm: (show) => set({ showEndSessionConfirm: show }),
  setCopied: (copied) => set({ copied }),
  setShowSettings: (show) => set({ showSettings: show }),
}));
