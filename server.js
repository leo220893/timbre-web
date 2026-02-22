const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();

// Servir estáticos (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, "public")));

// Raíz -> owner por defecto (evita "No se puede obtener /")
app.get("/", (req, res) => {
  res.redirect("/owner.html?room=FLIA.VEGA-BALDOVINO");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// rooms: roomId -> { owner: ws|null, caller: ws|null }
const rooms = new Map();

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { owner: null, caller: null });
  return rooms.get(roomId);
}

function cleanup(roomId) {
  const r = rooms.get(roomId);
  if (!r) return;
  const oGone = !r.owner || r.owner.readyState !== WebSocket.OPEN;
  const cGone = !r.caller || r.caller.readyState !== WebSocket.OPEN;
  if (oGone && cGone) rooms.delete(roomId);
}

wss.on("connection", (ws) => {
  ws._roomId = null;
  ws._role = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
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

      const room = getRoom(roomId);
      if (role === "owner") room.owner = ws;
      else room.caller = ws;

      const other = role === "owner" ? room.caller : room.owner;
      safeSend(other, { type: "peer-joined", role });
      safeSend(ws, { type: "joined", roomId, role });
      return;
    }

    // Require join
    const roomId = ws._roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const other = ws._role === "owner" ? room.caller : room.owner;

    // Relay: ring/offer/answer/candidate/hangup
    if (
      msg.type === "ring" ||
      msg.type === "offer" ||
      msg.type === "answer" ||
      msg.type === "candidate" ||
      msg.type === "hangup"
    ) {
      safeSend(other, msg);
    }
  });

  ws.on("close", () => {
    const roomId = ws._roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (room.owner === ws) room.owner = null;
    if (room.caller === ws) room.caller = null;

    const other = ws._role === "owner" ? room.caller : room.owner;
    safeSend(other, { type: "peer-left" });

    cleanup(roomId);
  });

  ws.on("error", () => {});
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Server listening on", PORT));