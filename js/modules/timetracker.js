/* ============================================
   TIME TRACKER MODULE
   Отслеживание времени работы над проектом
   ============================================ */

const TimeTrackerModule = {
    activeSession: null,
    timerInterval: null,

    init() {
        this._bindEvents();
        console.log('TimeTrackerModule initialized');
    },

    _bindEvents() {
        EventBus.on('tracking:started', () => this._updateUI());
        EventBus.on('tracking:stopped', () => this._updateUI());
    },

    startTracking(projectId) {
        if (this.activeSession) {
            this.stopTracking();
        }

        this.activeSession = {
            projectId,
            startTime: Date.now(),
            paused: false,
            pausedTime: 0,
            pauseStart: null
        };

        this.timerInterval = setInterval(() => {
            this._updateTimerDisplay();
        }, 1000);

        EventBus.emit('tracking:started', this.activeSession);
        NotificationModule.info('Отслеживание времени запущено');
    },

    pauseTracking() {
        if (!this.activeSession || this.activeSession.paused) return;
        
        this.activeSession.paused = true;
        this.activeSession.pauseStart = Date.now();
        EventBus.emit('tracking:paused');
    },

    resumeTracking() {
        if (!this.activeSession || !this.activeSession.paused) return;
        
        this.activeSession.pausedTime += Date.now() - this.activeSession.pauseStart;
        this.activeSession.paused = false;
        this.activeSession.pauseStart = null;
        EventBus.emit('tracking:resumed');
    },

    stopTracking() {
        if (!this.activeSession) return;

        clearInterval(this.timerInterval);
        this.timerInterval = null;

        const elapsed = this._getElapsed();
        const projectId = this.activeSession.projectId;

        const project = StateManager.getProject(projectId);
        if (project) {
            project.trackedTime = (project.trackedTime || 0) + elapsed;
            StateManager.updateProject(projectId, { trackedTime: project.trackedTime });
            StateManager.saveProjects();
        }

        const formatted = this._formatTime(elapsed);
        this.activeSession = null;

        EventBus.emit('tracking:stopped', { projectId, elapsed });
        NotificationModule.success(`Время работы: ${formatted}`);
    },

    _getElapsed() {
        if (!this.activeSession) return 0;
        
        let elapsed = Date.now() - this.activeSession.startTime - this.activeSession.pausedTime;
        
        if (this.activeSession.paused && this.activeSession.pauseStart) {
            elapsed -= Date.now() - this.activeSession.pauseStart;
        }
        
        return Math.max(0, elapsed);
    },

    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours}ч ${minutes}м`;
        }
        return `${minutes}м ${seconds}с`;
    },

    _updateTimerDisplay() {
        if (!this.activeSession) return;
        
        const elapsed = this._getElapsed();
        // Можно обновлять UI здесь
    },

    _updateUI() {
        // Обновление UI при изменении состояния трекера
    }
};

window.TimeTrackerModule = TimeTrackerModule;