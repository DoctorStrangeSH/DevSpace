/* ============================================
   SERVICE WORKER
   Пути к файлам задаются здесь
   ============================================ */

const CACHE_VERSION = 'devspace-v3.66.29-pwa6';
const ASSET_VERSION = '3.66.29';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
const DYNAMIC_CACHE = 'dynamic-' + CACHE_VERSION;
const IMAGES_CACHE = 'images-' + CACHE_VERSION;

// Файлы для предварительного кеширования
const PRECACHE_URLS = [
    './',
    'index.html',
    'manifest.json',
    'images/icons/icon-72x72.png',
    'images/icons/icon-96x96.png',
    'images/icons/icon-128x128.png',
    'images/icons/icon-144x144.png',
    'images/icons/icon-152x152.png',
    'images/icons/icon-192x192.png',
    'images/icons/icon-384x384.png',
    'images/icons/icon-512x512.png',
    'css/theme.css',
    'css/main.css',
    'css/portfolio.css',
    'css/workspace.css',
    'css/animations.css',
    'css/components/navbar.css',
    'css/components/hero.css',
    'css/components/cards.css',
    'css/components/checklist.css',
    'css/components/modal.css',
    'css/components/buttons.css',
    'css/components/project-detail.css',
    'css/components/notes.css',
    'css/components/widgets.css',
    'js/app.js',
    'js/portfolio.js',
    'js/github-metadata.js',
    'js/portfolio-gallery.js',
    'js/portfolio-nav.js',
    'js/portfolio-search.js',
    'js/core/events.js',
    'js/core/storage.js',
    'js/core/state.js',
    'js/core/sync.js',
    'js/services/localStorage.js',
    'js/services/firebase.js',
    'js/services/firebase-identity.js',
    'js/services/auth.js',
    'js/services/github.js',
    'js/services/supabase.js',
    'js/utils/helpers.js',
    'js/utils/validators.js',
    'js/ui/notifications.js',
    'js/ui/renderer.js',
    'js/ui/workspace-view.js',
    'js/modules/theme.js',
    'js/modules/projects.js',
    'js/modules/checklist.js',
    'js/modules/notes.js',
    'js/modules/updates.js',
    'js/modules/stats.js',
    'js/modules/tags.js',
    'js/modules/favorites.js',
    'js/modules/gallery.js',
    'js/modules/project-detail.js',
    'js/modules/export.js',
    'js/modules/share.js',
    'js/modules/achievements.js',
    'js/modules/timetracker.js',
    'data/initial-projects.json'
].map(url => /^(css|js)\//.test(url) ? `${url}?v=${ASSET_VERSION}` : url);

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
    console.log('SW: Installing...');

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('SW: Caching required app shell...');
                // Wait for every request to settle before deleting a failed cache.
                // Promise.all() rejects early and can race with still-running cache.put() calls.
                return Promise.allSettled(
                    PRECACHE_URLS.map(url => fetch(url, {
                        method: 'GET',
                        credentials: 'same-origin',
                        mode: 'same-origin'
                    }).then(response => {
                        if (!response || !response.ok) {
                            throw new Error('Required offline asset failed to load: ' + url);
                        }
                        return cache.put(url, response);
                    }))
                ).then(results => {
                    const failed = results.find(result => result.status === 'rejected');
                    if (failed) throw failed.reason;
                });
            })
            .then(() => {
                console.log('SW: Required offline assets cached');
                return self.skipWaiting();
            })
            .catch(error => {
                // Do not leave a partial cache or replace the currently working worker.
                return caches.delete(STATIC_CACHE).then(() => {
                    console.error('SW: Installation aborted; previous worker remains active', error);
                    throw error;
                });
            })
    );
});

// ========== ACTIVATE ==========
self.addEventListener('activate', (event) => {
    console.log('SW: Activating...');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        // CacheStorage is shared by every GitHub Pages project on this origin.
                        // Only remove caches owned by this app; never touch another project's caches.
                        .filter(name => {
                            return name.startsWith('static-devspace-') ||
                                   name.startsWith('dynamic-devspace-') ||
                                   name.startsWith('images-devspace-');
                        })
                        .filter(name => {
                            return name !== STATIC_CACHE && 
                                   name !== DYNAMIC_CACHE && 
                                   name !== IMAGES_CACHE;
                        })
                        .map(name => {
                            console.log('SW: Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('SW: Activated');
                return self.clients.claim();
            })
    );
});

// ========== FETCH ==========
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Пропускаем не-GET запросы и chrome-extension
    if (event.request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;
    if (url.protocol === 'chrome:') return;
    
    // Для изображений - cache first. Runtime-запись продлевает жизнь FetchEvent.
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i)) {
        const imageResponse = caches.match(event.request)
            .then(cached => cached || fetch(event.request));

        event.respondWith(imageResponse);
        event.waitUntil(
            imageResponse
                .then(response => {
                    if (!response || !response.ok) return;
                    return caches.open(IMAGES_CACHE)
                        .then(cache => cache.put(event.request, response.clone()));
                })
                .catch(() => {})
        );
        return;
    }
    
    // Для остального - network first с fallback к кешу.
    // Один сетевой запрос обслуживает и страницу, и обязательную запись в runtime cache.
    const networkResponse = fetch(event.request);

    const cachedFallback = () => {
        return caches.match(event.request).then(cached => {
            if (cached) return cached;

            // GitHub Pages hosts the app below /DevSpace/, not at /.
            // Cache.match returns a Promise, so both candidates must be awaited.
            if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
                return caches.match(new URL('index.html', self.registration.scope).href)
                    .then(page => page || caches.match(new URL('./', self.registration.scope).href))
                    .then(page => page || null);
            }

            return null;
        });
    };

    event.respondWith(
        networkResponse
            .then(response => {
                // A temporary server outage is different from a valid 404.
                // Keep the last known-good cached response available for 5xx errors.
                if (response && response.status >= 500) {
                    return cachedFallback().then(cached => cached || response);
                }
                return response;
            })
            .catch(() => cachedFallback().then(cached => cached || Response.error()))
    );

    // Keep the worker alive until the runtime cache write settles.
    event.waitUntil(
        networkResponse
            .then(response => {
                if (!response.ok) return;
                return caches.open(DYNAMIC_CACHE)
                    .then(cache => cache.put(event.request, response.clone()));
            })
            .catch(() => {})
    );
});

// ========== PUSH ==========
self.addEventListener('push', (event) => {
    const options = {
        body: 'Новое уведомление',
        icon: new URL('images/icons/icon-192x192.png', self.registration.scope).href,
        badge: new URL('images/icons/icon-72x72.png', self.registration.scope).href
    };
    
    if (event.data) {
        try {
            const data = event.data.json();
            options.body = data.body || options.body;
        } catch (e) {
            options.body = event.data.text();
        }
    }
    
    event.waitUntil(
        self.registration.showNotification('DevSpace', options)
    );
});

// ========== NOTIFICATION CLICK ==========
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window' })
            .then(clientList => {
                for (const client of clientList) {
                    if ('focus' in client) return client.focus();
                }
                return clients.openWindow(self.registration.scope);
            })
    );
});

console.log('SW: Loaded');
