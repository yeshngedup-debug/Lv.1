# coturn (STUN/TURN) Server Configuration for Iris SYNCD

## Overview
coturn provides STUN/TURN services for NAT traversal, allowing devices on different networks to connect via WebRTC.

## Installation

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install coturn
```

### Docker
```bash
docker run -d \
  --name=turnserver \
  -p 3478:3478 \
  -p 3478:3478/udp \
  -p 5349:5349 \
  -p 5349:5349/udp \
  -p 49152-49200:49152-49200/udp \
  -e TURN_USERNAME=iris \
  -e TURN_PASSWORD=syncd \
  -e TURN_REALM=iris-syncd \
  coturn/coturn
```

### macOS (Homebrew)
```bash
brew install coturn
```

## Configuration

### 1. Basic Configuration (`/etc/turnserver.conf`)

```bash
# Network settings
listening-port=3478
tls-listening-port=5349

# Enable STUN and TURN
stun-only=false
no-stun=false

# Authentication
realm=iris-syncd
lt-cred-mech
user=iris:syncd

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
no-multicast-peers
no-cli

# Performance
proc-user=turnserver
proc-group=turnserver
total-quota=100
stale-nonce=600

# Relay IP range (for Docker/VPS)
relay-ip=0.0.0.0
external-ip=YOUR_SERVER_IP/YOUR_PUBLIC_IP

# Allowed relay ports
min-port=49152
max-port=49200
```

### 2. Docker Compose Configuration

```yaml
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
      - TURN_SERVER_NAME=turn.iris-syncd.local
      - EXTERNAL_IP=YOUR_SERVER_IP
      - RELAY_IP=0.0.0.0
    restart: unless-stopped
    network_mode: host  # For proper NAT handling
```

### 3. Environment Variables

Add to your `.env` file:
```
TURN_URL=turn:YOUR_SERVER_IP:3478
TURN_USERNAME=iris
TURN_CREDENTIAL=syncd
```

## Testing

### Test STUN
```bash
# Install stun utility
sudo apt install stun

# Test STUN server
stun YOUR_SERVER_IP:3478
```

### Test TURN
```bash
# Using turnutils (comes with coturn)
turnutils_uclient -u iris -W syncd YOUR_SERVER_IP
```

### WebRTC Test Page
Visit: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Configure:
- STUN/TURN servers: `turn:YOUR_SERVER_IP:3478`
- Username: `iris`
- Password: `syncd`

## Production Considerations

### 1. SSL/TLS Configuration
```bash
# Generate certificates
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/turn.key \
  -out /etc/ssl/certs/turn.crt

# Add to turnserver.conf
cert=/etc/ssl/certs/turn.crt
pkey=/etc/ssl/private/turn.key
```

### 2. Firewall Rules
```bash
# Allow TURN ports
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:49200/udp
```

### 3. Performance Tuning
```bash
# Increase file descriptors
ulimit -n 10000

# Add to /etc/security/limits.conf
turnserver soft nofile 10000
turnserver hard nofile 10000
```

## Troubleshooting

### Common Issues

1. **Connection refused**
   - Check if coturn is running: `systemctl status coturn`
   - Verify ports are open: `netstat -tulpn | grep 3478`

2. **Authentication failed**
   - Verify username/password in turnserver.conf
   - Check realm configuration

3. **No relay candidates**
   - Check external-ip configuration
   - Verify firewall rules for relay ports
   - Ensure TURN is not in stun-only mode

4. **High latency**
   - Check server location relative to clients
   - Consider using LiveKit's built-in TURN or cloud service
   - Optimize relay port range

### Logs
```bash
# View coturn logs
sudo tail -f /var/log/turnserver.log

# Check systemd logs
sudo journalctl -u coturn -f
```

## Integration with Iris SYNCD

The server configuration uses these environment variables:
```javascript
const turnConfig = {
  urls: process.env.TURN_URL || 'turn:localhost:3478',
  username: process.env.TURN_USERNAME || 'iris',
  credential: process.env.TURN_CREDENTIAL || 'syncd'
};
```

This is passed to WebRTC peer connections as ICE server configuration.
