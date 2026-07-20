/* ============================================
   SERVICE WORKER CONFIGURATION
   Все пути и настройки здесь
   ============================================ */

const CONFIG = {
    // Версия кеша (менять при обновлении)
    CACHE_VERSION: 'devspace-v1.0.0',
    
    // Стратегия кеширования
    STRATEGY: {
        // HTML - Network First
        HTML: 'network-first',
        // CSS/JS - Cache First (с обновлением в фоне)
        ASSETS: 'cache-first',
        // Изображения - Cache First
        IMAGES: 'cache-first',
        // API запросы - Network First
        API: 'network-first',
        // Шрифты - Cache First
        FONTS: 'cache-first'
    },
    
    // Имена кешей
    CACHES: {
        STATIC: 'static-cache',
        DYNAMIC: 'dynamic-cache',
        IMAGES: 'images-cache',
        FONTS: 'fonts-cache',
        API: 'api-cache'
    },
    
    // Максимальный размер кеша (в элементах)
    MAX_CACHE_ITEMS: {
        STATIC: 50,
        DYNAMIC: 100,
        IMAGES: 200,
        API: 50
    },
    
    // Время жизни кеша (в секундах)
    CACHE_TTL: {
        STATIC: 7 * 24 * 60 * 60,    // 7 дней
        DYNAMIC: 24 * 60 * 60,        // 1 день
        IMAGES: 30 * 24 * 60 * 60,    // 30 дней
        API: 5 * 60                   // 5 минут
    },
    
    // Маски файлов для определения типа
    FILE_PATTERNS: {
        HTML: /\.html$/,
        CSS: /\.css$/,
        JS: /\.js$/,
        IMAGE: /\.(png|jpg|jpeg|gif|svg|webp|ico)$/,
        FONT: /\.(woff|woff2|ttf|eot)$/,
        API: /\/api\//
    },
    
    // Критические ресурсы для предзагрузки
    PRECACHE_URLS: [
        '/',
        '/index.html',
        '/offline.html',
        '/css/theme.css',
        '/css/main.css',
        '/css/animations.css',
        '/css/components/navbar.css',
        '/css/components/hero.css',
        '/css/components/cards.css',
        '/css/components/checklist.css',
        '/css/components/modal.css',
        '/js/app.js',
        '/js/core/events.js',
        '/js/core/storage.js',
        '/js/core/state.js',
        '/js/utils/helpers.js',
        '/js/utils/validators.js',
        '/js/ui/notifications.js',
        '/js/ui/renderer.js',
        '/js/modules/theme.js',
        '/js/modules/projects.js',
        '/js/modules/checklist.js',
        '/js/modules/updates.js',
        '/js/modules/stats.js',
        '/data/initial-projects.json'
    ],
    
    // Ресурсы, которые никогда не кешируются
    NO_CACHE_URLS: [
        '/api/analytics',
        '/api/realtime'
    ],
    
    // Уведомления
    NOTIFICATIONS: {
        ENABLED: true,
        DEFAULT_ICON: '/icons/icon-192.png',
        VIBRATE: [200, 100, 200]
    }
};

/* ============================================
   CORE UTILITIES
   ============================================ */

