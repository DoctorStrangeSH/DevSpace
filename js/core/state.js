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
        const savedProjects = StorageService.get(StorageService.KEYS.PROJECTS);
        
        if (savedProjects && Array.isArray(savedProjects)) {
            this._state.projects = savedProjects;
            console.log('StateManager: loaded', savedProjects.length, 'projects');
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
        try {
            const response = await fetch('data/initial-projects.json');
            if (response.ok) {
                const initialProjects = await response.json();
                this._state.projects = initialProjects;
                this.saveProjects();
                console.log('StateManager: loaded initial projects');
            }
        } catch (error) {
            console.warn('StateManager: cannot load initial projects, using empty array');
            this._state.projects = [];
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
        
        this._saveToHistory();
        
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

    saveProjects() {
        StorageService.set(StorageService.KEYS.PROJECTS, this._state.projects);
        this._updateStats();
        EventBus.emit('projects:saved', this._state.projects);
    },

    addProject(project) {
        this._state.projects.unshift(project);
        this.saveProjects();
        EventBus.emit('project:added', project);
        return project;
    },

    updateProject(projectId, updates) {
        const index = this._state.projects.findIndex(p => p.id === projectId);
        
        if (index === -1) {
            console.warn('StateManager: project not found:', projectId);
            return null;
        }
        
        this._state.projects[index] = {
            ...this._state.projects[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        this.saveProjects();
        EventBus.emit('project:updated', this._state.projects[index]);
        
        return this._state.projects[index];
    },

    removeProject(projectId) {
        const index = this._state.projects.findIndex(p => p.id === projectId);
        
        if (index === -1) return false;
        
        const removed = this._state.projects.splice(index, 1)[0];
        this.saveProjects();
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
        
        this._historyIndex--;
        this._state.projects = JSON.parse(
            JSON.stringify(this._history[this._historyIndex])
        );
        
        this.saveProjects();
        EventBus.emit('undo:performed');
        
        return true;
    },

    redo() {
        if (this._historyIndex >= this._history.length - 1) return false;
        
        this._historyIndex++;
        this._state.projects = JSON.parse(
            JSON.stringify(this._history[this._historyIndex])
        );
        
        this.saveProjects();
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
        if (!data || !data.projects) {
            throw new Error('Invalid data format');
        }
        
        this._state.projects = data.projects;
        
        if (data.theme) {
            this._state.theme = data.theme;
            document.documentElement.setAttribute('data-bs-theme', data.theme);
            StorageService.set(StorageService.KEYS.THEME, data.theme);
        }
        
        this.saveProjects();
        EventBus.emit('data:imported');
        
        return true;
    }
};

window.StateManager = StateManager;