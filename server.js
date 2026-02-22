// server.js
const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();

// Servir estáticos
app.use(express.static(path.join(__dirname, "public")));

// Raíz -> owner (para que al abrir / no tire "No se puede obtener /")
app.get("/", (req, res) => {
  res.redirect("/owner.html?room=FLIA.VEGA-BALDOVINO");
});

const server = http.createServer(app);

// --- WebSocket signaling ---
const wss = new WebSocket.Server({ server });

// rooms: roomId -> Set<ws>
const rooms = new Map();

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(roomId, senderWs, msgObj) {
  const set = rooms.get(roomId);
  if (!set) return;
  for (const ws of set) {
    if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
      safeSend(ws, msgObj);
    }
  }
}

wss.on("connection", (ws) => {
  ws._room = null;
  ws._role = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      const room = String(msg.room || "");
      const role = String(msg.role || "");
      if (!room) return;

      ws._room = room;
      ws._role = role;

      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(ws);

      safeSend(ws, { type: "joined", room, role });
      return;
    }

    // Requiere room
    if (!ws._room) return;

    // Relay a todos los demás de la sala
    // (incluye: ring, offer, answer, candidate, hangup)
    broadcast(ws._room, ws, { ...msg, _fromRole: ws._role || "unknown" });
  });

  ws.on("close", () => {
    if (ws._room && rooms.has(ws._room)) {
      const set = rooms.get(ws._room);
      set.delete(ws);
      if (set.size === 0) rooms.delete(ws._room);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Server listening on", PORT));