import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// 🌐 Habilita CORS (Render + Vercel + localhost)
app.use(cors({
  origin: [
    "https://agoraequeeuquerover.vercel.app",
    "https://agoraequeeuquerover.onrender.com",
    "http://localhost:3000",
    "http://localhost:5000"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

// 🧠 Configura Socket.io
const io = new Server(server, {
  cors: {
    origin: [
      "https://agoraequeeuquerover.vercel.app",
      "https://agoraequeeuquerover.onrender.com",
      "http://localhost:3000",
      "http://localhost:5000"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// 🗂️ Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, "public")));

// 🧭 Rotas principais
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/celular.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "celular.html"));
});

// ⚙️ Sessões e comunicação
io.on("connection", (socket) => {
  console.log("📱 Novo cliente conectado:", socket.id);

  // Criar nova sessão
  socket.on("new_session", () => {
    const sessionId = uuidv4();
    socket.emit("session_created", { session: sessionId });
  });

  // Entrar numa sala específica
  socket.on("join_room", ({ session }) => {
    socket.join(session);
    console.log(`🧩 ${socket.id} entrou na sessão ${session}`);
  });

  // Fotos recebidas do celular
  socket.on("photos_ready", (fotos) => {
    console.log("📸 Fotos recebidas!");
    // Reenvia para o operador
    io.emit("photos_received", fotos);
  });

  // Finalizar sessão
  socket.on("finalizar_sessao", ({ session }) => {
    console.log(`🔁 Reset solicitado para sessão ${session}`);
    io.to(session).emit("reset_cell", { session });
  });

  socket.on("disconnect", () => {
    console.log("❌ Cliente desconectado:", socket.id);
  });
});

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
