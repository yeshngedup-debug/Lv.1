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
import { AudioBroadcast } from './components/audio/AudioBroadcast';
// FIXED: CameraFeedTile and DeviceCard were rendered but never imported,
// causing ReferenceError (white screen) as soon as any device joined
import { CameraFeedTile } from './components/camera/CameraFeedTile';
import { DeviceCard } from './components/device/DeviceCard';
import { formatTime, formatFileSize } from './utils/audioUtils';
import './App.css';

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
  } catch {
    // ignore quota / private-mode failures
  }
}

function clearHostSession() {
  try {
    sessionStorage.removeItem(HOST_SESSION_KEY);
  } catch {
    // ignore
  }
}

function App() {
  const [socket, setSocket] = useState(null);
  const restoredSession = useRef(loadHostSession()).current;
  const [sessionId, setSessionId] = useState(restoredSession?.sessionId || null);
  const sessionIdRef = useRef(restoredSession?.sessionId || null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const [joinUrl, setJoinUrl] = useState(restoredSession?.joinUrl || '');
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

  // Audio broadcast upload state
  const [uploading, setUploading] = useState(false);
  const [uploadedTrack, setUploadedTrack] = useState(null); // { id, name } on the server

  const audioRef = useRef(null);            // hidden <audio> for local host monitoring
  const hostTokenRef = useRef(null);        // authorizes privileged HTTP routes (upload)
  const mediaStreamRef = useRef(null);      // host mic during push-to-talk
  const pttPeersRef = useRef(new Map());    // deviceId -> PeerConnectionManager (PTT)
  const listeningSetRef = useRef(new Set());
  const volumesMapRef = useRef({});
  const peerConnectionsRef = useRef(new Map());
  const videoElementsRef = useRef(new Map());
  const reconnectTimeoutRef = useRef(null);

  // Stable mirror of devices for callbacks that must not go stale
  const devicesRef = useRef(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

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
            clearHostSession();
            setSessionId(null);
            setDevices([]);
            setJoinUrl('');
          } else {
            if (response.hostToken) hostTokenRef.current = response.hostToken;
            const restoredJoinUrl = response.joinUrl || `${window.location.origin}/join/${currentSessionId}`;
            setJoinUrl(restoredJoinUrl);
            saveHostSession({ sessionId: currentSessionId, joinUrl: restoredJoinUrl });
            setDevices(response.devices || []);
            // After a refresh the local File/blob is gone, so the host cannot
            // monitor or restart playback until the track is re-selected.
            // Show the server-side state, but keep controls in the paused state.
            setIsPlaying(false);
            setCurrentTrack(response.playback?.trackName
              ? { trackName: response.playback.trackName }
              : null);
            setPlaybackPosition(0);
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
            videoElement.play().catch(err => {
              if (err.name !== 'AbortError') {
                console.error('Video play failed for', key, ':', err);
              }
            });
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
      clearHostSession();
      setSessionId(null);
      setDevices([]);
      setJoinUrl('');
      setIsPlaying(false);
      setCurrentTrack(null);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      pttPeersRef.current.forEach(pc => pc.close());
      pttPeersRef.current.clear();
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
      // Per-peer PTT answer handlers + mic teardown
      pttPeersRef.current.forEach(pc => {
        if (pc._pttAnswerHandler) socket.off('ptt-answer', pc._pttAnswerHandler);
        pc.close();
      });
      pttPeersRef.current.clear();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
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
      if (response.hostToken) hostTokenRef.current = response.hostToken;
      saveHostSession({ sessionId: response.sessionId, joinUrl: response.joinUrl });
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

    if (!socket || !sessionIdRef.current) {
      setError('Not connected to a session');
      return;
    }

    setError(null);
    setAudioFile(file);
    setUploadedTrack(null);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Upload immediately so participants can fetch the real bytes over HTTP.
    // A blob: URL only exists inside this browser and is useless to the fleet.
    setUploading(true);
    fetch(`/api/sessions/${sessionIdRef.current}/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        ...(hostTokenRef.current ? { 'X-Host-Token': hostTokenRef.current } : {}),
      },
      body: file,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
        setUploadedTrack({ id: data.trackId, name: data.trackName });
      })
      .catch((err) => {
        console.error('Track upload failed:', err);
        setError(`Upload failed: ${err.message}`);
        setAudioFile(null);
        setAudioUrl(null);
      })
      .finally(() => setUploading(false));
  };

  const startPlayback = async () => {
    if (!socket || !uploadedTrack) return;
    setError(null);

    // Local monitoring plays instantly; the server broadcast syncs the fleet
    const el = audioRef.current;
    if (el && audioUrl) {
      el.currentTime = 0;
      try {
        await el.play();
      } catch (err) {
        console.warn('Local monitor playback blocked:', err);
      }
    }

    socket.emit('start-playing', {
      trackId: uploadedTrack.id,
      duration: audioRef.current && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : 0,
    });
    setIsPlaying(true);
  };

  const pausePlayback = () => {
    if (!socket || !uploadedTrack) return;
    if (audioRef.current) audioRef.current.pause();
    socket.emit('pause-playing');
    setIsPlaying(false);
  };

  const resumePlayback = () => {
    if (!socket || !uploadedTrack) return;
    if (audioRef.current && audioUrl) {
      audioRef.current.play().catch(err => console.warn('Local monitor playback blocked:', err));
    }
    socket.emit('resume-playing');
    setIsPlaying(true);
  };

  const handleSeek = (e) => {
    const position = parseFloat(e.target.value);
    if (!Number.isFinite(position)) return;
    setPlaybackPosition(position);
    const el = audioRef.current;
    if (el && Number.isFinite(el.duration)) {
      el.currentTime = Math.max(0, Math.min(position, el.duration));
    }
    if (socket && uploadedTrack) {
      socket.emit('seek-playing', { position });
    }
  };

  const handleTrackEnded = () => {
    setIsPlaying(false);
    if (socket && uploadedTrack) {
      socket.emit('track-ended');
    }
  };

  // ===== Push-to-talk: WebRTC mic broadcast to every connected device =====

  const closePttPeer = useCallback((pc) => {
    if (pc && pc._pttAnswerHandler && socket) {
      socket.off('ptt-answer', pc._pttAnswerHandler);
    }
    if (pc) pc.close();
  }, [socket]);

  const offerPttToDevice = async (deviceId, micStream) => {
    const existing = pttPeersRef.current.get(deviceId);
    if (existing) {
      closePttPeer(existing);
      pttPeersRef.current.delete(deviceId);
    }

    const pc = new PeerConnectionManager(socket, deviceId, true, { iceEventName: 'ptt-ice-candidate' });
    pc.addLocalStream(micStream);

    const offer = await pc.createOffer();
    if (!offer || pc._closed) {
      closePttPeer(pc);
      return;
    }
    socket.emit('ptt-offer', { deviceId, offer });

    const handler = ({ deviceId: fromId, answer }) => {
      if (fromId !== deviceId) return;
      pc.handleAnswer(answer).catch(err => console.error(`PTT answer failed for ${deviceId}:`, err));
    };
    pc._pttAnswerHandler = handler;
    socket.on('ptt-answer', handler);

    pttPeersRef.current.set(deviceId, pc);
  };

  const startPushToTalk = async () => {
    if (!socket) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;
      socket.emit('push-to-talk-start');

      // Offer the mic to every currently-connected device.
      // Devices joining mid-talk will not receive it until the next press.
      for (const device of devicesRef.current) {
        try {
          await offerPttToDevice(device.id, stream);
        } catch (err) {
          console.error(`PTT setup failed for ${device.id}:`, err);
        }
      }

      setIsTalking(true);
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

    pttPeersRef.current.forEach(pc => closePttPeer(pc));
    pttPeersRef.current.clear();

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
    stopPushToTalk();
    socket.emit('end-session');
    clearHostSession();
    setSessionId(null);
    setDevices([]);
    setJoinUrl('');
    setIsPlaying(false);
    setCurrentTrack(null);
    setUploadedTrack(null);
    setDuration(0);
    setPlaybackPosition(0);
    if (audioRef.current) audioRef.current.pause();
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    videoElementsRef.current.clear();
  };

  const registerVideoElement = useCallback((deviceId, element, type = 'preview') => {
    if (element) {
      const key = `${deviceId}-${type}`;
      videoElementsRef.current.set(key, element);
      const pc = peerConnectionsRef.current.get(deviceId);
      if (pc && pc.remoteStream && element.srcObject !== pc.remoteStream) {
        element.srcObject = pc.remoteStream;
        const playPromise = element.play();
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            if (err.name !== 'AbortError') {
              console.warn('Video play failed for', key, ':', err);
            }
          });
        }
      }
    }
  }, []);

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [fullscreenDevice, setFullscreenDevice] = useState(null);
  const [deviceVolumes, setDeviceVolumes] = useState({});
  const [activePage, setActivePage] = useState('overview');
  const [currentQuality, setCurrentQuality] = useState('high');
  const [networkStats, setNetworkStats] = useState({});
  const [ptzState, setPtzState] = useState({ pan: 0, tilt: 0, zoom: 1 });
  const [motionAlerts, setMotionAlerts] = useState({});
  const [motionDetectionEnabled, setMotionDetectionEnabled] = useState(true);
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

  const cameraDevices = useMemo(() => devices.filter(d => (d.role === 'camera' || d.role === 'device') && d.isCameraEnabled !== false), [devices]);
  const speakerDevices = useMemo(() => devices.filter(d => (d.role === 'speaker' || d.role === 'device') && d.isSpeakerEnabled !== false), [devices]);

  if (!sessionId) {
    return (
      <GridlineShell
        sessionId={null}
        connectionStatus={connectionStatus}
        reconnecting={reconnecting}
      >
        <div className="create-session-container">
          <div className="landing-icon-wrapper">
            <Radio size={28} />
          </div>
          <h2>Run your room from one screen</h2>
          <p>
            Sync music across every phone in the room, pull up live camera
            feeds, and talk to the whole fleet — from a single dashboard.
          </p>
          {error && <div className="error-message">{error}</div>}
          <button onClick={createSession} className="gridline-btn-primary" disabled={reconnecting}>
            <Sparkles size={18} />
            <span>{reconnecting ? 'Connecting…' : 'Start a Session'}</span>
          </button>
          <div className="landing-features">
            <div className="landing-feature">
              <Speaker size={18} />
              <h4>Synced audio</h4>
              <p>Every device plays the same track, drift-corrected in real time.</p>
            </div>
            <div className="landing-feature">
              <Video size={18} />
              <h4>Live cameras</h4>
              <p>Phones become multi-cam feeds you can switch and monitor.</p>
            </div>
            <div className="landing-feature">
              <Mic size={18} />
              <h4>Push-to-talk</h4>
              <p>Hold a button and your voice reaches every connected device.</p>
            </div>
          </div>
        </div>
      </GridlineShell>
    );
  }

  

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
            {/* Single live feed: the device sends exactly one video track and
                switches cameras via replaceTrack, so one element is the truth.
                The old "multi-camera grid" rendered N copies of the same stream. */}
            <video
              ref={(el) => registerVideoElement(fullscreenDevice.id, el, 'fullscreen')}
              autoPlay
              playsInline
              muted
              className="fullscreen-video"
            />

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
                          // FIXED: deviceId was missing so the server relay could not route to the device
                          socket.emit('request-quality', { deviceId: fullscreenDevice.id, quality });
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

      {/* Hidden local monitor player: host hears the track; duration/position feed the UI */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => { if (isPlaying) setPlaybackPosition(e.currentTarget.currentTime); }}
        onEnded={handleTrackEnded}
      />

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

            {/* Invite & Getting-started row */}
            <div className="col-span-8">
              <div className="gridline-card">
                <div className="card-header">
                  <div className="card-title-group">
                    <Radio size={18} className="card-title-icon" />
                    <h3 className="card-title">Invite Participants</h3>
                  </div>
                  <span className="card-badge">{sessionId}</span>
                </div>

                <div className="qr-flex-wrapper" style={{ padding: '1.25rem' }}>
                  <div className="qr-box">
                    <QRCodeSVG value={joinUrl} size={160} level="M" />
                  </div>
                  <div className="invite-info-col">
                    <div className="url-input-group">
                      <input type="text" value={joinUrl} readOnly aria-label="Invite link" />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(joinUrl);
                          setCopiedInvite(true);
                          setTimeout(() => setCopiedInvite(false), 2000);
                        }}
                        className="gridline-btn-ghost btn-sm"
                        aria-label={copiedInvite ? 'Invite link copied' : 'Copy invite link'}
                      >
                        {copiedInvite ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                        <span>{copiedInvite ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <p className="invite-hint">
                      Guests scan the QR code or open the link — no app install needed.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-4">
              <div className="gridline-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div className="card-header">
                  <div className="card-title-group">
                    <Sparkles size={18} className="card-title-icon" />
                    <h3 className="card-title">Getting started</h3>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '1.25rem' }}>
                  <ol className="guide-steps" style={{ textAlign: 'left' }}>
                    <li>Share the code or QR — guests join as speakers, cameras, or both.</li>
                    <li>Upload a track under Audio Broadcast and press play for the room.</li>
                    <li>Watch live feeds appear in the CCTV Grid as cameras come online.</li>
                  </ol>
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
          <AudioBroadcast
            audioFile={audioFile}
            audioUrl={audioUrl}
            isPlaying={isPlaying}
            reconnecting={reconnecting}
            isTalking={isTalking}
            playbackPosition={playbackPosition}
            duration={duration}
            uploading={uploading}
            uploadedTrack={uploadedTrack}
            handleFileChange={handleFileChange}
            handleSeek={handleSeek}
            startPlayback={startPlayback}
            pausePlayback={pausePlayback}
            resumePlayback={resumePlayback}
            startPushToTalk={startPushToTalk}
            stopPushToTalk={stopPushToTalk}
            formatTime={formatTime}
            formatFileSize={formatFileSize}
          />
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
                  <span className="card-badge">{sessionId}</span>
                </div>

                <div className="qr-flex-wrapper" style={{ padding: '1.25rem' }}>
                  <div className="qr-box">
                    <QRCodeSVG value={joinUrl} size={152} level="M" />
                  </div>
                  <div className="invite-info-col">
                    <div className="url-input-group">
                      <input type="text" value={joinUrl} readOnly aria-label="Invite link" />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(joinUrl);
                          setCopiedInvite(true);
                          setTimeout(() => setCopiedInvite(false), 2000);
                        }}
                        className="gridline-btn-ghost btn-sm"
                        aria-label={copiedInvite ? 'Invite link copied' : 'Copy invite link'}
                      >
                        {copiedInvite ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                        <span>{copiedInvite ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <p className="invite-hint">
                      Guests scan the QR code or open the link — no app install needed.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Device Fleet */}
            <div className="col-span-8">
              {devices.length === 0 ? (
                <div className="gridline-card empty-state">
                  <div className="empty-icon"><Monitor size={28} /></div>
                  <p style={{ fontWeight: 600 }}>No devices connected yet</p>
                  <p className="empty-hint">Share the QR code or link to invite participants</p>
                </div>
              ) : (
                <div className="gridline-card">
                  <div className="card-header">
                    <div className="card-title-group">
                      <Monitor size={18} className="card-title-icon" />
                      <h3 className="card-title">Connected Device Fleet</h3>
                    </div>
                    <span className="card-badge">{devices.length} ONLINE</span>
                  </div>
                  <div className="device-fleet-grid">
                    {devices.map(device => (
                      <DeviceCard
                        key={device.id}
                        device={device}
                        isSelected={selectedDevice?.id === device.id}
                        onClick={() => setSelectedDevice(selectedDevice?.id === device.id ? null : device)}
                        onVolumeChange={handleDeviceVolumeChange}
                        volume={deviceVolumes[device.id]}
                        registerVideoElement={registerVideoElement}
                        setFullscreenDevice={setFullscreenDevice}
                        removeDevice={removeDevice}
                        motionDetectionEnabled={motionDetectionEnabled}
                        setMotionDetectionEnabled={setMotionDetectionEnabled}
                        peerConnectionsRef={peerConnectionsRef}
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