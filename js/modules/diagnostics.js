/* ============================================
   WORKSPACE DIAGNOSTICS
   Read-only inspection of local workspace data.
   ============================================ */

var DiagnosticsModule = {
    _lastReport: null,

    init: function() {
        var self = this;
        var runButton = document.getElementById('workspaceDiagnosticsRun');
        var downloadButton = document.getElementById('workspaceDiagnosticsDownload');
        if (runButton && !runButton.dataset.bound) {
            runButton.dataset.bound = 'true';
            runButton.addEventListener('click', function() { self.run(); });
        }
        if (downloadButton && !downloadButton.dataset.bound) {
            downloadButton.dataset.bound = 'true';
            downloadButton.addEventListener('click', function() { self.downloadReport(); });
        }
    },

    _issue: function(issues, severity, code, title, detail, recommendation) {
        issues.push({
            severity: severity,
            code: code,
            title: title,
            detail: detail || '',
            recommendation: recommendation || ''
        });
    },

    analyze: function(snapshot) {
        snapshot = snapshot || {};
        var issues = [];
        var projects = snapshot.projects;
        var storageEntries = Array.isArray(snapshot.storageEntries) ? snapshot.storageEntries : [];
        var projectIds = new Set();
        var projectIdSet = new Set();
        var projectCount = Array.isArray(projects) ? projects.length : 0;
        var taskCount = 0;
        var noteCount = 0;

        if (snapshot.storageError) {
            this._issue(issues, 'error', 'storage-unavailable', 'Локальное хранилище недоступно',
                snapshot.storageError, 'Проверьте настройки приватности браузера и доступность хранилища для сайта.');
        }

        storageEntries.forEach(function(entry) {
            if (entry && entry.parseError) {
                var critical = entry.key === 'projects';
                this._issue(issues, critical ? 'error' : 'warning', 'invalid-json',
                    critical ? 'Не удалось прочитать проекты' : 'Повреждена запись хранилища',
                    'Ключ «' + entry.key + '» содержит некорректный JSON.',
                    critical
                        ? 'Не создавайте новые проекты и не очищайте данные. Сначала скачайте исходные данные хранилища или используйте резервную копию.'
                        : 'Сохраните резервную копию и проверьте соответствующий раздел перед восстановлением.');
            }
        }, this);

        if (snapshot.projectsReadable === false) {
            this._issue(issues, 'error', 'projects-unreadable', 'Список проектов не загружен',
                'StateManager сообщил об ошибке чтения. Текущие данные не изменялись диагностикой.',
                'Не перезаписывайте список проектов. Сначала сохраните доступные резервные копии.');
        } else if (!Array.isArray(projects)) {
            this._issue(issues, 'error', 'projects-shape', 'Некорректный список проектов',
                'Ожидался массив проектов, но получено другое значение.',
                'Сохраните резервную копию и проверьте возможность восстановления.');
        } else {
            projects.forEach(function(project, projectIndex) {
                var label = project && typeof project.name === 'string' && project.name.trim()
                    ? project.name.trim() : 'Проект №' + (projectIndex + 1);
                if (!project || typeof project !== 'object' || Array.isArray(project)) {
                    this._issue(issues, 'error', 'project-shape', 'Некорректная запись проекта',
                        'Элемент №' + (projectIndex + 1) + ' не является объектом.',
                        'Не удаляйте запись вручную. Сначала создайте резервную копию.');
                    return;
                }
                if (typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(project.id)) {
                    this._issue(issues, 'error', 'project-id-invalid', 'Некорректный ID проекта',
                        'У «' + label + '» отсутствует корректный идентификатор.',
                        'Исправление потребует отдельной операции после сохранения резервной копии.');
                } else if (projectIds.has(project.id)) {
                    this._issue(issues, 'error', 'project-id-duplicate', 'Повторяющийся ID проекта',
                        'ID «' + project.id + '» встречается более одного раза.',
                        'Не объединяйте записи автоматически: сначала сравните их содержимое.');
                } else {
                    projectIds.add(project.id);
                    projectIdSet.add(project.id);
                }
                if (typeof project.name !== 'string' || !project.name.trim() || project.name.length > 200) {
                    this._issue(issues, 'warning', 'project-name-invalid', 'Проблема с названием проекта',
                        'У записи «' + label + '» пустое или слишком длинное название.',
                        'Проверьте название в карточке проекта.');
                }

                ['checklist', 'notes', 'tags', 'updates'].forEach(function(field) {
                    if (project[field] !== undefined && !Array.isArray(project[field])) {
                        this._issue(issues, 'error', 'project-section-shape',
                            'Некорректный раздел проекта',
                            'В проекте «' + label + '» поле «' + field + '» должно быть массивом.',
                            'Сохраните резервную копию до любых изменений.');
                    }
                }, this);

                var taskIds = new Set();
                var tasks = Array.isArray(project.checklist) ? project.checklist : [];
                tasks.forEach(function(task, taskIndex) {
                    taskCount++;
                    if (!task || typeof task !== 'object' || Array.isArray(task)) {
                        this._issue(issues, 'error', 'task-shape', 'Некорректная задача',
                            'В проекте «' + label + '» задача №' + (taskIndex + 1) + ' не является объектом.',
                            'Проверьте задачу перед восстановлением.');
                        return;
                    }
                    if (typeof task.id !== 'string' || !task.id.trim()) {
                        this._issue(issues, 'error', 'task-id-missing', 'У задачи отсутствует ID',
                            'В проекте «' + label + '» найдена задача без идентификатора.',
                            'Не удаляйте задачу автоматически: она может содержать историю действий.');
                    } else if (taskIds.has(task.id)) {
                        this._issue(issues, 'error', 'task-id-duplicate', 'Повторяющийся ID задачи',
                            'В проекте «' + label + '» ID задачи «' + task.id + '» встречается несколько раз.',
                            'Сравните связанные заметки и историю задачи перед исправлением.');
                    } else {
                        taskIds.add(task.id);
                    }
                    if (typeof task.text !== 'string' || !task.text.trim()) {
                        this._issue(issues, 'warning', 'task-text-empty', 'У задачи нет текста',
                            'В проекте «' + label + '» найдена задача с пустым названием.',
                            'Проверьте задачу в чек-листе проекта.');
                    }
                }, this);

                var noteIds = new Set();
                var notes = Array.isArray(project.notes) ? project.notes : [];
                notes.forEach(function(note, noteIndex) {
                    noteCount++;
                    if (!note || typeof note !== 'object' || Array.isArray(note)) {
                        this._issue(issues, 'error', 'note-shape', 'Некорректная заметка',
                            'В проекте «' + label + '» заметка №' + (noteIndex + 1) + ' не является объектом.',
                            'Проверьте заметку перед восстановлением.');
                        return;
                    }
                    if (typeof note.id !== 'string' || !note.id.trim()) {
                        this._issue(issues, 'error', 'note-id-missing', 'У заметки отсутствует ID',
                            'В проекте «' + label + '» найдена заметка без идентификатора.',
                            'Сохраните резервную копию и проверьте заметку вручную.');
                    } else if (noteIds.has(note.id)) {
                        this._issue(issues, 'error', 'note-id-duplicate', 'Повторяющийся ID заметки',
                            'В проекте «' + label + '» ID заметки «' + note.id + '» встречается несколько раз.',
                            'Сравните содержимое заметок перед исправлением.');
                    } else {
                        noteIds.add(note.id);
                    }
                }, this);

                tasks.forEach(function(task) {
                    if (!task || typeof task !== 'object' || !task.sourceNoteId) return;
                    var linkedNote = notes.find(function(note) {
                        return note && note.id === task.sourceNoteId && note.linkedTaskId === task.id;
                    });
                    if (!linkedNote) {
                        this._issue(issues, 'warning', 'task-note-link-dangling', 'Потеряна связь задачи с заметкой',
                            'В проекте «' + label + '» задача «' + (task.text || task.id) + '» ссылается на отсутствующую или не связанную заметку.',
                            'Проверьте обе записи; диагностика не меняет связи.');
                    }
                }, this);
                notes.forEach(function(note) {
                    if (!note || typeof note !== 'object' || !note.linkedTaskId) return;
                    var linkedTask = tasks.find(function(task) {
                        return task && task.id === note.linkedTaskId && task.sourceNoteId === note.id;
                    });
                    if (!linkedTask) {
                        this._issue(issues, 'warning', 'note-task-link-dangling', 'Потеряна обратная связь заметки',
                            'В проекте «' + label + '» заметка «' + (note.title || note.id) + '» ссылается на отсутствующую или не связанную задачу.',
                            'Проверьте обе записи; диагностика не меняет связи.');
                    }
                }, this);
            }, this);
        }

        var trash = snapshot.trash;
        if (snapshot.trashReadable === false) {
            this._issue(issues, 'error', 'trash-unreadable', 'Корзина не читается',
                'Сохранённый раздел удалённых проектов повреждён или недоступен.',
                'Не очищайте корзину; сначала сохраните исходные данные и резервную копию.');
        } else if (trash !== undefined && !Array.isArray(trash)) {
            this._issue(issues, 'error', 'trash-shape', 'Некорректная структура корзины',
                'Ожидался массив архивных записей.',
                'Не очищайте корзину; проверьте резервные копии.');
        } else if (Array.isArray(trash)) {
            var archiveIds = new Set();
            trash.forEach(function(entry, index) {
                if (!entry || typeof entry !== 'object' || !entry.project || typeof entry.id !== 'string') {
                    this._issue(issues, 'warning', 'trash-entry-invalid', 'Некорректная запись корзины',
                        'Архивная запись №' + (index + 1) + ' имеет неполную структуру.',
                        'Сохраните копию корзины перед восстановлением или очисткой.');
                    return;
                }
                if (archiveIds.has(entry.id)) {
                    this._issue(issues, 'warning', 'trash-id-duplicate', 'Повторяющаяся запись корзины',
                        'ID архивной записи «' + entry.id + '» встречается несколько раз.',
                        'Проверьте архивные записи вручную.');
                }
                archiveIds.add(entry.id);
                if (entry.project.id && projectIdSet.has(entry.project.id)) {
                    this._issue(issues, 'warning', 'trash-project-active', 'Проект одновременно в рабочем списке и корзине',
                        'Архивная копия «' + (entry.project.name || entry.project.id) + '» имеет ID активного проекта.',
                        'Сравните обе версии; не удаляйте ни одну автоматически.');
                }
                if (!entry.deletedAt || !Number.isFinite(Date.parse(entry.deletedAt))) {
                    this._issue(issues, 'warning', 'trash-date-invalid', 'Некорректная дата удаления',
                        'У записи корзины «' + entry.id + '» отсутствует корректная дата.',
                        'Проверьте запись перед окончательным удалением.');
                }
            }, this);
        }

        var favorites = snapshot.favorites;
        if (Array.isArray(favorites)) {
            favorites.forEach(function(id) {
                if (typeof id === 'string' && !projectIdSet.has(id)) {
                    this._issue(issues, 'warning', 'favorite-orphan', 'Избранное ссылается на отсутствующий проект',
                        'ID «' + id + '» отсутствует среди активных проектов.',
                        'Проверьте, не находится ли проект в корзине, прежде чем удалять его из избранного.');
                }
            }, this);
        } else if (favorites !== undefined) {
            this._issue(issues, 'warning', 'favorites-shape', 'Некорректная структура избранного',
                'Ожидался массив ID проектов.',
                'Проверьте избранное после создания резервной копии.');
        }

        var backups = Array.isArray(snapshot.autoBackups) ? snapshot.autoBackups : [];
        var validBackups = 0;
        backups.forEach(function(record) {
            var intact = record && snapshot.backupValidator && snapshot.backupValidator(record.data);
            if (intact) validBackups++;
            else this._issue(issues, 'warning', 'backup-corrupt', 'Автоматический снимок повреждён',
                'Одна из локальных резервных копий не прошла проверку контрольной суммы.',
                'Не восстанавливайте этот снимок. Используйте другую проверенную копию.');
        }, this);

        var errors = issues.filter(function(item) { return item.severity === 'error'; }).length;
        var warnings = issues.filter(function(item) { return item.severity === 'warning'; }).length;
        return {
            generatedAt: new Date().toISOString(),
            readOnly: true,
            summary: {
                status: errors ? 'error' : warnings ? 'warning' : 'healthy',
                projects: projectCount,
                tasks: taskCount,
                notes: noteCount,
                storageKeys: storageEntries.length,
                autoBackups: backups.length,
                validBackups: validBackups,
                errors: errors,
                warnings: warnings,
                info: issues.length - errors - warnings
            },
            issues: issues
        };
    },

    _collectSnapshot: function() {
        var entries = [];
        var storageError = null;
        var projectsSnapshot = null;
        var trashSnapshot = null;
        var favoritesSnapshot = null;
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var fullKey = localStorage.key(i);
                if (!fullKey || fullKey.indexOf('devspace_') !== 0) continue;
                var key = fullKey.slice('devspace_'.length);
                var raw = localStorage.getItem(fullKey);
                var entry = { key: key, raw: raw, value: null, parseError: false };
                try { entry.value = raw === null ? null : JSON.parse(raw); }
                catch (error) { entry.parseError = true; }
                entries.push(entry);
                if (key === 'projects') projectsSnapshot = entry;
                if (key === 'deletedProjects') trashSnapshot = entry;
                if (key === 'favorites') favoritesSnapshot = entry;
            }
        } catch (error) {
            storageError = error && error.message ? error.message : 'Ошибка чтения localStorage';
        }

        var projectsReadable = !(typeof StateManager !== 'undefined' && StateManager._projectsLoadError);
        var projects = projectsSnapshot && !projectsSnapshot.parseError ? projectsSnapshot.value
            : (projectsReadable && typeof StateManager !== 'undefined' ? StateManager.get('projects') : null);
        var trashReadable = !trashSnapshot || !trashSnapshot.parseError;
        var snapshot = {
            storageEntries: entries,
            storageError: storageError,
            projects: projects,
            projectsReadable: projectsReadable && !(projectsSnapshot && projectsSnapshot.parseError),
            trash: trashSnapshot && !trashSnapshot.parseError ? trashSnapshot.value : undefined,
            trashReadable: trashReadable,
            favorites: favoritesSnapshot && !favoritesSnapshot.parseError ? favoritesSnapshot.value : undefined
        };

        return snapshot;
    },

    run: function() {
        var self = this;
        var status = document.getElementById('workspaceDiagnosticsStatus');
        var results = document.getElementById('workspaceDiagnosticsResults');
        var download = document.getElementById('workspaceDiagnosticsDownload');
        if (status) status.textContent = 'Проверяем локальные данные…';
        if (results) results.textContent = '';

        var snapshot = this._collectSnapshot();
        var backupPromise = typeof ExportModule !== 'undefined' && ExportModule._readAutoBackups
            ? ExportModule._readAutoBackups().catch(function(error) {
                snapshot.backupError = error && error.message ? error.message : 'IndexedDB недоступен';
                return [];
            })
            : Promise.resolve([]);
        return backupPromise.then(function(backups) {
            snapshot.autoBackups = backups;
            snapshot.backupValidator = typeof ExportModule !== 'undefined' && ExportModule._isBackupIntact
                ? ExportModule._isBackupIntact.bind(ExportModule) : function() { return false; };
            self._lastReport = self.analyze(snapshot);
            if (snapshot.backupError) {
                self._issue(self._lastReport.issues, 'warning', 'backup-vault-unavailable',
                    'Автоматические снимки недоступны', snapshot.backupError,
                    'Проверьте поддержку IndexedDB и настройки хранения сайта.');
                self._lastReport.summary.warnings++;
                if (self._lastReport.summary.status === 'healthy') self._lastReport.summary.status = 'warning';
            }
            self.render(self._lastReport);
            if (download) download.disabled = false;
            return self._lastReport;
        });
    },

    render: function(report) {
        var status = document.getElementById('workspaceDiagnosticsStatus');
        var results = document.getElementById('workspaceDiagnosticsResults');
        if (!status || !results) return;
        var summary = report.summary;
        var statusText = summary.status === 'error' ? 'Найдены проблемы, требующие внимания'
            : summary.status === 'warning' ? 'Есть замечания — проверьте список'
            : 'Критичных проблем не обнаружено';
        status.textContent = statusText + ' · ' + summary.errors + ' ошибок · ' + summary.warnings + ' предупреждений';
        status.setAttribute('data-tone', summary.status === 'error' ? 'danger' : summary.status === 'warning' ? 'warning' : 'success');
        results.textContent = '';

        var overview = document.createElement('p');
        overview.className = 'small text-muted mb-2';
        overview.textContent = summary.projects + ' проектов · ' + summary.tasks + ' задач · ' +
            summary.notes + ' заметок · ' + summary.storageKeys + ' записей хранилища · ' +
            summary.validBackups + '/' + summary.autoBackups + ' проверенных снимков';
        results.appendChild(overview);

        if (!report.issues.length) {
            var clean = document.createElement('p');
            clean.className = 'small mb-0';
            clean.textContent = 'Структура проектов, задач, заметок и локальных разделов выглядит корректно.';
            results.appendChild(clean);
            return;
        }
        report.issues.forEach(function(issue) {
            var item = document.createElement('div');
            item.className = 'workspace-diagnostic-issue';
            item.setAttribute('data-severity', issue.severity);
            var heading = document.createElement('strong');
            heading.textContent = (issue.severity === 'error' ? 'Ошибка' : issue.severity === 'warning' ? 'Предупреждение' : 'Информация') + ' · ' + issue.title;
            var detail = document.createElement('p');
            detail.className = 'small mb-1';
            detail.textContent = issue.detail;
            item.appendChild(heading);
            item.appendChild(detail);
            if (issue.recommendation) {
                var recommendation = document.createElement('p');
                recommendation.className = 'small text-muted mb-0';
                recommendation.textContent = 'Рекомендация: ' + issue.recommendation;
                item.appendChild(recommendation);
            }
            results.appendChild(item);
        });
    },

    downloadReport: function() {
        if (!this._lastReport) return false;
        if (typeof Helpers === 'undefined' || typeof Helpers.downloadFile !== 'function') return false;
        var filename = 'devspace-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json';
        Helpers.downloadFile(JSON.stringify(this._lastReport, null, 2), filename, 'application/json;charset=utf-8');
        if (typeof NotificationModule !== 'undefined') NotificationModule.success('Отчёт диагностики скачан');
        return true;
    }
};

window.DiagnosticsModule = DiagnosticsModule;
