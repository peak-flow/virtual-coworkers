# FlowSync - Product Requirements Document (v2)

## Executive Summary
FlowSync is a peer-to-peer remote work collaboration tool that combines video chat, screen sharing, text chat, and pomodoro timer functionality for small teams (2-10 people). Using a hybrid Laravel + Node.js architecture with WebRTC for P2P connections, we minimize server infrastructure costs while providing real-time collaboration features.

## Table of Contents
1. [MVP Scope & Features](#mvp-scope--features)
2. [Technical Architecture](#technical-architecture)
3. [Database Schema](#database-schema)
4. [API Specification](#api-specification)
5. [Security Architecture](#security-architecture)
6. [Development Implementation Plan](#development-implementation-plan)
7. [Performance Specifications](#performance-specifications)
8. [Deployment Configuration](#deployment-configuration)
9. [Testing Strategy](#testing-strategy)
10. [Risk Mitigation](#risk-mitigation)
11. [Success Criteria](#success-criteria)

## MVP Scope & Features

### Core Features (MVP)

#### 1. Room Management
- **Create/Join Rooms** via unique 6-character codes
- **No authentication required** for MVP (just display names)
- **Room expiry** after 24 hours of inactivity
- **Maximum 10 participants** per room (P2P mesh network limitation)
- **Room passwords** (optional)

#### 2. Communication Features
- **Video Chat** 
  - Toggle camera on/off
  - Toggle microphone mute/unmute
  - Audio level indicators
  - Grid/Speaker view layouts
  
- **Screen Sharing**
  - One presenter at a time
  - "Present" button with screen/window/tab selection
  - Visual indicator of who's presenting
  
- **Text Chat**
  - Real-time messaging during session
  - Message timestamps
  - System messages for join/leave events
  - Emoji support
  
- **Participant Management**
  - List showing all participants
  - Connection quality indicators
  - "Raise hand" feature
  - Kick participant (room creator only)

#### 3. Pomodoro Timer
- **Synchronized timer** across all participants
- **Default intervals**: 
  - Work: 25 minutes
  - Short break: 5 minutes  
  - Long break: 15 minutes (after 4 pomodoros)
- **Controls**: Start/pause/reset (room creator only)
- **Notifications**: Audio chime + visual alert at interval end
- **Timer display**: Always visible in UI
- **Session counter**: Track completed pomodoros

#### 4. UI/UX Requirements
- **Pre-join lobby**
  - Camera/microphone preview
  - Device selection
  - Display name entry
  - Room password (if required)
  
- **Main Interface**
  - Responsive grid layout
  - Collapsible sidebars (chat/participants)
  - Fullscreen mode
  - Picture-in-picture for local video
  
- **Mobile Support**
  - Touch-optimized controls
  - Portrait/landscape modes
  - Swipe gestures for panel navigation

### Post-MVP Features (Phase 2)
- User accounts with room history
- Custom pomodoro intervals and sounds
- File sharing via WebRTC data channels
- Chat export and search
- Local recording
- Virtual backgrounds
- Breakout rooms
- Calendar integration
- Task list with timer integration

## Technical Architecture

### System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client (Browser)                      │
├─────────────────────────────────────────────────────────┤
│  Alpine.js + Tailwind CSS                               │
│  SimplePeer.js (WebRTC)                                 │
│  Socket.io Client                                       │
└────────┬──────────────────────────┬─────────────────────┘
         │                          │
         │ HTTP/REST API            │ WebSocket
         │                          │
┌────────▼─────────────┐   ┌───────▼──────────┐
│   Laravel Backend    │   │  Node.js Signal   │
│   (Business Logic)   │◄──┤     Server        │
├──────────────────────┤   ├──────────────────┤
│  • Room CRUD         │   │  • Socket.io      │
│  • Chat persistence  │   │  • Signal relay   │
│  • Session tokens    │   │  • Presence       │
│  • Admin dashboard   │   │  • Timer sync     │
└────────┬─────────────┘   └───────┬──────────┘
         │                          │
         └────────┬─────────────────┘
                  │
         ┌────────▼────────┐
         │  Shared Redis   │
         │   + MySQL       │
         └─────────────────┘
```

### Technology Stack

```yaml
Frontend:
  Core:
    - Alpine.js 3.x (reactive UI)
    - Tailwind CSS 3.x (styling)
    - Vite (build tool)
  
  WebRTC:
    - SimplePeer.js (WebRTC abstraction)
    - Socket.io Client 4.x (signaling)
  
  Storage:
    - LocalStorage (user preferences)
    - IndexedDB (chat history cache)

Backend Services:
  Laravel API (Port 8000):
    - Laravel 11.x
    - Sanctum (API tokens)
    - MySQL 8.0
    - Redis 7.x
    
  Node.js Signaling (Port 3000):
    - Node.js 20.x LTS
    - Socket.io 4.x
    - Redis client (ioredis)
    
Infrastructure:
  - Nginx (reverse proxy)
  - SSL via Let's Encrypt
  - TURN server (Xirsys free tier or Coturn)
  - Single VPS (4GB RAM minimum)
  - Tailscale VPN (admin access)
```

## Database Schema

### Laravel MySQL Database

```sql
-- rooms table
CREATE TABLE rooms (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(6) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash VARCHAR(255) NULL,
    max_participants INT DEFAULT 10,
    settings JSON,  -- {timer_intervals, allow_guests, etc}
    creator_ip VARCHAR(45),
    expires_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_expires (expires_at)
);

-- room_messages table
CREATE TABLE room_messages (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    room_id BIGINT NOT NULL,
    sender_name VARCHAR(100),
    sender_session_id VARCHAR(255),
    message TEXT,
    type ENUM('text', 'system', 'emoji'),
    created_at TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    INDEX idx_room_created (room_id, created_at)
);

-- room_sessions table (for analytics)
CREATE TABLE room_sessions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    room_id BIGINT NOT NULL,
    session_id VARCHAR(255),
    display_name VARCHAR(100),
    joined_at TIMESTAMP,
    left_at TIMESTAMP NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    INDEX idx_room_session (room_id, session_id)
);
```

### Redis Data Structure

```javascript
// Room tokens for authentication
"room:ABC123:token:uuid-here": "1"  // TTL: 24h

// Active room participants (managed by Node.js)
"room:ABC123:participants": Set["socket-id-1", "socket-id-2"]

// Timer state (managed by Node.js)
"room:ABC123:timer": {
  "status": "running|paused|stopped",
  "type": "work|short_break|long_break", 
  "remaining": 1500,
  "started_at": 1699123456789,
  "paused_at": null
}

// Presenter info
"room:ABC123:presenter": "socket-id-1"
```

## API Specification

### Laravel REST API Endpoints

```php
// Room Management
POST   /api/rooms                 // Create new room
GET    /api/rooms/{code}         // Get room details
POST   /api/rooms/{code}/join    // Validate and join room
DELETE /api/rooms/{code}         // End room (creator only)

// Chat
GET    /api/rooms/{code}/messages     // Get message history
POST   /api/rooms/{code}/messages     // Send message (persisted)

// Response format for room creation
{
  "room_code": "ABC123",
  "signaling_url": "wss://flowsync.app",
  "signaling_token": "uuid-token-here",
  "ice_servers": [
    {
      "urls": "stun:stun.l.google.com:19302"
    },
    {
      "urls": "turn:turn.xirsys.com:80",
      "username": "temp-user",
      "credential": "temp-pass"
    }
  ]
}
```

### Node.js Socket.io Events

```javascript
// Client -> Server Events
'join-room'        { room_code, token, display_name }
'leave-room'       { room_code }
'offer'            { to, offer }
'answer'           { to, answer }
'ice-candidate'    { to, candidate }
'start-timer'      { type: 'work|break' }
'pause-timer'      {}
'reset-timer'      {}
'start-presenting' {}
'stop-presenting'  {}
'raise-hand'       { raised: boolean }

// Server -> Client Events  
'room-joined'      { participants: [], timer_state: {} }
'user-joined'      { socket_id, display_name }
'user-left'        { socket_id }
'offer'            { from, offer }
'answer'           { from, answer }
'ice-candidate'    { from, candidate }
'timer-update'     { status, type, remaining }
'presenter-changed' { presenter_id }
'hand-raised'      { socket_id, raised }
'error'            { message, code }
```

## Security Architecture

```yaml
Authentication:
  - No user accounts in MVP
  - Session-based room tokens
  - Token validation between Laravel/Node.js via Redis
  
Authorization:
  - Room creator privileges (timer control, kick users)
  - IP-based rate limiting for room creation
  - Password-protected rooms (optional)
  
WebRTC Security:
  - Mandatory DTLS-SRTP encryption
  - TURN authentication with time-limited credentials
  - ICE candidate filtering
  
API Security:
  - CORS configured for frontend origin only
  - Rate limiting: 10 rooms/hour per IP
  - Request size limits
  - SQL injection prevention via Eloquent ORM
  
Infrastructure:
  - SSL/TLS everywhere
  - Firewall rules (only 80, 443, SSH via Tailscale)
  - No direct database access from Node.js
```

## Development Implementation Plan

### Phase 1: Foundation (Days 1-3)

**Day 1: Project Setup**
- Laravel project initialization
- Database schema and migrations
- Basic room CRUD API
- Redis configuration

**Day 2: Node.js Signaling Server**
- Socket.io server setup
- Redis integration for token validation
- Basic signaling relay implementation
- PM2 configuration for process management

**Day 3: Frontend Foundation**
- Alpine.js + Tailwind setup with Vite
- Basic UI layout (lobby, room view)
- Socket.io client connection
- Room join flow

### Phase 2: WebRTC Implementation (Days 4-7)

**Day 4-5: Peer Connections**
- SimplePeer integration
- Video/audio stream management
- Mesh network connection logic
- Connection state handling

**Day 6: Screen Sharing**
- Screen capture API implementation
- Presenter mode switching
- Stream replacement logic

**Day 7: UI Polish for Video**
- Grid/speaker view layouts
- Device selection
- Connection quality indicators
- Mute/camera controls

### Phase 3: Features & Polish (Days 8-10)

**Day 8: Pomodoro Timer**
- Timer synchronization logic
- UI components for timer
- Sound notifications
- Session tracking

**Day 9: Chat Implementation**
- Real-time messaging via Socket.io
- Message persistence via Laravel API
- Emoji picker
- System messages

**Day 10: Testing & Deployment**
- Cross-browser testing
- Mobile responsiveness
- VPS setup with Nginx
- SSL configuration
- Production deployment scripts

## Performance Specifications

### Target Metrics

```yaml
Connection Performance:
  - Time to first video: < 5 seconds
  - WebRTC connection success rate: > 95%
  - Peer-to-peer latency: < 100ms (same region)
  - Audio latency: < 150ms
  
Server Performance:
  - Concurrent rooms: 500+ per 4GB VPS
  - WebSocket connections: 3000+ per Node.js instance
  - API response time: < 100ms (p95)
  - Message delivery: < 50ms
  
Client Requirements:
  - Bandwidth: 2-3 Mbps up/down per participant
  - CPU: < 30% usage on modern laptop
  - Browser support: Chrome 90+, Firefox 88+, Safari 14+
  - Mobile: iOS 14+, Android 10+
```

### Scalability Plan

```yaml
Phase 1 (MVP): Single Server
  - Users: Up to 500 concurrent
  - Rooms: Up to 100 active
  - Cost: $20-40/month
  
Phase 2: Vertical Scaling
  - Upgrade to 8GB RAM VPS
  - Users: Up to 1000 concurrent
  - Rooms: Up to 200 active
  - Cost: $40-80/month
  
Phase 3: Horizontal Scaling
  - Add Redis Adapter for Socket.io
  - Multiple Node.js instances
  - Load balancer (Nginx)
  - Users: 5000+ concurrent
  - Cost: $200+/month
```

## Deployment Configuration

### Server Setup Script

```bash
#!/bin/bash
# Initial VPS setup for FlowSync

# System updates
apt update && apt upgrade -y

# Install dependencies
apt install -y nginx mysql-server redis-server nodejs npm php8.3-fpm composer

# Laravel setup
cd /var/www
composer create-project laravel/laravel flowsync-api
cd flowsync-api
cp .env.example .env
php artisan key:generate

# Node.js signaling server
cd /var/www
mkdir flowsync-signaling
cd flowsync-signaling
npm init -y
npm install socket.io ioredis dotenv
npm install -g pm2

# Nginx configuration
cat > /etc/nginx/sites-available/flowsync << 'EOF'
server {
    listen 80;
    server_name flowsync.app;
    
    # Laravel API
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Socket.io
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/flowsync /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Start services
cd /var/www/flowsync-signaling
pm2 start server.js --name flowsync-signaling
pm2 save
pm2 startup

cd /var/www/flowsync-api  
php artisan serve --host=0.0.0.0 --port=8000 &
```

### Monitoring & Logging

```yaml
Application Monitoring:
  - PM2 for Node.js process management
  - Laravel Telescope for debugging (dev)
  - Redis Monitor for real-time operations
  
Logging:
  - Laravel logs: /storage/logs
  - Node.js logs: PM2 logs
  - Nginx access/error logs
  
Metrics to Track:
  - Active rooms count
  - WebSocket connections
  - WebRTC connection success rate
  - API response times
  - Server resource usage
```

## Testing Strategy

### Development Testing

```yaml
Unit Tests (Laravel):
  - Room creation/validation
  - Token generation
  - Message persistence
  
Integration Tests:
  - Socket.io connection flow
  - Redis token validation
  - Timer synchronization
  
E2E Tests (Manual for MVP):
  - Complete user journey
  - Multi-user scenarios
  - Network failure recovery
  - Mobile device testing
```

### Browser/Device Matrix

```yaml
Desktop Browsers:
  - Chrome (latest)
  - Firefox (latest)
  - Safari (latest)
  - Edge (Chromium)
  
Mobile:
  - iOS Safari (iPhone, iPad)
  - Chrome Android
  - Samsung Internet
  
Network Conditions:
  - Cable/Fiber: Full quality
  - 4G: Auto quality adjustment
  - 3G: Audio only fallback
```

## Risk Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|-------------------|
| TURN server costs explode | High | Implement daily quotas, use Xirsys free tier initially |
| WebRTC connection failures | High | Comprehensive error messages, fallback to TURN-only |
| Socket.io server crash | High | PM2 auto-restart, health checks |
| Timer desynchronization | Medium | Server authoritative time, periodic sync |
| Room hijacking | Medium | Room passwords, token validation |
| Bandwidth overload | Medium | Automatic video quality adjustment |
| MySQL downtime | Low | Graceful degradation, rooms work without persistence |

## Success Criteria

### MVP Launch Metrics
- ✅ 10 successful test sessions with 5+ participants
- ✅ < 5% WebRTC connection failure rate
- ✅ < $50/month infrastructure cost
- ✅ Mobile support working on iOS/Android
- ✅ Timer stays synchronized within 2 seconds
- ✅ No critical security vulnerabilities

### 3-Month Goals
- 1000+ total room sessions
- 100+ daily active rooms
- User feedback score > 4.0/5.0
- Server costs < $100/month
- Zero security incidents

---

## Appendix A: Node.js Signaling Server Code

```javascript
// server.js - Complete signaling server
const io = require('socket.io')(3000, {
    cors: { 
        origin: process.env.LARAVEL_URL || 'http://localhost:8000',
        methods: ['GET', 'POST']
    }
});

const Redis = require('ioredis');
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
});

const rooms = new Map();

io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join-room', async (data) => {
        const { room_code, token, display_name } = data;
        
        // Validate token with Redis
        const valid = await redis.get(`room:${room_code}:token:${token}`);
        if (!valid) {
            socket.emit('error', { message: 'Invalid room token' });
            return socket.disconnect();
        }
        
        // Join socket.io room
        socket.join(room_code);
        socket.data.room_code = room_code;
        socket.data.display_name = display_name;
        
        // Track participants
        if (!rooms.has(room_code)) {
            rooms.set(room_code, new Map());
        }
        rooms.get(room_code).set(socket.id, { display_name });
        
        // Get timer state from Redis
        const timerState = await redis.hgetall(`room:${room_code}:timer`);
        
        // Send current state to new user
        socket.emit('room-joined', {
            participants: Array.from(rooms.get(room_code).entries()).map(([id, data]) => ({
                socket_id: id,
                display_name: data.display_name
            })),
            timer_state: timerState
        });
        
        // Notify others
        socket.to(room_code).emit('user-joined', {
            socket_id: socket.id,
            display_name
        });
    });
    
    // WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            from: socket.id,
            offer: data.offer
        });
    });
    
    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            from: socket.id,
            answer: data.answer
        });
    });
    
    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            from: socket.id,
            candidate: data.candidate
        });
    });
    
    // Timer controls
    socket.on('start-timer', async (data) => {
        const room_code = socket.data.room_code;
        const timerData = {
            status: 'running',
            type: data.type || 'work',
            remaining: data.type === 'work' ? 1500 : 300,
            started_at: Date.now()
        };
        
        await redis.hmset(`room:${room_code}:timer`, timerData);
        io.to(room_code).emit('timer-update', timerData);
    });
    
    socket.on('pause-timer', async () => {
        const room_code = socket.data.room_code;
        await redis.hset(`room:${room_code}:timer`, 'status', 'paused');
        io.to(room_code).emit('timer-update', { status: 'paused' });
    });
    
    // Cleanup on disconnect
    socket.on('disconnect', () => {
        const room_code = socket.data.room_code;
        if (room_code && rooms.has(room_code)) {
            rooms.get(room_code).delete(socket.id);
            socket.to(room_code).emit('user-left', socket.id);
            
            // Clean up empty rooms
            if (rooms.get(room_code).size === 0) {
                rooms.delete(room_code);
            }
        }
    });
});

console.log('FlowSync signaling server running on port 3000');
```

---

This PRD represents a production-ready architecture that balances simplicity with performance. The hybrid Laravel/Node.js approach minimizes learning curve while providing excellent real-time performance. The system is designed to scale from MVP to thousands of concurrent users with minimal architectural changes.

## Version History
- v2.0 - Updated architecture to hybrid Laravel/Node.js approach
- v1.0 - Initial PRD with pure Laravel WebSockets

## Contact
[Your Name]  
[Your Email]  
[GitHub Repository URL]
