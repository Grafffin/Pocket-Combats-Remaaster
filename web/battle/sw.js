// Кэш для быстрой загрузки. Страница всегда сначала из сети (чтобы не застрять на старой сборке),
// скрипты и стили с ?v=<коммит> неизменны и берутся из кэша, картинки — из кэша с фоновым обновлением.
const CACHE = 'pc-static-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

async function put(req, res) {
  if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ownOrCdn = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (!ownOrCdn) return; // Supabase и прочее — мимо кэша

  if (req.mode === 'navigate') {
    e.respondWith(new Promise((resolve) => {
      const t = setTimeout(async () => { const c = await caches.match(req, { ignoreSearch: true }); if (c) resolve(c); }, 3000);
      fetch(req).then((r) => { clearTimeout(t); put(req, r); resolve(r); })
        .catch(async () => { clearTimeout(t); resolve((await caches.match(req, { ignoreSearch: true })) || Response.error()); });
    }));
    return;
  }
  const immutable = url.searchParams.has('v') || url.hostname === 'cdn.jsdelivr.net';
  e.respondWith(caches.match(req).then((hit) => {
    if (hit && immutable) return hit;
    const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
    return hit || net;
  }));
});
