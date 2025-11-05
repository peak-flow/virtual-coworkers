import { Server } from 'socket.io';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8000';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// Initialize Socket.io server
const io = new Server(PORT, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Initialize Redis client
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

redis.on('connect', () => {
    console.log('✓ Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis error:', err);
});

// In-memory storage for room state
const rooms = new Map();

/**
 * Get or create room state
 */
function getRoomState(roomCode) {
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, {
            participants: new Map(),
            timer: {
                status: 'stopped',
                type: 'work',
                remaining: 1500,
                started_at: null,
                paused_at: null
            },
            presenter: null,
            createdAt: Date.now()
        });
    }
    return rooms.get(roomCode);
}

/**
 * Clean up empty rooms
 */
function cleanupRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (room && room.participants.size === 0) {
        rooms.delete(roomCode);
        console.log(`Cleaned up empty room: ${roomCode}`);
    }
}

/**
 * Socket.io connection handler
 */
io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.id}`);

    /**
     * Join Room Event
     */
    socket.on('join-room', async (data) => {
        try {
            const { room_code, token, display_name } = data;

            if (!room_code || !token) {
                socket.emit('error', {
                    message: 'Missing room_code or token',
                    code: 'INVALID_REQUEST'
                });
                return;
            }

            // Validate token with Redis
            const tokenKey = `room:${room_code}:token:${token}`;
            const isValidToken = await redis.get(tokenKey);

            if (!isValidToken) {
                socket.emit('error', {
                    message: 'Invalid or expired room token',
                    code: 'INVALID_TOKEN'
                });
                socket.disconnect();
                return;
            }

            // Join the Socket.io room
            socket.join(room_code);

            // Store room and user data on socket
            socket.data.room_code = room_code;
            socket.data.display_name = display_name || 'Guest';
            socket.data.hand_raised = false;

            // Get or create room state
            const roomState = getRoomState(room_code);

            // Add participant to room
            roomState.participants.set(socket.id, {
                display_name: socket.data.display_name,
                hand_raised: false,
                joined_at: Date.now()
            });

            console.log(`${socket.data.display_name} joined room ${room_code}`);

            // Send current room state to the new user
            socket.emit('room-joined', {
                participants: Array.from(roomState.participants.entries()).map(([id, data]) => ({
                    socket_id: id,
                    display_name: data.display_name,
                    hand_raised: data.hand_raised
                })),
                timer_state: roomState.timer,
                presenter: roomState.presenter
            });

            // Notify other users in the room
            socket.to(room_code).emit('user-joined', {
                socket_id: socket.id,
                display_name: socket.data.display_name
            });

        } catch (error) {
            console.error('Error in join-room:', error);
            socket.emit('error', {
                message: 'Failed to join room',
                code: 'JOIN_FAILED'
            });
        }
    });

    /**
     * Leave Room Event
     */
    socket.on('leave-room', () => {
        handleDisconnect(socket);
    });

    /**
     * WebRTC Signaling - Offer
     */
    socket.on('offer', (data) => {
        const { to, offer } = data;

        if (!to || !offer) {
            socket.emit('error', {
                message: 'Missing required fields for offer',
                code: 'INVALID_OFFER'
            });
            return;
        }

        socket.to(to).emit('offer', {
            from: socket.id,
            offer: offer
        });
    });

    /**
     * WebRTC Signaling - Answer
     */
    socket.on('answer', (data) => {
        const { to, answer } = data;

        if (!to || !answer) {
            socket.emit('error', {
                message: 'Missing required fields for answer',
                code: 'INVALID_ANSWER'
            });
            return;
        }

        socket.to(to).emit('answer', {
            from: socket.id,
            answer: answer
        });
    });

    /**
     * WebRTC Signaling - ICE Candidate
     */
    socket.on('ice-candidate', (data) => {
        const { to, candidate } = data;

        if (!to || !candidate) {
            socket.emit('error', {
                message: 'Missing required fields for ICE candidate',
                code: 'INVALID_ICE'
            });
            return;
        }

        socket.to(to).emit('ice-candidate', {
            from: socket.id,
            candidate: candidate
        });
    });

    /**
     * Timer - Start
     */
    socket.on('start-timer', async (data) => {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            socket.emit('error', {
                message: 'Not in a room',
                code: 'NO_ROOM'
            });
            return;
        }

        const roomState = getRoomState(roomCode);
        const { type } = data;

        // Determine duration based on type
        let duration = 1500; // default: 25 minutes
        if (type === 'short_break') {
            duration = 300; // 5 minutes
        } else if (type === 'long_break') {
            duration = 900; // 15 minutes
        }

        roomState.timer = {
            status: 'running',
            type: type || 'work',
            remaining: duration,
            started_at: Date.now(),
            paused_at: null
        };

        // Store timer state in Redis
        await redis.hmset(`room:${roomCode}:timer`, {
            status: roomState.timer.status,
            type: roomState.timer.type,
            remaining: roomState.timer.remaining,
            started_at: roomState.timer.started_at
        });

        // Broadcast timer update to all participants
        io.to(roomCode).emit('timer-update', roomState.timer);

        console.log(`Timer started in room ${roomCode}: ${type} for ${duration}s`);
    });

    /**
     * Timer - Pause
     */
    socket.on('pause-timer', async () => {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            socket.emit('error', {
                message: 'Not in a room',
                code: 'NO_ROOM'
            });
            return;
        }

        const roomState = getRoomState(roomCode);

        if (roomState.timer.status === 'running') {
            const elapsed = Math.floor((Date.now() - roomState.timer.started_at) / 1000);
            roomState.timer.remaining = Math.max(0, roomState.timer.remaining - elapsed);
            roomState.timer.status = 'paused';
            roomState.timer.paused_at = Date.now();

            // Update Redis
            await redis.hmset(`room:${roomCode}:timer`, {
                status: 'paused',
                remaining: roomState.timer.remaining,
                paused_at: roomState.timer.paused_at
            });

            // Broadcast update
            io.to(roomCode).emit('timer-update', roomState.timer);

            console.log(`Timer paused in room ${roomCode}`);
        }
    });

    /**
     * Timer - Reset
     */
    socket.on('reset-timer', async () => {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            socket.emit('error', {
                message: 'Not in a room',
                code: 'NO_ROOM'
            });
            return;
        }

        const roomState = getRoomState(roomCode);

        roomState.timer = {
            status: 'stopped',
            type: 'work',
            remaining: 1500,
            started_at: null,
            paused_at: null
        };

        // Update Redis
        await redis.hmset(`room:${roomCode}:timer`, {
            status: 'stopped',
            type: 'work',
            remaining: 1500
        });

        // Broadcast update
        io.to(roomCode).emit('timer-update', roomState.timer);

        console.log(`Timer reset in room ${roomCode}`);
    });

    /**
     * Presenter - Start Presenting
     */
    socket.on('start-presenting', () => {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            socket.emit('error', {
                message: 'Not in a room',
                code: 'NO_ROOM'
            });
            return;
        }

        const roomState = getRoomState(roomCode);

        // Only allow one presenter at a time
        if (roomState.presenter && roomState.presenter !== socket.id) {
            socket.emit('error', {
                message: 'Someone else is already presenting',
                code: 'PRESENTER_EXISTS'
            });
            return;
        }

        roomState.presenter = socket.id;

        // Broadcast presenter change
        io.to(roomCode).emit('presenter-changed', {
            presenter_id: socket.id,
            display_name: socket.data.display_name
        });

        console.log(`${socket.data.display_name} started presenting in room ${roomCode}`);
    });

    /**
     * Presenter - Stop Presenting
     */
    socket.on('stop-presenting', () => {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            socket.emit('error', {
                message: 'Not in a room',
                code: 'NO_ROOM'
            });
            return;
        }

        const roomState = getRoomState(roomCode);

        if (roomState.presenter === socket.id) {
            roomState.presenter = null;

            // Broadcast presenter change
            io.to(roomCode).emit('presenter-changed', {
                presenter_id: null
            });

            console.log(`${socket.data.display_name} stopped presenting in room ${roomCode}`);
        }
    });

    /**
     * Raise/Lower Hand
     */
    socket.on('raise-hand', (data) => {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            socket.emit('error', {
                message: 'Not in a room',
                code: 'NO_ROOM'
            });
            return;
        }

        const { raised } = data;
        socket.data.hand_raised = raised;

        const roomState = getRoomState(roomCode);
        const participant = roomState.participants.get(socket.id);

        if (participant) {
            participant.hand_raised = raised;
        }

        // Broadcast to room
        io.to(roomCode).emit('hand-raised', {
            socket_id: socket.id,
            display_name: socket.data.display_name,
            raised: raised
        });

        console.log(`${socket.data.display_name} ${raised ? 'raised' : 'lowered'} hand in room ${roomCode}`);
    });

    /**
     * Kick Participant (creator only - would need additional auth)
     */
    socket.on('kick-participant', (data) => {
        const roomCode = socket.data.room_code;
        const { socket_id } = data;

        if (!roomCode || !socket_id) {
            return;
        }

        // Find the socket to kick
        const socketToKick = io.sockets.sockets.get(socket_id);

        if (socketToKick && socketToKick.data.room_code === roomCode) {
            socketToKick.emit('kicked', {
                message: 'You have been removed from the room'
            });
            socketToKick.disconnect();

            console.log(`Participant ${socket_id} kicked from room ${roomCode}`);
        }
    });

    /**
     * Disconnect Handler
     */
    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });

    /**
     * Handle user disconnect
     */
    function handleDisconnect(socket) {
        const roomCode = socket.data.room_code;

        if (!roomCode) {
            console.log(`User disconnected: ${socket.id}`);
            return;
        }

        const roomState = rooms.get(roomCode);

        if (roomState) {
            // Remove participant
            roomState.participants.delete(socket.id);

            // If this user was presenting, clear presenter
            if (roomState.presenter === socket.id) {
                roomState.presenter = null;
                socket.to(roomCode).emit('presenter-changed', {
                    presenter_id: null
                });
            }

            // Notify other users
            socket.to(roomCode).emit('user-left', {
                socket_id: socket.id
            });

            console.log(`${socket.data.display_name} left room ${roomCode}`);

            // Clean up empty room
            cleanupRoom(roomCode);
        } else {
            console.log(`User disconnected: ${socket.id}`);
        }
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    io.close(() => {
        console.log('Socket.io server closed');
        redis.quit();
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, closing server...');
    io.close(() => {
        console.log('Socket.io server closed');
        redis.quit();
        process.exit(0);
    });
});

console.log(`
╔══════════════════════════════════════╗
║   FlowSync Signaling Server v1.0.0   ║
╚══════════════════════════════════════╝

✓ Socket.io listening on port ${PORT}
✓ CORS origin: ${CORS_ORIGIN}
✓ Redis: ${REDIS_HOST}:${REDIS_PORT}

Server is ready to accept connections!
`);
