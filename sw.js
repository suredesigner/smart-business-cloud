const APP_VERSION = "V1.383";
const CACHE_NAME = "smart-business-v1.383";
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
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      let previousPercent = -1;
      const reportProgress = async (completed, fraction, asset) => {
        const percent = Math.min(99, Math.floor(((completed + fraction) / APP_SHELL.length) * 100));
        if (percent === previousPercent) return;
        previousPercent = percent;
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        windows.forEach(client => client.postMessage({
          type: "UPDATE_PROGRESS",
          version: APP_VERSION,
          completed,
          total: APP_SHELL.length,
          asset,
          percent
        }));
      };

      for (let index = 0; index < APP_SHELL.length; index++) {
        const url = APP_SHELL[index];
        const request = new Request(url, { cache: "reload" });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Unable to download app file: ${url} (${response.status}).`);

        const filename = new URL(url, self.location.href).pathname.split("/").pop() || url;
        const contentLength = Number(response.headers.get("content-length")) || 0;
        const reader = response.body?.getReader();
        if (!reader) {
          await cache.put(request, response.clone());
          await reportProgress(index + 1, 0, filename);
          continue;
        }

        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          const fraction = contentLength
            ? Math.min(received / contentLength, 0.99)
            : 0;
          await reportProgress(index, fraction, filename);
        }

        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        headers.delete("content-range");
        await cache.put(request, new Response(new Blob(chunks), {
          status: response.status,
          statusText: response.statusText,
          headers
        }));
        await reportProgress(index + 1, 0, filename);
      }

      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      windows.forEach(client => client.postMessage({ type: "UPDATE_COMPLETE", version: APP_VERSION }));
      await self.skipWaiting();
    })()
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
