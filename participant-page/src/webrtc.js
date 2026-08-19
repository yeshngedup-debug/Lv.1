const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const TURN_SERVERS = {
  iceServers: [
    ...ICE_SERVERS.iceServers,
    {
      urls: import.meta.env.VITE_TURN_URL || 'turn:localhost:3478',
      username: import.meta.env.VITE_TURN_USERNAME || 'iris',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || 'syncd'
    }
  ]
};

export class PeerConnectionManager {
  constructor(socket, targetDeviceId, isInitiator = false) {
    this.socket = socket;
    this.targetDeviceId = targetDeviceId;
    this.isInitiator = isInitiator;
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.onRemoteStream = null;
    this.onIceCandidate = null;
    this.onConnectionStateChange = null;

    this.init();
  }

  init() {
    this.pc = new RTCPeerConnection(TURN_SERVERS);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          targetDeviceId: this.targetDeviceId,
          candidate: event.candidate
        });
      }
    };

    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('Connection state:', this.pc.connectionState);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
    };

    this.socket.on('ice-candidate', async ({ candidate }) => {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });
  }

  async addLocalStream(stream) {
    this.localStream = stream;
    stream.getTracks().forEach(track => {
      this.pc.addTrack(track, stream);
    });
  }

  async createOffer() {
    if (!this.isInitiator) {
      throw new Error('Only initiator can create offer');
    }

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.socket.emit('camera-offer', {
      deviceId: this.socket.id,
      offer: this.pc.localDescription
    });

    return this.pc.localDescription;
  }

  async handleOffer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.socket.emit('camera-answer', {
      deviceId: this.targetDeviceId,
      answer: this.pc.localDescription
    });

    return this.pc.localDescription;
  }

  async handleAnswer(answer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  close() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}

export function getIceServers() {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    return TURN_SERVERS;
  }

  return ICE_SERVERS;
}
