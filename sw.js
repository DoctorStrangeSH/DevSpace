/* ============================================
   SERVICE WORKER
   Пути к файлам задаются здесь
   ============================================ */

const CACHE_VERSION = 'devspace-v3.66.13';
const ASSET_VERSION = '3.66.13';
const STATIC_CACHE = 'static-' + CACHE_VERSION;
const DYNAMIC_CACHE = 'dynamic-' + CACHE_VERSION;
const IMAGES_CACHE = 'images-' + CACHE_VERSION;

// Файлы для предварительного кеширования
const PRECACHE_URLS = [
    './',
    'index.html',
    'manifest.json',
    'images/icons/icon-192x192.png',
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
                console.log('SW: Caching files...');
                
                // Кешируем файлы по одному, игнорируя ошибки
                return Promise.allSettled(
                    PRECACHE_URLS.map(url => {
                        return fetch(url, { 
                            method: 'GET',
                            credentials: 'same-origin',
                            mode: 'same-origin'
                        })
                        .then(response => {
                            if (response && response.ok) {
                                return cache.put(url, response);
                            } else {
                                console.warn('SW: Skip caching (not ok):', url);
                            }
                        })
                        .catch(err => {
                            // Просто пропускаем недоступные файлы
                            console.warn('SW: Skip caching (error):', url);
                        });
                    })
                );
            })
            .then(() => {
                console.log('SW: Caching complete');
                return self.skipWaiting();
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
                        .filter(name => {
                            return name.startsWith('static-') || 
                                   name.startsWith('dynamic-') || 
                                   name.startsWith('images-');
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
    
    // Для изображений - cache first
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i)) {
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    
                    return fetch(event.request)
                        .then(response => {
                            if (response.ok) {
                                const clone = response.clone();
                                caches.open(IMAGES_CACHE)
                                    .then(cache => cache.put(event.request, clone))
                                    .catch(() => {});
                            }
                            return response;
                        })
                        .catch(() => cached);
                })
        );
        return;
    }
    
    // Для остального - network first с fallback к кешу
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(DYNAMIC_CACHE)
                        .then(cache => cache.put(event.request, clone))
                        .catch(() => {});
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request)
                    .then(cached => {
                        if (cached) return cached;
                        
                        // GitHub Pages hosts the app below /DevSpace/, not at /.
                        // Cache.match returns a Promise, so both candidates must be awaited.
                        if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
                            return caches.match(new URL('index.html', self.registration.scope).href)
                                .then(page => page || caches.match(new URL('./', self.registration.scope).href))
                                .then(page => page || Response.error());
                        }
                        
                        throw new Error('Network unavailable');
                    });
            })
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
