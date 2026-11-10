// Shows question notifications and opens the session that asked.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch { /* An unreadable payload still gets a generic notification. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Pi Remote', {
    body: data.body || 'A session needs your input.', tag: data.tag, data: { sessionId: data.sessionId }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const sessionId = event.notification.data?.sessionId;
  event.waitUntil((async () => {
    const [open] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open) { await open.focus(); open.postMessage({ type: 'openSession', sessionId }); }
    else await self.clients.openWindow('/' + (sessionId ? '?open=' + encodeURIComponent(sessionId) : ''));
  })());
});
