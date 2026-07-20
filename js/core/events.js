/* ============================================
   EVENT BUS
   Централизованная система событий
   ============================================ */

const EventBus = {
    // Хранилище событий
    _events: {},
    
    // Максимальное количество обработчиков на событие
    _maxListeners: 50,
    
    // Подписка на событие
    on(event, callback) {
        if (typeof callback !== 'function') {
            console.error('EventBus: callback must be a function');
            return () => {};
        }
        
        if (!this._events[event]) {
            this._events[event] = [];
        }
        
        // Проверка на максимальное количество обработчиков
        if (this._events[event].length >= this._maxListeners) {
            console.warn(`EventBus: max listeners (${this._maxListeners}) exceeded for event "${event}"`);
        }
        
        this._events[event].push(callback);
        
        // Возвращаем функцию для отписки
        return () => this.off(event, callback);
    },
    
    // Подписка на один вызов
    once(event, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(event, wrapper);
        };
        
        // Сохраняем ссылку на оригинальный callback для возможности отписки
        wrapper._originalCallback = callback;
        
        return this.on(event, wrapper);
    },
    
    // Отписка от события
    off(event, callback) {
        if (!this._events[event]) return;
        
        if (!callback) {
            // Удаляем все обработчики для события
            delete this._events[event];
            return;
        }
        
        this._events[event] = this._events[event].filter(cb => {
            return cb !== callback && cb._originalCallback !== callback;
        });
        
        // Очищаем пустой массив
        if (this._events[event].length === 0) {
            delete this._events[event];
        }
    },
    
    // Вызов события
    emit(event, ...args) {
        if (!this._events[event]) return;
        
        // Создаем копию массива, чтобы избежать проблем при изменении во время итерации
        const handlers = [...this._events[event]];
        
        handlers.forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                console.error(`EventBus: error in handler for event "${event}":`, error);
            }
        });
    },
    
    // Получение списка обработчиков
    listeners(event) {
        return this._events[event] ? [...this._events[event]] : [];
    },
    
    // Количество обработчиков
    listenerCount(event) {
        return this._events[event] ? this._events[event].length : 0;
    },
    
    // Удаление всех обработчиков
    removeAllListeners() {
        this._events = {};
    },
    
    // Установка максимального количества обработчиков
    setMaxListeners(n) {
        this._maxListeners = n;
    },
    
    // Проверка наличия обработчиков
    hasListeners(event) {
        return this.listenerCount(event) > 0;
    }
};

// Экспорт
window.EventBus = EventBus;