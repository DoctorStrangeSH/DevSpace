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

    init: function() {
        var self = this;
        var settings = LocalStorageService.get('settings', {});
        this._mode = settings.syncMode === 'local' ? 'local' : 'read-only';
        this._lastSyncTime = LocalStorageService.get('last_sync', null);
        this._updateSyncDisplay();

        return FirebaseService.init()
            .then(function() {
                return self._syncFromCloud();
            });
    },

    _bindEvents: function() {
        var self = this;
        
        window.addEventListener('online', function() { self._syncFromCloud(); });
    },

    _onLocalChange: function() {
        // Local edits are persisted by StateManager. Never auto-upload with
        // a password embedded in public client code.
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
        el.textContent = this._mode === 'local' ? 'Локальное хранение' : 'Облако: только чтение · изменения сохраняются в браузере';
    }
};

window.SyncModule = SyncModule;
