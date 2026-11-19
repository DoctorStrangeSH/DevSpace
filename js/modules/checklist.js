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
        EventBus.on('checklist:update', function(data) { self.updateText(data.projectId, data.itemId, data.text); });
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

    updateText: function(projectId, itemId, text) {
        if (typeof text !== 'string') return false;
        var normalized = text.trim();
        if (!normalized || normalized.length > 240) return false;
        var project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.checklist)) return false;
        var item = project.checklist.find(function(task) { return String(task.id) === String(itemId); });
        if (!item) return false;
        if (item.text === normalized) return true;
        item.text = normalized;
        item.updatedAt = new Date().toISOString();
        StateManager.updateProject(projectId, { checklist: project.checklist });
        this._updateChecklistDOM(project);
        EventBus.emit('checklist:changed', { projectId: projectId, itemId: itemId });
        return true;
    },
    updateDetails: function(projectId, itemId, details) {
        details = details || {};
        if (typeof details.text !== 'string') return false;
        var text = details.text.trim();
        if (!text || text.length > 240) return false;
        var priority = details.priority;
        if (['high', 'normal', 'low'].indexOf(priority) === -1) return false;
        var deadline = details.deadline || '';
        if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString().slice(0, 10) !== deadline)) return false;
        var project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.checklist)) return false;
        var item = project.checklist.find(function(task) { return String(task.id) === String(itemId); });
        if (!item) return false;
        var changed = item.text !== text || (item.priority || 'normal') !== priority || (item.deadline || '') !== deadline;
        if (!changed) return true;
        item.text = text;
        if (priority === 'normal') delete item.priority; else item.priority = priority;
        if (deadline) item.deadline = deadline; else delete item.deadline;
        item.updatedAt = new Date().toISOString();
        StateManager.updateProject(projectId, { checklist: project.checklist });
        this._updateChecklistDOM(project);
        EventBus.emit('checklist:changed', { projectId: projectId, itemId: itemId });
        return true;
    },

    openEditor: function(projectId, itemId) {
        var project = StateManager.getProject(projectId);
        var task = project && (project.checklist || []).find(function(item) { return String(item.id) === String(itemId); });
        if (!task || typeof document === 'undefined' || !document.body) return false;
        var existing = document.getElementById('checklistTaskEditor');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'checklistTaskEditor';
        overlay.className = 'checklist-editor-backdrop';
        overlay.innerHTML = '<section class="checklist-editor" role="dialog" aria-modal="true" aria-labelledby="checklistEditorTitle">' +
            '<div class="checklist-editor-heading"><h3 id="checklistEditorTitle">Редактирование задачи</h3><button type="button" class="checklist-editor-close" aria-label="Закрыть">×</button></div>' +
            '<form class="checklist-editor-form">' +
            '<label>Название<input name="text" type="text" maxlength="240" required></label>' +
            '<div class="checklist-editor-fields"><label>Приоритет<select name="priority"><option value="high">Высокий</option><option value="normal">Обычный</option><option value="low">Низкий</option></select></label>' +
            '<label>Срок выполнения<input name="deadline" type="date"></label></div>' +
            '<p class="checklist-editor-error" role="alert" hidden></p>' +
            '<div class="checklist-editor-actions"><button type="button" class="checklist-editor-cancel">Отмена</button><button type="submit" class="checklist-editor-save">Сохранить</button></div>' +
            '</form></section>';
        document.body.appendChild(overlay);
        var form = overlay.querySelector('form');
        form.elements.text.value = task.text || '';
        form.elements.priority.value = task.priority || 'normal';
        form.elements.deadline.value = task.deadline || '';
        var close = function() { overlay.remove(); };
        overlay.querySelector('.checklist-editor-close').addEventListener('click', close);
        overlay.querySelector('.checklist-editor-cancel').addEventListener('click', close);
        overlay.addEventListener('click', function(event) { if (event.target === overlay) close(); });
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            var ok = ChecklistModule.updateDetails(projectId, itemId, { text: form.elements.text.value, priority: form.elements.priority.value, deadline: form.elements.deadline.value });
            var error = form.querySelector('.checklist-editor-error');
            if (!ok) { error.textContent = 'Проверьте название, приоритет и дату.'; error.hidden = false; return; }
            close();
        });
        form.elements.text.focus();
        return true;
    },
    setPriority: function(projectId, itemId, priority) {
        if (['high', 'normal', 'low'].indexOf(priority) === -1) return false;
        var project = StateManager.getProject(projectId);
        if (!project) return false;
        var item = (project.checklist || []).find(function(task) { return String(task.id) === String(itemId); });
        if (!item) return false;
        if (item.priority === priority || (priority === 'normal' && !item.priority)) return true;
        if (priority === 'normal') delete item.priority;
        else item.priority = priority;
        item.updatedAt = new Date().toISOString();
        StateManager.updateProject(projectId, { checklist: project.checklist });
        this._updateChecklistDOM(project);
        EventBus.emit('checklist:changed', { projectId: projectId, itemId: itemId });
        return true;
    },

    setDeadline: function(projectId, itemId, deadline) {
        if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString().slice(0, 10) !== deadline)) return false;
        var project = StateManager.getProject(projectId);
        if (!project) return false;
        var task = (project.checklist || []).find(function(item) { return String(item.id) === String(itemId); });
        if (!task) return false;
        if ((task.deadline || '') === deadline) return true;
        if (deadline) task.deadline = deadline;
        else delete task.deadline;
        task.updatedAt = new Date().toISOString();
        StateManager.updateProject(projectId, { checklist: project.checklist });
        this._updateChecklistDOM(project);
        EventBus.emit('checklist:changed', { projectId: projectId, itemId: itemId });
        return true;
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

        var removed = (project.checklist || []).find(function(item) { return item.id === itemId; });
        if (!removed) return false;
        var linkedNote = removed.sourceNoteId && (project.notes || []).find(function(note) {
            return note.id === removed.sourceNoteId && note.linkedTaskId === removed.id;
        });
        if (linkedNote) {
            delete linkedNote.linkedTaskId;
            linkedNote.updatedAt = new Date().toISOString();
        }
        project.checklist = (project.checklist || []).filter(function(i) { return i.id !== itemId; });

        this._recalculateProgress(project);

        StateManager.updateProject(projectId, {
            checklist: project.checklist,
            notes: project.notes,
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
                    (isOwner ? '<button class="checklist-edit" type="button" aria-label="Изменить задачу" title="Изменить задачу"><i class="bi bi-pencil"></i></button>' : '') +
                    (item.sourceNoteId ? '<button class="task-source-note" type="button" data-source-note="' + Helpers.escapeHtml(String(item.sourceNoteId)) + '" aria-label="Перейти к исходной заметке" title="Исходная заметка"><i class="bi bi-journal-text"></i></button>' : '') +
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
                var sourceNote = e.target.closest('.task-source-note');
                if (sourceNote) {
                    e.stopPropagation();
                    EventBus.emit('notes:focus', { projectId: projectId, noteId: sourceNote.dataset.sourceNote });
                    return;
                }
                if (e.target.closest('.checklist-delete')) return;
                self.toggleItem(projectId, item.dataset.itemId);
            });
        });

        container.querySelectorAll('.checklist-edit').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var row = btn.closest('.checklist-item');
                var currentProject = StateManager.getProject(projectId);
                var task = currentProject && (currentProject.checklist || []).find(function(item) { return String(item.id) === String(row.dataset.itemId); });
                if (!task) return;
                self.openEditor(projectId, row.dataset.itemId);
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
