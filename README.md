# Iris SYNCD

Multi-device party AV controller. A host laptop broadcasts a music track and
talks to the room; phones join by QR code and become **speakers** (lips-synced
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

| Area | What works |
|---|---|
| Sessions | Create via dashboard, share via QR / link (`/join/:CODE`), rejoin after refresh |
| Fleet | Live device list, per-device volume, remove device, presence heartbeats |
| Video | Multi-camera devices; host switches active camera live via `replaceTrack` (no renegotiation) |
| Audio broadcast | Upload a track → server stores it → participants stream it over HTTP, drift-corrected every 2 s against a server clock (NTP-style offset estimation) |
| Playback control | Play / pause / resume / seek / end — server-authoritative state machine, all clients converge |
| Push-to-talk | Host mic streamed to every connected device over dedicated WebRTC audio PCs |
| Recording | Participants can record their outgoing feed locally (IndexedDB persistence) |

## Repository layout

```
server/            Express + Socket.IO signaling, upload API, playback state machine
host-dashboard/    React host app (Vite)
participant-page/  React participant PWA (Vite + vite-plugin-pwa)
shared/webrtc/     PeerConnectionManager used by both frontends
tests/             Node built-in test-runner suite (no test dependencies)
render.yaml        Render blueprint
```

## Local development

Requirements: Node 20+ (built-in test runner and `--watch`).

```bash
npm install          # installs all workspaces
npm run dev          # server :3001 · host :5173 · participant :5174
npm test             # integration + unit suite (13 tests)
```

Windows shortcut: `start.cmd` does install + launch of all three.

The Vite dev servers proxy `/socket.io` and `/api` to `localhost:3001`, so the
apps work out of the box. `BASE_URL` is only needed when participants are on
other devices on your LAN — set it to your machine's LAN IP:

```bash
# server/.env
PORT=3001
BASE_URL=http://192.168.1.50:3001
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP + WebSocket port |
| `RENDER_EXTERNAL_URL` / `BASE_URL` | `http://localhost:$PORT` | Absolute base for QR/join URLs |
| `NODE_ENV` | `development` | `production` enables static serving, SPA fallback, strict CSP |
| `CORS_ORIGIN` | `*` | Comma-separated origin allowlist for prod |
| `SESSION_TIMEOUT` | `3600000` | Idle session lifetime (ms) |
| `LOG_LEVEL` | `info` | Winston level |
| `REDIS_URL` | – | Enables the Socket.IO Redis adapter (horizontal scaling) |
| `UPLOAD_RATE_LIMIT_MAX` | `30` | Track uploads allowed per 10 min |
| `RATE_LIMIT_*` | see `server/src/index.js` | General `/api` limiter knobs |
| `VITE_SOCKET_URL` | same-origin | Frontend override for the signaling server |
| `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | – | TURN relay for restrictive NATs (both frontends) |

> **TURN in production:** without a TURN server, devices behind symmetric NATs
> may fail to connect. Add Metered/Cloudflare/Xirsys credentials as
> `VITE_TURN_*` build-time env vars before `npm run build`.

## Testing

```bash
npm test
```

The suite boots the real server in-process (random port) and covers:
playback snapshot math (drift/clamping), uploaded-file lifecycle cleanup,
HTTP validation and auth guards, the full signaling lifecycle (create → join →
upload → play/seek/pause/resume → role enforcement → teardown), heartbeat-based
presence, clock sync, and PTT relays. It exits hard if anything hangs, so CI
can never wedge.

## Deployment (Render)

1. Push this repo to GitHub/GitLab.
2. In Render: **New + → Blueprint**, select the repo — `render.yaml` is picked up.
3. Set `CORS_ORIGIN` to your final `https://<service>.onrender.com` URL once known.
4. Deploy. Build runs `npm install && npm run build && npm test`; health checks hit `/api/health`.

Production behavior enabled by `NODE_ENV=production`:

- Both SPAs are served from their `dist/` folders (`/` = host, `/join/*` = participant).
- SPA fallback returns the correct `index.html` for deep links — **QR scans work**.
- Strict Helmet CSP (no inline scripts; Google Fonts allowlisted).
- Uploaded tracks live on local disk under `uploads/`.

### Platform notes & limitations

- **Ephemeral disk:** Render free tier wipes local storage on deploys/restarts.
  Uploaded tracks disappear — hosts simply re-select the file. For durable
  storage, mount a Render Disk or swap `uploads/` for object storage (S3/R2)
  in `server/src/index.js`.
- **Scaling:** one instance works out of the box. Multiple instances need
  `REDIS_URL` **and** sticky sessions; sessions also live in an in-process Map.
- **Autoplay policies:** participant audio starts from a user gesture (join
  button); iOS may still require a tap on lock-screen controls.
- **Free plan spin-down:** cold starts delay the first QR scan; upgrade or ping
  `/api/health` on a cron to keep warm.

## Security model

- Session codes are 8-char UUID slices; all session-scoped routes validate the format.
- Privileged HTTP routes (track upload) require an **X-Host-Token** issued at
  session create/rejoin and rotated on every host rejoin.
- All playback control events enforce `role === 'host'` server-side and always ack.
- Rate limits: general `/api` budget plus a stricter upload budget.
- Media never touches the server: WebRTC is DTLS-SRTP end-to-end encrypted.

## Maintenance notes

- The signaling protocol lives in three places that must agree:
  `server/src/index.js`, `host-dashboard/src/App.jsx`,
  `participant-page/src/App.jsx` (+ `shared/webrtc/index.js`). When adding an
  event, add a relay handler *and* both client handlers *and* a test.
- ICE channels are namespaced (`ice-candidate` for cameras,
  `ptt-ice-candidate` for push-to-talk) so parallel PCs don't cross-contaminate.
- `workbox-*.js` hashes change per build — never hardcode service-worker asset
  routes; the `/join` static mount handles them.
