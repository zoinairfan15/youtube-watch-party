
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomBytes } from "node:crypto";
import type { Role } from "./types/room.js";
import playbackStates from "./playback.js";
import { createInitialPlaybackState } from "./types/playback.js";
import type { PlaybackState } from "./types/playback.js";

import rooms from "./rooms.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
  })
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "Watch Party Server Running",
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL,
  },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Create a new room.
  socket.on("create_room", () => {
    let roomId: string;

    do {
      roomId = randomBytes(4)
        .toString("hex")
        .slice(0, 6)
        .toUpperCase();
    } while (rooms.has(roomId));

    rooms.set(roomId, []);
    playbackStates.set(roomId, createInitialPlaybackState());

    console.log(`Room created: ${roomId}`);

    socket.emit("room_created", { roomId });
  });

  // Join an existing room.
  socket.on(
    "join_room",
    (data: { roomId: string; username: string }) => {
      const roomId = data.roomId.trim().toUpperCase();
      const username = data.username.trim();

      const participants = rooms.get(roomId);

      if (!participants) {
        socket.emit("room_error", {
          message: "Room not found. Check the room code and try again.",
        });
        return;
      }

      if (!username) {
        socket.emit("room_error", {
          message: "Username cannot be empty.",
        });
        return;
      }

      const existingParticipant = participants.find(
        (participant) => participant.id === socket.id
      );

      if (existingParticipant) {
        socket.emit("room_joined", {
          roomId,
          participant: existingParticipant,
          participants,
        });
        const playbackState = playbackStates.get(roomId);

if (playbackState) {
  socket.emit("sync_state", playbackState);
}
        return;
      }

    const role: Role =
  participants.length === 0 ? "host" : "participant";
      const participant = {
        id: socket.id,
        username,
        role,
      };

      participants.push(participant);

      socket.data.roomId = roomId;
      socket.join(roomId);

      socket.emit("room_joined", {
        roomId,
        participant,
        participants,
      });

     
socket.to(roomId).emit("user_joined", { participant });

// Send the current video and playback state to the new participant.
const playbackState = playbackStates.get(roomId);

if (playbackState) {
  socket.emit("sync_state", playbackState);
}

console.log(`${username} joined room ${roomId}`);
    }
  );
  
  // Only hosts and moderators can control playback.
  const canControlPlayback = (roomId: string): boolean => {
    const participants = rooms.get(roomId);
    const participant = participants?.find(
      (item) => item.id === socket.id
    );

    return (
      participant?.role === "host" ||
      participant?.role === "moderator"
    );
  };

  const broadcastPlayback = (
    roomId: string,
    state: PlaybackState
  ) => {
    // Send to everyone else; the controller already performed
    // the action in their own player.
    socket.to(roomId).emit("playback_update", state);
  };

  socket.on("play", (data: { currentTime: number }) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId || !canControlPlayback(roomId)) return;

    const state = playbackStates.get(roomId);
    if (!state || !state.videoId) return;

    if (
      typeof data?.currentTime === "number" &&
      Number.isFinite(data.currentTime) &&
      data.currentTime >= 0
    ) {
      state.currentTime = data.currentTime;
    }

    state.status = "playing";
    broadcastPlayback(roomId, state);
  });

  socket.on("pause", (data: { currentTime: number }) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId || !canControlPlayback(roomId)) return;

    const state = playbackStates.get(roomId);
    if (!state || !state.videoId) return;

    if (
      typeof data?.currentTime === "number" &&
      Number.isFinite(data.currentTime) &&
      data.currentTime >= 0
    ) {
      state.currentTime = data.currentTime;
    }

    state.status = "paused";
    broadcastPlayback(roomId, state);
  });

  socket.on("seek", (data: { currentTime: number }) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId || !canControlPlayback(roomId)) return;

    const state = playbackStates.get(roomId);
    if (!state || !state.videoId) return;

    if (
      typeof data?.currentTime !== "number" ||
      !Number.isFinite(data.currentTime) ||
      data.currentTime < 0
    ) {
      return;
    }

    state.currentTime = data.currentTime;
    broadcastPlayback(roomId, state);
  });
  
