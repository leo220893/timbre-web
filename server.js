const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ====== PWA files (content-type correcto) ======
app.get("/manifest.webmanifest", (req, res) => {
  res.type("application/manifest+json");
  res.sendFile(path.join(__dirname, "public", "manifest.webmanifest"));
});

app.get("/sw.js", (req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "sw.js"));
});

// ====== Health check ======
app.get("/health", (req, res) => res.json({ ok: true }));

// ====== Static ======
app.use(express.static(path.join(__dirname, "public")));

// ====== Signaling rooms ======
// rooms: Map<roomId, { owner: WebSocket|null, caller: WebSocket|null }>
const rooms = new Map();

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { owner: null, caller: null });
  return rooms.get(roomId);
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const ownerGone = !room.owner || room.owner.readyState !== WebSocket.OPEN;
  const callerGone = !room.caller || room.caller.readyState !== WebSocket.OPEN;
  if (ownerGone && callerGone) rooms.delete(roomId);
}

// ====== WebSocket handling ======
wss.on("connection", (ws) => {
  ws._roomId = null;
  ws._role = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // JOIN
    if (msg.type === "join") {
      const roomId = String(msg.roomId || "").trim();
      const role = msg.role === "owner" ? "owner" : "caller";
      if (!roomId) return;

      ws._roomId = roomId;
      ws._role = role;

      const room = getOrCreateRoom(roomId);

      // Si ya había alguien en ese rol, lo reemplazamos
      if (role === "owner") room.owner = ws;
      else room.caller = ws;

      // Avisar al otro lado que alguien se conectó
      const other = role === "owner" ? room.caller : room.owner;
      safeSend(other, { type: "peer-joined", role });

      return;
    }

    // Si no está unido a una sala, ignorar
    const roomId = ws._roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const other = ws._role === "owner" ? room.caller : room.owner;

    // Relay signaling
    if (msg.type === "offer") {
      safeSend(other, { type: "offer", offer: msg.offer });
      return;
    }

    if (msg.type === "answer") {
      safeSend(other, { type: "answer", answer: msg.answer });
      return;
    }

    if (msg.type === "candidate") {
      safeSend(other, { type: "candidate", candidate: msg.candidate });
      return;
    }

    if (msg.type === "hangup") {
      safeSend(other, { type: "hangup" });
      return;
    }
  });

  ws.on("close", () => {
    const roomId = ws._roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // Liberar el slot correspondiente
    if (room.owner === ws) room.owner = null;
    if (room.caller === ws) room.caller = null;

    // Avisar al otro lado
    const other = ws._role === "owner" ? room.caller : room.owner;
    safeSend(other, { type: "peer-left" });

    cleanupRoomIfEmpty(roomId);
  });

  ws.on("error", () => {
    // no-op, close handler hará limpieza
  });
});

// ====== Start ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
