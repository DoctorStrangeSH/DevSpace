/* ============================================
   UPDATES MODULE
   Управление обновлениями проектов
   ============================================ */

const UpdatesModule = {
    // Инициализация
    init() {
        this._bindEvents();
        console.log('UpdatesModule initialized');
    },

    // Привязка событий
    _bindEvents() {
        EventBus.on('update:add', this.addUpdate.bind(this));
        EventBus.on('update:delete', this.deleteUpdate.bind(this));
        EventBus.on('update:edit', this.editUpdate.bind(this));
    },

    // Добавление обновления
    addUpdate(projectId, text, version = '') {
        const project = StateManager.getProject(projectId);
        if (!project) return null;

        // Валидация
        const validation = Validators.validateUpdate({ text, version });
        if (!validation.valid) {
            validation.errors.forEach(error => {
                NotificationModule.error(error);
            });
            return null;
        }

        const newUpdate = {
            id: Helpers.generateId(),
            text: text.trim(),
            version: version.trim() || this._generateVersion(project),
            timestamp: new Date().toISOString(),
            type: 'update'
        };

        if (!project.updates) {
            project.updates = [];
        }

        project.updates.unshift(newUpdate);

        // Ограничиваем количество обновлений
        if (project.updates.length > 100) {
            project.updates = project.updates.slice(0, 100);
        }

        StateManager.updateProject(projectId, {
            updates: project.updates,
            updatedAt: new Date().toISOString()
        });

        NotificationModule.success('Обновление добавлено');
        EventBus.emit('update:added', { projectId, update: newUpdate });
        RendererModule.renderProjects();
        RendererModule.renderStats();

        return newUpdate;
    },

    // Удаление обновления
    deleteUpdate(projectId, updateId) {
        const project = StateManager.getProject(projectId);
        if (!project) return false;

        const index = project.updates.findIndex(u => u.id === updateId);
        if (index === -1) return false;

        if (!confirm('Удалить это обновление?')) return false;

        project.updates.splice(index, 1);

        StateManager.updateProject(projectId, {
            updates: project.updates
        });

        EventBus.emit('update:deleted', { projectId, updateId });
        RendererModule.renderProjects();

        return true;
    },

    // Редактирование обновления
    editUpdate(projectId, updateId, newText) {
        const project = StateManager.getProject(projectId);
        if (!project) return null;

        const update = project.updates.find(u => u.id === updateId);
        if (!update) return null;

        const validation = Validators.validateUpdate({ text: newText });
        if (!validation.valid) return null;

        update.text = newText.trim();
        update.editedAt = new Date().toISOString();

        StateManager.updateProject(projectId, {
            updates: project.updates
        });

        EventBus.emit('update:edited', { projectId, update });
        RendererModule.renderProjects();

        return update;
    },

    // Генерация версии
    _generateVersion(project) {
        // Если есть обновления, инкрементируем патч
        if (project.updates && project.updates.length > 0) {
            const lastVersion = project.updates[0].version;
            const match = lastVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
            
            if (match) {
                const major = parseInt(match[1]);
                const minor = parseInt(match[2]);
                const patch = parseInt(match[3]);
                return `${major}.${minor}.${patch + 1}`;
            }
        }
        
        return '1.0.0';
    },

    // Получение последних обновлений
    getRecentUpdates(projectId, count = 5) {
        const project = StateManager.getProject(projectId);
        if (!project || !project.updates) return [];
        
        return project.updates.slice(0, count);
    },

    // Получение всех обновлений с пагинацией
    getUpdatesPaginated(projectId, page = 1, perPage = 10) {
        const project = StateManager.getProject(projectId);
        if (!project || !project.updates) {
            return {
                updates: [],
                total: 0,
                page,
                totalPages: 0
            };
        }

        const total = project.updates.length;
        const totalPages = Math.ceil(total / perPage);
        const start = (page - 1) * perPage;
        const updates = project.updates.slice(start, start + perPage);

        return {
            updates,
            total,
            page,
            totalPages
        };
    },

    // Поиск по обновлениям
    searchUpdates(projectId, query) {
        const project = StateManager.getProject(projectId);
        if (!project || !project.updates) return [];

        const searchTerm = query.toLowerCase();
        
        return project.updates.filter(update => 
            update.text.toLowerCase().includes(searchTerm) ||
            update.version.toLowerCase().includes(searchTerm)
        );
    },

    // Экспорт обновлений
    exportUpdates(projectId) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        const data = {
            project: project.name,
            updates: project.updates || [],
            exportedAt: new Date().toISOString()
        };

        const json = JSON.stringify(data, null, 2);
        const filename = `updates-${project.name.toLowerCase().replace(/\s+/g, '-')}.json`;
        
        Helpers.downloadFile(json, filename);
        NotificationModule.success('Обновления экспортированы');
    }
};

window.UpdatesModule = UpdatesModule;