/* ============================================
   RENDERER MODULE
   ============================================ */

var RendererModule = {
    containers: {},
    _pageSize: 24,
    _visibleCount: 24,
    _viewKey: null,
    _sortMode: 'updated',
    _viewMode: 'grid',
    _pinnedIds: [],
    _scheduleMonth: null,
    _scheduleSelected: null,
    _todaySelectedDay: null,
    _todayVisibleCount: 8,
    _todaySelectedTasks: new Map(),
    _todayBulkUndo: null,
    _todayCollapsedGroups: new Set(),

    init: function() {
        var savedPins = typeof StorageService !== 'undefined' ? StorageService.get('pinnedProjects', []) : [];
        this._pinnedIds = Array.isArray(savedPins) ? savedPins.filter(function(id) { return typeof id === 'string'; }) : [];
        this._cacheContainers();
        this._restoreTodayPreferences();
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
        var self = this;
        this._initCollapsiblePanels();
        var focus = document.getElementById('focusPanel');
        if (focus) focus.addEventListener('click', function(event) {
            var complete = event.target.closest('[data-focus-complete]');
            if (complete) {
                if (typeof ChecklistModule !== 'undefined') {
                    ChecklistModule.toggleItem(complete.dataset.focusProjectId, complete.dataset.focusComplete);
                }
                return;
            }
            var button = event.target.closest('[data-focus-project]');
            if (button && typeof ProjectDetailModule !== 'undefined') ProjectDetailModule.show(button.dataset.focusProject);
        });
        if (focus) focus.addEventListener('change', function(event) {
            var deadline = event.target.closest('[data-focus-deadline]');
            if (deadline && typeof ChecklistModule !== 'undefined') {
                ChecklistModule.setDeadline(deadline.dataset.focusProjectId, deadline.dataset.focusDeadline, deadline.value);
                return;
            }
            var priority = event.target.closest('[data-focus-priority]');
            if (priority && typeof ChecklistModule !== 'undefined') {
                ChecklistModule.setPriority(priority.dataset.focusProjectId, priority.dataset.focusPriority, priority.value);
            }
        });
        var overview = document.getElementById('roadmapOverview');
        if (overview) overview.addEventListener('click', function(event) {
            var button = event.target.closest('[data-focus-project]');
            if (button && typeof ProjectDetailModule !== 'undefined') ProjectDetailModule.show(button.dataset.focusProject);
        });
        var schedule = document.getElementById('scheduleCalendar');
        if (schedule) schedule.addEventListener('click', function(event) {
            var project = event.target.closest('[data-focus-project]');
            if (project) {
                if (typeof ProjectDetailModule !== 'undefined') ProjectDetailModule.show(project.dataset.focusProject);
                return;
            }
            var day = event.target.closest('[data-schedule-day]');
            if (day) {
                self._scheduleSelected = day.dataset.scheduleDay;
                self._renderSchedule();
                return;
            }
            var nav = event.target.closest('#schedulePrev, #scheduleNext, #scheduleToday');
            if (!nav) return;
            if (nav.id === 'scheduleToday') {
                self._scheduleMonth = null;
                self._scheduleSelected = null;
            } else {
                var base = self._scheduleMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                self._scheduleMonth = new Date(base.getFullYear(), base.getMonth() + (nav.id === 'scheduleNext' ? 1 : -1), 1);
                self._scheduleSelected = null;
            }
            self._renderSchedule();
        });
        if (schedule) schedule.addEventListener('change', function(event) {
            if (event.target.matches('#scheduleProjectFilter, #scheduleTypeFilter')) self._renderSchedule();
        });
        var todayPanel = document.getElementById('todayPanel');
        var insights = document.getElementById('insightsPanel');
        if (insights) insights.addEventListener('click', function(event) {
            var project = event.target.closest('[data-insight-project]');
            if (project && typeof ProjectDetailModule !== 'undefined') ProjectDetailModule.show(project.dataset.insightProject);
        });
        if (todayPanel) todayPanel.addEventListener('change', function(event) {
            if (event.target.matches('[data-today-select]')) {
                if (typeof AuthService === 'undefined' || !AuthService.isOwner()) return;
                var selected = event.target;
                var token = JSON.stringify([selected.dataset.todayProject, selected.dataset.todaySelect]);
                if (selected.checked) self._todaySelectedTasks.set(token, { projectId: selected.dataset.todayProject, itemId: selected.dataset.todaySelect });
                else self._todaySelectedTasks.delete(token);
                self._renderBulkControls();
                return;
            }
            if (event.target.matches('#todayPriority, #todayScope, #todaySort, #todayGroupByProject')) { self._todayVisibleCount = 8; self._todaySelectedTasks.clear(); self._saveTodayPreferences(); self._renderToday(); return; }
            var editor = event.target.closest('[data-today-edit-project]');
            if (!editor || typeof AuthService === 'undefined' || !AuthService.isOwner() || typeof ChecklistModule === 'undefined') return;
            if (event.target.matches('[data-today-edit-priority]')) {
                ChecklistModule.setPriority(editor.dataset.todayEditProject, editor.dataset.todayEditItem, event.target.value);
            } else if (event.target.matches('[data-today-edit-deadline]')) {
                ChecklistModule.setDeadline(editor.dataset.todayEditProject, editor.dataset.todayEditItem, event.target.value);
            }
        });
        if (todayPanel) todayPanel.addEventListener('input', function(event) {
            if (event.target.id !== 'todaySearch') return;
            self._todaySelectedDay = null;
            self._todayView = 'all';
            self._todayVisibleCount = 8;
            self._todaySelectedTasks.clear();
            self._renderToday();
        });
        var bulkForm = document.getElementById('todayBulkForm');
        if (bulkForm) bulkForm.addEventListener('submit', function(event) {
            event.preventDefault();
            if (typeof AuthService === 'undefined' || !AuthService.isOwner() || typeof ChecklistModule === 'undefined') return;
            var priority = document.getElementById('todayBulkPriority').value;
            var deadline = document.getElementById('todayBulkDeadline').value;
            if (!priority && !deadline) return;
            if (priority && !['high', 'normal', 'low'].includes(priority)) return;
            if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString().slice(0, 10) !== deadline)) return;
            var targets = self._validBulkTargets();
            if (!targets.length) { self._todaySelectedTasks.clear(); self._renderToday(); return; }
            var detail = [priority ? 'приоритет' : '', deadline ? 'срок' : ''].filter(Boolean).join(' и ');
            if (!window.confirm('Изменить ' + detail + ' для ' + targets.length + ' задач?')) return;
            self._todayBulkUndo = self._prepareBulkUndo(targets, priority, deadline);
            targets.forEach(function(target) {
                if (priority) ChecklistModule.setPriority(target.projectId, target.itemId, priority);
                if (deadline) ChecklistModule.setDeadline(target.projectId, target.itemId, deadline);
            });
            self._todaySelectedTasks.clear();
            document.getElementById('todayBulkPriority').value = '';
            document.getElementById('todayBulkDeadline').value = '';
            self._renderToday();
        });
        var quickTaskForm = document.getElementById('quickTaskForm');
        var quickTaskOptionsToggle = document.getElementById('quickTaskOptionsToggle');
        if (quickTaskForm && quickTaskOptionsToggle) quickTaskOptionsToggle.addEventListener('click', function() {
            var expanded = quickTaskForm.classList.toggle('is-expanded');
            quickTaskOptionsToggle.setAttribute('aria-expanded', String(expanded));
            quickTaskOptionsToggle.innerHTML = expanded
                ? '<i class="bi bi-chevron-up" aria-hidden="true"></i> Скрыть параметры'
                : '<i class="bi bi-sliders" aria-hidden="true"></i> Параметры';
        });
        if (quickTaskForm) quickTaskForm.addEventListener('submit', function(event) {
            event.preventDefault();
            if (typeof AuthService === 'undefined' || !AuthService.isOwner() || typeof ChecklistModule === 'undefined') return;
            var projectId = document.getElementById('quickTaskProject').value;
            var text = document.getElementById('quickTaskText').value.trim();
            var priority = document.getElementById('quickTaskPriority').value;
            var deadline = document.getElementById('quickTaskDeadline').value;
            if (!projectId || !text || text.length > 240 || !StateManager.getProject(projectId)) return;
            var item = ChecklistModule.addItem(projectId, text);
            if (!item) return;
            if (priority !== 'normal') ChecklistModule.setPriority(projectId, item.id, priority);
            if (deadline) ChecklistModule.setDeadline(projectId, item.id, deadline);
            document.getElementById('quickTaskText').value = '';
            document.getElementById('quickTaskText').focus();
        });
        if (todayPanel) todayPanel.addEventListener('click', function(event) {
            var filterToggle = event.target.closest('#todayMobileFilterToggle');
            if (filterToggle) {
                var expanded = todayPanel.classList.toggle('is-filters-expanded');
                filterToggle.setAttribute('aria-expanded', String(expanded));
                return;
            }
            var quick = event.target.closest('[data-today-quick]');
            if (quick) {
                var action = quick.dataset.todayQuick;
                var target = action === 'create' ? document.getElementById('quickTaskText') : action === 'search' ? document.getElementById('todaySearch') : null;
                if (action === 'create' && (typeof AuthService === 'undefined' || !AuthService.isOwner() || !target || !target.offsetParent)) return;
                if (action === 'overdue') {
                    self._todaySelectedTasks.clear();
                    self._todaySelectedDay = null;
                    self._todayVisibleCount = 8;
                    self._todayView = 'overdue';
                    self._saveTodayPreferences();
                    self._renderToday();
                    target = document.getElementById('todayList');
                }
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    if (action !== 'overdue') target.focus({ preventScroll: true });
                }
                return;
            }
            var day = event.target.closest('[data-weekly-day]');
            if (day) {
                self._todaySelectedTasks.clear();
                self._todayVisibleCount = 8;
                self._todaySelectedDay = day.dataset.weeklyDay;
                self._todayView = 'all';
                self._renderToday();
                return;
            }
            if (event.target.closest('#weeklyLoadClear')) {
                self._todaySelectedTasks.clear();
                self._todayVisibleCount = 8;
                self._todaySelectedDay = null;
                self._todayView = 'today';
                self._renderToday();
                return;
            }
            var tab = event.target.closest('[data-today-view]');
            if (tab) {
                self._todaySelectedTasks.clear();
                self._todayVisibleCount = 8;
                self._todaySelectedDay = null;
                self._todayView = tab.dataset.todayView;
                self._saveTodayPreferences();
                self._renderToday();
                return;
            }
            var groupButton = event.target.closest('[data-today-group]');
            if (groupButton) {
                var groupId = groupButton.dataset.todayGroup;
                if (self._todayCollapsedGroups.has(groupId)) self._todayCollapsedGroups.delete(groupId);
                else self._todayCollapsedGroups.add(groupId);
                var group = groupButton.closest('.today-project-group');
                var collapsed = self._todayCollapsedGroups.has(groupId);
                if (group) group.classList.toggle('is-collapsed', collapsed);
                groupButton.setAttribute('aria-expanded', String(!collapsed));
                return;
            }
            var editToggle = event.target.closest('[data-today-edit-toggle]');
            if (editToggle) {
                if (typeof AuthService === 'undefined' || !AuthService.isOwner()) return;
                var taskRow = editToggle.closest('.today-task');
                if (!taskRow) return;
                var expanded = taskRow.classList.toggle('is-editing');
                editToggle.setAttribute('aria-expanded', String(expanded));
                editToggle.innerHTML = expanded ? 'Скрыть <i class="bi bi-chevron-up" aria-hidden="true"></i>' : 'Изменить <i class="bi bi-sliders" aria-hidden="true"></i>';
                return;
            }
            if (event.target.closest('#todayMore')) {
                self._todayVisibleCount += 8;
                self._renderToday();
                return;
            }
            if (event.target.closest('#todayBulkClear')) {
                self._todaySelectedTasks.clear();
                self._renderToday();
                return;
            }
            if (event.target.closest('#todayUndoBulk')) {
                if (typeof AuthService === 'undefined' || !AuthService.isOwner() || typeof ChecklistModule === 'undefined') return;
                if (!self._todayBulkUndo) return;
                if (!self._canUndoBulk(self._todayBulkUndo)) {
                    self._todayBulkUndo = null;
                    self._renderBulkControls();
                    window.alert('Отмена недоступна: одна из задач уже изменилась или была удалена. Текущие данные сохранены.');
                    return;
                }
                var changes = self._todayBulkUndo;
                self._todayBulkUndo = null;
                changes.entries.forEach(function(entry) {
                    if (entry.priorityChanged) ChecklistModule.setPriority(entry.projectId, entry.itemId, entry.beforePriority);
                    if (entry.deadlineChanged) ChecklistModule.setDeadline(entry.projectId, entry.itemId, entry.beforeDeadline);
                });
                self._renderToday();
                return;
            }
            var move = event.target.closest('[data-today-move]');
            if (move) {
                if (typeof AuthService === 'undefined' || !AuthService.isOwner() || typeof ChecklistModule === 'undefined') return;
                var project = StateManager.getProject(move.dataset.todayProject);
                var item = project && Array.isArray(project.checklist) ? project.checklist.find(function(task) { return String(task.id) === move.dataset.todayMove; }) : null;
                var week = self._collectWeeklyLoad(StateManager.get('projects') || [], new Date());
                var suggested = item && !item.completed && self._suggestWeeklyDate(week, item.deadline || '');
                if (suggested && suggested.key === move.dataset.todayDate) ChecklistModule.setDeadline(project.id, item.id, suggested.key);
                return;
            }
            var complete = event.target.closest('[data-today-complete]');
            if (complete) {
                if (typeof ChecklistModule !== 'undefined') ChecklistModule.toggleItem(complete.dataset.todayProject, complete.dataset.todayComplete);
                return;
            }
            var project = event.target.closest('[data-focus-project]');
            if (project && typeof ProjectDetailModule !== 'undefined') ProjectDetailModule.show(project.dataset.focusProject);
        });
        var goal = document.getElementById('productivityGoal');
        if (goal) {
            var savedGoal = typeof StorageService !== 'undefined' ? Number(StorageService.get('weeklyGoal', 5)) : 5;
            goal.value = String(Number.isInteger(savedGoal) && savedGoal >= 1 && savedGoal <= 100 ? savedGoal : 5);
            goal.addEventListener('change', function() {
                var newGoal = Number(goal.value);
                if (!Number.isInteger(newGoal) || newGoal < 1 || newGoal > 100) {
                    goal.value = String(self._weeklyGoal());
                    return;
                }
                if (typeof StorageService !== 'undefined') StorageService.set('weeklyGoal', newGoal);
                self._renderProductivity();
            });
        }
        var loadMore = document.getElementById('projectsLoadMore');
        if (loadMore) loadMore.addEventListener('click', function() {
            self._visibleCount += self._pageSize;
            self.renderProjects();
        });
        var sort = document.getElementById('projectsSort');
        if (sort) {
            var savedSort = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('devspace_sort') : null;
            if (['updated', 'name', 'status'].indexOf(savedSort) !== -1) self._sortMode = savedSort;
            sort.value = self._sortMode;
            sort.addEventListener('change', function() {
                self._sortMode = ['updated', 'name', 'status'].indexOf(sort.value) !== -1 ? sort.value : 'updated';
                if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('devspace_sort', self._sortMode);
                self.renderProjects();
            });
        }
        var savedView = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('devspace_view') : null;
        if (savedView === 'list') self._viewMode = 'list';
        this._applyProjectView();
        (document.querySelectorAll ? document.querySelectorAll('.projects-view-btn') : []).forEach(function(button) {
            button.addEventListener('click', function() {
                self._viewMode = button.dataset.projectsView === 'list' ? 'list' : 'grid';
                if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('devspace_view', self._viewMode);
                self._applyProjectView();
            });
        });
    },

    _initCollapsiblePanels: function() {
        var settings = typeof StorageService !== 'undefined' ? StorageService.get('collapsedPanels', {}) : {};
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
        var isMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches;
        Array.from(document.querySelectorAll ? document.querySelectorAll('[data-collapse-panel]') : []).forEach(function(button) {
            var panel = document.getElementById(button.dataset.collapsePanel);
            if (!panel) return;
            var collapsed = Object.hasOwn(settings, panel.id) ? settings[panel.id] === true : isMobile && panel.id === 'scheduleCalendar';
            RendererModule._setPanelCollapsed(panel, button, collapsed);
            button.addEventListener('click', function() {
                var next = !panel.classList.contains('is-collapsed');
                RendererModule._setPanelCollapsed(panel, button, next);
                var updated = typeof StorageService !== 'undefined' ? StorageService.get('collapsedPanels', {}) : {};
                if (!updated || typeof updated !== 'object' || Array.isArray(updated)) updated = {};
                updated[panel.id] = next;
                if (typeof StorageService !== 'undefined') StorageService.set('collapsedPanels', updated);
            });
        });
    },

    _setPanelCollapsed: function(panel, button, collapsed) {
        panel.classList.toggle('is-collapsed', collapsed);
        button.setAttribute('aria-expanded', String(!collapsed));
        button.textContent = collapsed ? 'Развернуть' : 'Свернуть';
    },

    _applyProjectView: function() {
        var container = this.containers.projects;
        if (container && container.classList) container.classList.toggle('list-view', this._viewMode === 'list');
        (document.querySelectorAll ? document.querySelectorAll('.projects-view-btn') : []).forEach(function(button) {
            var active = button.dataset.projectsView === this._viewMode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }, this);
    },

    isPinned: function(id) {
        return this._pinnedIds.indexOf(String(id)) !== -1;
    },

    togglePinned: function(id) {
        id = String(id);
        if (this.isPinned(id)) this._pinnedIds = this._pinnedIds.filter(function(pin) { return pin !== id; });
        else this._pinnedIds.push(id);
        if (typeof StorageService !== 'undefined') StorageService.set('pinnedProjects', this._pinnedIds.slice());
        this.renderProjects();
        this._updateQuickAccess();
        return this.isPinned(id);
    },

    _renderFocus: function() {
        var panel = document.getElementById('focusPanel');
        var container = document.getElementById('focusProjects');
        var taskArea = document.getElementById('focusTaskArea');
        var taskList = document.getElementById('focusTaskList');
        var taskCount = document.getElementById('focusTaskCount');
        var deadlineSummary = document.getElementById('focusDeadlineSummary');
        var weekArea = document.getElementById('focusWeekArea');
        var weekList = document.getElementById('focusWeekList');
        var weekCount = document.getElementById('focusWeekCount');
        if (!panel || !container) return;
        var all = StateManager.get('projects') || [];
        var byId = {};
        all.forEach(function(project) { byId[String(project.id)] = project; });
        var pinned = this._pinnedIds.map(function(id) { return byId[id]; }).filter(Boolean);
        panel.hidden = pinned.length === 0;
        if (!pinned.length) {
            container.innerHTML = '';
            if (taskArea) taskArea.hidden = true;
            if (taskList) taskList.innerHTML = '';
            if (deadlineSummary) deadlineSummary.hidden = true;
            if (weekArea) weekArea.hidden = true;
            if (weekList) weekList.innerHTML = '';
            return;
        }
        container.innerHTML = pinned.slice(0, 4).map(function(project) {
            var tasks = Array.isArray(project.checklist) ? project.checklist : [];
            var completed = tasks.filter(function(task) { return task.completed; }).length;
            var progress = tasks.length ? Math.round(100 * completed / tasks.length) : Math.max(0, Math.min(100, Number(project.progress) || 0));
            var next = tasks.find(function(task) { return !task.completed && task.text; });
            var taskText = next ? next.text : (tasks.length ? 'Все задачи выполнены' : 'Пока нет задач');
            return '<button type="button" class="focus-project" data-focus-project="' + Helpers.escapeHtml(String(project.id)).replace(/"/g, '&quot;') + '">' +
                '<span class="focus-project-top"><span class="focus-project-name"><i class="bi bi-pin-angle-fill" aria-hidden="true"></i> ' + Helpers.escapeHtml(project.name || 'Без названия') + '</span><span class="focus-project-status">' + Helpers.escapeHtml(Helpers.getStatusText(project.status)) + '</span></span>' +
                '<span class="focus-project-progress"><span class="focus-project-bar" style="width:' + progress + '%"></span></span>' +
                '<span class="focus-project-bottom"><span class="focus-project-next"><i class="bi bi-check2-square" aria-hidden="true"></i> ' + Helpers.escapeHtml(Helpers.truncateText(taskText, 66)) + '</span><span>' + progress + '%</span></span></button>';
        }).join('') + (pinned.length > 4 ? '<p class="focus-project-extra">И ещё ' + (pinned.length - 4) + ' закреплённых проектов ниже</p>' : '');
        if (taskArea && taskList) {
            var upcoming = [];
            pinned.forEach(function(project) {
                var tasks = Array.isArray(project.checklist) ? project.checklist : [];
                tasks.filter(function(task) { return !task.completed && task.text; }).forEach(function(task) {
                    upcoming.push({ project: project, text: task.text, id: task.id, priority: task.priority || 'normal', deadline: task.deadline || '' });
                });
            });
            var now = new Date();
            var localDate = function(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
            var today = localDate(now);
            var weekEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
            var weekEnd = localDate(weekEndDate);
            var rank = { high: 0, normal: 1, low: 2 };
            upcoming.sort(function(a, b) {
                var priorityDifference = (rank[a.priority] == null ? 1 : rank[a.priority]) - (rank[b.priority] == null ? 1 : rank[b.priority]);
                return priorityDifference || (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31');
            });
            var overdue = upcoming.filter(function(task) { return task.deadline && task.deadline < today; }).length;
            var thisWeek = upcoming.filter(function(task) { return task.deadline && task.deadline >= today && task.deadline <= weekEnd; });
            if (deadlineSummary) {
                deadlineSummary.hidden = overdue === 0 && thisWeek.length === 0;
                deadlineSummary.textContent = (overdue ? '⚠️ Просрочено: ' + overdue + ' · ' : '') + '📅 На ближайшие 7 дней: ' + thisWeek.length;
            }
            if (weekArea && weekList) {
                weekArea.hidden = thisWeek.length === 0;
                if (weekCount) weekCount.textContent = '(' + thisWeek.length + ')';
                weekList.innerHTML = thisWeek.slice().sort(function(a, b) { return a.deadline.localeCompare(b.deadline); }).slice(0, 7).map(function(task) {
                    return '<button type="button" class="focus-week-item" data-focus-project="' + Helpers.escapeHtml(String(task.project.id)).replace(/"/g, '&quot;') + '"><time datetime="' + task.deadline + '">' + task.deadline.split('-').reverse().slice(0, 2).join('.') + '</time><span>' + Helpers.escapeHtml(task.text) + '</span><small>' + Helpers.escapeHtml(task.project.name || 'Без названия') + '</small></button>';
                }).join('');
            }
            taskArea.hidden = upcoming.length === 0;
            if (taskCount) taskCount.textContent = '(' + upcoming.length + ')';
            taskList.innerHTML = upcoming.slice(0, 8).map(function(item) {
                var projectId = Helpers.escapeHtml(String(item.project.id)).replace(/"/g, '&quot;');
                var taskId = item.id == null ? null : Helpers.escapeHtml(String(item.id)).replace(/"/g, '&quot;');
                var markDone = taskId === null ? '' : '<button type="button" class="focus-task-check" data-focus-project-id="' + projectId + '" data-focus-complete="' + taskId + '" aria-label="Отметить выполненной: ' + Helpers.escapeHtml(item.text).replace(/"/g, '&quot;') + '" title="Отметить выполненной"><i class="bi bi-circle" aria-hidden="true"></i></button>';
                var priority = ['high', 'low'].indexOf(item.priority) !== -1 ? item.priority : 'normal';
                var select = taskId === null ? '' : '<select class="focus-task-priority priority-' + priority + '" data-focus-project-id="' + projectId + '" data-focus-priority="' + taskId + '" aria-label="Приоритет задачи: ' + Helpers.escapeHtml(item.text).replace(/"/g, '&quot;') + '" title="Приоритет задачи">' +
                    '<option value="high"' + (priority === 'high' ? ' selected' : '') + '>🔴 Высокий</option>' +
                    '<option value="normal"' + (priority === 'normal' ? ' selected' : '') + '>🟡 Обычный</option>' +
                    '<option value="low"' + (priority === 'low' ? ' selected' : '') + '>🟢 Низкий</option></select>';
                var validDeadline = /^\d{4}-\d{2}-\d{2}$/.test(item.deadline) ? item.deadline : '';
                var due = taskId === null ? '' : '<input type="date" class="focus-task-date" data-focus-project-id="' + projectId + '" data-focus-deadline="' + taskId + '" value="' + validDeadline + '" aria-label="Срок задачи: ' + Helpers.escapeHtml(item.text).replace(/"/g, '&quot;') + '" title="Установить или убрать срок задачи">';
                var late = validDeadline && validDeadline < today;
                return '<div class="focus-task' + (late ? ' focus-task-overdue' : '') + '">' + markDone +
                    '<button type="button" class="focus-task-open" data-focus-project="' + projectId + '">' +
                    '<span class="focus-task-text">' + Helpers.escapeHtml(item.text) + '</span>' +
                    '<span class="focus-task-source">' + Helpers.escapeHtml(item.project.name || 'Без названия') + '</span></button><span class="focus-task-actions">' + select + due + '</span></div>';
            }).join('') + (upcoming.length > 8 ? '<p class="focus-task-more">Ещё задач: ' + (upcoming.length - 8) + '</p>' : '');
        }
    },

    _weeklyGoal: function() {
        var value = typeof StorageService !== 'undefined' ? Number(StorageService.get('weeklyGoal', 5)) : 5;
        return Number.isInteger(value) && value >= 1 && value <= 100 ? value : 5;
    },

    _renderProductivity: function() {
        var panel = document.getElementById('productivityPanel');
        if (!panel) return;
        var projects = StateManager.get('projects') || [];
        var allTasks = [];
        projects.forEach(function(project) {
            (Array.isArray(project.checklist) ? project.checklist : []).forEach(function(task) { allTasks.push(task); });
        });
        panel.hidden = allTasks.length === 0;
        if (panel.hidden) return;
        var now = new Date();
        var dateKey = function(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
        var lastSeven = new Set();
        for (var i = 0; i < 7; i++) lastSeven.add(dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
        var completedDates = new Set();
        var completedThisWeek = 0;
        allTasks.forEach(function(task) {
            if (!task.completed || typeof task.completedAt !== 'string') return;
            var date = new Date(task.completedAt);
            if (Number.isNaN(date.getTime()) || date > now) return;
            var key = dateKey(date);
            completedDates.add(key);
            if (lastSeven.has(key)) completedThisWeek++;
        });
        var streak = 0;
        var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        var startDay = completedDates.has(dateKey(now)) ? now : yesterday;
        for (var day = 0; day < 365; day++) {
            var checkDate = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() - day);
            if (!completedDates.has(dateKey(checkDate))) break;
            streak++;
        }
        var target = this._weeklyGoal();
        var progress = Math.min(100, Math.round(completedThisWeek / target * 100));
        var doneNode = document.getElementById('productivityDone');
        var streakNode = document.getElementById('productivityStreak');
        var progressNode = document.getElementById('productivityProgress');
        var fill = document.getElementById('productivityBarFill');
        var bar = document.getElementById('productivityBar');
        var reward = document.getElementById('productivityAchievement');
        if (doneNode) doneNode.textContent = String(completedThisWeek);
        if (streakNode) streakNode.textContent = String(streak);
        if (progressNode) progressNode.textContent = progress + '%';
        if (fill) fill.style.width = progress + '%';
        if (bar) bar.setAttribute('aria-valuenow', String(progress));
        if (reward) reward.hidden = completedThisWeek < target;
    },

    _collectRoadmapDeadlines: function(projects, now) {
        var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
        var end = endDate.getFullYear() + '-' + String(endDate.getMonth() + 1).padStart(2, '0') + '-' + String(endDate.getDate()).padStart(2, '0');
        var allStages = 0, completedStages = 0, entries = [];
        (projects || []).forEach(function(project) {
            var stages = Array.isArray(project.milestones) ? project.milestones : [];
            var tasks = Array.isArray(project.checklist) ? project.checklist : [];
            var completed = Array.isArray(project.completedMilestones) ? project.completedMilestones : [];
            var dates = project.milestoneDeadlines && typeof project.milestoneDeadlines === 'object' && !Array.isArray(project.milestoneDeadlines) ? project.milestoneDeadlines : {};
            stages.forEach(function(stage) {
                if (typeof stage !== 'string' || !stage.trim()) return;
                allStages++;
                var linked = tasks.filter(function(task) { return task.milestone === stage; });
                var done = linked.length ? linked.every(function(task) { return task.completed; }) : completed.indexOf(stage) !== -1;
                if (done) { completedStages++; return; }
                var date = Object.hasOwn(dates, stage) ? dates[stage] : '';
                if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
                if (date < today || date <= end) entries.push({ project: project, stage: stage, date: date, overdue: date < today });
            });
        });
        entries.sort(function(a, b) { return a.date.localeCompare(b.date) || String(a.project.name || '').localeCompare(String(b.project.name || '')); });
        return { total: allStages, completed: completedStages, overdue: entries.filter(function(item) { return item.overdue; }), week: entries.filter(function(item) { return !item.overdue; }) };
    },

    _renderRoadmapOverview: function() {
        var panel = document.getElementById('roadmapOverview');
        if (!panel) return;
        var overview = this._collectRoadmapDeadlines(StateManager.get('projects') || [], new Date());
        panel.hidden = !overview.overdue.length && !overview.week.length;
        if (panel.hidden) return;
        var summary = document.getElementById('roadmapOverviewSummary');
        if (summary) summary.textContent = 'Завершено ' + overview.completed + ' из ' + overview.total + ' этапов';
        var render = function(items) { return items.slice(0, 10).map(function(item) {
            var id = Helpers.escapeHtml(String(item.project.id)).replace(/"/g, '&quot;');
            var formatted = item.date.slice(8, 10) + '.' + item.date.slice(5, 7);
            return '<button type="button" class="roadmap-overview-item' + (item.overdue ? ' late' : '') + '" data-focus-project="' + id + '"><time datetime="' + item.date + '">' + formatted + '</time><span><strong>' + Helpers.escapeHtml(item.stage) + '</strong><small>' + Helpers.escapeHtml(item.project.name || 'Без названия') + '</small></span></button>';
        }).join('') + (items.length > 10 ? '<p class="roadmap-overview-more">Ещё этапов: ' + (items.length - 10) + '</p>' : ''); };
        [['roadmapOverdueArea', 'roadmapOverdueCount', 'roadmapOverdueList', overview.overdue], ['roadmapWeekArea', 'roadmapWeekCount', 'roadmapWeekList', overview.week]].forEach(function(group) {
            var area = document.getElementById(group[0]);
            var count = document.getElementById(group[1]);
            var list = document.getElementById(group[2]);
            if (area) area.hidden = group[3].length === 0;
            if (count) count.textContent = '(' + group[3].length + ')';
            if (list) list.innerHTML = render(group[3]);
        });
    },

    _collectTodayTasks: function(projects, now, priority, scope) {
        var pad = function(value) { return String(value).padStart(2, '0'); };
        var dateKey = function(value) { return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate()); };
        var today = dateKey(now);
        var week = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6));
        var rank = { high: 0, normal: 1, low: 2 };
        var tasks = [];
        (projects || []).forEach(function(project) {
            (Array.isArray(project.checklist) ? project.checklist : []).forEach(function(task) {
                if (!task || task.completed || typeof task.text !== 'string' || !task.text.trim()) return;
                var level = Object.hasOwn(rank, task.priority) ? task.priority : 'normal';
                var due = typeof task.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadline) ? task.deadline : '';
                if (priority !== 'all' && level !== priority) return;
                if (scope === 'urgent' && !(level === 'high' || due && due <= today)) return;
                if (scope === 'week' && !(due && due <= week)) return;
                tasks.push({ projectId: project.id, projectName: project.name || 'Без названия', id: task.id, text: task.text, priority: level, deadline: due });
            });
        });
        return tasks.sort(function(a, b) {
            var aLate = a.deadline && a.deadline < today ? 0 : 1;
            var bLate = b.deadline && b.deadline < today ? 0 : 1;
            return aLate - bLate || rank[a.priority] - rank[b.priority] || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.projectName.localeCompare(b.projectName);
        });
    },

    _collectWeeklyLoad: function(projects, now) {
        var all = this._collectTodayTasks((projects || []).filter(function(project) {
            return project && project.status !== 'completed' && project.status !== 'archived';
        }), now, 'all', 'all');
        var days = [];
        var names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        for (var i = 0; i < 7; i++) {
            var date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
            var key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
            days.push({ key: key, label: names[date.getDay()], date: date.getDate(), count: all.filter(function(task) { return task.deadline === key; }).length });
        }
        return days;
    },

    _suggestWeeklyDate: function(days, current) {
        if (!Array.isArray(days) || !days.length) return null;
        var source = days.find(function(day) { return day.key === current; });
        if (current && (!source || source.count < 4)) return null;
        var candidates = days.filter(function(day) {
            return (!current || day.key > current) && day.count < 4;
        });
        return candidates.sort(function(a, b) { return a.count - b.count || a.key.localeCompare(b.key); })[0] || null;
    },

    _filterAndSortTasks: function(tasks, query, sort) {
        var needle = String(query || '').trim().toLocaleLowerCase();
        var rank = { high: 0, normal: 1, low: 2 };
        var matches = (tasks || []).filter(function(task) {
            return !needle || (String(task.text || '') + ' ' + String(task.projectName || '')).toLocaleLowerCase().includes(needle);
        });
        if (sort === 'deadline') return matches.sort(function(a, b) {
            return (a.deadline || '9999').localeCompare(b.deadline || '9999') || (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
        });
        if (sort === 'project') return matches.sort(function(a, b) {
            return String(a.projectName || '').localeCompare(String(b.projectName || ''), 'ru') || (a.deadline || '9999').localeCompare(b.deadline || '9999');
        });
        return matches;
    },

    _restoreTodayPreferences: function() {
        var saved = typeof StorageService !== 'undefined' ? StorageService.get('todayPreferences', {}) : {};
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
        var view = ['today', 'upcoming', 'overdue', 'undated', 'all'];
        if (view.includes(saved.view)) this._todayView = saved.view;
        var priority = document.getElementById('todayPriority');
        if (priority && ['all', 'high', 'normal', 'low'].includes(saved.priority)) priority.value = saved.priority;
        var sort = document.getElementById('todaySort');
        if (sort && ['priority', 'deadline', 'project'].includes(saved.sort)) sort.value = saved.sort;
        var group = document.getElementById('todayGroupByProject');
        if (group) group.checked = saved.group === true;
    },

    _saveTodayPreferences: function() {
        if (typeof StorageService === 'undefined') return;
        var priority = document.getElementById('todayPriority');
        var sort = document.getElementById('todaySort');
        var group = document.getElementById('todayGroupByProject');
        StorageService.set('todayPreferences', {
            view: this._todayView || 'today',
            priority: priority ? priority.value : 'all',
            sort: sort ? sort.value : 'priority',
            group: !!(group && group.checked)
        });
    },

    _validBulkTargets: function() {
        return Array.from(this._todaySelectedTasks.values()).filter(function(target) {
            var project = StateManager.getProject(target.projectId);
            return project && project.status !== 'completed' && project.status !== 'archived' && Array.isArray(project.checklist) && project.checklist.some(function(task) {
                return task && !task.completed && String(task.id) === target.itemId;
            });
        });
    },

    _prepareBulkUndo: function(targets, priority, deadline) {
        var entries = (targets || []).map(function(target) {
            var project = StateManager.getProject(target.projectId);
            var task = project && project.checklist.find(function(item) { return String(item.id) === String(target.itemId); });
            if (!task) return null;
            var beforePriority = task.priority || 'normal';
            var beforeDeadline = task.deadline || '';
            return {
                projectId: target.projectId, itemId: target.itemId,
                beforePriority: beforePriority, beforeDeadline: beforeDeadline,
                afterPriority: priority || beforePriority, afterDeadline: deadline || beforeDeadline,
                priorityChanged: !!priority && priority !== beforePriority,
                deadlineChanged: !!deadline && deadline !== beforeDeadline
            };
        }).filter(function(entry) { return entry && (entry.priorityChanged || entry.deadlineChanged); });
        return entries.length ? { entries: entries } : null;
    },

    _canUndoBulk: function(record) {
        return !!record && Array.isArray(record.entries) && record.entries.length > 0 && record.entries.every(function(entry) {
            var project = StateManager.getProject(entry.projectId);
            if (!project || project.status === 'completed' || project.status === 'archived') return false;
            var task = (project.checklist || []).find(function(item) { return String(item.id) === String(entry.itemId); });
            if (!task || task.completed) return false;
            return (!entry.priorityChanged || (task.priority || 'normal') === entry.afterPriority) &&
                (!entry.deadlineChanged || (task.deadline || '') === entry.afterDeadline);
        });
    },

    _renderBulkControls: function() {
        var form = document.getElementById('todayBulkForm');
        if (!form) return;
        var count = typeof AuthService !== 'undefined' && AuthService.isOwner() ? this._validBulkTargets().length : 0;
        form.hidden = count === 0;
        var label = document.getElementById('todayBulkCount');
        if (label) label.textContent = 'Выбрано: ' + count;
        var undo = document.getElementById('todayUndoBulk');
        if (undo) undo.hidden = !(typeof AuthService !== 'undefined' && AuthService.isOwner() && this._todayBulkUndo);
        var undoCount = document.getElementById('todayUndoCount');
        if (undoCount) undoCount.textContent = this._todayBulkUndo ? '(' + this._todayBulkUndo.entries.length + ')' : '';
    },

    _renderWeeklyLoad: function(projects, now) {
        var container = document.getElementById('weeklyLoadDays');
        if (!container) return;
        var days = this._collectWeeklyLoad(projects, now);
        var max = Math.max(1, ...days.map(function(day) { return day.count; }));
        var total = days.reduce(function(sum, day) { return sum + day.count; }, 0);
        var summary = document.getElementById('weeklyLoadSummary');
        var busy = days.filter(function(day) { return day.count >= 4; }).length;
        var free = days.filter(function(day) { return day.count < 4; }).length;
        if (summary) summary.textContent = total ? total + ' задач · ' + (busy ? 'загруженных дней: ' + busy + ' · свободнее: ' + free : 'неделя без перегрузок') + ' · выбери день' : 'На ближайшие 7 дней задачи пока не назначены';
        var clear = document.getElementById('weeklyLoadClear');
        if (clear) clear.hidden = !this._todaySelectedDay;
        var selected = this._todaySelectedDay;
        container.innerHTML = days.map(function(day, index) {
            var active = selected === day.key;
            var height = Math.round(100 * day.count / max);
            var load = day.count >= 4 ? 'Высокая нагрузка' : day.count >= 2 ? 'Средняя нагрузка' : day.count ? 'Низкая нагрузка' : 'Свободный день';
            var label = day.label + ', ' + day.date + ' · задач: ' + day.count + ' · ' + load;
            return '<button type="button" class="weekly-load-day' + (index === 0 ? ' is-today' : '') + (day.count >= 4 ? ' is-busy' : day.count >= 2 ? ' is-moderate' : ' is-light') + (active ? ' is-selected' : '') + '" data-weekly-day="' + day.key + '" aria-label="' + label + '" aria-pressed="' + active + '" title="' + label + '"><span class="weekly-load-label">' + day.label + '</span><span class="weekly-load-bar-track"><span class="weekly-load-bar" style="height:' + height + '%"></span></span><strong>' + day.count + '</strong><small>' + day.date + '</small></button>';
        }).join('');
    },

    _renderToday: function() {
        var list = document.getElementById('todayList');
        if (!list) return;
        var priority = document.getElementById('todayPriority');
        var filterLabel = document.getElementById('todayMobileFilterLabel');
        if (filterLabel) {
            var sortInput = document.getElementById('todaySort');
            var groupInput = document.getElementById('todayGroupByProject');
            var activeFilters = (priority && priority.value !== 'all' ? 1 : 0) + (sortInput && sortInput.value !== 'priority' ? 1 : 0) + (groupInput && groupInput.checked ? 1 : 0);
            filterLabel.textContent = 'Дополнительные фильтры' + (activeFilters ? ' · ' + activeFilters : '');
        }
        var scope = document.getElementById('todayScope');
        var projects = StateManager.get('projects') || [];
        var now = new Date();
        var weeklyDays = this._collectWeeklyLoad(projects, now);
        this._renderWeeklyLoad(projects, now);
        var activeProjects = projects.filter(function(project) { return project && project.status !== 'completed' && project.status !== 'archived'; });
        var tasks = this._collectTodayTasks(this._todaySelectedDay ? activeProjects : projects, now, priority ? priority.value : 'all', scope ? scope.value : 'all');
        var view = this._todayView || 'today';
        var todayKey = new Date();
        var dateKey = todayKey.getFullYear() + '-' + String(todayKey.getMonth() + 1).padStart(2, '0') + '-' + String(todayKey.getDate()).padStart(2, '0');
        var selectedDay = this._todaySelectedDay;
        tasks = tasks.filter(function(task) {
            if (selectedDay) return task.deadline === selectedDay;
            if (view === 'all') return true;
            if (view === 'overdue') return !!task.deadline && task.deadline < dateKey;
            if (view === 'undated') return !task.deadline;
            if (view === 'upcoming') return !!task.deadline && task.deadline > dateKey;
            return task.deadline === dateKey || (!task.deadline && task.priority === 'high');
        });
        var search = document.getElementById('todaySearch');
        var sort = document.getElementById('todaySort');
        tasks = this._filterAndSortTasks(tasks, search ? search.value : '', sort ? sort.value : 'priority');
        var visible = Math.max(8, this._todayVisibleCount || 8);
        var more = document.getElementById('todayMore');
        if (more) more.hidden = tasks.length <= visible;
        document.querySelectorAll('#todayPanel [data-today-view]').forEach(function(button) {
            var active = !selectedDay && button.dataset.todayView === view;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        var summary = document.getElementById('todaySummary');
        if (summary) summary.textContent = (selectedDay ? 'На ' + selectedDay.slice(8, 10) + '.' + selectedDay.slice(5, 7) + ' · ' : '') + (tasks.length ? 'Найдено задач: ' + tasks.length + ' · показано ' + Math.min(tasks.length, visible) : 'Задач по выбранным условиям пока нет');
        var today = new Date();
        var key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        var canEdit = typeof AuthService !== 'undefined' && AuthService.isOwner();
        this._renderBulkControls();
        var recommend = this._suggestWeeklyDate.bind(this);
        var selectedTasks = this._todaySelectedTasks;
        var visibleTasks = tasks.slice(0, visible);
        var rows = visibleTasks.map(function(task) {
            var projectId = Helpers.escapeHtml(String(task.projectId)).replace(/"/g, '&quot;');
            var id = task.id == null ? null : Helpers.escapeHtml(String(task.id)).replace(/"/g, '&quot;');
            var late = task.deadline && task.deadline < key;
            var due = task.deadline ? (late ? 'Просрочено · ' : '') + task.deadline.slice(8, 10) + '.' + task.deadline.slice(5, 7) : 'Без срока';
            var editor = canEdit && id !== null ? '<span class="today-inline-edit" data-today-edit-project="' + projectId + '" data-today-edit-item="' + id + '"><label>Приоритет<select data-today-edit-priority aria-label="Приоритет задачи"><option value="normal"' + (task.priority === 'normal' ? ' selected' : '') + '>Обычный</option><option value="high"' + (task.priority === 'high' ? ' selected' : '') + '>Высокий</option><option value="low"' + (task.priority === 'low' ? ' selected' : '') + '>Низкий</option></select></label><label>Срок<input type="date" data-today-edit-deadline aria-label="Срок задачи" value="' + task.deadline + '"></label></span>' : '';
            var suggestion = canEdit && id !== null ? recommend(weeklyDays, task.deadline) : null;
            var move = suggestion ? '<button type="button" class="today-suggest-move" data-today-project="' + projectId + '" data-today-move="' + id + '" data-today-date="' + suggestion.key + '" title="Назначить срок на менее загруженный день">На ' + suggestion.key.slice(8, 10) + '.' + suggestion.key.slice(5, 7) + ' <i class="bi bi-arrow-right" aria-hidden="true"></i></button>' : '';
            var token = JSON.stringify([String(task.projectId), String(task.id)]);
            var select = canEdit && id !== null ? '<label class="today-select-label"><input type="checkbox" data-today-select="' + id + '" data-today-project="' + projectId + '" aria-label="Выбрать задачу: ' + Helpers.escapeHtml(task.text).replace(/"/g, '&quot;') + '"' + (selectedTasks.has(token) ? ' checked' : '') + '></label>' : '';
            var editToggle = canEdit && id !== null ? '<button type="button" class="today-edit-toggle" data-today-edit-toggle aria-expanded="false">Изменить <i class="bi bi-sliders" aria-hidden="true"></i></button>' : '';
            return '<div class="today-task' + (late ? ' is-late' : '') + '">' + select + (id === null ? '' : '<button type="button" class="today-check" data-today-project="' + projectId + '" data-today-complete="' + id + '" aria-label="Завершить задачу: ' + Helpers.escapeHtml(task.text).replace(/"/g, '&quot;') + '">○</button>') + '<button type="button" class="today-open" data-focus-project="' + projectId + '"><strong>' + Helpers.escapeHtml(task.text) + '</strong><small>' + Helpers.escapeHtml(task.projectName) + '</small></button><span class="today-meta"><span class="today-priority priority-' + task.priority + '">' + (task.priority === 'high' ? 'Высокий' : task.priority === 'low' ? 'Низкий' : 'Обычный') + '</span><time>' + due + '</time></span>' + editToggle + editor + move + '</div>';
        });
        var groupMode = document.getElementById('todayGroupByProject');
        if (groupMode && groupMode.checked) {
            var grouped = new Map();
            visibleTasks.forEach(function(task, index) {
                var id = String(task.projectId);
                if (!grouped.has(id)) grouped.set(id, { name: task.projectName, rows: [] });
                grouped.get(id).rows.push(rows[index]);
            });
            var collapsedGroups = this._todayCollapsedGroups;
            list.innerHTML = grouped.size ? Array.from(grouped, function(entry) {
                var id = entry[0];
                var group = entry[1];
                var collapsed = collapsedGroups.has(id);
                return '<section class="today-project-group' + (collapsed ? ' is-collapsed' : '') + '"><button type="button" class="today-project-heading" data-today-group="' + Helpers.escapeHtml(id).replace(/"/g, '&quot;') + '" aria-expanded="' + !collapsed + '"><strong>' + Helpers.escapeHtml(group.name) + '</strong><span>' + group.rows.length + ' задач <i class="bi bi-chevron-down" aria-hidden="true"></i></span></button><div class="today-project-rows">' + group.rows.join('') + '</div></section>';
            }).join('') : '<p class="today-empty">✨ Задач по выбранным условиям пока нет.</p>';
        } else {
            list.innerHTML = rows.length ? rows.join('') : '<p class="today-empty">✨ Всё спокойно! Можно выбрать другой фильтр или назначить сроки в проектах.</p>';
        }
    },

    _collectInsights: function(projects, now) {
        var day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
        var fortnight = day.getTime() - 14 * 86400000;
        var items = [];
        (projects || []).forEach(function(project) {
            if (!project || project.status === 'completed' || project.status === 'archived') return;
            var tasks = Array.isArray(project.checklist) ? project.checklist : [];
            var overdue = tasks.filter(function(task) { return task && !task.completed && typeof task.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadline) && task.deadline < key; }).length;
            if (overdue) items.push({ projectId: project.id, name: project.name || 'Без названия', kind: 'overdue', count: overdue, label: 'Просроченных задач: ' + overdue });
            var timestamp = typeof project.updatedAt === 'string' ? Date.parse(project.updatedAt) : NaN;
            if (Number.isFinite(timestamp) && timestamp >= 0 && timestamp < fortnight && tasks.some(function(task) { return task && !task.completed; })) {
                var days = Math.floor((day.getTime() - timestamp) / 86400000);
                items.push({ projectId: project.id, name: project.name || 'Без названия', kind: 'stale', count: days, label: 'Нет обновлений ' + days + ' дн.' });
            }
        });
        return items.sort(function(a, b) { return (a.kind === 'overdue' ? 0 : 1) - (b.kind === 'overdue' ? 0 : 1) || b.count - a.count || a.name.localeCompare(b.name); });
    },

    _collectProjectHealth: function(projects, now) {
        var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var key = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
        return (projects || []).filter(function(project) { return project && project.status !== 'completed' && project.status !== 'archived'; }).map(function(project) {
            var tasks = Array.isArray(project.checklist) ? project.checklist.filter(function(task) { return task && typeof task.text === 'string' && task.text.trim(); }) : [];
            var open = tasks.filter(function(task) { return !task.completed; });
            var overdue = open.filter(function(task) { return typeof task.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadline) && task.deadline < key; });
            var timestamp = typeof project.updatedAt === 'string' ? Date.parse(project.updatedAt) : NaN;
            var inactiveDays = Number.isFinite(timestamp) && timestamp >= 0 && timestamp < start.getTime() ? Math.floor((start.getTime() - timestamp) / 86400000) : 0;
            var hasPlan = tasks.length > 0;
            var score = hasPlan ? Math.max(0, 100 - Math.min(overdue.length, 3) * 20 - (inactiveDays > 14 && open.length ? 15 : 0) - (open.length && tasks.every(function(task) { return !task.deadline; }) ? 10 : 0) - Math.round(open.length / tasks.length * 10)) : null;
            var advice = !hasPlan ? 'Добавь первые задачи' : overdue.length ? 'Разбери просроченные задачи' : inactiveDays > 14 && open.length ? 'Обнови прогресс проекта' : open.length ? 'Продолжай следующий шаг' : 'Проверь завершение проекта';
            return { id: project.id, name: project.name || 'Без названия', score: score, overdue: overdue.length, inactiveDays: inactiveDays, completed: tasks.length - open.length, total: tasks.length, undated: open.length && tasks.every(function(task) { return !task.deadline; }) ? 10 : 0, advice: advice };
        }).sort(function(a, b) {
            return (a.score === null ? 101 : a.score) - (b.score === null ? 101 : b.score) || b.overdue - a.overdue || a.name.localeCompare(b.name);
        });
    },

    _updateHealthHistory: function(history, health, date) {
        var key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        var entries = Array.isArray(history) ? history.filter(function(row) {
            return row && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.scores && typeof row.scores === 'object' && !Array.isArray(row.scores) && row.date <= key;
        }).slice(-29).map(function(row) { return { date: row.date, scores: Object.assign({}, row.scores) }; }) : [];
        var scores = {};
        (health || []).forEach(function(item) {
            if (item && item.id != null && Number.isInteger(item.score) && item.score >= 0 && item.score <= 100) scores[String(item.id)] = item.score;
        });
        var index = entries.findIndex(function(row) { return row.date === key; });
        if (index !== -1) entries.splice(index, 1);
        entries.push({ date: key, scores: scores });
        return entries.sort(function(a, b) { return a.date.localeCompare(b.date); }).slice(-30);
    },

    _healthTrend: function(history, id, current) {
        if (current === null) return { label: 'Без истории', direction: 'neutral' };
        var key = String(id);
        var earlier = (history || []).filter(function(row) { return row && row.scores && Number.isInteger(row.scores[key]); });
        if (earlier.length < 2) return { label: 'Первый замер', direction: 'neutral' };
        var previous = earlier[earlier.length - 2].scores[key];
        var difference = current - previous;
        return { label: difference > 0 ? '↑ +' + difference + ' с прошлого замера' : difference < 0 ? '↓ ' + difference + ' с прошлого замера' : 'Без изменений', direction: difference > 0 ? 'up' : difference < 0 ? 'down' : 'neutral' };
    },

    _healthSeries: function(history, id) {
        return (history || []).filter(function(row) { return row && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.scores && Number.isInteger(row.scores[String(id)]) && row.scores[String(id)] >= 0 && row.scores[String(id)] <= 100; }).map(function(row) { return { date: row.date, score: row.scores[String(id)] }; });
    },

    _healthRecommendations: function(item) {
        if (!item || item.score === null) return [{ kind: 'plan', label: 'Создай план', detail: 'Добавь хотя бы одну конкретную задачу: тогда появится оценка состояния.' }];
        var recommendations = [];
        if (item.overdue) recommendations.push({ kind: 'overdue', label: 'Разбери просрочки', detail: 'Просроченных задач: ' + item.overdue + '. Каждая из первых трёх уменьшает оценку на 20 баллов. Переноси сроки только при реальном изменении плана.' });
        if (item.inactiveDays > 14 && item.completed < item.total) recommendations.push({ kind: 'stale', label: 'Зафиксируй прогресс', detail: 'Последнее обновление: ' + item.inactiveDays + ' дн. назад. Актуализация проекта может убрать штраф 15 баллов.' });
        if (item.undated) recommendations.push({ kind: 'deadlines', label: 'Определи ближайшие сроки', detail: 'У открытых задач нет сроков. Добавь реальные даты, чтобы убрать штраф 10 баллов.' });
        if (item.completed < item.total) recommendations.push({ kind: 'progress', label: 'Заверши следующий шаг', detail: 'Выполнено ' + item.completed + ' из ' + item.total + ' задач. Доля незавершённых задач влияет на оценку (до 10 баллов).' });
        return recommendations.length ? recommendations : [{ kind: 'stable', label: 'Поддерживай темп', detail: 'Просрочек и открытых задач нет. Проверь, готов ли проект к завершению.' }];
    },

    _collectHealthAlerts: function(health, history) {
        var result = [];
        (health || []).forEach(function(item) {
            if (item.score === null) return;
            var readings = RendererModule._healthSeries(history, item.id);
            var previous = readings.length > 1 ? readings[readings.length - 2].score : null;
            var drop = previous === null ? 0 : previous - item.score;
            if (drop >= 10) result.push({ id: item.id, name: item.name, kind: 'decline', severity: 0, label: 'Оценка снизилась на ' + drop + ' баллов с прошлого замера' });
            if (item.score < 60) result.push({ id: item.id, name: item.name, kind: 'risk', severity: 1, label: 'Высокий риск · ' + item.score + '/100' });
        });
        return result.sort(function(a, b) { return a.severity - b.severity || a.name.localeCompare(b.name); });
    },

    _collectDeadlineOutlook: function(projects, now) {
        var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        var summary = { overdue: 0, week: 0, fortnight: 0, later: 0, unscheduled: 0, projects: [] };
        (projects || []).forEach(function(project) {
            if (!project || project.status === 'completed' || project.status === 'archived') return;
            var counts = { overdue: 0, week: 0, fortnight: 0, later: 0, unscheduled: 0 };
            (Array.isArray(project.checklist) ? project.checklist : []).forEach(function(task) {
                if (!task || task.completed || typeof task.text !== 'string' || !task.text.trim()) return;
                var deadline = task.deadline;
                if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) { counts.unscheduled++; return; }
                var target = Date.parse(deadline + 'T00:00:00Z');
                if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== deadline) { counts.unscheduled++; return; }
                var days = Math.round((target - today) / 86400000);
                counts[days < 0 ? 'overdue' : days < 7 ? 'week' : days < 14 ? 'fortnight' : 'later']++;
            });
            Object.keys(counts).forEach(function(key) { summary[key] += counts[key]; });
            if (counts.overdue || counts.week || counts.fortnight) summary.projects.push({ id: project.id, name: project.name || 'Без названия', overdue: counts.overdue, week: counts.week, fortnight: counts.fortnight });
        });
        summary.projects.sort(function(a, b) { return b.overdue - a.overdue || b.week - a.week || b.fortnight - a.fortnight || a.name.localeCompare(b.name); });
        return summary;
    },

    _renderDeadlineOutlook: function(projects) {
        var container = document.getElementById('deadlineOutlook');
        if (!container) return;
        var outlook = this._collectDeadlineOutlook(projects, new Date());
        container.innerHTML = '<h4>📅 Нагрузка по срокам</h4><div class="deadline-outlook-stats"><span><b>' + outlook.overdue + '</b>Просрочены</span><span><b>' + outlook.week + '</b>За 7 дней</span><span><b>' + outlook.fortnight + '</b>За 8–14 дней</span></div>' +
            (outlook.projects.length ? '<div class="deadline-outlook-projects">' + outlook.projects.slice(0, 4).map(function(item) {
                var id = Helpers.escapeHtml(String(item.id)).replace(/"/g, '&quot;');
                return '<button type="button" data-insight-project="' + id + '"><strong>' + Helpers.escapeHtml(item.name) + '</strong><small>Просрочены: ' + item.overdue + ' · 7 дней: ' + item.week + ' · 8–14 дней: ' + item.fortnight + '</small></button>';
            }).join('') + '</div>' : '<p>На ближайшие 14 дней задач со сроками нет.</p>') + '<p class="deadline-outlook-note">Без сроков: ' + outlook.unscheduled + '. Прогноз основан на датах задач, без оценки скорости выполнения.</p>';
    },

    _renderHealthAlerts: function(health, history) {
        var container = document.getElementById('healthAlerts');
        if (!container) return;
        var alerts = this._collectHealthAlerts(health, history);
        container.innerHTML = alerts.length ? '<strong class="health-alerts-heading">⚠️ Сигналы состояния · ' + alerts.length + '</strong>' + alerts.slice(0, 3).map(function(alert) {
            var id = Helpers.escapeHtml(String(alert.id)).replace(/"/g, '&quot;');
            return '<button type="button" class="health-alert health-alert-' + alert.kind + '" data-insight-project="' + id + '"><span><b>' + Helpers.escapeHtml(alert.name) + '</b><small>' + Helpers.escapeHtml(alert.label) + '</small></span><span aria-hidden="true">↗</span></button>';
        }).join('') + (alerts.length > 3 ? '<small>Ещё сигналов: ' + (alerts.length - 3) + '</small>' : '') : '';
    },

    _healthChartSvg: function(series, comparison) {
        var second = comparison || [];
        var combined = series.concat(second).sort(function(a, b) { return a.date.localeCompare(b.date); });
        if (!combined.length) return '<p>История появится после первого замера.</p>';
        var dates = combined.map(function(item) { return item.date; });
        var firstDay = Date.parse(dates[0] + 'T00:00:00Z');
        var span = Math.max(1, (Date.parse(dates[dates.length - 1] + 'T00:00:00Z') - firstDay) / 86400000);
        var plot = function(items, style) {
            if (!items.length) return '';
            var points = items.map(function(item) { return (12 + (Date.parse(item.date + 'T00:00:00Z') - firstDay) / 86400000 * 276 / span).toFixed(2) + ',' + (112 - item.score); });
            var last = items[items.length - 1];
            return '<polyline points="' + points.join(' ') + '" class="health-line ' + style + '"/><circle cx="' + points[points.length - 1].split(',')[0] + '" cy="' + (112 - last.score) + '" r="4" class="health-dot ' + style + '"/>';
        };
        var latest = series.length ? series[series.length - 1] : null;
        var other = second.length ? second[second.length - 1] : null;
        return '<svg viewBox="0 0 300 130" preserveAspectRatio="none" aria-hidden="true"><path d="M12 12H288 M12 62H288 M12 112H288" class="health-grid"/>' + plot(series, '') + plot(second, 'health-comparison') + '</svg><span>' + dates[0] + ' → ' + dates[dates.length - 1] + (latest ? ' · Основной: ' + latest.score + '/100' : '') + (other ? ' · Сравнение: ' + other.score + '/100' : '') + '</span>';
    },

    _renderHealthAnalytics: function(health, history) {
        var filter = document.getElementById('healthProjectFilter');
        var compare = document.getElementById('healthCompareFilter');
        var period = document.getElementById('healthPeriodFilter');
        var chart = document.getElementById('healthChart');
        var details = document.getElementById('healthScoreDetails');
        if (!filter || !compare || !period || !chart || !details) return;
        var selected = filter.value;
        var compared = compare.value;
        filter.innerHTML = '<option value="all">Все проекты</option>' + health.map(function(item) { return '<option value="' + Helpers.escapeHtml(String(item.id)).replace(/"/g, '&quot;') + '">' + Helpers.escapeHtml(item.name) + '</option>'; }).join('');
        filter.value = health.some(function(item) { return String(item.id) === selected; }) ? selected : 'all';
        compare.innerHTML = '<option value="none">Без сравнения</option>' + health.filter(function(item) { return item.score !== null; }).map(function(item) { return '<option value="' + Helpers.escapeHtml(String(item.id)).replace(/"/g, '&quot;') + '">' + Helpers.escapeHtml(item.name) + '</option>'; }).join('');
        compare.value = health.some(function(item) { return String(item.id) === compared && item.score !== null; }) && compared !== filter.value ? compared : 'none';
        var days = [7, 14, 30].includes(Number(period.value)) ? Number(period.value) : 30;
        var today = new Date();
        var cutoff = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - days + 1)).toISOString().slice(0, 10);
        var recent = history.filter(function(row) { return row && typeof row.date === 'string' && row.date >= cutoff; });
        var comparison = compare.value === 'none' ? [] : this._healthSeries(recent, compare.value);
        var item = health.find(function(entry) { return String(entry.id) === filter.value; });
        if (filter.value === 'all') {
            var ids = health.filter(function(entry) { return entry.score !== null; }).map(function(entry) { return String(entry.id); });
            var aggregate = recent.map(function(row) {
                var values = ids.map(function(id) { return row.scores && row.scores[id]; }).filter(Number.isInteger);
                return { date: row.date, score: values.length ? Math.round(values.reduce(function(sum, value) { return sum + value; }, 0) / values.length) : null };
            }).filter(function(row) { return row.score !== null && /^\d{4}-\d{2}-\d{2}$/.test(row.date); });
            chart.innerHTML = this._healthChartSvg(aggregate, comparison);
        details.textContent = 'Средняя оценка по ' + ids.length + ' проектам с задачами. График учитывает только проекты с доступной оценкой. Выбери проект, чтобы увидеть рекомендации.';
        } else if (item) {
        var series = this._healthSeries(recent, item.id);
        chart.innerHTML = this._healthChartSvg(series, comparison);
        var penalties = ['Просрочки: −' + Math.min(item.overdue, 3) * 20, 'Долгое отсутствие обновлений: −' + (item.inactiveDays > 14 && item.total > item.completed ? 15 : 0), 'Нет сроков: −' + item.undated, 'Незавершённые задачи: −' + (item.total ? Math.round((item.total - item.completed) / item.total * 10) : 0)];
        details.textContent = item.name + ': ' + (item.score === null ? 'оценка недоступна, пока нет задач' : item.score + '/100 · ' + penalties.join(' · '));
        var tips = this._healthRecommendations(item);
        var tipList = document.getElementById('healthRecommendations');
        if (tipList) tipList.innerHTML = tips.map(function(tip) { return '<li><strong>' + Helpers.escapeHtml(tip.label) + '</strong><span>' + Helpers.escapeHtml(tip.detail) + '</span></li>'; }).join('');
        } else { chart.innerHTML = '<p>Нет данных.</p>'; details.textContent = ''; }
        if (filter.value === 'all' || !item) {
            var allTips = document.getElementById('healthRecommendations');
            if (allTips) {
                var priority = health.find(function(entry) { return entry.score !== null && entry.score < 85; }) || health.find(function(entry) { return entry.score === null; });
                allTips.innerHTML = priority ? '<li><strong>' + Helpers.escapeHtml(priority.name) + '</strong><span>' + Helpers.escapeHtml(this._healthRecommendations(priority)[0].detail) + '</span></li>' : '<li><strong>Всё спокойно</strong><span>Пока нет критичных сигналов по активным проектам.</span></li>';
            }
        }
        filter.onchange = function() { RendererModule._renderHealthAnalytics(health, history); };
        compare.onchange = filter.onchange;
        period.onchange = filter.onchange;
    },

    _renderInsights: function() {
        var panel = document.getElementById('insightsPanel');
        var list = document.getElementById('insightsList');
        if (!panel || !list) return;
        var items = this._collectInsights(StateManager.get('projects') || [], new Date());
        this._renderDeadlineOutlook(StateManager.get('projects') || []);
        var healthList = document.getElementById('projectHealthList');
        if (healthList) {
            var health = this._collectProjectHealth(StateManager.get('projects') || [], new Date());
            var before = typeof StorageService !== 'undefined' ? StorageService.get('healthHistory', []) : [];
            var history = this._updateHealthHistory(before, health, new Date());
            if (typeof StorageService !== 'undefined' && JSON.stringify(before) !== JSON.stringify(history)) StorageService.set('healthHistory', history);
            this._renderHealthAnalytics(health, history);
            this._renderHealthAlerts(health, history);
            healthList.innerHTML = health.length ? health.slice(0, 4).map(function(item) {
                var id = Helpers.escapeHtml(String(item.id)).replace(/"/g, '&quot;');
                var scoreLabel = item.score === null ? 'Нет плана' : item.score + '/100';
                var level = item.score === null ? 'unknown' : item.score < 60 ? 'risk' : item.score < 85 ? 'warning' : 'good';
                var trend = RendererModule._healthTrend(history, item.id, item.score);
                return '<button type="button" class="health-item health-' + level + '" data-insight-project="' + id + '"><span class="health-item-top"><strong>' + Helpers.escapeHtml(item.name) + '</strong><b>' + scoreLabel + '</b></span><span class="health-track"><span style="width:' + (item.score === null ? 0 : item.score) + '%"></span></span><small>' + Helpers.escapeHtml(item.advice) + '</small><small class="health-trend trend-' + trend.direction + '">' + trend.label + '</small></button>';
            }).join('') + (health.length > 4 ? '<span class="health-more">Ещё проектов: ' + (health.length - 4) + '</span>' : '') : '';
        }
        var summary = document.getElementById('insightsSummary');
        if (summary) summary.textContent = items.length ? 'Сигналов: ' + items.length : 'Всё под контролем';
        list.innerHTML = items.length ? items.slice(0, 4).map(function(item) {
            var projectId = Helpers.escapeHtml(String(item.projectId)).replace(/"/g, '&quot;');
            return '<button type="button" class="insight-item insight-' + item.kind + '" data-insight-project="' + projectId + '"><span class="insight-icon" aria-hidden="true">' + (item.kind === 'overdue' ? '⚠️' : '🕒') + '</span><span><strong>' + Helpers.escapeHtml(item.name) + '</strong><small>' + Helpers.escapeHtml(item.label) + '</small></span><span aria-hidden="true">↗</span></button>';
        }).join('') + (items.length > 4 ? '<p class="insights-more">И ещё сигналов: ' + (items.length - 4) + '</p>' : '') : '<p class="insights-empty">✨ Срочных проблем не найдено. Продолжай в своём темпе!</p>';
    },

    _collectScheduleItems: function(projects) {
        var result = [];
        var validDate = function(value) {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            var date = new Date(value + 'T12:00:00');
            return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4)) && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
        };
        (projects || []).forEach(function(project) {
            var checklist = Array.isArray(project.checklist) ? project.checklist : [];
            var stages = Array.isArray(project.milestones) ? project.milestones : [];
            var completedStages = Array.isArray(project.completedMilestones) ? project.completedMilestones : [];
            var deadlines = project.milestoneDeadlines && typeof project.milestoneDeadlines === 'object' && !Array.isArray(project.milestoneDeadlines) ? project.milestoneDeadlines : {};
            checklist.forEach(function(task) {
                if (!task || task.completed || !validDate(task.deadline)) return;
                result.push({ date: task.deadline, projectId: project.id, projectName: project.name || 'Без названия', name: task.text || 'Задача', type: 'task' });
            });
            stages.forEach(function(stage) {
                if (typeof stage !== 'string' || !validDate(deadlines[stage])) return;
                var linked = checklist.filter(function(task) { return task && task.milestone === stage; });
                var completed = linked.length ? linked.every(function(task) { return task.completed; }) : completedStages.includes(stage);
                if (!completed) result.push({ date: deadlines[stage], projectId: project.id, projectName: project.name || 'Без названия', name: stage, type: 'stage' });
            });
        });
        return result.sort(function(a, b) { return a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName); });
    },

    _filterScheduleItems: function(items, projectId, type) {
        return (items || []).filter(function(item) {
            return (projectId === 'all' || String(item.projectId) === String(projectId)) && (type === 'all' || item.type === type);
        });
    },

    _renderSchedule: function() {
        var grid = document.getElementById('scheduleGrid');
        if (!grid) return;
        var now = new Date();
        var month = this._scheduleMonth || new Date(now.getFullYear(), now.getMonth(), 1);
        var year = month.getFullYear(), index = month.getMonth();
        var pad = function(value) { return String(value).padStart(2, '0'); };
        var prefix = year + '-' + pad(index + 1) + '-';
        var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
        var days = new Date(year, index + 1, 0).getDate();
        var start = (new Date(year, index, 1).getDay() + 6) % 7;
        var projects = StateManager.get('projects') || [];
        var projectFilter = document.getElementById('scheduleProjectFilter');
        var typeFilter = document.getElementById('scheduleTypeFilter');
        if (projectFilter) {
            var chosenProject = projectFilter.value || 'all';
            projectFilter.innerHTML = '<option value="all">Все проекты</option>' + projects.filter(function(project) { return project && project.id != null; }).slice().sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }).map(function(project) {
                return '<option value="' + Helpers.escapeHtml(String(project.id)).replace(/"/g, '&quot;') + '">' + Helpers.escapeHtml(project.name || 'Без названия') + '</option>';
            }).join('');
            projectFilter.value = chosenProject;
            if (projectFilter.selectedIndex === -1) projectFilter.value = 'all';
        }
        var items = this._filterScheduleItems(this._collectScheduleItems(projects), projectFilter ? projectFilter.value : 'all', typeFilter ? typeFilter.value : 'all');
        var byDay = {};
        items.forEach(function(item) { (byDay[item.date] || (byDay[item.date] = [])).push(item); });
        var monthLabel = document.getElementById('scheduleMonth');
        if (monthLabel) monthLabel.textContent = new Date(year, index, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
        var chosen = this._scheduleSelected && this._scheduleSelected.startsWith(prefix) ? this._scheduleSelected : (today.startsWith(prefix) ? today : prefix + '01');
        this._scheduleSelected = chosen;
        var html = '';
        for (var empty = 0; empty < start; empty++) html += '<span class="schedule-gap" aria-hidden="true"></span>';
        for (var day = 1; day <= days; day++) {
            var key = prefix + pad(day);
            var count = (byDay[key] || []).length;
            html += '<button type="button" class="schedule-day' + (key === today ? ' is-today' : '') + (key === chosen ? ' is-selected' : '') + (key < today && count ? ' is-overdue' : '') + '" data-schedule-day="' + key + '" aria-label="' + day + ' ' + new Date(year, index, day).toLocaleDateString('ru-RU', { month: 'long' }) + (count ? ', событий: ' + count : ', без сроков') + '" aria-pressed="' + (key === chosen) + '"><span>' + day + '</span>' + (count ? '<small>' + count + '</small>' : '') + '</button>';
        }
        grid.innerHTML = html;
        var agenda = document.getElementById('scheduleAgenda');
        if (!agenda) return;
        var selectedItems = byDay[chosen] || [];
        var heading = '<h4>' + new Date(chosen + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + '</h4>';
        agenda.innerHTML = heading + (selectedItems.length ? '<div class="schedule-agenda-list">' + selectedItems.map(function(item) {
            return '<button type="button" class="schedule-agenda-item' + (item.date < today ? ' is-overdue' : '') + '" data-focus-project="' + Helpers.escapeHtml(String(item.projectId)).replace(/"/g, '&quot;') + '"><span class="schedule-kind">' + (item.type === 'stage' ? 'Этап' : 'Задача') + (item.date < today ? ' · Просрочено' : '') + '</span><strong>' + Helpers.escapeHtml(item.name) + '</strong><small>' + Helpers.escapeHtml(item.projectName) + '</small></button>';
        }).join('') + '</div>' : '<p class="schedule-empty">На этот день сроков нет. Выбери дату с отметкой, чтобы увидеть задачи.</p>');
        var upcoming = document.getElementById('scheduleUpcoming');
        if (upcoming) {
            var next = items.filter(function(item) { return item.date >= today; }).slice(0, 7);
            upcoming.innerHTML = '<h4>Ближайшие дела</h4>' + (next.length ? '<div class="schedule-upcoming-list">' + next.map(function(item) {
                return '<button type="button" class="schedule-upcoming-item" data-focus-project="' + Helpers.escapeHtml(String(item.projectId)).replace(/"/g, '&quot;') + '"><time datetime="' + item.date + '">' + item.date.slice(8, 10) + '.' + item.date.slice(5, 7) + '</time><span><strong>' + Helpers.escapeHtml(item.name) + '</strong><small>' + Helpers.escapeHtml(item.projectName) + ' · ' + (item.type === 'stage' ? 'этап' : 'задача') + '</small></span></button>';
            }).join('') + '</div>' : '<p class="schedule-empty">Нет запланированных сроков. Укажи даты задач или этапов в проектах.</p>');
        }
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
        this._renderQuickTaskProjects();
        this._renderWorkspaceSummary();
        this._renderInsights();
        this._renderToday();
        this._renderFocus();
        this._renderProductivity();
        this._renderRoadmapOverview();
        this._renderSchedule();
        var container = this.containers.projects;
        var emptyState = this.containers.emptyState;
        if (!container) return;

        var projects;
        var filterStatus = StateManager.get('filters.status');
        var sq = StateManager.get('filters.search');
        var viewKey = JSON.stringify([filterStatus || 'all', sq || '', this._sortMode]);
        if (viewKey !== this._viewKey) {
            this._viewKey = viewKey;
            this._visibleCount = this._pageSize;
        }
        if (filterStatus === 'favorites') {
            projects = FavoritesModule.getFavorites();
        } else {
            projects = ProjectsModule.getFilteredProjects();
        }

        if (sq) {
            var t = sq.toLowerCase();
            projects = projects.filter(function(p) {
                return [p.name, p.description].concat(p.techStack || []).join(' ').toLowerCase().indexOf(t) !== -1;
            });
        }

        projects = projects.slice().sort(function(a, b) {
            var pinOrder = Number(this.isPinned(b.id)) - Number(this.isPinned(a.id));
            if (pinOrder) return pinOrder;
            if (this._sortMode === 'name') {
                return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
            }
            if (this._sortMode === 'status') {
                var statusComparison = String(a.status || '').localeCompare(String(b.status || ''), 'ru');
                if (statusComparison) return statusComparison;
            }
            var aTime = Date.parse(a.updatedAt || '') || 0;
            var bTime = Date.parse(b.updatedAt || '') || 0;
            return bTime - aTime || String(a.id || '').localeCompare(String(b.id || ''));
        }.bind(this));

        var countEl = document.getElementById('filteredCount');
        if (countEl) countEl.textContent = projects.length;
        var loadMore = document.getElementById('projectsLoadMore');
        if (loadMore) {
            var remaining = Math.max(0, projects.length - this._visibleCount);
            loadMore.hidden = remaining === 0;
            if (remaining) loadMore.textContent = 'Показать ещё ' + Math.min(this._pageSize, remaining) + ' из ' + remaining;
        }

        if (!projects.length) {
            container.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        var self = this;
        container.innerHTML = projects.slice(0, this._visibleCount).map(function(p, i) { return self._renderProjectCard(p, i); }).join('');
        this._attachProjectEvents();
    },

    _renderQuickTaskProjects: function() {
        var select = document.getElementById('quickTaskProject');
        if (!select) return;
        var selected = select.value;
        var projects = (StateManager.get('projects') || []).filter(function(project) {
            return project && project.id && project.status !== 'completed' && project.status !== 'archived';
        });
        select.replaceChildren();
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = projects.length ? 'Выбери проект' : 'Нет активных проектов';
        select.appendChild(placeholder);
        projects.forEach(function(project) {
            var option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name || 'Без названия';
            select.appendChild(option);
        });
        if (projects.some(function(project) { return project.id === selected; })) select.value = selected;
    },

    _renderWorkspaceSummary: function() {
        var projects = StateManager.get('projects') || [];
        var now = new Date();
        var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var active = 0, open = 0, overdue = 0, done = 0;
        projects.forEach(function(project) {
            if (!project) return;
            var isActive = project.status !== 'completed' && project.status !== 'archived';
            if (isActive) active++;
            (Array.isArray(project.checklist) ? project.checklist : []).forEach(function(task) {
                if (!task || !task.text) return;
                if (task.completed) { done++; return; }
                if (!isActive) return;
                open++;
                if (typeof task.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadline) && task.deadline < today) overdue++;
            });
        });
        [['workspaceActiveProjects', active], ['workspaceOpenTasks', open], ['workspaceOverdueTasks', overdue], ['workspaceDoneTasks', done]].forEach(function(entry) {
            var el = document.getElementById(entry[0]);
            if (el) el.textContent = String(entry[1]);
        });
    },

    _renderProjectCard: function(project, index) {
        var sc = Helpers.getStatusClass(project.status);
        var st = Helpers.getStatusText(project.status);
        var si = Helpers.getStatusIcon(project.status);
        var ua = Helpers.formatDate(project.updatedAt);
        var isFav = FavoritesModule.isFavorite(project.id);
        var isPinned = this.isPinned(project.id);
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

        var mHTML = this._roadmapCardSummary(project);

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
            actions = '<button class="project-action-btn pin-project ' + (isPinned ? 'active' : '') + '" data-project-id="' + project.id + '" aria-pressed="' + isPinned + '" title="' + (isPinned ? 'Открепить проект' : 'Закрепить наверху') + '" aria-label="' + (isPinned ? 'Открепить проект' : 'Закрепить наверху') + '"><i class="bi ' + (isPinned ? 'bi-pin-angle-fill' : 'bi-pin-angle') + '"></i></button>' +
                '<button class="project-action-btn favorite-btn-card ' + (isFav ? 'active' : '') + '" data-project-id="' + project.id + '" aria-pressed="' + isFav + '" aria-label="' + (isFav ? 'Убрать из избранного' : 'Добавить в избранное') + '" title="' + (isFav ? 'Убрать из избранного' : 'Добавить в избранное') + '"><i class="bi ' + (isFav ? 'bi-star-fill' : 'bi-star') + '"></i></button>' +
                '<button class="project-action-btn edit-project" data-project-id="' + project.id + '" aria-label="Редактировать проект" title="Редактировать проект"><i class="bi bi-pencil"></i></button>' +
                '<button class="project-action-btn delete-project" data-project-id="' + project.id + '" aria-label="Удалить проект" title="Удалить проект"><i class="bi bi-trash"></i></button>';
        } else {
            actions = '<button class="project-action-btn pin-project ' + (isPinned ? 'active' : '') + '" data-project-id="' + project.id + '" aria-pressed="' + isPinned + '" title="' + (isPinned ? 'Открепить проект' : 'Закрепить наверху') + '" aria-label="' + (isPinned ? 'Открепить проект' : 'Закрепить наверху') + '"><i class="bi ' + (isPinned ? 'bi-pin-angle-fill' : 'bi-pin-angle') + '"></i></button>' +
                '<button class="project-action-btn favorite-btn-card ' + (isFav ? 'active' : '') + '" data-project-id="' + project.id + '" aria-pressed="' + isFav + '" aria-label="' + (isFav ? 'Убрать из избранного' : 'Добавить в избранное') + '" title="' + (isFav ? 'Убрать из избранного' : 'Добавить в избранное') + '"><i class="bi ' + (isFav ? 'bi-star-fill' : 'bi-star') + '"></i></button>';
        }

        return '<div class="project-card" data-project-id="' + project.id + '"><div class="project-card-inner">' +
            '<div class="project-header"><span class="project-status-badge ' + sc + '"><i class="bi ' + si + '"></i> ' + st + '</span><div class="project-actions">' + actions + '</div></div>' +
            '<h3 class="project-name">' + Helpers.escapeHtml(project.name) + '</h3>' +
            (project.description ? '<div class="project-description-wrapper"><p class="project-description" data-full="' + Helpers.escapeHtml(project.description).replace(/"/g, '&quot;') + '">' + Helpers.escapeHtml(Helpers.truncateText(project.description, 150)) + '</p>' + (project.description.length > 150 ? '<button class="btn-show-more" onclick="event.stopPropagation(); RendererModule._toggleDescription(this)"><i class="bi bi-chevron-down me-1"></i>Показать полностью</button>' : '') + '</div>' : '') +
            (links.length ? '<div class="project-links">' + links.join('') + '</div>' : '') +
            (techs ? '<div class="project-tech">' + techs + '</div>' : '') +
            '<div class="project-card-snapshot" aria-label="Состояние проекта"><span><i class="bi bi-check2-circle" aria-hidden="true"></i> Задачи <strong>' + clDone + '/' + clTotal + '</strong></span><span><i class="bi bi-journal-text" aria-hidden="true"></i> Заметки <strong>' + nActive.length + '</strong></span></div>' +
            '<details class="project-card-extras" onclick="event.stopPropagation()"><summary><i class="bi bi-chevron-down" aria-hidden="true"></i> Задачи, заметки и план</summary>' +
            '<div class="card-mini-sections"><div class="card-mini-section"><div class="mini-section-header"><i class="bi bi-check2-square"></i><span>Чек-лист</span>' + (clTotal > 0 ? '<span class="mini-badge">' + clDone + '/' + clTotal + '</span>' : '<span class="mini-badge empty">0</span>') + '</div>' + clHTML + '</div>' +
            '<div class="card-mini-section"><div class="mini-section-header"><i class="bi bi-journal-text"></i><span>Заметки</span>' + (nActive.length > 0 ? '<span class="mini-badge">' + nActive.length + '</span>' : '<span class="mini-badge empty">0</span>') + '</div>' + nHTML + '</div></div>' +
            mHTML + '</details>' +
            '<div class="project-footer"><span class="project-date"><i class="bi bi-clock me-1"></i>' + ua + '</span><div class="project-stats-mini"><span><i class="bi bi-arrow-repeat me-1"></i>' + (project.updates ? project.updates.length : 0) + '</span><span><i class="bi bi-sticky me-1"></i>' + notes.length + '</span><span><i class="bi bi-check2 me-1"></i>' + clTotal + '</span></div></div>' +
            '</div></div>';
    },

    _roadmapCardSummary: function(project) {
        var stages = Array.isArray(project.milestones) ? project.milestones.filter(function(stage) { return typeof stage === 'string' && stage.trim(); }) : [];
        if (!stages.length) return '';
        var completed = Array.isArray(project.completedMilestones) ? project.completedMilestones : [];
        var tasks = Array.isArray(project.checklist) ? project.checklist : [];
        var deadlines = project.milestoneDeadlines && typeof project.milestoneDeadlines === 'object' && !Array.isArray(project.milestoneDeadlines) ? project.milestoneDeadlines : {};
        var doneCount = 0;
        var next = null;
        stages.forEach(function(stage) {
            var linked = tasks.filter(function(task) { return task.milestone === stage; });
            var done = linked.length ? linked.every(function(task) { return task.completed; }) : completed.indexOf(stage) !== -1;
            if (done) doneCount++;
            else if (!next) next = stage;
        });
        var nextName = next ? Helpers.escapeHtml(Helpers.truncateText(next, 42)) : 'Все этапы завершены';
        var deadline = next && Object.hasOwn(deadlines, next) && /^\d{4}-\d{2}-\d{2}$/.test(deadlines[next]) ? deadlines[next] : '';
        var now = new Date();
        var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var late = !!deadline && deadline < today;
        var formatted = deadline ? deadline.slice(8, 10) + '.' + deadline.slice(5, 7) + '.' + deadline.slice(0, 4) : '';
        return '<div class="roadmap-card-summary' + (late ? ' roadmap-card-late' : '') + '"><div class="mini-section-header"><i class="bi bi-signpost-split"></i><span>Дорожная карта</span><span class="mini-badge">' + doneCount + '/' + stages.length + '</span></div>' +
            '<div class="roadmap-card-next"><span>' + (next ? 'Следующий этап' : 'Готово') + '</span><strong>' + nextName + '</strong></div>' +
            (deadline ? '<small class="roadmap-card-due">' + (late ? '⚠ Просрочено · ' : 'Срок · ') + formatted + '</small>' : '') + '</div>';
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
        projects.filter(function(p) { return this.isPinned(p.id); }, this).forEach(function(p) { if (!seen[p.id]) { seen[p.id] = true; quick.push(p); } });
        projects.filter(function(p) { return favs.indexOf(p.id) !== -1; }).forEach(function(p) { if (!seen[p.id]) { seen[p.id] = true; quick.push(p); } });
        projects.slice(0, 5).forEach(function(p) { if (!seen[p.id]) { seen[p.id] = true; quick.push(p); } });
        quick = quick.slice(0, 8);
        var html = (favs.length || this._pinnedIds.length) ? '<li><span class="dropdown-header"><i class="bi bi-pin-angle me-1"></i>Быстрый доступ</span></li>' : '';
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

        document.querySelectorAll('.pin-project').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                self.togglePinned(btn.dataset.projectId);
            });
        });

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
