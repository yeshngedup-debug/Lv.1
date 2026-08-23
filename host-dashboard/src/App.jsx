import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { Equalizer } from './components/Equalizer';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'];

// ============ Memoized Camera Feed Tile (module level: stable identity = real memoization) ============
const CameraFeedTile = React.memo(function CameraFeedTile({
  device,
  registerVideoElement,
  onClick,
  onListenToggle,
  listening,
  showListenLabel = false,
  motionAlert,
  motionEnabled,
  cameras = [],
  activeCameraId,
  onDismissMotion,
  onCycleCamera
}) {
  const camIdx = activeCameraId
    ? Math.max(0, cameras.findIndex(c => c.id === activeCameraId))
    : 0;
  const currentCamLabel = camIdx >= 0 && cameras[camIdx] ? cameras[camIdx].label : 'Default';

  return (
    <div className="camera-feed-box" onClick={() => onClick(device)}>
      <video
        ref={(el) => registerVideoElement(device.id, el, 'grid')}
        autoPlay
        playsInline
        muted
        className="camera-feed-video"
        onError={() => console.error(`Video error for ${device.nickname}`)}
      />

      <div className="tile-top-bar">
        {cameras.length > 1 && (
          onCycleCamera ? (
            <span
              className="camera-switch-indicator"
              title="Click to cycle cameras"
              onClick={(e) => { e.stopPropagation(); onCycleCamera(device, 1); }}
            >
              {onDismissMotion !== undefined && <span className="cam-label">{currentCamLabel}</span>}
              <ChevronRight size={12} style={{ color: 'var(--accent-magenta)' }} />
            </span>
          ) : (
            <span className="tile-cam-count">CAM {camIdx + 1}/{cameras.length}</span>
          )
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onListenToggle(device.id); }}
          className={`tile-mic-btn ${listening ? 'on' : ''}`}
          title={listening ? 'Mute device microphone' : 'Listen to device microphone'}
        >
          {listening ? <Volume2 size={14} /> : <MicOff size={14} />}
        </button>
        {showListenLabel && listening && (
          <span className="tile-listen-label">LISTEN</span>
        )}
      </div>

      <div className="tile-expand-hint">
        <Expand size={16} />
        <span>Zoom</span>
      </div>

      <div className="camera-feed-bar">
        <span style={{ fontWeight: 600 }}>{device.nickname}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {motionAlert && (
            <div className="motion-alert-badge" onClick={(e) => { e.stopPropagation(); onDismissMotion(device.id); }} title="Click to dismiss">
              <Bell size={12} />
              <span>MOTION</span>
            </div>
          )}
          {motionEnabled && (
            <button
              onClick={(e) => { e.stopPropagation(); onDismissMotion(device.id); }}
              className="tile-motion-btn"
              title="Motion detection enabled"
            >
              <Eye size={12} />
            </button>
          )}
          <span className="live-indicator-pill"><span className="live-dot-pulse" />LIVE</span>
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.device.id === next.device.id &&
  prev.listening === next.listening &&
  prev.showListenLabel === next.showListenLabel &&
  prev.motionAlert === next.motionAlert &&
  prev.motionEnabled === next.motionEnabled &&
  prev.activeCameraId === next.activeCameraId &&
  prev.cameras.length === next.cameras.length
);

function App() {
  const [socket, setSocket] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const [joinUrl, setJoinUrl] = useState('');
  const [devices, setDevices] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isTalking, setIsTalking] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [deviceCamerasMap, setDeviceCamerasMap] = useState({});
  const [listeningDevices, setListeningDevices] = useState(() => new Set());
  const [localVolumes, setLocalVolumes] = useState({});

  const audioRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const listeningSetRef = useRef(new Set());
  const volumesMapRef = useRef({});
  const peerConnectionsRef = useRef(new Map());
  const videoElementsRef = useRef(new Map());
  const reconnectTimeoutRef = useRef(null);

  const connectSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const newSocket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('connected');
      setReconnecting(false);
      setError(null);
      
      // Rejoin session if we had one
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        newSocket.emit('rejoin-session', { sessionId: currentSessionId }, (response) => {
          if (response.error) {
            console.error('Rejoin failed:', response.error);
            setSessionId(null);
            setDevices([]);
            setJoinUrl('');
          } else {
            setDevices(response.devices || []);
            setIsPlaying(response.isPlaying || false);
            setCurrentTrack(response.currentTrack || null);
            setPlaybackPosition(response.playbackPosition || 0);
          }
        });
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      setConnectionStatus('disconnected');
      if (reason === 'io server disconnect') {
        setReconnecting(true);
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('Connection error:', err);
      setConnectionStatus('error');
      setError('Failed to connect to server');
    });

    newSocket.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnection attempt ${attempt}`);
      setReconnecting(true);
    });

    newSocket.on('reconnect', (attempt) => {
      console.log(`Reconnected after ${attempt} attempts`);
      setReconnecting(false);
      setConnectionStatus('connected');
    });

    setSocket(newSocket);
    return newSocket;
  }, [SOCKET_URL]);

  useEffect(() => {
    const newSocket = connectSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      newSocket.disconnect();
    };
  }, [connectSocket]);

  useEffect(() => {
    if (!socket) return;

    socket.on('device-joined', (data) => {
      setDevices(prev => {
        if (prev.some(d => d.id === data.deviceId)) return prev;
        return [...prev, { ...data, id: data.deviceId }];
      });
      setError(null);
    });

    socket.on('device-left', ({ deviceId }) => {
      setDevices(prev => prev.filter(d => d.id !== deviceId));
      setDeviceCamerasMap(prev => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
      const pc = peerConnectionsRef.current.get(deviceId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(deviceId);
      }
      const videoEl = videoElementsRef.current.get(deviceId);
      if (videoEl) {
        videoEl.srcObject = null;
        videoElementsRef.current.delete(deviceId);
      }
    });

    socket.on('device-cameras-update', ({ deviceId, cameras }) => {
      console.log('Camera list for', deviceId, ':', cameras);
      setDeviceCamerasMap(prev => ({
        ...prev,
        [deviceId]: { cameras, activeCameraId: prev[deviceId]?.activeCameraId || null }
      }));
    });

    socket.on('camera-active-update', ({ deviceId, cameraId }) => {
      setDeviceCamerasMap(prev => ({
        ...prev,
        [deviceId]: { ...(prev[deviceId] || { cameras: [] }), activeCameraId: cameraId }
      }));
    });

    socket.on('quality-changed', ({ quality, deviceId }) => {
      console.log('Quality changed for device', deviceId, ':', quality);
      setCurrentQuality(quality);
    });

socket.on('camera-offer', async ({ deviceId, offer }) => {
      console.log('Received camera offer from', deviceId, 'Offer type:', offer?.type);
      console.log('Offer SDP preview:', offer?.sdp?.substring(0, 200));

      const existingPc = peerConnectionsRef.current.get(deviceId);
      if (existingPc) {
        existingPc.close();
        peerConnectionsRef.current.delete(deviceId);
      }

      const pc = new PeerConnectionManager(socket, deviceId, false);
      peerConnectionsRef.current.set(deviceId, pc);

      // Set up the remote stream handler BEFORE handling the offer
      pc.onRemoteStream = (stream) => {
        console.log('Received remote stream from', deviceId, 'Tracks:', stream.getTracks().length, 'Track details:', stream.getTracks().map(t => ({ kind: t.kind, id: t.id, enabled: t.enabled, readyState: t.readyState, muted: t.muted })));
        // Update all video elements for this deviceId
        const types = ['preview', 'grid', 'fullscreen'];
        types.forEach(type => {
          const key = `${deviceId}-${type}`;
          const videoElement = videoElementsRef.current.get(key);
          if (videoElement) {
            console.log('Setting video source for', key);
            const videoTracks = stream.getVideoTracks();
            if (videoTracks.length > 0) {
              console.log('Video track found:', videoTracks[0].label, 'settings:', videoTracks[0].getSettings());
            } else {
              console.warn('No video tracks found in remote stream!');
            }
            videoElement.srcObject = stream;
            videoElement.play().catch(err => console.error('Video play failed for', key, ':', err));
          }
        });
      };

      // Also handle connection state changes
      pc.onConnectionStateChange = (state) => {
        console.log(`Connection state for ${deviceId}:`, state);
      };

      try {
        const answer = await pc.handleOffer(offer);
        console.log('Created answer for', deviceId, 'Answer type:', pc.pc.localDescription?.type);
        socket.emit('camera-answer', { deviceId, answer: pc.pc.localDescription });
        console.log('Camera offer handled successfully for', deviceId);
      } catch (err) {
        console.error('Failed to handle camera offer:', err);
      }
    });

    socket.on('ice-candidate', async ({ candidate, fromDeviceId }) => {
      const pc = peerConnectionsRef.current.get(fromDeviceId);
      if (pc) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.error('Failed to add ICE candidate:', err);
        }
      }
    });

    socket.on('session-ended', () => {
      alert('Session has ended');
      setSessionId(null);
      setDevices([]);
      setJoinUrl('');
      setIsPlaying(false);
      setCurrentTrack(null);
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      videoElementsRef.current.clear();
    });

    socket.on('playback-started', (data) => {
      setIsPlaying(true);
      setCurrentTrack(data);
    });

    socket.on('playback-paused', ({ position }) => {
      setIsPlaying(false);
      setPlaybackPosition(position);
    });

    socket.on('playback-resumed', (data) => {
      setIsPlaying(true);
      setPlaybackPosition(data.position);
    });

    socket.on('playback-seeked', ({ position }) => {
      setPlaybackPosition(position);
    });

    socket.on('volume-changed', ({ volume }) => {
      if (audioRef.current) {
        audioRef.current.volume = volume;
      }
    });

    return () => {
      socket.off('device-joined');
      socket.off('device-left');
      socket.off('camera-offer');
      socket.off('ice-candidate');
      socket.off('session-ended');
      socket.off('playback-started');
      socket.off('playback-paused');
      socket.off('playback-resumed');
      socket.off('playback-seeked');
      socket.off('volume-changed');
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      videoElementsRef.current.clear();
    };
  }, [socket]);

  const createSession = () => {
    if (!socket) return;
    setError(null);

    socket.emit('create-session', (response) => {
      if (response.error) {
        setError(response.error);
        return;
      }
      setSessionId(response.sessionId);
      setJoinUrl(response.joinUrl);
    });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
      setError('Invalid file type. Please choose an audio file (MP3, WAV, OGG, MP4, WebM).');
      return;
    }

    if (file.size > MAX_AUDIO_SIZE) {
      setError('File too large. Maximum size is 50MB.');
      return;
    }

    setError(null);
    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
  };

  const startPlayback = () => {
    if (!socket || !audioUrl || !audioFile) return;
    setError(null);

    socket.emit('start-playing', {
      trackUrl: audioUrl,
      trackName: audioFile.name,
      duration: audioRef.current?.duration || 0
    });

    setIsPlaying(true);
  };

  const pausePlayback = () => {
    if (!socket) return;
    socket.emit('pause-playing');
    setIsPlaying(false);
  };

  const resumePlayback = () => {
    if (!socket) return;
    socket.emit('resume-playing');
    setIsPlaying(true);
  };

  const handleSeek = (e) => {
    const position = parseFloat(e.target.value);
    setPlaybackPosition(position);
    if (socket) {
      socket.emit('seek-playing', { position });
    }
  };

  const startPushToTalk = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;
      audioContextRef.current = new AudioContext();
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(audioContextRef.current.destination);

      setIsTalking(true);
      if (socket) {
        socket.emit('push-to-talk-start');
      }
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Could not access microphone. Please ensure microphone permissions are granted.');
    }
  };

  const stopPushToTalk = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    sourceRef.current = null;

    setIsTalking(false);
    if (socket) {
      socket.emit('push-to-talk-stop');
    }
  };

  const removeDevice = (deviceId) => {
    if (!socket) return;
    socket.emit('remove-device', { deviceId });
  };

  const endSession = () => {
    if (!socket) return;
    socket.emit('end-session');
    setSessionId(null);
    setDevices([]);
    setJoinUrl('');
    setIsPlaying(false);
    setCurrentTrack(null);
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    videoElementsRef.current.clear();
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const registerVideoElement = useCallback((deviceId, element, type = 'preview') => {
    if (element) {
      const key = `${deviceId}-${type}`;
      videoElementsRef.current.set(key, element);
      const pc = peerConnectionsRef.current.get(deviceId);
      if (pc && pc.remoteStream) {
        element.srcObject = pc.remoteStream;
        const playPromise = element.play();
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            console.warn('Video play failed for', key, '- may need user interaction:', err);
          });
        }
      }
    }
    // Unregistration is unnecessary: elements are GC'd on unmount
  }, []);

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [fullscreenDevice, setFullscreenDevice] = useState(null);
  const [deviceVolumes, setDeviceVolumes] = useState({});
  const [activePage, setActivePage] = useState('overview');
  const [currentQuality, setCurrentQuality] = useState('high');
  const [networkStats, setNetworkStats] = useState({});
  const [ptzState, setPtzState] = useState({ pan: 0, tilt: 0, zoom: 1 });
  const [motionAlerts, setMotionAlerts] = useState({});
  const [motionDetectionEnabled, setMotionDetectionEnabled] = useState(true);
  const multiCamVideoRefs = useRef({});
  const statsIntervalRef = useRef(null);
  const motionCanvasRefs = useRef({});

  useEffect(() => {
    listeningSetRef.current = listeningDevices;
    volumesMapRef.current = localVolumes;
    videoElementsRef.current.forEach((el, key) => {
      const dashIdx = key.lastIndexOf('-');
      if (dashIdx === -1) return;
      const type = key.slice(dashIdx + 1);
      if (!['preview', 'grid', 'fullscreen'].includes(type)) return;
      const deviceId = key.slice(0, dashIdx);
      const listening = listeningDevices.has(deviceId);
      el.muted = !listening;
      el.volume = localVolumes[deviceId] ?? 1;
      if (listening) {
        el.play().catch(() => {});
      }
    });
  }, [listeningDevices, localVolumes]);

  const toggleListen = useCallback((deviceId) => {
    setListeningDevices(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  }, []);

  const setLocalVolume = (deviceId, volume) => {
    setLocalVolumes(prev => ({ ...prev, [deviceId]: volume }));
  };

  const switchDeviceCamera = (deviceId, cameraId) => {
    if (!socket || !cameraId) return;
    socket.emit('switch-camera', { deviceId, cameraId });
    setDeviceCamerasMap(prev => ({
      ...prev,
      [deviceId]: { ...(prev[deviceId] || { cameras: [] }), activeCameraId: cameraId }
    }));
  };

  const cycleDeviceCamera = useCallback((device, direction) => {
    const entry = deviceCamerasMap[device.id];
    if (!entry || !entry.cameras || entry.cameras.length < 2) return;
    const ids = entry.cameras.map(c => c.id);
    const currentIdx = Math.max(0, ids.indexOf(entry.activeCameraId));
    const nextIdx = (currentIdx + direction + ids.length) % ids.length;
    switchDeviceCamera(device.id, ids[nextIdx]);
  }, [deviceCamerasMap]);

  const dismissMotionAlert = useCallback((deviceId) => {
    setMotionAlerts(prev => {
      const next = { ...prev };
      next[deviceId] = false;
      return next;
    });
  }, []);

  // ============ Network Stats Collection ============
  const fetchNetworkStats = useCallback(async () => {
    if (!fullscreenDevice) return;
    const pc = peerConnectionsRef.current.get(fullscreenDevice.id);
    if (!pc || !pc.pc) return;

    try {
      const stats = await pc.pc.getStats();
      let bitrate = 0;
      let rtt = 0;
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitter = 0;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          bitrate = (report.bytesReceived || 0) * 8 / 1000; // kbps
          packetsLost = report.packetsLost || 0;
          packetsReceived = report.packetsReceived || 0;
          jitter = report.jitter || 0;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = (report.currentRoundTripTime || 0) * 1000; // ms
        }
      });

      const lossRate = packetsReceived > 0 ? (packetsLost / (packetsReceived + packetsLost)) * 100 : 0;

      setNetworkStats(prev => ({
        ...prev,
        [fullscreenDevice.id]: {
          bitrate: Math.round(bitrate),
          rtt: Math.round(rtt),
          lossRate: Number(lossRate.toFixed(2)),
          jitter: Number((jitter * 1000).toFixed(1)), // ms
          timestamp: Date.now()
        }
      }));
    } catch (err) {
      console.warn('Failed to fetch network stats:', err);
    }
  }, [fullscreenDevice]);

  // Start/stop stats collection when fullscreen opens/closes
  useEffect(() => {
    if (fullscreenDevice) {
      fetchNetworkStats();
      statsIntervalRef.current = setInterval(fetchNetworkStats, 2000);
    }
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [fullscreenDevice, fetchNetworkStats]);

  const handleDeviceVolumeChange = (deviceId, volume) => {
    setDeviceVolumes(prev => ({ ...prev, [deviceId]: volume }));
    if (socket) {
      socket.emit('update-device-volume', { deviceId, volume });
    }
  };

  const closeFullscreen = () => setFullscreenDevice(null);

  if (!sessionId) {
    return (
      <GridlineShell
        sessionId={null}
        connectionStatus={connectionStatus}
        reconnecting={reconnecting}
      >
        <div className="create-session-container">
          <div className="landing-icon-wrapper">
            <Radio size={32} />
          </div>
          <h2>Create a New Session</h2>
          <p>Initialize a high-performance audio & camera sync hub for connected devices</p>
          {error && <div className="error-message">{error}</div>}
          <button onClick={createSession} className="gridline-btn-primary" disabled={reconnecting} style={{ padding: '0.85rem 2.2rem', fontSize: '1.05rem', borderRadius: '12px' }}>
            <Sparkles size={18} />
            <span>{reconnecting ? 'Connecting...' : 'Launch Gridline Hub'}</span>
          </button>
        </div>
      </GridlineShell>
    );
  }

  const cameraDevices = useMemo(() => devices.filter(d => (d.role === 'camera' || (d.role === 'device' && d.isCameraEnabled)) && d.isCameraEnabled !== false), [devices]);
  const speakerDevices = useMemo(() => devices.filter(d => (d.role === 'speaker' || (d.role === 'device' && d.isSpeakerEnabled)) && d.isSpeakerEnabled !== false), [devices]);

  const DeviceCard = React.memo(({ device, isSelected, onClick, onVolumeChange, volume }) => {
    const isCamera = device.role === 'camera' || (device.role === 'device' && device.isCameraEnabled);
    const isSpeaker = device.role === 'speaker' || (device.role === 'device' && device.isSpeakerEnabled);
    const isCombined = device.role === 'device';
    const pc = peerConnectionsRef.current.get(device.id);
    const isConnected = pc?.connectionState === 'connected';

    return (
      <article
        className={`device-card ${isSelected ? 'selected' : ''} ${isCombined ? 'combined' : (isCamera ? 'camera' : 'speaker')}`}
        onClick={onClick}
        data-device-id={device.id}
      >
        <div className="device-card-header">
          <div className="device-avatar">
            {isCombined ? (
              <span className="combined-avatar">
                <Video size={16} />
                <Speaker size={12} />
              </span>
            ) : isCamera ? (
              <Video size={18} />
            ) : (
              <Speaker size={18} />
            )}
          </div>
          <div className="device-meta">
            <h3 className="device-name">{device.nickname}</h3>
            <div className="device-status">
              <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
              <span className={`device-role-badge ${isCombined ? 'combined' : (isCamera ? 'camera' : 'speaker')}`}>
                {isCombined ? 'Device' : (isCamera ? 'Camera' : 'Speaker')}
              </span>
            </div>
          </div>
        </div>

{isSelected && isCamera && (
          <div className="device-preview">
            <video
              ref={(el) => registerVideoElement(device.id, el, 'preview')}
              autoPlay
              playsInline
              muted
              className="preview-video"
            />
            <div className="preview-overlay">
              <span className="live-dot"></span>
              LIVE
            </div>
          </div>
        )}

        {isSelected ? (
          <div className="device-controls">
            {isCamera && (
              <div className="control-group">
                <label>Volume</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume ?? 1}
                  onChange={(e) => onVolumeChange(device.id, parseFloat(e.target.value))}
                  className="volume-slider"
                />
                <span className="volume-value">{Math.round((volume ?? 1) * 100)}%</span>
              </div>
            )}
            {isSpeaker && (
              <div className="control-group">
                <label>Volume</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume ?? 1}
                  onChange={(e) => onVolumeChange(device.id, parseFloat(e.target.value))}
                  className="volume-slider"
                />
                <span className="volume-value">{Math.round((volume ?? 1) * 100)}%</span>
              </div>
            )}
            <div className="device-actions">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isCamera) setFullscreenDevice(device);
                }}
                className="btn btn-secondary btn-sm"
                disabled={!isCamera}
              >
                <Maximize2 size={14} />
                Fullscreen
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeDevice(device.id);
                }}
                className="btn btn-danger btn-sm"
              >
                Remove
              </button>
            </div>
          </div>
) : (
  isCamera && (
    <div className="device-quick-actions">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setFullscreenDevice(device);
        }}
        className="btn btn-primary btn-sm"
        title="View camera fullscreen"
      >
        <Video size={14} />
        <span>View Camera</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMotionDetectionEnabled(prev => !prev);
        }}
        className={`btn btn-${motionDetectionEnabled ? 'success' : 'secondary'} btn-sm`}
        title={motionDetectionEnabled ? 'Disable motion detection' : 'Enable motion detection'}
      >
        {motionDetectionEnabled ? <Eye size={14} /> : <BellOff size={14} />}
        <span>{motionDetectionEnabled ? 'Motion ON' : 'Motion OFF'}</span>
      </button>
    </div>
  )
)}
      </article>
    );
  });

  const renderFullscreenModal = () => {
    if (!fullscreenDevice) return null;
    const pc = peerConnectionsRef.current.get(fullscreenDevice.id);
    const camEntry = deviceCamerasMap[fullscreenDevice.id] || { cameras: [], activeCameraId: null };
const cameras = camEntry.cameras || [];
    const listening = listeningDevices.has(fullscreenDevice.id);
    const vol = localVolumes[fullscreenDevice.id] ?? 1;

    return (
      <div className="fullscreen-modal" onClick={closeFullscreen}>
        <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
          <header className="fullscreen-header">
            <div className="fullscreen-title-group">
              <span className={`status-dot-inline ${pc?.connectionState === 'connected' ? 'online' : 'offline'}`} />
              <h2>{fullscreenDevice.nickname}</h2>
              {cameras.length > 0 && (
                <span className="camera-count-badge">
                  {cameras.length} CAMERA{cameras.length > 1 ? 'S' : ''} LIVE
                </span>
              )}
            </div>
            <button onClick={closeFullscreen} className="close-btn" aria-label="Close fullscreen">
              <Maximize2 size={24} style={{ transform: 'rotate(45deg)' }} />
            </button>
          </header>

          <div className="fullscreen-video-wrapper">
            {cameras.length === 1 ? (
              // Single camera - show large
              <video
                ref={(el) => registerVideoElement(fullscreenDevice.id, el, 'fullscreen')}
                autoPlay
                playsInline
                muted
                className="fullscreen-video"
              />
            ) : (
              // Multiple cameras - show grid
              <div className="multi-camera-grid">
                {cameras.map((cam, idx) => (
                  <div key={cam.id || idx} className="multi-cam-tile">
                    <video
                      ref={(el) => {
                        const trackKey = `${fullscreenDevice.id}-${cam.id}-fullscreen`;
                        multiCamVideoRefs.current[trackKey] = el;
                        registerVideoElement(trackKey, el, 'fullscreen');
                      }}
                      autoPlay
                      playsInline
                      muted
                      className="multi-cam-video"
                    />
                    <div className="multi-cam-label">{cam.label || `Camera ${idx + 1}`}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="fullscreen-overlay">
              <div className="fullscreen-controls">
                <button
                  onClick={() => toggleListen(fullscreenDevice.id)}
                  className={`listen-toggle ${listening ? 'on' : ''}`}
                  title={listening ? 'Mute device microphone' : 'Listen to device microphone'}
                >
                  {listening ? <Volume2 size={15} /> : <MicOff size={15} />}
                  <span>{listening ? 'Listening' : 'Listen'}</span>
                </button>

                {networkStats[fullscreenDevice.id] && (
                  <div className="network-stats-panel">
                    <div className="stat-item">
                      <Activity size={14} style={{ color: 'var(--accent-cyan)' }} />
                      <span>{networkStats[fullscreenDevice.id].bitrate} kbps</span>
                    </div>
                    <div className="stat-item">
                      <Gauge size={14} style={{ color: 'var(--accent-green)' }} />
                      <span>{networkStats[fullscreenDevice.id].rtt} ms</span>
                    </div>
                    <div className="stat-item">
                      <Wifi size={14} style={{ color: networkStats[fullscreenDevice.id].lossRate > 1 ? 'var(--accent-rose)' : 'var(--accent-amber)' }} />
                      <span>{networkStats[fullscreenDevice.id].lossRate}% loss</span>
                    </div>
                    <div className="stat-item">
                      <AlertTriangle size={14} style={{ color: 'var(--accent-amber)' }} />
                      <span>{networkStats[fullscreenDevice.id].jitter} ms jitter</span>
                    </div>
                  </div>
                )}

<div className="control-group">
                    <label>Quality</label>
                    <select
                      value={currentQuality}
                      onChange={(e) => {
                        const quality = e.target.value;
                        setCurrentQuality(quality);
                        if (socket) {
                          socket.emit('request-quality', { quality });
                        }
                      }}
                      className="quality-select"
                    >
                      <option value="low">Low (640x360 @10fps)</option>
                      <option value="medium">Medium (1280x720 @20fps)</option>
                      <option value="high">High (1920x1080 @30fps)</option>
                    </select>
                  </div>

                  <div className="control-group ptz-controls">
                    <label>PTZ</label>
                    <div className="ptz-buttons">
                      <button
                        onClick={() => setPtzState(prev => ({ ...prev, tilt: prev.tilt - 10 }))}
                        className="ptz-btn"
                        title="Tilt Up"
                      >
                        <Move size={16} style={{ transform: 'rotate(-90deg)' }} />
                      </button>
                      <div className="ptz-center">
                        <button
                          onClick={() => setPtzState(prev => ({ ...prev, pan: prev.pan - 10 }))}
                          className="ptz-btn"
                          title="Pan Left"
                        >
                          <Move size={16} style={{ transform: 'rotate(180deg)' }} />
                        </button>
                        <button
                          onClick={() => setPtzState({ pan: 0, tilt: 0, zoom: 1 })}
                          className="ptz-btn ptz-center-btn"
                          title="Reset PTZ"
                        >
                          <RotateCw size={14} />
                        </button>
                        <button
                          onClick={() => setPtzState(prev => ({ ...prev, pan: prev.pan + 10 }))}
                          className="ptz-btn"
                          title="Pan Right"
                        >
                          <Move size={16} />
                        </button>
                      </div>
                      <button
                        onClick={() => setPtzState(prev => ({ ...prev, tilt: prev.tilt + 10 }))}
                        className="ptz-btn"
                        title="Tilt Down"
                      >
                        <Move size={16} style={{ transform: 'rotate(90deg)' }} />
                      </button>
                      <div className="ptz-zoom">
                        <button
                          onClick={() => setPtzState(prev => ({ ...prev, zoom: Math.min(prev.zoom + 0.2, 5) }))}
                          className="ptz-btn"
                          title="Zoom In"
                        >
                          <ZoomIn size={16} />
                        </button>
                        <span className="zoom-level">{ptzState.zoom.toFixed(1)}x</span>
                        <button
                          onClick={() => setPtzState(prev => ({ ...prev, zoom: Math.max(prev.zoom - 0.2, 0.5) }))}
                          className="ptz-btn"
                          title="Zoom Out"
                        >
                          <ZoomOut size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="control-group">
                  <label>Vol</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={vol}
                    onChange={(e) => setLocalVolume(fullscreenDevice.id, parseFloat(e.target.value))}
                    className="volume-slider"
                  />
                  <span className="volume-value">{Math.round(vol * 100)}%</span>
                </div>

                <span className="connection-badge">
                  {pc?.connectionState === 'connected' ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>

          {cameras.length > 0 && (
            <footer className="camera-strip">
              {cameras.map((cam, idx) => {
                const isActive = camEntry.activeCameraId ? camEntry.activeCameraId === cam.id : idx === 0;
                return (
                  <button
                    key={cam.id || idx}
                    className={`camera-chip ${isActive ? 'active' : ''}`}
                    onClick={() => switchDeviceCamera(fullscreenDevice.id, cam.id)}
                    title={cam.label}
                  >
                    <Video size={13} />
                    <span className="chip-index">{idx + 1}</span>
                    <span className="chip-label">{cam.label || `Camera ${idx + 1}`}</span>
                    {isActive && <span className="chip-active-dot" />}
                  </button>
                );
              })}
            </footer>
          )}
        </div>
      </div>
    );
  };

  return (
    <GridlineShell
      sessionId={sessionId}
      connectionStatus={connectionStatus}
      reconnecting={reconnecting}
      devicesCount={devices.length}
      camerasCount={cameraDevices.length}
      speakersCount={speakerDevices.length}
      onEndSession={endSession}
      joinUrl={joinUrl}
      activeTab={activePage}
      onTabChange={setActivePage}
    >
      {error && <div className="error-banner" onClick={() => setError(null)}>{error} (click to dismiss)</div>}
      {renderFullscreenModal()}

      <div className="gridline-dashboard-grid">
        {activePage === 'overview' && (
          <>
            {/* Metric Overview Row */}
            <div className="col-span-12">
              <div className="metrics-row">
                <div className="metric-box">
                  <span className="metric-label">FLEET DEVICES</span>
                  <span className="metric-value">{devices.length}</span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">LIVE CAMERAS</span>
                  <span className="metric-value" style={{ color: 'var(--accent-magenta)' }}>{cameraDevices.length}</span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">ACTIVE SPEAKERS</span>
                  <span className="metric-value" style={{ color: 'var(--accent-cyan)' }}>{speakerDevices.length}</span>
                </div>
              </div>
            </div>

            {/* Invite & QR Panel */}
            <div className="col-span-4">
              <div className="gridline-card">
                <div className="card-header">
                  <div className="card-title-group">
                    <Radio size={18} className="card-title-icon" />
                    <h3 className="card-title">Invite Participants</h3>
                  </div>
                  <span className="card-badge">QR ACCESS</span>
                </div>

                <div className="qr-flex-wrapper">
                  <div className="qr-box">
                    <QRCodeSVG value={joinUrl} size={150} />
                  </div>
                  <div className="invite-info-col">
                    <div className="url-input-group">
                      <input type="text" value={joinUrl} readOnly />
                      <button
                        onClick={() => navigator.clipboard.writeText(joinUrl)}
                        className="gridline-btn-ghost btn-sm"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      Scan QR code or copy session URL to connect speakers & cameras.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Camera Grid (Overview page) */}
            {activePage === 'overview' && cameraDevices.length > 0 && (
              <div className="col-span-12">
                <div className="gridline-card">
                  <div className="card-header">
                    <div className="card-title-group">
                      <Video size={18} className="card-title-icon" style={{ color: 'var(--accent-magenta)' }} />
                      <h3 className="card-title">Live Camera Grid</h3>
                    </div>
                    <span className="card-badge">{cameraDevices.length} CAMERAS LIVE</span>
                  </div>
                  <div className="camera-feeds-grid">
                    {cameraDevices.map(device => {
                      const camEntry = deviceCamerasMap[device.id] || { cameras: [], activeCameraId: null };
                      return (
                        <CameraFeedTile
                          key={device.id}
                          device={device}
                          registerVideoElement={registerVideoElement}
                          onClick={setFullscreenDevice}
                          onListenToggle={toggleListen}
                          listening={listeningDevices.has(device.id)}
                          showListenLabel
                          motionAlert={!!motionAlerts[device.id]}
                          motionEnabled={motionDetectionEnabled}
                          cameras={camEntry.cameras}
                          activeCameraId={camEntry.activeCameraId}
                          onDismissMotion={dismissMotionAlert}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============ AUDIO BROADCAST PAGE ============ */}
        {activePage === 'audio' && (
          <>
            <div className="col-span-12">
              <div className="page-heading">
                <Music size={22} />
                <div>
                  <h2>Audio Broadcast</h2>
                  <p>Upload tracks, control playback and talk to your fleet live.</p>
                </div>
              </div>
            </div>

            <div className="col-span-12">
              <div className="gridline-card">
                <div className="card-header">
                  <div className="card-title-group">
                    <Music size={18} className="card-title-icon" />
                    <h3 className="card-title">Broadcast & Push-to-Talk</h3>
                  </div>
                  <span className="card-badge">LIVE AUDIO CONTROL</span>
                </div>

            <div className="audio-upload">
              <label className="file-upload">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <span className="gridline-btn-ghost">
                  <Upload size={14} />
                  {audioFile ? audioFile.name : 'Choose Audio File'}
                </span>
              </label>
              {audioFile && (
                <span className="file-info">
                  {audioFile.type} · {formatFileSize(audioFile.size)}
                </span>
              )}
            </div>

            {audioUrl && (
              <div className="playback-controls">
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onTimeUpdate={(e) => setPlaybackPosition(e.target.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.target.duration)}
                  onError={() => setError('Error loading audio file')}
                />

                <Equalizer active={isPlaying} bars={36} />

                <div className="progress-bar">
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    value={playbackPosition}
                    onChange={handleSeek}
                    step="0.1"
                    disabled={!duration}
                    className="seek-slider"
                  />
                  <span className="time">
                    {formatTime(playbackPosition)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="playback-buttons">
                  {isPlaying ? (
                    <button onClick={pausePlayback} className="gridline-btn-primary" disabled={reconnecting}>
                      <Pause size={14} />
                      <span>Pause</span>
                    </button>
                  ) : (
                    <button onClick={startPlayback} className="gridline-btn-primary" disabled={reconnecting || !audioUrl}>
                      <Play size={14} />
                      <span>Play Track</span>
                    </button>
                  )}
                  <button onClick={resumePlayback} className="gridline-btn-ghost" disabled={reconnecting || isPlaying}>
                    <RotateCcw size={14} />
                    <span>Resume</span>
                  </button>
                </div>
              </div>
            )}

            <div className="push-to-talk" style={{ marginTop: '1rem' }}>
              <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Host Push-to-Talk Broadcast</h4>
              <button
                onMouseDown={startPushToTalk}
                onMouseUp={stopPushToTalk}
                onMouseLeave={stopPushToTalk}
                onTouchStart={startPushToTalk}
                onTouchEnd={stopPushToTalk}
                className={`btn btn-talk ${isTalking ? 'active' : ''}`}
                disabled={reconnecting}
              >
                <Mic size={16} />
                <span>{isTalking ? 'Broadcasting Voice...' : 'Hold to Talk to Fleet'}</span>
              </button>
            </div>
          </div>
            </div>
          </>
        )}

        {/* ============ CCTV GRID PAGE ============ */}
        {activePage === 'cctv' && (
          <>
            <div className="col-span-12">
              <div className="page-heading">
                <Video size={22} style={{ color: 'var(--accent-magenta)' }} />
                <div>
                  <h2>CCTV Camera Grid</h2>
                  <p>Monitor all live cameras, switch between camera sources, and zoom for detail.</p>
                </div>
              </div>
            </div>

            {cameraDevices.length === 0 ? (
              <div className="col-span-12">
                <div className="gridline-card empty-state" style={{ minHeight: '300px' }}>
                  <div className="empty-icon"><Video size={48} style={{ color: 'var(--text-tertiary)' }} /></div>
                  <p>No camera devices connected</p>
                  <p className="empty-hint">Connect cameras from participant devices to view them here</p>
                </div>
              </div>
            ) : (
              <div className="col-span-12">
                <div className="gridline-card">
                  <div className="card-header">
                    <div className="card-title-group">
                      <Video size={18} className="card-title-icon" style={{ color: 'var(--accent-magenta)' }} />
                      <h3 className="card-title">Live Camera Grid</h3>
                    </div>
                    <span className="card-badge">{cameraDevices.length} CAMERAS LIVE</span>
                  </div>
                  <div className="camera-feeds-grid">
                    {cameraDevices.map(device => {
                      const camEntry = deviceCamerasMap[device.id] || { cameras: [], activeCameraId: null };
                      return (
                        <CameraFeedTile
                          key={device.id}
                          device={device}
                          registerVideoElement={registerVideoElement}
                          onClick={setFullscreenDevice}
                          onListenToggle={toggleListen}
                          listening={listeningDevices.has(device.id)}
                          showListenLabel
                          cameras={camEntry.cameras}
                          activeCameraId={camEntry.activeCameraId}
                          onCycleCamera={cycleDeviceCamera}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============ DEVICE FLEET PAGE ============ */}
        {activePage === 'fleet' && (
          <>
            <div className="col-span-12">
              <div className="page-heading">
                <Users size={22} />
                <div>
                  <h2>Device Fleet</h2>
                  <p>Manage connected speakers & cameras, adjust volumes and monitor status.</p>
                </div>
              </div>
            </div>

            {/* Invite & QR Panel */}
            <div className="col-span-4">
              <div className="gridline-card">
                <div className="card-header">
                  <div className="card-title-group">
                    <Radio size={18} className="card-title-icon" />
                    <h3 className="card-title">Invite Participants</h3>
                  </div>
                  <span className="card-badge">QR ACCESS</span>
                </div>

                <div className="qr-flex-wrapper">
                  <div className="qr-box">
                    <QRCodeSVG value={joinUrl} size={150} />
                  </div>
                  <div className="invite-info-col">
                    <div className="url-input-group">
                      <input type="text" value={joinUrl} readOnly />
                      <button
                        onClick={() => navigator.clipboard.writeText(joinUrl)}
                        className="gridline-btn-ghost btn-sm"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      Scan QR code or copy session URL to connect speakers & cameras.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Device Fleet */}
            <div className="col-span-8">
              <div className="gridline-card">
                <div className="card-header">
                  <div className="card-title-group">
                    <Monitor size={18} className="card-title-icon" />
                    <h3 className="card-title">Connected Device Fleet</h3>
                  </div>
                  <span className="card-badge">{devices.length} ONLINE</span>
                </div>

                {devices.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon"><Monitor size={28} /></div>
                    <p>No devices connected yet</p>
                    <p className="empty-hint">Share the QR code or link to invite participants</p>
                  </div>
                ) : (
                  <div className="device-fleet-grid">
                    {devices.map(device => (
                      <DeviceCard
                        key={device.id}
                        device={device}
                        isSelected={selectedDevice?.id === device.id}
                        onClick={() => setSelectedDevice(selectedDevice?.id === device.id ? null : device)}
                        onVolumeChange={handleDeviceVolumeChange}
                        volume={deviceVolumes[device.id]}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Fleet Camera Wall */}
            {cameraDevices.length > 0 && (
              <div className="col-span-12">
                <div className="gridline-card">
                  <div className="card-header">
                    <div className="card-title-group">
                      <Video size={18} className="card-title-icon" style={{ color: 'var(--accent-magenta)' }} />
                      <h3 className="card-title">Fleet Camera Wall</h3>
                    </div>
                    <span className="card-badge">{cameraDevices.length} CAMERAS LIVE</span>
                  </div>
                  <div className="camera-feeds-grid">
                    {cameraDevices.map(device => {
                      const camEntry = deviceCamerasMap[device.id] || { cameras: [], activeCameraId: null };
                      return (
                        <CameraFeedTile
                          key={device.id}
                          device={device}
                          registerVideoElement={registerVideoElement}
                          onClick={setFullscreenDevice}
                          onListenToggle={toggleListen}
                          listening={listeningDevices.has(device.id)}
                          cameras={camEntry.cameras}
                          activeCameraId={camEntry.activeCameraId}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

    </GridlineShell>
  );
}

export default App;