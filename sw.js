// Service Worker do ScoreFlix
// Estratégia:
//  - App shell (HTML/CSS/JS/ícones) -> cache-first, com atualização em segundo plano (stale-while-revalidate)
//  - Chamadas à API da TMDB          -> network-first, com fallback para cache (permite reabrir filmes
//                                        já vistos offline, mesmo sem poder buscar filmes novos)
//  - Bump da versão do cache força todos os clientes a buscar os arquivos atualizados na próxima visita
const CACHE_VERSION = 'scoreflix-v4';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const TMDB_CACHE = `${CACHE_VERSION}-tmdb`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('scoreflix-') && key !== APP_SHELL_CACHE && key !== TMDB_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // não intercepta POST/PUT (não usados aqui, mas por segurança)

  const url = new URL(request.url);
  const isTmdbApi = url.hostname === 'api.themoviedb.org';

  if (isTmdbApi) {
    event.respondWith(networkFirstThenCache(request, TMDB_CACHE));
    return;
  }

  // Mesma origem (app shell): cache-first com atualização silenciosa em background
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
  }
});

async function networkFirstThenCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resposta = await fetch(request);
    if (resposta.ok) cache.put(request, resposta.clone());
    return resposta;
  } catch (err) {
    const cacheado = await cache.match(request);
    if (cacheado) return cacheado;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cacheado = await cache.match(request);
  const buscaRede = fetch(request)
    .then((resposta) => { if (resposta.ok) cache.put(request, resposta.clone()); return resposta; })
    .catch(() => null);
  return cacheado || (await buscaRede) || new Response('Offline e sem cache disponível.', { status: 503 });
}
