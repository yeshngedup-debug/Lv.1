---
name: Iris SYNCD
description: Sync music & cameras across every device at the party
colors:
  bg: "#0a0a0f"
  bg-subtle: "#14141c"
  bg-card: "rgba(18, 18, 26, 0.92)"
  bg-hover: "rgba(24, 24, 34, 0.96)"
  bg-gradient-start: "#11111a"
  bg-gradient-end: "#06060d"
  border: "rgba(255, 255, 255, 0.06)"
  border-strong: "rgba(255, 255, 255, 0.14)"
  border-accent: "rgba(139, 92, 246, 0.38)"
  border-focus: "rgba(139, 92, 246, 0.55)"
  text-primary: "#f4f4f5"
  text-secondary: "#a1a1aa"
  text-tertiary: "#71717a"
  text-meta: "#52525b"
  accent-violet: "#8b5cf6"
  accent-violet-light: "#a78bfa"
  accent-violet-soft: "#e9d8fd"
  accent-cyan: "#06b6d4"
  accent-cyan-soft: "#e0f7fa"
  accent-magenta: "#d946ef"
  accent-magenta-soft: "#faf5ff"
  accent-green: "#10b981"
  accent-green-soft: "#d1fae5"
  accent-amber: "#f59e0b"
  accent-amber-soft: "#fffbeb"
  accent-rose: "#f43f5e"
  accent-rose-soft: "#fee2f2"
typography:
  display:
    fontFamily: "Unbounded, Space Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  h1:
    fontFamily: "Space Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.5rem)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "Space Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 2rem)"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Space Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  data:
    fontFamily: "JetBrains Mono, SF Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.02em"
  meta:
    fontFamily: "JetBrains Mono, SF Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
    textTransform: "uppercase"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
shadows:
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.35)"
  md: "0 4px 12px -2px rgba(0, 0, 0, 0.45)"
  lg: "0 12px 30px -6px rgba(0, 0, 0, 0.5)"
  glow: "0 0 0 1px rgba(139, 92, 246, 0.15), 0 4px 20px -4px rgba(139, 92, 246, 0.35)"
motion:
  fast: "100ms"
  normal: "200ms"
  slow: "350ms"
  ease: "cubic-bezier(0.16, 1, 0.3, 1)"
  ease-out: "cubic-bezier(0, 0, 0.2, 1)"
  ease-in-out: "cubic-bezier(0.4, 0, 0.2, 1)"
grid:
  size: "32px"
  opacity: "0.02"
components:
  button-primary:
    backgroundColor: "{colors.accent-violet}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "14px 24px"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: 500
    boxShadow: "{shadows.glow}"
    transition: "all var(--speed-normal) var(--ease)"
  button-primary-hover:
    backgroundColor: "{colors.accent-violet-light}"
    transform: "translateY(-1px)"
    boxShadow: "0 0 0 1px rgba(139, 92, 246, 0.25), 0 8px 24px -6px rgba(139, 92, 246, 0.45)"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border}"
    borderWidth: "1px"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-ghost-hover:
    backgroundColor: "{colors.bg-hover}"
    borderColor: "{colors.border-strong}"
  button-danger:
    backgroundColor: "rgba(244, 61, 94, 0.85)"
    textColor: "#ffffff"
    borderColor: "{colors.accent-rose}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-danger-hover:
    backgroundColor: "{colors.accent-rose}"
    boxShadow: "0 0 12px rgba(244, 61, 94, 0.45)"
  card:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    borderWidth: "1px"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    boxShadow: "{shadows.md}"
    backdropFilter: "blur(8px)"
  card-hover:
    borderColor: "{colors.border-strong}"
    boxShadow: "{shadows.lg}"
  pill:
    backgroundColor: "rgba(13, 13, 18, 0.7)"
    borderColor: "{colors.border}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
  input:
    backgroundColor: "{colors.bg-subtle}"
    borderColor: "{colors.border}"
    borderWidth: "1px"
    rounded: "{rounded.md}"
    padding: "14px 16px"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    color: "{colors.text-primary}"
  input-focus:
    borderColor: "{colors.accent-violet}"
    boxShadow: "0 0 0 3px rgba(139, 92, 246, 0.18)"
---

## Visual Identity

**Gridline v2** — A dark, technical precision aesthetic for real-time media synchronization. The system communicates reliability, speed, and control through a restrained palette, mono-spaced data labels, and a persistent 32px hairline grid that evokes signal processing and broadcast engineering.

### Core Principles
1. **Signal over noise** — Every element serves the sync; no decorative cruft
2. **Live by default** — Pulsing indicators, real-time metrics, zero perceived latency
3. **Density with clarity** — Host packs high information; participant stays glanceable
4. **One product, two surfaces** — Shared tokens, distinct layouts per role

## Color System

### Surfaces (Depth Stack)
- **bg** `#0a0a0f` — Deepest canvas, near-black with subtle blue bias
- **bg-subtle** `#14141c` — Elevated panels, modals, dropdowns
- **bg-card** `rgba(18,18,26,.92)` — Glassmorphism cards with backdrop blur
- **bg-hover** `rgba(24,24,34,.96)` — Interactive lift states

### Gradient Atmosphere
Two radial glows pinned to viewport corners (violet top-left, cyan bottom-right) create a sense of active field without overwhelming content.

### Gridline Backdrop
Fixed 32px hairline grid at 2% white opacity — the system's namesake, always present, never dominant.

