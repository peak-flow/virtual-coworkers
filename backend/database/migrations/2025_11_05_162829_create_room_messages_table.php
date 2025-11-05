<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('room_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained()->onDelete('cascade');
            $table->string('sender_name', 100)->nullable();
            $table->string('sender_session_id')->nullable();
            $table->text('message');
            $table->enum('type', ['text', 'system', 'emoji'])->default('text');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['room_id', 'created_at'], 'idx_room_created');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('room_messages');
    }
};
