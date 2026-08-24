// Re-export shared WebRTC utilities
export { getIceServers, PeerConnectionManager } from '../../../shared/webrtc/index.js'; because remote description is not set yet');
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

  // For API consistency with participant-page PeerConnectionManager
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('Host created offer, localDescription:', this.pc.localDescription?.type);
    return this.pc.localDescription;
  }

  // For API consistency with participant-page PeerConnectionManager
  async handleAnswer(answer) {
    console.log('Host setting remote answer');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.drainIceQueue();
  }

  // For API consistency with participant-page PeerConnectionManager
  async addLocalStream(stream) {
    this.localStream = stream;
    console.log('Host adding local stream tracks:', stream.getTracks().length);
    stream.getTracks().forEach(track => {
      console.log('Host adding track:', track.kind);
      this.pc.addTrack(track, stream);
    });
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