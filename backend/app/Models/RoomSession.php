<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RoomSession extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'room_id',
        'session_id',
        'display_name',
        'joined_at',
        'left_at',
    ];

    protected $casts = [
        'joined_at' => 'datetime',
        'left_at' => 'datetime',
    ];

    /**
     * Get the room that owns the session.
     */
    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    /**
     * Check if the session is active.
     */
    public function isActive(): bool
    {
        return is_null($this->left_at);
    }
}
