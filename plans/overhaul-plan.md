# Construction Plan: Complete Audit, Debugging, and Deployment Readiness Overhaul

This plan covers a comprehensive audit, layout/visual overhaul, logical debugging, and deployment readiness configuration for **Iris SYNCD**.

## Phase 1: Architectural & Code Quality Audit
- **Goal**: Identify code quality, architectural consistency, security, and performance bottlenecks across the codebase.
- **Tasks**:
  1. Inspect `server/src/index.js`, `server/package.json` for security issues and proper CORS handling.
  2. Audit `host-dashboard` and `participant-page` components (`App.jsx`, WebRTC managers).
  3. Map out file/route dependencies.
- **Deliverable**: `plans/AUDIT-REPORT.md`

## Phase 2: Complete UI & Alignment Refactoring (from Scratch)
- **Goal**: Rebuild/reorganize CSS & Layout wrappers across both applications to eliminate the "problematic left-alignment" issue and introduce an immersive, responsive, center-anchored layout.
- **Tasks**:
  1. Rebuild `host-dashboard/src/App.css` and `GridlineShell.jsx` layout wrapper with robust flex/grid alignment.
  2. Rebuild `participant-page/src/App.css` to center Join, Camera, and Speaker interfaces for mobile viewports.
  3. Validate using Playwright on local dev server.
- **Deliverable**: Refactored CSS files & layouts.

## Phase 3: Logical Debugging (WebRTC, AudioSync, PWA)
- **Goal**: Fix WebRTC connection drop issues, sync drift, and ensure PWA Service Worker caches local assets reliably.
- **Tasks**:
  1. Debug WebRTC signaling and ice candidate logic in both `webrtc.js` files.
  2. Verify AudioSync buffer/offset calculation to prevent drift.
  3. Harden `participant-page/src/sw.js` for offline cache reliability.
- **Deliverable**: Debugged WebRTC and Service Worker implementations.

## Phase 4: Production & Deployment Overhaul
- **Goal**: Make the project completely production-ready for Render deployment.
- **Tasks**:
  1. Audit `render.yaml` to ensure correct build/start commands.
  2. Verify environment variable fallback logic (e.g. `VITE_SOCKET_URL`).
  3. Build optimize assets and ensure proper static asset routing on the server.
- **Deliverable**: Verified `render.yaml` and successful deployment builds.
