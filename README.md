# Iris SYNCD

Multi-device party AV controller. A host laptop broadcasts a music track and
talks to the room; phones join by QR code and become **speakers** (lip-synced
playback), **cameras** (live video back to the host), or both — all over
WebRTC, with a Socket.IO signaling server.

```
┌──────────────┐   socket.io    ┌────────────────┐   socket.io   ┌──────────────┐
│ Host Dashboard│◄─────────────►│  Signaling     │◄─────────────►│ Participant  │
│ (React/Vite) │               │  Server (Node) │               │ PWA (React)  │
└──────┬───────┘               └────────┬───────┘               └──────┬───────┘
       │        WebRTC media (P2P, DTLS-SRTP encrypted)                │
       └───────────────────────►◄──────────────────────────────────────┘
       ▲                                        │
       │  HTTP: track upload/download           │
       └────────────────────────────────────────┘
```

## Features

| Area             | What works                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions         | Create via dashboard, share via QR / link (`/join/:CODE`), rejoin after refresh                                                                      |
| Fleet            | Live device list, per-device volume, remove device, presence heartbeats                                                                              |
| Video            | Multi-camera devices; host switches active camera live via `replaceTrack` (no renegotiation)                                                         |
| Audio broadcast  | Upload a track → server stores it → participants stream it over HTTP, drift-corrected every 2 s against a server clock (NTP-style offset estimation) |
| Playback control | Play / pause / resume / seek / end — server-authoritative state machine, all clients converge                                                        |
| Push-to-talk     | Host mic streamed to every connected device over dedicated WebRTC audio PCs                                                                          |
| Recording        | Participants can record their outgoing feed locally (IndexedDB persistence)                                                                          |

## Repository layout

```
server/            Express + Socket.IO signaling
  src/index.js     Single-file server (WebSocket + HTTP + static hosting)
host-dashboard/    Host control center (React 18 + Vite)
  src/App.jsx      Main dashboard component
  src/components/  CameraFeedTile, DeviceCard, AudioBroadcast, GridlineShell
  src/webrtc.js    Shared WebRTC utilities re-export
participant-page/  Mobile PWA (React 18 + Vite + Workbox)
  src/App.jsx      Join flow, camera streaming, audio sync
  src/webrtc.js    Shared WebRTC utilities re-export
shared/webrtc/     PeerConnectionManager + ICE/STUN/TURN helpers
tests/             Node native test suite (signaling + HTTP API)
```

## Quick start

```bash
# Install all workspaces
npm install

# Dev (runs all three workspaces concurrently)
npm run dev

# Build production bundles
npm run build

# Run tests
npm test

# Start production server (serves static builds + API + WebSocket)
npm start
```

## Environment variables

| Variable               | Default                           | Description                                               |
| ---------------------- | --------------------------------- | --------------------------------------------------------- |
| `PORT`                 | `3001`                            | HTTP/WebSocket port                                       |
| `BASE_URL`             | `http://localhost:3001`           | Public base URL for QR codes                              |
| `RENDER_EXTERNAL_URL`  | (injected)                        | Render injects this automatically                         |
| `CORS_ORIGIN`          | `https://iris-syncd.onrender.com` | Comma-separated allowlist                                 |
| `SESSION_TIMEOUT`      | `3600000`                         | Session TTL (ms)                                          |
| `LOG_LEVEL`            | `info`                            | Winston log level                                         |
| `REDIS_URL`            | (optional)                        | Redis connection string for horizontal scaling            |
| `VITE_TURN_URL`        | (required for prod)               | TURN server URL (e.g., `turn:global.relay.metered.ca:80`) |
| `VITE_TURN_USERNAME`   | (required for prod)               | TURN username                                             |
| `VITE_TURN_CREDENTIAL` | (required for prod)               | TURN credential                                           |
| `SENTRY_DSN`           | (optional)                        | Sentry DSN for error tracking                             |

## Production deployment (Render)

1. Push to GitHub
2. In Render dashboard: **New +** → **Blueprint** → select this repo
3. Provision a Redis instance and add its internal URL as `REDIS_URL`
4. Add TURN credentials from [metered.ca](https://metered.ca) as `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`
5. Add Sentry DSN as `SENTRY_DSN` for error tracking
6. Deploy — `render.yaml` defines the build/start commands and health checks

Health check endpoints:

- `/api/health` — basic liveness
- `/api/metrics` — Prometheus metrics (`iris_*`)

## WebRTC stack

- **Signaling**: Socket.IO (WebSocket + polling fallback)
- **Media**: Raw WebRTC P2P (`RTCPeerConnection`)
- **NAT traversal**: STUN (Google/Twilio) + TURN (metered.ca / coturn)
- **Encryption**: DTLS-SRTP (mandatory, no plaintext)
- **ICE restart**: Automatic on `failed` / `disconnected` state
- **Camera switching**: `RTCRtpSender.replaceTrack()` (no renegotiation)

## Observability

- **Errors/Traces**: Sentry (`@sentry/node`, `@sentry/react`)
- **Metrics**: Prometheus (`prom-client`) at `/api/metrics`
- **Logs**: Winston structured JSON (stdout)
- **Key metrics**: `iris_active_sessions`, `iris_connected_peers`, `iris_ice_connection_state_total`, `iris_negotiation_duration_seconds`, `iris_http_requests_total`

## License

MIT
