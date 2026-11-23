/* Pardes Academy — service worker del prototipo estático.
   La app abre sin conexión después de la primera visita.
   Los datos de la hoja son network-first con respaldo de caché. */
'use strict';

var CACHE = 'pardes-static-v12';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data.json',
  './manifest.json',
  './assets/favicon.ico',
  './assets/logo.png',
  './assets/logo-96.png',
  './assets/logo-192.png',
  './assets/logo-512.png',
  './assets/logo-maskable-512.png',
  './assets/tutorial-1-bienvenido.webp',
  './assets/tutorial-2-novedades.webp',
  './assets/tutorial-3-cursos.webp',
  './assets/tutorial-4-calendario.webp',
  './assets/logo-iglesia.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    /* No se borra 'pardes-descargas': ahí viven los cursos descargados. */
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== 'pardes-descargas'; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* Datos de la hoja: siempre de la red, nunca de caché. La hoja cambia
     cada 15 min y el usuario quiere ver lo nuevo al recargar; guardar la
     respuesta vieja aquí es lo que le mostraba las mismas novedades. */
  if (url.hostname === 'docs.google.com') {
    event.respondWith(fetch(req));
    return;
  }

  /* Todo lo demás (app shell, imágenes): caché primero, red como respaldo. */
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        if (req.destination === 'document') return caches.match('./index.html');
        return new Response('', { status: 504 });
      });
    })
  );
});

/* Al tocar una notificación, abre (o trae al frente) la app. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].focus) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* Sincronización periódica en segundo plano (best-effort): solo Chrome en
   Android, solo si la app está instalada, y el navegador decide cuándo corre
   (mínimo ~12 h, puede no correr nunca). Revisa la hoja y avisa lo nuevo. */
var SHEET_ID = '1La6THpvBUzRygRnAaFe8uiZ7gxxwUzhW9PRuWTqvKtw';
var GVIZ = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&sheet=';
var SEEN_URL = 'https://pardes.local/sw-seen';
function swFetchIds(tab) {
  return fetch(GVIZ + encodeURIComponent(tab), { cache: 'no-store' }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }).then(function (txt) {
    var start = txt.indexOf('{');
    var end = txt.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('gviz');
    var data = JSON.parse(txt.slice(start, end + 1));
    var rows = (data.table && data.table.rows) || [];
    var ids = [];
    rows.forEach(function (r) {
      var c = r.c && r.c[0];
      if (c && c.v) ids.push(String(c.v));
    });
    return ids;
  });
}
function swGetSeen() {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(SEEN_URL).then(function (res) {
      if (!res) return { news: [], courses: [] };
      return res.json().catch(function () { return { news: [], courses: [] }; });
    });
  });
}
function swSaveSeen(seen) {
  return caches.open(CACHE).then(function (cache) {
    return cache.put(SEEN_URL, new Response(JSON.stringify(seen), { headers: { 'Content-Type': 'application/json' } }));
  });
}
self.addEventListener('periodicsync', function (event) {
  if (event.tag !== 'pardes-novedades') return;
  event.waitUntil(
    Promise.all([swFetchIds('Novedades'), swFetchIds('Cursos'), swGetSeen()]).then(function (parts) {
      var newsIds = parts[0], courseIds = parts[1], seen = parts[2];
      var freshNews = newsIds.filter(function (id) { return seen.news.indexOf(id) === -1; });
      var freshCourses = courseIds.filter(function (id) { return seen.courses.indexOf(id) === -1; });
      var firstRun = !seen.news.length && !seen.courses.length;
      seen.news = newsIds;
      seen.courses = courseIds;
      return swSaveSeen(seen).then(function () {
        if (firstRun) return;
        var total = freshNews.length + freshCourses.length;
        if (!total) return;
        var title = total === 1
          ? (freshCourses.length ? 'Nuevo curso en Pardes Academy' : 'Nueva noticia en Pardes Academy')
          : 'Novedades en Pardes Academy';
        var body = total === 1 ? '' : total + ' novedades nuevas';
        return self.registration.showNotification(title, {
          body: body,
          icon: './assets/logo-192.png',
          badge: './assets/logo-96.png',
          tag: 'pardes-nuevo',
          data: { url: './' }
        });
      });
    }).catch(function () {})
  );
});
