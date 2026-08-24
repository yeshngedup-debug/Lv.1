# Iris SYNCD — Audit Report (Phase 1)

## Server (`server/src/index.js`)

| Area | Finding | Severity | Recommendation |
|------|---------|----------|----------------|
| Tests | `npm test` exits with placeholder; no unit/integration tests | 🔴 Critical | Add Jest + Supertest suite; mock Socket.io; CI gate. |
| Redis | `redis.createClient()` crashes if `REDIS_URL` undefined | 🟡 High | Guard adapter creation; fallback to in-memory adapter in dev. |
| CORS | `corsOrigin: '*'` too permissive for production | 🟡 High | Allow-list known domains (host dashboard + participant PWA origins). |
| Rate Limit | Global limit blocks WebSocket connections during high concurrency | 🟡 High | Skip rate-limit for `/socket.io/*` paths. |
| Helmet | Enabled ✅ – good. |
| Static Serving | SPA fallback missing – client routes 404 on refresh | 🔴 Critical | Add `app.get('*', (req,res)=>res.sendFile(index.html))` after static. |
| Session Cleanup | `setInterval` cleans `sessions` Map but not `peerConnections` | 🟡 High | Extend cleanup to prune orphaned peer maps. |
| QRCode | Sync `qrcode.toDataURL()` blocks event loop | 🟢 Low | Use `toDataURL()` with callback or worker thread. |
| Logging | Winston JSON ✅; ensure `error` captures full stack. |

## WebRTC (`host-dashboard/src/webrtc.js` & `participant-page/src/webrtc.js`)

| Issue | Detail | Severity |
|-------|--------|----------|
| Duplicated code | Both files ~90% identical | 🔴 Critical – extract to shared package. |
| TURN fallback | No automatic relay if STUN fails on symmetric NAT | 🔴 Critical – add `iceTransportPolicy: 'relay'` when TURN configured. |
| ICE queue | `addIceCandidate` not awaited in all paths; race condition | 🔴 Critical – await all `addIceCandidate` calls. |
| Connection monitoring | No `onconnectionstatechange` handler for auto-reconnect | 🔴 Critical – implement reconnection logic. |
| Cleanup | No `pc.close()` on unmount/destroy | 🟡 High – memory leak risk. |
| Bandwidth | No `bwe` or simulcast for multi-cam | 🟢 Low – future enhancement. |
| Bundle policy | Not set – defaults to balanced | 🟢 Low – set `bundlePolicy: 'max-bundle'`. |

## AudioSync (`participant-page/src/audioSync.js`)

| Issue | Detail | Severity |
|-------|--------|----------|
| Drift compensation | Naive `elapsed = (now - serverTs)/1000` – ignores network jitter | 🔴 Critical – implement smoothed offset estimator. |
| Periodic re-sync | None – once set, drift accumulates | 🔴 Critical – periodic `currentTime` correction (every 5s). |
| Buffer health | No monitoring of `buffered` ranges | 🟡 High – detect stall, trigger re-buffer. |
| AudioContext | Not resumed on user gesture – autoplay may fail | 🔴 Critical – call `audioContext.resume()` on first click. |
| MediaSession | Queries DOM each handler – cache reference | 🟢 Low. |

## Service Worker (`participant-page/src/sw.js`)

| Issue | Detail | Severity |
|-------|--------|----------|
| Cache strategy | Default Workbox – no custom routes | 🟡 High – add StaleWhileRevalidate for static, NetworkFirst for Socket.io. |
| Icons | Manifest uses placeholder – local `/designs/` images unused | 🟡 High – inject local icons into manifest. |
| Offline | `onOfflineReady` only logs – no user-facing indicator | 🟢 Low. |

## UI / Layout (Phase 2 Target)

| Issue | Detail | Severity |
|-------|--------|----------|
| Left-aligned landing | `.gridline-content` lacked `align-items: center; justify-content: center` | 🔴 Critical – fixed in last commit. |
| No responsive breakpoints | Host dashboard uses fixed 12-col; no mobile adaptation | 🟡 High – add `<1024px` stacked layout. |
| Participant join | Centered via `margin: auto` but safe-area not fully respected | 🟡 High – add `env(safe-area-inset-*)` padding. |
| Font loading | Google Fonts only – local Poppins/Sora unused in CSS | 🟢 Low – add `@font-face` fallbacks. |

## Deployment (`render.yaml`)

| Issue | Detail | Severity |
|-------|--------|----------|
| Single service | Render config uses one web service for all | 🟡 High – consider splitting API + static hosting for CDN. |
| Build command | `npm run build` builds all workspaces ✅ | — |
| Start command | `node server/src/index.js` ✅ | — |
| Env vars | `VITE_SOCKET_URL` must be set at build time for frontends | 🔴 Critical – verify Render injects `RENDER_EXTERNAL_URL`. |

---

## Phase 2 Kickoff: Complete UI/Layout Rebuild

The next step is a **from-scratch rebuild of layout wrappers** for both apps:
- `host-dashboard`: Rebuild `GridlineShell` + `App.css` with responsive grid, centered landing, proper content containment.
- `participant-page`: Rebuild `App.css` with centered Join/Camera/Speaker screens, safe-area compliance, PWA-ready viewport handling.

Both will use the **Gridline v2 tokens** already in `index.css` and self-hosted fonts from `/designs/fonts/`.