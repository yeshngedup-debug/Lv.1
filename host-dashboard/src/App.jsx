import React, { useState, useEffect, useCallback, useRef, useTransition, useOptimistic, use } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import io from 'socket.io-client';
import {
  Radio, Video, Speaker, Music, Mic, MicOff, Copy, Check, Power,
  Maximize2, Trash2, Upload, Play, Pause, RotateCcw, Monitor, Sparkles,
  Volume2, ChevronLeft, ChevronRight, Expand, Users,
  Activity, Wifi, Gauge, AlertTriangle,
  Move, ZoomIn, ZoomOut, RotateCw, Bell, Eye, BellOff
} from 'lucide-react';
import { PeerConnectionManager } from './webrtc';
import { GridlineShell } from './components/GridlineShell';
import { AudioBroadcast } from './components/audio/AudioBroadcast';
import { CameraFeedTile } from './components/camera/CameraFeedTile';
import { DeviceCard } from './components/device/DeviceCard';
import { formatTime, formatFileSize } from './utils/audioUtils';
import { useSessionStore, useDeviceStore, useAudioStore, useUIStore } from '../shared/stores';
import '../shared/tailwind/gridline.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'];
const HOST_SESSION_KEY = 'iris-syncd-host-session';

function loadHostSession() {
  try {
    const raw = sessionStorage.getItem(HOST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveHostSession(session) {
  try {
    if (!session?.sessionId) {
      sessionStorage.removeItem(HOST_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(HOST_SESSION_KEY, JSON.stringify(session));
  } catch {}
}

function App() {
  // Transition for non-blocking updates
  const [isPending, startTransition] = useTransition();
  
  // Load persisted session
  useEffect(() => {
    const session = loadHostSession();
    if (session) {
      const [socket, setSocket] = useState(null);
      useSessionStore.getState().setSession(session.sessionId, session.joinUrl);
      // Note: socket connection handled elsewhere
    }
  }, []);

  const [socket, setSocket] = useState(null);
  const { sessionId, joinUrl, isHost, isJoined, connectionStatus, reconnecting } = useSessionStore();
  const { devices, setDevices, updateDevice, removeDevice, setActiveCamera, setListening, setMotionDetection, setFullscreen, clearFullscreen } = useDeviceStore();
  const { audioFile, audioUrl, isPlaying, isTalking, playbackPosition, duration, volume, uploading, uploadedTrack, equalizerLevels, setAudioFile, setAudioUrl, setIsPlaying, setTalking, setPlaybackPosition, setDuration, setVolume, setUploading, setUploadedTrack, setEqualizerLevels, reset } = useAudioStore();
  const { activeTab, sidebarCollapsed, showJoinModal, showEndSessionConfirm, copied, setActiveTab, toggleSidebar, setSidebarCollapsed, setShowJoinModal, setShowEndSessionConfirm, setCopied, setShowSettings } = useUIStore();

  // Optimistic updates for device volume changes
  const [optimisticDevices, setOptimisticDevices] = useOptimistic(
    devices,
    (currentDevices, updatedDevice) => {
      const newDevices = new Map(currentDevices);
      newDevices.set(updatedDevice.id, { ...currentDevices.get(updatedDevice.id), ...updatedDevice });
      return newDevices;
    }
  );

  // Socket connection with cleanup
  useEffect(() => {
    if (!isHost || socket) return;
    
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      withCredentials: false,
    });

    newSocket.on('connect', () => {
      useSessionStore.setConnectionStatus('connected');
      useSessionStore.setReconnecting(false);
    });

    newSocket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        useSessionStore.setConnectionStatus('disconnected');
      } else {
        useSessionStore.setReconnecting(true);
        useSessionStore.setConnectionStatus('reconnecting');
      }
    });

    newSocket.on('session_created', (data) => {
      useSessionStore.setSession(data.sessionId, data.joinUrl);
      saveHostSession({ sessionId: data.sessionId, joinUrl: data.joinUrl });
    });

    newSocket.on('device_joined', (device) => {
      updateDevice(device.id, { ...device, isConnected: true });
    });

    newSocket.on('device_left', (deviceId) => {
      removeDevice(deviceId);
    });

    newSocket.on('device_update', (deviceId, updates) => {
      updateDevice(deviceId, updates);
    });

    newSocket.on('audio_state', (state) => {
      setIsPlaying(state.isPlaying);
      setAudioUrl(state.audioUrl);
      setPlaybackPosition(state.position);
      setDuration(state.duration);
      setVolume(state.volume);
      setUploadedTrack(state.track);
    });

    newSocket.on('push_to_talk', (isTalking) => {
      setTalking(isTalking);
    });

    newSocket.on('equalizer_update', (levels) => {
      setEqualizerLevels(levels);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setSocket(null);
    };
  }, [isHost]);

  // React 19 use hook for reading socket state
  const socketReady = use(socket ? Promise.resolve(socket.connected) : Promise.resolve(false));

  // File upload handling
  const handleFileChange = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
      alert('Please upload a valid audio file (MP3, WAV, OGG, MP4, WEBM)');
      return;
    }
    
    if (file.size > MAX_AUDIO_SIZE) {
      alert('File size must be under 50MB');
      return;
    }
    
    setAudioFile(file);
    setUploading(true);
  }, []);

  const handleUploadAudio = useCallback(async () => {
    if (!audioFile) return;
    
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('sessionId', sessionId);
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const result = await response.json();
      setAudioUrl(result.url);
      setUploadedTrack({ name: audioFile.name, size: audioFile.size });
      setUploading(false);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
      setUploading(false);
    }
  }, [audioFile, sessionId, SOCKET_URL]);

  const handleSeek = useCallback((e) => {
    const pos = (e.target.value / 100) * duration;
    setPlaybackPosition(pos);
  }, [duration]);

  const handlePlayPause = useCallback(async () => {
    if (!audioUrl) return;
    
    if (isPlaying) {
      // Pause
      socket.emit('pause');
      setIsPlaying(false);
    } else {
      // Play
      socket.emit('play', { position: playbackPosition });
      setIsPlaying(true);
    }
  }, [audioUrl, isPlaying, playbackPosition, socket]);

  const handlePushToTalk = useCallback(() => {
    if (!socket) return;
    socket.emit('ptt_start');
    setTalking(true);
  }, [socket]);

  const handleStopPushToTalk = useCallback(() => {
    if (!socket) return;
    socket.emit('ptt_end');
    setTalking(false);
  }, [socket]);

  const handleEndSession = useCallback(() => {
    setShowEndSessionConfirm(true);
  }, []);

  const handleConfirmEndSession = useCallback(() => {
    if (socket) {
      socket.emit('end_session');
    }
    // Clear local state
    reset();
    useDeviceStore.getState().setDevices([]);
    useSessionStore.clearSession();
    sessionStorage.removeItem(HOST_SESSION_KEY);
    setShowEndSessionConfirm(false);
  }, [socket]);

  const handleCopyLink = useCallback(() => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [joinUrl]);

  const handleTabChange = useCallback((tab) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
    };
  }, [socket]);

  // Session persistence
  useEffect(() => {
    if (isHost && sessionId && joinUrl) {
      saveHostSession({ sessionId, joinUrl });
    }
  }, [isHost, sessionId, joinUrl]);

  if (!isHost) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text-primary mb-4">
            Iris SYNCD Host Required
          </h2>
          <p className="text-text-tertiary">
            This device is not configured as a host. Please run the host dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gridline-app min-h-[100dvh]">
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 bottom-0 w-64 bg-surface/95 backdrop-blur-xs 
                         border-r border-white/5 transition-transform duration-300 
                         z-40 ${sidebarCollapsed ? '-translate-x-full' : 'translate-x-0'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <h2 className="font-display text-xl text-text-primary">Iris SYNCD</h2>
            <button 
              onClick={toggleSidebar}
              className="p-2 rounded hover:bg-white/5"
              aria-label="Toggle sidebar"
            >
              <Video className="h-4 w-4" />
            </button>
          </div>
          
          <nav className="flex-1 overflow-y-auto py-4">
            <div className="px-4 space-y-1">
              <button
                onClick={() => handleTabChange('overview')}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-left 
                         ${activeTab === 'overview' ? 'bg-white/10' : 'hover:bg-white/5'} 
                         transition-all duration-200`}
              >
                <LayoutDashboard className="h-4 w-4 text-accent-violet" />
                <span className="font-medium text-text-primary">Overview</span>
              </button>
              
              <button
                onClick={() => handleTabChange('devices')}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-left 
                         ${activeTab === 'devices' ? 'bg-white/10' : 'hover:bg-white/5'} 
                         transition-all duration-200`}
              >
                <Users className="h-4 w-4 text-accent-cyan" />
                <span className="font-medium text-text-primary">Devices</span>
              </button>
              
              <button
                onClick={() => handleTabChange('audio')}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-left 
                         ${activeTab === 'audio' ? 'bg-white/10' : 'hover:bg-white/5'} 
                         transition-all duration-200`}
              >
                <Music className="h-4 w-4 text-accent-magenta" />
                <span className="font-medium text-text-primary">Audio</span>
              </button>
              
              <button
                onClick={() => handleTabChange('settings')}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-left 
                         ${activeTab === 'settings' ? 'bg-white/10' : 'hover:bg-white/5'} 
                         transition-all duration-200`}
              >
                <Gauge className="h-4 w-4 text-accent-green" />
                <span className="font-medium text-text-primary">Settings</span>
              </button>
            </div>
          </nav>
          
          <div className="px-4 py-4 border-t border-white/5">
            <button 
              onClick={handleEndSession}
              className="w-full gridline-btn-danger flex items-center justify-center gap-2"
            >
              <Power className="h-4 w-4" />
              <span>End Session</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 ml-[${sidebarCollapsed ? '0' : '64px']} min-h-[100dvh] 
                       overflow-x-hidden transition-margin-duration-300`}>
        {/* Status Strip */}
        <div className="flex items-center justify-between px-4 py-2 bg-surface/95 backdrop-blur-xs 
                     border-b border-white/5 z-30 text-xs font-mono tracking-wide uppercase">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded 
                     bg-accent-green/20 text-accent-green border border-accent-green/30">
              {connectionStatus === 'connected' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-green 
                           animate-[pulse-ring_1.8s_ease-in-out_infinite]" />
                  <span className="text-xs">CONNECTED</span>
                </>
              )}
              {connectionStatus === 'disconnected' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-rose" />
                  <span className="text-xs">DISCONNECTED</span>
                </>
              )}
              {connectionStatus === 'reconnecting' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-amber 
                           animate-[pulse_1.5s_ease-in-out_infinite]" />
                  <span className="text-xs">RECONNECTING</span>
                </>
              )}
            </span>
            
            <span className="mx-1 h-4 border-r border-white/5" />
            
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3 text-accent-cyan" />
              <span>{devices.size}</span>
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded 
                     bg-accent-violet/20 text-accent-violet border border-accent-violet/30">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-violet 
                           animate-[pulse-ring_1.8s_ease-in-out_infinite]" />
              <span className="text-xs">SESSION</span>
            </span>
          </div>
        </div>

        {/* QR Code Modal */}
        {showJoinModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-surface/95 backdrop-blur-xs rounded-2xl p-6 w-full max-w-md 
                         border border-white/5 shadow-2xl animate-[fade-in_0.2s_ease-out]">
              <div className="text-center mb-6">
                <h3 className="font-display text-xl text-text-primary mb-2">
                  Share Session
                </span>
                <p className="text-sm text-text-tertiary">
                  Scan QR code or share link to join
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="relative w-48 h-48 mx-auto">
                  <QRCodeSVG 
                    value={joinUrl || ''} 
                    size={180}
                    bgColor="transparent"
                    fgColor="var(--color-text-primary)"
                    qrcodeOptions={{
                      margin: 0,
                      width: 180,
                      height: 180
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2">
                      <Video className="h-5 w-5 text-accent-cyan" />
                      <Speaker className="h-5 w-5 text-accent-rose" />
                    </div>
                  </div>
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-text-tertiary mb-2">
                    Session ID: <span className="font-mono text-text-primary">{sessionId}</span>
                  </p>
                  <button 
                    onClick={handleCopyLink}
                    className="gridline-btn-ghost flex items-center justify-center gap-2"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-accent-green" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              <div className="flex justify-end">
                <button 
                  onClick={() => setShowJoinModal(false)}
                  className="p-2 rounded hover:bg-white/5 text-text-tertiary"
                >
                  <BellOff className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* End Session Confirm */}
        {showEndSessionConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-surface/95 backdrop-blur-xs rounded-2xl p-8 w-full max-w-md 
                     border border-white/5 shadow-2xl animate-[fade-in_0.2s_ease-out]">
              <div className="text-center">
                <h3 className="font-display text-xl text-text-primary mb-4">
                  End Session?
                </h3>
                <p className="text-sm text-text-tertiary mb-6">
                  All devices will be disconnected and the session will be terminated.
                </p>
                <div className="flex justify-center space-x-4">
                  <button 
                    onClick={() => setShowEndSessionConfirm(false)}
                    className="gridline-btn-ghost px-6 py-2"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleConfirmEndSession}
                    className="gridline-btn-danger px-6 py-2"
                  >
                    End Session
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <section className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'overview' && (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-text-primary mb-2">
                  Session Overview
                </p>
                <p className="text-sm text-text-tertiary">
                  Monitor and control your party AV fleet
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Connection Status Card */}
                <div className="gridline-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Wifi className="h-4 w-4 text-accent-cyan" />
                      <h3 className="font-medium text-text-primary">Connection</h3>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium 
                             ${connectionStatus === 'connected' ? 'bg-accent-green/20 text-accent-green' 
                                     : connectionStatus === 'disconnected' ? 'bg-accent-rose/20 text-accent-rose'
                                                                         : 'bg-accent-amber/20 text-accent-amber'}`}>
                      {connectionStatus.toUpperCase()}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-text-tertiary">
                      <span>Devices</span>
                      <span>{devices.size}</span>
                    </div>
                    <div className="flex justify-between text-sm text-text-tertiary">
                      <span>Latency</span>
                      <span>42ms</span>
                    </div>
                    <div className="flex justify-between text-sm text-text-tertiary">
                      <span>Bandwidth</span>
                      <span>2.3 Mbps</span>
                    </div>
                  </div>
                </div>
                
                {/* Audio Status Card */}
                <div className="gridline-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Music className="h-4 w-4 text-accent-magenta" />
                      <h3 className="font-medium text-text-primary">Audio</h3>
                    </div>
                    <span className="px-2 py-0.5 rounded text-xs font-medium 
                             bg-white/10">
                      {isPlaying ? 'PLAYING' : 'STOPPED'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {audioUrl ? (
                      <>
                        <div className="flex justify-between text-sm text-text-tertiary">
                          <span>Track</span>
                          <span className="line-clamp-1 max-w-xs">{uploadedTrack?.name || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between text-sm text-text-tertiary">
                          <span>Time</span>
                          <span>{formatTime(playbackPosition)} / {formatTime(duration)}</span>
                        </div>
                        <div className="w-full bg-white/5 rounded-h-full h-2.5 mt-2">
                          <div 
                            className={`h-full bg-gradient-to-r from-accent-violet to-accent-magenta rounded-h-full 
                                     transition-width duration-200 ease-out`} 
                            style={{ width: `${(playbackPosition / duration) * 100}%` }}
                          ></div>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-text-tertiary text-center py-4">
                        No track loaded
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <button 
                      onClick={handlePlayPause}
                      disabled={!audioUrl || uploading}
                      className="gridline-btn-ghost px-4 py-2"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="h-4 w-4" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                    
                    <button 
                      onClick={handleUploadAudio}
                      disabled={uploading || !audioFile}
                      className="ml-2 gridline-btn-ghost px-4 py-2"
                    >
                      {uploading ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-[spin-slow_3s_linear_infinite]" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          <span>Upload</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Controls Card */}
                <div className="gridline-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Maximize2 className="h-4 w-4 text-accent-green" />
                      <h3 className="font-medium text-text-primary">Controls</h3>
                    </div>
                    <button 
                      onClick={() => setShowJoinModal(true)}
                      className="gridline-btn-ghost px-4 py-2"
                    >
                      <Radio className="h-4 w-4" />
                      <span>Invite</span>
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Mic className="h-3 w-3 text-accent-rose" />
                      <span className="text-sm">Push-to-Talk</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Bell className="h-3 w-3 text-accent-amber" />
                      <span className="text-sm">Notifications</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Activity className="h-3 w-3 text-accent-violet" />
                      <span className="text-sm">Activity Log</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          
          {activeTab === 'devices' && (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-text-primary mb-2">
                  Device Fleet
                </p>
                <p className="text-sm text-text-tertiary">
                  Manage connected cameras and speakers
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-accent-cyan" />
                    <h3 className="font-medium text-text-primary">Connected Devices</h3>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-medium 
                           bg-white/10">
                    {devices.size} Active
                  </span>
                </div>
                
                {devices.size === 0 ? (
                  <div className="text-center py-12">
                    <Video className="h-12 w-12 text-text-tertiary mx-auto mb-4" />
                    <p className="text-sm text-text-tertiary">
                      No devices connected yet
                    </p>
                    <p className="text-xs text-text-tertiary">
                      Share the session QR code or link to invite devices
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[...devices.values()].map((device) => (
                      <DeviceCard 
                        key={device.id}
                        device={device}
                        isSelected={device.id === useDeviceStore.getState().fullscreenDeviceId}
                        onClick={() => {
                          // Toggle fullscreen or select device
                          const current = useDeviceStore.getState().fullscreenDeviceId;
                          if (current === device.id) {
                            clearFullscreen();
                          } else {
                            setFullscreen(device.id);
                          }
                        }}
                        onVolumeChange={(vol) => {
                          socket?.emit('device_volume', { deviceId: device.id, volume: vol });
                          updateDevice(device.id, { volume: vol });
                        }}
                        volume={device.volume || 0.8}
                        registerVideoElement={(id, el, type) => {
                          // Register for WebRTC
                          // PeerConnectionManager would handle this
                        }}
                        setFullscreenDevice={(id) => setFullscreen(id)}
                        removeDevice={() => {
                          socket?.emit('remove_device', { deviceId: device.id });
                          removeDevice(device.id);
                        }}
                        motionDetectionEnabled={device.motionDetectionEnabled ?? true}
                        setMotionDetectionEnabled={(enabled) => {
                          socket?.emit('motion_toggle', { deviceId: device.id, enabled });
                          updateDevice(device.id, { motionDetectionEnabled: enabled });
                        }}
                        peerConnectionsRef={{ current: null }} // Would be populated by WebRTC manager
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          
          {activeTab === 'audio' && (
            <AudioBroadcast 
              audioFile={audioFile}
              audioUrl={audioUrl}
              isPlaying={isPlaying}
              isTalking={isTalking}
              reconnecting={reconnecting}
              playbackPosition={playbackPosition}
              duration={duration}
              uploading={uploading}
              uploadedTrack={uploadedTrack}
              handleFileChange={handleFileChange}
              handleSeek={handleSeek}
              startPlayback={handlePlayPause}
              pausePlayback={handlePlayPause}
              resumePlayback={handlePlayPause}
              startPushToTalk={handlePushToTalk}
              stopPushToTalk={handleStopPushToTalk}
              formatTime={formatTime}
              formatFileSize={formatFileSize}
            />
          )}
          
          {activeTab === 'settings' && (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl text-text-primary mb-2">
                  Settings
                </p>
                <p className="text-sm text-text-tertiary">
                  Configure session preferences
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="gridline-card p-4">
                  <h3 className="font-medium text-text-primary mb-3">Session</h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={true}
                        className="h-3 w-3 text-accent-violet"
                      />
                      Auto-rejoin on refresh
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={false}
                        className="h-3 w-3 text-accent-violet"
                      />
                      Enable session recording
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={true}
                        className="h-3 w-3 text-accent-violet"
                      />
                      Show connection diagnostics
                    </label>
                  </div>
                </div>
                
                <div className="gridline-card p-4">
                  <h3 className="font-medium text-text-primary mb-3">Audio</h3>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium mb-1">
                      Playback Volume
                    </label>
                    <div className="flex items-center">
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={volume * 100}
                        onChange={(e) => {
                          const vol = e.target.value / 100;
                          setVolume(vol);
                          socket?.emit('volume_change', { volume: vol });
                        }}
                        className="w-full h-1.5 bg-white/5 rounded-h-full"
                      />
                      <Volume2 className="h-3 w-3 ml-2 text-accent-green" />
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                      {(volume * 100).toFixed(0)}%
                    </p>
                  </div>
                  
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-1">
                      Microphone Sensitivity
                    </label>
                    <div className="flex items-center">
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={70}
                        className="w-full h-1.5 bg-white/5 rounded-h-full"
                      />
                      <Mic className="h-3 w-3 ml-2 text-accent-rose" />
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                      70%
                    </p>
                  </div>
                </div>
                
                <div className="gridline-card p-4">
                  <h3 className="font-medium text-text-primary mb-3">Video</h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={true}
                        className="h-3 w-3 text-accent-cyan"
                      />
                      Enable HD video
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={false}
                        className="h-3 w-3 text-accent-cyan"
                      />
                      Enable low-light mode
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={true}
                        className="h-3 w-3 text-accent-cyan"
                      />
                      Enable noise reduction
                    </label>
                  </div>
                </div>
                
                <div className="gridline-card p-4">
                  <h3 className="font-medium text-text-primary mb-3">Performance</h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={true}
                        className="h-3 w-3 text-accent-green"
                      />
                      Adaptive quality
                    </label>
                    <p className="text-xs text-text-tertiary">
                      Automatically adjust quality based on network
                    </p>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input 
                        type="checkbox"
                        defaultChecked={false}
                        className="h-3 w-3 text-accent-green"
                      />
                      Prioritize audio sync
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;