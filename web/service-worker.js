// Service worker mínimo: permite "instalar" la PWA y abrirla aunque
// no haya conexión (cachea los archivos de la app, no los datos).

const CACHE = "agenda-v4";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./brand/isotipo.png",
  "./brand/login-bg.jpg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Solo gestionamos GET del propio sitio. Las llamadas a Supabase
  // (otro dominio) van siempre a la red, sin cachear.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }
  // Estrategia "red primero": siempre intenta lo último; si no hay
  // conexión, usa la copia en caché. Así las actualizaciones se ven
  // enseguida y la app sigue abriendo sin internet.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
