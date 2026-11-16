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

    createBackup: function() {
        var data = {
            projects: StateManager.get('projects') || [],
            theme: StateManager.get('theme') || 'dark',
            favorites: typeof FavoritesModule !== 'undefined' ? (FavoritesModule.favorites || []) : [],
            achievements: typeof AchievementsModule !== 'undefined' ? (AchievementsModule.unlocked || []) : [],
            healthHistory: this._cleanHealthHistory(StorageService.get('healthHistory', [])),
            version: '3.62.2',
            timestamp: new Date().toISOString()
        };
        var json = JSON.stringify(data, null, 2);
        var filename = 'devspace-backup-' + new Date().toISOString().split('T')[0] + '.json';
        Helpers.downloadFile(json, filename);
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.success('Бэкап создан');
        }
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
                
                // Определяем формат
                var projects;
                if (Array.isArray(data)) {
                    projects = data;
                } else if (data.projects && Array.isArray(data.projects)) {
                    projects = data.projects;
                } else {
                    throw new Error('Неверный формат');
                }

                // Проверяем историю до замены проектов. Старые бэкапы без неё поддерживаются.
                var mergedHistory = Array.isArray(data.healthHistory) ? self._mergeHealthHistory(StorageService.get('healthHistory', []), data.healthHistory) : null;
                if (data.healthHistory !== undefined && mergedHistory === null) throw new Error('Некорректная история в бэкапе');

                if (!confirm('Импортировать ' + projects.length + ' проектов? Текущие будут заменены.')) return;

                projects = projects.map(function(p) {
                    p.name = (p.name || '').replace(/\s*\(копия\)\s*/gi, '').trim();
                    p.updatedAt = new Date().toISOString();
                    return p;
                });

                StateManager.set('projects', projects);
                StateManager.saveProjects();
                
                if (data.favorites) {
                    StorageService.set('favorites', data.favorites);
                    if (typeof FavoritesModule !== 'undefined') FavoritesModule.favorites = data.favorites;
                }
                if (data.achievements) {
                    StorageService.set('achievements', data.achievements);
                    if (typeof AchievementsModule !== 'undefined') AchievementsModule.unlocked = data.achievements;
                }
                if (mergedHistory && !StorageService.set('healthHistory', mergedHistory)) {
                    if (typeof NotificationModule !== 'undefined') NotificationModule.error('Проекты загружены, но историю оценок сохранить не удалось');
                }
                
                if (typeof RendererModule !== 'undefined') {
                    RendererModule.renderProjects();
                    RendererModule.renderStats();
                    RendererModule._renderInsights();
                }
                if (typeof AchievementsModule !== 'undefined') {
                    AchievementsModule._renderAchievements();
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
