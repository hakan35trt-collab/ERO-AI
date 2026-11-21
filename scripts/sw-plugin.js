import fs from "node:fs";
import path from "node:path";

function walk(dir, prefix, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) walk(abs, rel, out);
    else if (name !== "sw.js") out.push(`./${rel}`);
  }
}

function render(version, files) {
  return `/* ERO service worker ${version} */
const VERSION = ${JSON.stringify(version)};
const CACHE = "ero-" + VERSION;
const PRECACHE = ${JSON.stringify(files, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn("ERO önbellek atlandı", url, err);
          }
        }),
      );
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "ero-skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match("./index.html")) || (await caches.match("index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    }),
  );
});
`;
}

export function eroServiceWorker() {
  return {
    name: "ero-service-worker",
    apply: "build",
    closeBundle() {
      const dist = path.resolve("dist");
      if (!fs.existsSync(dist)) return;
      const files = [];
      walk(dist, "", files);
      const version = new Date().toISOString();
      fs.writeFileSync(path.join(dist, "sw.js"), render(version, files));
    },
  };
}
