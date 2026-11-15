/* ============================================
   APP ENTRY POINT
   ============================================ */

var App = {
    config: {
        appName: 'DevSpace',
        version: '3.54.0',
        debug: false
    },

    _rendered: false,

    init: async function () {
        console.log('🚀 ' + this.config.appName);

        try {
            StateManager.init();
            document.documentElement.setAttribute('data-bs-theme', StateManager.get('theme'));
            this._initModules();
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

        var tp = document.getElementById('tabProjects');
        var ts = document.getElementById('tabStats');
        var ta = document.getElementById('tabAchievements');
        var fl = document.getElementById('projectsFilters');

        if (tp) tp.style.display = savedTab === 'projects' ? '' : 'none';
        if (ts) ts.style.display = savedTab === 'stats' ? '' : 'none';
        if (ta) ta.style.display = savedTab === 'achievements' ? '' : 'none';
        if (fl) fl.style.display = savedTab === 'projects' ? '' : 'none';

        document.querySelectorAll('.tab-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tab === savedTab);
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
            'AuthService', 'ThemeModule', 'NotificationModule',
            'GitHubService', 'SupabaseService',
            'RendererModule', 'ProjectsModule', 'ChecklistModule',
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

    _initGlobalHandlers: function () {
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