### Accent Palette (Semantic)
| Role | Token | Use |
|------|-------|-----|
| Primary action | `accent-violet` | CTAs, focus rings, active nav, brand |
| Secondary action | `accent-cyan` | Live indicators, streaming, data highlights |
| Tertiary/Alert | `accent-magenta` | Recording, special modes, warnings |
| Success/Live | `accent-green` | Connected, recording, operational |
| Warning | `accent-amber` | Reconnecting, degraded quality |
| Error | `accent-rose` | Disconnected, failed, critical |

Each accent has a `-soft` variant (10% opacity) for backgrounds/badges.

### Text Hierarchy
- **Primary** `#f4f4f5` — Main content, headings
- **Secondary** `#a1a1aa` — Supporting copy, labels
- **Tertiary** `#71717a` — Meta, disabled, placeholder
- **Meta** `#52525b` — Timestamps, version, debug

## Typography

### Font Stack (Fixed per PRODUCT.md)
- **Display** — Unbounded (Google Fonts) for hero numbers, session IDs
- **UI** — Space Grotesk for all interface text
- **Data** — JetBrains Mono for metrics, timestamps, code, technical labels

### Scale (Clamped)
| Level | Size | Weight | Line Height |
|-------|------|--------|-------------|
| Display | clamp(2.5rem, 5vw, 4rem) | 600 | 1.1 |
| H1 | clamp(1.875rem, 4vw, 2.5rem) | 500 | 1.2 |
| H2 | clamp(1.5rem, 3vw, 2rem) | 500 | 1.3 |
| Body | 0.9375rem | 400 | 1.55 |
| Data | 0.8125rem | 500 | 1.5 |
| Meta | 0.75rem | 600 | 1.4 |

## Spacing & Layout

8px base unit. All spacing, padding, gaps use `{spacing.*}` tokens.
- Grid: 12-column (host), 4-column (participant)
- Gutter: 16px (md)
- Container max-width: 1440px (host), 100vw (participant)

## Motion

| Token | Duration | Easing | Use |
|-------|----------|--------|-----|
| fast | 100ms | ease | Hover, tap, micro-states |
| normal | 200ms | ease | Panel expand, tab switch, toast |
| slow | 350ms | ease-in-out | Modal, drawer, fullscreen |
| breathe | 3.2s | ease-in-out infinite | Equalizer idle |
| dance | 0.5–1.2s | ease-in-out alternate | Equalizer active |
| pulse | 1.8s | ease-in-out infinite | Live dots |

**Reduced motion** — All durations → 0ms, animations disabled via `prefers-reduced-motion`.

## Components

### Buttons
- **Primary** — Violet fill, glow shadow, lift on hover
- **Ghost** — Transparent, border, subtle hover fill
- **Danger** — Rose fill, pulse on critical actions
- **Icon-only** — 40×40px (mobile), 36×36px (desktop) touch targets

### Cards
Glassmorphism: `bg-card` + `backdrop-filter: blur(8px)` + 1px border.
Hover → stronger border + deeper shadow.

### Pills (Status)
Rounded-full, mono label, colored dot with pulse animation.
Variants: connected (green), disconnected (rose), reconnecting (amber).

### Inputs
Dark field, mono placeholder, violet focus ring + glow.

### Live Indicators
6px dot + pulse-ring keyframes. Always paired with mono label.

### Equalizer
40 bars, CSS-driven. Idle = slow breathe. Active = per-bar randomized dance synced to audio level.

### Camera Tile
Aspect-ratio 4:3, overflow hidden, hover → zoom hint + controls reveal.
Multi-cam badge, listen toggle, motion alert ring.

### PTZ Pad
3×3 grid, center button double-width, zoom slider below.

## Imagery & Assets

### Local Fonts (Self-hosted)
- **Poppins** (100–900) — Available at `/designs/fonts/poppins-*.woff2`
- **Sora** (100–700) — Available at `/designs/fonts/sora-*.woff2`
*Note: Primary stack remains Space Grotesk/Unbounded/JetBrains Mono via Google Fonts. Poppins/Sora reserved for marketing/landing surfaces.*

### Photography
- `image-4.jpg` — Party atmosphere, warm lighting, people connecting
- `image-6.jpg` — Technical setup, cables, devices, precision

Use as hero backgrounds (opacity overlay) or empty-state illustrations.

## Accessibility

- **Contrast** — All text ≥ 4.5:1, UI elements ≥ 3:1
- **Focus** — 2px `accent-violet-light` ring, 2px offset
- **Motion** — `prefers-reduced-motion` respected globally
- **ARIA** — Live regions for status, labels for icon buttons, roles for equalizer
- **Touch** — Minimum 44×44px (mobile), 36×36px (desktop)

## Surface Specifications

### Host Dashboard (Desktop)
- **Viewport** — ≥1024px, landscape
- **Chrome** — Top status strip (32px), header (56px), collapsible sidebar (220px/60px)
- **Grid** — 12-col, cards span 4/8/12
- **Density** — Compact, mono labels, high info/px

### Participant PWA (Mobile)
- **Viewport** — 320–430px, portrait
- **Safe areas** — All insets respected (notch, home indicator)
- **Thumb zone** — Primary actions bottom 40% of screen
- **Keyboard** — No layout shift, inputs stay visible
- **Install** — Manifest, service worker, splash screen

## Implementation Notes

- Tokens defined in `:root` (index.css) — single source of truth
- Component CSS in `App.css` per app — no CSS-in-JS
- Class-name contract preserved — React className strings unchanged
- No external UI libraries — all custom
- Self-hosted fonts in `/public/fonts/` with `@font-face` fallbacks