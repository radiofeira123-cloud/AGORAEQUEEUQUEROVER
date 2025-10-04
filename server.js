// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

// Socket.IO com CORS liberado
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));

// In-memory sessions store (photos as dataURLs)
const sessions = {};

// Health
app.get("/health", (req, res) => {
  res.json({ status: "OK", ts: new Date().toISOString() });
});

// Debug
app.get("/debug", (req, res) => {
  const rooms = {};
  for (const [id, s] of Object.entries(sessions)) {
    rooms[id] = { photos: (s.photos || []).length, createdAt: s.createdAt || null };
  }
  res.json({ time: new Date().toISOString(), sessions: rooms, clients: io.engine.clientsCount });
});

// Return session (if visualizador opens late)
app.get("/session/:id", (req, res) => {
  const id = req.params.id;
  res.json(sessions[id] || { photos: [] });
});

// Socket.IO handlers
io.on("connection", (socket) => {
  console.log("📡 socket connected:", socket.id);

  // Operator requests new session
  socket.on("create_session", () => {
    const sessionId = (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.random().toString(36).slice(2,8));
    sessions[sessionId] = { photos: [], createdAt: new Date().toISOString() };
    socket.emit("session_created", sessionId);
    console.log("🆕 session created:", sessionId);
  });

  // join a room/session
  socket.on("join_room", (data) => {
    const session = data?.session || data;
    if (!session) return;
    socket.join(session);
    console.log(`🔗 ${socket.id} joined ${session}`);
    // if there are already photos, send them
    if (sessions[session] && sessions[session].photos && sessions[session].photos.length) {
      socket.emit("photos_ready", sessions[session].photos);
    }
  });

  // photos from celular
  socket.on("photos_from_cell", ({ session, photos }) => {
    if (!session || !Array.isArray(photos)) {
      console.warn("Invalid photos payload from", socket.id);
      return;
    }
    sessions[session] = sessions[session] || { photos: [], createdAt: new Date().toISOString() };
    sessions[session].photos = photos.slice();
    sessions[session].lastUpdated = new Date().toISOString();
    console.log(`📸 Received ${photos.length} photos for session ${session} from ${socket.id}`);
    // Broadcast to all clients in that room
    io.to(session).emit("photos_ready", photos);
  });

  // operator ends session (reset)
  socket.on("end_session", (session) => {
    if (!session) return;
    console.log("🔴 end_session for", session);
    // clear stored photos but keep session meta
    if (sessions[session]) sessions[session].photos = [];
    io.to(session).emit("session_ended");
  });

  socket.on("disconnect", (reason) => {
    console.log("🔌 disconnect:", socket.id, reason);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
