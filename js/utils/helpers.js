/* ============================================
   HELPERS
   Вспомогательные функции
   ============================================ */

const Helpers = {
    // Генерация уникального ID
    generateId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return timestamp + random;
    },

    // Форматирование даты
    formatDate(dateString) {
        if (!dateString) return '';
        
        const date = new Date(dateString);
        
        // Проверка валидности даты
        if (isNaN(date.getTime())) return dateString;
        
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        // Относительное время
        if (seconds < 60) return 'только что';
        if (minutes < 60) return `${minutes} мин. назад`;
        if (hours < 24) return `${hours} ч. назад`;
        if (days < 7) return `${days} дн. назад`;
        
        // Полная дата
        return new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    },

    // Форматирование даты (короткий формат)
    formatDateShort(dateString) {
        if (!dateString) return '';
        
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        }).format(date);
    },

    // Debounce функция
    debounce(func, wait) {
        let timeout;
        
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Throttle функция
    throttle(func, limit) {
        let inThrottle;
        
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                }, limit);
            }
        };
    },

    // Получение текста статуса
    getStatusText(status) {
        const statusMap = {
            'planning': 'Планирование',
            'development': 'В разработке',
            'testing': 'Тестирование',
            'completed': 'Завершен',
            'archived': 'Архивирован'
        };
        return statusMap[status] || status;
    },

    // Получение CSS класса для статуса
    getStatusClass(status) {
        const classMap = {
            'planning': 'status-planning',
            'development': 'status-development',
            'testing': 'status-development',
            'completed': 'status-completed',
            'archived': 'status-archived'
        };
        return classMap[status] || '';
    },

    // Получение иконки для статуса
    getStatusIcon(status) {
        const iconMap = {
            'planning': 'bi-lightbulb',
            'development': 'bi-code-slash',
            'testing': 'bi-bug',
            'completed': 'bi-check-circle',
            'archived': 'bi-archive'
        };
        return iconMap[status] || 'bi-question-circle';
    },

    // Обрезка текста
    truncateText(text, maxLength = 100) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength).trim() + '...';
    },

    // Экранирование HTML
    escapeHtml(text) {
        if (!text) return '';
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Подсветка текста при поиске
    highlightText(text, searchTerm) {
        if (!text || !searchTerm) return text;
        
        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark class="highlight">$1</mark>');
    },

    // Копирование в буфер обмена
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            // Fallback для старых браузеров
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                document.execCommand('copy');
                return true;
            } catch (err) {
                console.error('Copy failed:', err);
                return false;
            } finally {
                document.body.removeChild(textarea);
            }
        }
    },

    // Генерация случайного цвета
    getRandomColor() {
        const colors = [
            '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
            '#ec4899', '#f43f5e', '#ef4444', '#f97316',
            '#f59e0b', '#eab308', '#84cc16', '#22c55e',
            '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
            '#3b82f6', '#6366f1'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    },

    // Проверка поддержки функции
    supportsFeature(feature) {
        switch (feature) {
            case 'clipboard':
                return !!navigator.clipboard;
            case 'share':
                return !!navigator.share;
            case 'serviceWorker':
                return 'serviceWorker' in navigator;
            case 'notifications':
                return 'Notification' in window;
            case 'indexedDB':
                return 'indexedDB' in window;
            default:
                return false;
        }
    },

    // Получение параметра из URL
    getUrlParam(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    },

    // Установка параметра в URL без перезагрузки
    setUrlParam(param, value) {
        const url = new URL(window.location);
        url.searchParams.set(param, value);
        window.history.replaceState({}, '', url);
    },

    // Загрузка файла
    downloadFile(content, filename, contentType = 'application/json') {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    },

    // Чтение файла
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            
            reader.readAsText(file);
        });
    },

    // Валидация URL
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    },

    // Валидация email
    isValidEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    },

    // Получение инициалов из имени
    getInitials(name) {
        if (!name) return '?';
        
        return name
            .split(' ')
            .map(word => word.charAt(0))
            .join('')
            .toUpperCase()
            .substring(0, 2);
    },

    // Перемешивание массива
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    },

    // Группировка массива по ключу
    groupBy(array, key) {
        return array.reduce((groups, item) => {
            const value = item[key];
            if (!groups[value]) {
                groups[value] = [];
            }
            groups[value].push(item);
            return groups;
        }, {});
    },

    // Сортировка массива объектов
    sortBy(array, key, order = 'asc') {
        return [...array].sort((a, b) => {
            let valueA = a[key];
            let valueB = b[key];
            
            // Для строк
            if (typeof valueA === 'string') {
                valueA = valueA.toLowerCase();
                valueB = valueB.toLowerCase();
            }
            
            if (valueA < valueB) return order === 'asc' ? -1 : 1;
            if (valueA > valueB) return order === 'asc' ? 1 : -1;
            return 0;
        });
    },

    // Уникальные значения массива
    unique(array) {
        return [...new Set(array)];
    },

    // Конвертация bytes в читаемый формат
    formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    }
};

window.Helpers = Helpers;