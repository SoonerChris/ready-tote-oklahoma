// Service worker for the admin Home Screen app (scope /admin).
// - Shows push notifications (new requests, payments, morning reminders)
//   and opens the right page when one is tapped.
// - When the phone is offline, admin pages fall back to a simple
//   "you're offline" page instead of a blank screen.
// Nothing else is cached, so the app always shows live data.

const OFFLINE = '/admin-offline.html';
const CACHE = 'rto-admin-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/app-icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Ready Tote', {
    body: data.body || '',
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/admin.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || '/admin.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