const Utils = {
    // Определение типа файла
    getFileType(url) {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        
        if (CONFIG.FILE_PATTERNS.API.test(path)) return 'API';
        if (CONFIG.FILE_PATTERNS.IMAGE.test(path)) return 'IMAGES';
        if (CONFIG.FILE_PATTERNS.FONT.test(path)) return 'FONTS';
        if (CONFIG.FILE_PATTERNS.HTML.test(path)) return 'HTML';
        if (CONFIG.FILE_PATTERNS.CSS.test(path) || 
            CONFIG.FILE_PATTERNS.JS.test(path)) return 'ASSETS';
        
        return 'DYNAMIC';
    },
    
    // Получение имени кеша по типу
    getCacheName(type) {
        const cacheMap = {
            HTML: CONFIG.CACHES.STATIC,
            ASSETS: CONFIG.CACHES.STATIC,
            IMAGES: CONFIG.CACHES.IMAGES,
            FONTS: CONFIG.CACHES.FONTS,
            API: CONFIG.CACHES.API,
            DYNAMIC: CONFIG.CACHES.DYNAMIC
        };
        
        return cacheMap[type] || CONFIG.CACHES.DYNAMIC;
    },
    
    // Проверка, нужно ли кешировать URL
    shouldCache(url) {
        return !CONFIG.NO_CACHE_URLS.some(pattern => url.includes(pattern));
    },
    
    // Добавление метаданных в кеш
    async addToCacheWithMetadata(cache, request, response) {
        const metadata = {
            url: request.url,
            timestamp: Date.now(),
            ttl: CONFIG.CACHE_TTL[Utils.getFileType(request.url)] || 
                 CONFIG.CACHE_TTL.DYNAMIC
        };
        
        const enhancedResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                'x-cached-at': metadata.timestamp,
                'x-cache-ttl': metadata.ttl
            }
        });
        
        await cache.put(request, enhancedResponse);
        
        // Сохраняем метаданные отдельно
        const metadataCache = await caches.open('metadata-cache');
        await metadataCache.put(
            new Request(request.url + '?metadata'),
            new Response(JSON.stringify(metadata))
        );
    },
    
    // Проверка свежести кеша
    async isCacheFresh(request) {
        try {
            const metadataCache = await caches.open('metadata-cache');
            const metadataResponse = await metadataCache.match(
                new Request(request.url + '?metadata')
            );
            
            if (!metadataResponse) return false;
            
            const metadata = await metadataResponse.json();
            const age = (Date.now() - metadata.timestamp) / 1000;
            
            return age < metadata.ttl;
        } catch {
            return false;
        }
    },
    
    // Очистка старых записей кеша
    async trimCache(cacheName, maxItems) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        
        if (keys.length > maxItems) {
            // Сортируем по времени добавления (из метаданных)
            const metadataCache = await caches.open('metadata-cache');
            const itemsWithAge = await Promise.all(
                keys.map(async (key) => {
                    const metadataResponse = await metadataCache.match(
                        new Request(key.url + '?metadata')
                    );
                    let timestamp = 0;
                    if (metadataResponse) {
                        const metadata = await metadataResponse.json();
                        timestamp = metadata.timestamp;
                    }
                    return { key, timestamp };
                })
            );
            
            // Сортируем от старых к новым
            itemsWithAge.sort((a, b) => a.timestamp - b.timestamp);
            
            // Удаляем самые старые
            const toDelete = itemsWithAge.slice(0, keys.length - maxItems);
            await Promise.all(
                toDelete.map(item => {
                    cache.delete(item.key);
                    metadataCache.delete(
                        new Request(item.key.url + '?metadata')
                    );
                })
            );
        }
    }
};

/* ============================================
   SERVICE WORKER LIFECYCLE
   ============================================ */

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker: Installing...');
    
    event.waitUntil(
        (async () => {
            try {
                // Предзагрузка критических ресурсов
                const cache = await caches.open(CONFIG.CACHES.STATIC);
                
                console.log('📦 Precaching critical assets...');
                
                // Кешируем с обработкой ошибок для каждого файла
                const results = await Promise.allSettled(
                    CONFIG.PRECACHE_URLS.map(async (url) => {
                        try {
                            const response = await fetch(url);
                            if (response.ok) {
                                await Utils.addToCacheWithMetadata(
                                    cache, 
                                    new Request(url), 
                                    response
                                );
                                console.log(`  ✓ Cached: ${url}`);
                            } else {
                                console.warn(`  ⚠ Failed to cache: ${url} (${response.status})`);
                            }
                        } catch (error) {
                            console.warn(`  ✗ Error caching: ${url}`, error.message);
                        }
                    })
                );
                
                const successful = results.filter(r => r.status === 'fulfilled').length;
                console.log(`✅ Precached ${successful}/${CONFIG.PRECACHE_URLS.length} resources`);
                
                // Принудительная активация
                await self.skipWaiting();
                
            } catch (error) {
                console.error('❌ Install failed:', error);
            }
        })()
    );
});

