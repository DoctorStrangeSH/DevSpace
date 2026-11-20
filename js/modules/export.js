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
                self.createBackup();
            });
        }
        
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
                var history = self._mergeHealthHistory(StorageService.get('healthHistory', []), data.history);
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

    createBackup: function() {
        var data = {
            projects: StateManager.get('projects') || [],
            theme: StateManager.get('theme') || 'dark',
            favorites: typeof FavoritesModule !== 'undefined' ? (FavoritesModule.favorites || []) : [],
            achievements: typeof AchievementsModule !== 'undefined' ? (AchievementsModule.unlocked || []) : [],
            settings: StorageService.get(StorageService.KEYS.SETTINGS, {}) || {},
            activity: StorageService.get(StorageService.KEYS.ACTIVITY, []) || [],
            healthHistory: this._cleanHealthHistory(StorageService.get('healthHistory', [])),
            version: '3.66.22',
            timestamp: new Date().toISOString()
        };
        var json = JSON.stringify(data, null, 2);
        var filename = 'devspace-backup-' + new Date().toISOString().split('T')[0] + '.json';
        Helpers.downloadFile(json, filename);
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.success('Бэкап создан');
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

    _importFile: function(file) {
        var self = this;
        Helpers.readFile(file)
            .then(function(text) {
                var data = JSON.parse(text);
                
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

                var importedFavorites = data && data.favorites !== undefined
                    ? self._validateBackupMetadata(data.favorites, true, 5000, 'избранное') : undefined;
                var importedAchievements = data && data.achievements !== undefined
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
                var importedSettings = data && data.settings !== undefined
                    ? self._validateBackupMetadata(data.settings, false, 500, 'настройки') : undefined;
                var importedActivity = data && data.activity !== undefined
                    ? self._validateBackupMetadata(data.activity, true, 10000, 'активность') : undefined;
                if (data && data.theme !== undefined && !['dark', 'light'].includes(data.theme)) {
                    throw new Error('Некорректная тема в бэкапе');
                }

                // Validate health history before any project replacement.
                var mergedHistory = data && Array.isArray(data.healthHistory)
                    ? self._mergeHealthHistory(StorageService.get('healthHistory', []), data.healthHistory) : null;
                if (data && data.healthHistory !== undefined && mergedHistory === null) {
                    throw new Error('Некорректная история в бэкапе');
                }
                if (!confirm('Импортировать ' + projects.length + ' проектов? Текущие будут заменены.')) return;

                projects = projects.map(function(p) {
                    p.name = p.name.replace(/\\s*\\(копия\\)\\s*/gi, '').trim();
                    p.updatedAt = new Date().toISOString();
                    return p;
                });

                // Snapshot every affected store before the first write. If any later
                // write fails (quota, storage error, etc.), restore the complete prior state.
                var missingValue = {};
                var storageKeys = ['theme', 'favorites', 'achievements',
                    StorageService.KEYS.SETTINGS, StorageService.KEYS.ACTIVITY, 'healthHistory'];
                var previousStorage = {};
                storageKeys.forEach(function(key) {
                    previousStorage[key] = StorageService.get(key, missingValue);
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
    
                    if (data && data.theme) {
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
    
                    if (data && data.favorites) {
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
                    if (data && data.achievements) {
                        if (!StorageService.set('achievements', importedAchievements)) {
                            throw new Error('Проекты импортированы, но достижения не удалось сохранить');
                        }
                        if (typeof AchievementsModule !== 'undefined') AchievementsModule.unlocked = importedAchievements;
                    }
                    if (data && data.settings !== undefined &&
                        !StorageService.set(StorageService.KEYS.SETTINGS, importedSettings)) {
                        throw new Error('Проекты импортированы, но настройки не удалось сохранить');
                    }
                    if (data && data.activity !== undefined &&
                        !StorageService.set(StorageService.KEYS.ACTIVITY, importedActivity)) {
                        throw new Error('Проекты импортированы, но журнал активности не удалось сохранить');
                    }
                    if (mergedHistory && !StorageService.set('healthHistory', mergedHistory)) {
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
                        if (previousValue === missingValue) {
                            if (typeof StorageService.remove === 'function') {
                                if (StorageService.remove(key) === false) rollbackSucceeded = false;
                            } else {
                                rollbackSucceeded = false;
                            }
                        } else if (StorageService.set(key, previousValue) === false) {
                            rollbackSucceeded = false;
                        }
                    });
                    StateManager.set('projects', previousProjects);
                    StateManager.set('theme', previousTheme);
                    if (typeof StateManager.saveProjects === 'function' &&
                        StateManager.saveProjects() === false) rollbackSucceeded = false;
                    if (typeof FavoritesModule !== 'undefined' && previousFavorites !== undefined) {
                        FavoritesModule.favorites = previousFavorites;
                    }
                    if (typeof AchievementsModule !== 'undefined' && previousAchievements !== undefined) {
                        AchievementsModule.unlocked = previousAchievements;
                    }
                    if (previousTheme && typeof ThemeModule !== 'undefined' &&
                        typeof ThemeModule.setTheme === 'function') {
                        ThemeModule.setTheme(previousTheme, true);
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
