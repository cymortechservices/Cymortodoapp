/* CYMOR TO-DO service worker: app-shell caching, Web Push, notification actions. */
const VERSION = 'v1';
const SHELL = `cymor-shell-${VERSION}`;
const ASSETS = `cymor-assets-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return; // API is handled by the app (offline queue)
  if (req.mode === 'navigate') {
    // SPA shell: network first so deploys show up, cached shell when offline.
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    // Hashed build assets never change => cache first.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); } return r; })));
  }
});

const ACTIONS = {
  pre_start: [{ action: 'snooze', title: 'Snooze 5 min' }],
  start: [{ action: 'check-in', title: 'Check in' }, { action: 'snooze', title: 'Snooze 5 min' }],
  end: [{ action: 'check-out', title: 'Check out' }, { action: 'snooze', title: 'Snooze 5 min' }],
  overdue: [{ action: 'check-out', title: 'Check out' }],
  reminder: [{ action: 'snooze', title: 'Snooze 10 min' }],
};

function ack(d, action) {
  if (!d.actionToken) return Promise.resolve();
  return fetch(`${d.apiBase || ''}/api/notifications/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: d.actionToken, action }),
  }).catch(() => undefined);
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'CYMOR TO-DO', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'CYMOR TO-DO';
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || '', tag: d.jobId || undefined, renotify: true, icon: '/icon-192.png', badge: '/icon-192.png',
      requireInteraction: d.kind === 'start' || d.kind === 'end' || d.kind === 'overdue',
      data: d, actions: ACTIONS[d.kind] || [],
    });
    // Client acknowledgement: the only thing that lets the server mark a job "delivered".
    await ack(d, 'delivered');
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'push-received', kind: d.kind, title, body: d.body }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  e.waitUntil((async () => {
    if (e.action === 'snooze') {
      await fetch(`${d.apiBase || ''}/api/notifications/action`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: d.actionToken, action: 'snooze', minutes: d.kind === 'reminder' ? 10 : 5 }),
      }).catch(() => undefined);
      return;
    }
    if (e.action === 'check-in' || e.action === 'check-out') {
      await ack(d, e.action);
      return;
    }
    await ack(d, 'opened');
    const target = d.url || '/dashboard';
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); if ('navigate' in w) await w.navigate(target).catch(() => undefined); return; } }
    await self.clients.openWindow(target);
  })());
});
