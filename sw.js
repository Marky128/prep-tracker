/* Prep Tracker service worker — precache everything, serve cache-first.
   Bump CACHE when any asset changes so clients pick up the new version. */
const CACHE = 'prep-tracker-v3';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/db.js',
  './js/history.js',
  './js/app.js',
  './vendor/chart.umd.min.js',
  './fonts/barlow-condensed-600.woff2',
  './fonts/barlow-condensed-700.woff2',
  './fonts/barlow-condensed-800.woff2',
  './fonts/ibm-plex-mono-500.woff2',
  './fonts/ibm-plex-mono-600.woff2',
  './fonts/inter-400.woff2',
  './fonts/inter-500.woff2',
  './fonts/inter-600.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:'reload' skips the HTTP cache so a bumped version never
      // precaches stale copies of the old assets
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // dev/test pages (and anything requested with ?fresh=1) always hit the
  // network — never serve them from cache, never cache them
  if (url.pathname.includes('/tools/') || url.searchParams.has('fresh')) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
      })
    )
  );
});
