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
      iceCandidatePoolSize: 10
    };
  }

  return { iceServers: baseServers, iceCandidatePoolSize: 10 };
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
    this.iceQueue = [];

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
      console.log('Host received track:', event.track.kind, event.streams.length);
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('Host connection state:', this.pc.connectionState);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
    };
  }

  async addIceCandidate(candidate) {
    if (!candidate) return;

    if (!this.pc.remoteDescription) {
      console.log('Host queuing ICE candidate because remote description is not set yet');
      this.iceQueue.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('Host successfully added ICE candidate');
    } catch (err) {
      console.error('Host error adding ICE candidate:', err);
    }
  }

  async drainIceQueue() {
    console.log('Host draining queued ICE candidates:', this.iceQueue.length);
    while (this.iceQueue.length > 0) {
      const candidate = this.iceQueue.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Host successfully added queued ICE candidate');
      } catch (err) {
        console.error('Host error adding queued ICE candidate:', err);
      }
    }
  }

  async handleOffer(offer) {
    console.log('Host handleOffer called, offer type:', offer?.type);
    console.log('Host offer SDP has video:', offer?.sdp?.includes('m=video'));
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('Host remoteDescription set, transceivers:', this.pc.getTransceivers().map(t => ({ mid: t.mid, direction: t.direction, senderTrack: t.sender.track?.kind, receiverTrack: t.receiver.track?.kind })));
    await this.drainIceQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    console.log('Host created answer, localDescription:', this.pc.localDescription?.type);
    console.log('Host answer SDP has video:', this.pc.localDescription?.sdp?.includes('m=video'));
    return this.pc.localDescription;
  }

  close() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.localStream = null;
    this.remoteStream = null;
    this.iceQueue = [];
  }
}