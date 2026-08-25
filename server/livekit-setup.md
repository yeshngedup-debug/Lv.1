# Signaling Architecture (Not LiveKit)

> **Note:** Iris SYNCD **does not use LiveKit**. This document describes the actual signaling implementation.

## Architecture: Socket.IO + Raw WebRTC

Iris SYNCD uses a custom signaling layer built on **Socket.IO** with **raw WebRTC P2P** — no SFU/MCU, no LiveKit, no mediasoup.

```
┌──────────────┐         Socket.IO (WebSocket)          ┌──────────────┐
│  Host Dash   │ ◄─────────────────────────────────────► │  Participant │
│  (React)     │                                          │  (PWA)       │
└──────┬───────┘                                          └──────┬───────┘
       │                                                       │
       └────────────────── WebRTC P2P (DTLS-SRTP) ─────────────┘
                    ▲                           ▲
                    │                           │
            STUN: stun.l.google.com:19302   TURN: metered.ca / coturn
```

## Signaling Events (Socket.IO)

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `create-session` | Host → Server | `{}` | Create session, get `sessionId`, `joinUrl`, `hostToken` |
| `rejoin-session` | Host → Server | `{sessionId}` | Reclaim host privileges after reload |
| `join-session` | Device → Server | `{sessionId, role, nickname, isCameraEnabled, isSpeakerEnabled}` | Join as camera/speaker/both |
| `camera-offer` | Device → Host | `{deviceId, offer}` | WebRTC offer from participant |
| `camera-answer` | Host → Device | `{deviceId, answer}` | WebRTC answer from host |
| `ice-candidate` | Both → Both | `{candidate, fromDeviceId, targetDeviceId}` | ICE candidates (namespaced) |
| `device-cameras` | Device → Host | `{cameras: []}` | Enumerate available cameras |
| `camera-switched` | Device → Host | `{cameraId}` | Notify active camera change |
| `switch-camera` | Host → Device | `{deviceId, cameraId}` | Host requests camera switch |
| `push-to-talk-offer/answer` | Host ↔ Device | `{deviceId, offer/answer}` | Dedicated audio PC for PTT |
| `playback-state` | Host → All | `{isPlaying, trackId, position}` | Server-authoritative playback |

## Session State

```javascript
class Session {
  id: string;                    // 8-char uppercase
  hostSocketId: string;          // Socket.io ID of host
  hostToken: string;             // UUID, reissued on rejoin
  devices: Map<deviceId, Device>;
  playback: {                    // Audio broadcast state
    trackId: string|null;
    trackUrl: string|null;
    trackName: string|null;
    duration: number;
    isPlaying: boolean;
    position: number;
    startedAt: number|null;
  };
  createdAt: number;
  expiresAt: number;             // Default 1 hour TTL
}
```

## Device Roles

| Role | Camera | Audio Playback | Use Case |
|---|---|---|---|
| `camera` | ✅ | ❌ | Phone as dedicated camera |
| `speaker` | ❌ | ✅ | Phone as dedicated speaker |
| `device` | ✅ (toggle) | ✅ (toggle) | Single phone doing both |

## Scaling Considerations

| Concern | Current | Future |
|---|---|---|
| Horizontal scaling | Socket.IO Redis adapter (optional) | Sticky sessions required |
| Session store | In-memory Map + optional Redis | Redis-only with TTL |
| Media relay | None (P2P) | Consider SFU for >20 peers |
| Load balancing | Render single instance | Multiple regions + geo-DNS |

## Why Not LiveKit / Mediasoup?

| Factor | Decision |
|---|---|
| Complexity | Avoided SFU complexity for <20 peer sessions |
| Cost | Zero infrastructure cost (P2P) |
| Latency | P2P is lower latency for small meshes |
| Flexibility | Full control over signaling + ICE logic |

## Adding an SFU Later

If peer count grows beyond ~20, migrate to **Mediasoup** or **LiveKit**:
1. Replace Socket.IO signaling with SFU protocol
2. Host becomes SFU producer; participants become consumers
3. `PeerConnectionManager` becomes `ConsumerManager`
4. Camera switching → `consumer.requestKeyFrame()` or new track

---

**TL;DR:** Current stack is Socket.IO signaling + WebRTC P2P. No LiveKit needed for current scale.