import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { AudioSync } from './audioSync';
import { requestWakeLock, releaseWakeLock } from './sw';
import { getIceServers } from './webrtc';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

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
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [reconnecting, setReconnecting] = useState(false);

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
      if (sessionId && isJoined && role) {
        newSocket.emit('join-session', { sessionId, role, nickname }, (response) => {
          if (response.error) {
            console.error('Rejoin failed:', response.error);
            setIsJoined(false);
            setRole(null);
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
  }, [SOCKET_URL, sessionId, isJoined, role, nickname]);

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
        // For speaker, we just need to verify audio context can be created
        // Actual audio playback doesn't require getUserMedia
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.close();
        setMediaPermission('granted');
        return true;
      } else if (requestedRole === 'camera') {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
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
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Media permission denied. Please allow access in browser settings and try again.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera/microphone found. Please connect a device and try again.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera/microphone is in use by another application. Please close other apps and try again.');
      } else {
        setError(`Media error: ${err.message}. Please try again.`);
      }
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
      const pc = new RTCPeerConnection(getIceServers());

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

      pc.onconnectionstatechange = () => {
        console.log('Camera connection state:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setError('Camera connection lost. Attempting to reconnect...');
          setTimeout(() => {
            if (isJoined && role === 'camera') {
              stopCameraStreaming();
              startCameraStreaming();
            }
          }, 5000);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('camera-offer', {
        deviceId: socket.id,
        offer: pc.localDescription
      });

      socket.on('camera-answer', async ({ answer }) => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error('Failed to set remote description:', err);
        }
      });

      setIsLive(true);

      // Request wake lock to keep screen on
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
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

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
  };

  const leaveSession = () => {
    stopCameraStreaming();
    if (audioSyncRef.current) {
      audioSyncRef.current.destroy();
    }
    socket.disconnect();
    window.location.href = '/';
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