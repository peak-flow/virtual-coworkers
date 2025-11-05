<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RoomMessage extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'room_id',
        'sender_name',
        'sender_session_id',
        'message',
        'type',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];

    /**
     * Get the room that owns the message.
     */
    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }
}
