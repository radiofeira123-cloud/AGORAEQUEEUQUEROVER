const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();

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

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Sessões principais (para celular/operador)
const sessions = {};
// Sessões do visualizador (com links IMGBB)
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
  console.log('🔌 socket connected:', socket.id);

  // Operator: create a new session (para celular)
  socket.on('create_session', () => {
    const id = crypto.randomUUID();
    sessions[id] = { photos: [] };
    socket.emit('session_created', id);
    console.log('🆕 session created', id);
  });

  // Criar sessão do visualizador com upload para IMGBB
  socket.on('create_viewer_session', async ({ session, photos }) => {
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

      if (uploadedUrls.length === 0) {
        throw new Error('Nenhuma foto foi enviada com sucesso para o IMGBB');
      }

      // Criar sessão do visualizador
      const viewerId = crypto.randomUUID();
      viewerSessions[viewerId] = {
        originalSession: session,
        photos: uploadedUrls,
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
    if (!session) return;
    socket.join(session);
    console.log(`🔗 ${socket.id} joined ${session}`);
    if (sessions[session] && sessions[session].photos && sessions[session].photos.length) {
      socket.emit('photos_ready', sessions[session].photos);
    }
  });

  // Join room para visualizador
  socket.on('join_viewer', (data) => {
    const viewerId = (data && data.viewerId) || data;
    if (!viewerId) return;
    
    socket.join(`viewer_${viewerId}`);
    console.log(`👀 ${socket.id} joined viewer ${viewerId}`);
    
    // Enviar fotos IMGBB se existirem
    if (viewerSessions[viewerId] && viewerSessions[viewerId].photos) {
      socket.emit('viewer_photos_ready', viewerSessions[viewerId].photos);
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
    io.to(session).emit('photos_ready', photos);
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
    if (sessions[session]) sessions[session].photos = [];
    io.to(session).emit('reset_session', { session });
    console.log(`🧹 end_session for ${session} -> reset_session emitted`);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 socket disconnect', socket.id, reason);
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
  console.log('📸 Sistema de cabine fotográfica rodando!');
});
