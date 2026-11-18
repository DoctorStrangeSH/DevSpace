/* ============================================
   PROJECT DETAIL MODULE
   Детальная страница проекта
   ============================================ */

var ProjectDetailModule = {
    _currentProjectId: null,
    _notesFilter: null,

    init: function() {
        this._bindEvents();
        console.log('ProjectDetailModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        EventBus.on('project:open-detail', function(projectId) {
            self.show(projectId);
        });
        EventBus.on('checklist:changed', function(data) {
            if (data && String(data.projectId) === String(self._currentProjectId)) self._refreshRoadmap(data.projectId);
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
        this._notesFilter = { search: '', priority: '', completed: '', type: '', sort: 'priority' };
        sessionStorage.setItem('devspace_detail_project', projectId);
        sessionStorage.setItem('devspace_modal', 'projectDetailModal');

        document.getElementById('detailTitle').innerHTML = 
            '<i class="bi bi-folder2-open me-2 gradient-text"></i>' + 
            Helpers.escapeHtml(project.name);

        document.getElementById('detailBody').innerHTML = this._renderDetail(project);

        this._initDetailChecklist(project);
        this._initRoadmap(project.id);
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

        // Дорожная карта из уже существующих этапов проекта.
        var roadmapHTML = '<div class="detail-section" id="projectRoadmapSection">' +
            '<h4><i class="bi bi-signpost-split"></i> Дорожная карта</h4>' +
            '<div id="roadmapBody">' + this._renderRoadmap(project) + '</div>' +
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
            '<div class="notes-search-toolbar" role="search" aria-label="Поиск и фильтрация заметок">' +
                '<label class="visually-hidden" for="notesSearch">Поиск по заметкам</label>' +
                '<input id="notesSearch" type="search" class="form-control" placeholder="Поиск по названию, тексту и тегам" autocomplete="off">' +
                '<label class="visually-hidden" for="notesPriorityFilter">Приоритет заметок</label>' +
                '<select id="notesPriorityFilter" class="form-select" aria-label="Приоритет заметок">' +
                    '<option value="">Все приоритеты</option><option value="critical">Критичный</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option>' +
                '</select>' +
                '<label class="visually-hidden" for="notesStatusFilter">Статус заметок</label>' +
                '<select id="notesStatusFilter" class="form-select" aria-label="Статус заметок">' +
                    '<option value="">Все статусы</option><option value="open">Не завершены</option><option value="done">Выполнены</option>' +
                '</select>' +
                '<label class="visually-hidden" for="notesSort">Сортировка заметок</label>' +
                '<select id="notesSort" class="form-select" aria-label="Сортировка заметок">' +
                    '<option value="priority">По приоритету</option><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="title">По названию</option>' +
                '</select>' +
                (isOwner ? '<button id="notesCompleteVisible" class="btn btn-glass btn-sm" type="button" title="Отметить найденные заметки выполненными"><i class="bi bi-check2-all me-1"></i>Завершить найденные</button>' : '') +
            '</div>' +
            '<div id="notesContainer">' + NotesModule.renderNotes(project.id) + '</div>' +
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
                '<p class="text-muted small mb-2">Включите локальный режим для редактирования в этом браузере</p>' +
                '<button class="btn btn-gradient btn-sm w-100" onclick="AuthService._showLoginDialog()">' +
                    '<i class="bi bi-pencil me-1"></i>Редактировать локально' +
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
                    roadmapHTML +
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

    _renderRoadmap: function(project) {
        var stages = Array.isArray(project.milestones) ? project.milestones.filter(function(name) { return typeof name === 'string' && name.trim(); }) : [];
        var owner = typeof AuthService === 'undefined' || AuthService.isOwner();
        var createForm = owner ? '<form class="roadmap-create" data-roadmap-create><input name="stage" type="text" maxlength="100" required placeholder="Название нового этапа" aria-label="Название нового этапа"><button type="submit">+ Добавить этап</button></form>' : '';
        if (!stages.length) return '<p class="text-muted small">Пока нет этапов дорожной карты.</p>' + createForm;
        var tasks = Array.isArray(project.checklist) ? project.checklist : [];
        var completedStages = Array.isArray(project.completedMilestones) ? project.completedMilestones : [];
        var deadlines = project.milestoneDeadlines && typeof project.milestoneDeadlines === 'object' && !Array.isArray(project.milestoneDeadlines) ? project.milestoneDeadlines : {};
        var today = new Date();
        var todayLocal = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
        var escape = function(text) { return Helpers.escapeHtml(String(text)).replace(/"/g, '&quot;'); };
        var stagePercent = function(stage) {
            var linked = tasks.filter(function(task) { return task.milestone === stage; });
            if (linked.length) return Math.round(linked.filter(function(task) { return task.completed; }).length / linked.length * 100);
            return completedStages.indexOf(stage) !== -1 ? 100 : 0;
        };
        var overall = Math.round(stages.reduce(function(sum, stage) { return sum + stagePercent(stage); }, 0) / stages.length);
        return '<div class="roadmap-summary"><div><strong>Общий прогресс</strong><span>' + overall + '% · ' + stages.length + ' этапов</span></div><div class="roadmap-progress" role="progressbar" aria-label="Общий прогресс дорожной карты" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + overall + '"><span style="width:' + overall + '%"></span></div></div>' +
        '<div class="roadmap-list">' + stages.map(function(stage, index) {
            var linked = tasks.filter(function(task) { return task.milestone === stage; });
            var done = linked.length ? linked.filter(function(task) { return task.completed; }).length : (completedStages.indexOf(stage) !== -1 ? 1 : 0);
            var percent = stagePercent(stage);
            var status = percent === 100 ? 'Готово' : done > 0 ? 'В процессе' : 'Запланировано';
            var deadline = Object.hasOwn(deadlines, stage) && /^\d{4}-\d{2}-\d{2}$/.test(deadlines[stage]) ? deadlines[stage] : '';
            var overdue = !!deadline && deadline < todayLocal && percent < 100;
            return '<article class="roadmap-stage' + (overdue ? ' roadmap-overdue' : '') + '"><header><span class="roadmap-stage-number">' + (index + 1) + '</span><strong>' + Helpers.escapeHtml(stage) + '</strong><span class="roadmap-stage-status">' + (overdue ? 'Просрочено' : status) + '</span><span class="roadmap-stage-percent">' + percent + '%</span></header>' +
                '<div class="roadmap-progress"><span style="width:' + percent + '%"></span></div>' +
                (deadline && !owner ? '<p class="roadmap-deadline">Срок: ' + deadline.slice(8, 10) + '.' + deadline.slice(5, 7) + '.' + deadline.slice(0, 4) + '</p>' : '') +
                (owner ? '<label class="roadmap-deadline">Срок этапа <input type="date" data-roadmap-deadline="' + escape(stage) + '" value="' + escape(deadline) + '" aria-label="Срок этапа ' + escape(stage) + '"></label>' : '') +
                (linked.length ? '<ul>' + linked.map(function(task) { return '<li>' + (task.completed ? '✅ ' : '◯ ') + Helpers.escapeHtml(task.text || '') + '</li>'; }).join('') + '</ul>' : '<p class="roadmap-empty">Задачи пока не привязаны</p>') +
                (owner ? '<form class="roadmap-inline-form" data-roadmap-task-create="' + escape(stage) + '"><input name="task" maxlength="240" required placeholder="Новая задача для этапа" aria-label="Новая задача для этапа ' + escape(stage) + '"><button type="submit">+ Задача</button></form>' : '') +
                (owner ? '<form class="roadmap-inline-form roadmap-rename" data-roadmap-rename="' + escape(stage) + '"><input name="name" maxlength="100" required value="' + escape(stage) + '" aria-label="Переименовать этап ' + escape(stage) + '"><button type="submit">Сохранить название</button></form>' : '') +
                (owner ? '<div class="roadmap-stage-actions"><button type="button" data-roadmap-move="up" data-roadmap-index="' + index + '" aria-label="Переместить этап вверх"' + (index === 0 ? ' disabled' : '') + '>↑</button><button type="button" data-roadmap-move="down" data-roadmap-index="' + index + '" aria-label="Переместить этап вниз"' + (index === stages.length - 1 ? ' disabled' : '') + '>↓</button><button type="button" class="roadmap-remove" data-roadmap-remove="' + escape(stage) + '" aria-label="Удалить этап ' + escape(stage) + '">Удалить этап</button></div>' : '') +
                (owner && !linked.length ? '<button type="button" class="roadmap-stage-toggle" data-roadmap-stage="' + escape(stage) + '">' + (percent === 100 ? 'Вернуть в работу' : 'Отметить этап завершённым') + '</button>' : '') +
                '</article>';
        }).join('') + '</div>' + createForm +
        (owner && tasks.length ? '<div class="roadmap-assign"><h5>Привязать задачи к этапам</h5>' + tasks.map(function(task) {
            if (task.id == null) return '';
            return '<label><span>' + Helpers.escapeHtml(task.text || 'Задача') + '</span><select data-roadmap-task="' + escape(task.id) + '" aria-label="Этап задачи: ' + escape(task.text || 'Задача') + '"><option value="">Без этапа</option>' + stages.map(function(stage) {
                return '<option value="' + escape(stage) + '"' + (task.milestone === stage ? ' selected' : '') + '>' + Helpers.escapeHtml(stage) + '</option>';
            }).join('') + '</select></label>';
        }).join('') + '</div>' : '');
    },

    _refreshRoadmap: function(projectId) {
        var body = document.getElementById('roadmapBody');
        var project = StateManager.getProject(projectId);
        if (body && project) body.innerHTML = this._renderRoadmap(project);
    },

    addRoadmapStage: function(projectId, value) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        var stage = typeof value === 'string' ? value.trim() : '';
        if (!project || !stage || stage.length > 100) return false;
        var stages = Array.isArray(project.milestones) ? project.milestones.slice() : [];
        if (stages.length >= 60 || stages.some(function(item) { return String(item).toLocaleLowerCase() === stage.toLocaleLowerCase(); })) return false;
        stages.push(stage);
        StateManager.updateProject(projectId, { milestones: stages });
        this._refreshRoadmap(projectId);
        return true;
    },

    moveRoadmapStage: function(projectId, index, direction) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        var stages = project && Array.isArray(project.milestones) ? project.milestones.slice() : [];
        var next = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : -1;
        if (!Number.isInteger(index) || index < 0 || next < 0 || next >= stages.length) return false;
        var item = stages[index];
        stages[index] = stages[next];
        stages[next] = item;
        StateManager.updateProject(projectId, { milestones: stages });
        this._refreshRoadmap(projectId);
        return true;
    },

    renameRoadmapStage: function(projectId, oldName, value) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        var name = typeof value === 'string' ? value.trim() : '';
        var stages = project && Array.isArray(project.milestones) ? project.milestones.slice() : [];
        var index = stages.indexOf(oldName);
        if (index === -1 || !name || name.length > 100 || stages.some(function(stage, i) {
            return i !== index && String(stage).toLocaleLowerCase() === name.toLocaleLowerCase();
        })) return false;
        if (name === oldName) return true;
        stages[index] = name;
        var checklist = (project.checklist || []).map(function(task) {
            return task.milestone === oldName ? Object.assign({}, task, { milestone: name }) : task;
        });
        var completed = (project.completedMilestones || []).map(function(stage) { return stage === oldName ? name : stage; });
        var deadlines = Object.assign(Object.create(null), project.milestoneDeadlines || {});
        if (Object.hasOwn(deadlines, oldName)) {
            deadlines[name] = deadlines[oldName];
            delete deadlines[oldName];
        }
        StateManager.updateProject(projectId, { milestones: stages, checklist: checklist, completedMilestones: completed, milestoneDeadlines: deadlines });
        this._refreshRoadmap(projectId);
        return true;
    },

    removeRoadmapStage: function(projectId, stage) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.milestones) || project.milestones.indexOf(stage) === -1) return false;
        var milestones = project.milestones.filter(function(name) { return name !== stage; });
        var checklist = (project.checklist || []).map(function(task) {
            if (task.milestone !== stage) return task;
            var copy = Object.assign({}, task);
            delete copy.milestone;
            return copy;
        });
        var completed = (project.completedMilestones || []).filter(function(name) { return name !== stage; });
        var deadlines = Object.assign(Object.create(null), project.milestoneDeadlines || {});
        delete deadlines[stage];
        StateManager.updateProject(projectId, { milestones: milestones, checklist: checklist, completedMilestones: completed, milestoneDeadlines: deadlines });
        this._refreshRoadmap(projectId);
        return true;
    },

    addRoadmapTask: function(projectId, stage, value) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        var name = typeof value === 'string' ? value.trim() : '';
        if (!project || !Array.isArray(project.milestones) || project.milestones.indexOf(stage) < 0 || !name || name.length > 240 || typeof ChecklistModule === 'undefined') return false;
        var task = ChecklistModule.addItem(projectId, name);
        if (!task || task.id == null) return false;
        return this.assignTaskStage(projectId, task.id, stage);
    },

    setRoadmapDeadline: function(projectId, stage, value) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.milestones) || project.milestones.indexOf(stage) === -1) return false;
        if (typeof value !== 'string' || (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))) return false;
        var deadlines = Object.assign(Object.create(null), project.milestoneDeadlines || {});
        if (value) deadlines[stage] = value;
        else delete deadlines[stage];
        StateManager.updateProject(projectId, { milestoneDeadlines: deadlines });
        this._refreshRoadmap(projectId);
        return true;
    },

    assignTaskStage: function(projectId, taskId, milestone) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        if (!project || (milestone && (!Array.isArray(project.milestones) || project.milestones.indexOf(milestone) === -1))) return false;
        var task = (project.checklist || []).find(function(item) { return String(item.id) === String(taskId); });
        if (!task) return false;
        if (milestone) task.milestone = milestone;
        else delete task.milestone;
        StateManager.updateProject(projectId, { checklist: project.checklist });
        this._refreshRoadmap(projectId);
        return true;
    },

    toggleRoadmapStage: function(projectId, stage) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        var project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.milestones) || project.milestones.indexOf(stage) === -1) return false;
        if ((project.checklist || []).some(function(task) { return task.milestone === stage; })) return false;
        var done = Array.isArray(project.completedMilestones) ? project.completedMilestones.slice() : [];
        if (done.indexOf(stage) !== -1) done = done.filter(function(item) { return item !== stage; });
        else done.push(stage);
        StateManager.updateProject(projectId, { completedMilestones: done });
        this._refreshRoadmap(projectId);
        return true;
    },

    _initRoadmap: function(projectId) {
        var section = document.getElementById('projectRoadmapSection');
        if (!section) return;
        var self = this;
        section.addEventListener('submit', function(event) {
            var form = event.target;
            if (!form.matches('[data-roadmap-create], [data-roadmap-rename], [data-roadmap-task-create]')) return;
            event.preventDefault();
            var create = form.matches('[data-roadmap-create]');
            var rename = form.matches('[data-roadmap-rename]');
            var input = form.querySelector(create ? '[name="stage"]' : rename ? '[name="name"]' : '[name="task"]');
            if (!input) return;
            var success = create ? self.addRoadmapStage(projectId, input.value) : rename ? self.renameRoadmapStage(projectId, form.dataset.roadmapRename, input.value) : self.addRoadmapTask(projectId, form.dataset.roadmapTaskCreate, input.value);
            if (!success && typeof NotificationModule !== 'undefined') NotificationModule.error('Не удалось сохранить. Проверь название и повтори попытку');
        });
        section.addEventListener('change', function(event) {
            var deadline = event.target.closest('[data-roadmap-deadline]');
            if (deadline) {
                if (!self.setRoadmapDeadline(projectId, deadline.dataset.roadmapDeadline, deadline.value) && typeof NotificationModule !== 'undefined') NotificationModule.error('Некорректная дата этапа');
                return;
            }
            var control = event.target.closest('[data-roadmap-task]');
            if (control) self.assignTaskStage(projectId, control.dataset.roadmapTask, control.value);
        });
        section.addEventListener('click', function(event) {
            var remove = event.target.closest('[data-roadmap-remove]');
            if (remove) {
                var stage = remove.dataset.roadmapRemove;
                if (confirm('Удалить этап «' + stage + '»? Задачи останутся в общем чек-листе.')) self.removeRoadmapStage(projectId, stage);
                return;
            }
            var move = event.target.closest('[data-roadmap-move]');
            if (move) { self.moveRoadmapStage(projectId, Number(move.dataset.roadmapIndex), move.dataset.roadmapMove); return; }
            var control = event.target.closest('[data-roadmap-stage]');
            if (control) self.toggleRoadmapStage(projectId, control.dataset.roadmapStage);
        });
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
                (isOwner ? '<button class="checklist-delete" aria-label="Удалить задачу" title="Удалить задачу"><i class="bi bi-x"></i></button>' : '') +
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
            if (addBtn && !addBtn.dataset.notesBound) {
                addBtn.dataset.notesBound = 'true';
                addBtn.addEventListener('click', function() { self._addNote(project.id); });
            }

            ['noteTitle', 'noteDescription', 'noteTags'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el && !el.dataset.notesBound) {
                    el.dataset.notesBound = 'true';
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
                var pinBtn = card.querySelector('.pin-btn');
                if (pinBtn) {
                    pinBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        NotesModule.togglePin(project.id, noteId);
                        self._refreshNotes(project.id);
                    });
                }
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
                var filter = btn.dataset.filter;
                self._notesFilter.type = filter === 'all' ? '' : filter;
                self._refreshNotes(project.id);
            });
        });

        var search = document.getElementById('notesSearch');
        if (search && !search.dataset.notesBound) {
            search.dataset.notesBound = 'true';
            search.addEventListener('input', function() {
                self._notesFilter.search = search.value;
                self._refreshNotes(project.id);
            });
        }
        [['notesPriorityFilter', 'priority'], ['notesStatusFilter', 'completed'], ['notesSort', 'sort']].forEach(function(pair) {
            var select = document.getElementById(pair[0]);
            if (select && !select.dataset.notesBound) {
                select.dataset.notesBound = 'true';
                select.addEventListener('change', function() {
                    self._notesFilter[pair[1]] = select.value;
                    self._refreshNotes(project.id);
                });
            }
        });
        var bulkBtn = document.getElementById('notesCompleteVisible');
        if (bulkBtn && !bulkBtn.dataset.notesBound) {
            bulkBtn.dataset.notesBound = 'true';
            bulkBtn.addEventListener('click', function() { self._completeVisibleNotes(project.id); });
        }
        if (bulkBtn) {
            var pending = NotesModule.getNotes(project.id, this._getNotesFilter()).filter(function(n) { return !n.completed; });
            bulkBtn.disabled = pending.length === 0;
            bulkBtn.title = pending.length ? 'Завершить найденные: ' + pending.length : 'Нет незавершённых заметок в результатах';
        }

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
        document.getElementById('notesContainer').innerHTML = NotesModule.renderNotes(projectId, this._getNotesFilter());
        this._initDetailNotes(project);
        var countEl = document.getElementById('notesCount');
        if (countEl) countEl.textContent = project.notes ? project.notes.length : 0;
    },

    _getNotesFilter: function() {
        var current = this._notesFilter || {};
        var filter = {};
        if (current.type) filter.type = current.type;
        if (current.priority) filter.priority = current.priority;
        if (current.search) filter.search = current.search;
        if (current.sort) filter.sort = current.sort;
        if (current.completed === 'done') filter.completed = true;
        if (current.completed === 'open') filter.completed = false;
        return filter;
    },

    _completeVisibleNotes: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project || (typeof AuthService !== 'undefined' && !AuthService.isOwner())) return;
        var pending = NotesModule.getNotes(projectId, this._getNotesFilter()).filter(function(note) { return !note.completed; });
        if (!pending.length || !confirm('Отметить выполненными ' + pending.length + ' найденных заметок?')) return;
        var ids = new Set(pending.map(function(note) { return note.id; }));
        var timestamp = new Date().toISOString();
        project.notes.forEach(function(note) {
            if (ids.has(note.id)) {
                note.completed = true;
                note.completedAt = timestamp;
                note.updatedAt = timestamp;
            }
        });
        StateManager.updateProject(projectId, { notes: project.notes });
        StateManager.saveProjects();
        EventBus.emit('notes:bulk-completed', { projectId: projectId, count: pending.length });
        if (typeof NotificationModule !== 'undefined') NotificationModule.success('Завершено заметок: ' + pending.length);
        this._refreshNotes(projectId);
    }
};

window.ProjectDetailModule = ProjectDetailModule;
