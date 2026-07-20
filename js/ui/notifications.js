/* ============================================
   NOTIFICATIONS MODULE
   Система уведомлений (toast)
   ============================================ */

const NotificationModule = {
    // Конфигурация
    config: {
        position: 'bottom-end',
        maxVisible: 5,
        duration: 4000,
        animationDuration: 300
    },
    
    // Очередь уведомлений
    queue: [],
    
    // Активные уведомления
    activeNotifications: [],

    // Инициализация
    init() {
        this._createContainer();
        this._bindEvents();
        console.log('NotificationModule initialized');
    },

    // Создание контейнера для уведомлений
    _createContainer() {
        const container = document.getElementById('notificationsContainer');
        if (container) {
            this.container = container;
            return;
        }
        
        const newContainer = document.createElement('div');
        newContainer.id = 'notificationsContainer';
        newContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(newContainer);
        this.container = newContainer;
    },

    // Привязка событий
    _bindEvents() {
        EventBus.on('notification:show', (data) => {
            this.show(data.message, data.type, data.options);
        });
        
        EventBus.on('notification:success', (message) => {
            this.success(message);
        });
        
        EventBus.on('notification:error', (message) => {
            this.error(message);
        });
        
        EventBus.on('notification:warning', (message) => {
            this.warning(message);
        });
        
        EventBus.on('notification:info', (message) => {
            this.info(message);
        });
    },

    // Показать уведомление
    show(message, type = 'info', options = {}) {
        const config = {
            duration: options.duration || this.config.duration,
            icon: options.icon || this._getIcon(type),
            title: options.title || this._getTitle(type),
            dismissible: options.dismissible !== false,
            animation: options.animation !== false
        };
        
        const notification = {
            id: Helpers.generateId(),
            message,
            type,
            config,
            timestamp: Date.now()
        };
        
        // Проверяем лимит активных уведомлений
        if (this.activeNotifications.length >= this.config.maxVisible) {
            const oldest = this.activeNotifications.shift();
            this._removeNotification(oldest.id);
        }
        
        this.activeNotifications.push(notification);
        this._renderNotification(notification);
        
        // Автоматическое скрытие
        if (config.duration > 0) {
            setTimeout(() => {
                this.dismiss(notification.id);
            }, config.duration);
        }
        
        return notification.id;
    },

    // Успешное уведомление
    success(message, options = {}) {
        return this.show(message, 'success', options);
    },

    // Уведомление об ошибке
    error(message, options = {}) {
        return this.show(message, 'error', {
            ...options,
            duration: options.duration || 6000
        });
    },

    // Предупреждение
    warning(message, options = {}) {
        return this.show(message, 'warning', {
            ...options,
            duration: options.duration || 5000
        });
    },

    // Информационное уведомление
    info(message, options = {}) {
        return this.show(message, 'info', options);
    },

    // Скрыть уведомление
    dismiss(id) {
        const notification = this.activeNotifications.find(n => n.id === id);
        if (!notification) return;
        
        // Анимация скрытия
        const element = document.getElementById(`notification-${id}`);
        if (element) {
            element.classList.add('notification-hiding');
            setTimeout(() => {
                this._removeNotification(id);
            }, 300);
        } else {
            this._removeNotification(id);
        }
    },

    // Скрыть все уведомления
    dismissAll() {
        [...this.activeNotifications].forEach(n => {
            this.dismiss(n.id);
        });
    },

    // Удаление уведомления из DOM и массива
    _removeNotification(id) {
        const element = document.getElementById(`notification-${id}`);
        if (element) {
            element.remove();
        }
        
        this.activeNotifications = this.activeNotifications.filter(n => n.id !== id);
    },

    // Рендеринг уведомления
    _renderNotification(notification) {
        const { id, message, type, config } = notification;
        
        const toastHTML = `
            <div id="notification-${id}" 
                 class="notification-toast notification-${type}"
                 role="alert"
                 aria-live="assertive"
                 aria-atomic="true">
                <div class="notification-content">
                    <div class="notification-icon">
                        <i class="bi ${config.icon}"></i>
                    </div>
                    <div class="notification-body">
                        ${config.title ? `<div class="notification-title">${config.title}</div>` : ''}
                        <div class="notification-message">${message}</div>
                    </div>
                    ${config.dismissible ? `
                        <button class="notification-close" onclick="NotificationModule.dismiss('${id}')">
                            <i class="bi bi-x"></i>
                        </button>
                    ` : ''}
                </div>
                ${config.duration > 0 ? `
                    <div class="notification-progress">
                        <div class="notification-progress-bar" style="animation-duration: ${config.duration}ms"></div>
                    </div>
                ` : ''}
            </div>
        `;
        
        this.container.insertAdjacentHTML('beforeend', toastHTML);
        
        // Анимация появления
        requestAnimationFrame(() => {
            const element = document.getElementById(`notification-${id}`);
            if (element) {
                element.classList.add('notification-show');
            }
        });
    },

    // Получение иконки для типа
    _getIcon(type) {
        const icons = {
            success: 'bi-check-circle-fill',
            error: 'bi-x-circle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info: 'bi-info-circle-fill'
        };
        return icons[type] || icons.info;
    },

    // Получение заголовка для типа
    _getTitle(type) {
        const titles = {
            success: 'Успешно',
            error: 'Ошибка',
            warning: 'Внимание',
            info: 'Информация'
        };
        return titles[type] || '';
    }
};

// Стили для уведомлений (добавляем динамически)
const notificationStyles = `
    .notification-toast {
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        margin-bottom: 8px;
        min-width: 300px;
        max-width: 400px;
        box-shadow: var(--shadow-lg);
        transform: translateX(120%);
        transition: transform 0.3s ease;
        overflow: hidden;
    }
    
    .notification-show {
        transform: translateX(0);
    }
    
    .notification-hiding {
        transform: translateX(120%);
    }
    
    .notification-content {
        display: flex;
        align-items: flex-start;
        padding: 16px;
        gap: 12px;
    }
    
    .notification-icon {
        font-size: 20px;
        flex-shrink: 0;
    }
    
    .notification-success .notification-icon { color: #22c55e; }
    .notification-error .notification-icon { color: #ef4444; }
    .notification-warning .notification-icon { color: #fbbf24; }
    .notification-info .notification-icon { color: #3b82f6; }
    
    .notification-body {
        flex: 1;
        min-width: 0;
    }
    
    .notification-title {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 4px;
        color: var(--text-primary);
    }
    
    .notification-message {
        font-size: 13px;
        color: var(--text-secondary);
        word-wrap: break-word;
    }
    
    .notification-close {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
        font-size: 16px;
        flex-shrink: 0;
        transition: color 0.2s;
    }
    
    .notification-close:hover {
        color: var(--text-primary);
    }
    
    .notification-progress {
        height: 3px;
        background: var(--border-color);
    }
    
    .notification-progress-bar {
        height: 100%;
        background: var(--accent);
        animation: progressShrink linear forwards;
    }
    
    .notification-success .notification-progress-bar { background: #22c55e; }
    .notification-error .notification-progress-bar { background: #ef4444; }
    .notification-warning .notification-progress-bar { background: #fbbf24; }
    .notification-info .notification-progress-bar { background: #3b82f6; }
    
    @keyframes progressShrink {
        from { width: 100%; }
        to { width: 0%; }
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);

window.NotificationModule = NotificationModule;