// ========== ACTIVATE ==========
self.addEventListener('activate', (event) => {
    console.log('🔧 Service Worker: Activating...');
    
    event.waitUntil(
        (async () => {
            try {
                // Получаем список всех кешей
                const cacheNames = await caches.keys();
                
                // Определяем актуальные имена кешей
                const validCaches = Object.values(CONFIG.CACHES);
                validCaches.push('metadata-cache');
                
                // Удаляем устаревшие кеши
                const deletePromises = cacheNames
                    .filter(name => !validCaches.includes(name))
                    .map(name => {
                        console.log(`🗑 Deleting old cache: ${name}`);
                        return caches.delete(name);
                    });
                
                await Promise.all(deletePromises);
                
                // Захватываем контроль над всеми клиентами
                await self.clients.claim();
                
                console.log('✅ Service Worker activated and ready!');
                
                // Отправляем сообщение всем клиентам
                const clients = await self.clients.matchAll();
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: CONFIG.CACHE_VERSION
                    });
                });
                
            } catch (error) {
                console.error('❌ Activation failed:', error);
            }
        })()
    );
});

/* ============================================
   FETCH STRATEGIES
   ============================================ */

// ========== Cache First (с фоновым обновлением) ==========
async function cacheFirstStrategy(request, cacheName) {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
        // Проверяем свежесть кеша
        const isFresh = await Utils.isCacheFresh(request);
        
        if (isFresh) {
            // Фоновое обновление
            updateCacheInBackground(request, cacheName);
            return cachedResponse;
        }
    }
    
    // Если нет в кеше или устарел - идем в сеть
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            await Utils.addToCacheWithMetadata(cache, request, networkResponse.clone());
            return networkResponse;
        }
    } catch (error) {
        console.warn('Network request failed, using cache:', request.url);
    }
    
    // Если сеть недоступна - возвращаем кеш (даже устаревший)
    return cachedResponse || caches.match('/offline.html');
}

// ========== Network First ==========
async function networkFirstStrategy(request, cacheName, timeout = 3000) {
    try {
        // Таймаут для сетевого запроса
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
        );
        
        const networkResponse = await Promise.race([
            fetch(request),
            timeoutPromise
        ]);
        
        if (networkResponse && networkResponse.ok) {
            // Кешируем успешный ответ
            const cache = await caches.open(cacheName);
            await Utils.addToCacheWithMetadata(cache, request, networkResponse.clone());
            return networkResponse;
        }
        
        throw new Error('Network response was not ok');
        
    } catch (error) {
        console.warn('Network request failed, trying cache:', request.url);
        
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Для HTML возвращаем оффлайн страницу
        if (Utils.getFileType(request.url) === 'HTML') {
            return caches.match('/offline.html');
        }
        
        // Для API возвращаем ошибку
        if (Utils.getFileType(request.url) === 'API') {
            return new Response(
                JSON.stringify({ 
                    error: 'Network unavailable',
                    cached: false 
                }),
                { 
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
        
        throw error;
    }
}

// ========== Stale While Revalidate ==========
async function staleWhileRevalidateStrategy(request, cacheName) {
    const cachedResponse = await caches.match(request);
    
    const fetchPromise = fetch(request)
        .then(async (networkResponse) => {
            if (networkResponse && networkResponse.ok) {
                const cache = await caches.open(cacheName);
                await Utils.addToCacheWithMetadata(
                    cache, 
                    request, 
                    networkResponse.clone()
                );
            }
            return networkResponse;
        })
        .catch(error => {
            console.warn('Background update failed:', error);
        });
    
    // Возвращаем кеш сразу, если есть
    return cachedResponse || fetchPromise;
}

// ========== Background Cache Update ==========
async function updateCacheInBackground(request, cacheName) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            await Utils.addToCacheWithMetadata(
                cache, 
                request, 
                networkResponse.clone()
            );
        }
    } catch (error) {
        // Тихое обновление - ошибки не важны
    }
}

