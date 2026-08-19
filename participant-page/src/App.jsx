import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { AudioSync } from './audioSync';
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
  const [role, setRole] = useState(null);
  const [nickname, setNickname] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState(null);
  const [mediaPermission, setMediaPermission] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const audioSyncRef = useRef(null);

  useEffect(() => {
    const pathParts = window.location.pathname.split('/');
    const sessionIdFromUrl = pathParts[pathParts.length - 1];
    if (sessionIdFromUrl && sessionIdFromUrl.length === 8) {
      setSessionId(sessionIdFromUrl);
    } else if (pathParts.includes('join')) {
      const joinIndex = pathParts.indexOf('join');
      if (joinIndex + 1 < pathParts.length) {
        const id = pathParts[joinIndex + 1];
        if (id && id.length === 8) {
          setSessionId(id);
        }
      }
    }
  }, []);

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
      if (audioRef.current && role === 'speaker') {
        audioSyncRef.current = new AudioSync(audioRef.current, socket);
      }
    });

    socket.on('playback-started', (data) => {
      setIsPlaying(true);
      setCurrentTrack(data);
    });

    socket.on('playback-paused', () => {
      setIsPlaying(false);
    });

    socket.on('playback-resumed', () => {
      setIsPlaying(true);
    });

    socket.on('session-ended', () => {
      alert('Session has ended by the host');
      window.location.href = '/';
    });

    socket.on('removed-from-session', () => {
      alert('You have been removed from the session');
      window.location.href = '/';
    });

    socket.on('host-mic-active', () => {
      console.log('Host is talking');
    });

    socket.on('host-mic-inactive', () => {
      console.log('Host stopped talking');
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
    };
  }, [socket, role]);

  const requestMediaPermission = async (requestedRole) => {
    try {
      if (requestedRole === 'speaker') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setMediaPermission('granted');
        return true;
      } else if (requestedRole === 'camera') {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }, 
          audio: true 
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setMediaPermission('granted');
        return true;
      }
    } catch (err) {
      console.error('Media permission denied:', err);
      setMediaPermission('denied');
      setError('Media permission denied. Please allow access to continue.');
      return false;
    }
  };

  const joinSession = async () => {
    if (!socket || !sessionId || !role) return;

    const hasPermission = await requestMediaPermission(role);
    if (!hasPermission) return;

    socket.emit('join-session', { sessionId, role, nickname }, (response) => {
      if (response.error) {
        setError(response.error);
        return;
      }

      setIsJoined(true);
      setSessionId(sessionId);

      if (role === 'camera') {
        startCameraStreaming();
      }
    });
  };

  const startCameraStreaming = async () => {
    if (!streamRef.current || !socket) return;

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });

      peerConnectionRef.current = pc;

      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', { 
            targetDeviceId: 'host', 
            candidate: event.candidate 
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('camera-offer', { 
        deviceId: socket.id, 
        offer: pc.localDescription 
      });

      socket.on('camera-answer', async ({ answer }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      });

      setIsLive(true);

      if ('wakeLock' in navigator) {
        try {
          await navigator.wakeLock.request('screen');
        } catch (err) {
          console.log('Wake Lock not supported');
        }
      }

    } catch (err) {
      console.error('Error starting camera streaming:', err);
      setError('Failed to start camera streaming');
    }
  };

  const stopCameraStreaming = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsLive(false);
  };

  const leaveSession = () => {
    stopCameraStreaming();
    socket.disconnect();
    window.location.href = '/';
  };

  const getAvailableCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'videoinput');
    } catch (err) {
      console.error('Error enumerating devices:', err);
      return [];
    }
  };

  if (error) {
    return (
      <div className="app">
        <div className="error-container">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => window.location.href = '/'} className="btn btn-primary">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="app">
        <div className="join-container">
          <h1>Iris SYNCD</h1>
          <p>Enter session code to join</p>
          <input
            type="text"
            placeholder="Session Code"
            value={sessionId || ''}
            onChange={(e) => setSessionId(e.target.value.toUpperCase())}
            maxLength={8}
          />
          <button 
            onClick={() => setSessionId(sessionId)} 
            className="btn btn-primary"
            disabled={!sessionId || sessionId.length !== 8}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="app">
        <div className="role-selection">
          <h1>Join Session</h1>
          <p>Session: {sessionId}</p>

          <div className="role-options">
            <button
              onClick={() => setRole('speaker')}
              className="role-option"
            >
              <span className="role-icon">🔊</span>
              <span className="role-title">Join as Speaker</span>
              <span className="role-description">
                Play audio from the host on this device
              </span>
            </button>

            <button
              onClick={() => setRole('camera')}
              className="role-option"
            >
              <span className="role-icon">📹</span>
              <span className="role-title">Join as Camera</span>
              <span className="role-description">
                Stream video to the host dashboard
              </span>
            </button>
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
            {role === 'speaker' 
              ? 'Allow audio access to play music from the host'
              : 'Allow camera and microphone access to stream video'}
          </p>

          <div className="permission-card">
            <h3>
              {role === 'speaker' ? 'Audio Access' : 'Camera & Microphone'}
            </h3>
            <p>
              {role === 'speaker'
                ? 'We need audio access to play the host\'s music on your device'
                : 'We need camera access to stream video and microphone for audio'}
            </p>
          </div>

          <input
            type="text"
            placeholder="Your nickname (optional)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />

          <div className="permission-buttons">
            <button onClick={() => setRole(null)} className="btn btn-secondary">
              Back
            </button>
            <button onClick={joinSession} className="btn btn-primary">
              Allow & Join
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
          <span className="role-badge">{role}</span>
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
            </div>

            <div className="camera-controls">
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
