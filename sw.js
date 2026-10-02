const CACHE_NAME = "sayback-v5";
const CORE = [
  "./",
  "./index.html",
  "./study.html",
  "./study.css",
  "./study-extras.css",
  "./study.js",
  "./lesson-data/catalog.json",
  "./lesson-audio.json",
  "./lesson-audio-sources.json",
  "./course.html",
  "./course.css",
  "./course.js",
  "./course-model.mjs",
  "./course-catalog.json",
  "./course-sources.json",
  "./style.css",
  "./app.js",
  "./research-parser.mjs",
  "./icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key !== CACHE_NAME)
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const withinStudyAssets = url.pathname.startsWith(new URL("./course-pages/", self.registration.scope).pathname) ||
    url.pathname.startsWith(new URL("./lesson-data/", self.registration.scope).pathname);
  const withinCore = CORE.some((path) => url.pathname === new URL(path, self.registration.scope).pathname);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    (!withinCore && !withinStudyAssets)
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
