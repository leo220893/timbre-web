self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Recibe el push del servidor y muestra notificación en barra de estado
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title = data.title || "Timbre";
  const body = data.body || "¡Alguien está tocando el timbre en casa!";
  const url = data.url || "/owner.html?room=FLIA.VEGA-BALDOVINO";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      vibrate: [200, 100, 200],
      requireInteraction: true,
      actions: [{ action: "open", title: "Abrir timbre" }]
    })
  );
});

// Al tocar la notificación: enfoca/abre la app y navega al owner
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil((async () => {
    const clientsArr = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    for (const client of clientsArr) {
      if ("focus" in client) {
        await client.focus();
        try { await client.navigate(url); } catch {}
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});
