# LiveKit Configuration for Iris SYNCD

## Overview
This project uses LiveKit as the SFU (Selective Forwarding Unit) for scalable WebRTC media transport. LiveKit handles:
- Audio/video routing between host and participants
- Adaptive streaming and quality management
- Recording capabilities (future feature)
- Scalability beyond peer-to-peer limitations

## Installation Options

### Option 1: Docker (Recommended for Development)
```bash
# Pull and run LiveKit server
docker run --rm -p 7880:7880 -p 7881:7881 -p 5349:5349/udp \
  -e LIVEKIT_API_KEY=your_api_key \
  -e LIVEKIT_API_SECRET=your_api_secret \
  livekit/livekit-server
```

### Option 2: Binary Installation
```bash
# Download LiveKit server
curl -sSL https://get.livekit.io | bash

# Run with configuration
livekit-server --config livekit.yaml --dev
```

### Option 3: Cloud Hosted (Production)
Use LiveKit Cloud for production deployments:
- https://livekit.io/cloud
- Provides managed SFU infrastructure
- Includes TURN servers and global distribution

## Configuration File

Create `livekit.yaml` in the server directory:

```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: false

keys:
  your_api_key: your_api_secret

logging:
  level: info
  json: false

room:
  auto_create: true
  empty_timeout: 300
  max_participants: 20

turn:
  enabled: true
  domain: localhost
  tls_port: 5349
  cert_file: ""
  key_file: ""
```

## API Integration

The server uses LiveKit's server SDK to generate access tokens:

```javascript
import { AccessToken } from 'livekit-server-sdk';

// Generate token for participant
function generateToken(roomName, participantName, role) {
  const at = new AccessToken('api_key', 'api_secret', {
    identity: participantName,
    name: participantName,
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: role === 'camera',
    canSubscribe: role === 'speaker',
    canPublishData: true,
  });

  return at.toJwt();
}
```

## Environment Variables

Add to your `.env` file:
```
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_WS_URL=ws://localhost:7880
```

## Development vs Production

### Development
- Use LiveKit's dev mode (`--dev` flag)
- Includes built-in TURN server
- Generates self-signed certificates

### Production
- Use LiveKit Cloud or self-hosted cluster
- Configure proper SSL/TLS
- Set up TURN servers for NAT traversal
- Enable monitoring and logging

## Testing

Test the connection:
```bash
# Install LiveKit CLI
npm install -g @livekit/cli

# List rooms
lk room list

# Create a test room
lk room create test-room
```
