const APP_VERSION = "V1.380";
const CACHE_NAME = "smart-business-v1.380";
const APP_SHELL = [
  "./index.html",
  "./collaboration.js",
  "./manifest.json",
  "./icons/smart-business-192.png",
  "./icons/smart-business-512.png",
  "./icons/smart-business.svg"
];
const OFFLINE_PAGE = "./index.html";

/*
  Updating the app only swaps cached app FILES. Business records, accounts,
  notifications and theme live in the browser's localStorage, which this
  service worker never reads, writes or deletes.
*/

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache:"reload" skips the browser's HTTP cache so a new release is really downloaded
      .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            (key.startsWith("alz-academy-") || key.startsWith("smart-business-")) &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === "GET_VERSION" && event.ports[0]) {
    event.ports[0].postMessage({ version: APP_VERSION });
  }
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("./index.html");
    })
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isAppPage = request.mode === "navigate" ||
    request.destination === "document" ||
    requestUrl.pathname.endsWith("/index.html");

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    if (isAppPage) {
      const cached = (await cache.match(request)) || (await cache.match(OFFLINE_PAGE));
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) event.waitUntil(cache.put(OFFLINE_PAGE, response.clone()));
      return response;
    }

    // Icons and other files: cached copy first, refreshed in the background.
    const cached = await cache.match(request);
    const refresh = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    const network = await refresh;
    if (network) return network;
    throw new Error("Offline and not cached");
  })());
});
