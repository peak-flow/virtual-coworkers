<?php

use App\Http\Controllers\Api\RoomController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Room Management
Route::post('/rooms', [RoomController::class, 'store']);
Route::get('/rooms/{code}', [RoomController::class, 'show']);
Route::post('/rooms/{code}/join', [RoomController::class, 'join']);
Route::delete('/rooms/{code}', [RoomController::class, 'destroy']);

// Chat
Route::get('/rooms/{code}/messages', [RoomController::class, 'messages']);
Route::post('/rooms/{code}/messages', [RoomController::class, 'sendMessage']);
