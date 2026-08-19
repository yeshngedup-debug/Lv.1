import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import io from 'socket.io-client';
import { PeerConnectionManager } from './webrtc';
import './App.css';

const getSocketUrl = () => {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  // For production/deployment
  return `https://${hostname}:${window.location.port}`;
};

const SOCKET_URL = getSocketUrl();

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

  const audioRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('device-joined', (data) => {
      setDevices(prev => [...prev, data]);
    });

    socket.on('device-left', ({ deviceId }) => {
      setDevices(prev => prev.filter(d => d.id !== deviceId));
      const pc = peerConnectionsRef.current.get(deviceId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(deviceId);
      }
    });

    socket.on('camera-offer', async ({ deviceId, offer }) => {
      const pc = new PeerConnectionManager(socket, deviceId, false);
      peerConnectionsRef.current.set(deviceId, pc);

      pc.onRemoteStream = (stream) => {
        console.log('Received remote stream from', deviceId);
        const videoElement = document.querySelector(`[data-device-id="${deviceId}"] video`);
        if (videoElement) {
          videoElement.srcObject = stream;
        }
      };

      await pc.handleOffer(offer);
    });

    socket.on('ice-candidate', async ({ candidate, fromDeviceId }) => {
      const pc = peerConnectionsRef.current.get(fromDeviceId);
      if (pc) {
        await pc.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('session-ended', () => {
      alert('Session has ended');
      setSessionId(null);
      setDevices([]);
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
    });

    return () => {
      socket.off('device-joined');
      socket.off('device-left');
      socket.off('camera-offer');
      socket.off('ice-candidate');
      socket.off('session-ended');
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
    };
  }, [socket]);

  const createSession = () => {
    if (!socket) return;

    socket.emit('create-session', (response) => {
      setSessionId(response.sessionId);
      setJoinUrl(response.joinUrl);
    });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAudioFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
    }
  };

  const startPlayback = () => {
    if (!socket || !audioUrl) return;

    socket.emit('start-playing', {
      trackUrl: audioUrl,
      trackName: audioFile?.name || 'Audio',
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      alert('Could not access microphone. Please ensure microphone permissions are granted.');
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
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
            <button onClick={createSession} className="btn btn-primary">
              Create Session
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Iris SYNCD</h1>
        <div className="session-info">
          <span className="session-code">Session: {sessionId}</span>
          <button onClick={endSession} className="btn btn-danger btn-small">
            End Session
          </button>
        </div>
      </header>

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
                />

                <div className="progress-bar">
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    value={playbackPosition}
                    onChange={handleSeek}
                    step="0.1"
                  />
                  <span className="time">
                    {formatTime(playbackPosition)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="playback-buttons">
                  {isPlaying ? (
                    <button onClick={pausePlayback} className="btn btn-primary">
                      Pause
                    </button>
                  ) : (
                    <button onClick={startPlayback} className="btn btn-primary">
                      Play
                    </button>
                  )}
                  <button onClick={resumePlayback} className="btn btn-secondary">
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
              >
                {isTalking ? 'Talking...' : 'Hold to Talk'}
              </button>
            </div>
          </section>

          <section className="camera-section">
            <h2>Camera Feeds</h2>
            <div className="camera-grid">
              {devices.filter(d => d.role === 'camera').length === 0 ? (
                <p className="no-cameras">No camera feeds active</p>
              ) : (
                devices
                  .filter(d => d.role === 'camera')
                  .map(device => (
                    <div key={device.id} className="camera-feed">
                      <div className="camera-placeholder">
                        <span>{device.nickname}</span>
                        <span className="camera-status">Connecting...</span>
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
