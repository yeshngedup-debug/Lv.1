import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import io from 'socket.io-client';
import { PeerConnectionManager } from './webrtc';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'];

function App() {
  const [socket, setSocket] = useState(null);
  const [sessionId, setSessionId] = useState(null);
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

  const audioRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
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
      if (sessionId) {
        newSocket.emit('rejoin-session', { sessionId }, (response) => {
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
  }, [SOCKET_URL, sessionId]);

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
        if (prev.some(d => d.id === data.id)) return prev;
        return [...prev, data];
      });
      setError(null);
    });

    socket.on('device-left', ({ deviceId }) => {
      setDevices(prev => prev.filter(d => d.id !== deviceId));
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

    socket.on('camera-offer', async ({ deviceId, offer }) => {
      const pc = new PeerConnectionManager(socket, deviceId, false);
      peerConnectionsRef.current.set(deviceId, pc);

      pc.onRemoteStream = (stream) => {
        console.log('Received remote stream from', deviceId);
        const videoElement = videoElementsRef.current.get(deviceId);
        if (videoElement) {
          videoElement.srcObject = stream;
        }
      };

      try {
        await pc.handleOffer(offer);
      } catch (err) {
        console.error('Failed to handle camera offer:', err);
      }
    });

    socket.on('ice-candidate', async ({ candidate, fromDeviceId }) => {
      const pc = peerConnectionsRef.current.get(fromDeviceId);
      if (pc) {
        try {
          await pc.pc.addIceCandidate(new RTCIceCandidate(candidate));
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

  const registerVideoElement = (deviceId, element) => {
    if (element) {
      videoElementsRef.current.set(deviceId, element);
      const pc = peerConnectionsRef.current.get(deviceId);
      if (pc && pc.remoteStream) {
        element.srcObject = pc.remoteStream;
      }
    } else {
      videoElementsRef.current.delete(deviceId);
    }
  };

  if (!sessionId) {
    return (
      <div className="app">
        <header className="header">
          <h1>Iris SYNCD</h1>
          <p>Host Dashboard</p>
        </header>
        <main className="main">
          <div className="create-session">
            <h2>Create a New Session</h2>
            <p>Start a party session and invite others to join</p>
            {error && <div className="error-message">{error}</div>}
            <button onClick={createSession} className="btn btn-primary" disabled={reconnecting}>
              {reconnecting ? 'Connecting...' : 'Create Session'}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const cameraDevices = devices.filter(d => d.role === 'camera');
  const speakerDevices = devices.filter(d => d.role === 'speaker');

  return (
    <div className="app">
      <header className="header">
        <h1>Iris SYNCD</h1>
        <div className="session-info">
          <span className="session-code">Session: {sessionId}</span>
          <div className={`connection-status ${connectionStatus}`}>
            <span className="status-dot"></span>
            {reconnecting ? 'Reconnecting...' : connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
          </div>
          <button onClick={endSession} className="btn btn-danger btn-small" disabled={reconnecting}>
            End Session
          </button>
        </div>
      </header>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} (click to dismiss)</div>}

      <main className="main">
        <div className="dashboard">
          <section className="join-section">
            <h2>Join Session</h2>
            <div className="qr-container">
              <QRCodeSVG value={joinUrl} size={200} />
            </div>
            <div className="join-url">
              <input type="text" value={joinUrl} readOnly />
              <button
                onClick={() => navigator.clipboard.writeText(joinUrl)}
                className="btn btn-secondary"
              >
                Copy Link
              </button>
            </div>
            <p className="instructions">
              Scan QR code or share the link with participants
            </p>
          </section>

          <section className="devices-section">
            <h2>Connected Devices ({devices.length})</h2>
            {devices.length === 0 ? (
              <p className="no-devices">No devices connected yet</p>
            ) : (
              <ul className="device-list">
                {devices.map(device => (
                  <li key={device.id} className="device-item">
                    <div className="device-info">
                      <span className="device-name">{device.nickname}</span>
                      <span className={`device-role ${device.role}`}>
                        {device.role}
                      </span>
                    </div>
                    <button
                      onClick={() => removeDevice(device.id)}
                      className="btn btn-danger btn-small"
                      disabled={reconnecting}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="audio-section">
            <h2>Audio Controls</h2>

            <div className="audio-upload">
              <label className="file-upload">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <span className="btn btn-secondary">
                  {audioFile ? audioFile.name : 'Choose Audio File'}
                </span>
              </label>
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

                <div className="progress-bar">
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    value={playbackPosition}
                    onChange={handleSeek}
                    step="0.1"
                    disabled={!duration}
                  />
                  <span className="time">
                    {formatTime(playbackPosition)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="playback-buttons">
                  {isPlaying ? (
                    <button onClick={pausePlayback} className="btn btn-primary" disabled={reconnecting}>
                      Pause
                    </button>
                  ) : (
                    <button onClick={startPlayback} className="btn btn-primary" disabled={reconnecting || !audioUrl}>
                      Play
                    </button>
                  )}
                  <button onClick={resumePlayback} className="btn btn-secondary" disabled={reconnecting || isPlaying}>
                    Resume
                  </button>
                </div>
              </div>
            )}

            <div className="push-to-talk">
              <h3>Push to Talk</h3>
              <button
                onMouseDown={startPushToTalk}
                onMouseUp={stopPushToTalk}
                onMouseLeave={stopPushToTalk}
                onTouchStart={startPushToTalk}
                onTouchEnd={stopPushToTalk}
                className={`btn btn-talk ${isTalking ? 'active' : ''}`}
                disabled={reconnecting}
              >
                {isTalking ? 'Talking...' : 'Hold to Talk'}
              </button>
            </div>
          </section>

          <section className="camera-section">
            <h2>Camera Feeds ({cameraDevices.length})</h2>
            <div className="camera-grid">
              {cameraDevices.length === 0 ? (
                <p className="no-cameras">No camera feeds active</p>
              ) : (
                cameraDevices.map(device => (
                  <div key={device.id} className="camera-feed">
                    <video
                      ref={(el) => registerVideoElement(device.id, el)}
                      autoPlay
                      playsInline
                      muted
                      className="camera-video"
                      onError={() => console.error(`Video error for ${device.nickname}`)}
                    />
                    <div className="camera-overlay">
                      <span className="camera-name">{device.nickname}</span>
                      <span className="live-badge">LIVE</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;