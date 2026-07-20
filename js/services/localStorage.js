/* ============================================
   LOCAL STORAGE SERVICE
   Локальное хранение данных
   ============================================ */

const LocalStorageService = {
    _prefix: 'devspace_',

    KEYS: {
        PROJECTS: 'projects',
        THEME: 'theme',
        SETTINGS: 'settings',
        FAVORITES: 'favorites',
        ACHIEVEMENTS: 'achievements',
        LAST_SYNC: 'last_sync'
    },

    init() {
        console.log('LocalStorageService initialized');
        return Promise.resolve();
    },

    _getKey(key) {
        return this._prefix + key;
    },

    async get(key, defaultValue = null) {
        try {
            const fullKey = this._getKey(key);
            const data = localStorage.getItem(fullKey);
            return data ? JSON.parse(data) : defaultValue;
        } catch (error) {
            console.error('LocalStorage get error:', error);
            return defaultValue;
        }
    },

    async set(key, data) {
        try {
            const fullKey = this._getKey(key);
            localStorage.setItem(fullKey, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('LocalStorage set error:', error);
            return false;
        }
    },

    async remove(key) {
        try {
            const fullKey = this._getKey(key);
            localStorage.removeItem(fullKey);
            return true;
        } catch (error) {
            return false;
        }
    },

    async getAll() {
        const data = {};
        Object.values(this.KEYS).forEach(key => {
            data[key] = this.get(key);
        });
        return data;
    },

    async saveAll(data) {
        for (const [key, value] of Object.entries(data)) {
            await this.set(key, value);
        }
    }
};

window.LocalStorageService = LocalStorageService;