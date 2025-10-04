const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;
app.use(express.static(path.join(__dirname, "public")));

let sessions = {};

io.on("connection", socket => {
  console.log("🔗 Cliente conectado:", socket.id);

  socket.on("create_session", () => {
    const id = uuidv4();
    sessions[id] = [];
    socket.emit("session_created", id);
  });

  socket.on("join_room", ({ session }) => {
    socket.join(session);
    console.log(`📱 Celular entrou na sessão ${session}`);
  });

  socket.on("photos_from_cell", ({ session, photos }) => {
    console.log(`📷 Recebidas ${photos.length} fotos da sessão ${session}`);
    sessions[session] = photos;
    io.to(session).emit("photos_ready", photos);
  });

  socket.on("end_session", session => {
    delete sessions[session];
    io.to(session).emit("session_ended");
    console.log(`🧹 Sessão ${session} finalizada`);
  });

  socket.on("disconnect", () => console.log("❌ Cliente saiu"));
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
