<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Room extends Model
{
    protected $fillable = [
        'code',
        'name',
        'password_hash',
        'max_participants',
        'settings',
        'creator_ip',
        'expires_at',
    ];

    protected $casts = [
        'settings' => 'array',
        'expires_at' => 'datetime',
        'max_participants' => 'integer',
    ];

    protected $hidden = [
        'password_hash',
    ];

    /**
     * Get the messages for the room.
     */
    public function messages(): HasMany
    {
        return $this->hasMany(RoomMessage::class);
    }

    /**
     * Get the sessions for the room.
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(RoomSession::class);
    }

    /**
     * Check if the room has a password.
     */
    public function hasPassword(): bool
    {
        return !empty($this->password_hash);
    }

    /**
     * Check if the room is expired.
     */
    public function isExpired(): bool
    {
        return $this->expires_at && $this->expires_at->isPast();
    }
}
