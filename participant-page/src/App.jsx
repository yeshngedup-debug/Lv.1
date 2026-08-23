import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import {
  Radio, Speaker, Video, ArrowRight, ArrowLeft, Shield, Check, Music, Power,
  Circle, Square, Download, Trash2, Clock, AlertCircle
} from 'lucide-react';
import { AudioSync } from './audioSync';
import { requestWakeLock, releaseWakeLock } from './sw';
import { PeerConnectionManager } from './webrtc';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

function App() {
  const [socket, setSocket] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [role, setRole] = useState(null);
  const [nickname, setNickname] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  const stateRef = useRef({ sessionId, role, nickname, isJoined });
  useEffect(() => {
    stateRef.current = { sessionId, role, nickname, isJoined };
  }, [sessionId, role, nickname, isJoined]);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState(null);
  const [mediaPermission, setMediaPermission] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [reconnecting, setReconnecting] = useState(false);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const [allCameraStreams, setAllCameraStreams] = useState({});
  const [currentQuality, setCurrentQuality] = useState('high');
  const deviceIdRef = useRef(null);

  // Combined role state - true = device acts as both camera and speaker
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const dbRef = useRef(null);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const audioSyncRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const wakeLockRef = useRef(null);

  const extractSessionIdFromUrl = useCallback(() => {
    const pathParts = window.location.pathname.split('/');
    // Handle /join/SESSION_ID format
    if (pathParts.includes('join')) {
      const joinIndex = pathParts.indexOf('join');
      if (joinIndex + 1 < pathParts.length) {
        const id = pathParts[joinIndex + 1];
        if (id && id.length === 8) {
          return id.toUpperCase();
        }
      }
    }
    // Handle /p/SESSION_ID format (PWA)
    if (pathParts.includes('p')) {
      const pIndex = pathParts.indexOf('p');
      if (pIndex + 1 < pathParts.length) {
        const id = pathParts[pIndex + 1];
        if (id && id.length === 8) {
          return id.toUpperCase();
        }
      }
    }
    // Handle direct /SESSION_ID format
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart.length === 8) {
      return lastPart.toUpperCase();
    }
    return null;
  }, []);

  useEffect(() => {
    const id = extractSessionIdFromUrl();
    if (id) {
      setSessionId(id);
    }
  }, [extractSessionIdFromUrl]);

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
      const { sessionId: sId, role: r, nickname: nick, isJoined: joined } = stateRef.current;
      if (sId && joined && r) {
        newSocket.emit('join-session', { sessionId: sId, role: r, nickname: nick, deviceId: deviceIdRef.current }, (response) => {
          if (response.error) {
            console.error('Rejoin failed:', response.error);
            setIsJoined(false);
            setRole(null);
          } else if (response.deviceId) {
            deviceIdRef.current = response.deviceId;
            if (r === 'camera' && streamRef.current) {
              stopCameraStreaming();
              startCameraStreaming();
            }
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

    // Heartbeat ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (newSocket.connected) {
        newSocket.emit('ping');
      }
    }, 5000);
    newSocket.on('disconnect', () => clearInterval(pingInterval));

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

    socket.on('playback-started', (data) => {
      setIsPlaying(true);
      setCurrentTrack(data);
      
      // Initialize audio sync for speaker role
      if (audioRef.current && role === 'speaker') {
        audioSyncRef.current = new AudioSync(audioRef.current, socket);
      }
    });

    socket.on('playback-paused', () => {
      setIsPlaying(false);
    });

    socket.on('playback-resumed', () => {
      setIsPlaying(true);
    });

    socket.on('session-ended', () => {
      alert('Session has ended by the host');
      window.location.href = '/join';
    });

    socket.on('removed-from-session', () => {
      alert('You have been removed from the session');
      window.location.href = '/join';
    });

    socket.on('host-mic-active', () => {
      console.log('Host is talking');
    });

    socket.on('host-mic-inactive', () => {
      console.log('Host stopped talking');
    });

    socket.on('switch-camera', async ({ cameraId }) => {
      console.log('Host requested switch to camera:', cameraId);
      await switchToCamera(cameraId);
    });

    socket.on('request-quality', async ({ quality }) => {
      console.log('Host requested quality change:', quality);
      await changeCameraQuality(quality);
    });

    return () => {
      socket.off('playback-started');
      socket.off('playback-paused');
      socket.off('playback-resumed');
      socket.off('session-ended');
      socket.off('removed-from-session');
      socket.off('host-mic-active');
      socket.off('host-mic-inactive');
      if (audioSyncRef.current) {
        audioSyncRef.current.destroy();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [socket, role]);

const requestMediaPermission = async (needsCamera, needsAudio) => {
    try {
      if (!needsCamera && needsAudio) {
        // Audio only - verify audio context can be created
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.close();
        setMediaPermission('granted');
        return true;
      } else if (needsCamera) {
        // Camera needs video + microphone
        console.log('Requesting camera/microphone permissions...');

        // Get a basic stream to trigger permission prompt, then stop it
        // We'll get all cameras properly in startCameraStreaming after permission is granted
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          testStream.getTracks().forEach(t => t.stop());
        } catch (err) {
          console.warn('Initial permission check failed:', err);
          throw err;
        }

        setMediaPermission('granted');
        return true;
      }
    } catch (err) {
      console.error('Media permission denied:', err);
      setMediaPermission('denied');

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera/microphone permission denied. Please allow access in browser settings and try again.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera/microphone found. Please connect a device and try again.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera/microphone is in use by another application. Close it and try again.');
      } else if (err.name === 'OverconstrainedError') {
        setError('Camera constraints not supported. Trying alternative configuration...');
      } else {
        setError(`Media access error: ${err.message}`);
      }
      return false;
    }
  };

  const joinSession = async () => {
    if (!socket || !sessionId || !role) return;

    // For combined role, we need camera if enabled, audio if speaker enabled
    const needsCamera = isCameraEnabled;
    const needsAudio = isSpeakerEnabled || isCameraEnabled; // Camera also needs microphone

    const hasPermission = await requestMediaPermission(needsCamera, needsAudio);
    if (!hasPermission) return;

    socket.emit('join-session', { 
      sessionId, 
      role, 
      nickname, 
      isCameraEnabled, 
      isSpeakerEnabled 
    }, (response) => {
      if (response.error) {
        setError(response.error);
        return;
      }

      deviceIdRef.current = response.deviceId;
      setIsJoined(true);
      setSessionId(sessionId);

      if (isCameraEnabled) {
        startCameraStreaming();
      }
      if (isSpeakerEnabled) {
        // Initialize audio sync for speaker
        if (audioRef.current) {
          audioSyncRef.current = new AudioSync(audioRef.current, socket);
        }
      }
    });
  };

  const answerHandlerRef = useRef(null);

