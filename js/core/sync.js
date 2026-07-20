/* ============================================
   SYNC MODULE
   Синхронизация с Firebase
   ============================================ */

var SyncModule = {
    _syncInProgress: false,
    _lastSyncTime: null,
    _syncTimer: null,
    _mode: 'hybrid',

    init: function() {
        var self = this;
        var settings = LocalStorageService.get('settings', {});
        this._mode = settings.syncMode || 'hybrid';
        this._lastSyncTime = LocalStorageService.get('last_sync', null);
        this._updateSyncDisplay();

        return FirebaseService.init()
            .then(function() {
                self._bindEvents();
                return self._syncFromCloud();
            });
    },

    _bindEvents: function() {
        var self = this;
        
        ['project:added', 'project:updated', 'project:removed',
         'checklist:changed', 'notes:added', 'notes:updated',
         'notes:deleted', 'favorites:updated'].forEach(function(e) {
            EventBus.on(e, function() { self._onLocalChange(); });
        });

        window.addEventListener('online', function() { self._syncFromCloud(); });
    },

    _onLocalChange: function() {
        if (this._mode === 'local') return;
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this.uploadToCloud(), 2000);
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
                } else if (local.length > 0) {
                    // Отправляем локальные в облако (перезаписываем)
                    FirebaseService.saveAllProjects(local);
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
            .catch(function() {})
            .finally(function() {
                self._syncInProgress = false;
                self._lastSyncTime = new Date().toISOString();
                LocalStorageService.set('last_sync', self._lastSyncTime);
                self._updateSyncDisplay();
            });
    },

    uploadToCloud: function() {
        if (this._mode === 'local' || this._syncInProgress) return;
        this._syncInProgress = true;
        var self = this;

        var projects = StateManager.get('projects') || [];
        var favs = typeof FavoritesModule !== 'undefined' ? (FavoritesModule.favorites || []) : [];
        var ach = typeof AchievementsModule !== 'undefined' ? (AchievementsModule.unlocked || []) : [];

        FirebaseService.saveAllProjects(projects)
            .then(function() { return FirebaseService.saveSettings({ favorites: favs, achievements: ach }); })
            .then(function() {
                self._lastSyncTime = new Date().toISOString();
                LocalStorageService.set('last_sync', self._lastSyncTime);
                self._updateSyncDisplay();
            })
            .catch(function() {})
            .finally(function() { self._syncInProgress = false; });
    },

    loadFromCloud: function() { return this._syncFromCloud(); },

    _updateSyncDisplay: function() {
        var el = document.getElementById('lastSyncDisplay');
        if (!el) return;
        el.textContent = this._lastSyncTime ? 'Синхронизация: ' + Helpers.formatDate(this._lastSyncTime) : 'Синхронизация: никогда';
    }
};

window.SyncModule = SyncModule;