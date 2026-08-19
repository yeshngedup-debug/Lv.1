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
      console.log('Received camera offer from', deviceId);

      const existingPc = peerConnectionsRef.current.get(deviceId);
      if (existingPc) {
        existingPc.close();
        peerConnectionsRef.current.delete(deviceId);
      }

      const pc = new PeerConnectionManager(socket, deviceId, false);
      peerConnectionsRef.current.set(deviceId, pc);

      // Set up the remote stream handler BEFORE handling the offer
      pc.onRemoteStream = (stream) => {
        console.log('Received remote stream from', deviceId);
        const videoElement = videoElementsRef.current.get(deviceId);
        if (videoElement) {
          videoElement.srcObject = stream;
          videoElement.play().catch(err => console.error('Video play failed:', err));
        }
      };

      // Also handle connection state changes
      pc.onConnectionStateChange = (state) => {
        console.log(`Connection state for ${deviceId}:`, state);
      };

      try {
        await pc.handleOffer(offer);
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

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [fullscreenDevice, setFullscreenDevice] = useState(null);
  const [deviceVolumes, setDeviceVolumes] = useState({});

  const handleDeviceVolumeChange = (deviceId, volume) => {
    setDeviceVolumes(prev => ({ ...prev, [deviceId]: volume }));
    if (socket) {
      socket.emit('update-device-volume', { deviceId, volume });
    }
  };

  const closeFullscreen = () => setFullscreenDevice(null);

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

  const DeviceCard = ({ device, isSelected, onClick, onVolumeChange, volume }) => {
    const isCamera = device.role === 'camera';
    const isSpeaker = device.role === 'speaker';
    const pc = peerConnectionsRef.current.get(device.id);
    const isConnected = pc?.connectionState === 'connected';

    return (
      <article
        className={`device-card ${isSelected ? 'selected' : ''} ${isCamera ? 'camera' : 'speaker'}`}
        onClick={onClick}
        data-device-id={device.id}
      >
        <div className="device-card-header">
          <div className="device-avatar">
            {isCamera ? '📷' : '🔊'}
          </div>
          <div className="device-meta">
            <h3 className="device-name">{device.nickname}</h3>
            <div className="device-status">
              <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
              <span className={`device-role-badge ${device.role}`}>
                {isCamera ? 'Camera' : 'Speaker'}
              </span>
            </div>
          </div>
        </div>

{isSelected && isCamera && pc?.remoteStream && (
          <div className="device-preview">
            <video
              ref={(el) => registerVideoElement(device.id, el)}
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
                🔍 Fullscreen
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
        ) : null}
      </article>
    );
  };

  const renderFullscreenModal = () => {
    if (!fullscreenDevice) return null;
    const pc = peerConnectionsRef.current.get(fullscreenDevice.id);

    return (
      <div className="fullscreen-modal" onClick={closeFullscreen}>
        <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
          <header className="fullscreen-header">
            <h2>{fullscreenDevice.nickname}</h2>
            <button onClick={closeFullscreen} className="close-btn" aria-label="Close fullscreen">
              ✕
            </button>
          </header>
          <div className="fullscreen-video-wrapper">
            <video
              ref={(el) => registerVideoElement(fullscreenDevice.id, el)}
              autoPlay
              playsInline
              muted
              className="fullscreen-video"
            />
            <div className="fullscreen-overlay">
              <div className="fullscreen-controls">
                <div className="control-group">
                  <label>Volume</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={deviceVolumes[fullscreenDevice.id] ?? 1}
                    onChange={(e) => handleDeviceVolumeChange(fullscreenDevice.id, parseFloat(e.target.value))}
                    className="volume-slider"
                  />
                  <span className="volume-value">{Math.round((deviceVolumes[fullscreenDevice.id] ?? 1) * 100)}%</span>
                </div>
                <span className="connection-badge">
                  {pc?.connectionState === 'connected' ? '🟢 Connected' : '🔴 Disconnected'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Iris SYNCD</h1>
          <span className="version-badge">v1.0</span>
        </div>
        <div className="header-center">
          <span className="session-code">Session: {sessionId}</span>
        </div>
        <div className="header-right">
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
      {renderFullscreenModal()}

      <main className="main">
        <div className="dashboard">
          <section className="join-section">
            <div className="join-header">
              <h2>Invite Participants</h2>
              <div className="join-stats">
                <span className="stat">
                  <span className="stat-value">{devices.length}</span>
                  <span className="stat-label">Connected</span>
                </span>
                <span className="stat">
                  <span className="stat-value">{cameraDevices.length}</span>
                  <span className="stat-label">Cameras</span>
                </span>
                <span className="stat">
                  <span className="stat-value">{speakerDevices.length}</span>
                  <span className="stat-label">Speakers</span>
                </span>
              </div>
            </div>
            <div className="qr-container">
              <QRCodeSVG value={joinUrl} size={200} />
            </div>
            <div className="join-url">
              <input type="text" value={joinUrl} readOnly />
              <button
                onClick={() => navigator.clipboard.writeText(joinUrl)}
                className="btn btn-secondary"
              >
                📋 Copy Link
              </button>
            </div>
          </section>

          <section className="devices-section">
            <div className="section-header">
              <h2>Connected Devices</h2>
              <p className="section-hint">Click a device to control camera/audio</p>
            </div>
            {devices.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📱</div>
                <p>No devices connected yet</p>
                <p className="empty-hint">Share the QR code or link above to invite participants</p>
              </div>
            ) : (
              <div className="device-grid">
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
          </section>

          <section className="audio-section">
            <h2>Audio Broadcast</h2>

            <div className="audio-upload">
              <label className="file-upload">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <span className="btn btn-secondary">
                  {audioFile ? audioFile.name : '📁 Choose Audio File'}
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

                <div className="waveform-preview" role="img" aria-label="Audio waveform">
                  {[...Array(32)].map((_, i) => (
                    <span key={i} style={{ animationDelay: `${i * 0.05}s` }}></span>
                  ))}
                </div>

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
                    <button onClick={pausePlayback} className="btn btn-primary" disabled={reconnecting}>
                      ⏸️ Pause
                    </button>
                  ) : (
                    <button onClick={startPlayback} className="btn btn-primary" disabled={reconnecting || !audioUrl}>
                      ▶️ Play
                    </button>
                  )}
                  <button onClick={resumePlayback} className="btn btn-secondary" disabled={reconnecting || isPlaying}>
                    ↻ Resume
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
                {isTalking ? '🎤 Broadcasting...' : '🎤 Hold to Talk'}
              </button>
            </div>
          </section>

          {cameraDevices.length > 0 && (
            <section className="camera-section">
              <div className="section-header">
                <h2>Live Camera Feeds</h2>
                <p className="section-hint">Click any feed for fullscreen view</p>
              </div>
              <div className="camera-grid">
                {cameraDevices.map(device => (
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
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;