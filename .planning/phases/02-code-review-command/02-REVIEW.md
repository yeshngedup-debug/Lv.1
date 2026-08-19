---
phase: 02-code-review-command
reviewed: 2026-08-19T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - host-dashboard/src/webrtc.js
  - participant-page/src/webrtc.js
  - host-dashboard/src/App.jsx
  - participant-page/src/App.jsx
findings:
  critical: 5
  warning: 7
  info: 5
  total: 17
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-08-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the recent changes fixing the blank camera stream issue in the Iris SYNCD project. The changes involve WebRTC peer connection setup across two frontend applications (host-dashboard and participant-page) and the signaling server. While the core fix (setting up `onRemoteStream` handler before handling the offer) appears correct, there are several critical issues around API inconsistency, missing ICE candidate handling, memory leaks, and code duplication that need addressing.

---

## Critical Issues

### CR-01: Missing ICE Candidate Handling in host-dashboard PeerConnectionManager

**File:** `host-dashboard/src/webrtc.js:43-68`
**Issue:** The `PeerConnectionManager` class in host-dashboard does not register a handler for incoming ICE candidates from the remote peer. The `init()` method sets up `onicecandidate` (outgoing) and `ontrack`, but there's no listener for incoming ICE candidates. In `host-dashboard/src/App.jsx:166-175`, the code directly accesses `pc.pc.addIceCandidate()` — reaching into the private `pc` property — which breaks encapsulation and will fail if the internal structure changes.

**Fix:**
```javascript
// In host-dashboard/src/webrtc.js init() method, add:
this.socket.on('ice-candidate', async ({ candidate, fromDeviceId }) => {
  // Only handle candidates for this peer connection
  if (fromDeviceId === this.targetDeviceId) {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});
```

And in `host-dashboard/src/App.jsx:166-175`, remove the direct `pc.pc` access and let the manager handle it.

---

### CR-02: Participant-page Camera Streaming Bypasses PeerConnectionManager

**File:** `participant-page/src/App.jsx:260-322`
**Issue:** The `startCameraStreaming()` function creates a raw `RTCPeerConnection` directly (line 264) instead of using the exported `PeerConnectionManager` class from `./webrtc`. This duplicates the WebRTC setup logic (ICE servers, ICE candidate handling, connection state monitoring) and creates two different code paths for the same functionality. Any fixes to `PeerConnectionManager` won't apply to the camera streaming path.

**Fix:**
```javascript
// In participant-page/src/App.jsx, use PeerConnectionManager:
import { PeerConnectionManager } from './webrtc';

const startCameraStreaming = async () => {
  if (!streamRef.current || !socket) return;

  try {
    const pc = new PeerConnectionManager(socket, 'host', true); // initiator = true
    peerConnectionRef.current = pc;

    await pc.addLocalStream(streamRef.current);

    pc.onConnectionStateChange = (state) => {
      console.log('Camera connection state:', state);
      if (state === 'failed' || state === 'disconnected') {
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
    // Note: PeerConnectionManager.createOffer() now emits internally
    // But we need to adjust since the current API expects return value

    // Request wake lock...
  } catch (err) {
    console.error('Error starting camera streaming:', err);
    setError('Failed to start camera streaming');
  }
};
```

Note: This requires updating `PeerConnectionManager.createOffer()` to not emit automatically when used as initiator from participant side, or adding a flag to control this behavior.

---

### CR-03: Memory Leak — Uncleaned Socket Listener in participant-page Camera Streaming

**File:** `participant-page/src/App.jsx:302-308`
**Issue:** In `startCameraStreaming()`, a socket listener for `camera-answer` is registered (line 302) but **never removed** in `stopCameraStreaming()` (lines 325-346). Every time the camera reconnects (which happens on connection failure per lines 283-290), a new listener is added without removing the old one. This causes:
- Memory leak (accumulating listeners)
- Multiple `setRemoteDescription` calls for the same answer
- Potential race conditions

**Fix:**
```javascript
// Store the handler reference to remove it later
let cameraAnswerHandler = null;

const startCameraStreaming = async () => {
  // ... existing code ...
  
  cameraAnswerHandler = async ({ answer }) => {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Failed to set remote description:', err);
    }
  };
  
  socket.on('camera-answer', cameraAnswerHandler);
  
  // ... rest of function
};

const stopCameraStreaming = () => {
  // ... existing cleanup ...
  
  if (cameraAnswerHandler) {
    socket.off('camera-answer', cameraAnswerHandler);
    cameraAnswerHandler = null;
  }
  
  // ... rest of function
};
```