/* ============================================
   MAIN FETCH HANDLER
   ============================================ */

self.addEventListener('fetch', (event) => {
    // Пропускаем не-GET запросы
    if (event.request.method !== 'GET') return;
    
    // Пропускаем запросы, которые не должны кешироваться
    if (!Utils.shouldCache(event.request.url)) return;
    
    const fileType = Utils.getFileType(event.request.url);
    const cacheName = Utils.getCacheName(fileType);
    
    // Выбираем стратегию
    const strategy = CONFIG.STRATEGY[fileType] || 'cache-first';
    
    switch (strategy) {
        case 'network-first':
            event.respondWith(
                networkFirstStrategy(event.request, cacheName)
            );
            break;
            
        case 'cache-first':
            event.respondWith(
                cacheFirstStrategy(event.request, cacheName)
            );
            break;
            
        case 'stale-while-revalidate':
            event.respondWith(
                staleWhileRevalidateStrategy(event.request, cacheName)
            );
            break;
            
        default:
            event.respondWith(
                cacheFirstStrategy(event.request, cacheName)
            );
    }
});

/* ============================================
   PUSH NOTIFICATIONS
   ============================================ */

// Получение push-уведомления
self.addEventListener('push', (event) => {
    if (!CONFIG.NOTIFICATIONS.ENABLED) return;
    
    let data = {
        title: 'DevSpace',
        body: 'Новое уведомление',
        icon: CONFIG.NOTIFICATIONS.DEFAULT_ICON,
        badge: CONFIG.NOTIFICATIONS.DEFAULT_ICON,
        vibrate: CONFIG.NOTIFICATIONS.VIBRATE,
        data: {
            url: '/'
        }
    };
    
    if (event.data) {
        try {
            const pushData = event.data.json();
            data = { ...data, ...pushData };
        } catch {
            data.body = event.data.text();
        }
    }
    
    event.waitUntil(
        self.registration.showNotification(data.title, data)
    );
});

// Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window' })
            .then(windowClients => {
                // Если уже есть открытое окно - фокусируем его
                for (const client of windowClients) {
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Иначе открываем новое
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

/* ============================================
   MESSAGE HANDLING
   ============================================ */

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'CLEAR_CACHE':
            event.waitUntil(
                (async () => {
                    const cacheNames = await caches.keys();
                    await Promise.all(
                        cacheNames.map(name => caches.delete(name))
                    );
                    
                    // Отправляем подтверждение
                    if (event.ports && event.ports[0]) {
                        event.ports[0].postMessage({ 
                            success: true,
                            message: 'All caches cleared'
                        });
                    }
                })()
            );
            break;
            
        case 'UPDATE_CACHE':
            event.waitUntil(
                (async () => {
                    const cache = await caches.open(CONFIG.CACHES.STATIC);
                    const response = await fetch(data.url);
                    await Utils.addToCacheWithMetadata(
                        cache, 
                        new Request(data.url), 
                        response
                    );
                })()
            );
            break;
            
        case 'GET_CACHE_STATS':
            event.waitUntil(
                (async () => {
                    const stats = {};
                    const cacheNames = Object.values(CONFIG.CACHES);
                    
                    for (const name of cacheNames) {
                        const cache = await caches.open(name);
                        const keys = await cache.keys();
                        stats[name] = keys.length;
                    }
                    
                    if (event.ports && event.ports[0]) {
                        event.ports[0].postMessage(stats);
                    }
                })()
            );
            break;
            
        default:
            console.log('Unknown message type:', type);
    }
});

