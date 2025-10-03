const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let sessions = {}; // Armazena fotos por sessão

// Servir arquivos estáticos (HTML, imagens, áudio etc.)
app.use(express.static("public"));

// Rota raiz → index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

io.on("connection", socket => {
  console.log("Novo cliente conectado:", socket.id);

  // Operador cria uma sessão
  socket.on("create_session", () => {
    const sessionId = uuidv4();
    sessions[sessionId] = { photos: [] };
    socket.emit("session_created", sessionId);
  });

  // Celular entra numa sessão
  socket.on("join_session", session => {
    socket.join(session);
    console.log(`Celular entrou na sessão ${session}`);
  });

  // Celular envia fotos
  socket.on("photos_from_cell", ({ session, photos }) => {
    console.log("📸 Recebi fotos da sessão", session);
    sessions[session] = { photos };
    io.to(session).emit("photos_ready", photos); // avisa operador
  });

  // Operador finaliza sessão
  socket.on("end_session", session => {
    delete sessions[session];
    io.to(session).emit("session_ended");
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
