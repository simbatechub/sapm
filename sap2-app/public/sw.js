// SAP2 service worker: shows phone notifications sent by the server and opens the app when tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "SAP2", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "SAP2", { body: d.body || "", icon: "/icon-192.png", badge: "/favicon.png", data: { url: d.url || "/" }, tag: d.tab || undefined }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { for (const c of cs) { if ("focus" in c) return c.focus(); } return self.clients.openWindow((e.notification.data && e.notification.data.url) || "/"); }));
});
