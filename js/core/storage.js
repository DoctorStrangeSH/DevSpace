/* ============================================
   STORAGE SERVICE
   Работа с localStorage с обработкой ошибок
   ============================================ */

const StorageService = {
    // Префикс для всех ключей
    _prefix: 'devspace_',
    
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
    
    // Загрузка данных
    get(key, defaultValue = null) {
        try {
            const fullKey = this._getKey(key);
            const data = localStorage.getItem(fullKey);
            
            if (data === null) {
                return defaultValue;
            }
            
            return JSON.parse(data);
        } catch (error) {
            console.error('StorageService: load error:', error);
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('storage:error', { key, error: error.message });
            }
            return defaultValue;
        }
    },
    
    // Проверка существования
    has(key) {
        const fullKey = this._getKey(key);
        return localStorage.getItem(fullKey) !== null;
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
    
    // Очистка всех данных приложения
    clearAll() {
        Object.values(this.KEYS).forEach(key => {
            this.remove(key);
        });
        
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('storage:cleared');
        }
    }
};

window.StorageService = StorageService;