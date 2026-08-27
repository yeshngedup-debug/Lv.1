# Iris SYNCD — Design System v2

> **System:** Gridline Design System (v2)
> **Platform:** Host Dashboard + Participant PWA
> **Theme:** Dark Mode (Optimized for low-light party environments)

## Tokens

| Token Category      | Value/Definition                                                                               |
| :------------------ | :--------------------------------------------------------------------------------------------- |
| **Primary Palette** | `--bg`: #0a0a0f, `--text-primary`: #f4f4f5                                                     |
| **Accent Palette**  | Violet (`#8b5cf6`), Cyan (`#06b6d4`), Magenta (`#d946ef`), Green (`#10b981`), Rose (`#f43f5e`) |
| **Shadows**         | `sm`: 0 1px 2px 0 rgba(0,0,0,0.35); `lg`: 0 12px 30px -6px rgba(0,0,0,0.5)                     |
| **Radii**           | `sm`: 6px, `md`: 10px, `lg`: 14px, `xl`: 18px                                                  |

## Component Design (v2)

### Camera Feed Tiles

- **Aspect Ratio:** Fixed 16:9
- **Border Radius:** 8px
- **Interactive State:** Hover elevates (`translateY: -2px`) and adds stronger box-shadow
- **Indicators:** Live badge, camera label (e.g., "CAM 1"), motion-alert pulsing border

### Dashboard Layout

- **Responsiveness:**
  - Desktop (>=1200px): 3-column grid
  - Tablet (>=768px): 2-column grid
  - Mobile (<768px): 1-column stack

### Navigation & Hierarchy

- **Status Strip:** Blur effect, mono-spaced data font for health/connection info.
- **Cards:** `gridline-card` class applies consistent glassmorphism and elevated shadows.
- **Focus States:** `focus-visible` rings added to all interactive elements for accessibility.
