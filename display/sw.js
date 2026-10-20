/* Scope is /display/: only requests made by display clients are intercepted.
   APIs, other documents, external resources and active uploads are never cached. */
const SHELL_CACHE = 'infoscreen-display-shell-v1';
const IMAGE_CACHE = 'infoscreen-display-images-v1';
const SHELL = ['/display/', '/display/index.html', '/display/stylesheets/display.css?v=16',
    '/display/scripts/display.js?v=16', '/shared/inhalt.js?v=16', '/vendor/marked.js', '/vendor/purify.js'];
const IMAGE_LIMIT = 150;

self.addEventListener('install', event => {
    event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

async function shellAntwort(request) {
    const cache = await caches.open(SHELL_CACHE);
    const controller = new AbortController();
    let timer;
    try {
        // Race the complete body, not just headers: a stalled download must
        // also fall back. no-store bypasses the browser HTTP cache.
        const response = await Promise.race([
            (async () => {
                const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
                if (!response.ok || response.redirected) throw new Error('Shell unavailable');
                const body = await response.blob();
                return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
            })(),
            new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('Shell timeout')); }, 5000);
            })
        ]);
        try { await cache.put(request, response.clone()); }
        catch (_) { /* A storage failure must not discard the online shell. */ }
        return response;
    } catch (_) {
        return await cache.match(request) || Response.error();
    } finally { clearTimeout(timer); }
}

async function bildAntwort(request) {
    const cache = await caches.open(IMAGE_CACHE);
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        let response;
        try { response = await fetch(request, { signal: controller.signal }); }
        finally { clearTimeout(timer); }
        if (!response.ok) throw new Error('Image unavailable');
        // Both destination and MIME are checked: an HTML/SVG upload must not
        // become an offline document or executable resource.
        if (!response.redirected && /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)(;|$)/i.test(response.headers.get('content-type') || '')) {
            try {
                await cache.put(request, response.clone());
                const keys = await cache.keys();
                await Promise.all(keys.slice(0, Math.max(0, keys.length - IMAGE_LIMIT)).map(key => cache.delete(key)));
            } catch (_) { /* Quota failure must not discard a successful image. */ }
        }
        return response;
    } catch (_) {
        return await cache.match(request) || Response.error();
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (SHELL.includes(url.pathname + url.search)) {
        event.respondWith(shellAntwort(request));
    } else if (request.mode === 'navigate' && ['/display/', '/display/index.html'].includes(url.pathname)) {
        event.respondWith(shellAntwort('/display/'));
    } else if (request.destination === 'image' && url.pathname.startsWith('/uploads/')
        && /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(url.pathname)) {
        event.respondWith(bildAntwort(request));
    }
});
