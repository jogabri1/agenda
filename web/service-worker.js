// Service worker NEUTRALIZADO (kill-switch).
//
// Antes este SW cacheaba la app para funcionar offline, pero eso "congelaba"
// versiones viejas en el navegador y causaba que los cambios no se vieran.
// Como la app necesita internet igualmente (usa Supabase), no merece la pena.
//
// Este SW ahora se AUTODESREGISTRA y borra todas las cachés, de modo que la
// app pase a cargarse siempre la última versión desde la red.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
    })()
  );
});
