# Iris SYNCD — Production Upgrade Plan

## Project Overview
**Iris SYNCD** is a real-time, multi-device party sync web application with:
- **Host Dashboard** (React 18 + Vite) — Desktop control center for session management
- **Participant Page** (React 18 + Vite + PWA) — Mobile-first camera/speaker clients
- **Signaling Server** (Node.js + Socket.io + Redis) — WebRTC signaling & session state

**Current State**: Deployed on Render (Free tier), functional core sync, recent bug fixes merged.

---

## Audit Findings

### Critical Gaps (Must Fix)

| Area | Issue | Impact |
|------|-------|--------|
| **TURN/STUN** | No TURN server configured; only public STUN | WebRTC fails on symmetric NAT / enterprise networks |
| **Session Persistence** | In-memory Map + optional Redis; no sticky sessions on free tier | Horizontal scaling broken; sessions lost on deploy |
| **Rate Limiting** | Basic express-rate-limit (100 req/min) | No per-IP/per-session protection; abuse vulnerable |
| **CORS** | `CORS_ORIGIN: '*'` in production | CSRF/clickjacking risk |
| **File Uploads** | 50MB limit, no streaming, local disk only | OOM risk; no CDN; files lost on deploy |
| **Health Checks** | Only `/api/health` returns 200 | No WebRTC/ICE connectivity verification |
| **Observability** | Winston console only; no metrics/tracing | Blind in production |

### High-Impact Improvements

| Area | Gap | Effort |
|------|-----|--------|
| **Build Pipeline** | Vite 8 deprecation warnings; font asset warnings | Low |
| **Testing** | Only 12 unit tests; no integration/E2E | Medium |
| **PWA** | Service worker basic; no background sync/offline | Medium |
| **Accessibility** | Missing ARIA labels, focus management | Low |
| **Security Headers** | CSP dev-only; no COOP/COEP for WebRTC | Low |
| **Bundle Size** | No analysis; lucide-react full import | Low |

---

## Recommended Tooling & Plugins

### 1. TURN Server (Critical)
| Option | Pros | Cons |
|--------|------|------|
| **coturn (self-hosted)** | Free, full control | Ops burden |
| **Twilio Network Traversal** | Managed, global | $0.003/min |
| **metered.ca / Xirsys** | Cheap, simple API | Vendor lock-in |
| **Cloudflare Calls** | Integrated, WebRTC-native | Beta, limited regions |

**Recommendation**: Start with **metered.ca** (free tier: 1000 min/mo) → migrate to **coturn on Render** if scale demands.

### 2. Observability
| Tool | Purpose | Integration |
|------|---------|-------------|
| **Sentry** | Error tracking + performance | `@sentry/node`, `@sentry/react` |
| **Prometheus + Grafana** | Metrics (latency, connections, ICE failures) | `prom-client` |
| **OpenTelemetry** | Distributed tracing | `@opentelemetry/sdk-node` |

### 3. Testing
| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Node `test` (existing) | Pure functions |
| Integration | `socket.io-client` + test server | Signaling flows |
| E2E | **Playwright** | Full WebRTC negotiation |
| Load | **k6** | 50+ concurrent peers |

### 4. CI/CD
| Stage | Tool | Config |
|-------|------|--------|
| Lint/Type | Biome / ESLint + TypeScript | `biome check` |
| Test | Node test + Playwright | GitHub Actions |
| Build | Vite + esbuild | Render blueprint |
| Deploy | Render auto-deploy | `render.yaml` |

---

## Prioritized Enhancement Roadmap

### Phase 1: Foundation (Week 1-2) — **CRITICAL**
- [ ] **TURN Server**: Provision metered.ca; add `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` to env
- [ ] **CORS Lockdown**: Set `CORS_ORIGIN` to production domain only
- [ ] **Rate Limiting**: Per-IP (30/min) + per-session (100/min) with Redis backend
- [ ] **Security Headers**: Add `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` for WebRTC
- [ ] **Session Persistence**: Migrate to Redis-only with TTL; remove in-memory fallback

### Phase 2: Reliability (Week 2-3) — **HIGH**
- [ ] **Health Checks**: Add `/api/health/webrtc` verifying ICE connectivity
- [ ] **Graceful Shutdown**: Drain connections on SIGTERM (30s grace)
- [ ] **Connection Monitoring**: Log ICE state transitions; alert on `failed`/`disconnected` > 5%
- [ ] **Reconnection Logic**: Exponential backoff with jitter (client + server)

