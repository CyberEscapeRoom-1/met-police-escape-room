// Dynamically determine base path (works for subfolder deployments)
const BASE = self.location.pathname.replace(/\/service-worker\.js$/, '');

const CACHE_NAME = "cer-v1";
const VIDEO_CACHE = "cer-video-cache-v1";

// Core files to cache (no videos)
const urlsToCache = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/asset-manifest.json`
];

// Install: cache core assets + build files
self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache core files
      await Promise.all(
        urlsToCache.map(url =>
          cache.add(url).catch(err => console.warn("Failed to cache:", url, err))
        )
      );

      // Cache build assets from asset-manifest.json
      try {
        const response = await fetch(`${BASE}/asset-manifest.json`);
        const data = await response.json();

        const assetUrls = Object.values(data.files || {});
        await Promise.all(
          assetUrls.map(url =>
            cache.add(url).catch(err => console.warn("Failed to cache asset:", url, err))
          )
        );
      } catch (err) {
        console.warn("Asset manifest caching failed:", err);
      }
    })
  );
});

// Activate: take control of all pages immediately
self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

// Fetch handler
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Improved video detection (works even after redirects)
  const isVideo =
    url.pathname.endsWith(".mp4") ||
    url.pathname.endsWith(".webm") ||
    request.destination === "video";

  // Improved video caching (redirect + CORS support)
  if (isVideo) {
    event.respondWith(
      caches.open(VIDEO_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) {
          return cached; // Serve offline video
        }

        try {
          const response = await fetch(request, {
            mode: "cors",
            credentials: "omit",
            redirect: "follow"
          });

          if (response && response.status === 200) {
            cache.put(request, response.clone()); // Save for offline use
          }

          return response;
        } catch (err) {
          console.warn("Video fetch failed:", err);
          return null; // No fallback video defined
        }
      })
    );
    return;
  }

  // Handle navigation (React Router)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(`${BASE}/index.html`))
    );
    return;
  }

  // Handle all other requests (cache-first, then network + cache)
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(networkResponse => {
          // Only cache valid responses
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type === "opaque"
          ) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();

          // Cache on demand (your chosen approach)
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => {
          return null;
        });
    })
  );
});
