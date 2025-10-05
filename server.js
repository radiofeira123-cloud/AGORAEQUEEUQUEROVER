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

// ✅ CORREÇÃO: Socket.IO com configurações mais robustas
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
  transports: ['websocket', 'polling'], // WebSocket primeiro
  pingTimeout: 30000, // 30 segundos
  pingInterval: 10000, // 10 segundos
  connectTimeout: 30000, // 30 segundos
  maxHttpBufferSize: 1e8, // 100MB
  allowEIO3: true
});

// ✅ CORREÇÃO: Sessão FIXA para o celular (sempre a mesma)
const FIXED_SESSION_ID = "cabine-fixa";
// Sessões do visualizador (cada cliente tem sua própria)
const viewerSessions = {};

const IMGBB_API_KEY = "6734e028b20f88d5795128d242f85582";

// ✅ CORREÇÃO MELHORADA: Função de upload IMGBB com timeout e retry
async function uploadToImgbb(imageData, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`📤 Tentativa ${attempt}/${retries} - Iniciando upload para IMGBB...`);
            
            // Verificar se a imagem é muito grande
            if (imageData.length > 2000000) { // 2MB
                console.warn('⚠️ Imagem muito grande, otimizando...');
                // Se for muito grande, vamos otimizar mais
                const optimized = await optimizeImageBase64(imageData);
                imageData = optimized;
            }
            
            const base64Data = imageData.split(',')[1];
            
            const formData = new URLSearchParams();
            formData.append('key', IMGBB_API_KEY);
            formData.append('image', base64Data);

            console.log(`📊 Tamanho base64: ${Math.round(base64Data.length/1024)}KB`);
            
            // ✅ CORREÇÃO: Usar AbortController para timeout
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000); // 15 segundos
            
            const response = await fetch('https://api.imgbb.com/1/upload', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                console.log(`✅ Upload IMGBB bem-sucedido: ${data.data.url}`);
                return data.data.url;
            } else {
                console.error(`❌ Upload IMGBB falhou: ${data.error?.message || 'Erro desconhecido'}`);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Backoff exponencial
                    continue;
                }
                return null;
            }
        } catch (error) {
            console.error(`❌ Erro no upload IMGBB (tentativa ${attempt}):`, error.message);
            if (attempt < retries) {
                console.log(`🔄 Tentando novamente em ${2 * attempt} segundos...`);
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            } else {
                return null;
            }
        }
    }
}

// ✅ NOVA FUNÇÃO: Otimizar imagem base64
function optimizeImageBase64(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Reduzir para no máximo 1200px na largura
            let width = img.width;
            let height = img.height;
            const maxWidth = 1200;
            
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(dataUrl);
    });
}