### Phase 3: Observability (Week 3-4) — **HIGH**
- [ ] **Sentry Integration**: Errors + performance (WebRTC negotiation timing)
- [ ] **Prometheus Metrics**: 
  - `active_sessions`, `connected_peers`, `ice_connection_state`, `negotiation_duration_ms`
  - `audio_playback_drift_ms`, `camera_switch_latency_ms`
- [ ] **Structured Logging**: JSON logs with `sessionId`, `deviceId`, `correlationId`

### Phase 4: Testing & Quality (Week 4-5) — **MEDIUM**
- [ ] **Integration Tests**: 
  - Host creates session → participant joins → WebRTC connects
  - Camera switch → host sees new feed
  - Network interruption → auto-reconnect
- [ ] **Playwright E2E**: Headless Chrome with `--use-fake-device-for-media-stream`
- [ ] **Load Test**: k6 script simulating 50 peers (25 cameras + 25 speakers)
- [ ] **Bundle Analysis**: `vite-bundle-analyzer`; tree-shake lucide-react

### Phase 5: PWA & UX (Week 5-6) — **MEDIUM**
- [ ] **Background Sync**: Queue camera offers when offline
- [ ] **Wake Lock**: Already implemented; verify iOS Safari behavior
- [ ] **Install Prompt**: Custom `beforeinstallprompt` handler
- [ ] **Offline Page**: Show cached session code when network down

### Phase 6: Scaling Prep (Week 6+) — **LOW**
- [ ] **Sticky Sessions**: Document Render paid tier requirement
- [ ] **Redis Cluster**: Sentinel/Cluster mode for HA
- [ ] **CDN for Uploads**: Migrate to S3 + CloudFront
- [ ] **Multi-region**: Deploy signaling to multiple regions

---

## Configuration Changes

### Environment Variables (Add to Render)
```bash
# TURN (metered.ca)
VITE_TURN_URL=turn:global.relay.metered.ca:80
VITE_TURN_USERNAME=<provided>
VITE_TURN_CREDENTIAL=<provided>

# Security
CORS_ORIGIN=https://iris-syncd.onrender.com
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30

# Observability
SENTRY_DSN=<dsn>
LOG_LEVEL=info
```

### Vite Config Fixes
```js
// host-dashboard/vite.config.js & participant-page/vite.config.js
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    rolldownOptions: {}
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'socket.io-client'],
          lucide: ['lucide-react']
        }
      }
    }
  }
});
```

---

## File-Level Changes Needed

| File | Change |
|------|--------|
| `server/src/index.js` | Add TURN to ICE config; per-IP rate limit; graceful shutdown; health/webrtc endpoint |
| `shared/webrtc/index.js` | Read TURN from env; add ICE restart on `failed` state |
| `host-dashboard/src/App.jsx` | Add Sentry init; connection quality indicators |
| `participant-page/src/App.jsx` | Add Sentry init; offline queue for camera offers |
| `render.yaml` | Add TURN env vars; health check path `/api/health/webrtc` |
| `package.json` (root) | Add `test:integration`, `test:e2e`, `lint`, `analyze` scripts |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| WebRTC Connection Success Rate | > 99% (with TURN) |
| ICE Negotiation Time (p50) | < 1.5s |
| Reconnection Time (p95) | < 3s |
| Audio Sync Drift | < 20ms |
| Bundle Size (gzipped) | < 150KB (host), < 100KB (participant) |
| Test Coverage | > 80% (unit), 100% critical paths (E2E) |
| Deploy Zero-Downtime | ✅ (graceful shutdown) |

---

## Next Steps

1. **Immediate**: Provision TURN credentials → update `shared/webrtc/index.js` → test on cellular/corporate WiFi
2. **Day 1-2**: Lock down CORS, add rate limiting, enable Redis-only sessions
3. **Day 3-4**: Integrate Sentry + Prometheus metrics
4. **Week 2**: Write Playwright E2E tests for WebRTC flow
5. **Ongoing**: Monitor ICE failure rates; iterate on reconnection logic

---

*Generated: 2026-08-25 | Based on codebase audit at commit `5d52c35`*