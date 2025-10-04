// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();

// CORS simples para todas origens (permite Vercel, Render, celular)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Socket.IO com CORS e polling (mais robusto para hosting)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// In-memory sessions store (simples)
const sessions = {}; // { sessionId: { photos: [...] } }

io.on('connection', (socket) => {
  console.log('🔌 socket connected:', socket.id);

  // Operator: create a new session (only once at start)
  socket.on('create_session', () => {
    const id = (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    sessions[id] = { photos: [] };
    socket.emit('session_created', id);
    console.log('🆕 session created', id);
  });

  // join a room/session (both celular and operator call this)
  socket.on('join_room', (data) => {
    const session = (data && data.session) || data;
    if (!session) return;
    socket.join(session);
    console.log(`🔗 ${socket.id} joined ${session}`);
    // if already have photos stored, send them to the joined client
    if (sessions[session] && sessions[session].photos && sessions[session].photos.length) {
      socket.emit('photos_ready', sessions[session].photos);
    }
  });

  // celular -> server: photos_from_cell
  socket.on('photos_from_cell', ({ session, photos }) => {
    if (!session) return console.warn('missing session in photos_from_cell');
    if (!Array.isArray(photos)) return console.warn('photos not array');
    sessions[session] = sessions[session] || { photos: [] };
    sessions[session].photos = photos.slice();
    sessions[session].lastUpdated = new Date().toISOString();
    console.log(`📷 Received ${photos.length} photos for session ${session}`);
    // broadcast to everyone in that room (operator)
    io.to(session).emit('photos_ready', photos);
  });

  // celular informs it entered fullscreen (so operator hides QR)
  socket.on('cell_entered_fullscreen', ({ session }) => {
    if (!session) return;
    io.to(session).emit('cell_entered_fullscreen', { session });
    console.log(`📵 cell entered fullscreen for ${session}`);
  });

  // operator clicks Finalizar Sessão -> server tells cell(s) to reset (show welcome)
  socket.on('end_session', (session) => {
    if (!session) return;
    // clear stored photos for that session (but keep the session id so celular stays connected)
    if (sessions[session]) sessions[session].photos = [];
    io.to(session).emit('reset_session', { session });
    console.log(`🧹 end_session for ${session} -> reset_session emitted`);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 socket disconnect', socket.id, reason);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server listening on port', PORT);
});
