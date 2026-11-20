/* ============================================
   SYNC MODULE
   Безопасное чтение опубликованных проектов из Firebase.
   Запись отключена, пока нет серверной проверки прав доступа.
   ============================================ */

var SyncModule = {
    _syncInProgress: false,
    _lastSyncTime: null,
    _syncTimer: null,
    _mode: 'read-only',
    _sdkPromise: null,
    _eventsBound: false,

    _loadFirebaseSDK: function() {
        if (typeof firebase !== 'undefined' && firebase.firestore) return Promise.resolve(true);
        if (this._sdkPromise) return this._sdkPromise;

        this._sdkPromise = new Promise(function(resolve) {
            var urls = [
                'https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore-compat.js'
            ];
            var loadNext = function(index) {
                if (index >= urls.length) { resolve(true); return; }
                var script = document.createElement('script');
                script.src = urls[index];
                script.async = true;
                script.onload = function() { loadNext(index + 1); };
                script.onerror = function() { resolve(false); };
                document.head.appendChild(script);
            };
            // Cloud reads can wait until the first screen is interactive.
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(function() { loadNext(0); }, { timeout: 2500 });
            } else {
                window.setTimeout(function() { loadNext(0); }, 350);
            }
        });
        return this._sdkPromise;
    },

    init: function() {
        var self = this;
        this._bindEvents();
        // LocalStorageService exposes Promise-based methods. Resolve both values
        // before inspecting them; otherwise settings.syncMode is read from a
        // Promise and local-only mode silently falls through to cloud loading.
        return Promise.all([
            LocalStorageService.get('settings', {}),
            LocalStorageService.get('last_sync', null)
        ]).then(function(values) {
            var settings = values[0] && typeof values[0] === 'object' ? values[0] : {};
            self._mode = settings.syncMode === 'local' ? 'local' : 'read-only';
            self._lastSyncTime = values[1];
            self._updateSyncDisplay();

            if (self._mode === 'local') return false;
            return self._loadFirebaseSDK();
        }).then(function(ready) {
            if (!ready || self._mode === 'local') return;
            return FirebaseService.init();
        }).then(function() {
            if (self._mode === 'local' || !FirebaseService._initialized) return;
            return self._syncFromCloud();
        });
    },

    _bindEvents: function() {
        if (this._eventsBound) return;
        this._eventsBound = true;
        var self = this;

        // A restored connection should refresh read-only cloud data without
        // requiring a manual page reload. Guard against duplicate listeners
        // when application initialization is retried.
        window.addEventListener('online', function() { self._syncFromCloud(); });
    },

    _onLocalChange: function() {
        // Local edits are persisted by StateManager. Never auto-upload with
        // a password embedded in public client code.
    },

    _isSafeMigrationTree: function(root) {
        var stack = [{ value: root, depth: 0 }];
        var nodes = 0;
        while (stack.length) {
            var current = stack.pop();
            if (++nodes > 10000 || current.depth > 40) return false;
            var value = current.value;
            if (!value || typeof value !== 'object') continue;
            var keys = Object.keys(value);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
                stack.push({ value: value[key], depth: current.depth + 1 });
            }
        }
        return true;
    },

    // Dry-run planner. No Firestore reads/writes are triggered here.
    // Existing remote documents always win until a user explicitly resolves
    // conflicts; local records remain untouched in every case.
    _planPrivateMigration: function(localProjects, remoteProjects) {
        if (!Array.isArray(localProjects) || !Array.isArray(remoteProjects)) {
            throw new TypeError('Ожидаются два массива проектов');
        }
        var remoteIds = new Set();
        remoteProjects.forEach(function(project) {
            if (project && typeof project.id === 'string') remoteIds.add(project.id);
        });
        var seen = new Set();
        var upload = [];
        var conflicts = [];
        var skipped = 0;
        localProjects.forEach(function(project) {
            if (!project || typeof project !== 'object' || Array.isArray(project) ||
                typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(project.id)) {
                skipped++;
                return;
            }
            if (seen.has(project.id)) { skipped++; return; }
            seen.add(project.id);
            if (remoteIds.has(project.id)) {
                conflicts.push(project.id);
                return;
            }
            // Match the strict payload limit in firestore.rules; do not promise
            // uploads the security rules will reject.
            var serialized;
            try { serialized = JSON.stringify(project); } catch (error) { skipped++; return; }
            if (!serialized || serialized.length < 2 || serialized.length > 200000 ||
                !this._isSafeMigrationTree(JSON.parse(serialized))) {
                skipped++;
                return;
            }
            upload.push(JSON.parse(serialized));
        }, this);
        return { upload: upload, conflicts: conflicts, skipped: skipped };
    },

    // Resolve exactly one project from a fresh snapshot. A caller must never
    // trust an old preview as proof that the remote document is still absent.
    // Before future upload, re-read remote state and recompute this plan.
    _prepareSinglePrivateMigration: function(projectId, localProjects, remoteProjects) {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(projectId)) return null;
        var plan = this._planPrivateMigration(localProjects, remoteProjects);
        var matches = plan.upload.filter(function(project) { return project.id === projectId; });
        if (matches.length !== 1) return null;
        // Never return a reference to the caller's mutable local state.
        return JSON.parse(JSON.stringify(matches[0]));
    },

    _syncFromCloud: function() {
        if (this._mode === 'local' || this._syncInProgress) return Promise.resolve();
        
        var self = this;
        this._syncInProgress = true;

        return FirebaseService.getProjects()
            .then(function(cloud) {
                if (!cloud || !cloud.length) return;
                var local = StateManager.get('projects') || [];
                
                // НЕ загружаем из облака если локально есть данные
                // Локальные данные главнее
                if (local.length === 0 && cloud.length > 0) {
                    StateManager.set('projects', cloud);
                    StateManager.saveProjects();
                }
                if (typeof RendererModule !== 'undefined') {
                    RendererModule.renderProjects();
                    RendererModule.renderStats();
                }
            })
            .then(function() { return FirebaseService.getSettings(); })
            .then(function(s) {
                if (!s) return;
                if (s.favorites) {
                    StorageService.set('favorites', s.favorites);
                    if (typeof FavoritesModule !== 'undefined') FavoritesModule.favorites = s.favorites;
                }
                if (s.achievements && Array.isArray(s.achievements)) {
                    StorageService.set('achievements', s.achievements);
                    if (typeof AchievementsModule !== 'undefined') AchievementsModule.unlocked = s.achievements;
                }
            })
            .catch(function(error) { console.warn('Cloud read unavailable:', error); })
            .finally(function() {
                self._syncInProgress = false;
                self._updateSyncDisplay();
            });
    },

    uploadToCloud: function() {
        return Promise.resolve(false);
    },

    loadFromCloud: function() { return this._syncFromCloud(); },

    _updateSyncDisplay: function() {
        var el = document.getElementById('lastSyncDisplay');
        if (!el) return;
        el.textContent = this._mode === 'local' ? 'Локальное хранение' : 'Облако: ручной перенос · изменения сохраняются в браузере';
    }
};

window.SyncModule = SyncModule;
