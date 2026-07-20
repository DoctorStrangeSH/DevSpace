/* ============================================
   VALIDATORS
   Функции валидации данных
   ============================================ */

const Validators = {
    // Валидация проекта
    validateProject(data) {
        const errors = [];
        const warnings = [];
        
        // Название обязательно
        if (!data.name || !data.name.trim()) {
            errors.push('Название проекта обязательно');
        } else if (data.name.trim().length < 3) {
            errors.push('Название должно быть не менее 3 символов');
        } else if (data.name.trim().length > 100) {
            errors.push('Название не должно превышать 100 символов');
        }
        
        // Описание
        if (data.description && data.description.length > 5000) {
            warnings.push('Описание слишком длинное (рекомендуется до 5000 символов)');
        }
        
        // Статус
        const validStatuses = ['planning', 'development', 'testing', 'completed', 'archived'];
        if (data.status && !validStatuses.includes(data.status)) {
            errors.push('Недопустимый статус проекта');
        }
        
        // Прогресс
        if (data.progress !== undefined && data.progress !== null) {
            const progress = Number(data.progress);
            if (isNaN(progress) || progress < 0 || progress > 100) {
                errors.push('Прогресс должен быть числом от 0 до 100');
            }
        }
        
        // URL валидация
        if (data.github && !Helpers.isValidUrl(data.github)) {
            warnings.push('Некорректная ссылка на GitHub');
        }
        
        if (data.demo && !Helpers.isValidUrl(data.demo)) {
            warnings.push('Некорректная ссылка на демо');
        }
        
        // Дедлайн
        if (data.deadline) {
            const deadlineDate = new Date(data.deadline);
            if (isNaN(deadlineDate.getTime())) {
                errors.push('Некорректная дата дедлайна');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    },

    // Валидация элемента чеклиста
    validateChecklistItem(data) {
        const errors = [];
        
        if (!data.text || !data.text.trim()) {
            errors.push('Текст задачи обязателен');
        } else if (data.text.trim().length > 200) {
            errors.push('Текст задачи не должен превышать 200 символов');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    },

    // Валидация обновления
    validateUpdate(data) {
        const errors = [];
        
        if (!data.text || !data.text.trim()) {
            errors.push('Текст обновления обязателен');
        } else if (data.text.trim().length > 500) {
            errors.push('Текст обновления не должен превышать 500 символов');
        }
        
        if (data.version && !/^\d+\.\d+\.\d+$/.test(data.version)) {
            errors.push('Неверный формат версии (должен быть X.Y.Z)');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    },

    // Валидация настроек
    validateSettings(data) {
        const errors = [];
        
        if (data.backupFrequency) {
            const validFrequencies = ['daily', 'weekly', 'monthly'];
            if (!validFrequencies.includes(data.backupFrequency)) {
                errors.push('Недопустимая частота бэкапа');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    },

    // Проверка на пустоту
    isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim().length === 0;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    },

    // Проверка на число
    isNumber(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    },

    // Проверка на целое число
    isInteger(value) {
        return Number.isInteger(Number(value));
    },

    // Проверка на положительное число
    isPositive(value) {
        return this.isNumber(value) && Number(value) > 0;
    },

    // Проверка диапазона
    isInRange(value, min, max) {
        const num = Number(value);
        return this.isNumber(num) && num >= min && num <= max;
    },

    // Проверка длины строки
    isLengthValid(str, min = 0, max = Infinity) {
        if (typeof str !== 'string') return false;
        const length = str.trim().length;
        return length >= min && length <= max;
    },

    // Проверка формата версии
    isVersionFormat(version) {
        return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(version);
    },

    // Санитизация ввода
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        
        return input
            .trim()
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    },

    // Проверка на дубликат имени проекта
    isDuplicateName(name, excludeId = null) {
        const projects = StateManager.get('projects');
        const normalizedName = name.trim().toLowerCase();
        
        return projects.some(project => 
            project.name.trim().toLowerCase() === normalizedName &&
            project.id !== excludeId
        );
    }
};

window.Validators = Validators;