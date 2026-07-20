/* ============================================
   THEME MODULE
   Управление темой оформления
   ============================================ */

const ThemeModule = {
    themes: {
        dark: {
            name: 'Темная',
            icon: 'bi-moon-stars',
            dataBsTheme: 'dark'
        },
        light: {
            name: 'Светлая',
            icon: 'bi-sun',
            dataBsTheme: 'light'
        }
    },
    
    currentTheme: 'dark',
    _initialized: false,

    init() {
        if (this._initialized) {
            console.log('ThemeModule already initialized');
            return;
        }

        console.log('ThemeModule: initializing...');

        // Получаем тему из StateManager (он уже должен быть инициализирован)
        if (typeof StateManager !== 'undefined') {
            this.currentTheme = StateManager.get('theme') || 'dark';
        } else {
            // Fallback: пробуем загрузить напрямую
            const savedTheme = StorageService.get(StorageService.KEYS.THEME);
            this.currentTheme = savedTheme || 'dark';
        }

        console.log('ThemeModule: current theme is', this.currentTheme);

        // Применяем тему к DOM
        this._applyThemeToDOM(this.currentTheme);
        
        // Обновляем иконку кнопки
        this._updateToggleButton();

        // Привязываем события
        this._bindEvents();

        // Подписываемся на изменения состояния
        if (typeof EventBus !== 'undefined') {
            EventBus.on('state:theme:changed', (newTheme) => {
                if (newTheme !== this.currentTheme) {
                    this.currentTheme = newTheme;
                    this._applyThemeToDOM(newTheme);
                    this._updateToggleButton();
                }
            });
        }

        this._initialized = true;
        console.log('ThemeModule: initialized');
    },

    _bindEvents() {
        // Кнопка переключения темы
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            // Удаляем старые обработчики
            const newToggle = themeToggle.cloneNode(true);
            themeToggle.parentNode.replaceChild(newToggle, themeToggle);
            
            newToggle.addEventListener('click', () => {
                this.toggle();
            });
        }

        // Отслеживание системной темы
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            
            const handler = (e) => {
                // Меняем тему только если пользователь не выбрал вручную
                const savedTheme = StorageService.get(StorageService.KEYS.THEME);
                if (!savedTheme) {
                    const newTheme = e.matches ? 'dark' : 'light';
                    this.setTheme(newTheme, false); // не сохраняем, т.к. это авто
                }
            };

            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', handler);
            } else if (mediaQuery.addListener) {
                mediaQuery.addListener(handler);
            }
        }

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'T') {
                e.preventDefault();
                this.toggle();
            }
        });
    },

    toggle() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme, true);
    },

    setTheme(themeName, savePreference = true) {
        if (!this.themes[themeName]) {
            console.warn('ThemeModule: unknown theme:', themeName);
            return;
        }

        if (this.currentTheme === themeName) {
            return;
        }

        console.log('ThemeModule: switching to', themeName);

        this.currentTheme = themeName;

        // Применяем к DOM
        this._applyThemeToDOM(themeName);

        // Обновляем кнопку
        this._updateToggleButton();

        // Сохраняем в StateManager
        if (typeof StateManager !== 'undefined') {
            StateManager.set('theme', themeName);
        }

        // Сохраняем в Storage только если это ручной выбор
        if (savePreference) {
            StorageService.set(StorageService.KEYS.THEME, themeName);
            console.log('ThemeModule: saved preference:', themeName);
        }

        // Уведомляем
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('theme:changed', {
                theme: themeName,
                themeData: this.themes[themeName]
            });
        }
    },

    _applyThemeToDOM(themeName) {
        const theme = this.themes[themeName];
        if (!theme) return;

        // Устанавливаем атрибут
        document.documentElement.setAttribute('data-bs-theme', theme.dataBsTheme);
        
        // Обновляем meta theme-color
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.content = themeName === 'dark' ? '#0a0a0a' : '#ffffff';
        }
    },

    _updateToggleButton() {
        const themeToggle = document.getElementById('themeToggle');
        if (!themeToggle) return;

        const theme = this.themes[this.currentTheme];
        const icon = themeToggle.querySelector('i');
        
        if (icon) {
            icon.className = `bi ${theme.icon}`;
        }
        
        const nextTheme = this.currentTheme === 'dark' ? 'светлую' : 'темную';
        themeToggle.title = `Переключить на ${nextTheme} тему`;
    },

    getCurrentTheme() {
        return {
            name: this.currentTheme,
            ...this.themes[this.currentTheme]
        };
    },

    isDark() {
        return this.currentTheme === 'dark';
    }
};

window.ThemeModule = ThemeModule;