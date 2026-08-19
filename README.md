# Iris SYNCD

Multi-Device Party Speaker & Camera Dashboard

## Overview

Iris SYNCD is a web application that allows multiple devices to connect and sync audio playback while streaming camera feeds. Perfect for parties, events, or any situation where you need synchronized audio across multiple devices and live camera monitoring.

## Features

- **Session Management**: Create and join sessions with QR codes and shareable links
- **Synchronized Audio**: Play music that syncs across all connected devices
- **Push to Talk**: Host can broadcast live audio to all participants
- **Camera Streaming**: Multiple devices can stream live video to the host dashboard
- **Background Audio**: Audio continues playing when the app is backgrounded
- **Mobile Friendly**: Optimized for mobile devices with PWA support

## Tech Stack

- **Frontend**: React with Vite
- **Backend**: Node.js with Express and Socket.io
- **Media Transport**: WebRTC for peer-to-peer audio/video
- **NAT Traversal**: coturn (STUN/TURN server)
- **SFU**: LiveKit for scalable media routing

## Prerequisites

- Node.js 18+ and npm
- Docker (recommended for coturn and LiveKit)
- Modern web browser with WebRTC support

## Quick Start

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install all workspace dependencies
npm install --workspaces
```

### 2. Start the Server

```bash
# Start the signaling server
npm run dev -w server
```

### 3. Start the Host Dashboard

```bash
# In a new terminal
npm run dev -w host-dashboard
```

### 4. Start the Participant Page

```bash
# In a new terminal
npm run dev -w participant-page
```

## Configuration

### Environment Variables

Copy the `.env.example` files and configure:

**Server (.env)**:
```
PORT=3001
BASE_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:5173
SESSION_TIMEOUT=3600000
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_WS_URL=ws://localhost:7880
TURN_URL=turn:localhost:3478
TURN_USERNAME=iris
TURN_CREDENTIAL=syncd
```

**Host Dashboard (.env)**:
```
VITE_SOCKET_URL=http://localhost:3001
VITE_TURN_URL=turn:localhost:3478
VITE_TURN_USERNAME=iris
VITE_TURN_CREDENTIAL=syncd
```

**Participant Page (.env)**:
```
VITE_SOCKET_URL=http://localhost:3001
VITE_TURN_URL=turn:localhost:3478
VITE_TURN_USERNAME=iris
VITE_TURN_CREDENTIAL=syncd
```

### External Services

#### LiveKit (SFU)
See `server/livekit-setup.md` for detailed instructions.

#### coturn (STUN/TURN)
See `server/coturn-setup.md` for detailed instructions.

## Usage

### Creating a Session

1. Open the Host Dashboard at `http://localhost:5173`
2. Click "Create Session"
3. Share the QR code or link with participants

### Joining a Session

1. Scan the QR code or open the shared link
2. Choose your role: Speaker or Camera
3. Allow media permissions when prompted
4. You're connected!

### Host Controls

- **Play Audio**: Upload and play music files
- **Push to Talk**: Hold the button to broadcast live audio
- **Camera Grid**: View all connected camera feeds
- **Device Management**: Remove devices from the session

### Participant Features

- **Speaker Mode**: Plays synchronized audio from the host
- **Camera Mode**: Streams live video to the host dashboard
- **Background Audio**: Audio continues when app is backgrounded
- **Lock Screen Controls**: Media controls on lock screen

## Development

### Project Structure

```
iris-syncd/
├── server/                  # Signaling server
│   ├── src/
│   │   └── index.js        # Main server file
│   └── package.json
├── host-dashboard/          # React host dashboard
│   ├── src/
│   │   ├── App.jsx
│   │   ├── webrtc.js
│   │   └── audioSync.js
│   └── package.json
├── participant-page/        # Mobile participant page
│   ├── src/
│   │   ├── App.jsx
│   │   ├── webrtc.js
│   │   └── sw.js
│   └── package.json
└── package.json             # Root package.json
```

### Available Scripts

```bash
# Development
npm run dev                    # Start all services
npm run dev -w server          # Start server only
npm run dev -w host-dashboard  # Start host dashboard only
npm run dev -w participant-page # Start participant page only

# Production
npm run build                  # Build frontend apps
npm run start                  # Start production server
```

## Browser Support

- Chrome 72+
- Firefox 68+
- Safari 12.1+
- Edge 79+

## License

MIT
