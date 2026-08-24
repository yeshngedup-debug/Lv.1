/**
 * Shared WebRTC utilities for Iris SYNCD
 * Used by both host-dashboard and participant-page
 */

export function getIceServers() {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  const baseServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ];

  if (turnUrl && turnUsername && turnCredential) {
    return {
      iceServers: [
        ...baseServers,
        {
          urls: turnUrl,
          username: turnUsername,
          credential: turnCredential
        }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'relay'
    };
  }

  return { iceServers: baseServers, iceCandidatePoolSize: 10 };
}

export class PeerConnectionManager {
  constructor(socket, targetDeviceId, isInitiator = false, options = {}) {
    this.socket = socket;
    this.targetDeviceId = targetDeviceId;
    this.isInitiator = isInitiator;
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.onRemoteStream = options.onRemoteStream || null;
    this.onConnectionStateChange = options.onConnectionStateChange || null;
    this.iceQueue = [];
    this._iceCandidateHandler = null;
    this._closed = false;

    this.init();
  }

  init() {
    this.pc = new RTCPeerConnection(getIceServers());

    this.pc.onicecandidate = (event) => {
      if (event.candidate && !this._closed) {
        this.socket.emit('ice-candidate', {
          targetDeviceId: this.targetDeviceId,
          candidate: event.candidate
        });
      }
    };

    this._iceCandidateHandler = async ({ candidate, fromDeviceId }) => {
      if (fromDeviceId === this.targetDeviceId && !this._closed) {
        await this.addIceCandidate(candidate);
      }
    };
    this.socket.on('ice-candidate', this._iceCandidateHandler);

    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
      if (this.pc.connectionState === 'failed' && !this._closed) {
        console.warn('WebRTC connection failed, attempting ICE restart...');
        this.pc.restartIce();
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed' && !this._closed) {
        console.warn('ICE connection failed, restarting ICE...');
        this.pc.restartIce();
      }
    };
  }

  async addIceCandidate(candidate) {
    if (!candidate || this._closed) return;

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

  async flushIceQueue() {
    while (this.iceQueue.length > 0) {
      const candidate = this.iceQueue.shift();
      await this.addIceCandidate(candidate);
    }
  }

  async createOffer() {
    if (!this.pc || this._closed) return null;
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await this.pc.setLocalDescription(offer);
      await this.flushIceQueue();
      return offer;
    } catch (err) {
      console.error('createOffer error:', err);
      return null;
    }
  }

  async createAnswer() {
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

  async setRemoteDescription(description) {
    if (!this.pc || this._closed) return;
    try {
      await this.pc.setRemoteDescription(description);
      await this.flushIceQueue();
    } catch (err) {
      console.error('setRemoteDescription error:', err);
    }
  }

  addLocalStream(stream) {
    if (this._closed) return;
    this.localStream = stream;
    stream.getTracks().forEach(track => {
      this.pc.addTrack(track, stream);
    });
  }

  close() {
    this._closed = true;
    if (this._iceCandidateHandler) {
      this.socket.off('ice-candidate', this._iceCandidateHandler);
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.localStream = null;
    this.remoteStream = null;
  }
}