---

## Warnings

### WR-01: No Cleanup for Socket Event Listener in participant-page PeerConnectionManager

**File:** `participant-page/src/webrtc.js:69-75`
**Issue:** The `init()` method registers `socket.on('ice-candidate', ...)` but the `close()` method (lines 102-107) doesn't remove this listener. If a `PeerConnectionManager` instance is closed and recreated, the old listener remains attached to the socket, causing duplicate ICE candidate processing.

**Fix:**
```javascript
// In participant-page/src/webrtc.js, store handler reference:
this._iceCandidateHandler = async ({ candidate }) => {
  try {
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('Error adding ICE candidate:', err);
  }
};

this.socket.on('ice-candidate', this._iceCandidateHandler);

// In close():
close() {
  if (this.pc) {
    this.pc.close();
    this.pc = null;
  }
  if (this._iceCandidateHandler) {
    this.socket.off('ice-candidate', this._iceCandidateHandler);
    this._iceCandidateHandler = null;
  }
}
```

---

### WR-02: Inconsistent PeerConnectionManager API Between Host and Participant

**Files:** `host-dashboard/src/webrtc.js` vs `participant-page/src/webrtc.js`
**Issue:** The two `PeerConnectionManager` classes have different APIs:
- **Host:** `createOffer()` emits `camera-offer` internally; `handleOffer()` emits `camera-answer` internally
- **Participant:** `createOffer()` returns offer; `handleOffer()` returns answer; caller emits

This inconsistency makes the code harder to maintain and reason about. The host version couples the manager to socket.io, while the participant version is more decoupled.

**Fix:** Standardize on one pattern. Recommended: decoupled pattern (participant style) where the manager handles WebRTC logic only, and the caller handles signaling.

---

### WR-03: Race Condition in ICE Candidate Handling (host-dashboard)

**File:** `host-dashboard/src/App.jsx:166-175`
**Issue:** The ICE candidate handler accesses `pc.pc` directly. If `camera-offer` arrives before `PeerConnectionManager.init()` completes, or if the connection was closed, `pc.pc` may be undefined or closed, causing an error.

**Fix:** Add a guard check and queue candidates if needed:
```javascript
socket.on('ice-candidate', async ({ candidate, fromDeviceId }) => {
  const pc = peerConnectionsRef.current.get(fromDeviceId);
  if (!pc || !pc.pc) {
    console.warn('PeerConnection not ready for ICE candidate from', fromDeviceId);
    return;
  }
  if (pc.pc.signalingState === 'closed') {
    console.warn('PeerConnection closed, ignoring ICE candidate');
    return;
  }
  try {
    await pc.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('Failed to add ICE candidate:', err);
  }
});
```

---

### WR-04: Missing Error Handling for videoElement.play()

**File:** `host-dashboard/src/App.jsx:149`
**Issue:** `videoElement.play().catch(err => console.error('Video play failed:', err))` only logs the error. The user sees a blank video with no indication of why. Common causes: autoplay policy, missing user gesture, or stream not ready.

**Fix:** Show user-facing error and/or retry:
```javascript
videoElement.play().catch(err => {
  console.error('Video play failed:', err);
  if (err.name === 'NotAllowedError') {
    // Autoplay blocked - show play button or prompt user interaction
    setError('Click to play video (autoplay blocked by browser)');
  } else {
    setError('Failed to play video stream');
  }
});
```

---

### WR-05: Duplicated getIceServers() and PeerConnectionManager Logic

**Files:** `host-dashboard/src/webrtc.js:1-26` and `participant-page/src/webrtc.js:1-26`
**Issue:** Both files contain identical `getIceServers()` function and nearly identical `PeerConnectionManager` class structure (~90% same code). This violates DRY and makes maintenance error-prone.

**Fix:** Extract to a shared package or common module:
```
shared/
  webrtc.js  // exports getIceServers, PeerConnectionManager base class
```

Or use a monorepo with a shared package.

---

### WR-06: Connection State Monitoring Only Logs — No Recovery

