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

    addNote: function(projectId, data) {
        var project = StateManager.getProject(projectId);
        if (!project) return null;

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
        StateManager.updateProject(projectId, { notes: project.notes });
        StateManager.saveProjects();

        EventBus.emit('notes:added', { projectId: projectId, note: note });
        
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.success('Заметка добавлена');
        }

        return note;
    },

    deleteNote: function(projectId, noteId) {
        var project = StateManager.getProject(projectId);
        if (!project) return false;

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

        project.notes.splice(index, 1);
        StateManager.updateProject(projectId, { notes: project.notes });
        StateManager.saveProjects();

        EventBus.emit('notes:deleted', { projectId: projectId, noteId: noteId });
        return true;
    },

    updateNote: function(projectId, noteId, updates) {
        var project = StateManager.getProject(projectId);
        if (!project) return null;

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

        StateManager.updateProject(projectId, { notes: project.notes });
        StateManager.saveProjects();

        EventBus.emit('notes:updated', { projectId: projectId, note: note });
        return note;
    },

    toggleComplete: function(projectId, noteId) {
        var project = StateManager.getProject(projectId);
        if (!project) return;

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

        StateManager.updateProject(projectId, { notes: project.notes });
        StateManager.saveProjects();

        EventBus.emit('notes:toggled', { projectId: projectId, note: note });
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
            var term = filter.search.toLowerCase();
            notes = notes.filter(function(n) {
                return n.title.toLowerCase().indexOf(term) !== -1 ||
                       n.description.toLowerCase().indexOf(term) !== -1 ||
                       (n.tags || []).some(function(t) { return t.toLowerCase().indexOf(term) !== -1; });
            });
        }

        var priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        notes.sort(function(a, b) {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority];
            return new Date(b.updatedAt) - new Date(a.updatedAt);
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
        html += '<div class="notes-filters">' +
            '<button class="notes-filter-btn active" data-filter="all">Все</button>';
        
        Object.keys(this.types).forEach(function(key) {
            html += '<button class="notes-filter-btn" data-filter="' + key + '">' +
                '<i class="bi ' + self.types[key].icon + '"></i> ' + self.types[key].label +
            '</button>';
        });
        
        html += '</div>';

        // Список заметок
        html += '<div class="notes-list">';

        if (notes.length === 0) {
            html += '<div class="notes-empty"><i class="bi bi-journal-text"></i><p>Нет заметок</p></div>';
        } else {
            notes.forEach(function(note) {
                var type = self.types[note.type] || self.types.note;
                var priority = self.priorities[note.priority] || self.priorities.medium;

                html += '<div class="note-card ' + (note.completed ? 'note-completed' : '') + ' note-priority-' + note.priority + '" data-note-id="' + note.id + '">' +
                    '<div class="note-header">' +
                        '<div class="note-type-badge" style="background: ' + type.color + '20; color: ' + type.color + '; border-color: ' + type.color + '40;">' +
                            '<i class="bi ' + type.icon + '"></i> ' + type.label +
                        '</div>' +
                        '<div class="note-priority" style="color: ' + priority.color + ';" title="Приоритет: ' + priority.label + '">' +
                            '<i class="bi ' + priority.icon + '"></i>' +
                        '</div>' +
                        '<div class="note-actions">' +
                            '<button class="note-action-btn complete-btn" title="Выполнено">' +
                                '<i class="bi ' + (note.completed ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
                            '</button>' +
                            '<button class="note-action-btn edit-btn" title="Редактировать">' +
                                '<i class="bi bi-pencil"></i>' +
                            '</button>' +
                            '<button class="note-action-btn delete-btn" title="Удалить">' +
                                '<i class="bi bi-trash"></i>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<h4 class="note-title ' + (note.completed ? 'text-decoration-line-through' : '') + '">' +
                        (note.title || 'Без названия') +
                    '</h4>' +
                    (note.description ? '<p class="note-description">' + note.description + '</p>' : '') +
                    '<div class="note-footer">' +
                        '<div class="note-tags">' +
                            (note.tags || []).map(function(tag) {
                                return '<span class="note-tag">#' + tag + '</span>';
                            }).join('') +
                        '</div>' +
                        '<span class="note-date">' + Helpers.formatDate(note.createdAt) + '</span>' +
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