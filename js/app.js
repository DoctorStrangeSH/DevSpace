/* ============================================
   APP ENTRY POINT
   ============================================ */

var App = {
    config: {
        appName: 'DevSpace',
        version: '3.66.29',
        debug: false
    },

    _rendered: false,

    init: async function () {
        console.log('🚀 ' + this.config.appName);

        try {
            StateManager.init();
            document.documentElement.setAttribute('data-bs-theme', StateManager.get('theme'));
            this._initModules();
            if (StateManager._projectsLoadError && typeof NotificationModule !== 'undefined') {
                NotificationModule.warning('Сохранённые проекты повреждены или недоступны. Исходные данные не перезаписаны. Проверьте хранилище или восстановите резервную копию.');
            }
            this._restoreStateBeforeRender();
            this._renderOnce();
            this._initVendors();
            this._initGlobalHandlers();
            this._initSync();
            this._registerServiceWorker();
            console.log('✅ Ready');
            EventBus.emit('app:ready');
        } catch (error) {
            console.error('❌', error);
            this._renderOnce();
        }
    },

    _restoreStateBeforeRender: function () {
        var savedTab = sessionStorage.getItem('devspace_tab') || 'projects';
        if (!['projects', 'stats', 'achievements'].includes(savedTab)) savedTab = 'projects';
        sessionStorage.setItem('devspace_tab', savedTab);

        var tp = document.getElementById('tabProjects');
        var ts = document.getElementById('tabStats');
        var ta = document.getElementById('tabAchievements');
        var fl = document.getElementById('projectsFilters');

        if (tp) tp.style.display = savedTab === 'projects' ? '' : 'none';
        if (ts) ts.style.display = savedTab === 'stats' ? '' : 'none';
        if (ta) ta.style.display = savedTab === 'achievements' ? '' : 'none';
        if (fl) fl.style.display = savedTab === 'projects' ? '' : 'none';

        document.querySelectorAll('.tab-btn').forEach(function (b) {
            var selected = b.dataset.tab === savedTab;
            b.classList.toggle('active', selected);
            b.setAttribute('aria-selected', String(selected));
            b.tabIndex = selected ? 0 : -1;
        });

        var container = document.getElementById('tabTitleContainer');
        if (container) {
            if (savedTab === 'projects') {
                container.innerHTML = '<i class="bi bi-grid me-2 gradient-text"></i><span id="tabTitle">Мои проекты</span>';
            } else if (savedTab === 'stats') {
                container.innerHTML = '<i class="bi bi-graph-up me-2 gradient-text"></i><span id="tabTitle">Статистика</span>';
            } else if (savedTab === 'achievements') {
                container.innerHTML = '<i class="bi bi-trophy me-2 gradient-text"></i><span id="tabTitle">Достижения</span>';
            }
        }

        var savedFilter = sessionStorage.getItem('devspace_filter') || 'all';
        StateManager.set('filters.status', savedFilter);
        document.querySelectorAll('.filter-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.filter === savedFilter);
        });

        var savedScroll = sessionStorage.getItem('devspace_scroll');
        if (savedScroll) {
            setTimeout(function () { window.scrollTo({ top: parseInt(savedScroll), behavior: 'instant' }); }, 100);
        }
    },

    _renderOnce: function () {
        if (this._rendered) return;
        this._rendered = true;

        var savedTab = sessionStorage.getItem('devspace_tab') || 'projects';

        if (savedTab === 'projects') {
            if (typeof RendererModule !== 'undefined') {
                RendererModule.renderProjects();
                RendererModule.renderStats();
            }
        } else if (savedTab === 'stats') {
            if (typeof RendererModule !== 'undefined') {
                RendererModule.renderStats();
            }
        } else if (savedTab === 'achievements') {
            if (typeof AchievementsModule !== 'undefined') {
                AchievementsModule._renderAchievements();
            }
        }

        // Обновляем быстрый доступ после рендера
        if (typeof RendererModule !== 'undefined') {
            RendererModule._updateQuickAccess();
        }

        var savedProjectId = sessionStorage.getItem('devspace_detail_project');
        if (savedProjectId && typeof ProjectDetailModule !== 'undefined') {
            setTimeout(function () {
                ProjectDetailModule.show(savedProjectId);
            }, 400);
        }
    },

    _initSync: function () {
        if (typeof SyncModule !== 'undefined') {
            SyncModule.init();
        }
    },

    _initModules: function () {
        var modules = [
            'AuthService', 'FirebaseIdentityModule', 'ThemeModule', 'NotificationModule',
            'GitHubService', 'SupabaseService',
            'RendererModule', 'WorkspaceViewModule', 'ProjectsModule', 'ChecklistModule',
            'UpdatesModule', 'StatsModule', 'NotesModule',
            'TagsModule', 'FavoritesModule', 'GalleryModule',
            'ProjectDetailModule', 'ExportModule', 'ShareModule',
            'AchievementsModule', 'TimeTrackerModule'
        ];

        for (var i = 0; i < modules.length; i++) {
            var m = window[modules[i]];
            if (m && m.init) { try { m.init(); } catch (e) { } }
        }
    },

    _initVendors: function () {
        var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var compactViewport = window.matchMedia && window.matchMedia('(max-width: 670px)').matches;
        if (typeof AOS !== 'undefined') {
            AOS.init({ duration: 600, easing: 'ease-out', once: true, offset: 30, disable: !!prefersReducedMotion });
        }
        if (!prefersReducedMotion && !compactViewport && document.getElementById('particles-js')) {
            var startParticles = function () {
                if (document.hidden || typeof particlesJS === 'undefined') return;
                particlesJS('particles-js', {
                particles: {
                    number: { value: 30, density: { enable: true, value_area: 800 } },
                    color: { value: '#6366f1' }, shape: { type: 'circle' },
                    opacity: { value: 0.3, random: true }, size: { value: 2, random: true },
                    line_linked: { enable: true, distance: 150, color: '#6366f1', opacity: 0.2, width: 1 },
                    move: { enable: true, speed: 1, random: true }
                },
                interactivity: { detect_on: 'canvas', events: { onhover: { enable: true, mode: 'grab' } } },
                retina_detect: true
                });
            };
            var loadParticles = function () {
                if (document.hidden) {
                    document.addEventListener('visibilitychange', function onVisible() {
                        if (document.hidden) return;
                        document.removeEventListener('visibilitychange', onVisible);
                        loadParticles();
                    });
                    return;
                }
                var script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js';
                script.async = true;
                script.onload = startParticles;
                document.head.appendChild(script);
            };
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(loadParticles, { timeout: 2500 });
            } else {
                window.setTimeout(loadParticles, 1200);
            }
        }
    },

    _githubImportBound: false,
    _githubImportLoading: false,

    _initGithubImport: function () {
        if (this._githubImportBound) return;
        var self = this;
        var modalEl = document.getElementById('githubModal');
        var listEl = document.getElementById('githubReposList');
        if (!modalEl || !listEl) return;

        this._githubImportBound = true;
        [
            document.getElementById('importGithubBtn'),
            document.getElementById('footerImportBtn')
        ].filter(Boolean).forEach(function (button) {
            button.addEventListener('click', function () {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
                self._loadGithubRepositories(listEl);
            });
        });
    },

    _loadGithubRepositories: function (listEl) {
        if (this._githubImportLoading) return;
        this._githubImportLoading = true;
        listEl.replaceChildren();
        var loading = document.createElement('div');
        loading.className = 'text-center py-5';
        loading.setAttribute('role', 'status');
        loading.textContent = 'Загрузка репозиториев…';
        listEl.appendChild(loading);

        var self = this;
        GitHubService.getRepos().then(function (repos) {
            self._githubImportLoading = false;
            listEl.replaceChildren();

            if (!repos.length) {
                var empty = document.createElement('p');
                empty.className = 'text-muted text-center py-4';
                empty.textContent = 'Не удалось загрузить публичные репозитории GitHub. Попробуйте открыть окно ещё раз.';
                listEl.appendChild(empty);
                return;
            }

            var existingProjects = StateManager.get('projects') || [];
            repos.forEach(function (repo) {
                var alreadyImported = existingProjects.some(function (project) {
                    return project.github && project.github === repo.url;
                });
                var card = document.createElement('article');
                card.className = 'github-import-item d-flex align-items-center justify-content-between gap-3 py-3 border-bottom';

                var details = document.createElement('div');
                details.className = 'min-w-0 flex-grow-1';
                var title = document.createElement('h6');
                title.className = 'mb-1';
                title.textContent = repo.name || 'Без названия';
                var description = document.createElement('p');
                description.className = 'small text-muted mb-1';
                description.textContent = repo.description || 'Описание отсутствует';
                var metadata = document.createElement('span');
                metadata.className = 'small text-muted';
                metadata.textContent = [repo.language || 'Язык не указан', '★ ' + (repo.stars || 0)].join(' · ');
                details.appendChild(title);
                details.appendChild(description);
                details.appendChild(metadata);

                var importButton = document.createElement('button');
                importButton.type = 'button';
                importButton.className = 'btn btn-sm btn-glass flex-shrink-0';
                importButton.textContent = alreadyImported ? 'Уже добавлен' : 'Импортировать';
                importButton.disabled = alreadyImported;
                importButton.addEventListener('click', function () {
                    if (importButton.disabled) return;
                    var latestProjects = StateManager.get('projects') || [];
                    if (latestProjects.some(function (project) { return project.github && project.github === repo.url; })) {
                        importButton.disabled = true;
                        importButton.textContent = 'Уже добавлен';
                        return;
                    }
                    if (!repo.name || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(repo.url || '')) {
                        importButton.disabled = true;
                        importButton.textContent = 'Некорректная ссылка';
                        return;
                    }
                    var imported = ProjectsModule.createProject(GitHubService.importAsProject(repo));
                    if (!imported) {
                        if (typeof NotificationModule !== 'undefined') NotificationModule.error('Не удалось импортировать репозиторий');
                        return;
                    }
                    importButton.disabled = true;
                    importButton.textContent = 'Добавлен';
                    if (typeof RendererModule !== 'undefined') {
                        RendererModule.renderProjects();
                        RendererModule.renderStats();
                    }
                    if (typeof NotificationModule !== 'undefined') NotificationModule.success('Репозиторий «' + imported.name + '» добавлен в проекты');
                });
                card.appendChild(details);
                card.appendChild(importButton);
                listEl.appendChild(card);
            });
        }).catch(function () {
            self._githubImportLoading = false;
            listEl.replaceChildren();
            var error = document.createElement('p');
            error.className = 'text-danger text-center py-4';
            error.textContent = 'Не удалось загрузить репозитории. Проверьте подключение и попробуйте снова.';
            listEl.appendChild(error);
        });
    },

    _initGlobalHandlers: function () {
        // Restore keyboard focus after the create-project and GitHub-import dialogs close.
        ['projectModal', 'githubModal'].forEach(function (modalId) {
            var modalEl = document.getElementById(modalId);
            if (!modalEl || modalEl.dataset.focusRestoreBound === 'true') return;
            modalEl.dataset.focusRestoreBound = 'true';
            var returnFocusTarget = null;

            modalEl.addEventListener('show.bs.modal', function (event) {
                returnFocusTarget = event.relatedTarget || document.activeElement;
            });

            modalEl.addEventListener('hidden.bs.modal', function () {
                var target = returnFocusTarget;
                returnFocusTarget = null;
                if (target && target.isConnected && !target.disabled && target.getClientRects().length) {
                    target.focus({ preventScroll: true });
                    return;
                }
                var fallback = document.querySelector('[data-bs-target="#' + modalId + '"]:not(:disabled)');
                if (fallback && fallback.getClientRects().length) fallback.focus({ preventScroll: true });
            });
        });

        this._initGithubImport();

        window.addEventListener('beforeunload', function () {
            sessionStorage.setItem('devspace_scroll', window.scrollY);
            var activeTab = document.querySelector('.tab-btn.active');
            sessionStorage.setItem('devspace_tab', activeTab ? activeTab.dataset.tab : 'projects');
            sessionStorage.setItem('devspace_filter', StateManager.get('filters.status') || 'all');
        });

        var btn = document.getElementById('scrollTopBtn');
        if (btn) {
            window.addEventListener('scroll', function () {
                var s = window.scrollY > 500;
                btn.style.opacity = s ? '1' : '0';
                btn.style.pointerEvents = s ? 'all' : 'none';
            });
            btn.addEventListener('click', function () {
                var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                window.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' });
            });
        }

        window.addEventListener('scroll', Helpers.throttle(function () {
            var n = document.getElementById('mainNavbar');
            if (n) n.classList.toggle('scrolled', window.scrollY > 50);
        }, 100));

        document.querySelector('.scroll-to-projects')?.addEventListener('click', function (e) {
            e.preventDefault();
            var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            document.getElementById('projects')?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth' });
            if (typeof RendererModule !== 'undefined') RendererModule._switchTab('projects');
        });

        var v = document.getElementById('appVersion');
        if (v) v.textContent = 'v' + this.config.version;
    },

    _registerServiceWorker: function () {
        if ('serviceWorker' in navigator) {
            var version = this.config.version;
            window.addEventListener('load', function () {
                navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(version)).catch(function () { });
            });
        }
    }
};

document.addEventListener('DOMContentLoaded', function () { App.init(); });
window.App = App;
