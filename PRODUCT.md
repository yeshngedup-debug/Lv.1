# Iris SYNCD — Product Truth

## Identity
**Name:** Iris SYNCD
**Tagline:** Sync music & cameras across every device at the party
**Platform:** Web (React + Vite) — Host desktop app + Participant mobile PWA
**Architecture:** Node/Socket.io signaling + WebRTC P2P mesh for ultra-low-latency sync
**Status:** Production-ready (deployed on Render)

## Roles & Workflows

### Host (Desktop Control Center)
- **Create session** — generates unique session ID + QR join code
- **Device fleet** — sees all connected participants (cameras + speakers) with live status
- **Camera wall** — multi-cam grid with per-tile listen/PTZ/fullscreen
- **PTZ controls** — pan/tilt/zoom for motorized cameras
- **Audio player** — upload/play/pause/seek/volume, real-time equalizer visualization
- **Network metrics** — latency, bandwidth, peer counts, connection health
- **Session control** — end session, copy invite link, manage recordings

### Participant (Mobile PWA)
- **Join flow** — scan QR / enter session ID + nickname → choose role (Camera / Speaker / Both)
- **Camera view** — live preview, switch cameras, toggle torch, quality selector
- **Audio sync** — timestamped playback offset compensation for perfect lip-sync
- **Wake lock** — prevents screen sleep during session
- **Recording** — local record + upload to host
- **Feature toggles** — motion detection, audio monitoring, network quality

## Core Features (Durable)
1. **Sub-20ms sync** — WebRTC mesh + Socket.io fallback, timestamped audio offsets
2. **PWA installable** — service worker, manifest, wake lock, offline join page
3. **Multi-cam per device** — cycle cameras, PTZ motor control via data channels
4. **Session persistence** — reconnect with same device ID, resume role
5. **No accounts** — ephemeral sessions, QR codes, peer IDs only

## Constraints & Non-Negotiables
- **Dark mode only** — `#0a0a0f` base, no light theme
- **Zero dependencies on heavy frameworks** — React + Vite + Socket.IO + WebRTC only
- **Mobile-first** — participant page targets phones in portrait
- **Privacy** — no analytics, no tracking, no persistent user data
- **Accessibility** — WCAG AA, focus-visible rings, semantic HTML, ARIA labels

## Technical Specs
| Layer | Stack |
|---|---|
| Signaling | Socket.IO v4 (WS + polling) |
| Media | WebRTC (RTCPeerConnection, DTLS-SRTP) |
| NAT Traversal | STUN (Google/Twilio) + TURN (metered.ca) |
| Transport | HTTP/1.1 + WebSocket, HTTPS in prod |
| State | In-memory Map + optional Redis (horizontal scaling) |
| Audio sync | Server clock offset (median of 5 RTT samples), drift correction every 2s |
| Video switching | `RTCRtpSender.replaceTrack()` — no SDP renegotiation |
| Push-to-talk | Dedicated audio-only PC per device |
| Recording | MediaRecorder → IndexedDB → POST to host |

## Production Hardening (v1.1.0+)
- ✅ **TURN support** — configurable via `VITE_TURN_*` env vars
- ✅ **ICE restart** — auto on `failed`/`disconnected` state
- ✅ **Rate limiting** — per-IP (Redis) + per-session (in-memory)
- ✅ **Security headers** — COOP/COEP/CSP for WebRTC isolation
- ✅ **CORS lockdown** — explicit allowlist in production
- ✅ **Graceful shutdown** — SIGTERM/SIGINT drain (30s force timeout)
- ✅ **Observability** — Sentry errors + Prometheus metrics
- ✅ **Health checks** — `/api/health`, `/api/metrics`

## Roadmap (Post-v1.1)
- [ ] Background sync for offline camera offers
- [ ] S3 + CDN for track uploads (replace local disk)
- [ ] Load testing (k6, 50+ concurrent peers)
- [ ] E2E Playwright tests (fake media stream)
- [ ] Multi-region signaling (Render paid tier + sticky sessions)
- [ ] PTZ motor control via data channels