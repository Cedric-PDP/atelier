// Service worker du classeur (app installée sur l'écran d'accueil). Volontairement minimal : il ne sert qu'à ouvrir
// l'app sans réseau et à la rendre installable. Toujours le réseau d'abord : le cache ne sert qu'en secours, pour qu'une
// version figée de l'interface ne parle jamais à une API qui a changé.
// - jamais /api/* (cartes, chat, favori court /api/favori.js…) ni ce qui n'est pas un GET ;
// - page et fichiers du site : réseau, copie gardée, copie servie hors ligne ;
// - Vue (cdnjs) et polices Google : même chose (adresses versionnées) ; illustrations de Wikimedia : jamais.
// Pour tout annuler : remplacer ce fichier par un service worker qui se désinstalle (README, « App installée »).
const CACHE = 'classeur-v1';
const SHELL = ['/', '/assets/app.css', '/assets/app.js', '/assets/match.js', '/assets/propose.js', '/assets/icon.svg'];
const CDN = new Set(['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (own ? url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/sw.js' : !CDN.has(url.hostname)) return;
  const nav = req.mode === 'navigate';
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
      const copy = res.clone();
      // Une page du site (toutes les vues sont des #/… de « / ») est gardée sous « / ».
      caches.open(CACHE).then((c) => c.put(nav ? '/' : req, copy)).catch(() => null);
    }
    return res;
  }).catch(() => caches.match(nav ? '/' : req, { ignoreSearch: nav }).then((hit) => hit || Response.error())));
});
