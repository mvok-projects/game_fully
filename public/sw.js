// Service worker: sayt va o'yin dvigatelini keshlaydi, internet bo'lmaganda ham
// yakka o'yinni ochish mumkin bo'ladi. Xonalar/multiplayer (WebSocket) keshlanmaydi.
const CACHE = "territorial-v1";
const PRECACHE = [
    "/",
    "/game/game.js",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            await cache.addAll(PRECACHE);
            // Birinchi tashrifda sahifa skriptlari service worker'dan oldin yuklanadi,
            // shuning uchun ularni HTML ichidan topib, oldindan keshlab qo'yamiz.
            const html = await (await cache.match("/")).text();
            const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
            await Promise.all(assets.map((url) => cache.add(url).catch(() => {})));
            await self.skipWaiting();
        })(),
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

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname === "/ws") {
        return;
    }
    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request, "/"));
    } else if (url.pathname === "/game/game.js") {
        // Dvigatel server protokoli bilan mos bo'lishi kerak — internet bo'lsa har doim yangisi.
        event.respondWith(networkFirst(request, url.pathname));
    } else if (url.pathname.startsWith("/_next/static/")) {
        event.respondWith(cacheFirst(request));
    } else {
        event.respondWith(staleWhileRevalidate(event, request));
    }
});

// Avval internetdan (yangi versiya uchun), bo'lmasa keshdan.
async function networkFirst(request, cacheKey) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(cacheKey, response.clone());
        }
        return response;
    } catch {
        return (await cache.match(cacheKey)) || Response.error();
    }
}

// Next.js'ning xeshlangan fayllari o'zgarmaydi — keshdan beriladi.
async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }
    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
}

// Ikonkalar va manifest: darhol keshdan, fonda yangilanadi.
async function staleWhileRevalidate(event, request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const update = fetch(request)
        .then(async (response) => {
            if (response.ok) {
                await cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => undefined);
    if (cached) {
        event.waitUntil(update);
        return cached;
    }
    return (await update) || Response.error();
}
