/* Focused tracker workspace navigation. Visibility only: never changes project data. */
var WorkspaceViewModule = {
    _current: 'overview',
    init: function() {
        var self = this;
        var switcher = document.getElementById('workspaceSwitcher');
        if (!switcher) return;
        var saved = sessionStorage.getItem('devspace_workspace_view');
        this.setView(['overview', 'projects', 'planning', 'cloud', 'analytics'].indexOf(saved) >= 0 ? saved : 'overview');
        switcher.addEventListener('click', function(event) {
            var button = event.target.closest('[data-workspace-view]');
            if (!button) return;
            self.setView(button.dataset.workspaceView);
        });
        document.querySelectorAll('[data-workspace-jump]').forEach(function(button) {
            button.addEventListener('click', function() { self.setView(button.dataset.workspaceJump); });
        });
        document.querySelectorAll('[data-workspace-view-target]').forEach(function(button) {
            button.addEventListener('click', function() {
                self.setView(button.dataset.workspaceViewTarget);
                document.getElementById('workspaceSwitcher').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
        var search = document.getElementById('searchProjects');
        if (search) {
            search.addEventListener('input', function() {
                if (search.value.trim()) self.setView('projects');
            });
            search.addEventListener('keydown', function(event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    self.setView('projects');
                    document.getElementById('projects').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }
        document.addEventListener('keydown', function(event) {
            var focused = event.target;
            var typing = focused && (focused.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName));
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                if (search) { search.focus(); search.select(); }
            } else if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                if (search) search.focus();
            } else if (event.key === 'Escape' && focused === search) {
                search.blur();
            }
        });
    },
    setView: function(view) {
        if (['overview', 'projects', 'planning', 'cloud', 'analytics'].indexOf(view) < 0) return;
        this._current = view;
        sessionStorage.setItem('devspace_workspace_view', view);
        var container = document.getElementById('tabProjects');
        if (container) container.dataset.workspaceView = view;
        document.querySelectorAll('[data-workspace-view].workspace-switch').forEach(function(button) {
            var selected = button.dataset.workspaceView === view;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        if (typeof RendererModule !== 'undefined' && typeof RendererModule._switchTab === 'function' &&
            sessionStorage.getItem('devspace_tab') !== 'projects') RendererModule._switchTab('projects');
        var filters = document.getElementById('projectsFilters');
        if (filters) filters.hidden = view !== 'projects';
    }
};
window.WorkspaceViewModule = WorkspaceViewModule;
