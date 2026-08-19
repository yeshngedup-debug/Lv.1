# Build Prompt: Multi-Device Party Speaker & Camera Dashboard

Use this prompt with Claude Code (or any AI coding agent) to scaffold the project.

---

## Project Overview

Build a web app with two connected pieces:

1. **Host Dashboard** — a control panel one person runs (on laptop/desktop) that:
   - Generates a QR code + shareable link for a session
   - Sees a live list of connected devices
   - Can push music playback or live mic audio ("push to talk") out to all connected phones, turning them into a synced speaker system
   - Can view a grid of live camera feeds from any connected phones, used as extra camera angles (e.g., badminton line calls)

2. **Participant Page** — what opens when someone scans the QR code or clicks the link:
   - Mobile-friendly web page, no app install required
   - Shows a clear "Join as Speaker" and/or "Join as Camera" option
   - Requires an explicit "Allow" tap before any mic/camera access is requested — must use the browser's native permission prompt, never bypass it
   - Once joined as a speaker: plays whatever audio the host sends (song or live host mic), continues playing when the phone screen is locked or the tab is backgrounded, and shows lock-screen media controls
   - Once joined as a camera: streams live video to the host dashboard; screen must stay on and an active "You're live" indicator must always be visible on screen while streaming (camera/mic access must not run when backgrounded — this is a browser platform restriction, not optional)
   - A visible "Leave / Stop sharing" control that immediately ends that device's stream

## Core Features to Implement

### 1. Session & Join Flow
- Host creates a session → server generates a unique session code
- Server renders a QR code (encoding the join URL) and the raw join link
- Participant page reads the session code from the URL, connects to the signaling server, and shows the role-selection + Allow screen described above
- Sessions expire after a configurable time or when the host ends them

### 2. Speaker Feature (audio OUT to phones)
- Host can upload/select an audio file and play it; playback state (play/pause/seek) is synced across all connected phones using a shared server timestamp reference, not just "play on receive," to avoid drift/echo
- Host has a "Hold to Talk" button that live-streams the host's own mic to all connected phones (PA/intercom style)
- When the host talks, background music should automatically duck (lower volume) and restore after
- Individual per-phone volume should be adjustable from the dashboard, in addition to each phone having its own local volume via its own hardware buttons

### 3. Camera Feature (video IN from phones)
- Any phone that joins as a camera streams live video (and can include audio) to the host dashboard via WebRTC
- Dashboard displays all active camera streams in a grid, labeled by device/nickname
- Low latency is the priority over resolution — this is for real-time line/call judgment, not recording quality
- **Camera selection**: use `navigator.mediaDevices.enumerateDevices()` to list available `videoinput` devices; default to the back camera via `facingMode: { exact: "environment" }`. If the phone exposes multiple rear lenses as separate device IDs (varies by browser/OS — more consistent on Android Chrome than iOS Safari), show a camera-switch control so the participant can pick which lens to use before going live
- **Zoom**: support two tiers —
  - *Digital zoom* (always available, any device): CSS transform scale / canvas crop-and-scale on the local video preview — quality degrades since it's just cropping pixels
  - *Optical/hardware zoom* (Android-only, inconsistent support, not available on iOS Safari): check `track.getCapabilities().zoom`; if present, apply via `track.applyConstraints({ advanced: [{ zoom: value }] })`; otherwise fall back to digital zoom
  - Camera choice and zoom are set locally by the participant on their own device before/while live (pinch-to-zoom or a slider on their preview), not remotely controlled from the dashboard in v1

### 4. Dashboard Device List
- Live list of all connected devices, their role (speaker/camera), connection status, and a way to remove/disconnect any device from the host side

## Tech Stack

- **Signaling server**: Node.js + Socket.io — manages session state, device roster, WebRTC handshake relay
- **Media transport**: WebRTC via a self-hosted SFU (LiveKit or mediasoup) rather than raw peer-to-peer, so it scales past a handful of devices without choking host bandwidth
- **NAT traversal**: self-hosted coturn (STUN/TURN) so devices on different networks/cellular can connect
- **Host dashboard**: React — session controls, device list, camera grid, audio mixer UI
- **Participant page**: Mobile-friendly React or plain HTML/JS page, installable as a PWA (important for reliable background audio on iOS)
- **Audio engine**: Web Audio API (`AudioContext`, `GainNode`, `MediaStreamAudioDestinationNode`) for mixing song + live mic and for sync scheduling
- **Background audio**: Media Session API for lock-screen controls and continued playback while backgrounded
- **QR generation**: `qrcode` npm package
- **Hosting**: Fly.io, Render, or a VPS — needs to run the signaling server, SFU, and TURN server persistently with HTTPS (required for camera/mic permissions in the browser)

## Explicit Guardrails (must be respected, not worked around)

- Camera/mic access is only ever requested after an explicit, visible "Allow" tap on the participant's own device, via the browser's native permission prompt
- No camera/mic access may run while the tab is backgrounded or the screen is locked — this is an intentional browser protection against covert access, not a bug to fix
- Every active camera/mic stream must show a persistent, unmistakable on-screen indicator on the participant's own device for the entire duration of the stream
- A one-tap, always-visible way to immediately stop sharing must be present on the participant page at all times
- No feature should collect file-system access, contacts, location, or any data beyond the audio/video stream needed for the session

## Suggested Build Order

1. Session creation + QR/link generation + join page skeleton (no media yet)
2. Camera feature: single phone streaming to dashboard, then scale to grid
3. Speaker feature: basic audio broadcast, then layer in Web Audio API sync scheduling
4. Push-to-talk + music ducking mixer
5. Reconnect handling, device nicknames, per-device volume controls, session expiry
