/* ============================================
   EXPORT MODULE (обновлённый)
   ============================================ */

var ExportModule = {
    init: function() {
        this._bindEvents();
        console.log('ExportModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        var historyExport = document.getElementById('healthExportBtn');
        if (historyExport) historyExport.addEventListener('click', function() { self.exportHealthHistory(); });
        var historyImport = document.getElementById('healthImportBtn');
        if (historyImport) historyImport.addEventListener('click', function() { self._triggerHealthImport(); });
        
        // Кнопки в футере
        var exportBtn = document.getElementById('footerExportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                self.exportAllProjects();
            });
        }
        var tasksExportBtn = document.getElementById('footerTasksExportBtn');
        if (tasksExportBtn) tasksExportBtn.addEventListener('click', function() { self.exportTasksCsv(); });
        
        var importBtn = document.getElementById('footerImportBtn');
        if (importBtn) {
            importBtn.addEventListener('click', function() {
                self._triggerImport();
            });
        }
        
        var backupBtn = document.getElementById('footerBackupBtn');
        if (backupBtn) {
            backupBtn.addEventListener('click', function() {
                self.openBackupCenter();
            });
        }
        var centerCreate = document.getElementById('backupCenterCreateBtn');
        if (centerCreate) centerCreate.addEventListener('click', function() { self.createBackup(); });
        var centerFile = document.getElementById('backupCenterFile');
        if (centerFile) centerFile.addEventListener('change', function() { self._previewSelectedBackup(); });
        var centerRestore = document.getElementById('backupCenterRestoreBtn');
        if (centerRestore) centerRestore.addEventListener('click', function() {
            var file = centerFile && centerFile.files && centerFile.files[0];
            if (!file) return;
            self._importFile(file, self._getRestoreOptions());
        });
        var trashList = document.getElementById('backupTrashList');
        if (trashList) trashList.addEventListener('click', function(event) {
            var button = event.target && event.target.closest
                ? event.target.closest('button[data-trash-action]')
                : null;
            if (!button || !trashList.contains(button)) return;
            var archiveId = button.getAttribute('data-archive-id');
            var action = button.getAttribute('data-trash-action');
            if (!archiveId) return;
            if (action === 'restore') {
                if (StateManager.restoreDeletedProject(archiveId)) {
                    if (typeof NotificationModule !== 'undefined') NotificationModule.success('Проект восстановлен в мастерской');
                    if (typeof RendererModule !== 'undefined') {
                        RendererModule.renderProjects();
                        RendererModule.renderStats();
                    }
                } else if (typeof NotificationModule !== 'undefined') {
                    NotificationModule.error('Не удалось восстановить проект. Проверьте, нет ли проекта с таким ID.');
                }
            } else if (action === 'purge' && confirm('Удалить архивную копию навсегда? Это действие нельзя отменить.')) {
                if (StateManager.permanentlyDeleteArchivedProject(archiveId)) {
                    if (typeof NotificationModule !== 'undefined') NotificationModule.success('Архивная копия удалена');
                } else if (typeof NotificationModule !== 'undefined') {
                    NotificationModule.error('Не удалось удалить архивную копию');
                }
            }
            self.renderDeletedProjects();
        });

        // GitHub импорт
        var githubBtn = document.getElementById('importGithubBtn');
        if (githubBtn) {
            githubBtn.addEventListener('click', function() {
                self._showGithubImport();
            });
        }
    },

    _cleanHealthHistory: function(rows) {
        if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Некорректная история');
        var valid = {};
        rows.forEach(function(row) {
            if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.scores || typeof row.scores !== 'object' || Array.isArray(row.scores)) return;
            var day = Date.parse(row.date + 'T00:00:00Z');
            if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== row.date || day > Date.now() + 86400000) return;
            var scores = {};
            Object.keys(row.scores).slice(0, 500).forEach(function(id) {
                var value = row.scores[id];
                if (id !== '__proto__' && id.length <= 150 && Number.isInteger(value) && value >= 0 && value <= 100) scores[id] = value;
            });
            valid[row.date] = Object.assign({}, valid[row.date] || {}, scores);
        });
        return Object.keys(valid).sort().slice(-30).map(function(date) { return { date: date, scores: valid[date] }; });
    },

    _validateImportedHealthHistory: function(rows) {
        if (!Array.isArray(rows) || rows.length > 1000) {
            throw new Error('Некорректная история в бэкапе');
        }
        var seenDates = new Set();
        var totalScores = 0;
        return rows.map(function(row) {
            if (!row || typeof row !== 'object' || Array.isArray(row) ||
                Object.keys(row).some(function(key) { return key !== 'date' && key !== 'scores'; }) ||
                typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
                !row.scores || typeof row.scores !== 'object' || Array.isArray(row.scores)) {
                throw new Error('В бэкапе найдена некорректная запись истории');
            }
            var day = Date.parse(row.date + 'T00:00:00Z');
            if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== row.date ||
                day > Date.now() + 86400000 || seenDates.has(row.date)) {
                throw new Error('В бэкапе найдена некорректная или повторная дата истории');
            }
            seenDates.add(row.date);
            var ids = Object.keys(row.scores);
            totalScores += ids.length;
            if (ids.length > 500 || totalScores > 50000) {
                throw new Error('История в бэкапе слишком большая');
            }
            var scores = {};
            ids.forEach(function(id) {
                var value = row.scores[id];
                if (!id || id.length > 150 || id === '__proto__' || id === 'constructor' ||
                    id === 'prototype' || !Number.isInteger(value) || value < 0 || value > 100) {
                    throw new Error('В бэкапе найдена некорректная оценка');
                }
                scores[id] = value;
            });
            return { date: row.date, scores: scores };
        });
    },

    _mergeHealthHistory: function(existing, incoming) {
        var merged = {};
        this._cleanHealthHistory(incoming).forEach(function(row) { merged[row.date] = row.scores; });
        this._cleanHealthHistory(existing).forEach(function(row) { merged[row.date] = Object.assign({}, merged[row.date] || {}, row.scores); });
        return this._cleanHealthHistory(Object.keys(merged).map(function(date) { return { date: date, scores: merged[date] }; }));
    },

    exportHealthHistory: function() {
        var history = this._cleanHealthHistory(StorageService.get('healthHistory', []));
        Helpers.downloadFile(JSON.stringify({ format: 'devspace-health-history', version: 1, history: history }, null, 2), 'devspace-health-' + new Date().toISOString().slice(0, 10) + '.json');
        if (typeof NotificationModule !== 'undefined') NotificationModule.success('История оценок скачана');
    },

    _triggerHealthImport: function() {
        var self = this;
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function() {
            var file = input.files && input.files[0];
            if (!file) return;
            if (file.size > 1024 * 1024) { if (typeof NotificationModule !== 'undefined') NotificationModule.error('Файл истории слишком большой'); return; }
            Helpers.readFile(file).then(function(contents) {
                var data = JSON.parse(contents);
                if (!data || data.format !== 'devspace-health-history' || data.version !== 1 || !Array.isArray(data.history)) throw new Error('Неверный формат истории');
                var importedHistory = self._validateImportedHealthHistory(data.history);
                var history = self._mergeHealthHistory(StorageService.get('healthHistory', []), importedHistory);
                if (!StorageService.set('healthHistory', history)) throw new Error('Не удалось сохранить историю');
                if (typeof RendererModule !== 'undefined') RendererModule._renderInsights();
                if (typeof NotificationModule !== 'undefined') NotificationModule.success('История перенесена: ' + history.length + ' дней');
            }).catch(function() { if (typeof NotificationModule !== 'undefined') NotificationModule.error('Не удалось прочитать историю'); });
        };
        input.click();
    },

    exportAllProjects: function() {
        var projects = StateManager.get('projects') || [];
        var data = JSON.stringify(projects, null, 2);
        var filename = 'devspace-projects-' + new Date().toISOString().split('T')[0] + '.json';
        Helpers.downloadFile(data, filename);
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.success(projects.length + ' проектов экспортировано');
        }
    },

    _csvCell: function(value) {
        var text = String(value == null ? '' : value);
        // Spreadsheet programs may interpret imported text as executable formulas.
        if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    },

    _tasksCsv: function(projects) {
        var self = this;
        var rows = [['Проект', 'Статус проекта', 'Задача', 'Статус задачи', 'Приоритет', 'Срок']];
        (projects || []).forEach(function(project) {
            (Array.isArray(project.checklist) ? project.checklist : []).forEach(function(task) {
                if (!task || typeof task.text !== 'string') return;
                rows.push([
                    project.name || '', project.status || '', task.text,
                    task.completed ? 'Выполнена' : 'Открыта',
                    ['high', 'normal', 'low'].includes(task.priority) ? task.priority : 'normal',
                    /^\d{4}-\d{2}-\d{2}$/.test(task.deadline || '') ? task.deadline : ''
                ]);
            });
        });
        return { count: rows.length - 1, csv: '\uFEFF' + rows.map(function(row) { return row.map(self._csvCell).join(';'); }).join('\r\n') + '\r\n' };
    },

    exportTasksCsv: function() {
        var result = this._tasksCsv(StateManager.get('projects') || []);
        Helpers.downloadFile(result.csv, 'devspace-tasks-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv;charset=utf-8');
        if (typeof NotificationModule !== 'undefined') NotificationModule.success('Экспортировано задач: ' + result.count);
    },

    openBackupCenter: function() {
        var modalElement = document.getElementById('backupCenterModal');
        if (!modalElement || typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            this.createBackup();
            return;
        }
        var file = document.getElementById('backupCenterFile');
        var preview = document.getElementById('backupCenterPreview');
        var restore = document.getElementById('backupCenterRestoreBtn');
        if (file) file.value = '';
        if (preview) preview.textContent = 'Выберите JSON-файл, чтобы проверить его содержимое перед восстановлением.';
        if (restore) restore.disabled = true;
        this.renderDeletedProjects();
        bootstrap.Modal.getOrCreateInstance(modalElement).show();
    },

    renderDeletedProjects: function() {
        var container = document.getElementById('backupTrashList');
        if (!container || typeof StateManager === 'undefined' || !StateManager.getDeletedProjects) return;
        container.textContent = '';
        var entries = StateManager.getDeletedProjects();
        if (!entries.length) {
            var empty = document.createElement('p');
            empty.className = 'small text-muted mb-0';
            empty.textContent = 'Корзина пуста. Удалённые проекты будут храниться здесь до 30 дней.';
            container.appendChild(empty);
            return;
        }
        entries.forEach(function(entry) {
            var item = document.createElement('div');
            item.className = 'backup-trash-item';
            var info = document.createElement('div');
            info.className = 'backup-trash-info';
            var title = document.createElement('strong');
            title.textContent = entry.project && entry.project.name ? entry.project.name : 'Без названия';
            var date = document.createElement('span');
            date.className = 'small text-muted';
            var parsed = new Date(entry.deletedAt);
            date.textContent = 'Удалён: ' + (Number.isNaN(parsed.getTime()) ? 'дата неизвестна' : parsed.toLocaleString('ru-RU'));
            info.appendChild(title);
            info.appendChild(date);
            var actions = document.createElement('div');
            actions.className = 'backup-trash-actions';
            var restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'btn btn-sm btn-gradient';
            restore.textContent = 'Восстановить';
            restore.setAttribute('data-trash-action', 'restore');
            restore.setAttribute('data-archive-id', entry.id);
            var purge = document.createElement('button');
            purge.type = 'button';
            purge.className = 'btn btn-sm btn-glass';
            purge.textContent = 'Удалить навсегда';
            purge.setAttribute('data-trash-action', 'purge');
            purge.setAttribute('data-archive-id', entry.id);
            actions.appendChild(restore);
            actions.appendChild(purge);
            item.appendChild(info);
            item.appendChild(actions);
            container.appendChild(item);
        });
    },

    _getRestoreOptions: function() {
        var options = { projects: true };
        ['theme', 'favorites', 'achievements', 'settings', 'activity', 'healthHistory'].forEach(function(key) {
            var input = document.getElementById('backupRestore_' + key);
            options[key] = !!(input && input.checked);
        });
        return options;
    },

    _backupPreviewRequestId: 0,

    _previewSelectedBackup: function() {
        var requestId = ++this._backupPreviewRequestId;
        var input = document.getElementById('backupCenterFile');
        var preview = document.getElementById('backupCenterPreview');
        var restore = document.getElementById('backupCenterRestoreBtn');
        var file = input && input.files && input.files[0];
        if (restore) restore.disabled = true;
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            if (preview) preview.textContent = 'Файл превышает ограничение 5 МБ.';
            return;
        }
        var self = this;
        Helpers.readFile(file).then(function(text) {
            var data = JSON.parse(text);
            if (!data || typeof data !== 'object') throw new Error('Неподдерживаемый формат резервной копии');
            if (!Array.isArray(data) && data.format !== undefined && data.format !== 'devspace-backup') throw new Error('Неизвестный формат резервной копии');
            if (!Array.isArray(data) && data.schemaVersion !== undefined && (!Number.isInteger(data.schemaVersion) || data.schemaVersion !== 1)) {
                throw new Error('Эта версия резервной копии не поддерживается');
            }
            if (!Array.isArray(data) && data.integrity !== undefined) {
                var copy = Object.assign({}, data);
                delete copy.integrity;
                if (!data.integrity || data.integrity.algorithm !== 'fnv1a32' ||
                    typeof data.integrity.checksum !== 'string' || !/^[a-f0-9]{8}$/.test(data.integrity.checksum) ||
                    self._backupChecksum(copy) !== data.integrity.checksum) {
                    throw new Error('Контрольная сумма не совпадает: файл повреждён');
                }
            }
            var projects = self._validateBackupProjects(Array.isArray(data) ? data : data.projects);
            var summary = self._buildBackupPreview(data, projects);
            var sectionLabels = {
                theme: 'тема', favorites: 'избранное', achievements: 'достижения',
                settings: 'настройки', activity: 'журнал активности', healthHistory: 'история оценок'
            };
            var sections = summary.sections.length
                ? summary.sections.map(function(key) { return sectionLabels[key] || key; }).join(', ')
                : 'нет дополнительных разделов';
            if (requestId !== self._backupPreviewRequestId) return;
            if (preview) preview.textContent = [
                'Файл проверен. Проектов: ' + summary.projects,
                'Задач: ' + summary.tasks + ' · Заметок: ' + summary.notes,
                'Разделы: ' + sections,
                'Версия: ' + summary.version,
                'Дата: ' + (summary.timestamp || 'не указана'),
                data.integrity ? 'Контрольная сумма совпадает.' : 'Старая копия без контрольной суммы.'
            ].join('\\n');
            if (restore) restore.disabled = false;
        }).catch(function(error) {
            if (requestId !== self._backupPreviewRequestId) return;
            if (preview) preview.textContent = 'Не удалось проверить файл: ' + error.message;
            if (restore) restore.disabled = true;
        });
    },

    _backupChecksum: function(value) {
        var serialized = JSON.stringify(value);
        var hash = 2166136261;
        for (var i = 0; i < serialized.length; i++) {
            hash ^= serialized.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
    },

    _buildBackupPreview: function(data, projects) {
        var taskCount = 0;
        var noteCount = 0;
        projects.forEach(function(project) {
            taskCount += Array.isArray(project.checklist) ? project.checklist.length : 0;
            noteCount += Array.isArray(project.notes) ? project.notes.length : 0;
        });
        return {
            projects: projects.length,
            tasks: taskCount,
            notes: noteCount,
            sections: ['theme', 'favorites', 'achievements', 'settings', 'activity', 'healthHistory']
                .filter(function(key) { return Object.prototype.hasOwnProperty.call(data, key); }),
            version: typeof data.version === 'string' ? data.version : 'Старая версия',
            timestamp: typeof data.timestamp === 'string' ? data.timestamp : null
        };
    },

    createBackup: function() {
        try {
            var rawProjects = StateManager.get('projects') || [];
            var data = {
                format: 'devspace-backup',
                schemaVersion: 1,
                projects: this._validateBackupProjects(rawProjects),
                theme: StateManager.get('theme') || 'dark',
                favorites: this._validateBackupMetadata(
                    typeof FavoritesModule !== 'undefined' ? (FavoritesModule.favorites || []) : [],
                    true, 5000, 'избранное'
                ),
                achievements: this._validateBackupMetadata(
                    typeof AchievementsModule !== 'undefined' ? (AchievementsModule.unlocked || []) : [],
                    true, 5000, 'достижения'
                ),
                settings: this._validateBackupMetadata(
                    StorageService.get(StorageService.KEYS.SETTINGS, {}) || {},
                    false, 500, 'настройки'
                ),
                activity: this._validateBackupMetadata(
                    StorageService.get(StorageService.KEYS.ACTIVITY, []) || [],
                    true, 10000, 'активность'
                ),
                healthHistory: this._validateImportedHealthHistory(
                    this._cleanHealthHistory(StorageService.get('healthHistory', []))
                ),
                version: typeof App !== 'undefined' && App.config ? App.config.version : null,
                timestamp: new Date().toISOString()
            };

            if (!['dark', 'light'].includes(data.theme)) {
                throw new Error('Тема приложения содержит некорректное значение');
            }

            data.integrity = {
                algorithm: 'fnv1a32',
                checksum: this._backupChecksum(data)
            };
            var json = JSON.stringify(data, null, 2);
            if (!json || json.length > 5 * 1024 * 1024) {
                throw new Error('Резервная копия превышает 5 МБ и не сможет быть импортирована');
            }

            var filename = 'devspace-backup-' + new Date().toISOString().split('T')[0] + '.json';
            Helpers.downloadFile(json, filename);
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.success('Бэкап создан');
            }
            return true;
        } catch (error) {
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.error('Не удалось создать резервную копию: ' + error.message);
            }
            return false;
        }
    },

    _validateBackupProjects: function(projects) {
        if (!Array.isArray(projects) || projects.length > 1000) {
            throw new Error('Некорректный список проектов в бэкапе');
        }
        var serialized;
        try { serialized = JSON.stringify(projects); } catch (error) {
            throw new Error('Бэкап содержит неподдерживаемые данные');
        }
        if (!serialized || serialized.length > 5 * 1024 * 1024) {
            throw new Error('Размер данных проектов превышает 5 МБ');
        }
        var parsed = JSON.parse(serialized);
        var seen = new Set();
        var stack = [{ value: parsed, depth: 0 }];
        var nodes = 0;
        while (stack.length) {
            var current = stack.pop();
            if (++nodes > 50000 || current.depth > 40) throw new Error('Слишком сложная структура данных в бэкапе');
            var value = current.value;
            if (!value || typeof value !== 'object') continue;
            Object.keys(value).forEach(function(key) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                    throw new Error('Бэкап содержит небезопасные поля');
                }
                stack.push({ value: value[key], depth: current.depth + 1 });
            });
        }
        parsed.forEach(function(project) {
            if (!project || typeof project !== 'object' || Array.isArray(project) ||
                typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(project.id) ||
                typeof project.name !== 'string' || !project.name.trim() || project.name.length > 200) {
                throw new Error('В бэкапе найден некорректный проект');
            }
            if (seen.has(project.id)) throw new Error('В бэкапе есть повторяющиеся ID проектов');
            seen.add(project.id);
        });
        return parsed;
    },

    _validateBackupMetadata: function(value, expectArray, maxEntries, label) {
        var validShape = expectArray ? Array.isArray(value) : value && typeof value === 'object' && !Array.isArray(value);
        if (!validShape || Object.keys(value).length > maxEntries) {
            throw new Error('Некорректные данные раздела «' + label + '» в бэкапе');
        }
        var serialized;
        try { serialized = JSON.stringify(value); } catch (error) {
            throw new Error('Не удалось проверить раздел «' + label + '»');
        }
        if (!serialized || serialized.length > 1024 * 1024) {
            throw new Error('Раздел «' + label + '» слишком большой');
        }
        var parsed = JSON.parse(serialized);
        var stack = [{ value: parsed, depth: 0 }];
        var nodes = 0;
        while (stack.length) {
            var current = stack.pop();
            if (++nodes > 20000 || current.depth > 30) {
                throw new Error('Слишком сложные данные раздела «' + label + '»');
            }
            if (!current.value || typeof current.value !== 'object') continue;
            Object.keys(current.value).forEach(function(key) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                    throw new Error('Раздел «' + label + '» содержит небезопасные поля');
                }
                stack.push({ value: current.value[key], depth: current.depth + 1 });
            });
        }
        return parsed;
    },

    _triggerImport: function() {
        var self = this;
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (file && file.size > 5 * 1024 * 1024) {
                if (typeof NotificationModule !== 'undefined') NotificationModule.error('Файл слишком большой (максимум 5 МБ)');
                return;
            }
            if (file) self._importFile(file);
        };
        input.click();
    },

    _importFile: function(file, restoreOptions) {
        var self = this;
        Helpers.readFile(file)
            .then(function(text) {
                var data = JSON.parse(text);
                var selected = restoreOptions || {
                    projects: true, theme: true, favorites: true, achievements: true,
                    settings: true, activity: true, healthHistory: true
                };

                if (data && !Array.isArray(data) && typeof data === 'object') {
                    if (data.format !== undefined && data.format !== 'devspace-backup') {
                        throw new Error('Неизвестный формат резервной копии');
                    }
                    if (data.schemaVersion !== undefined &&
                        (!Number.isInteger(data.schemaVersion) || data.schemaVersion !== 1)) {
                        throw new Error('Эта версия резервной копии не поддерживается. Обновите DevSpace.');
                    }
                    if (data.integrity !== undefined) {
                        if (!data.integrity || data.integrity.algorithm !== 'fnv1a32' ||
                            typeof data.integrity.checksum !== 'string' ||
                            !/^[a-f0-9]{8}$/.test(data.integrity.checksum)) {
                            throw new Error('Некорректная контрольная сумма резервной копии');
                        }
                        var integrityCopy = Object.assign({}, data);
                        delete integrityCopy.integrity;
                        if (self._backupChecksum(integrityCopy) !== data.integrity.checksum) {
                            throw new Error('Резервная копия повреждена: контрольная сумма не совпадает. Исходные данные не изменены.');
                        }
                    }
                }

                // Validate and clone all imported project records before touching user data.
                var projects;
                if (Array.isArray(data)) {
                    projects = data;
                } else if (data && Array.isArray(data.projects)) {
                    projects = data.projects;
                } else {
                    throw new Error('Неверный формат');
                }
                projects = self._validateBackupProjects(projects);

                var importedFavorites = selected.favorites && data && data.favorites !== undefined
                    ? self._validateBackupMetadata(data.favorites, true, 5000, 'избранное') : undefined;
                var importedAchievements = selected.achievements && data && data.achievements !== undefined
                    ? self._validateBackupMetadata(data.achievements, true, 5000, 'достижения') : undefined;
                [importedFavorites, importedAchievements].forEach(function(items) {
                    if (items === undefined) return;
                    var seenItems = new Set();
                    items.forEach(function(item) {
                        if (typeof item !== 'string' || !item.trim() || item.length > 150 || seenItems.has(item)) {
                            throw new Error('Некорректный элемент списка в бэкапе');
                        }
                        seenItems.add(item);
                    });
                });
                var importedSettings = selected.settings && data && data.settings !== undefined
                    ? self._validateBackupMetadata(data.settings, false, 500, 'настройки') : undefined;
                var importedActivity = selected.activity && data && data.activity !== undefined
                    ? self._validateBackupMetadata(data.activity, true, 10000, 'активность') : undefined;
                if (selected.theme && data && data.theme !== undefined && !['dark', 'light'].includes(data.theme)) {
                    throw new Error('Некорректная тема в бэкапе');
                }

                // Validate health history before any project replacement.
                var mergedHistory = null;
                if (selected.healthHistory && data && data.healthHistory !== undefined) {
                    var importedHistory = self._validateImportedHealthHistory(data.healthHistory);
                    mergedHistory = self._mergeHealthHistory(StorageService.get('healthHistory', []), importedHistory);
                }
                var preview = self._buildBackupPreview(data && typeof data === 'object' ? data : {}, projects);
                var sectionLabels = {
                    theme: 'тема', favorites: 'избранное', achievements: 'достижения',
                    settings: 'настройки', activity: 'активность', healthHistory: 'история оценок'
                };
                var previewMessage = [
                    'ПРЕДПРОСМОТР ВОССТАНОВЛЕНИЯ',
                    '',
                    'Проектов: ' + preview.projects,
                    'Задач: ' + preview.tasks,
                    'Заметок: ' + preview.notes,
                    'Дополнительные разделы: ' + (preview.sections.length
                        ? preview.sections.map(function(key) { return sectionLabels[key] || key; }).join(', ')
                        : 'нет'),
                    'Версия DevSpace в архиве: ' + preview.version,
                    preview.timestamp ? 'Дата архива: ' + preview.timestamp : 'Дата архива: не указана',
                    data && data.integrity ? 'Целостность: контрольная сумма совпадает' : 'Целостность: старый архив без контрольной суммы',
                    '',
                    'Будут восстановлены только выбранные разделы. Текущие проекты будут заменены. Продолжить?'
                ].join('\\n');
                if (!confirm(previewMessage)) return;

                projects = projects.map(function(p) {
                    p.name = p.name.replace(/\s*\(копия\)\s*/gi, '').trim();
                    p.updatedAt = new Date().toISOString();
                    return p;
                });

                // Snapshot every affected store before the first write. If any later
                // write fails (quota, storage error, etc.), restore the complete prior state.
                var missingValue = {};
                var storageKeys = ['theme', 'favorites', 'achievements',
                    StorageService.KEYS.SETTINGS, StorageService.KEYS.ACTIVITY, 'healthHistory'];
                var previousStorage = {};
                var rawStorageSnapshots = typeof StorageService.getRawSnapshot === 'function' &&
                    typeof StorageService.restoreRaw === 'function';
                storageKeys.forEach(function(key) {
                    if (rawStorageSnapshots) {
                        var snapshot = StorageService.getRawSnapshot(key);
                        if (snapshot.error) throw new Error('Не удалось безопасно прочитать прежние данные раздела «' + key + '». Импорт отменён без изменений.');
                        previousStorage[key] = snapshot;
                    } else {
                        previousStorage[key] = StorageService.get(key, missingValue);
                    }
                });
                var previousProjects = StateManager.get('projects') || [];
                var previousTheme = StateManager.get('theme');
                var previousFavorites = typeof FavoritesModule !== 'undefined'
                    ? FavoritesModule.favorites : undefined;
                var previousAchievements = typeof AchievementsModule !== 'undefined'
                    ? AchievementsModule.unlocked : undefined;

                try {
                    StateManager.set('projects', projects);
                    if (StateManager.saveProjects() === false) {
                        StateManager.set('projects', previousProjects);
                        if (typeof StateManager._updateStats === 'function') StateManager._updateStats();
                        if (typeof RendererModule !== 'undefined' && typeof RendererModule.renderProjects === 'function') RendererModule.renderProjects();
                        throw new Error('Не удалось сохранить проекты. Проверьте свободное место в хранилище; прежние данные восстановлены.');
                    }
    
                    if (selected.theme && data && data.theme) {
                        if (typeof ThemeModule !== 'undefined' && typeof ThemeModule.setTheme === 'function') {
                            ThemeModule.setTheme(data.theme, true);
                        } else {
                            StateManager.set('theme', data.theme);
                            if (!StorageService.set('theme', data.theme)) {
                                throw new Error('Проекты импортированы, но тему не удалось сохранить');
                            }
                            if (typeof document !== 'undefined' && document.documentElement) {
                                document.documentElement.setAttribute('data-bs-theme', data.theme);
                            }
                        }
                        if (StorageService.get('theme') !== data.theme) {
                            throw new Error('Проекты импортированы, но выбранную тему не удалось сохранить');
                        }
                    }
    
                    if (selected.favorites && data && data.favorites !== undefined) {
                        if (!StorageService.set('favorites', importedFavorites)) {
                            throw new Error('Проекты импортированы, но избранное не удалось сохранить');
                        }
                        if (typeof FavoritesModule !== 'undefined') {
                            FavoritesModule.favorites = importedFavorites;
                            if (typeof RendererModule !== 'undefined' && typeof RendererModule._updateQuickAccess === 'function') {
                                RendererModule._updateQuickAccess();
                            }
                        }
                    }
                    if (selected.achievements && data && data.achievements !== undefined) {
                        if (!StorageService.set('achievements', importedAchievements)) {
                            throw new Error('Проекты импортированы, но достижения не удалось сохранить');
                        }
                        if (typeof AchievementsModule !== 'undefined') AchievementsModule.unlocked = importedAchievements;
                    }
                    if (selected.settings && data && data.settings !== undefined &&
                        !StorageService.set(StorageService.KEYS.SETTINGS, importedSettings)) {
                        throw new Error('Проекты импортированы, но настройки не удалось сохранить');
                    }
                    if (selected.activity && data && data.activity !== undefined &&
                        !StorageService.set(StorageService.KEYS.ACTIVITY, importedActivity)) {
                        throw new Error('Проекты импортированы, но журнал активности не удалось сохранить');
                    }
                    if (selected.healthHistory && mergedHistory && !StorageService.set('healthHistory', mergedHistory)) {
                        throw new Error('Проекты импортированы, но историю оценок не удалось сохранить');
                    }
                    
                    if (typeof RendererModule !== 'undefined') {
                        RendererModule.renderProjects();
                        RendererModule.renderStats();
                        RendererModule._renderInsights();
                    }
                    if (typeof AchievementsModule !== 'undefined') {
                        AchievementsModule._renderAchievements();
                    }
    
                } catch (applyError) {
                    // Roll back all persisted keys, not just the projects collection.
                    var rollbackSucceeded = true;
                    Object.keys(previousStorage).reverse().forEach(function(key) {
                        var previousValue = previousStorage[key];
                        try {
                            if (rawStorageSnapshots) {
                                if (!StorageService.restoreRaw(key, previousValue)) rollbackSucceeded = false;
                                return;
                            }
                            if (previousValue === missingValue) {
                                if (typeof StorageService.remove === 'function') {
                                    if (StorageService.remove(key) === false) rollbackSucceeded = false;
                                } else {
                                    rollbackSucceeded = false;
                                }
                            } else if (StorageService.set(key, previousValue) === false) {
                                rollbackSucceeded = false;
                            }
                        } catch (rollbackError) {
                            // Keep restoring the remaining keys even if one storage operation throws.
                            rollbackSucceeded = false;
                        }
                    });
                    try {
                        StateManager.set('projects', previousProjects);
                    } catch (rollbackError) {
                        rollbackSucceeded = false;
                    }
                    try {
                        StateManager.set('theme', previousTheme);
                    } catch (rollbackError) {
                        rollbackSucceeded = false;
                    }
                    try {
                        if (typeof StateManager.saveProjects === 'function' &&
                            StateManager.saveProjects() === false) rollbackSucceeded = false;
                    } catch (rollbackError) {
                        rollbackSucceeded = false;
                    }
                    if (typeof FavoritesModule !== 'undefined' && previousFavorites !== undefined) {
                        FavoritesModule.favorites = previousFavorites;
                    }
                    if (typeof AchievementsModule !== 'undefined' && previousAchievements !== undefined) {
                        AchievementsModule.unlocked = previousAchievements;
                    }
                    if (previousTheme && typeof ThemeModule !== 'undefined' &&
                        typeof ThemeModule.setTheme === 'function') {
                        try {
                            if (ThemeModule.setTheme(previousTheme, true) === false) rollbackSucceeded = false;
                        } catch (rollbackError) {
                            rollbackSucceeded = false;
                        }
                    }
                    if (typeof StateManager._updateStats === 'function') StateManager._updateStats();
                    if (typeof RendererModule !== 'undefined') {
                        if (typeof RendererModule.renderProjects === 'function') RendererModule.renderProjects();
                        if (typeof RendererModule.renderStats === 'function') RendererModule.renderStats();
                        if (typeof RendererModule._renderInsights === 'function') RendererModule._renderInsights();
                        if (typeof RendererModule._updateQuickAccess === 'function') RendererModule._updateQuickAccess();
                    }
                    if (typeof AchievementsModule !== 'undefined' &&
                        typeof AchievementsModule._renderAchievements === 'function') {
                        AchievementsModule._renderAchievements();
                    }
                    throw new Error(applyError.message + (rollbackSucceeded
                        ? ' Импорт отменён, прежние данные восстановлены.'
                        : ' Импорт прерван; автоматическое восстановление завершилось не полностью. Проверьте хранилище и восстановите данные из резервной копии.'));
                }
                
                if (typeof NotificationModule !== 'undefined') {
                    NotificationModule.success(projects.length + ' проектов импортировано');
                }
            })
            .catch(function(err) {
                if (typeof NotificationModule !== 'undefined') {
                    NotificationModule.error('Ошибка: ' + err.message);
                }
            });
    },

    _showGithubImport: function() {
        var modal = new bootstrap.Modal(document.getElementById('githubModal'));
        modal.show();
        
        var container = document.getElementById('githubReposList');
        if (!container) return;
        
        container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2">Загрузка...</p></div>';
        
        GitHubService.getRepos()
            .then(function(repos) {
                if (!repos || !repos.length) {
                    container.innerHTML = '<p class="text-center text-muted py-4">Репозитории не найдены. Проверьте username в github.js</p>';
                    return;
                }
                
                container.innerHTML = '<div class="list-group">' + 
                    repos.map(function(repo) {
                        return '' +
                        '<div class="list-group-item bg-dark text-light border-secondary d-flex justify-content-between align-items-center">' +
                            '<div class="flex-grow-1 me-3">' +
                                '<strong>' + repo.name + '</strong>' +
                                (repo.description ? '<br><small class="text-muted">' + repo.description.substring(0, 120) + '</small>' : '') +
                                '<br><small>' +
                                    (repo.language ? '<span class="badge bg-secondary me-1">' + repo.language + '</span>' : '') +
                                    '<span class="text-muted">⭐ ' + repo.stars + ' 🍴 ' + repo.forks + '</span>' +
                                '</small>' +
                            '</div>' +
                            '<button class="btn btn-sm btn-gradient import-repo-btn flex-shrink-0" data-repo-name="' + repo.name + '" data-repo-url="' + repo.url + '" data-repo-desc="' + (repo.description || '').replace(/"/g, '&quot;') + '" data-repo-lang="' + (repo.language || '') + '" data-repo-topics="' + (repo.topics || []).join(',') + '">' +
                                '<i class="bi bi-download me-1"></i>Импорт' +
                            '</button>' +
                        '</div>';
                    }).join('') +
                '</div>';
                
                // Обработчики
                container.querySelectorAll('.import-repo-btn').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var project = {
                            name: btn.dataset.repoName,
                            description: btn.dataset.repoDesc || '',
                            github: btn.dataset.repoUrl || '',
                            techStack: btn.dataset.repoLang ? [btn.dataset.repoLang] : [],
                            tags: btn.dataset.repoTopics ? btn.dataset.repoTopics.split(',').filter(Boolean) : [],
                            status: 'development',
                            progress: 0
                        };
                        
                        if (typeof ProjectsModule !== 'undefined') {
                            ProjectsModule.createProject(project);
                            if (typeof NotificationModule !== 'undefined') {
                                NotificationModule.success('Импортирован: ' + project.name);
                            }
                            btn.disabled = true;
                            btn.innerHTML = '<i class="bi bi-check"></i> Импортирован';
                        }
                    });
                });
            })
            .catch(function() {
                container.innerHTML = '<p class="text-center text-danger py-4">Ошибка загрузки. Проверьте подключение.</p>';
            });
    }
};

window.ExportModule = ExportModule;
