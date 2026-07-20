/* ============================================
   PROJECTS MODULE
   CRUD операции с проектами
   ============================================ */

var ProjectsModule = {
    _cache: {
        filteredProjects: null,
        lastFilter: null
    },

    init: function() {
        this._bindEvents();
        this._initModal();
        this._initSearch();
        this._initFilters();
        console.log('ProjectsModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        
        EventBus.on('project:create', function(data) { self.createProject(data); });
        EventBus.on('project:delete', function(id) { self.deleteProject(id); });
        EventBus.on('project:update', function(id, data) { self.updateProject(id, data); });
        EventBus.on('projects:reload', function() { self._reloadProjects(); });

        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                self.openCreateModal();
            }
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                StateManager.undo();
                if (typeof RendererModule !== 'undefined') RendererModule.renderProjects();
            }
        });
    },

    _initModal: function() {
        var self = this;
        
        var saveBtn = document.getElementById('saveProjectBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                self._handleSaveProject();
            });
        }

        var modal = document.getElementById('projectModal');
        if (modal) {
            modal.addEventListener('hidden.bs.modal', function() {
                self._resetForm();
            });
        }
    },

    _initSearch: function() {
        var searchInput = document.getElementById('searchProjects');
        if (searchInput) {
            var debouncedSearch = Helpers.debounce(function(e) {
                StateManager.set('filters.search', e.target.value.toLowerCase().trim());
                if (typeof RendererModule !== 'undefined') RendererModule.renderProjects();
            }, 300);
            searchInput.addEventListener('input', debouncedSearch);
        }
    },

    _initFilters: function() {
        var self = this;
        document.querySelectorAll('.filter-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                StateManager.set('filters.status', btn.dataset.filter);
                self._cache.filteredProjects = null;
                if (typeof RendererModule !== 'undefined') RendererModule.renderProjects();
            });
        });
    },

    openCreateModal: function() {
        var modalTitle = document.getElementById('modalTitle');
        if (modalTitle) modalTitle.textContent = 'Новый проект';
        this._resetForm();
        StateManager.set('ui.editingProjectId', null);
        var modal = new bootstrap.Modal(document.getElementById('projectModal'));
        modal.show();
    },

    openEditModal: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project) {
            if (typeof NotificationModule !== 'undefined') NotificationModule.error('Проект не найден');
            return;
        }

        var modalTitle = document.getElementById('modalTitle');
        if (modalTitle) modalTitle.textContent = 'Редактировать проект';

        var modal = new bootstrap.Modal(document.getElementById('projectModal'));
        modal.show();

        setTimeout(function() {
            var projectIdEl = document.getElementById('projectId');
            if (projectIdEl) projectIdEl.value = project.id || '';
            
            var projectNameEl = document.getElementById('projectName');
            if (projectNameEl) projectNameEl.value = project.name || '';
            
            var projectDescEl = document.getElementById('projectDescription');
            if (projectDescEl) projectDescEl.value = project.description || '';
            
            var projectStatusEl = document.getElementById('projectStatus');
            if (projectStatusEl) projectStatusEl.value = project.status || 'planning';
            
            var projectGithubEl = document.getElementById('projectGithub');
            if (projectGithubEl) projectGithubEl.value = project.github || '';
            
            var projectSupabaseEl = document.getElementById('projectSupabase');
            if (projectSupabaseEl) projectSupabaseEl.value = project.supabase || '';
            
            var projectDemoEl = document.getElementById('projectDemo');
            if (projectDemoEl) projectDemoEl.value = project.demo || '';
            
            var projectTechEl = document.getElementById('projectTech');
            if (projectTechEl) projectTechEl.value = (project.techStack || []).join(', ');
            
            var projectMilestonesEl = document.getElementById('projectMilestones');
            if (projectMilestonesEl) projectMilestonesEl.value = (project.milestones || []).join(', ');

            StateManager.set('ui.editingProjectId', projectId);
        }, 100);
    },

    _handleSaveProject: function() {
        var projectIdEl = document.getElementById('projectId');
        var projectId = projectIdEl ? projectIdEl.value : '';
        var formData = this._getFormData();

        var validation = Validators.validateProject(formData);
        if (!validation.valid) {
            validation.errors.forEach(function(error) {
                if (typeof NotificationModule !== 'undefined') NotificationModule.error(error);
            });
            return;
        }

        if (projectId) {
            var updated = StateManager.updateProject(projectId, formData);
            if (updated) {
                if (typeof NotificationModule !== 'undefined') {
                    NotificationModule.success('Проект "' + updated.name + '" обновлён');
                }
                // Сохраняем в Supabase
                if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
                    SupabaseService.saveProject(updated);
                }
            }
        } else {
            var newProject = this.createProject(formData);
            if (newProject && typeof NotificationModule !== 'undefined') {
                NotificationModule.success('Проект "' + newProject.name + '" создан');
            }
        }

        var modal = bootstrap.Modal.getInstance(document.getElementById('projectModal'));
        if (modal) modal.hide();

        if (typeof RendererModule !== 'undefined') {
            RendererModule.renderProjects();
            RendererModule.renderStats();
        }
    },

    _getFormData: function() {
        var techStringEl = document.getElementById('projectTech');
        var techString = techStringEl ? techStringEl.value : '';
        var techStack = techString ? techString.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];

        var milestonesEl = document.getElementById('projectMilestones');
        var milestonesStr = milestonesEl ? milestonesEl.value : '';
        var milestones = milestonesStr ? milestonesStr.split(',').map(function(m) { return m.trim(); }).filter(Boolean) : [];

        return {
            name: document.getElementById('projectName')?.value?.trim() || '',
            description: document.getElementById('projectDescription')?.value?.trim() || '',
            status: document.getElementById('projectStatus')?.value || 'planning',
            github: document.getElementById('projectGithub')?.value?.trim() || '',
            supabase: document.getElementById('projectSupabase')?.value?.trim() || '',
            demo: document.getElementById('projectDemo')?.value?.trim() || '',
            techStack: techStack,
            milestones: milestones
        };
    },

    _resetForm: function() {
        var form = document.getElementById('projectForm');
        if (form) form.reset();
        var projectIdEl = document.getElementById('projectId');
        if (projectIdEl) projectIdEl.value = '';
        StateManager.set('ui.editingProjectId', null);
    },

    createProject: function(data) {
        var newProject = {
            id: Helpers.generateId(),
            name: data.name,
            description: data.description || '',
            status: data.status || 'planning',
            github: data.github || '',
            supabase: data.supabase || '',
            demo: data.demo || '',
            techStack: data.techStack || [],
            milestones: data.milestones || [],
            completedMilestones: [],
            progress: 0,
            checklist: [],
            updates: [],
            notes: [],
            screenshots: [],
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        var added = StateManager.addProject(newProject);
        this._cache.filteredProjects = null;
        
        // Сохраняем в Supabase
        if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
            SupabaseService.saveProject(added);
        }
        
        return added;
    },

    updateProject: function(projectId, data) {
        var updated = StateManager.updateProject(projectId, data);
        if (updated) {
            this._cache.filteredProjects = null;
            // Сохраняем в Supabase
            if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
                SupabaseService.saveProject(updated);
            }
        }
        return updated;
    },

    deleteProject: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project) {
            if (typeof NotificationModule !== 'undefined') NotificationModule.error('Проект не найден');
            return false;
        }

        if (!confirm('Вы уверены, что хотите удалить проект "' + project.name + '"?\n\nЭто действие нельзя отменить.')) {
            return false;
        }

        var removed = StateManager.removeProject(projectId);
        if (removed) {
            if (typeof NotificationModule !== 'undefined') NotificationModule.success('Проект "' + project.name + '" удален');
            this._cache.filteredProjects = null;
            
            // Удаляем из Firebase
            if (typeof FirebaseService !== 'undefined') {
                FirebaseService.deleteProject(projectId);
            }
            
            // Удаляем из Supabase
            if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled() && SupabaseService._client) {
                SupabaseService._client
                    .from('projects')
                    .delete()
                    .eq('id', projectId)
                    .then(function() { console.log('Supabase: удалено'); })
                    .catch(function() {});
            }
            
            if (typeof RendererModule !== 'undefined') {
                RendererModule.renderProjects();
                RendererModule.renderStats();
            }
        }
        return removed;
    },

    getFilteredProjects: function() {
        var filters = StateManager.get('filters');

        if (this._cache.filteredProjects && 
            JSON.stringify(this._cache.lastFilter) === JSON.stringify(filters)) {
            return this._cache.filteredProjects;
        }

        var projects = StateManager.get('projects') || [];

        if (filters.status && filters.status !== 'all') {
            projects = projects.filter(function(p) { return p.status === filters.status; });
        }

        if (filters.search) {
            var term = filters.search.toLowerCase();
            projects = projects.filter(function(p) {
                return [p.name, p.description].concat(p.techStack || []).join(' ').toLowerCase().indexOf(term) !== -1;
            });
        }

        projects = [].concat(projects).sort(function(a, b) {
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });

        this._cache.filteredProjects = projects;
        this._cache.lastFilter = Object.assign({}, filters);

        return projects;
    },

    _reloadProjects: function() {
        this._cache.filteredProjects = null;
        if (typeof RendererModule !== 'undefined') {
            RendererModule.renderProjects();
            RendererModule.renderStats();
        }
    },

    duplicateProject: function(projectId) {
        var project = StateManager.getProject(projectId);
        if (!project) return null;

        var duplicate = JSON.parse(JSON.stringify(project));
        duplicate.id = Helpers.generateId();
        duplicate.name = project.name + ' (копия)';
        duplicate.createdAt = new Date().toISOString();
        duplicate.updatedAt = new Date().toISOString();

        var added = StateManager.addProject(duplicate);
        if (added) {
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.success('Создана копия: "' + added.name + '"');
            }
            // Сохраняем в Supabase
            if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
                SupabaseService.saveProject(added);
            }
        }
        this._cache.filteredProjects = null;
        if (typeof RendererModule !== 'undefined') RendererModule.renderProjects();
        return added;
    }
};

window.ProjectsModule = ProjectsModule;