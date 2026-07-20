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
            version: '2.0.0',
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
                
                if (typeof RendererModule !== 'undefined') {
                    RendererModule.renderProjects();
                    RendererModule.renderStats();
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