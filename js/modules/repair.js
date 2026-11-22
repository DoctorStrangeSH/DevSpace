/* ============================================
   SAFE REPAIR CENTER
   Preview-first, one operation at a time.
   ============================================ */

var RepairModule = {
    _candidates: [],

    init: function() {
        var self = this;
        var refresh = document.getElementById('workspaceRepairRefresh');
        var list = document.getElementById('workspaceRepairResults');
        if (refresh && !refresh.dataset.bound) {
            refresh.dataset.bound = 'true';
            refresh.addEventListener('click', function() { self.scan(); });
        }
        if (list && !list.dataset.bound) {
            list.dataset.bound = 'true';
            list.addEventListener('click', function(event) {
                var button = event.target.closest('[data-repair-candidate]');
                if (!button) return;
                self.apply(button.getAttribute('data-repair-candidate'));
            });
        }
    },

    _projects: function() {
        if (typeof StateManager === 'undefined' || StateManager._projectsLoadError || StateManager._projectsConflict) return null;
        var projects = StateManager.get('projects');
        return Array.isArray(projects) ? projects : null;
    },

    _buildCandidates: function() {
        var projects = this._projects();
        if (!projects || typeof StorageService === 'undefined') return [];
        var favoritesSnapshot = StorageService.getRawSnapshot('favorites');
        var trashSnapshot = StorageService.getRawSnapshot('deletedProjects');
        if (favoritesSnapshot.error || trashSnapshot.error) return [];
        var favorites = [];
        var trash = [];
        try {
            favorites = favoritesSnapshot.raw === null ? [] : JSON.parse(favoritesSnapshot.raw);
            trash = trashSnapshot.raw === null ? [] : JSON.parse(trashSnapshot.raw);
        } catch (_) { return []; }
        if (!Array.isArray(favorites) || !Array.isArray(trash)) return [];

        var activeIds = new Set(projects.map(function(project) { return project && project.id; }).filter(Boolean));
        var archivedIds = new Set(trash.map(function(entry) {
            return entry && entry.project && entry.project.id;
        }).filter(Boolean));
        var candidates = [];
        var self = this;

        favorites.forEach(function(id) {
            if (typeof id !== 'string' || activeIds.has(id) || archivedIds.has(id)) return;
            candidates.push({
                id: 'favorite:' + id,
                type: 'favorite',
                title: 'Убрать устаревшую ссылку из избранного',
                detail: 'ID «' + id + '» отсутствует среди активных проектов и в корзине. Сам проект и его данные не затрагиваются.',
                projectId: id,
                fingerprint: JSON.stringify({ favorites: favorites, active: Array.from(activeIds), archived: Array.from(archivedIds) })
            });
        });

        projects.forEach(function(project) {
            if (!project || typeof project.id !== 'string') return;
            var tasks = Array.isArray(project.checklist) ? project.checklist : [];
            var notes = Array.isArray(project.notes) ? project.notes : [];
            var taskIdCounts = new Map();
            var noteIdCounts = new Map();
            tasks.forEach(function(task) {
                if (task && typeof task.id === 'string') taskIdCounts.set(task.id, (taskIdCounts.get(task.id) || 0) + 1);
            });
            notes.forEach(function(note) {
                if (note && typeof note.id === 'string') noteIdCounts.set(note.id, (noteIdCounts.get(note.id) || 0) + 1);
            });

            tasks.forEach(function(task) {
                if (!task || typeof task.id !== 'string' || !task.sourceNoteId ||
                    taskIdCounts.get(task.id) !== 1 || noteIdCounts.get(task.sourceNoteId) !== 1) return;
                var note = notes.find(function(item) { return item && item.id === task.sourceNoteId; });
                if (!note || note.linkedTaskId) return;
                var otherTasks = tasks.filter(function(item) { return item && item.id !== task.id && item.sourceNoteId === note.id; });
                if (otherTasks.length) return;
                candidates.push({
                    id: 'task-to-note:' + project.id + ':' + task.id,
                    type: 'task-to-note',
                    title: 'Восстановить обратную связь заметки',
                    detail: 'Заметка «' + note.id + '» уже указана в задаче «' + task.id + '», а обратная ссылка отсутствует. Будет добавлен только linkedTaskId.',
                    projectId: project.id,
                    entityId: task.id,
                    fingerprint: JSON.stringify(project)
                });
            });

            notes.forEach(function(note) {
                if (!note || typeof note.id !== 'string' || !note.linkedTaskId ||
                    noteIdCounts.get(note.id) !== 1 || taskIdCounts.get(note.linkedTaskId) !== 1) return;
                var task = tasks.find(function(item) { return item && item.id === note.linkedTaskId; });
                if (!task || task.sourceNoteId) return;
                var otherNotes = notes.filter(function(item) { return item && item.id !== note.id && item.linkedTaskId === task.id; });
                var otherTasks = tasks.filter(function(item) { return item && item.id !== task.id && item.sourceNoteId === note.id; });
                if (otherNotes.length || otherTasks.length) return;
                candidates.push({
                    id: 'note-to-task:' + project.id + ':' + note.id,
                    type: 'note-to-task',
                    title: 'Восстановить обратную связь задачи',
                    detail: 'Задача «' + task.id + '» уже указана в заметке «' + note.id + '», а обратная ссылка отсутствует. Будет добавлен только sourceNoteId.',
                    projectId: project.id,
                    entityId: note.id,
                    fingerprint: JSON.stringify(project)
                });
            });
        });

        return candidates;
    },

    scan: function() {
        this._candidates = this._buildCandidates();
        this.render();
        return this._candidates;
    },

    render: function() {
        if (typeof document === 'undefined') return;
        var status = document.getElementById('workspaceRepairStatus');
        var results = document.getElementById('workspaceRepairResults');
        if (!status || !results) return;
        results.textContent = '';
        status.textContent = this._candidates.length
            ? 'Найдено безопасных кандидатов: ' + this._candidates.length + '. Каждая операция выполняется отдельно.'
            : 'Безопасных автоматических исправлений не найдено. Неоднозначные случаи остаются только в диагностике.';
        if (!this._candidates.length) return;

        this._candidates.forEach(function(candidate) {
            var item = document.createElement('div');
            item.className = 'workspace-repair-candidate';
            var heading = document.createElement('strong');
            heading.textContent = candidate.title;
            var detail = document.createElement('p');
            detail.className = 'small mb-2';
            detail.textContent = candidate.detail;
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-glass btn-sm';
            button.setAttribute('data-repair-candidate', candidate.id);
            button.textContent = 'Создать копию и исправить';
            item.appendChild(heading);
            item.appendChild(detail);
            item.appendChild(button);
            results.appendChild(item);
        });
    },

    _backupBeforeRepair: function() {
        if (typeof ExportModule === 'undefined' || typeof ExportModule._saveAutoBackup !== 'function' ||
            typeof ExportModule._isBackupIntact !== 'function') {
            return Promise.reject(new Error('Сервис резервного копирования недоступен. Исправление отменено.'));
        }
        return ExportModule._saveAutoBackup('repair-center').then(function(record) {
            if (!record || !ExportModule._isBackupIntact(record.data)) {
                throw new Error('Защитная копия не прошла проверку целостности. Исправление отменено.');
            }
            return record;
        });
    },

    apply: function(candidateId) {
        var self = this;
        var candidate = this._candidates.find(function(item) { return item.id === candidateId; });
        if (!candidate) return Promise.resolve(false);
        var diagnosticRun = typeof DiagnosticsModule !== 'undefined' && typeof DiagnosticsModule.run === 'function'
            ? DiagnosticsModule.run() : Promise.resolve();
        return Promise.resolve(diagnosticRun).then(function() {
            var fresh = self._buildCandidates().find(function(item) { return item.id === candidateId; });
            if (!fresh || fresh.fingerprint !== candidate.fingerprint) {
                if (typeof NotificationModule !== 'undefined') NotificationModule.warning('Данные изменились после предпросмотра. Обновите список и проверьте исправление заново.');
                self.scan();
                return false;
            }
            if (typeof StateManager !== 'undefined' && (StateManager._projectsLoadError || StateManager._projectsConflict)) {
                if (typeof NotificationModule !== 'undefined') NotificationModule.error('Есть конфликт или ошибка чтения проектов. Исправление отменено.');
                return false;
            }
            return self._backupBeforeRepair().then(function() {
            var postBackup = self._buildCandidates().find(function(item) { return item.id === candidateId; });
            if (!postBackup || postBackup.fingerprint !== candidate.fingerprint) {
                throw new Error('Данные изменились во время создания защитной копии. Исправление отменено.');
            }
            var result = false;
            if (candidate.type === 'favorite') {
                var snapshot = StorageService.getRawSnapshot('favorites');
                if (snapshot.error) throw snapshot.error;
                var current = snapshot.raw === null ? [] : JSON.parse(snapshot.raw);
                if (!Array.isArray(current) || current.indexOf(candidate.projectId) === -1) {
                    throw new Error('Избранное изменилось после предпросмотра. Исправление отменено.');
                }
                var projects = self._projects() || [];
                var trash = StorageService.get('deletedProjects') || [];
                var knownIds = new Set(projects.map(function(project) { return project && project.id; }).filter(Boolean));
                (Array.isArray(trash) ? trash : []).forEach(function(entry) {
                    if (entry && entry.project && entry.project.id) knownIds.add(entry.project.id);
                });
                if (knownIds.has(candidate.projectId)) throw new Error('Проект снова найден в рабочем пространстве. Исправление отменено.');
                var next = current.filter(function(id) { return id !== candidate.projectId; });
                if (typeof StorageService.setIfUnchanged !== 'function' ||
                    !StorageService.setIfUnchanged('favorites', next, snapshot.raw)) {
                    throw new Error('Не удалось безопасно сохранить избранное: данные могли измениться в другой вкладке.');
                }
                result = true;
            } else {
                var project = StateManager.getProject(candidate.projectId);
                if (!project || JSON.stringify(project) !== candidate.fingerprint) {
                    throw new Error('Проект изменился после предпросмотра. Исправление отменено.');
                }
                var checklist = JSON.parse(JSON.stringify(project.checklist || []));
                var notes = JSON.parse(JSON.stringify(project.notes || []));
                if (candidate.type === 'task-to-note') {
                    var task = checklist.find(function(item) { return item && item.id === candidate.entityId; });
                    var linkedNote = task && notes.find(function(item) { return item && item.id === task.sourceNoteId; });
                    if (!task || !linkedNote || linkedNote.linkedTaskId) throw new Error('Связь больше не является однозначной.');
                    linkedNote.linkedTaskId = task.id;
                } else if (candidate.type === 'note-to-task') {
                    var sourceNote = notes.find(function(item) { return item && item.id === candidate.entityId; });
                    var linkedTask = sourceNote && checklist.find(function(item) { return item && item.id === sourceNote.linkedTaskId; });
                    if (!sourceNote || !linkedTask || linkedTask.sourceNoteId) throw new Error('Связь больше не является однозначной.');
                    linkedTask.sourceNoteId = sourceNote.id;
                } else {
                    throw new Error('Неизвестный тип исправления.');
                }
                result = StateManager.updateProject(candidate.projectId, { checklist: checklist, notes: notes }) !== null;
                if (!result) throw new Error('Не удалось сохранить исправление. Возможно, данные изменились в другой вкладке.');
            }

            if (!result) throw new Error('Исправление не выполнено.');
            if (typeof NotificationModule !== 'undefined') NotificationModule.success('Исправление сохранено. Проверяем результат…');
            self.scan();
            if (typeof DiagnosticsModule !== 'undefined') DiagnosticsModule.run();
            return true;
            });
        }).catch(function(error) {
            if (typeof NotificationModule !== 'undefined') NotificationModule.error(error && error.message ? error.message : 'Не удалось выполнить исправление.');
            return false;
        });
    }
};

window.RepairModule = RepairModule;
