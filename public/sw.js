// Signal Radar — Service Worker
const VERSION = 'v1.1';
const CACHE_NAME = `signal-radar-${VERSION}`;

// App shell: önbelleğe alınacak temel dosyalar
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/radar.svg',
];

// Kurulumda app shell'i önbelleğe al
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Aktivasyonda eski cache'leri temizle
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('signal-radar-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch stratejisi:
// - Navigasyon istekleri: network first, offline'da cache
// - Statik varlıklar (/assets, /fonts, /icon-*): stale-while-revalidate
// - API/WSS: direkt network (cache yok)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Sadece GET isteklerini işle
  if (request.method !== 'GET') return;

  // WebSocket ve üçüncü parti istekleri (WSS, Binance/OKX) pas geç
  if (
    request.url.startsWith('ws:') ||
    request.url.startsWith('wss:') ||
    (url.origin !== self.location.origin && !url.hostname.includes('fonts.'))
  ) {
    return;
  }

  // Navigasyon (HTML sayfası): network first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Statik dosyalar (JS/CSS/font/ikon): stale-while-revalidate
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, copy));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});

// Yeni versiyon geldiğinde istemciye haber ver (otomatik yenileme)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
