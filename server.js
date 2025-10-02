const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// liberar CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// socket.io
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

// health check
app.get('/health', (req, res) => {
  res.json({ status: "OK", time: new Date().toISOString() });
});

// debug
app.get('/debug', (req, res) => {
  const rooms = {};
  io.sockets.adapter.rooms.forEach((sockets, name) => {
    if (!sockets.has(name)) {
      rooms[name] = { count: sockets.size, sockets: [...sockets] };
    }
  });
  res.json({ connections: io.engine.clientsCount, rooms });
});

// retorna fotos da sessão
const sessions = {};
app.get('/session/:id', (req, res) => {
  res.json(sessions[req.params.id] || { photos: [] });
});

io.on('connection', (socket) => {
  console.log('🔗 Nova conexão', socket.id);

  socket.on('join_room', ({ session }) => {
    if (session) {
      socket.join(session);
      console.log(`${socket.id} entrou na sala ${session}`);
    }
  });

  socket.on('photos_from_cell', (data) => {
    console.log('📸 Fotos recebidas da sessão', data.session);
    if (!sessions[data.session]) sessions[data.session] = { photos: [] };
    sessions[data.session].photos = data.photos;

    io.to(data.session).emit('photos_from_cell', {
      photos: data.photos,
      session: data.session,
      time: new Date().toISOString()
    });
  });

  socket.on('end_session', ({ session }) => {
    console.log('❌ Encerrando sessão', session);
    delete sessions[session];
    io.to(session).emit('end_session');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 Servidor rodando na porta', PORT);
});
