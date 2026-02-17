const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();

// Healthcheck para Render
app.get("/health", (req, res) => res.status(200).send("ok"));

// Servir los HTML desde /public
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// rooms = Map<roomId, Set<ws>>
const rooms = new Map();

function joinRoom(ws, roomId) {
  if (!roomId) return;
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
  ws.roomId = roomId;
}

function leaveRoom(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const set = rooms.get(roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(roomId);
}

function broadcastToRoom(roomId, sender, data) {
  const set = rooms.get(roomId);
  if (!set) return;
  for (const client of set) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Unirse a la sala
    if (msg.type === "join" && msg.roomId) {
      joinRoom(ws, msg.roomId);
      broadcastToRoom(ws.roomId, ws, { type: "peer-joined" });
      return;
    }

    // Ignorar si no está en sala
    if (!ws.roomId) return;

    // Reenviar offer/answer/candidate/hangup al otro peer
    broadcastToRoom(ws.roomId, ws, msg);
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    leaveRoom(ws);
    if (roomId) broadcastToRoom(roomId, ws, { type: "peer-left" });
  });
});

// Render usa PORT
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor listo en puerto ${PORT}`);
});
