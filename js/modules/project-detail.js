/* ============================================
   PROJECT DETAIL MODULE
   Детальная страница проекта
   ============================================ */

var ProjectDetailModule = {
    _currentProjectId: null,

    init: function() {
        this._bindEvents();
        console.log('ProjectDetailModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        EventBus.on('project:open-detail', function(projectId) {
            self.show(projectId);
        });
    },

    show: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project) {
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.error('Проект не найден');
            }
            return;
        }

        this._currentProjectId = projectId;
        sessionStorage.setItem('devspace_detail_project', projectId);
        sessionStorage.setItem('devspace_modal', 'projectDetailModal');

        document.getElementById('detailTitle').innerHTML = 
            '<i class="bi bi-folder2-open me-2 gradient-text"></i>' + 
            Helpers.escapeHtml(project.name);

        document.getElementById('detailBody').innerHTML = this._renderDetail(project);

        this._initDetailChecklist(project);
        this._initDetailUpdates(project);
        this._initDetailNotes(project);

        var modal = new bootstrap.Modal(document.getElementById('projectDetailModal'));
        modal.show();
        
        var modalEl = document.getElementById('projectDetailModal');
        if (modalEl) {
            modalEl.addEventListener('hidden.bs.modal', function() {
                sessionStorage.removeItem('devspace_modal');
                sessionStorage.removeItem('devspace_detail_project');
            }, { once: true });
        }
    },

    _renderDetail: function(project) {
        var statusClass = Helpers.getStatusClass(project.status);
        var statusText = Helpers.getStatusText(project.status);
        var isFavorite = FavoritesModule.isFavorite(project.id);
        var isOwner = typeof AuthService !== 'undefined' ? AuthService.isOwner() : true;

        // Галерея скриншотов
        var galleryHTML = '';
        if (project.screenshots && project.screenshots.length) {
            galleryHTML = '<div class="detail-section">' +
                '<h4><i class="bi bi-images"></i> Скриншоты</h4>' +
                GalleryModule.renderGallery(project.screenshots) +
                (isOwner ? 
                    '<div class="mt-2">' +
                        '<label class="btn btn-sm btn-glass">' +
                            '<i class="bi bi-upload me-1"></i>Добавить скриншоты' +
                            '<input type="file" multiple accept="image/*" class="d-none" ' +
                                'onchange="GalleryModule.addScreenshots(\'' + project.id + '\', this.files)">' +
                        '</label>' +
                    '</div>'
                : '') +
            '</div>';
        } else if (isOwner) {
            galleryHTML = '<div class="detail-section">' +
                '<h4><i class="bi bi-images"></i> Скриншоты</h4>' +
                '<p class="text-muted">Нет скриншотов</p>' +
                '<label class="btn btn-sm btn-glass">' +
                    '<i class="bi bi-upload me-1"></i>Добавить скриншоты' +
                    '<input type="file" multiple accept="image/*" class="d-none" ' +
                        'onchange="GalleryModule.addScreenshots(\'' + project.id + '\', this.files)">' +
                '</label>' +
            '</div>';
        }

        // Полный текст описания
        var fullDescription = project.longDescription || project.description || 'Нет описания';
        var descriptionHTML = '<div class="detail-section">' +
            '<h4><i class="bi bi-info-circle"></i> Описание</h4>' +
            '<div class="detail-description-wrapper">' +
                '<p class="detail-description" data-full="' + Helpers.escapeHtml(fullDescription).replace(/"/g, '&quot;') + '">' +
                    Helpers.escapeHtml(Helpers.truncateText(fullDescription, 250)) +
                '</p>' +
                (fullDescription.length > 250 ? 
                    '<button class="btn-show-more-detail" onclick="ProjectDetailModule._toggleDetailDescription(this)">' +
                        '<i class="bi bi-chevron-down me-1"></i>Показать полностью' +
                    '</button>' : '') +
            '</div>' +
        '</div>';

        // Чек-лист
        var checklist = project.checklist || [];
        var checklistCompleted = checklist.filter(function(i) { return i.completed; }).length;
        var checklistHTML = '<div class="detail-section">' +
            '<h4>' +
                '<i class="bi bi-check2-square"></i> Чек-лист ' +
                '<span class="badge ms-2" style="background: var(--accent-light); color: var(--accent);">' +
                    checklistCompleted + '/' + checklist.length +
                '</span>' +
            '</h4>' +
            '<div class="checklist-container" data-project-id="' + project.id + '">' +
                this._renderChecklist(checklist) +
            '</div>' +
            (isOwner ? 
                '<div class="add-checklist-form mt-3">' +
                    '<input type="text" class="add-checklist-input" id="detailChecklistInput" ' +
                        'placeholder="Новая задача..." autocomplete="off">' +
                    '<button class="add-checklist-btn" onclick="ProjectDetailModule._addChecklistItem(\'' + project.id + '\')">' +
                        '<i class="bi bi-plus"></i> Добавить' +
                    '</button>' +
                '</div>'
            : '') +
        '</div>';

        // Обновления
        var updates = project.updates || [];
        var updatesHTML = '<div class="detail-section">' +
            '<h4><i class="bi bi-journal-text"></i> История обновлений</h4>' +
            '<div class="updates-timeline" id="detailUpdates">' +
                this._renderUpdates(updates) +
            '</div>' +
            (isOwner ? 
                '<div class="add-update-form mt-3">' +
                    '<textarea class="form-control" id="detailUpdateText" rows="2" ' +
                        'placeholder="Описание обновления..." autocomplete="off"></textarea>' +
                    '<div class="d-flex gap-2 mt-2">' +
                        '<input type="text" class="form-control" id="detailUpdateVersion" ' +
                            'placeholder="Версия (1.0.0)" style="max-width: 150px;" autocomplete="off">' +
                        '<button class="btn btn-gradient btn-sm" onclick="ProjectDetailModule._addUpdate(\'' + project.id + '\')">' +
                            '<i class="bi bi-plus-lg me-1"></i>Добавить' +
                        '</button>' +
                    '</div>' +
                '</div>'
            : '') +
        '</div>';

        // Заметки
        var notesCount = project.notes ? project.notes.length : 0;
        var notesHTML = '<div class="detail-section">' +
            '<h4>' +
                '<i class="bi bi-journal-text"></i> Заметки и планы ' +
                '<span class="badge ms-2" style="background: var(--accent-light); color: var(--accent);" id="notesCount">' +
                    notesCount +
                '</span>' +
            '</h4>' +
            (isOwner ? '<div id="notesForm">' + NotesModule.renderAddForm() + '</div>' : '') +
            '<div id="notesContainer">' + NotesModule.renderNotes(project.id) + '</div>' +
        '</div>';

        // Этапы в сайдбаре
        var milestones = project.milestones || [];
        var completedMilestones = project.completedMilestones || [];
        var milestonesHTML = '<div class="sidebar-card">' +
            '<h5><i class="bi bi-flag me-1"></i>Этапы</h5>' +
            '<div class="milestones-list-detail">' +
                (milestones.length > 0 ? 
                    milestones.map(function(m) {
                        var done = completedMilestones.indexOf(m) !== -1;
                        return '<div class="milestone-item ' + (done ? 'done' : '') + '" data-milestone="' + Helpers.escapeHtml(m) + '">' +
                            '<div class="milestone-dot ' + (done ? 'done' : '') + '">' + (done ? '<i class="bi bi-check"></i>' : '') + '</div>' +
                            '<span>' + Helpers.escapeHtml(m) + '</span>' +
                        '</div>';
                    }).join('')
                : '<p class="text-muted small">Нет этапов</p>') +
            '</div>' +
        '</div>';

        // Ссылки
        var linksHTML = '<div class="sidebar-card">' +
            '<h5><i class="bi bi-link-45deg me-1"></i>Ссылки</h5>' +
            '<div class="d-grid gap-2">' +
                (project.github ? '<a href="' + Helpers.escapeHtml(project.github) + '" target="_blank" class="btn btn-glass btn-sm w-100"><i class="bi bi-github me-1"></i>GitHub</a>' : '') +
                (project.supabase ? '<a href="' + Helpers.escapeHtml(project.supabase) + '" target="_blank" class="btn btn-glass btn-sm w-100"><i class="bi bi-database me-1"></i>Supabase</a>' : '') +
                (project.demo ? '<a href="' + Helpers.escapeHtml(project.demo) + '" target="_blank" class="btn btn-glass btn-sm w-100"><i class="bi bi-box-arrow-up-right me-1"></i>Демо</a>' : '') +
                '<button class="btn btn-glass btn-sm w-100" onclick="ShareModule.shareProject(\'' + project.id + '\')"><i class="bi bi-share me-1"></i>Поделиться</button>' +
            '</div>' +
        '</div>';

        // Технологии
        var techHTML = '<div class="sidebar-card">' +
            '<h5><i class="bi bi-tools me-1"></i>Технологии</h5>' +
            '<div class="tech-cloud">' +
                ((project.techStack || []).map(function(tech) {
                    return '<span class="tech-tag">' + Helpers.escapeHtml(tech) + '</span>';
                }).join('') || '<span class="text-muted small">Не указаны</span>') +
            '</div>' +
        '</div>';

        // Информация
        var infoHTML = '<div class="sidebar-card">' +
            '<h5><i class="bi bi-info-circle me-1"></i>Информация</h5>' +
            '<ul class="info-list">' +
                '<li><i class="bi bi-calendar"></i> Создан: ' + Helpers.formatDate(project.createdAt) + '</li>' +
                '<li><i class="bi bi-clock"></i> Обновлён: ' + Helpers.formatDate(project.updatedAt) + '</li>' +
                (project.deadline ? '<li><i class="bi bi-flag"></i> Дедлайн: ' + Helpers.formatDate(project.deadline) + '</li>' : '') +
            '</ul>' +
        '</div>';

        // Экспорт
        var exportHTML = '<div class="sidebar-card">' +
            '<h5><i class="bi bi-download me-1"></i>Экспорт</h5>' +
            '<div class="d-grid gap-2">' +
                '<button class="btn btn-glass btn-sm w-100" onclick="ExportModule.exportToMarkdown(\'' + project.id + '\')"><i class="bi bi-markdown me-1"></i>Markdown</button>' +
                '<button class="btn btn-glass btn-sm w-100" onclick="ExportModule.exportToHTML(\'' + project.id + '\')"><i class="bi bi-filetype-html me-1"></i>HTML</button>' +
                '<button class="btn btn-glass btn-sm w-100" onclick="ExportModule.exportProjectJSON(\'' + project.id + '\')"><i class="bi bi-filetype-json me-1"></i>JSON</button>' +
            '</div>' +
        '</div>';

        // Виджет
        var widgetHTML = '<div class="sidebar-card">' +
            '<h5><i class="bi bi-code-slash me-1"></i>Виджет</h5>' +
            '<button class="btn btn-glass btn-sm w-100" onclick="ShareModule.copyWidgetCode(\'' + project.id + '\')"><i class="bi bi-clipboard me-1"></i>Копировать код</button>' +
        '</div>';

        // Действия
        var actionsHTML = '<div class="sidebar-card">';
        if (isOwner) {
            actionsHTML += '<h5><i class="bi bi-gear me-1"></i>Действия</h5>' +
                '<div class="d-grid gap-2">' +
                    '<button class="btn btn-glass btn-sm w-100" onclick="bootstrap.Modal.getInstance(document.getElementById(\'projectDetailModal\')).hide(); ProjectsModule.openEditModal(\'' + project.id + '\')">' +
                        '<i class="bi bi-pencil me-1"></i>Редактировать' +
                    '</button>' +
                    '<button class="btn btn-glass btn-sm w-100" onclick="ProjectsModule.duplicateProject(\'' + project.id + '\')">' +
                        '<i class="bi bi-copy me-1"></i>Дублировать' +
                    '</button>' +
                    '<button class="btn btn-sm w-100" style="background: var(--color-danger-bg); color: var(--color-danger); border: 1px solid var(--color-danger-border);" ' +
                        'onclick="if(confirm(\'Удалить проект?\')) { bootstrap.Modal.getInstance(document.getElementById(\'projectDetailModal\')).hide(); ProjectsModule.deleteProject(\'' + project.id + '\'); }">' +
                        '<i class="bi bi-trash me-1"></i>Удалить' +
                    '</button>' +
                '</div>';
        } else {
            actionsHTML += '<h5><i class="bi bi-eye me-1"></i>Режим просмотра</h5>' +
                '<p class="text-muted small mb-2">Войдите как владелец для редактирования</p>' +
                '<button class="btn btn-gradient btn-sm w-100" onclick="AuthService._showLoginDialog()">' +
                    '<i class="bi bi-unlock me-1"></i>Войти' +
                '</button>';
        }
        actionsHTML += '</div>';

        return '' +
        '<div class="project-detail">' +
            galleryHTML +
            '<div class="detail-grid">' +
                '<div class="detail-main">' +
                    descriptionHTML +
                    checklistHTML +
                    updatesHTML +
                    notesHTML +
                '</div>' +
                '<div class="detail-sidebar">' +
                    '<div class="sidebar-card">' +
                        '<div class="d-flex justify-content-between align-items-center mb-2">' +
                            '<span class="project-status-badge ' + statusClass + '">' + statusText + '</span>' +
                            '<button class="favorite-btn ' + (isFavorite ? 'active' : '') + '" ' +
                                'onclick="FavoritesModule.toggleFavorite(\'' + project.id + '\'); ProjectDetailModule.show(\'' + project.id + '\');">' +
                                '<i class="bi bi-star' + (isFavorite ? '-fill' : '') + '"></i>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    milestonesHTML +
                    linksHTML +
                    techHTML +
                    infoHTML +
                    exportHTML +
                    widgetHTML +
                    actionsHTML +
                '</div>' +
            '</div>' +
        '</div>';
    },

    // ========== ОПИСАНИЕ: ПОКАЗАТЬ ПОЛНОСТЬЮ ==========

    _toggleDetailDescription: function(btn) {
        var wrapper = btn.closest('.detail-description-wrapper');
        if (!wrapper) return;

        var desc = wrapper.querySelector('.detail-description');
        if (!desc) return;

        var fullText = desc.getAttribute('data-full');
        if (!fullText) return;

        if (!desc.classList.contains('expanded')) {
            desc.textContent = fullText;
            desc.classList.add('expanded');
            btn.innerHTML = '<i class="bi bi-chevron-up me-1"></i>Скрыть';
        } else {
            desc.textContent = fullText.substring(0, 250) + '...';
            desc.classList.remove('expanded');
            btn.innerHTML = '<i class="bi bi-chevron-down me-1"></i>Показать полностью';
        }
    },

    // ========== ЧЕК-ЛИСТ ==========

    _renderChecklist: function(checklist) {
        if (!checklist || checklist.length === 0) {
            return '<div class="checklist-empty"><i class="bi bi-clipboard"></i><p>Нет задач</p></div>';
        }
        var isOwner = typeof AuthService !== 'undefined' ? AuthService.isOwner() : true;
        return checklist.map(function(item) {
            return '<div class="checklist-item ' + (item.completed ? 'completed' : '') + '" data-item-id="' + item.id + '">' +
                '<div class="checklist-checkbox">' + (item.completed ? '<i class="bi bi-check"></i>' : '') + '</div>' +
                '<span class="checklist-text">' + Helpers.escapeHtml(item.text) + '</span>' +
                (isOwner ? '<button class="checklist-delete"><i class="bi bi-x"></i></button>' : '') +
            '</div>';
        }).join('');
    },

    _initDetailChecklist: function(project) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return;
        ChecklistModule._bindChecklistEvents(project.id);
    },

    _addChecklistItem: function(projectId) {
        var input = document.getElementById('detailChecklistInput');
        var text = input ? input.value.trim() : '';
        if (!text) return;
        ChecklistModule.addItem(projectId, text);
        input.value = '';
    },

    // ========== ОБНОВЛЕНИЯ ==========

    _renderUpdates: function(updates) {
        if (!updates || updates.length === 0) {
            return '<div class="text-muted text-center py-3">Нет обновлений</div>';
        }
        return updates.map(function(update) {
            return '<div class="update-timeline-item">' +
                '<div class="d-flex justify-content-between align-items-start">' +
                    '<div>' +
                        (update.version ? '<span class="update-version">v' + update.version + '</span>' : '') +
                        '<p class="mb-1 mt-1">' + Helpers.escapeHtml(update.text) + '</p>' +
                    '</div>' +
                    '<small class="text-muted">' + Helpers.formatDate(update.timestamp) + '</small>' +
                '</div>' +
            '</div>';
        }).join('');
    },

    _initDetailUpdates: function(project) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return;
        var self = this;
        document.querySelectorAll('.update-timeline-item').forEach(function(item, index) {
            item.addEventListener('dblclick', function() {
                var update = project.updates ? project.updates[index] : null;
                if (update && confirm('Удалить это обновление?')) {
                    UpdatesModule.deleteUpdate(project.id, update.id);
                    self.show(project.id);
                }
            });
        });
    },

    _addUpdate: function(projectId) {
        var textEl = document.getElementById('detailUpdateText');
        var versionEl = document.getElementById('detailUpdateVersion');
        var text = textEl ? textEl.value.trim() : '';
        var version = versionEl ? versionEl.value.trim() : '';
        if (!text) {
            if (typeof NotificationModule !== 'undefined') NotificationModule.warning('Введите текст обновления');
            return;
        }
        UpdatesModule.addUpdate(projectId, text, version);
        this.show(projectId);
    },

    // ========== ЗАМЕТКИ ==========

    _initDetailNotes: function(project) {
        var isOwner = typeof AuthService !== 'undefined' ? AuthService.isOwner() : true;
        var self = this;

        if (isOwner) {
            var addBtn = document.getElementById('addNoteBtn');
            if (addBtn) {
                addBtn.addEventListener('click', function() { self._addNote(project.id); });
            }

            ['noteTitle', 'noteDescription', 'noteTags'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) {
                    el.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' && e.ctrlKey) {
                            e.preventDefault();
                            self._addNote(project.id);
                        }
                    });
                }
            });
        }

        document.querySelectorAll('.note-card').forEach(function(card) {
            var noteId = card.dataset.noteId;
            if (isOwner) {
                var completeBtn = card.querySelector('.complete-btn');
                if (completeBtn) {
                    completeBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        NotesModule.toggleComplete(project.id, noteId);
                        self._refreshNotes(project.id);
                    });
                }
                var deleteBtn = card.querySelector('.delete-btn');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (confirm('Удалить заметку?')) {
                            NotesModule.deleteNote(project.id, noteId);
                            self._refreshNotes(project.id);
                        }
                    });
                }
                var editBtn = card.querySelector('.edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self._editNote(project, noteId);
                    });
                }
            }
        });

        document.querySelectorAll('.notes-filter-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.notes-filter-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var filter = btn.dataset.filter;
                var filterObj = filter === 'all' ? {} : { type: filter };
                document.getElementById('notesContainer').innerHTML = NotesModule.renderNotes(project.id, filterObj);
                self._initDetailNotes(project);
            });
        });

        var countEl = document.getElementById('notesCount');
        if (countEl) countEl.textContent = project.notes ? project.notes.length : 0;
    },

    _addNote: function(projectId) {
        var titleEl = document.getElementById('noteTitle');
        var typeEl = document.getElementById('noteType');
        var priorityEl = document.getElementById('notePriority');
        var descEl = document.getElementById('noteDescription');
        var tagsEl = document.getElementById('noteTags');
        var addBtn = document.getElementById('addNoteBtn');
        
        var title = titleEl ? titleEl.value.trim() : '';
        var type = typeEl ? typeEl.value : 'note';
        var priority = priorityEl ? priorityEl.value : 'medium';
        var description = descEl ? descEl.value.trim() : '';
        var tagsStr = tagsEl ? tagsEl.value.trim() : '';
        var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
        var editingId = addBtn ? addBtn.dataset.editingId : '';

        if (editingId) {
            NotesModule.updateNote(projectId, editingId, {
                title: title || 'Без названия',
                type: type,
                priority: priority,
                description: description,
                tags: tags
            });
            if (addBtn) {
                addBtn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Добавить заметку';
                addBtn.classList.remove('editing');
                delete addBtn.dataset.editingId;
            }
        } else {
            if (!title && !description) {
                if (typeof NotificationModule !== 'undefined') NotificationModule.warning('Введите заголовок или описание');
                return;
            }
            NotesModule.addNote(projectId, {
                title: title || 'Без названия',
                type: type,
                priority: priority,
                description: description,
                tags: tags
            });
        }

        if (titleEl) titleEl.value = '';
        if (descEl) descEl.value = '';
        if (tagsEl) tagsEl.value = '';
        this._refreshNotes(projectId);
    },

    _editNote: function(project, noteId) {
        var note = null;
        if (project.notes) {
            for (var i = 0; i < project.notes.length; i++) {
                if (project.notes[i].id === noteId) { note = project.notes[i]; break; }
            }
        }
        if (!note) return;

        var titleEl = document.getElementById('noteTitle');
        var descEl = document.getElementById('noteDescription');
        var typeEl = document.getElementById('noteType');
        var priorityEl = document.getElementById('notePriority');
        var tagsEl = document.getElementById('noteTags');
        var addBtn = document.getElementById('addNoteBtn');

        if (titleEl) titleEl.value = note.title || '';
        if (descEl) descEl.value = note.description || '';
        if (typeEl) typeEl.value = note.type || 'note';
        if (priorityEl) priorityEl.value = note.priority || 'medium';
        if (tagsEl) tagsEl.value = (note.tags || []).join(', ');

        if (addBtn) {
            addBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Сохранить изменения';
            addBtn.classList.add('editing');
            addBtn.dataset.editingId = noteId;
        }

        var formEl = document.getElementById('notesForm');
        if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
    },

    _refreshNotes: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project) return;
        document.getElementById('notesContainer').innerHTML = NotesModule.renderNotes(projectId);
        this._initDetailNotes(project);
        var countEl = document.getElementById('notesCount');
        if (countEl) countEl.textContent = project.notes ? project.notes.length : 0;
    }
};

window.ProjectDetailModule = ProjectDetailModule;