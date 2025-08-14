// server.js — persistent chat with SQLite + nicer UI
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import Database from "better-sqlite3";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// --- Database setup (SQLite) ---
const dbPath = path.join(__dirname, "messages.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  user TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room, ts DESC);
`);

const insertMessage = db.prepare("INSERT INTO messages (id, room, user, text, ts) VALUES (?, ?, ?, ?, ?)");
const selectRecent = db.prepare("SELECT id, room, user, text, ts FROM messages WHERE room = ? ORDER BY ts DESC LIMIT ?");
const selectRooms = db.prepare("SELECT DISTINCT room FROM messages ORDER BY room ASC");
const selectRoomAll = db.prepare("SELECT id, room, user, text, ts FROM messages WHERE room = ? ORDER BY ts ASC");

// --- Middleware & static ---
app.use(express.json());
app.use(express.static(path.join(__dirname, "client")));

// Health check
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

// API: rooms list
app.get("/api/rooms", (_req, res) => {
  const rows = selectRooms.all().map(r => r.room);
  const unique = Array.from(new Set(["lobby", ...rows]));
  res.json(unique);
});

// API: messages by room
app.get("/api/messages", (req, res) => {
  const room = String(req.query.room || "lobby");
  const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || "200", 10)));
  const rows = selectRecent.all(room, limit).reverse(); // return ascending for UI
  res.json(rows);
});

// API: export room history as JSON
app.get("/api/export", (req, res) => {
  const room = String(req.query.room || "lobby");
  const rows = selectRoomAll.all(room);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=\"${room}-history.json\"`);
  res.send(JSON.stringify({ room, count: rows.length, messages: rows }, null, 2));
});

const PORT = process.env.PORT || 3000;

// Socket.IO events
io.on("connection", (socket) => {
  // Join event { username, room }
  socket.on("room:join", async ({ username, room }) => {
    const cleanName = String(username || "anon").slice(0, 40).trim() || "anon";
    const cleanRoom = String(room || "lobby").slice(0, 40).trim() || "lobby";

    socket.data.username = cleanName;
    socket.data.room = cleanRoom;

    socket.join(cleanRoom);

    // Load recent history from DB and send to the new client
    const recent = selectRecent.all(cleanRoom, 200).reverse();
    socket.emit("room:history", recent);

    // Broadcast system join
    const sys = {
      id: crypto.randomUUID(),
      room: cleanRoom,
      user: "system",
      text: `${cleanName} joined ${cleanRoom}`,
      ts: Date.now()
    };
    insertMessage.run(sys.id, sys.room, sys.user, sys.text, sys.ts);
    io.to(cleanRoom).emit("chat:message", sys);

    // Update roster (list of usernames in the room)
    const roster = Array.from(io.sockets.adapter.rooms.get(cleanRoom) || [])
      .map(id => io.sockets.sockets.get(id)?.data?.username || "anon");
    io.to(cleanRoom).emit("room:roster", roster);
  });

  // Send message { text }
  socket.on("chat:send", ({ text }) => {
    const user = socket.data.username || "anon";
    const room = socket.data.room || "lobby";
    const msgText = String(text || "").slice(0, 4000);
    if (!msgText) return;

    const msg = {
      id: crypto.randomUUID(),
      room,
      user,
      text: msgText,
      ts: Date.now()
    };
    insertMessage.run(msg.id, msg.room, msg.user, msg.text, msg.ts);
    io.to(room).emit("chat:message", msg);
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (!room) return;

    const sys = {
      id: crypto.randomUUID(),
      room,
      user: "system",
      text: `${username || "anon"} left ${room}`,
      ts: Date.now()
    };
    insertMessage.run(sys.id, sys.room, sys.user, sys.text, sys.ts);
    io.to(room).emit("chat:message", sys);

    // Update roster
    const roster = Array.from(io.sockets.adapter.rooms.get(room) || [])
      .map(id => io.sockets.sockets.get(id)?.data?.username || "anon");
    io.to(room).emit("room:roster", roster);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server on http://localhost:${PORT}`);
  console.log(`🩺 Health at http://localhost:${PORT}/health`);
});
