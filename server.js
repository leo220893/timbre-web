const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const webpush = require("web-push");

const app = express();
app.use(express.json());

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

// ====== Web Push (VAPID) ======
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:example@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Guardamos suscripciones por roomId (en memoria)
const pushSubs = new Map(); // Map<roomId, subscription>

// Endpoint: devolver public key
app.get("/api/push/public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Endpoint: guardar suscripción (desde owner)
app.post("/api/push/subscribe", (req, res) => {
  const { roomId, subscription } = req.body || {};
  if (!roomId || !subscription) return res.status(400).json({ ok: false });
  pushSubs.set(String(roomId), subscription);
  return res.json({ ok: true });
});

async function sendPushToRoom(roomId) {
  const sub = pushSubs.get(roomId);
  if (!sub) return;

  const payload = JSON.stringify({
    title: "Timbre",
    body: "¡Alguien está tocando el timbre en casa!",
    url: `/owner.html?room=${encodeURIComponent(roomId)}`
  });

  try {
    await webpush.sendNotification(sub, payload);
  } catch (e) {
    // Si la suscripción expiró, la borramos
    if (e && (e.statusCode === 410 || e.statusCode === 404)) {
      pushSubs.delete(roomId);
    }
  }
}

// ====== Signaling rooms ======
// rooms: Map<roomId, { owner: WebSocket|null, caller: WebSocket|null }>
const rooms = new Map();

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch {}
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

  ws.on("message", async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // JOIN
    if (msg.type === "join") {
      const roomId = String(msg.roomId || "").trim();
      const role = msg.role === "owner" ? "owner" : "caller";
      if (!roomId) return;

      ws._roomId = roomId;
      ws._role = role;

      const room = getOrCreateRoom(roomId);

      // reemplazar slot si ya existía
      if (role === "owner") room.owner = ws;
      else room.caller = ws;

      // avisar al otro
      const other = role === "owner" ? room.caller : room.owner;
      safeSend(other, { type: "peer-joined", role });
      return;
    }

    const roomId = ws._roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const other = ws._role === "owner" ? room.caller : room.owner;

    // offer = el visitante apretó "Llamar"
    if (msg.type === "offer") {
      // 🔔 Push real: notificación en barra aunque esté en segundo plano
      await sendPushToRoom(roomId);

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

    if (room.owner === ws) room.owner = null;
    if (room.caller === ws) room.caller = null;

    const other = ws._role === "owner" ? room.caller : room.owner;
    safeSend(other, { type: "peer-left" });

    cleanupRoomIfEmpty(roomId);
  });
});

// ====== Start ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