io.on('connection', (socket) => {
  console.log('🔌 NOVA CONEXÃO - socket:', socket.id, 'origin:', socket.handshake.headers.origin);

  // Operator: create a new session (para celular)
  socket.on('operator_connected', () => {
    socket.join(FIXED_SESSION_ID);
    console.log(`🎮 OPERADOR conectado à sessão fixa: ${FIXED_SESSION_ID}`);
    
    // Notificar que a sessão está pronta
    socket.emit('session_ready', { sessionId: FIXED_SESSION_ID });
  });

  // Celular sempre usa a sessão FIXA
  socket.on('cell_connected', () => {
    socket.join(FIXED_SESSION_ID);
    console.log(`📱 CELULAR conectado à sessão fixa: ${FIXED_SESSION_ID}`);
  });

  // ✅ CORREÇÃO MELHORADA: create_viewer_session com upload mais robusto
  socket.on('create_viewer_session', async ({ photos, storiesMontage }) => {
    console.log(`\n🔄🔄🔄 CREATE_VIEWER_SESSION INICIADO 🔄🔄🔄`);
    console.log(`📍 Sessão FIXA: ${FIXED_SESSION_ID}`);
    console.log(`📸 Quantidade de fotos: ${photos ? photos.length : 0}`);
    console.log(`🖼️ Stories Montage: ${storiesMontage ? 'Sim' : 'Não'}`);
    console.log(`🔌 Socket ID: ${socket.id}`);

    if (!photos || !Array.isArray(photos)) {
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
                const imgbbUrl = await uploadToImgbb(photos[i], 2); // 2 tentativas
                if (imgbbUrl) {
                    uploadedUrls.push(imgbbUrl);
                    successCount++;
                    console.log(`✅ Foto ${i+1} enviada: ${imgbbUrl}`);
                } else {
                    console.log(`❌ Falha no upload da foto ${i+1}`);
                    uploadedUrls.push(photos[i]); // Fallback para data URL
                }
            } catch (error) {
                console.error(`❌ Erro no upload da foto ${i+1}:`, error.message);
                uploadedUrls.push(photos[i]); // Fallback para data URL
            }
            
            // Pequena pausa entre uploads para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Fazer upload da moldura do stories para IMGBB
        let storiesUrl = null;
        if (storiesMontage) {
            console.log('📤 Enviando moldura do stories para IMGBB...');
            try {
                storiesUrl = await uploadToImgbb(storiesMontage, 2);
                if (storiesUrl) {
                    console.log(`✅ Moldura stories enviada: ${storiesUrl}`);
                } else {
                    console.log('❌ Falha no upload da moldura do stories');
                    storiesUrl = storiesMontage; // Fallback
                }
            } catch (error) {
                console.error('❌ Erro no upload da moldura:', error.message);
                storiesUrl = storiesMontage; // Fallback
            }
        }

        // Criar sessão do visualizador
        const viewerId = crypto.randomUUID();
        viewerSessions[viewerId] = {
            originalSession: FIXED_SESSION_ID,
            photos: photos,
            photosImgbb: uploadedUrls,
            storiesMontage: storiesMontage,
            storiesMontageImgbb: storiesUrl,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias
        };

        console.log(`🎯 Sessão do visualizador criada: ${viewerId}`);
        console.log(`📊 Resumo: ${successCount}/${photos.length} fotos enviadas com sucesso para IMGBB`);
        
        socket.emit('viewer_session_created', { viewerId });

    } catch (error) {
        console.error('❌ Erro ao criar sessão do visualizador:', error);
        socket.emit('viewer_session_error', { error: error.message });
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
    } else {
      console.log(`❌ Visualizador não encontrado: ${viewerId}`);
      socket.emit('viewer_not_found', { viewerId });
    }
  });

  // celular -> server: photos_from_cell
  socket.on('photos_from_cell', ({ photos, attempt }) => {
    console.log(`\n📸📸📸 RECEBENDO FOTOS DO CELULAR 📸📸📸`);
    console.log(`📍 Sessão FIXA: ${FIXED_SESSION_ID}`);
    console.log(`🖼️  Quantidade de fotos: ${photos ? photos.length : 'NENHUMA'}`);
    console.log(`🔄 Tentativa: ${attempt || 1}`);
    console.log(`🔌 Socket ID: ${socket.id}`);

    if (!photos || !Array.isArray(photos)) {
      console.error('❌❌❌ ERRO CRÍTICO: photos não é array válido');
      return;
    }

    console.log(`💾 ${photos.length} fotos recebidas na sessão fixa ${FIXED_SESSION_ID}`);
    
    // Enviar fotos para TODOS os operadores na sessão fixa
    const room = io.sockets.adapter.rooms.get(FIXED_SESSION_ID);
    const clientCount = room ? room.size : 0;
    
    console.log(`📤 ENVIANDO PARA ${clientCount} CLIENTES NA SALA ${FIXED_SESSION_ID}`);
    
    if (clientCount > 0) {
      io.to(FIXED_SESSION_ID).emit('photos_ready', photos);
      console.log(`✅✅✅ FOTOS ENVIADAS COM SUCESSO PARA O OPERADOR`);
    } else {
      console.error(`❌❌❌ NENHUM OPERADOR NA SALA ${FIXED_SESSION_ID}`);
    }
  });

  // celular informs it entered fullscreen
  socket.on('cell_entered_fullscreen', () => {
    io.to(FIXED_SESSION_ID).emit('cell_entered_fullscreen');
    console.log(`📵 Celular entrou em tela cheia na sessão fixa ${FIXED_SESSION_ID}`);
  });

  // operator clicks Finalizar Sessão - apenas reseta o celular
  socket.on('end_session', () => {
    // Apenas notificar o celular para resetar, sem afetar visualizadores
    io.to(FIXED_SESSION_ID).emit('reset_session');
    console.log(`🧹 Sessão finalizada - Celular resetado`);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 socket disconnect', socket.id, reason);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    fixedSession: FIXED_SESSION_ID,
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
  console.log(`📱 SESSÃO FIXA DO CELULAR: ${FIXED_SESSION_ID}`);
});
