/* ============================================
   RENDERER MODULE
   ============================================ */

var RendererModule = {
    containers: {},

    init: function() {
        this._cacheContainers();
        this._initTabs();
        this._bindEvents();
        console.log('RendererModule initialized');
    },

    _cacheContainers: function() {
        this.containers = {
            projects: document.getElementById('projectsContainer'),
            emptyState: document.getElementById('emptyState'),
            navbar: document.getElementById('mainNavbar')
        };
    },

    _bindEvents: function() {
        var self = this;

        EventBus.on('project:added', function() {
            self.renderProjects();
            self.renderStats();
            self._updateQuickAccess();
        });
        EventBus.on('project:removed', function() {
            self.renderProjects();
            self.renderStats();
            self._updateQuickAccess();
        });
        EventBus.on('project:updated', function() {
            self.renderProjects();
            self.renderStats();
            self._updateQuickAccess();
        });
        EventBus.on('checklist:changed', function() { self.renderProjects(); });
        EventBus.on('update:added', function() { self.renderProjects(); self.renderStats(); });
        EventBus.on('favorites:updated', function() { self.renderProjects(); self._updateQuickAccess(); });
        EventBus.on('auth:login', function() { self.renderProjects(); });
        EventBus.on('auth:logout', function() { self.renderProjects(); });
        EventBus.on('notes:added', function() { self.renderProjects(); });
        EventBus.on('notes:deleted', function() { self.renderProjects(); });
        EventBus.on('notes:updated', function() { self.renderProjects(); });

        window.addEventListener('scroll', Helpers.throttle(function() {
            var n = self.containers.navbar;
            if (n) n.classList.toggle('scrolled', window.scrollY > 50);
        }, 100));
    },

    // ========== ТАБЫ ==========

    _initTabs: function() {
        var self = this;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                self._switchTab(btn.dataset.tab);
            });
        });
    },

    _switchTab: function(tab) {
        sessionStorage.setItem('devspace_tab', tab);

        document.querySelectorAll('.tab-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.tab === tab);
        });

        var tp = document.getElementById('tabProjects');
        var ts = document.getElementById('tabStats');
        var ta = document.getElementById('tabAchievements');
        var fl = document.getElementById('projectsFilters');

        if (tp) tp.style.display = tab === 'projects' ? '' : 'none';
        if (ts) ts.style.display = tab === 'stats' ? '' : 'none';
        if (ta) ta.style.display = tab === 'achievements' ? '' : 'none';
        if (fl) fl.style.display = tab === 'projects' ? '' : 'none';

        var container = document.getElementById('tabTitleContainer');
        var subtitle = document.getElementById('tabSubtitle');

        if (tab === 'projects') {
            if (container) container.innerHTML = '<i class="bi bi-grid me-2 gradient-text"></i><span id="tabTitle">Мои проекты</span>';
            if (subtitle) subtitle.innerHTML = '<span id="filteredCount">0</span> проектов';
            this.renderProjects();
        } else if (tab === 'stats') {
            if (container) container.innerHTML = '<i class="bi bi-graph-up me-2 gradient-text"></i><span id="tabTitle">Статистика</span>';
            if (subtitle) subtitle.textContent = 'Общая информация';
            this.renderStats();
        } else if (tab === 'achievements') {
            if (container) container.innerHTML = '<i class="bi bi-trophy me-2 gradient-text"></i><span id="tabTitle">Достижения</span>';
            if (subtitle && typeof AchievementsModule !== 'undefined') {
                subtitle.textContent = 'Разблокировано ' + AchievementsModule.unlocked.length + ' из ' + AchievementsModule.achievements.length;
            }
            if (typeof AchievementsModule !== 'undefined') {
                AchievementsModule._renderAchievements();
            }
        }
    },

    // ========== РЕНДЕР ==========

    renderProjects: function() {
        var container = this.containers.projects;
        var emptyState = this.containers.emptyState;
        if (!container) return;

        var projects;
        var filterStatus = StateManager.get('filters.status');
        if (filterStatus === 'favorites') {
            projects = FavoritesModule.getFavorites();
        } else {
            projects = ProjectsModule.getFilteredProjects();
        }

        var sq = StateManager.get('filters.search');
        if (sq) {
            var t = sq.toLowerCase();
            projects = projects.filter(function(p) {
                return [p.name, p.description].concat(p.techStack || []).join(' ').toLowerCase().indexOf(t) !== -1;
            });
        }

        var countEl = document.getElementById('filteredCount');
        if (countEl) countEl.textContent = projects.length;

        if (!projects.length) {
            container.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        var self = this;
        container.innerHTML = projects.map(function(p, i) { return self._renderProjectCard(p, i); }).join('');
        this._attachProjectEvents();
    },

    _renderProjectCard: function(project, index) {
        var sc = Helpers.getStatusClass(project.status);
        var st = Helpers.getStatusText(project.status);
        var si = Helpers.getStatusIcon(project.status);
        var ua = Helpers.formatDate(project.updatedAt);
        var isFav = FavoritesModule.isFavorite(project.id);
        var isOwner = typeof AuthService !== 'undefined' ? AuthService.isOwner() : true;

        var techs = (project.techStack || []).slice(0, 4).map(function(t) { return '<span class="tech-tag">' + Helpers.escapeHtml(t) + '</span>'; }).join('');
        if ((project.techStack || []).length > 4) techs += '<span class="tech-tag" style="opacity:0.5;">+' + (project.techStack.length - 4) + '</span>';

        var cl = project.checklist || [];
        var clTotal = cl.length;
        var clDone = cl.filter(function(i) { return i.completed; }).length;
        var clHTML = '';
        if (clTotal > 0) {
            var items = cl.slice(0, 5);
            clHTML = '<div class="mini-items interactive-checklist" data-project-id="' + project.id + '">' +
                items.map(function(item) {
                    return '<div class="mini-item checklist-card-item ' + (item.completed ? 'completed' : '') + '" data-item-id="' + item.id + '">' +
                        '<div class="mini-checkbox ' + (item.completed ? 'checked' : '') + '">' + (item.completed ? '<i class="bi bi-check"></i>' : '') + '</div>' +
                        '<span>' + Helpers.escapeHtml(Helpers.truncateText(item.text, 35)) + '</span></div>';
                }).join('') +
                (clTotal > 5 ? '<div class="mini-more">+ ещё ' + (clTotal - 5) + ' задач</div>' : '') + '</div>';
        } else { clHTML = '<div class="mini-empty">Нет задач</div>'; }

        var notes = project.notes || [];
        var nActive = notes.filter(function(n) { return !n.completed; });
        var nHTML = '';
        if (nActive.length > 0) {
            var ni = nActive.slice(0, 2);
            nHTML = '<div class="mini-items">' + ni.map(function(note) {
                var nt = NotesModule.types[note.type] || NotesModule.types.note;
                return '<div class="mini-item"><span class="note-type-dot" style="background:' + nt.color + ';"></span><span>' + Helpers.escapeHtml(Helpers.truncateText(note.title || note.description || 'Без названия', 35)) + '</span></div>';
            }).join('') + (nActive.length > 2 ? '<div class="mini-more">+ ещё ' + (nActive.length - 2) + ' заметок</div>' : '') + '</div>';
        } else { nHTML = '<div class="mini-empty">Нет заметок</div>'; }

        var milestones = project.milestones || [];
        var cm = project.completedMilestones || [];
        var mHTML = '';
        if (milestones.length > 0) {
            var sm = milestones.slice(0, 4);
            var cc = milestones.filter(function(m) { return cm.indexOf(m) !== -1; }).length;
            mHTML = '<div class="mini-section-header" style="margin-top:8px;"><i class="bi bi-flag"></i><span>Этапы</span><span class="mini-badge">' + cc + '/' + milestones.length + '</span></div>' +
                '<div class="milestones-list">' + sm.map(function(m) {
                    var d = cm.indexOf(m) !== -1;
                    return '<div class="milestone-item ' + (d ? 'done' : '') + '" data-milestone="' + Helpers.escapeHtml(m) + '"><div class="milestone-dot ' + (d ? 'done' : '') + '">' + (d ? '<i class="bi bi-check"></i>' : '') + '</div><span>' + Helpers.escapeHtml(Helpers.truncateText(m, 30)) + '</span></div>';
                }).join('') + (milestones.length > 4 ? '<div class="mini-more">+ ещё ' + (milestones.length - 4) + ' этапов</div>' : '') + '</div>';
        }

        var links = [];
        if (project.github) {
            links.push('<a href="' + Helpers.escapeHtml(project.github) + '" target="_blank" class="project-link" onclick="event.stopPropagation()" title="GitHub"><i class="bi bi-github"></i></a>');
        }
        if (project.supabase) {
            links.push('<a href="' + Helpers.escapeHtml(project.supabase) + '" target="_blank" class="project-link" onclick="event.stopPropagation()" title="Supabase"><i class="bi bi-database"></i></a>');
        }
        if (project.demo) {
            links.push('<a href="' + Helpers.escapeHtml(project.demo) + '" target="_blank" class="project-link" onclick="event.stopPropagation()" title="Демо"><i class="bi bi-box-arrow-up-right"></i></a>');
        }

        var actions = '';
        if (isOwner) {
            actions = '<button class="project-action-btn favorite-btn-card ' + (isFav ? 'active' : '') + '" data-project-id="' + project.id + '"><i class="bi ' + (isFav ? 'bi-star-fill' : 'bi-star') + '"></i></button>' +
                '<button class="project-action-btn edit-project" data-project-id="' + project.id + '"><i class="bi bi-pencil"></i></button>' +
                '<button class="project-action-btn delete-project" data-project-id="' + project.id + '"><i class="bi bi-trash"></i></button>';
        } else {
            actions = '<button class="project-action-btn favorite-btn-card ' + (isFav ? 'active' : '') + '" data-project-id="' + project.id + '"><i class="bi ' + (isFav ? 'bi-star-fill' : 'bi-star') + '"></i></button>';
        }

        return '<div class="project-card" data-project-id="' + project.id + '"><div class="project-card-inner">' +
            '<div class="project-header"><span class="project-status-badge ' + sc + '"><i class="bi ' + si + '"></i> ' + st + '</span><div class="project-actions">' + actions + '</div></div>' +
            '<h3 class="project-name">' + Helpers.escapeHtml(project.name) + '</h3>' +
            (project.description ? '<div class="project-description-wrapper"><p class="project-description" data-full="' + Helpers.escapeHtml(project.description).replace(/"/g, '&quot;') + '">' + Helpers.escapeHtml(Helpers.truncateText(project.description, 150)) + '</p>' + (project.description.length > 150 ? '<button class="btn-show-more" onclick="event.stopPropagation(); RendererModule._toggleDescription(this)"><i class="bi bi-chevron-down me-1"></i>Показать полностью</button>' : '') + '</div>' : '') +
            (links.length ? '<div class="project-links">' + links.join('') + '</div>' : '') +
            (techs ? '<div class="project-tech">' + techs + '</div>' : '') +
            '<div class="card-mini-sections"><div class="card-mini-section"><div class="mini-section-header"><i class="bi bi-check2-square"></i><span>Чек-лист</span>' + (clTotal > 0 ? '<span class="mini-badge">' + clDone + '/' + clTotal + '</span>' : '<span class="mini-badge empty">0</span>') + '</div>' + clHTML + '</div>' +
            '<div class="card-mini-section"><div class="mini-section-header"><i class="bi bi-journal-text"></i><span>Заметки</span>' + (nActive.length > 0 ? '<span class="mini-badge">' + nActive.length + '</span>' : '<span class="mini-badge empty">0</span>') + '</div>' + nHTML + '</div></div>' +
            mHTML +
            '<div class="project-footer"><span class="project-date"><i class="bi bi-clock me-1"></i>' + ua + '</span><div class="project-stats-mini"><span><i class="bi bi-arrow-repeat me-1"></i>' + (project.updates ? project.updates.length : 0) + '</span><span><i class="bi bi-sticky me-1"></i>' + notes.length + '</span><span><i class="bi bi-check2 me-1"></i>' + clTotal + '</span></div></div>' +
            '</div></div>';
    },

    _toggleDescription: function(btn) {
        var wrapper = btn.closest('.project-description-wrapper');
        if (!wrapper) return;
        var desc = wrapper.querySelector('.project-description');
        if (!desc) return;
        var fullText = desc.getAttribute('data-full');
        if (!fullText) return;

        if (!desc.classList.contains('expanded')) {
            desc.textContent = fullText;
            desc.classList.add('expanded');
            desc.style.display = 'block';
            desc.style.webkitLineClamp = 'unset';
            desc.style.overflow = 'visible';
            btn.innerHTML = '<i class="bi bi-chevron-up me-1"></i>Скрыть';
        } else {
            desc.textContent = fullText.substring(0, 150) + '...';
            desc.classList.remove('expanded');
            desc.style.display = '-webkit-box';
            desc.style.webkitLineClamp = '3';
            desc.style.overflow = 'hidden';
            btn.innerHTML = '<i class="bi bi-chevron-down me-1"></i>Показать полностью';
        }
    },

    _updateQuickAccess: function() {
        var menu = document.getElementById('quickAccessMenu');
        if (!menu) return;
        var projects = StateManager.get('projects') || [];
        if (!projects.length) { menu.innerHTML = '<li><span class="dropdown-item-text text-muted small">Нет проектов</span></li>'; return; }
        var favs = typeof FavoritesModule !== 'undefined' ? (FavoritesModule.favorites || []) : [];
        var seen = {}, quick = [];
        projects.filter(function(p) { return favs.indexOf(p.id) !== -1; }).forEach(function(p) { if (!seen[p.id]) { seen[p.id] = true; quick.push(p); } });
        projects.slice(0, 5).forEach(function(p) { if (!seen[p.id]) { seen[p.id] = true; quick.push(p); } });
        quick = quick.slice(0, 8);
        var html = favs.length ? '<li><span class="dropdown-header"><i class="bi bi-star me-1"></i>Избранное</span></li>' : '';
        quick.forEach(function(p) {
            var icon = p.status === 'completed' ? '✅' : p.status === 'development' ? '🔨' : '📋';
            var mi = p.milestones && p.milestones.length ? '<span class="badge bg-secondary ms-2" style="font-size:9px;">' + (p.completedMilestones || []).length + '/' + p.milestones.length + '</span>' : '';
            html += '<li><a class="dropdown-item d-flex align-items-center justify-content-between" href="#" onclick="ProjectDetailModule.show(\'' + p.id + '\')"><span>' + (favs.indexOf(p.id) !== -1 ? '⭐ ' : '') + '<span style="font-size:13px;">' + Helpers.escapeHtml(Helpers.truncateText(p.name, 25)) + '</span></span><span>' + icon + mi + '</span></a></li>';
        });
        if (projects.length > 8) html += '<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center small text-muted" href="#" onclick="RendererModule._switchTab(\'projects\');">Все проекты (' + projects.length + ')</a></li>';
        menu.innerHTML = html;
    },

    _attachProjectEvents: function() {
        var self = this;
        var isOwner = typeof AuthService !== 'undefined' ? AuthService.isOwner() : true;

        document.querySelectorAll('.favorite-btn-card').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                FavoritesModule.toggleFavorite(btn.dataset.projectId);
                var icon = btn.querySelector('i');
                icon.className = 'bi ' + (FavoritesModule.isFavorite(btn.dataset.projectId) ? 'bi-star-fill' : 'bi-star');
                btn.classList.toggle('active', FavoritesModule.isFavorite(btn.dataset.projectId));
            });
        });

        document.querySelectorAll('.checklist-card-item').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                var pid = item.closest('.project-card').dataset.projectId;
                var iid = item.dataset.itemId;
                if (typeof ChecklistModule !== 'undefined') {
                    ChecklistModule.toggleItem(pid, iid);
                    var cb = item.querySelector('.mini-checkbox');
                    var checked = cb.classList.contains('checked');
                    cb.classList.toggle('checked', !checked);
                    cb.innerHTML = !checked ? '<i class="bi bi-check"></i>' : '';
                    item.classList.toggle('completed', !checked);
                    var badge = item.closest('.card-mini-section').querySelector('.mini-badge');
                    var p = StateManager.getProject(pid);
                    if (p && badge) { var c = p.checklist.filter(function(i) { return i.completed; }).length; badge.textContent = c + '/' + p.checklist.length; }
                }
            });
        });

        if (isOwner) {
            document.querySelectorAll('.milestone-item').forEach(function(item) {
                item.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var pid = item.closest('.project-card').dataset.projectId;
                    var milestone = item.dataset.milestone;
                    var p = StateManager.getProject(pid);
                    if (!p) return;
                    if (!p.completedMilestones) p.completedMilestones = [];
                    var idx = p.completedMilestones.indexOf(milestone);
                    if (idx === -1) p.completedMilestones.push(milestone); else p.completedMilestones.splice(idx, 1);
                    var total = (p.milestones || []).length;
                    p.status = p.completedMilestones.length === total ? 'completed' : 'development';
                    p.progress = total ? Math.round((p.completedMilestones.length / total) * 100) : 0;
                    StateManager.updateProject(pid, { completedMilestones: p.completedMilestones, status: p.status, progress: p.progress });
                    self.renderProjects();
                });
            });
            document.querySelectorAll('.edit-project').forEach(function(btn) { btn.addEventListener('click', function(e) { e.stopPropagation(); ProjectsModule.openEditModal(btn.dataset.projectId); }); });
            document.querySelectorAll('.delete-project').forEach(function(btn) { btn.addEventListener('click', function(e) { e.stopPropagation(); ProjectsModule.deleteProject(btn.dataset.projectId); }); });
        }

        document.querySelectorAll('.project-card').forEach(function(card) {
            card.removeEventListener('click', card._h);
            card._h = function(e) {
                if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.checklist-card-item') || e.target.closest('.milestone-item') || e.target.closest('.btn-show-more')) return;
                ProjectDetailModule.show(card.dataset.projectId);
            };
            card.addEventListener('click', card._h);
        });
    },

    renderStats: function() {
        var stats = StateManager.get('stats');
        if (stats && typeof StatsModule !== 'undefined') StatsModule._updateDisplay(stats);
    }
};

window.RendererModule = RendererModule;