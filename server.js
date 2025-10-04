const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();

// CORS MÁXIMO - PERMITIR TUDO
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-socket-id');
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

// Socket.IO com CORS MÁXIMO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true
});

// Sessões principais (para celular/operador)
const sessions = {};
// Sessões do visualizador (com data URLs e URLs IMGBB)
const viewerSessions = {};

const IMGBB_API_KEY = "6734e028b20f88d5795128d242f85582";

// Função para upload no IMGBB usando fetch nativo
async function uploadToImgbb(imageData) {
  try {
    const base64Data = imageData.split(',')[1];
    
    const formData = new URLSearchParams();
    formData.append('key', IMGBB_API_KEY);
    formData.append('image', base64Data);

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    if (data.success) {
      return data.data.url;
    } else {
      throw new Error('Upload failed: ' + (data.error?.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('❌ Erro no upload IMGBB:', error);
    return null;
  }
}

io.on('connection', (socket) => {
  console.log('🔌 NOVA CONEXÃO - socket:', socket.id, 'origin:', socket.handshake.headers.origin);

  // Operator: create a new session (para celular)
  socket.on('create_session', () => {
    const id = crypto.randomUUID();
    sessions[id] = { photos: [] };
    socket.emit('session_created', id);
    console.log('🆕 NOVA SESSÃO CRIADA:', id);
  });

  // Criar sessão do visualizador com upload para IMGBB (fotos + moldura)
  socket.on('create_viewer_session', async ({ session, photos, storiesMontage }) => {
    console.log('🔄 Criando sessão do visualizador para:', session);
    
    if (!session || !photos || !Array.isArray(photos)) {
      socket.emit('viewer_session_error', { error: 'Dados inválidos' });
      return;
    }

    try {
      // Fazer upload de cada foto para IMGBB
      const uploadedUrls = [];
      
      for (let i = 0; i < photos.length; i++) {
        console.log(`📤 Enviando foto ${i+1} para IMGBB...`);
        const imgbbUrl = await uploadToImgbb(photos[i]);
        if (imgbbUrl) {
          uploadedUrls.push(imgbbUrl);
          console.log(`✅ Foto ${i+1} enviada: ${imgbbUrl}`);
        } else {
          console.log(`❌ Falha no upload da foto ${i+1}`);
        }
      }

      // Fazer upload da moldura do stories para IMGBB
      let storiesUrl = null;
      if (storiesMontage) {
        console.log('📤 Enviando moldura do stories para IMGBB...');
        storiesUrl = await uploadToImgbb(storiesMontage);
        if (storiesUrl) {
          console.log(`✅ Moldura stories enviada: ${storiesUrl}`);
        } else {
          console.log('❌ Falha no upload da moldura do stories');
        }
      }

      // Criar sessão do visualizador
      const viewerId = crypto.randomUUID();
      viewerSessions[viewerId] = {
        originalSession: session,
        photos: photos, // Data URLs originais para download
        photosImgbb: uploadedUrls, // URLs IMGBB
        storiesMontage: storiesMontage, // Data URL da moldura
        storiesMontageImgbb: storiesUrl, // URL IMGBB da moldura
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias
      };

      console.log(`🎯 Sessão do visualizador criada: ${viewerId} com ${uploadedUrls.length} fotos`);
      socket.emit('viewer_session_created', { viewerId });

    } catch (error) {
      console.error('❌ Erro ao criar sessão do visualizador:', error);
      socket.emit('viewer_session_error', { error: error.message });
    }
  });

  // Join room para sessão principal
  socket.on('join_room', (data) => {
    const session = (data && data.session) || data;
    if (!session) {
      console.warn('❌ join_room missing session');
      return;
    }
    socket.join(session);
    console.log(`🔗 ${socket.id} entrou na sala: ${session}`);
    
    // Se já existem fotos nesta sessão, enviar para o cliente
    if (sessions[session] && sessions[session].photos && sessions[session].photos.length) {
      socket.emit('photos_ready', sessions[session].photos);
      console.log(`📸 Enviando ${sessions[session].photos.length} fotos existentes para ${socket.id}`);
    }
  });

  // Join room para visualizador
  socket.on('join_viewer', (data) => {
    const viewerId = (data && data.viewerId) || data;
    if (!viewerId) return;
    
    socket.join(`viewer_${viewerId}`);
    console.log(`👀 ${socket.id} entrou no visualizador: ${viewerId}`);
    
    // Enviar dados completos para o visualizador
    if (viewerSessions[viewerId]) {
      socket.emit('viewer_photos_ready', {
        photos: viewerSessions[viewerId].photos,
        photosImgbb: viewerSessions[viewerId].photosImgbb,
        storiesMontage: viewerSessions[viewerId].storiesMontage,
        storiesMontageImgbb: viewerSessions[viewerId].storiesMontageImgbb
      });
    }
  });

  // celular -> server: photos_from_cell - COM LOGS DETALHADOS
  socket.on('photos_from_cell', ({ session, photos }) => {
    console.log(`\n📸📸📸 RECEBENDO FOTOS DO CELULAR 📸📸📸`);
    console.log(`Sessão: ${session}`);
    console.log(`Quantidade de fotos: ${photos ? photos.length : 0}`);
    console.log(`Socket ID: ${socket.id}`);
    console.log(`Origem: ${socket.handshake.headers.origin}`);
    console.log(`Clientes na sala ${session}:`, io.sockets.adapter.rooms.get(session)?.size || 0);

    if (!session) {
      console.warn('❌ ERRO: photos_from_cell missing session');
      return;
    }
    
    if (!Array.isArray(photos)) {
      console.warn('❌ ERRO: photos not array in photos_from_cell');
      return;
    }

    // Initialize session if not exists
    if (!sessions[session]) {
      sessions[session] = { photos: [] };
      console.log(`🆕 Sessão ${session} criada no servidor`);
    }

    // Store photos
    sessions[session].photos = photos.slice();
    sessions[session].lastUpdated = new Date().toISOString();
    
    console.log(`✅ ${photos.length} fotos armazenadas para sessão ${session}`);
    
    // ENVIAR PARA TODOS NA SALA (OPERADOR)
    const room = io.sockets.adapter.rooms.get(session);
    const clientCount = room ? room.size : 0;
    
    console.log(`📤 Enviando fotos para ${clientCount} clientes na sala ${session}`);
    
    if (clientCount > 0) {
      io.to(session).emit('photos_ready', photos);
      console.log(`✅ FOTOS ENVIADAS PARA O OPERADOR - ${photos.length} fotos`);
    } else {
      console.log(`❌ NENHUM CLIENTE NA SALA ${session} PARA RECEBER AS FOTOS`);
    }
  });

  // celular informs it entered fullscreen
  socket.on('cell_entered_fullscreen', ({ session }) => {
    if (!session) return;
    io.to(session).emit('cell_entered_fullscreen', { session });
    console.log(`📵 Celular entrou em tela cheia para sessão ${session}`);
  });

  // operator clicks Finalizar Sessão
  socket.on('end_session', (session) => {
    if (!session) return;
    
    // Clear stored photos but keep session
    if (sessions[session]) {
      sessions[session].photos = [];
    }
    
    io.to(session).emit('reset_session', { session });
    console.log(`🧹 Sessão finalizada: ${session}`);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 socket disconnect', socket.id, reason);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    sessions: Object.keys(sessions).length,
    viewerSessions: Object.keys(viewerSessions).length,
    timestamp: new Date().toISOString()
  });
});

// Limpar sessões expiradas a cada hora
setInterval(() => {
  const now = new Date();
  let expiredCount = 0;
  
  Object.keys(viewerSessions).forEach(viewerId => {
    if (new Date(viewerSessions[viewerId].expiresAt) < now) {
      delete viewerSessions[viewerId];
      expiredCount++;
    }
  });
  
  if (expiredCount > 0) {
    console.log(`🗑️ Limpas ${expiredCount} sessões do visualizador expiradas`);
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server listening on port', PORT);
  console.log('🔓 CORS totalmente liberado para todas as origens');
});
