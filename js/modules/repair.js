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
        this.renderJournal();
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

    renderJournal: function() {
        if (typeof document === 'undefined') return;
        var target = document.getElementById('workspaceRepairJournal');
        if (!target) return;
        target.textContent = '';
        try {
            var entries = this._readJournal().entries.slice().reverse().slice(0, 8);
            if (!entries.length) {
                target.textContent = 'Пока нет выполненных или начатых операций.';
                return;
            }
            entries.forEach(function(entry) {
                var row = document.createElement('div');
                row.className = 'workspace-repair-journal-entry';
                var heading = document.createElement('strong');
                var statusLabel = entry.status === 'completed' ? 'Выполнено'
                    : entry.status === 'prepared' ? 'Подготовлено'
                    : entry.status === 'rollback_failed' ? 'Нужна ручная проверка' : 'Не выполнено';
                heading.textContent = statusLabel + ' · ' + entry.type;
                var detail = document.createElement('p');
                detail.className = 'small mb-0';
                detail.textContent = [entry.createdAt, entry.projectId ? 'Проект: ' + entry.projectId : '',
                    entry.entityId ? 'ID: ' + entry.entityId : '', entry.message || ''].filter(Boolean).join(' · ');
                row.appendChild(heading);
                row.appendChild(detail);
                target.appendChild(row);
            });
        } catch (error) {
            target.textContent = 'Журнал недоступен: ' + (error && error.message ? error.message : 'ошибка чтения');
        }
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

    _readJournal: function() {
        var snapshot = StorageService.getRawSnapshot('repairLog');
        if (snapshot.error) throw snapshot.error;
        var entries = snapshot.raw === null ? [] : JSON.parse(snapshot.raw);
        if (!Array.isArray(entries)) throw new Error('Журнал восстановления повреждён. Исправление отменено.');
        return { entries: entries, raw: snapshot.raw };
    },

    _writeJournal: function(entries, expectedRaw) {
        if (typeof StorageService.setIfUnchanged !== 'function' ||
            !StorageService.setIfUnchanged('repairLog', entries, expectedRaw)) {
            throw new Error('Не удалось безопасно обновить журнал восстановления. Возможно, он изменился в другой вкладке.');
        }
        return typeof StorageService.getRaw === 'function'
            ? StorageService.getRaw('repairLog') : JSON.stringify(entries);
    },

    _createJournalEntry: function(candidate) {
        var journal = this._readJournal();
        var now = Date.now();
        var entry = {
            id: 'repair-' + now + '-' + Math.random().toString(36).slice(2, 8),
            createdAt: new Date(now).toISOString(),
            type: candidate.type,
            projectId: candidate.projectId || null,
            entityId: candidate.entityId || candidate.projectId || null,
            status: 'prepared',
            message: 'Операция подготовлена; ожидает защитную копию и проверку состояния.'
        };
        var entries = journal.entries.concat([entry]).slice(-50);
        this._writeJournal(entries, journal.raw);
        return entry;
    },

    _updateJournalEntry: function(entry, status, message) {
        var journal = this._readJournal();
        var index = journal.entries.findIndex(function(item) { return item && item.id === entry.id; });
        if (index === -1) throw new Error('Запись операции исчезла из журнала восстановления.');
        var next = journal.entries.slice();
        next[index] = Object.assign({}, next[index], {
            status: status,
            updatedAt: new Date().toISOString(),
            message: String(message || '').slice(0, 240)
        });
        this._writeJournal(next.slice(-50), journal.raw);
        return true;
    },

    _rollbackMutation: function(mutation) {
        if (!mutation) return true;
        if (mutation.type === 'favorite') {
            if (typeof StorageService.getRaw !== 'function' ||
                StorageService.getRaw('favorites') !== mutation.writtenRaw) return false;
            return StorageService.restoreRaw('favorites', mutation.snapshot);
        }
        if (mutation.type === 'project') {
            var current = StateManager.getProject(mutation.projectId);
            if (!current || JSON.stringify(current) !== JSON.stringify(mutation.updatedProject)) return false;
            return StateManager.updateProject(mutation.projectId, {
                checklist: mutation.previousProject.checklist || [],
                notes: mutation.previousProject.notes || []
            }) !== null;
        }
        return false;
    },

    apply: function(candidateId) {
        var self = this;
        var candidate = this._candidates.find(function(item) { return item.id === candidateId; });
        if (!candidate) return Promise.resolve(false);

        var mutation = null;
        var journalEntry = null;
        var transactionStarted = false;
        var baselineReport = null;

        function fail(error) {
            var message = error && error.message ? error.message : 'Не удалось выполнить исправление.';
            var rollbackResult = true;
            if (mutation) {
                try { rollbackResult = self._rollbackMutation(mutation); }
                catch (rollbackError) {
                    console.error('Repair rollback failed:', rollbackError);
                    rollbackResult = false;
                }
            }
            var journalResult = journalEntry
                ? Promise.resolve().then(function() {
                    return self._updateJournalEntry(journalEntry, rollbackResult ? 'failed' : 'rollback_failed',
                        rollbackResult ? message : message + ' Откат не выполнен автоматически: требуется ручная проверка.');
                }).catch(function(journalError) {
                    console.error('Repair journal update failed:', journalError);
                    return false;
                })
                : Promise.resolve(false);
            return journalResult.then(function() {
                if (typeof NotificationModule !== 'undefined') {
                    NotificationModule.error(message + (mutation ? (rollbackResult
                        ? ' Изменение отменено, исходные данные восстановлены.'
                        : ' Автоматический откат не удался; не повторяйте операцию до проверки данных.') : ''));
                }
                self.scan();
                self.renderJournal();
                return false;
            });
        }

        var diagnosticRun = typeof DiagnosticsModule !== 'undefined' && typeof DiagnosticsModule.run === 'function'
            ? DiagnosticsModule.run() : Promise.resolve(null);
        return Promise.resolve(diagnosticRun).then(function(report) {
            baselineReport = report || (typeof DiagnosticsModule !== 'undefined' ? DiagnosticsModule._lastReport : null);
            var fresh = self._buildCandidates().find(function(item) { return item.id === candidateId; });
            if (!fresh || fresh.fingerprint !== candidate.fingerprint) {
                if (typeof NotificationModule !== 'undefined') NotificationModule.warning('Данные изменились после предпросмотра. Обновите список и проверьте исправление заново.');
                self.scan();
                return false;
            }
            if (typeof StateManager !== 'undefined' && (StateManager._projectsLoadError || StateManager._projectsConflict)) {
                throw new Error('Есть конфликт или ошибка чтения проектов. Исправление отменено.');
            }

            journalEntry = self._createJournalEntry(candidate);
            return self._backupBeforeRepair().then(function() {
                var postBackup = self._buildCandidates().find(function(item) { return item.id === candidateId; });
                if (!postBackup || postBackup.fingerprint !== candidate.fingerprint) {
                    throw new Error('Данные изменились во время создания защитной копии. Исправление отменено.');
                }

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
                    mutation = {
                        type: 'favorite',
                        snapshot: snapshot,
                        writtenRaw: typeof StorageService.getRaw === 'function' ? StorageService.getRaw('favorites') : JSON.stringify(next)
                    };
                } else {
                    var project = StateManager.getProject(candidate.projectId);
                    if (!project || JSON.stringify(project) !== candidate.fingerprint) {
                        throw new Error('Проект изменился после предпросмотра. Исправление отменено.');
                    }
                    var previousProject = JSON.parse(JSON.stringify(project));
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
                    var updatedProject = StateManager.updateProject(candidate.projectId, { checklist: checklist, notes: notes });
                    if (!updatedProject) throw new Error('Не удалось сохранить исправление. Возможно, данные изменились в другой вкладке.');
                    mutation = {
                        type: 'project',
                        projectId: candidate.projectId,
                        previousProject: previousProject,
                        updatedProject: JSON.parse(JSON.stringify(updatedProject))
                    };
                }

                transactionStarted = true;
                var stillCandidate = self._buildCandidates().some(function(item) { return item.id === candidateId; });
                if (stillCandidate) throw new Error('Повторная проверка не подтвердила исправление.');
                return typeof DiagnosticsModule !== 'undefined' && typeof DiagnosticsModule.run === 'function'
                    ? DiagnosticsModule.run() : Promise.resolve(null);
            }).then(function(report) {
                var beforeErrors = baselineReport && baselineReport.summary ? baselineReport.summary.errors : 0;
                var afterErrors = report && report.summary ? report.summary.errors : beforeErrors;
                if (transactionStarted && afterErrors > beforeErrors) {
                    throw new Error('После исправления количество критических проблем увеличилось.');
                }
                self._updateJournalEntry(journalEntry, 'completed', 'Исправление сохранено; повторная проверка завершена.');
                mutation = null;
                if (typeof NotificationModule !== 'undefined') NotificationModule.success('Исправление сохранено и проверено. Запись добавлена в журнал.');
                self.scan();
                self.renderJournal();
                return true;
            }).catch(fail);
        }).catch(fail);
    }
};

window.RepairModule = RepairModule;
