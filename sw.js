const CACHE_NAME = 'temu-pwa-v3';
const STATIC_ASSETS = ['/', '/index.html', '/style.css', '/script.js', '/manifest.json'];
const EXTERNAL_ASSETS = [
    'https://unpkg.com/dexie@3.2.4/dist/dexie.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => 
            Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    
    if (request.method !== 'GET') {
        event.respondWith(fetch(request));
        return;
    }
    
    if (STATIC_ASSETS.includes(new URL(request.url).pathname)) {
        event.respondWith(
            caches.match(request).then(cached => 
                cached || fetch(request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(c => c.put(request, clone));
                    }
                    return response;
                })
            )
        );
        return;
    }
    
    if (EXTERNAL_ASSETS.includes(request.url)) {
        event.respondWith(
            caches.match(request).then(cached => {
                const fetchPromise = fetch(request, { mode: 'no-cors' })
                    .then(response => {
                        caches.open(CACHE_NAME).then(c => c.put(request, response.clone()));
                        return response;
                    })
                    .catch(() => cached);
                return cached || fetchPromise;
            })
        );
        return;
    }
    
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