/* ============================================
   BACKGROUND SYNC
   ============================================ */

// Синхронизация данных в фоне
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-projects') {
        event.waitUntil(syncProjects());
    }
});

async function syncProjects() {
    try {
        // Получаем все открытые клиенты
        const clients = await self.clients.matchAll();
        
        // Отправляем запрос на синхронизацию
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_REQUIRED',
                timestamp: Date.now()
            });
        });
        
        console.log('🔄 Background sync completed');
        
    } catch (error) {
        console.error('Background sync failed:', error);
    }
}

/* ============================================
   PERIODIC CLEANUP
   ============================================ */

// Периодическая очистка старых кешей
setInterval(async () => {
    console.log('🧹 Running periodic cache cleanup...');
    
    try {
        // Очищаем каждый кеш по лимитам
        for (const [type, maxItems] of Object.entries(CONFIG.MAX_CACHE_ITEMS)) {
            const cacheName = Utils.getCacheName(type);
            await Utils.trimCache(cacheName, maxItems);
        }
        
        // Очищаем метаданные без соответствующих записей
        const metadataCache = await caches.open('metadata-cache');
        const metadataKeys = await metadataCache.keys();
        
        for (const key of metadataKeys) {
            const originalUrl = key.url.replace('?metadata', '');
            const originalCache = await caches.match(originalUrl);
            
            if (!originalCache) {
                await metadataCache.delete(key);
            }
        }
        
        console.log('✅ Cache cleanup completed');
        
    } catch (error) {
        console.error('Cache cleanup failed:', error);
    }
}, 60 * 60 * 1000); // Каждый час

/* ============================================
   OFFLINE PAGE
   ============================================ */

// Создаем оффлайн страницу динамически
const OFFLINE_PAGE = `
<!DOCTYPE html>
<html lang="ru" data-bs-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DevSpace - Оффлайн</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0a0a0a;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            text-align: center;
            padding: 20px;
        }
        
        .offline-container {
            max-width: 500px;
        }
        
        .offline-icon {
            font-size: 80px;
            margin-bottom: 30px;
        }
        
        h1 {
            font-size: 32px;
            margin-bottom: 15px;
            background: linear-gradient(135deg, #6366f1, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        p {
            color: #888;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        
        .retry-btn {
            display: inline-block;
            padding: 12px 30px;
            background: linear-gradient(135deg, #6366f1, #a855f7);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            transition: opacity 0.3s;
        }
        
        .retry-btn:hover {
            opacity: 0.9;
        }
        
        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            background: #ef4444;
            border-radius: 50%;
            margin-right: 8px;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div class="offline-container">
        <div class="offline-icon">📡</div>
        <h1>Нет подключения</h1>
        <p>
            <span class="status-indicator"></span>
            Похоже, вы оффлайн. Но не переживайте!<br>
            Все ваши проекты и задачи сохранены локально.
        </p>
        <p style="font-size: 14px;">
            Как только соединение восстановится,<br>
            все изменения синхронизируются автоматически.
        </p>
        <button class="retry-btn" onclick="location.reload()">
            Попробовать снова
        </button>
    </div>
    
    <script>
        // Автоматическая проверка соединения
        setInterval(() => {
            if (navigator.onLine) {
                location.reload();
            }
        }, 5000);
        
        // Слушаем восстановление соединения
        window.addEventListener('online', () => {
            location.reload();
        });
    </script>
</body>
</html>
`;

// Кешируем оффлайн страницу при установке
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CONFIG.CACHES.STATIC).then(cache => {
            return cache.put(
                '/offline.html',
                new Response(OFFLINE_PAGE, {
                    headers: { 'Content-Type': 'text/html' }
                })
            );
        })
    );
});

console.log('🚀 Service Worker loaded successfully!');