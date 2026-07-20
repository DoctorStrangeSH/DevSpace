/* ============================================
   CHECKLIST MODULE (исправленный)
   ============================================ */

var ChecklistModule = {
    init: function() {
        this._bindEvents();
        console.log('ChecklistModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        EventBus.on('checklist:toggle', function(data) { self.toggleItem(data.projectId, data.itemId); });
        EventBus.on('checklist:add', function(data) { self.addItem(data.projectId, data.text); });
        EventBus.on('checklist:delete', function(data) { self.deleteItem(data.projectId, data.itemId); });
    },

    toggleItem: function(projectId, itemId) {
        var project = StateManager.getProject(projectId);
        if (!project) return;

        var item = (project.checklist || []).find(function(i) { return i.id === itemId; });
        if (!item) return;

        item.completed = !item.completed;
        item.completedAt = item.completed ? new Date().toISOString() : null;

        this._recalculateProgress(project);

        StateManager.updateProject(projectId, {
            checklist: project.checklist,
            progress: project.progress
        });

        // Обновляем ТОЛЬКО чек-лист в DOM, не перерисовывая всю модалку
        this._updateChecklistDOM(project);
        
        // Обновляем карточки на главной
        EventBus.emit('checklist:changed', { projectId: projectId, itemId: itemId });
    },

    addItem: function(projectId, text) {
        var project = StateManager.getProject(projectId);
        if (!project) return null;

        if (!text || !text.trim()) return null;

        var newItem = {
            id: Helpers.generateId(),
            text: text.trim(),
            completed: false,
            createdAt: new Date().toISOString(),
            completedAt: null,
            order: (project.checklist || []).length
        };

        if (!project.checklist) project.checklist = [];
        project.checklist.push(newItem);

        this._recalculateProgress(project);

        StateManager.updateProject(projectId, {
            checklist: project.checklist,
            progress: project.progress
        });

        // Обновляем DOM
        this._updateChecklistDOM(project);
        EventBus.emit('checklist:changed', { projectId: projectId });
        
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.success('Задача добавлена');
        }

        return newItem;
    },

    deleteItem: function(projectId, itemId) {
        var project = StateManager.getProject(projectId);
        if (!project) return false;

        project.checklist = (project.checklist || []).filter(function(i) { return i.id !== itemId; });

        this._recalculateProgress(project);

        StateManager.updateProject(projectId, {
            checklist: project.checklist,
            progress: project.progress
        });

        this._updateChecklistDOM(project);
        EventBus.emit('checklist:changed', { projectId: projectId });

        return true;
    },

    // Обновление ТОЛЬКО чек-листа в DOM (без перерисовки всей модалки)
    _updateChecklistDOM: function(project) {
        var container = document.querySelector('.checklist-container[data-project-id="' + project.id + '"]');
        if (!container) return;

        var self = this;
        var checklist = project.checklist || [];
        var isOwner = typeof AuthService !== 'undefined' ? AuthService.isOwner() : true;

        if (checklist.length === 0) {
            container.innerHTML = '<div class="checklist-empty"><i class="bi bi-clipboard"></i><p>Нет задач</p></div>';
        } else {
            container.innerHTML = checklist.map(function(item) {
                return '<div class="checklist-item ' + (item.completed ? 'completed' : '') + '" data-item-id="' + item.id + '">' +
                    '<div class="checklist-checkbox">' + (item.completed ? '<i class="bi bi-check"></i>' : '') + '</div>' +
                    '<span class="checklist-text">' + Helpers.escapeHtml(item.text) + '</span>' +
                    (isOwner ? '<button class="checklist-delete"><i class="bi bi-x"></i></button>' : '') +
                '</div>';
            }).join('');

            // Перепривязываем события
            this._bindChecklistEvents(project.id);
        }

        // Обновляем счётчик
        var completed = checklist.filter(function(i) { return i.completed; }).length;
        var badge = document.querySelector('.checklist-container[data-project-id="' + project.id + '"]').previousElementSibling?.querySelector('.badge');
        if (!badge) {
            // Ищем в заголовке секции
            var header = container.closest('.detail-section')?.querySelector('h4 .badge');
            if (header) badge = header;
        }
        if (badge) {
            badge.textContent = completed + '/' + checklist.length;
        }

        // Обновляем прогресс-бар
        var progressBar = document.querySelector('.project-detail .progress-bar');
        if (progressBar) {
            progressBar.style.width = (project.progress || 0) + '%';
        }
        var progressText = document.querySelector('.project-detail .sidebar-card small[style*="color: var(--accent)"]');
        if (progressText) {
            progressText.textContent = (project.progress || 0) + '%';
        }
    },

    _bindChecklistEvents: function(projectId) {
        var container = document.querySelector('.checklist-container[data-project-id="' + projectId + '"]');
        if (!container) return;

        var self = this;

        container.querySelectorAll('.checklist-item').forEach(function(item) {
            item.addEventListener('click', function(e) {
                if (e.target.closest('.checklist-delete')) return;
                self.toggleItem(projectId, item.dataset.itemId);
            });
        });

        container.querySelectorAll('.checklist-delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (confirm('Удалить задачу?')) {
                    self.deleteItem(projectId, btn.closest('.checklist-item').dataset.itemId);
                }
            });
        });
    },

    _recalculateProgress: function(project) {
        if (!project.checklist || project.checklist.length === 0) {
            project.progress = 0;
            return;
        }
        var completed = project.checklist.filter(function(i) { return i.completed; }).length;
        project.progress = Math.round((completed / project.checklist.length) * 100);
    }
};

window.ChecklistModule = ChecklistModule;