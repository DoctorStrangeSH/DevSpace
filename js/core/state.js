/* ============================================
   STATE MANAGER
   Централизованное управление состоянием
   ============================================ */

const StateManager = {
    _state: {
        projects: [],
        theme: 'dark',
        filters: {
            search: '',
            status: 'all'
        },
        ui: {
            isLoading: false,
            activeModal: null,
            editingProjectId: null
        },
        stats: {
            totalProjects: 0,
            completedTasks: 0,
            inProgress: 0,
            totalUpdates: 0
        }
    },

    _history: [],
    _historyIndex: -1,
    _projectMutationVersion: 0,
    _projectsLoadError: false,
    _projectsStorageSnapshot: null,
    _projectsConflict: false,
    _maxHistory: 50,
    _initialized: false,

    init() {
        if (this._initialized) {
            console.log('StateManager already initialized');
            return;
        }

        console.log('StateManager: initializing...');

        // 1. Сначала загружаем тему
        const savedTheme = StorageService.get(StorageService.KEYS.THEME);
        if (savedTheme && (savedTheme === 'dark' || savedTheme === 'light')) {
            this._state.theme = savedTheme;
            console.log('StateManager: loaded theme:', savedTheme);
        } else {
            // Определяем системную тему
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                this._state.theme = 'light';
            }
            console.log('StateManager: using default theme:', this._state.theme);
        }

        // 2. Применяем тему сразу
        document.documentElement.setAttribute('data-bs-theme', this._state.theme);

        // 3. Загружаем проекты
        const projectsKey = StorageService.KEYS.PROJECTS;
        const projectSnapshot = typeof StorageService.getSnapshot === 'function'
            ? StorageService.getSnapshot(projectsKey)
            : null;
        const savedProjects = projectSnapshot
            ? projectSnapshot.value
            : StorageService.get(projectsKey);
        if (projectSnapshot) {
            this._projectsStorageSnapshot = projectSnapshot.raw;
        } else if (typeof StorageService.getRaw === 'function') {
            this._projectsStorageSnapshot = StorageService.getRaw(projectsKey);
        }
        const projectsKeyExists = projectSnapshot
            ? projectSnapshot.raw !== null
            : typeof StorageService.has === 'function' && StorageService.has(projectsKey);
        const projectsReadFailed = projectSnapshot
            ? !!projectSnapshot.error
            : StorageService._lastReadKey === projectsKey && !!StorageService._lastReadError;

        if (savedProjects && Array.isArray(savedProjects)) {
            this._state.projects = savedProjects;
            console.log('StateManager: loaded', savedProjects.length, 'projects');
        } else if (projectsKeyExists || projectsReadFailed) {
            // Preserve malformed or inaccessible saved bytes. Never replace them with demo data.
            this._projectsLoadError = true;
            console.error('StateManager: saved projects exist but cannot be read as a project list; keeping stored data untouched');
        } else {
            console.log('StateManager: no saved projects, loading initial data...');
            this._loadInitialProjects();
        }

        // 4. Обновляем статистику
        this._updateStats();

        // 5. Сохраняем начальное состояние в историю
        this._saveToHistory();

        this._initialized = true;

        // 6. Уведомляем о готовности
        EventBus.emit('state:initialized', this.getState());
        console.log('StateManager: initialized with theme:', this._state.theme);
    },

    async _loadInitialProjects() {
        const requestMutationVersion = this._projectMutationVersion;
        try {
            const response = await fetch('data/initial-projects.json');
            if (response.ok) {
                const initialProjects = await response.json();
                // Do not seed defaults if the user changed projects while the request was pending,
                // even when that change left the collection empty again.
                if (Array.isArray(initialProjects) &&
                    this._projectMutationVersion === requestMutationVersion &&
                    this._state.projects.length === 0) {
                    this._state.projects = initialProjects;
                    if (this.saveProjects()) {
                        this._saveToHistory();
                    } else {
                        this._state.projects = [];
                        this._updateStats();
                    }
                    if (typeof RendererModule !== 'undefined' && this._state.projects.length > 0) {
                        RendererModule.renderProjects();
                        RendererModule.renderStats();
                    }
                }
                console.log('StateManager: loaded initial projects');
            }
        } catch (error) {
            console.warn('StateManager: cannot load initial projects');
            // A failed seed request must never erase projects created while it was pending.
            if (this._projectMutationVersion === requestMutationVersion) {
                this._state.projects = [];
                this._updateStats();
            }
        }
    },

    getState() {
        return { ...this._state };
    },

    get(path) {
        if (!path) return this.getState();
        
        const keys = path.split('.');
        let value = this._state;
        
        for (const key of keys) {
            if (value === undefined || value === null) return undefined;
            value = value[key];
        }
        
        return value;
    },

    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let target = this._state;
        
        for (const key of keys) {
            if (!(key in target)) {
                target[key] = {};
            }
            target = target[key];
        }
        
        const oldValue = target[lastKey];
        
        if (JSON.stringify(oldValue) === JSON.stringify(value)) {
            return value;
        }
        
        target[lastKey] = value;

        if (path === 'projects' || path.startsWith('projects.')) {
            this._projectMutationVersion++;
            this._saveToHistory();
        }
        
        EventBus.emit('state:changed', { 
            path, 
            oldValue, 
            newValue: value 
        });
        
        EventBus.emit(`state:${path}:changed`, value);
        
        return value;
    },

    update(updates) {
        Object.entries(updates).forEach(([path, value]) => {
            this.set(path, value);
        });
    },

    handleExternalProjectsStorageChange(event) {
        if (!event || event.key !== StorageService._getKey(StorageService.KEYS.PROJECTS)) return false;

        let nextProjects;
        try {
            nextProjects = event.newValue === null ? [] : JSON.parse(event.newValue);
        } catch (error) {
            this._projectsLoadError = true;
            EventBus.emit('storage:error', {
                key: StorageService.KEYS.PROJECTS,
                error: 'В другой вкладке сохранён некорректный список проектов'
            });
            return false;
        }

        if (!Array.isArray(nextProjects)) {
            this._projectsLoadError = true;
            EventBus.emit('storage:error', {
                key: StorageService.KEYS.PROJECTS,
                error: 'В другой вкладке сохранён список проектов неверного формата'
            });
            return false;
        }

        this._state.projects = nextProjects;
        this._projectsStorageSnapshot = event.newValue;
        this._projectsConflict = false;
        this._projectsLoadError = false;
        this._projectMutationVersion++;
        this._history = [JSON.parse(JSON.stringify(nextProjects))];
        this._historyIndex = 0;
        this._updateStats();
        EventBus.emit('projects:external-updated', nextProjects);
        return true;
    },

    saveProjects() {
        const key = StorageService.KEYS.PROJECTS;
        const saved = typeof StorageService.setIfUnchanged === 'function'
            ? StorageService.setIfUnchanged(key, this._state.projects, this._projectsStorageSnapshot)
            : StorageService.set(key, this._state.projects);
        if (!saved) {
            if (StorageService._lastWriteConflict) {
                this._projectsConflict = true;
                EventBus.emit('projects:conflict', { key });
            }
            return false;
        }
        if (typeof StorageService.setIfUnchanged === 'function') {
            this._projectsStorageSnapshot = StorageService._lastWriteValue;
        } else if (typeof StorageService.getRaw === 'function') {
            this._projectsStorageSnapshot = StorageService.getRaw(key);
        } else {
            this._projectsStorageSnapshot = JSON.stringify(this._state.projects);
        }
        this._projectsConflict = false;
        this._updateStats();
        EventBus.emit('projects:saved', this._state.projects);
        return true;
    },

    addProject(project) {
        this._state.projects.unshift(project);
        if (!this.saveProjects()) {
            this._state.projects.shift();
            this._updateStats();
            return null;
        }
        this._projectMutationVersion++;
        this._saveToHistory();
        EventBus.emit('project:added', project);
        return project;
    },

    updateProject(projectId, updates) {
        const index = this._state.projects.findIndex(p => p.id === projectId);
        if (index === -1) {
            console.warn('StateManager: project not found:', projectId);
            return null;
        }

        const previousProject = this._state.projects[index];
        const updatedProject = {
            ...previousProject,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        this._state.projects[index] = updatedProject;

        if (!this.saveProjects()) {
            this._state.projects[index] = previousProject;
            this._updateStats();
            return null;
        }
        this._projectMutationVersion++;
        this._saveToHistory();
        EventBus.emit('project:updated', updatedProject);
        return updatedProject;
    },

    updateProjects(projectUpdates) {
        if (!Array.isArray(projectUpdates) || projectUpdates.length === 0) return null;
        const seen = new Set();
        const replacements = [];

        for (const entry of projectUpdates) {
            if (!entry || entry.projectId == null || !entry.updates || typeof entry.updates !== 'object' || Array.isArray(entry.updates)) return null;
            if (seen.has(entry.projectId)) return null;
            seen.add(entry.projectId);
            const index = this._state.projects.findIndex(project => project.id === entry.projectId);
            if (index === -1) return null;
            const previousProject = this._state.projects[index];
            replacements.push({ index, updatedProject: { ...previousProject, ...entry.updates, updatedAt: new Date().toISOString() } });
        }

        const previousProjects = this._state.projects;
        const nextProjects = previousProjects.slice();
        replacements.forEach(item => { nextProjects[item.index] = item.updatedProject; });
        this._state.projects = nextProjects;

        if (!this.saveProjects()) {
            this._state.projects = previousProjects;
            this._updateStats();
            return null;
        }

        this._projectMutationVersion++;
        this._saveToHistory();
        replacements.forEach(item => EventBus.emit('project:updated', item.updatedProject));
        return replacements.map(item => item.updatedProject);
    },

    removeProject(projectId) {
        const index = this._state.projects.findIndex(p => p.id === projectId);
        if (index === -1) return false;

        const removed = this._state.projects.splice(index, 1)[0];
        if (!this.saveProjects()) {
            this._state.projects.splice(index, 0, removed);
            this._updateStats();
            return false;
        }
        this._projectMutationVersion++;
        this._saveToHistory();
        EventBus.emit('project:removed', removed);
        return true;
    },

    getProject(projectId) {
        return this._state.projects.find(p => p.id === projectId) || null;
    },

    _updateStats() {
        const projects = this._state.projects;
        
        const stats = {
            totalProjects: projects.length,
            completedTasks: 0,
            inProgress: projects.filter(p => p.status === 'development').length,
            totalUpdates: 0
        };
        
        projects.forEach(project => {
            if (project.checklist) {
                stats.completedTasks += project.checklist.filter(
                    item => item.completed
                ).length;
            }
            
            if (project.updates) {
                stats.totalUpdates += project.updates.length;
            }
        });
        
        this._state.stats = stats;
        EventBus.emit('stats:updated', stats);
    },

    _saveToHistory() {
        if (this._historyIndex < this._history.length - 1) {
            this._history = this._history.slice(0, this._historyIndex + 1);
        }
        
        this._history.push(JSON.parse(JSON.stringify(this._state.projects)));
        
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
        
        this._historyIndex = this._history.length - 1;
    },

    undo() {
        if (this._historyIndex <= 0) return false;

        const targetIndex = this._historyIndex - 1;
        const previousProjects = this._state.projects;
        this._state.projects = JSON.parse(JSON.stringify(this._history[targetIndex]));

        if (!this.saveProjects()) {
            this._state.projects = previousProjects;
            this._updateStats();
            return false;
        }

        this._historyIndex = targetIndex;
        this._projectMutationVersion++;
        EventBus.emit('undo:performed');
        return true;
    },

    redo() {
        if (this._historyIndex >= this._history.length - 1) return false;

        const targetIndex = this._historyIndex + 1;
        const previousProjects = this._state.projects;
        this._state.projects = JSON.parse(JSON.stringify(this._history[targetIndex]));

        if (!this.saveProjects()) {
            this._state.projects = previousProjects;
            this._updateStats();
            return false;
        }

        this._historyIndex = targetIndex;
        this._projectMutationVersion++;
        EventBus.emit('redo:performed');
        return true;
    },

    canUndo() {
        return this._historyIndex > 0;
    },

    canRedo() {
        return this._historyIndex < this._history.length - 1;
    },

    exportData() {
        return {
            projects: this._state.projects,
            theme: this._state.theme,
            version: '1.0.0',
            exportedAt: new Date().toISOString()
        };
    },

    importData(data) {
        if (!data || !Array.isArray(data.projects)) {
            throw new Error('Invalid data format');
        }

        const hasTheme = data.theme !== undefined && data.theme !== null;
        if (hasTheme && data.theme !== 'dark' && data.theme !== 'light') {
            throw new Error('Invalid theme');
        }

        const previousStoredTheme = hasTheme
            ? StorageService.get(StorageService.KEYS.THEME)
            : null;

        if (hasTheme && !StorageService.set(StorageService.KEYS.THEME, data.theme)) {
            return false;
        }

        if (!StorageService.set(StorageService.KEYS.PROJECTS, data.projects)) {
            if (hasTheme) {
                const restored = previousStoredTheme === null
                    ? StorageService.remove(StorageService.KEYS.THEME)
                    : StorageService.set(StorageService.KEYS.THEME, previousStoredTheme);
                if (!restored) {
                    console.error('StateManager: failed to restore theme after import failure');
                    EventBus.emit('storage:error', {
                        key: StorageService.KEYS.THEME,
                        error: 'Не удалось восстановить тему после неудачного импорта'
                    });
                }
            }
            return false;
        }

        this._state.projects = data.projects;
        this._projectMutationVersion++;
        if (hasTheme) {
            this._state.theme = data.theme;
            document.documentElement.setAttribute('data-bs-theme', data.theme);
        }

        this._updateStats();
        this._saveToHistory();
        EventBus.emit('projects:saved', this._state.projects);
        EventBus.emit('data:imported');
        return true;
    }
};

window.StateManager = StateManager;
