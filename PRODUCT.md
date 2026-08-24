# Iris SYNCD — Product Truth

## Identity
**Name:** Iris SYNCD
**Tagline:** Sync music & cameras across every device at the party
**Platform:** Web (React + Vite) — Host desktop app + Participant mobile PWA
**Architecture:** Node/Socket.io signaling + WebRTC P2P mesh for ultra-low-latency sync

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
- **Dark technical aesthetic** — Gridline system (32px hairline grid, violet/cyan/magenta accents)
- **Space Grotesk + JetBrains Mono + Unbounded** — font stack is fixed
- **No external UI kits** — all components custom, CSS-first
- **AA accessibility** — focus rings, contrast, reduced motion, ARIA labels
- **Class-name contract** — existing React className strings must remain functional
- **Mobile-first participant** — thumb-reach, safe-area insets, no layout shift on keyboard
- **Desktop density** — host packs high info density without clutter

## Success Signals
- Host creates session → participant joins via QR → audio + video sync in <3s
- 10+ concurrent devices stable on consumer Wi-Fi
- Zero perceptible audio drift over 60min playback
- PWA installs and works offline for join page