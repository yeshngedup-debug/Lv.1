export function getIceServers() {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  const baseServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
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
      ]
    };
  }

  return { iceServers: baseServers };
}

export class PeerConnectionManager {
  constructor(socket, targetDeviceId, isInitiator = false) {
    this.socket = socket;
    this.targetDeviceId = targetDeviceId;
    this.isInitiator = isInitiator;
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.onRemoteStream = null;
    this.onConnectionStateChange = null;

    this.init();
  }

  init() {
    this.pc = new RTCPeerConnection(getIceServers());

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
  }

  async addIceCandidate(candidate) {
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  async handleOffer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription;
  }

  close() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.localStream = null;
    this.remoteStream = null;
  }
}