const startCameraStreaming = async () => {
    if (!socket) return;

    const currentDeviceId = deviceIdRef.current;
    if (!currentDeviceId) {
      setError('Not connected to session');
      return;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (answerHandlerRef.current) {
      socket.off('camera-answer', answerHandlerRef.current);
      answerHandlerRef.current = null;
    }

    // Stop any existing camera streams
    Object.values(allCameraStreams).forEach(stream => {
      stream.getTracks().forEach(t => t.stop());
    });
    setAllCameraStreams({});

    try {
      console.log('Starting camera streaming...');

      // First, get a basic stream to ensure permission is granted and enumerate devices with labels
      let initialStream = null;
      try {
        initialStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 }
          },
          audio: false
        });
      } catch (err) {
        console.error('Failed to get initial camera stream:', err);
        throw new Error('Could not access camera. Please check permissions.');
      }

// Now enumerate devices - labels should be populated after getUserMedia
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      if (videoDevices.length === 0) {
        setError('No cameras found');
        if (initialStream) initialStream.getTracks().forEach(t => t.stop());
        return;
      }

      console.log('Found cameras:', videoDevices.map(d => ({ id: d.deviceId, label: d.label })));

      // Get stream from each camera with fallbacks
      const cameraStreams = {};
      const combinedStream = new MediaStream();
      let audioTrack = null;
      let gotVideoFromIndividual = false;

      // Release initial stream - we'll try individual cameras
      if (initialStream) {
        initialStream.getTracks().forEach(t => t.stop());
        initialStream = null;
      }

      for (const device of videoDevices) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: device.deviceId },
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 }
            },
            audio: false
          });

          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
            combinedStream.addTrack(videoTrack);
            cameraStreams[device.deviceId] = stream;
            gotVideoFromIndividual = true;
          }
        } catch (err) {
          console.warn(`Failed to get stream from camera ${device.deviceId}:`, err);
          // Try with relaxed constraints
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: device.deviceId } },
              audio: false
            });
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
              videoTrack.label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
              combinedStream.addTrack(videoTrack);
              cameraStreams[device.deviceId] = stream;
              gotVideoFromIndividual = true;
            }
          } catch (err2) {
            console.warn(`Failed to get stream from camera ${device.deviceId} with relaxed constraints:`, err2);
          }
        }
      }

      // Fallback: if no individual camera worked, try default camera
      if (!gotVideoFromIndividual) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } },
            audio: false
          });
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            combinedStream.addTrack(videoTrack);
            cameraStreams['default'] = stream;
            gotVideoFromIndividual = true;
          }
        } catch (err) {
          console.warn('Failed to get any camera stream:', err);
        }
      }

      // Also get audio track once
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          combinedStream.addTrack(audioTrack);
        }
      } catch (err) {
        console.warn('Failed to get audio:', err);
      }

      if (combinedStream.getVideoTracks().length === 0) {
        setError('No camera streams available');
        return;
      }

      setAllCameraStreams(cameraStreams);
      streamRef.current = combinedStream;

      // Update available cameras list
      const camList = videoDevices.map(d => ({
        id: d.deviceId,
        label: d.label || `Camera ${d.deviceId.slice(0, 8)}`
      }));
      setAvailableCameras(camList);

      const firstCamId = camList[0]?.id;
      if (firstCamId) {
        setActiveCameraId(firstCamId);
      }

      // Set local preview to first camera
      if (videoRef.current) {
        videoRef.current.srcObject = combinedStream;
        videoRef.current.play().catch(() => {});
      }

      // Create peer connection and add all tracks
      const pc = new PeerConnectionManager(socket, 'host', true);
      await pc.addLocalStream(combinedStream);

      const sentTracks = combinedStream.getTracks();
      console.log('Sending tracks:', sentTracks.map(t => ({ kind: t.kind, label: t.label, enabled: t.enabled })));

      pc.onConnectionStateChange = (state) => {
        console.log('Camera connection state:', state);
        if (state === 'failed') {
          console.warn('Camera WebRTC connection failed, attempting restart...');
          setTimeout(() => {
            if (isJoined && role === 'camera') {
              startCameraStreaming();
            }
          }, 3000);
        }
      };

      const offer = await pc.createOffer();
      console.log('Participant emitting camera-offer, offer type:', offer?.type);

      socket.emit('camera-offer', {
        deviceId: currentDeviceId,
        offer
      });

      const handleAnswer = async ({ answer }) => {
        try {
          await pc.handleAnswer(answer);
        } catch (err) {
          console.error('Failed to set remote description:', err);
        }
      };

      answerHandlerRef.current = handleAnswer;
      socket.on('camera-answer', handleAnswer);

      peerConnectionRef.current = pc;
      setIsLive(true);

      // Tell the host which cameras this device exposes
      socket.emit('device-cameras', { cameras: camList });
      if (firstCamId) {
        socket.emit('camera-switched', { cameraId: firstCamId });
      }

      try {
        wakeLockRef.current = await requestWakeLock();
      } catch (err) {
        console.log('Wake Lock not supported');
      }

    } catch (err) {
      console.error('Error starting camera streaming:', err);
      setError('Failed to start camera streaming');
    }
  };

  const stopCameraStreaming = () => {
    if (answerHandlerRef.current && socket) {
      socket.off('camera-answer', answerHandlerRef.current);
      answerHandlerRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop all individual camera streams
    Object.values(allCameraStreams).forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    setAllCameraStreams({});

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (wakeLockRef.current) {
      releaseWakeLock();
      wakeLockRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsLive(false);
    setAvailableCameras([]);
    setActiveCameraId(null);
  };

  const switchToCamera = (cameraId) => {
    if (!cameraId || !socket || !deviceIdRef.current) return;
    console.log('Switching active camera to:', cameraId);
    setActiveCameraId(cameraId);
    socket.emit('camera-switched', { cameraId });
  };

  const changeCameraQuality = async (quality) => {
    if (!socket || !deviceIdRef.current || quality === currentQuality) return;
    
    const constraints = {
      low: { width: { ideal: 640, max: 1280 }, height: { ideal: 360, max: 720 }, frameRate: { ideal: 10, max: 15 } },
      medium: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 20, max: 30 } },
      high: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
    };
    
    const constraint = constraints[quality] || constraints.medium;
    
    try {
      console.log('Changing camera quality to:', quality, constraint);
      
      // Apply constraints to all active video tracks
      for (const [deviceId, stream] of Object.entries(allCameraStreams)) {
        const tracks = stream.getVideoTracks();
        for (const track of tracks) {
          try {
            await track.applyConstraints(constraint);
            console.log(`Applied ${quality} quality to camera ${deviceId}`);
          } catch (err) {
            console.warn(`Failed to apply quality to ${deviceId}:`, err);
          }
        }
      }
      
      // Also apply to combined stream if it has video tracks
      if (streamRef.current) {
        const combinedTracks = streamRef.current.getVideoTracks();
        for (const track of combinedTracks) {
          try {
            await track.applyConstraints(constraint);
          } catch (err) {
            console.warn('Failed to apply quality to combined stream:', err);
          }
        }
      }
      
      setCurrentQuality(quality);
      socket.emit('quality-changed', { quality });
    } catch (err) {
      console.error('Failed to change camera quality:', err);
    }
  };

  // ============ IndexedDB for Recordings ============
  const initDB = useCallback(async () => {
    if (dbRef.current) return dbRef.current;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('IrisSYNCDRecordings', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        dbRef.current = request.result;
        resolve(dbRef.current);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('recordings')) {
          const store = db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };
    });
  }, []);

  const saveRecording = useCallback(async (blob, metadata = {}) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['recordings'], 'readwrite');
      const store = transaction.objectStore('recordings');
      const record = {
        blob,
        timestamp: Date.now(),
        sessionId,
        deviceId: deviceIdRef.current,
        duration: recordingTime,
        ...metadata
      };
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, [sessionId, recordingTime]);

  const getRecordings = useCallback(async () => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['recordings'], 'readonly');
      const store = transaction.objectStore('recordings');
      const index = store.index('timestamp');
      const request = index.getAll();
      request.onsuccess = () => resolve(request.result.reverse());
      request.onerror = () => reject(request.error);
    });
  }, []);

  const deleteRecording = useCallback(async (id) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['recordings'], 'readwrite');
      const store = transaction.objectStore('recordings');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }, []);

  // ============ Recording Controls ============
  const startRecording = useCallback(async () => {
    if (!streamRef.current || isRecording) return;
    
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
      
      const recorder = new MediaRecorder(streamRef.current, { mimeType, videoBitsPerSecond: 5000000 });
      mediaRecorderRef.current = recorder;
      setRecordedChunks([]);
      setRecordingTime(0);
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          setRecordedChunks(prev => [...prev, e.data]);
        }
      };
      
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        await saveRecording(blob, { mimeType });
        setRecordedChunks([]);
      };
      
      recorder.start(1000); // Collect data every second
      setIsRecording(true);
      
      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to start recording');
    }
  }, [isRecording, saveRecording]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  }, [isRecording]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  useEffect(() => {
    if (!socket || role !== 'camera' || !isJoined) return;
    const handler = ({ cameraId }) => switchToCamera(cameraId);
    socket.on('switch-camera', handler);
    return () => socket.off('switch-camera', handler);
  }, [socket, role, isJoined]);

  const leaveSession = () => {
    stopCameraStreaming();
    if (audioSyncRef.current) {
      audioSyncRef.current.destroy();
    }
    socket.disconnect();
    window.location.href = '/join';
  };

  if (error) {
    return (
      <div className="app">
        <div className="error-container">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => window.location.href = '/join'} className="btn btn-primary">
            <ArrowLeft size={16} />
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="app">
        <div className="gridline-status-strip">
          <div className="status-strip-left">
            <span className="status-pill">
              <span className="status-dot-pulse"></span>
              GRIDLINE CONNECT
            </span>
          </div>
        </div>

        <div className="join-container">
          <div className="brand-icon-box">
            <Radio size={32} />
          </div>
          <h1>Iris SYNCD</h1>
          <p>Enter 8-character session code to join</p>
          <input
            type="text"
            placeholder="SESSION CODE"
            value={sessionId || ''}
            onChange={(e) => setSessionId(e.target.value.toUpperCase())}
            maxLength={8}
          />
          <button
            onClick={() => setSessionId(sessionId)}
            className="gridline-btn-primary"
            disabled={!sessionId || sessionId.length !== 8}
            style={{ width: '100%', maxWidth: '280px', marginTop: '0.5rem' }}
          >
            <span>Continue</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="app">
        <div className="gridline-status-strip">
          <div className="status-strip-left">
            <span className="status-pill">
              <span className="status-dot-pulse"></span>
              ROLE SELECTION
            </span>
          </div>
        </div>

        <div className="role-selection">
          <h1>Join Session</h1>
          <span className="session-chip">SESSION: {sessionId}</span>

          <div className="role-options">
            <button
              onClick={() => setRole('device')}
              className="role-option combined"
            >
              <span className="role-icon combined">
                <Video size={26} />
                <Speaker size={20} style={{ position: 'absolute', bottom: 2, right: 2 }} />
              </span>
              <span className="role-title">Join as Device</span>
              <span className="role-description">
                Stream live HD video & play synchronized audio from host
              </span>
            </button>
          </div>

          <div className="feature-toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={isCameraEnabled}
                onChange={(e) => setIsCameraEnabled(e.target.checked)}
              />
              <span>Camera Streaming</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={isSpeakerEnabled}
                onChange={(e) => setIsSpeakerEnabled(e.target.checked)}
              />
              <span>Audio Playback</span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="app">
        <div className="permission-screen">
          <h1>Allow Access</h1>
          <p>
            {isCameraEnabled && isSpeakerEnabled
              ? 'Allow camera and microphone access for video streaming + audio playback'
              : isCameraEnabled
              ? 'Allow camera and microphone access to stream video'
              : 'Allow audio access to play music from the host'}
          </p>

          <div className="permission-card">
            <h3>
              {isCameraEnabled && isSpeakerEnabled
                ? 'Camera & Microphone + Audio'
                : isCameraEnabled
                ? 'Camera & Microphone'
                : 'Audio Access'}
            </h3>
            <p>
              {isCameraEnabled && isSpeakerEnabled
                ? 'We need camera access to stream video, microphone for audio, and audio output for host playback'
                : isCameraEnabled
                ? 'We need camera access to stream video and microphone for audio'
                : 'We need audio access to play the host\'s music on your device'}
            </p>
          </div>

          <input
            type="text"
            placeholder="Your nickname (optional)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={50}
          />

          <div className="permission-buttons">
            <button onClick={() => setRole(null)} className="btn btn-secondary">
              Back
            </button>
            <button onClick={joinSession} className="btn btn-primary" disabled={reconnecting}>
              {reconnecting ? 'Connecting...' : 'Allow & Join'}
            </button>
          </div>

          <p className="permission-note">
            Your browser will ask for permission on the next step
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="active-session">
        <header className="session-header">
          <h1>Iris SYNCD</h1>
          <div className="header-right">
            <span className="role-badge">{role}</span>
            <div className={`connection-status ${connectionStatus}`}>
              <span className="status-dot"></span>
              {reconnecting ? 'Reconnecting...' : connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            </div>
          </div>
        </header>

        {role === 'speaker' && (
          <div className="speaker-view">
            <div className="audio-status">
              {isPlaying ? (
                <>
                  <div className="playing-indicator">
                    <span className="bar"></span>
                    <span className="bar"></span>
                    <span className="bar"></span>
                    <span className="bar"></span>
                  </div>
                  <p>Playing: {currentTrack?.trackName || 'Audio'}</p>
                </>
              ) : (
                <p>Waiting for audio...</p>
              )}
            </div>

            <audio ref={audioRef} autoPlay />
          </div>
        )}

        {role === 'camera' && (
          <div className="camera-view">
            <div className="video-container">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-preview"
              />
              {isLive && (
                <div className="live-indicator">
                  <span className="live-dot"></span>
                  LIVE
                </div>
              )}
              {isRecording && (
                <div className="recording-indicator">
                  <Circle className="rec-dot" size={12} />
                  <span>{formatTime(recordingTime)}</span>
                </div>
              )}
            </div>

            <div className="camera-controls">
              {availableCameras.length > 1 && (
                <div className="camera-switcher">
                  {availableCameras.map((cam, idx) => (
                    <button
                      key={cam.id}
                      onClick={() => switchToCamera(cam.id)}
                      className={`camera-chip ${activeCameraId === cam.id ? 'active' : ''}`}
                      title={cam.label}
                    >
                      CAM {idx + 1}
                    </button>
                  ))}
                </div>
              )}
              
              <div className="recording-controls">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    className="btn btn-record"
                    disabled={!isLive}
                  >
                    <Circle size={16} />
                    <span>Start Recording</span>
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="btn btn-stop-record"
                  >
                    <Square size={16} />
                    <span>Stop Recording</span>
                  </button>
                )}
              </div>

              <button
                onClick={stopCameraStreaming}
                className="btn btn-danger"
              >
                Stop Sharing
              </button>
            </div>
          </div>
        )}

        <button onClick={leaveSession} className="btn btn-secondary leave-btn">
          Leave Session
        </button>
      </div>
    </div>
  );
}

export default App;