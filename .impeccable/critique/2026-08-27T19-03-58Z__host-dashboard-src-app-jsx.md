---
target: host dashboard (deployed + source)
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-27T19-03-58Z
slug: host-dashboard-src-app-jsx
---
# Iris SYNCD Host Dashboard — Critique Snapshot

Method: dual-agent (A: design-review subagent · B: detector/browser-evidence subagent)
Target: host-dashboard/src/App.jsx (live: https://iris-e6fo.onrender.com)
Mode: Operate

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Fake hardcoded telemetry: "42ms" latency / "2.3 Mbps" bandwidth are static strings (App.jsx:858,862); upload/PTT feedback is a spinner string only |
| 2 | Match System / Real World | 3 | "Fleet", "LIVE", mono data font, hold-to-talk are idiomatic AV language; redundant Resume button next to Play/Pause |
| 3 | User Control and Freedom | 2 | QR modal closes via a BellOff icon (App.jsx:781); no Esc, no backdrop dismiss, no obvious X; modal auto-opens on every load |
| 4 | Consistency and Standards | 1 | Two button systems (gridline-btn-* vs .btn-*), two layout systems, browser-blue range sliders ignoring accent tokens, sidebar offset broken everywhere |
| 5 | Error Prevention | 2 | File type/size pre-validated (good); Settings checkboxes are defaultChecked no-ops; mic-sensitivity slider dead (value={70}, no handler, App.jsx:1191) |
| 6 | Recognition Rather Than Recall | 2 | Session ID + copy link good; but PTT/listen/motion/fullscreen controls scattered across three tabs with no persistent now-playing/active-mic indicator |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts for play/pause/PTT/invite/end; PTT is mouse-hold only (AudioBroadcast.jsx:134-138) |
| 8 | Aesthetic and Minimalist Design | 2 | Token palette tasteful; runtime undermined by layout bug, default-blue sliders, and large empty black regions on first load |
| 9 | Error Recovery | 1 | Native alert() for upload failures and invalid files (App.jsx:384,389,436); mic-denied silently console.errors; styled .error-banner exists in CSS but is unused |
| 10 | Help and Documentation | 1 | Zero onboarding; unsolicited QR modal over an empty dashboard; no tooltips; CSS even ships an unrendered .guide-steps component |
| **Total** | | **17/40** | **Poor — major UX overhaul required; core experience broken** |

## Design Specificity Verdict

LLM assessment: the token layer is genuinely authored (violet→cyan brand gradient, mono data font, glassmorphism cards, gridline backdrop, 16:9 camera-tile contract) — but the shipped composition does not honor its own system. The status strip, sidebar offset, and accent tokens are broken at runtime, so the product reads as a generic half-built admin panel wearing a stylesheet it isn't using. The party-specific surfaces (camera wall, equalizer, PTT) exist only as empty states or behind an unstyled flow. Roughly 60% authored language over 40% generic dashboard; the DESIGN.md↔DOM gap is the biggest credibility problem.

Deterministic scan: detect.mjs exit 2, 1 finding — gradient-text on .brand-title (App.css:133). Flagged as likely false positive: deliberate brand wordmark treatment, not decorative slop.

Visual overlays: injection blocked by the production CSP (script-src 'self') — no user-visible overlay available; this is the app's own security posture working as intended. Fallback signal: CLI scan + console/screenshot evidence.

## Overall Impression
A disciplined design system and a well-specified camera-tile component are being squandered by a broken layout, fake telemetry, dead controls, and no first-run guidance. The single biggest opportunity: fix the sidebar-offset bug and replace the empty-dashboard-plus-unsolicited-modal opening with a guided 3-step host flow — the product's real personality is already in the stylesheet, it just isn't wired up.

## What's Working
1. Coherent dark token system (index.css): depth-stacked surfaces, semantic accents, 8px scale, clamped type, prefers-reduced-motion fully honored.
2. Honest three-state connection pill (connected/reconnecting/disconnected) mirrored in strip and Connection card — the one place status is real.
3. CameraFeedTile is the most product-specific artifact in the repo: fixed 16:9, hover-lift, live badge, motion-alert pulsing border, per-tile listen/cycle.

## Priority Issues
- [P0] Main content renders UNDER the sidebar: template-literal class ml-${sidebarCollapsed ? '0' : '64px'} (App.jsx:660) emits invalid Tailwind classes; computed margin-left 0 confirmed live. Headings and right-edge badges clipped on every tab. Fix: real conditional ('ml-0'/'ml-64') or inline marginLeft. Command: $impeccable layout
- [P0] Fake live metrics: static "42ms"/"2.3 Mbps" on a card otherwise showing real state (App.jsx:858,862). Trust failure for a live-ops tool. Fix: bind to RTCPeerConnection.getStats() or remove rows. Command: $impeccable clarify
- [P1] QR modal affordances wrong: BellOff close icon, no Esc/backdrop dismiss, auto-opens on every load including refresh. Fix: real X with aria-label, Esc + backdrop handlers, auto-open only on first creation (persist dismissed flag). Command: $impeccable onboard
- [P1] Audio upload→play flow dead-ends: Play/Upload disabled on Overview with no stated prerequisite; sequence spans two tabs; failures surface as native alert(). Fix: visible step state (choose → upload → play), single advancing CTA, inline error banner (CSS already has .error-banner). Command: $impeccable clarify
- [P2] Dead controls erode trust: mic-sensitivity slider hardcoded value={70} (App.jsx:1191), Settings checkboxes defaultChecked with no handlers (1139-1251), inert "Controls" card rows. Fix: wire them or hide behind "coming soon". Command: $impeccable harden

## Persona Red Flags
- Alex (power user): must dismiss an uninvited modal before doing anything; Play disabled with no reason; file-pick lives on a different tab than Play; PTT mouse-only (hands may be on a mixer); fake 42ms/2.3Mbps makes the rest of the readouts untrustworthy.
- Sam (keyboard/screen reader): modal lacks role=dialog/aria-modal/focus trap; close button has no accessible name; tabs lack aria-current/role=tab; status changes not announced (no aria-live); sliders lack labels/aria-valuetext. Focus rings exist but can't rescue missing semantics.

## Minor Observations
- Settings sliders ignore accent-color (browser blue) while .seek-slider/.volume-slider set it — inconsistent.
- transition-margin-duration-300 is not a real class; sidebar collapse never animates.
- "Controls" card lists Push-to-Talk/Notifications/Activity Log as inert rows.
- Camera-wall and Devices empty states are near-identical grey voids; no "scan QR to add your first phone" CTA.
- App.css ships designed-but-unmounted UI: .guide-steps, .qr-box invite hero, .landing-features, .ptz-controls, .metrics-row.
- Video+speaker icon pair centered over the QR code (App.jsx:745-750) partially obscures scannable modules.
- Equalizer — the one delightful motion moment — only renders on the Audio tab after a track exists.

## Questions to Consider
1. Why does the host's first second require dismissing an unasked-for modal over a completely empty dashboard — why lead with the lowest-energy state?
2. If "42ms latency" isn't real, what else on this screen is decorative — and would a host mid-party forgive a number that lied to them?
3. The stylesheet already designs onboarding, an invite hero, PTZ pads, and a metrics row the JSX never renders — is the product unfinished, or did the build just stop wiring up the parts that make it feel like a party tool?
