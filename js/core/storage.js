/* ============================================
   STORAGE SERVICE
   Работа с localStorage с обработкой ошибок
   ============================================ */

const StorageService = {
    // Префикс для всех ключей
    _prefix: 'devspace_',
    _lastReadError: null,
    _lastReadKey: null,
    
    // Доступные ключи
    KEYS: {
        PROJECTS: 'projects',
        THEME: 'theme',
        SETTINGS: 'settings',
        ACTIVITY: 'activity'
    },
    
    // Получение полного ключа с префиксом
    _getKey(key) {
        return this._prefix + key;
    },
    
    // Сохранение данных
    set(key, data) {
        try {
            const fullKey = this._getKey(key);
            const serialized = JSON.stringify(data);
            localStorage.setItem(fullKey, serialized);
            return true;
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.error('StorageService: localStorage quota exceeded');
                if (typeof EventBus !== 'undefined') {
                    EventBus.emit('storage:quota-exceeded');
                }
            } else {
                console.error('StorageService: save error:', error);
            }
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return false;
        }
    },
    
    // Read and parse one exact storage snapshot to avoid a read/parse race between tabs.
    getSnapshot(key, defaultValue = null) {
        this._lastReadError = null;
        this._lastReadKey = key;
        try {
            const raw = localStorage.getItem(this._getKey(key));
            return {
                raw,
                value: raw === null ? defaultValue : JSON.parse(raw),
                error: null
            };
        } catch (error) {
            this._lastReadError = error;
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return { raw: null, value: defaultValue, error };
        }
    },

    // Read the exact stored representation for optimistic concurrency checks.
    getRaw(key) {
        try {
            return localStorage.getItem(this._getKey(key));
        } catch (error) {
            this._lastReadError = error;
            this._lastReadKey = key;
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return null;
        }
    },

    // Compare and write in one synchronous task so stale tabs cannot overwrite newer data.
    setIfUnchanged(key, data, expectedRawValue) {
        this._lastWriteConflict = false;
        try {
            const fullKey = this._getKey(key);
            const currentRawValue = localStorage.getItem(fullKey);
            if (currentRawValue !== expectedRawValue) {
                this._lastWriteConflict = true;
                if (typeof EventBus !== 'undefined') {
                    EventBus.emit('storage:conflict', { key });
                }
                return false;
            }
            const serialized = JSON.stringify(data);
            localStorage.setItem(fullKey, serialized);
            this._lastWriteValue = serialized;
            return true;
        } catch (error) {
            if (error.name === 'QuotaExceededError' && typeof EventBus !== 'undefined') {
                EventBus.emit('storage:quota-exceeded');
            }
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return false;
        }
    },

    // Загрузка данных
    get(key, defaultValue = null) {
        this._lastReadError = null;
        this._lastReadKey = key;
        try {
            const fullKey = this._getKey(key);
            const data = localStorage.getItem(fullKey);
            
            if (data === null) {
                return defaultValue;
            }
            
            return JSON.parse(data);
        } catch (error) {
            this._lastReadError = error;
            console.error('StorageService: load error:', error);
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return defaultValue;
        }
    },
    
    // Проверка существования
    has(key) {
        try {
            const fullKey = this._getKey(key);
            return localStorage.getItem(fullKey) !== null;
        } catch (error) {
            console.error('StorageService: existence check error:', error);
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return false;
        }
    },
    
    // Удаление данных
    remove(key) {
        try {
            const fullKey = this._getKey(key);
            localStorage.removeItem(fullKey);
            return true;
        } catch (error) {
            console.error('StorageService: remove error:', error);
            return false;
        }
    },
    
    // Очистка всех данных приложения, включая ключи новых модулей.
    // Сначала делаем снимок, чтобы при ошибке удаления попытаться восстановить уже удалённые ключи.
    // Чужие данные в том же origin не затрагиваются.
    clearAll() {
        const snapshot = [];
        const removed = [];

        try {
            for (let index = 0; index < localStorage.length; index++) {
                const key = localStorage.key(index);
                if (key && key.startsWith(this._prefix)) {
                    snapshot.push({ key, value: localStorage.getItem(key) });
                }
            }

            snapshot.forEach(function(entry) {
                localStorage.removeItem(entry.key);
                removed.push(entry);
            });
        } catch (error) {
            console.error('StorageService: clear error:', error);
            let rollbackFailed = false;

            removed.forEach(function(entry) {
                try {
                    localStorage.setItem(entry.key, entry.value);
                } catch (restoreError) {
                    rollbackFailed = true;
                    console.error('StorageService: clear rollback error:', restoreError);
                }
            });

            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', {
                    key: '*',
                    error: error.message,
                    rollbackFailed
                });
            }
            return false;
        }

        if (typeof EventBus !== 'undefined') {
            EventBus.emit('storage:cleared');
        }
        return true;
    }
};

window.StorageService = StorageService;