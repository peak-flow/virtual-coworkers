<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Models\RoomMessage;
use App\Models\RoomSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class RoomController extends Controller
{
    /**
     * Create a new room.
     */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => 'nullable|string|max:255',
            'password' => 'nullable|string|min:4|max:50',
            'max_participants' => 'nullable|integer|min:2|max:10',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        // Rate limiting: check how many rooms this IP has created in the last hour
        $ip = $request->ip();
        $recentRoomsCount = Room::where('creator_ip', $ip)
            ->where('created_at', '>=', now()->subHour())
            ->count();

        if ($recentRoomsCount >= 10) {
            return response()->json([
                'success' => false,
                'message' => 'Rate limit exceeded. Maximum 10 rooms per hour.'
            ], 429);
        }

        // Generate unique 6-character code
        $code = $this->generateUniqueRoomCode();

        // Create room
        $room = Room::create([
            'code' => $code,
            'name' => $request->input('name'),
            'password_hash' => $request->filled('password') ? Hash::make($request->input('password')) : null,
            'max_participants' => $request->input('max_participants', 10),
            'settings' => [
                'timer_intervals' => [
                    'work' => 1500,
                    'short_break' => 300,
                    'long_break' => 900,
                ],
                'allow_guests' => true,
            ],
            'creator_ip' => $ip,
            'expires_at' => now()->addHours(24),
        ]);

        // Generate a session token for the creator
        $token = Str::uuid()->toString();

        // Store token in Redis with 24-hour expiry
        Redis::setex("room:{$code}:token:{$token}", 86400, '1');

        return response()->json([
            'success' => true,
            'room_code' => $code,
            'signaling_url' => config('app.signaling_url', 'ws://localhost:3000'),
            'signaling_token' => $token,
            'ice_servers' => $this->getIceServers(),
        ], 201);
    }

    /**
     * Get room details.
     */
    public function show(string $code): JsonResponse
    {
        $room = Room::where('code', $code)->first();

        if (!$room) {
            return response()->json([
                'success' => false,
                'message' => 'Room not found'
            ], 404);
        }

        if ($room->isExpired()) {
            return response()->json([
                'success' => false,
                'message' => 'Room has expired'
            ], 410);
        }

        return response()->json([
            'success' => true,
            'room' => [
                'code' => $room->code,
                'name' => $room->name,
                'max_participants' => $room->max_participants,
                'has_password' => $room->hasPassword(),
                'settings' => $room->settings,
                'expires_at' => $room->expires_at->toISOString(),
            ]
        ]);
    }

    /**
     * Join a room.
     */
    public function join(Request $request, string $code): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'password' => 'nullable|string',
            'display_name' => 'nullable|string|max:100',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        $room = Room::where('code', $code)->first();

        if (!$room) {
            return response()->json([
                'success' => false,
                'message' => 'Room not found'
            ], 404);
        }

        if ($room->isExpired()) {
            return response()->json([
                'success' => false,
                'message' => 'Room has expired'
            ], 410);
        }

        // Check password if room is password-protected
        if ($room->hasPassword()) {
            if (!$request->filled('password')) {
                return response()->json([
                    'success' => false,
                    'message' => 'Password required'
                ], 401);
            }

            if (!Hash::check($request->input('password'), $room->password_hash)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Incorrect password'
                ], 401);
            }
        }

        // Check if room is full (count active sessions)
        $activeParticipants = RoomSession::where('room_id', $room->id)
            ->whereNull('left_at')
            ->count();

        if ($activeParticipants >= $room->max_participants) {
            return response()->json([
                'success' => false,
                'message' => 'Room is full'
            ], 403);
        }

        // Generate a session token
        $token = Str::uuid()->toString();

        // Store token in Redis with 24-hour expiry
        Redis::setex("room:{$code}:token:{$token}", 86400, '1');

        // Create session record
        $sessionId = Str::uuid()->toString();
        RoomSession::create([
            'room_id' => $room->id,
            'session_id' => $sessionId,
            'display_name' => $request->input('display_name', 'Guest'),
            'joined_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'signaling_url' => config('app.signaling_url', 'ws://localhost:3000'),
            'signaling_token' => $token,
            'session_id' => $sessionId,
            'ice_servers' => $this->getIceServers(),
        ]);
    }

    /**
     * Delete a room.
     */
    public function destroy(Request $request, string $code): JsonResponse
    {
        $room = Room::where('code', $code)->first();

        if (!$room) {
            return response()->json([
                'success' => false,
                'message' => 'Room not found'
            ], 404);
        }

        // Simple IP-based creator check (in MVP, no user accounts)
        if ($room->creator_ip !== $request->ip()) {
            return response()->json([
                'success' => false,
                'message' => 'Only the room creator can delete the room'
            ], 403);
        }

        $room->delete();

        return response()->json([
            'success' => true,
            'message' => 'Room deleted successfully'
        ]);
    }

    /**
     * Get message history for a room.
     */
    public function messages(string $code): JsonResponse
    {
        $room = Room::where('code', $code)->first();

        if (!$room) {
            return response()->json([
                'success' => false,
                'message' => 'Room not found'
            ], 404);
        }

        $messages = RoomMessage::where('room_id', $room->id)
            ->orderBy('created_at', 'asc')
            ->get()
            ->map(function ($message) {
                return [
                    'id' => $message->id,
                    'sender_name' => $message->sender_name,
                    'message' => $message->message,
                    'type' => $message->type,
                    'created_at' => $message->created_at->toISOString(),
                ];
            });

        return response()->json([
            'success' => true,
            'messages' => $messages
        ]);
    }

    /**
     * Send a message to a room.
     */
    public function sendMessage(Request $request, string $code): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'sender_name' => 'nullable|string|max:100',
            'sender_session_id' => 'nullable|string',
            'message' => 'required|string|max:5000',
            'type' => 'nullable|in:text,system,emoji',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        $room = Room::where('code', $code)->first();

        if (!$room) {
            return response()->json([
                'success' => false,
                'message' => 'Room not found'
            ], 404);
        }

        $message = RoomMessage::create([
            'room_id' => $room->id,
            'sender_name' => $request->input('sender_name', 'Anonymous'),
            'sender_session_id' => $request->input('sender_session_id'),
            'message' => $request->input('message'),
            'type' => $request->input('type', 'text'),
        ]);

        return response()->json([
            'success' => true,
            'message' => [
                'id' => $message->id,
                'sender_name' => $message->sender_name,
                'message' => $message->message,
                'type' => $message->type,
                'created_at' => $message->created_at->toISOString(),
            ]
        ], 201);
    }

    /**
     * Generate a unique 6-character room code.
     */
    private function generateUniqueRoomCode(): string
    {
        do {
            // Generate random 6-character code using uppercase letters and numbers
            $code = strtoupper(Str::random(6));

            // Check if code already exists
            $exists = Room::where('code', $code)->exists();
        } while ($exists);

        return $code;
    }

    /**
     * Get ICE servers configuration for WebRTC.
     */
    private function getIceServers(): array
    {
        return [
            [
                'urls' => 'stun:stun.l.google.com:19302'
            ],
            // Add TURN server configuration here when available
            // [
            //     'urls' => 'turn:turn.example.com:80',
            //     'username' => 'temp-user',
            //     'credential' => 'temp-pass'
            // ]
        ];
    }
}
