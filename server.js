const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Nova conexão:", socket.id);

  socket.on("join_room", (data) => {
    if (data?.session) {
      socket.join(data.session);
      console.log(`${socket.id} entrou na sala ${data.session}`);
    }
  });

  socket.on("photos_from_cell", (data) => {
    if (data?.session) {
      io.to(data.session).emit("photos_from_cell", data);
      console.log(`Fotos recebidas na sessão ${data.session}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
