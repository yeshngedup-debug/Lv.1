/**
 * Shared WebRTC utilities for Iris SYNCD
 * Used by both host-dashboard and participant-page
 */

export function getIceServers(): RTCConfiguration {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  const baseServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  if (turnUrl && turnUsername && turnCredential) {
    return {
      iceServers: [
        ...baseServers,
        {
          urls: turnUrl,
          username: turnUsername,
          credential: turnCredential,
        },
      ],
      iceCandidatePoolSize: 10,
    };
  }

  // No TURN configured - use STUN only, allow direct P2P
  return { iceServers: baseServers, iceCandidatePoolSize: 10 };
}

export function createRTCPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers });
}

/** Minimal structural type so we don't couple to socket.io-client's types here */
export interface SignalingSocket {
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: any) => void): void;
  off(event: string, handler?: (payload: any) => void): void;
}

export interface PeerConnectionManagerOptions {
  onRemoteStream?: ((stream: MediaStream) => void) | null;
  onConnectionStateChange?: ((state: RTCPeerConnectionState | 'closed') => void) | null;
  iceEventName?: string;
}

export class PeerConnectionManager {
  socket: SignalingSocket;
  targetDeviceId: string;
  isInitiator: boolean;
  pc: RTCPeerConnection | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onRemoteStream: ((stream: MediaStream) => void) | null;
  onConnectionStateChange: ((state: RTCPeerConnectionState | 'closed') => void) | null;
  // Namespaced ICE channel lets multiple parallel PCs to the same peer
  // (e.g. camera + push-to-talk) route candidates without cross-talk
  _iceEventName: string;
  iceQueue: RTCIceCandidateInit[];
  _iceCandidateHandler:
    ((payload: { candidate: RTCIceCandidateInit; fromDeviceId: string }) => void) | null;
  _closed: boolean;

  constructor(
    socket: SignalingSocket,
    targetDeviceId: string,
    isInitiator = false,
    options: PeerConnectionManagerOptions = {},
  ) {
    this.socket = socket;
    this.targetDeviceId = targetDeviceId;
    this.isInitiator = isInitiator;
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.onRemoteStream = options.onRemoteStream || null;
    this.onConnectionStateChange = options.onConnectionStateChange || null;
    this._iceEventName = options.iceEventName || 'ice-candidate';
    this.iceQueue = [];
    this._iceCandidateHandler = null;
    this._closed = false;

    this.init();
  }

  init(): void {
    this.pc = new RTCPeerConnection(getIceServers());
    const pc = this.pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && !this._closed) {
        this.socket.emit(this._iceEventName, {
          targetDeviceId: this.targetDeviceId,
          candidate: event.candidate,
        });
      }
    };

    this._iceCandidateHandler = async ({ candidate, fromDeviceId }) => {
      if (fromDeviceId === this.targetDeviceId && !this._closed) {
        await this.addIceCandidate(candidate);
      }
    };
    this.socket.on(this._iceEventName, this._iceCandidateHandler);

    pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(pc.connectionState);
      }
      if (pc.connectionState === 'failed' && !this._closed) {
        console.warn('WebRTC connection failed, attempting ICE restart...');
        pc.restartIce();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' && !this._closed) {
        console.warn('ICE connection failed, restarting ICE...');
        pc.restartIce();
      }
    };
  }

  // Expose live connection state so UI status indicators reflect reality
  get connectionState(): RTCPeerConnectionState | 'closed' {
    return this.pc ? this.pc.connectionState : 'closed';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit | null | undefined): Promise<void> {
    if (!candidate || this._closed || !this.pc) return;

    if (!this.pc.remoteDescription) {
      this.iceQueue.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('addIceCandidate error:', err);
    }
  }

  async flushIceQueue(): Promise<void> {
    while (this.iceQueue.length > 0) {
      const candidate = this.iceQueue.shift();
      await this.addIceCandidate(candidate);
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit | null> {
    if (!this.pc || this._closed) return null;
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.pc.setLocalDescription(offer);
      await this.flushIceQueue();
      return offer;
    } catch (err) {
      console.error('createOffer error:', err);
      return null;
    }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit | null> {
    if (!this.pc || this._closed) return null;
    try {
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.flushIceQueue();
      return answer;
    } catch (err) {
      console.error('createAnswer error:', err);
      return null;
    }
  }

  // FIXED: host and participant call these methods but they never existed,
  // so every offer/answer exchange threw TypeError and WebRTC never connected
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | null> {
    await this.setRemoteDescription(offer);
    return this.createAnswer();
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.setRemoteDescription(answer);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc || this._closed) return;
    try {
      await this.pc.setRemoteDescription(description);
      await this.flushIceQueue();
    } catch (err) {
      console.error('setRemoteDescription error:', err);
    }
  }

  addLocalStream(stream: MediaStream): void {
    if (this._closed || !this.pc) return;
    this.localStream = stream;
    stream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, stream);
    });
  }

  close(): void {
    this._closed = true;
    if (this._iceCandidateHandler) {
      this.socket.off(this._iceEventName, this._iceCandidateHandler);
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.localStream = null;
    this.remoteStream = null;
  }
}