socket.on("sync_tick", (data: { currentTime: number }) => {
  const roomId = socket.data.roomId as string | undefined;

  if (!roomId || !canControlPlayback(roomId)) return;

  const state = playbackStates.get(roomId);

  if (!state || !state.videoId || state.status !== "playing") {
    return;
  }

  if (
    typeof data?.currentTime !== "number" ||
    !Number.isFinite(data.currentTime) ||
    data.currentTime < 0
  ) {
    return;
  }

  state.currentTime = data.currentTime;

  // Send the latest timestamp to other room members.
  socket.to(roomId).emit("playback_update", state);
});

socket.on(
  "assign_role",
  (data: { participantId: string; role: Role }) => {
    const roomId = socket.data.roomId as string | undefined;

    if (!roomId) return;

    const participants = rooms.get(roomId);
    if (!participants) return;

    // Only the host can assign roles.
    const currentUser = participants.find(
      (participant) => participant.id === socket.id
    );

    if (currentUser?.role !== "host") return;

    // For now, the host can only promote participants to moderators.
    if (data?.role !== "moderator") return;

    const target = participants.find(
      (participant) => participant.id === data.participantId
    );

    if (!target || target.role !== "participant") return;

    target.role = "moderator";

    // Notify everyone in the room about the updated participant list.
    io.to(roomId).emit("participants_updated", participants);
  }
);

socket.on("remove_participant", (data: { participantId: string }) => {
  const roomId = socket.data.roomId as string | undefined;

  if (!roomId) return;

  const participants = rooms.get(roomId);
  if (!participants) return;

  // Only the host can remove participants.
  const currentUser = participants.find(
    (participant) => participant.id === socket.id
  );

  if (currentUser?.role !== "host") return;

  // Find the user to remove.
  const target = participants.find(
    (participant) => participant.id === data?.participantId
  );

  // Do not allow removing yourself or another host.
  if (!target || target.id === socket.id || target.role === "host") return;

  // Notify the removed user.
  const targetSocket = io.sockets.sockets.get(target.id);

  targetSocket?.emit("participant_removed", {
    message: "You have been removed from the room.",
  });

  // Remove them from the room and participant list.
  targetSocket?.leave(roomId);
  if (targetSocket) {
    targetSocket.data.roomId = undefined;
  }

  const updatedParticipants = participants.filter(
    (participant) => participant.id !== target.id
  );

  rooms.set(roomId, updatedParticipants);

  // Notify everyone remaining in the room.
  io.to(roomId).emit("participants_updated", updatedParticipants);
  io.to(roomId).emit("user_left", {
    participantId: target.id,
  });
});

  socket.on("change_video", (data: { videoId: string }) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId || !canControlPlayback(roomId)) return;

    const state = playbackStates.get(roomId);
    if (!state) return;

    // A standard YouTube video ID is 11 characters.
    if (
      typeof data?.videoId !== "string" ||
      !/^[a-zA-Z0-9_-]{11}$/.test(data.videoId)
    ) {
      return;
    }

    state.videoId = data.videoId;
    state.status = "paused";
    state.currentTime = 0;

    broadcastPlayback(roomId, state);
  });

  // Remove a participant when they disconnect.
  socket.on("disconnect", () => {
    const roomId = socket.data.roomId as string | undefined;

    if (!roomId) return;

    const participants = rooms.get(roomId);

    if (!participants) return;

    const participantIndex = participants.findIndex(
      (participant) => participant.id === socket.id
    );

    if (participantIndex === -1) return;

    const [removedParticipant] = participants.splice(participantIndex, 1);

    socket.to(roomId).emit("user_left", {
      participantId: removedParticipant.id,
    });

    console.log(`${removedParticipant.username} left room ${roomId}`);

   if (participants.length === 0) {
  rooms.delete(roomId);
  playbackStates.delete(roomId);
  console.log(`Room deleted: ${roomId}`);
}
  });
});

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});