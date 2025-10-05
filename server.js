const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();

// CORS MÁXIMO - PERMITIR TUDO
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

// SERVIÇO DE ARQUIVOS ESTÁTICOS
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (path.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    }
  }
}));

// ROTAS PARA OS ARQUIVOS PRINCIPAIS
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/celular.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'celular.html'));
});

app.get('/visualizador.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'visualizador.html'));
});

// ROTAS PARA AS IMAGENS
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logo.png'));
});

app.get('/caralho (1).png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'caralho (1).png'));
});

app.get('/imprimir (1).png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'imprimir (1).png'));
});

app.get('/clack.mp3', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'clack.mp3'));
});

const server = http.createServer(app);

// Socket.IO com CORS
const io = new Server(server, {
  cors: {
    origin: [
      'https://agoraequeeuquerover.vercel.app',
      'https://agoraequeeuquerover.onrender.com',
      'http://localhost:3000',
      'http://localhost:10000'
    ],
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

// ✅ CORREÇÃO: Função de upload IMGBB melhorada
async function uploadToImgbb(imageData) {
    try {
        console.log(`📤 Iniciando upload para IMGBB...`);
        
        // Verificar se a imagem é muito grande
        if (imageData.length > 5000000) {
            console.warn('⚠️ Imagem muito grande, pode causar problemas');
        }
        
        const base64Data = imageData.split(',')[1];
        
        const formData = new URLSearchParams();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', base64Data);

        console.log(`📊 Tamanho base64: ${Math.round(base64Data.length/1024)}KB`);
        
        const response = await fetch('https://api.imgbb.com/1/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            console.log(`✅ Upload IMGBB bem-sucedido: ${data.data.url}`);
            return data.data.url;
        } else {
            console.error(`❌ Upload IMGBB falhou: ${data.error?.message || 'Erro desconhecido'}`);
            return null;
        }
    } catch (error) {
        console.error('❌ Erro no upload IMGBB:', error.message);
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

  // ✅ CORREÇÃO: Evento create_viewer_session com tratamento melhorado
  socket.on('create_viewer_session', async ({ session, photos, storiesMontage }) => {
    console.log(`\n🔄🔄🔄 CREATE_VIEWER_SESSION INICIADO 🔄🔄🔄`);
    console.log(`📍 Sessão: ${session}`);
    console.log(`📸 Quantidade de fotos: ${photos ? photos.length : 0}`);
    console.log(`🖼️ Stories Montage: ${storiesMontage ? 'Sim' : 'Não'}`);
    console.log(`🔌 Socket ID: ${socket.id}`);

    if (!session || !photos || !Array.isArray(photos)) {
        console.error('❌❌❌ ERRO: Dados inválidos para create_viewer_session');
        socket.emit('viewer_session_error', { error: 'Dados inválidos' });
        return;
    }

    try {
        console.log('🚀 Iniciando uploads para IMGBB...');

        // Fazer upload de cada foto para IMGBB
        const uploadedUrls = [];
        let successCount = 0;
        
        for (let i = 0; i < photos.length; i++) {
            console.log(`📤 Enviando foto ${i+1} para IMGBB...`);
            try {
                const imgbbUrl = await uploadToImgbb(photos[i]);
                if (imgbbUrl) {
                    uploadedUrls.push(imgbbUrl);
                    successCount++;
                    console.log(`✅ Foto ${i+1} enviada: ${imgbbUrl}`);
                } else {
                    console.log(`❌ Falha no upload da foto ${i+1}`);
                    uploadedUrls.push(null);
                }
            } catch (error) {
                console.error(`❌ Erro no upload da foto ${i+1}:`, error.message);
                uploadedUrls.push(null);
            }
            
            // Pequena pausa entre uploads
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Fazer upload da moldura do stories para IMGBB
        let storiesUrl = null;
        if (storiesMontage) {
            console.log('📤 Enviando moldura do stories para IMGBB...');
            try {
                storiesUrl = await uploadToImgbb(storiesMontage);
                if (storiesUrl) {
                    console.log(`✅ Moldura stories enviada: ${storiesUrl}`);
                } else {
                    console.log('❌ Falha no upload da moldura do stories');
                }
            } catch (error) {
                console.error('❌ Erro no upload da moldura:', error.message);
            }
        }

        // Criar sessão do visualizador
        const viewerId = crypto.randomUUID();
        viewerSessions[viewerId] = {
            originalSession: session,
            photos: photos,
            photosImgbb: uploadedUrls,
            storiesMontage: storiesMontage,
            storiesMontageImgbb: storiesUrl,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        };

        console.log(`🎯 Sessão do visualizador criada: ${viewerId}`);
        console.log(`📊 Resumo: ${successCount}/${photos.length} fotos enviadas com sucesso`);
        
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

  // celular -> server: photos_from_cell
  socket.on('photos_from_cell', ({ session, photos, attempt }) => {
    console.log(`\n📸📸📸 RECEBENDO FOTOS DO CELULAR 📸📸📸`);
    console.log(`📍 Sessão: ${session}`);
    console.log(`🖼️  Quantidade de fotos: ${photos ? photos.length : 'NENHUMA'}`);
    console.log(`🔄 Tentativa: ${attempt || 1}`);
    console.log(`🔌 Socket ID: ${socket.id}`);

    if (!session) {
      console.error('❌❌❌ ERRO CRÍTICO: photos_from_cell SEM SESSÃO');
      return;
    }
    
    if (!photos || !Array.isArray(photos)) {
      console.error('❌❌❌ ERRO CRÍTICO: photos não é array válido');
      return;
    }

    // Initialize session if not exists
    if (!sessions[session]) {
      sessions[session] = { photos: [] };
      console.log(`🆕 NOVA SESSÃO CRIADA: ${session}`);
    }

    // Store photos
    sessions[session].photos = photos.slice();
    sessions[session].lastUpdated = new Date().toISOString();
    
    console.log(`💾 ${photos.length} fotos armazenadas para sessão ${session}`);
    
    // ENVIAR PARA OPERADOR
    const room = io.sockets.adapter.rooms.get(session);
    const clientCount = room ? room.size : 0;
    
    console.log(`📤 ENVIANDO PARA ${clientCount} CLIENTES NA SALA ${session}`);
    
    if (clientCount > 0) {
      io.to(session).emit('photos_ready', photos);
      console.log(`✅✅✅ FOTOS ENVIADAS COM SUCESSO PARA O OPERADOR`);
    } else {
      console.error(`❌❌❌ NENHUM CLIENTE NA SALA ${session}`);
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
  console.log('🔓 CORS totalmente liberado');
  console.log('📁 Servindo arquivos estáticos');
});
