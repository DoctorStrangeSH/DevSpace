/* ============================================
   NOTES MODULE
   Заметки, планы, баги и идеи для проекта
   ============================================ */

var NotesModule = {
    types: {
        feature: { label: 'Фича', icon: 'bi-stars', color: '#6366f1' },
        improvement: { label: 'Улучшение', icon: 'bi-arrow-up-circle', color: '#22c55e' },
        bug: { label: 'Баг', icon: 'bi-bug', color: '#ef4444' },
        idea: { label: 'Идея', icon: 'bi-lightbulb', color: '#fbbf24' },
        refactor: { label: 'Рефакторинг', icon: 'bi-gear', color: '#8b5cf6' },
        todo: { label: 'Сделать', icon: 'bi-check-square', color: '#3b82f6' },
        note: { label: 'Заметка', icon: 'bi-journal-text', color: '#6b7280' }
    },

    priorities: {
        low: { label: 'Низкий', color: '#6b7280', icon: 'bi-arrow-down' },
        medium: { label: 'Средний', color: '#fbbf24', icon: 'bi-dash' },
        high: { label: 'Высокий', color: '#f97316', icon: 'bi-arrow-up' },
        critical: { label: 'Критичный', color: '#ef4444', icon: 'bi-exclamation-triangle' }
    },

    init: function() {
        this._bindEvents();
        console.log('NotesModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        EventBus.on('notes:add', function(data) { self.addNote(data.projectId, data); });
        EventBus.on('notes:delete', function(data) { self.deleteNote(data.projectId, data.noteId); });
        EventBus.on('notes:update', function(data) { self.updateNote(data.projectId, data.noteId, data.updates); });
        EventBus.on('notes:toggle-complete', function(data) { self.toggleComplete(data.projectId, data.noteId); });
    },

    _persistMutation: function(projectId, project, snapshot, updates) {
        var saved = StateManager.updateProject(projectId, updates);
        if (saved !== false && saved !== null) return true;

        Object.keys(project).forEach(function(key) { delete project[key]; });
        Object.assign(project, snapshot);
        if (typeof StateManager._updateStats === 'function') StateManager._updateStats();
        if (typeof NotificationModule !== 'undefined') {
            var message = 'Не удалось сохранить заметку. Проверьте свободное место в хранилище.';
            if (typeof NotificationModule.error === 'function') NotificationModule.error(message);
            else if (typeof NotificationModule.warning === 'function') NotificationModule.warning(message);
        }
        return false;
    },

    addNote: function(projectId, data) {
        var project = StateManager.getProject(projectId);
        if (!project) return null;
        var snapshot = JSON.parse(JSON.stringify(project));

        if (!project.notes) {
            project.notes = [];
        }

        var note = {
            id: Helpers.generateId(),
            type: data.type || 'note',
            priority: data.priority || 'medium',
            title: data.title || '',
            description: data.description || '',
            completed: false,
            tags: data.tags || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null
        };

        project.notes.unshift(note);
        if (!this._persistMutation(projectId, project, snapshot, { notes: project.notes })) return null;

        EventBus.emit('notes:added', { projectId: projectId, note: note });
        
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.success('Заметка добавлена');
        }

        return note;
    },

    deleteNote: function(projectId, noteId) {
        var project = StateManager.getProject(projectId);
        if (!project) return false;
        var snapshot = JSON.parse(JSON.stringify(project));

        var index = -1;
        if (project.notes) {
            for (var i = 0; i < project.notes.length; i++) {
                if (project.notes[i].id === noteId) {
                    index = i;
                    break;
                }
            }
        }
        
        if (index === -1) return false;

        var removed = project.notes.splice(index, 1)[0];
        if (removed.linkedTaskId) {
            var linkedTask = (project.checklist || []).find(function(item) { return item.id === removed.linkedTaskId; });
            if (linkedTask && linkedTask.sourceNoteId === removed.id) delete linkedTask.sourceNoteId;
        }
        if (!this._persistMutation(projectId, project, snapshot, { notes: project.notes, checklist: project.checklist })) return false;

        EventBus.emit('notes:deleted', { projectId: projectId, noteId: noteId });
        return true;
    },

    updateNote: function(projectId, noteId, updates) {
        var project = StateManager.getProject(projectId);
        if (!project) return null;
        var snapshot = JSON.parse(JSON.stringify(project));

        var note = null;
        if (project.notes) {
            for (var i = 0; i < project.notes.length; i++) {
                if (project.notes[i].id === noteId) {
                    note = project.notes[i];
                    break;
                }
            }
        }
        
        if (!note) return null;

        Object.keys(updates).forEach(function(key) {
            note[key] = updates[key];
        });
        note.updatedAt = new Date().toISOString();

        if (!this._persistMutation(projectId, project, snapshot, { notes: project.notes })) return null;

        EventBus.emit('notes:updated', { projectId: projectId, note: note });
        return note;
    },

    toggleComplete: function(projectId, noteId) {
        var project = StateManager.getProject(projectId);
        if (!project) return;
        var snapshot = JSON.parse(JSON.stringify(project));

        var note = null;
        if (project.notes) {
            for (var i = 0; i < project.notes.length; i++) {
                if (project.notes[i].id === noteId) {
                    note = project.notes[i];
                    break;
                }
            }
        }
        
        if (!note) return;

        note.completed = !note.completed;
        note.completedAt = note.completed ? new Date().toISOString() : null;
        note.updatedAt = new Date().toISOString();

        if (!this._persistMutation(projectId, project, snapshot, { notes: project.notes })) return false;

        EventBus.emit('notes:toggled', { projectId: projectId, note: note });
    },

    togglePin: function(projectId, noteId) {
        var project = StateManager.getProject(projectId);
        if (!project || !project.notes) return false;
        var snapshot = JSON.parse(JSON.stringify(project));
        var note = project.notes.find(function(item) { return item.id === noteId; });
        if (!note) return false;
        note.pinned = !note.pinned;
        note.updatedAt = new Date().toISOString();
        if (!this._persistMutation(projectId, project, snapshot, { notes: project.notes })) return false;
        EventBus.emit('notes:pinned', { projectId: projectId, note: note });
        return note.pinned;
    },

    createTaskFromNote: function(projectId, noteId) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return null;
        var project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.notes) || typeof ChecklistModule === 'undefined') return null;
        var note = project.notes.find(function(item) { return item.id === noteId; });
        if (!note) return null;

        var oldTask = (project.checklist || []).find(function(item) {
            return item.id === note.linkedTaskId && item.sourceNoteId === note.id;
        });
        if (oldTask) return oldTask;

        var title = String(note.title || note.description || 'Задача из заметки').trim().slice(0, 240);
        if (!title) return null;

        var snapshot = JSON.parse(JSON.stringify(project));
        var checklist = Array.isArray(project.checklist) ? project.checklist : [];
        var now = new Date().toISOString();
        var task = {
            id: Helpers.generateId(),
            text: title,
            completed: false,
            createdAt: now,
            completedAt: null,
            order: checklist.length,
            sourceNoteId: note.id
        };

        if (['critical', 'high'].indexOf(note.priority) !== -1) task.priority = 'high';
        else if (note.priority === 'low') task.priority = 'low';

        checklist.push(task);
        project.checklist = checklist;
        project.notes = project.notes;
        note.linkedTaskId = task.id;
        note.updatedAt = now;

        if (typeof ChecklistModule._recalculateProgress === 'function') {
            ChecklistModule._recalculateProgress(project);
        } else {
            var completed = checklist.filter(function(item) { return item.completed; }).length;
            project.progress = checklist.length ? Math.round((completed / checklist.length) * 100) : 0;
        }

        if (!this._persistMutation(projectId, project, snapshot, {
            checklist: project.checklist,
            notes: project.notes,
            progress: project.progress
        })) return null;

        if (typeof ChecklistModule._updateChecklistDOM === 'function') {
            ChecklistModule._updateChecklistDOM(project);
        }
        EventBus.emit('checklist:changed', { projectId: projectId, itemId: task.id });
        EventBus.emit('notes:task-linked', { projectId: projectId, noteId: note.id, taskId: task.id });
        return task;
    },

    getNotes: function(projectId, filter) {
        var project = StateManager.getProject(projectId);
        if (!project || !project.notes) return [];

        filter = filter || {};
        var notes = project.notes.slice();

        if (filter.type) {
            notes = notes.filter(function(n) { return n.type === filter.type; });
        }

        if (filter.priority) {
            notes = notes.filter(function(n) { return n.priority === filter.priority; });
        }

        if (filter.completed !== undefined) {
            notes = notes.filter(function(n) { return n.completed === filter.completed; });
        }

        if (filter.search) {
            var term = String(filter.search).trim().toLowerCase();
            notes = notes.filter(function(n) {
                return String(n.title || '').toLowerCase().indexOf(term) !== -1 ||
                       String(n.description || '').toLowerCase().indexOf(term) !== -1 ||
                       (n.tags || []).some(function(t) { return String(t).toLowerCase().indexOf(term) !== -1; });
            });
        }

        var priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        notes.sort(function(a, b) {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            var sort = filter.sort || 'priority';
            if (sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
            if (sort === 'newest' || sort === 'oldest') {
                var dates = new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
                return sort === 'newest' ? dates : -dates;
            }
            if (a.priority !== b.priority) return (priorityOrder[a.priority] == null ? 9 : priorityOrder[a.priority]) - (priorityOrder[b.priority] == null ? 9 : priorityOrder[b.priority]);
            return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        });

        return notes;
    },

    getStats: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project || !project.notes) {
            return { total: 0, completed: 0, byType: {}, byPriority: {} };
        }

        var stats = {
            total: project.notes.length,
            completed: 0,
            byType: {},
            byPriority: {}
        };

        project.notes.forEach(function(note) {
            if (note.completed) stats.completed++;
            stats.byType[note.type] = (stats.byType[note.type] || 0) + 1;
            stats.byPriority[note.priority] = (stats.byPriority[note.priority] || 0) + 1;
        });

        return stats;
    },

    renderNotes: function(projectId, filter) {
        filter = filter || {};
        var notes = this.getNotes(projectId, filter);
        var stats = this.getStats(projectId);
        var self = this;

        var html = '';

        // Статистика
        html += '<div class="notes-stats">' +
            '<div class="notes-stat-item">' +
                '<span class="notes-stat-count">' + stats.total + '</span>' +
                '<span class="notes-stat-label">Всего</span>' +
            '</div>' +
            '<div class="notes-stat-item">' +
                '<span class="notes-stat-count text-success">' + stats.completed + '</span>' +
                '<span class="notes-stat-label">Выполнено</span>' +
            '</div>' +
            '<div class="notes-stat-item">' +
                '<span class="notes-stat-count text-warning">' + (stats.total - stats.completed) + '</span>' +
                '<span class="notes-stat-label">Осталось</span>' +
            '</div>' +
        '</div>';

        // Фильтры
        html += '<div class="notes-filters" aria-label="Тип заметки">' +
            '<button class="notes-filter-btn ' + (!filter.type ? 'active' : '') + '" data-filter="all" aria-pressed="' + !filter.type + '">Все</button>';
        
        Object.keys(this.types).forEach(function(key) {
            html += '<button class="notes-filter-btn ' + (filter.type === key ? 'active' : '') + '" data-filter="' + key + '" aria-pressed="' + (filter.type === key) + '">' +
                '<i class="bi ' + self.types[key].icon + '"></i> ' + self.types[key].label +
            '</button>';
        });
        
        html += '</div>' +
            '<div class="notes-results" role="status">Показано ' + notes.length + ' из ' + stats.total + '</div>';

        // Список заметок
        html += '<div class="notes-list">';

        if (notes.length === 0) {
            html += '<div class="notes-empty"><i class="bi bi-journal-text"></i><p>' + (stats.total ? 'По выбранным условиям ничего не найдено' : 'Нет заметок') + '</p></div>';
        } else {
            notes.forEach(function(note) {
                var type = self.types[note.type] || self.types.note;
                var priority = self.priorities[note.priority] || self.priorities.medium;
                var linkedTask = (StateManager.getProject(projectId).checklist || []).find(function(task) { return task.id === note.linkedTaskId && task.sourceNoteId === note.id; });

                html += '<div class="note-card ' + (note.completed ? 'note-completed' : '') + (note.pinned ? ' note-pinned' : '') + ' note-priority-' + (self.priorities[note.priority] ? note.priority : 'medium') + '" data-note-id="' + Helpers.escapeHtml(String(note.id)) + '">' +
                    '<div class="note-header">' +
                        ((typeof AuthService === 'undefined' || AuthService.isOwner()) ? '<label class="note-select-label" title="Выбрать заметку"><input class="note-select-input" type="checkbox" aria-label="Выбрать заметку"></label>' : '') +
                        '<div class="note-type-badge" style="background: ' + type.color + '20; color: ' + type.color + '; border-color: ' + type.color + '40;">' +
                            '<i class="bi ' + type.icon + '"></i> ' + type.label +
                        '</div>' +
                        '<div class="note-priority" style="color: ' + priority.color + ';" title="Приоритет: ' + priority.label + '">' +
                            '<i class="bi ' + priority.icon + '"></i>' +
                        '</div>' +
                        '<div class="note-actions">' +
                            '<button class="note-action-btn task-from-note-btn" type="button" title="' + (linkedTask ? 'Открыть связанную задачу' : 'Создать задачу из заметки') + '" aria-label="' + (linkedTask ? 'Открыть связанную задачу' : 'Создать задачу из заметки') + '">' +
                                '<i class="bi ' + (linkedTask ? 'bi-arrow-up-right-square' : 'bi-list-task') + '"></i>' +
                            '</button>' +
                            '<button class="note-action-btn pin-btn" type="button" title="' + (note.pinned ? 'Открепить' : 'Закрепить') + '" aria-label="' + (note.pinned ? 'Открепить заметку' : 'Закрепить заметку') + '" aria-pressed="' + !!note.pinned + '">' +
                                '<i class="bi ' + (note.pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle') + '"></i>' +
                            '</button>' +
                            '<button class="note-action-btn complete-btn" title="Выполнено" aria-label="' + (note.completed ? 'Отметить заметку незавершённой' : 'Отметить заметку выполненной') + '" aria-pressed="' + !!note.completed + '">' +
                                '<i class="bi ' + (note.completed ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
                            '</button>' +
                            '<button class="note-action-btn edit-btn" title="Редактировать" aria-label="Редактировать заметку">' +
                                '<i class="bi bi-pencil"></i>' +
                            '</button>' +
                            '<button class="note-action-btn delete-btn" title="Удалить" aria-label="Удалить заметку">' +
                                '<i class="bi bi-trash"></i>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    (linkedTask ? '<div class="note-linked-task-status ' + (linkedTask.completed ? 'is-done' : 'is-open') + '">' +
                        '<i class="bi ' + (linkedTask.completed ? 'bi-check-circle-fill' : 'bi-hourglass-split') + '" aria-hidden="true"></i>' +
                        '<span>Задача: ' + (linkedTask.completed ? 'выполнена' : 'в работе') + '</span>' +
                        ((typeof AuthService === 'undefined' || AuthService.isOwner()) ? '<button type="button" class="note-linked-task-toggle" aria-label="' + (linkedTask.completed ? 'Возобновить связанную задачу' : 'Завершить связанную задачу') + '">' +
                            (linkedTask.completed ? 'Возобновить' : 'Завершить') + '</button>' : '') +
                    '</div>' : '') +
                    '<h4 class="note-title ' + (note.completed ? 'text-decoration-line-through' : '') + '">' +
                        Helpers.escapeHtml(note.title || 'Без названия') +
                    '</h4>' +
                    (note.description ? '<p class="note-description">' + Helpers.escapeHtml(note.description) + '</p>' : '') +
                    '<div class="note-footer">' +
                        '<div class="note-tags">' +
                            (note.tags || []).map(function(tag) {
                                return '<span class="note-tag">#' + Helpers.escapeHtml(String(tag)) + '</span>';
                            }).join('') +
                        '</div>' +
                        '<span class="note-date">' + Helpers.escapeHtml(Helpers.formatDate(note.createdAt)) + '</span>' +
                    '</div>' +
                '</div>';
            });
        }

        html += '</div>';

        return html;
    },

    renderAddForm: function() {
        var self = this;
        var html = '<div class="note-form">' +
            '<div class="row g-2">' +
                '<div class="col-md-6">' +
                    '<input type="text" class="form-control form-control-sm" ' +
                        'id="noteTitle" placeholder="Что нужно сделать?" autocomplete="off">' +
                '</div>' +
                '<div class="col-md-3">' +
                    '<select class="form-select form-select-sm" id="noteType">';
        
        Object.keys(this.types).forEach(function(key) {
            html += '<option value="' + key + '">' + self.types[key].label + '</option>';
        });
        
        html += '</select>' +
                '</div>' +
                '<div class="col-md-3">' +
                    '<select class="form-select form-select-sm" id="notePriority">';
        
        Object.keys(this.priorities).forEach(function(key) {
            var selected = key === 'medium' ? ' selected' : '';
            html += '<option value="' + key + '"' + selected + '>' + self.priorities[key].label + '</option>';
        });
        
        html += '</select>' +
                '</div>' +
                '<div class="col-12">' +
                    '<textarea class="form-control form-control-sm" id="noteDescription" ' +
                        'rows="2" placeholder="Подробности (необязательно)" autocomplete="off"></textarea>' +
                '</div>' +
                '<div class="col-12">' +
                    '<input type="text" class="form-control form-control-sm" ' +
                        'id="noteTags" placeholder="Теги через запятую (необязательно)" autocomplete="off">' +
                '</div>' +
                '<div class="col-12">' +
                    '<button class="btn btn-gradient btn-sm w-100" id="addNoteBtn">' +
                        '<i class="bi bi-plus-lg me-1"></i>Добавить заметку' +
                    '</button>' +
                '</div>' +
            '</div>' +
        '</div>';

        return html;
    }
};

window.NotesModule = NotesModule;
