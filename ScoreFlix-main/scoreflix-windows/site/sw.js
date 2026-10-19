// Service Worker do ScoreFlix — guarda SOMENTE o app shell (código do site).
// Nada do usuário fica em cache no navegador: nem a API, nem a TMDB, nem pôsteres.
const CACHE_VERSION = 'scoreflix-v6';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_PREFIX = '/api/';

const SHELL_FILES = [
  './', './index.html', './style.css', './auth.css',
  './db.js', './login.js', './data.js', './app.js',
  './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(SHELL_FILES.map((f) => cache.add(f))))
  );
  // Sem skipWaiting aqui: o novo SW espera o usuário confirmar o toast de atualização.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('scoreflix-') && k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // TMDB, YouTube, fontes e CDN: sempre da rede, sem cache.
  if (url.origin !== self.location.origin) return;
  // API do ScoreFlix: nunca em cache.
  if (url.pathname.startsWith(API_PREFIX)) return;

  // Navegação sem rede: cai para o app shell em cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./offline.html')) || Response.error();
      })
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cacheado = await cache.match(request);
  const rede = fetch(request)
    .then((r) => { if (r.ok) cache.put(request, r.clone()); return r; })
    .catch(() => null);
  return cacheado || (await rede) || new Response('Offline e sem cache disponível.', { status: 503 });
}
