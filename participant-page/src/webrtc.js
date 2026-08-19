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
    this._iceCandidateHandler = null;
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
      console.log('Participant received track:', event.track.kind, event.streams.length);
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('Participant connection state:', this.pc.connectionState);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
    };

    this._iceCandidateHandler = async ({ candidate }) => {
      console.log('Participant received ICE candidate over socket');
      await this.addIceCandidate(candidate);
    };
    this.socket.on('ice-candidate', this._iceCandidateHandler);
  }

  async addIceCandidate(candidate) {
    if (!candidate) return;

    if (!this.pc.remoteDescription) {
      console.log('Participant queuing ICE candidate because remote description is not set yet');
      this.iceQueue.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('Participant successfully added ICE candidate');
    } catch (err) {
      console.error('Participant error adding ICE candidate:', err);
    }
  }

  async drainIceQueue() {
    console.log('Participant draining queued ICE candidates:', this.iceQueue.length);
    while (this.iceQueue.length > 0) {
      const candidate = this.iceQueue.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Participant successfully added queued ICE candidate');
      } catch (err) {
        console.error('Participant error adding queued ICE candidate:', err);
      }
    }
  }

  async addLocalStream(stream) {
    this.localStream = stream;
    console.log('Adding local stream tracks:', stream.getTracks().length);
    stream.getTracks().forEach(track => {
      console.log('Adding track:', track.kind);
      this.pc.addTrack(track, stream);
    });
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('Participant created offer, localDescription:', this.pc.localDescription?.type);
    console.log('Participant offer SDP has video:', this.pc.localDescription?.sdp?.includes('m=video'));
    console.log('Participant localDescription transceivers:', this.pc.getTransceivers().map(t => ({ mid: t.mid, direction: t.direction, senderTrack: t.sender.track?.kind, receiverTrack: t.receiver.track?.kind })));
    return this.pc.localDescription;
  }

  async handleOffer(offer) {
    console.log('Participant handleOffer called, offer type:', offer?.type);
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('Participant remoteDescription set, transceivers:', this.pc.getTransceivers().map(t => ({ mid: t.mid, direction: t.direction, senderTrack: t.sender.track?.kind, receiverTrack: t.receiver.track?.kind })));
    await this.drainIceQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    console.log('Participant created answer, localDescription:', this.pc.localDescription?.type);
    return this.pc.localDescription;
  }

  async handleAnswer(answer) {
    console.log('Participant setting remote answer');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.drainIceQueue();
  }

  close() {
    if (this._iceCandidateHandler) {
      this.socket.off('ice-candidate', this._iceCandidateHandler);
      this._iceCandidateHandler = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.localStream = null;
    this.remoteStream = null;
    this.iceQueue = [];
  }
}