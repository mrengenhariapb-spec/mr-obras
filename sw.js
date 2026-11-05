// Service worker: guarda as telas do app no celular para abrir sem internet.
// Ao publicar uma versao nova, aumente o numero abaixo.
const VERSAO = 'mr-obras-v2.0.0';
const ARQUIVOS = [
  './',
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/app.js',
  './manifest.json',
  './img/logo-mr.png',
  './img/icone-192.png',
  './img/icone-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Arquivos do proprio app: tenta a internet primeiro (para pegar atualizacoes)
// e cai para a copia guardada quando estiver sem sinal.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((r) => r || caches.match('./index.html')))
  );
});
