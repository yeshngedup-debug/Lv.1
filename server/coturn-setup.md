# TURN/STUN Server Configuration for Iris SYNCD

## Overview
Iris SYNCD uses **raw WebRTC P2P** with Socket.IO signaling — **no SFU (LiveKit/Mediasoup) is used**.  
NAT traversal is handled by standard STUN + TURN servers configured via environment variables.

## Current Architecture
```
Participant (React PWA) ◄── socket.io ──► Signaling Server (Node.js) ◄── socket.io ──► Host Dashboard (React)
        │                                                                    │
        └────────────────────── WebRTC P2P (DTLS-SRTP) ──────────────────────┘
                          ▲          ▲
                          │          │
                     STUN (Google) TURN (metered.ca / coturn)
```

## Production TURN (metered.ca)

1. Create account at [metered.ca](https://metered.ca) — free tier: 1000 min/mo
2. Create a project → note credentials
3. Add to Render environment variables:

```bash
VITE_TURN_URL=turn:global.relay.metered.ca:80
VITE_TURN_USERNAME=<your_username>
VITE_TURN_CREDENTIAL=<your_credential>
```

The client (`shared/webrtc/index.js`) reads these at build time via `import.meta.env.VITE_*`.

## Self-Hosted coturn (Alternative)

If you prefer self-hosted TURN (e.g., on a VPS):

### Docker (Recommended)
```yaml
# docker-compose.yml
version: '3.8'
services:
  turnserver:
    image: coturn/coturn
    container_name: iris-turn
    ports:
      - "3478:3478"
      - "3478:3478/udp"
      - "5349:5349"
      - "5349:5349/udp"
      - "49152-49200:49152-49200/udp"
    environment:
      - TURN_USERNAME=iris
      - TURN_PASSWORD=syncd
      - TURN_REALM=iris-syncd
      - EXTERNAL_IP=<your_public_ip>
    restart: unless-stopped
```

### Configuration (`turnserver.conf`)
```conf
listening-port=3478
tls-listening-port=5349
realm=iris-syncd
lt-cred-mech
user=iris:syncd
min-port=49152
max-port=49200
external-ip=<YOUR_PUBLIC_IP>
no-multicast-peers
no-cli
log-file=/var/log/turnserver.log
verbose
```

Then set in Render:
```bash
VITE_TURN_URL=turn:<your_domain_or_ip>:3478
VITE_TURN_USERNAME=iris
VITE_TURN_CREDENTIAL=syncd
```

## Verification
1. Deploy with TURN vars set
2. Join session from a device behind symmetric NAT (corporate WiFi, cellular)
3. Verify WebRTC connection succeeds (ICE state → `connected`)
4. Check browser console for ICE candidate logs showing relay candidates

## Cost Comparison
| Option | Cost | Maintenance |
|---|---|---|
| metered.ca (free) | $0 / 1000 min | Zero |
| coturn on VPS | ~$5-10/mo | Medium (OS updates, certs) |
| Twilio Network Traversal | $0.003/min | Zero |
| LiveKit Cloud | $0.12/participant-hr | Zero (but adds SFU complexity) |

**Recommendation:** Start with metered.ca free tier; migrate to self-hosted coturn if volume exceeds free tier.