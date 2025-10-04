// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();

// CORS AMPLIADO para todas as origens
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://agoraequeeuquerover.vercel.app',
    'https://agoraequeeuquerover.onrender.com',
    'http://localhost:3000',
    'http://localhost:10000'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-socket-id');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Socket.IO com CORS ampliado
const io = new Server(server, {
  cors: {
    origin: [
      'https://agoraequeeuquerover.vercel.app',
      'https://agoraequeeuquerover.onrender.com',
      'http://localhost:3000',
      'http://localhost:10000'
    ],
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['*']
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true
});

// In-memory sessions store
const sessions = {};

io.on('connection', (socket) => {
  console.log('🔌 socket connected:', socket.id, 'from origin:', socket.handshake.headers.origin);

  // Operator: create a new session
  socket.on('create_session', () => {
    const id = crypto.randomUUID();
    sessions[id] = { photos: [], createdAt: new Date().toISOString() };
    socket.emit('session_created', id);
    console.log('🆕 session created', id);
  });

  // join a room/session
  socket.on('join_room', (data) => {
    const session = (data && data.session) || data;
    if (!session) {
      console.warn('❌ join_room missing session');
      return;
    }
    
    socket.join(session);
    console.log(`🔗 ${socket.id} joined ${session}`);
    
    // Send existing photos if any
    if (sessions[session] && sessions[session].photos && sessions[session].photos.length > 0) {
      socket.emit('photos_ready', sessions[session].photos);
      console.log(`📸 Sent ${sessions[session].photos.length} existing photos to ${socket.id}`);
    }
  });

  // celular -> server: photos_from_cell
  socket.on('photos_from_cell', ({ session, photos }) => {
    console.log(`📸 Received photos_from_cell for session: ${session}`, {
      photosCount: photos ? photos.length : 0,
      socketId: socket.id,
      origin: socket.handshake.headers.origin
    });

    if (!session) {
      console.warn('❌ photos_from_cell missing session');
      return;
    }
    
    if (!Array.isArray(photos)) {
      console.warn('❌ photos not array in photos_from_cell');
      return;
    }

    // Initialize session if not exists
    if (!sessions[session]) {
      sessions[session] = { photos: [] };
    }

    // Store photos
    sessions[session].photos = photos.slice();
    sessions[session].lastUpdated = new Date().toISOString();
    
    console.log(`✅ Stored ${photos.length} photos for session ${session}`);
    
    // Broadcast to everyone in that room (operator)
    io.to(session).emit('photos_ready', photos);
    console.log(`📤 Broadcasted photos to room ${session}`);
  });

  // celular informs it entered fullscreen
  socket.on('cell_entered_fullscreen', ({ session }) => {
    if (!session) return;
    io.to(session).emit('cell_entered_fullscreen', { session });
    console.log(`📵 cell entered fullscreen for ${session}`);
  });

  // operator clicks Finalizar Sessão
  socket.on('end_session', (session) => {
    if (!session) return;
    
    // Clear stored photos but keep session
    if (sessions[session]) {
      sessions[session].photos = [];
    }
    
    io.to(session).emit('reset_session', { session });
    console.log(`🧹 end_session for ${session} -> reset_session emitted`);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 socket disconnect', socket.id, reason);
  });

  // Debug event
  socket.on('debug', (data) => {
    console.log('🐛 DEBUG:', data);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    sessions: Object.keys(sessions).length,
    timestamp: new Date().toISOString()
  });
});

// Get session info
app.get('/session/:id', (req, res) => {
  const session = sessions[req.params.id];
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server listening on port', PORT);
  console.log('🌐 CORS enabled for:', [
    'https://agoraequeeuquerover.vercel.app',
    'https://agoraequeeuquerover.onrender.com',
    'http://localhost:3000',
    'http://localhost:10000'
  ]);
});
