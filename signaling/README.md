# FlowSync Signaling Server

WebRTC signaling server for FlowSync - handles real-time communication, room management, and timer synchronization.

## Features

- **WebRTC Signaling**: Relay offer/answer/ICE candidates for peer connections
- **Room Management**: Join/leave events with participant tracking
- **Timer Synchronization**: Coordinated pomodoro timer across all participants
- **Presenter Control**: Manage screen sharing presenter state
- **Redis Integration**: Token validation and state persistence
- **Hand Raising**: Virtual hand raising for participant interactions

## Requirements

- Node.js 20.x LTS or higher
- Redis 7.x or higher
- npm or yarn

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
PORT=3000
CORS_ORIGIN=http://localhost:8000
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=development
```

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### With PM2
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Socket.io Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join-room` | `{room_code, token, display_name}` | Join a room |
| `leave-room` | - | Leave current room |
| `offer` | `{to, offer}` | Send WebRTC offer |
| `answer` | `{to, answer}` | Send WebRTC answer |
| `ice-candidate` | `{to, candidate}` | Send ICE candidate |
| `start-timer` | `{type}` | Start pomodoro timer |
| `pause-timer` | - | Pause timer |
| `reset-timer` | - | Reset timer |
| `start-presenting` | - | Start screen sharing |
| `stop-presenting` | - | Stop screen sharing |
| `raise-hand` | `{raised}` | Raise/lower hand |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room-joined` | `{participants, timer_state, presenter}` | Successful room join |
| `user-joined` | `{socket_id, display_name}` | New user joined |
| `user-left` | `{socket_id}` | User left room |
| `offer` | `{from, offer}` | WebRTC offer received |
| `answer` | `{from, answer}` | WebRTC answer received |
| `ice-candidate` | `{from, candidate}` | ICE candidate received |
| `timer-update` | `{status, type, remaining, started_at}` | Timer state changed |
| `presenter-changed` | `{presenter_id, display_name}` | Presenter changed |
| `hand-raised` | `{socket_id, display_name, raised}` | Hand state changed |
| `error` | `{message, code}` | Error occurred |
| `kicked` | `{message}` | Kicked from room |

## Architecture

```
Client (Browser)
    ↓ WebSocket
Socket.io Server
    ↓ Token Validation
Redis (Session Store)
```

## Monitoring

View logs:
```bash
pm2 logs flowsync-signaling
```

Monitor resources:
```bash
pm2 monit
```

## License

MIT