**File:** `host-dashboard/src/webrtc.js:62-67` and `participant-page/src/webrtc.js:62-67`
**Issue:** `onconnectionstatechange` only logs and calls a callback. No automatic recovery is attempted for `failed` or `disconnected` states. The participant-page App.jsx implements its own reconnection logic (lines 283-290), but host-dashboard has none.

**Fix:** Add reconnection logic to the manager or provide a standard callback interface for recovery:
```javascript
this.pc.onconnectionstatechange = () => {
  const state = this.pc.connectionState;
  console.log('Connection state:', state);
  
  if (this.onConnectionStateChange) {
    this.onConnectionStateChange(state);
  }
  
  // Optional: emit event for centralized handling
  if (state === 'failed' || state === 'disconnected') {
    this.socket.emit('connection-failed', { targetDeviceId: this.targetDeviceId });
  }
};
```

---

### WR-07: Inconsistent Parameter Naming in PeerConnectionManager

**File:** `host-dashboard/src/webrtc.js:30, 85-88`
**Issue:** Constructor parameter is `targetDeviceId` but `createOffer()` emits with `deviceId: this.socket.id` (the local socket ID, not the target). The `camera-offer` event on the server expects `deviceId` to be the camera's device ID, but the host sends its own socket ID.

**Fix:** Verify the signaling protocol matches:
```javascript
// In host-dashboard webrtc.js createOffer():
this.socket.emit('camera-offer', {
  deviceId: this.targetDeviceId,  // Should be target, not socket.id
  offer: this.pc.localDescription
});
```

---

## Info

### IN-01: Console.log Statements in Production Code

**Files:** Multiple files (webrtc.js:63, 160; App.jsx:48, 63, 73, 138, 160, etc.)
**Issue:** Numerous `console.log` statements that will clutter production logs. Should use a debug flag or logging library.

**Fix:** Wrap in `if (import.meta.env.DEV)` or use a logger:
```javascript
const debug = import.meta.env.DEV;
if (debug) console.log('Connection state:', this.pc.connectionState);
```

---

### IN-02: No TypeScript — Missing Type Safety for WebRTC

**Files:** All `.js`/`.jsx` files
**Issue:** WebRTC APIs have complex types (RTCPeerConnection, RTCSessionDescription, MediaStream, etc.). Without TypeScript, type errors only surface at runtime.

**Fix:** Migrate to TypeScript (`.tsx` files) for better developer experience and catch errors at compile time.

---

### IN-03: Magic Numbers for Video Constraints

**File:** `participant-page/src/App.jsx:205-207`
**Issue:** Hardcoded video constraints (`width: { ideal: 1280 }, height: { ideal: 720 }`) should be configurable constants.

**Fix:**
```javascript
const VIDEO_CONSTRAINTS = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 720 }
};
```

---

### IN-04: Missing Cleanup for MediaStream in host-dashboard

**File:** `host-dashboard/src/App.jsx:350-354`
**Issue:** `endSession()` closes peer connections but doesn't stop local media tracks if any were created (e.g., for push-to-talk).

**Fix:** Track and stop all local streams in a ref:
```javascript
const localStreamsRef = useRef(new Set());

// When creating streams:
localStreamsRef.current.add(stream);

// In endSession():
localStreamsRef.current.forEach(stream => {
  stream.getTracks().forEach(track => track.stop());
});
localStreamsRef.current.clear();
```

---

### IN-05: Session Cleanup on Expired Check May Race with Active Connections

**File:** `server/src/index.js:433-438`
**Issue:** The interval that checks for expired sessions calls `io.to(...).emit('session-ended')` then deletes the session. If a device is in the middle of reconnecting, this could cause a race where the session is deleted before reconnection completes.

**Fix:** Add a grace period or check for active reconnections before deleting:
```javascript
setInterval(() => {
  for (const [sessionId, session] of sessions.entries()) {
    if (session.isExpired()) {
      // Check if host is attempting to reconnect
      const hostSocket = io.sockets.sockets.get(session.hostSocketId);
      if (!hostSocket || hostSocket.disconnected) {
        io.to(`session:${sessionId}`).emit('session-ended');
        sessions.delete(sessionId);
      }
    }
  }
}, 60000);
```

---

_Reviewed: 2026-08-19T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_