/* Google identity only. This does not authorize project editing or cloud writes. */
var FirebaseIdentityModule = {
    _auth: null,
    _user: null,
    _lastError: null,
    _ready: false,
    _sdkPromise: null,
    _previewBusy: false,
    _uploadBusy: false,
    _downloadBusy: false,
    _backupReady: false,
    _eligibleUploads: [],
    _eligibleDownloads: [],
    _previewRequestId: 0,
    _activeUid: null,
    init: function() {
        var self = this;
        var button = document.getElementById('cloudIdentityBtn');
        if (!button) return;
        button.addEventListener('click', function() { self.toggleSignIn(); });
        var previewButton = document.getElementById('cloudMigrationPreviewBtn');
        if (previewButton) previewButton.addEventListener('click', function() { self.previewMigration(); });
        var uploadButton = document.getElementById('cloudMigrationUploadBtn');
        if (uploadButton) uploadButton.addEventListener('click', function() { self.uploadOneProject(); });
        var downloadButton = document.getElementById('cloudMigrationDownloadBtn');
        if (downloadButton) downloadButton.addEventListener('click', function() { self.downloadOneProject(); });
        var backupButton = document.getElementById('cloudMigrationBackupBtn');
        if (backupButton) backupButton.addEventListener('click', function() {
            if (typeof ExportModule !== 'undefined') {
                ExportModule.createBackup();
                self._backupReady = true;
                self._render();
            }
        });
        button.disabled = true;
        this._render();
        // Prepare the SDK first so the Google popup can be opened directly on click.
        this._ensureReady().then(function() { self._ready = true; button.disabled = false; self._render(); }).catch(function() {
            button.disabled = false;
            button.title = 'Не удалось подготовить вход; повторить попытку';
        });
    },
    _loadAuthSDK: function() {
        if (typeof firebase !== 'undefined' && typeof firebase.auth === 'function') return Promise.resolve(true);
        if (this._sdkPromise) return this._sdkPromise;
        this._sdkPromise = new Promise(function(resolve) {
            var script = document.createElement('script');
            script.src = 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth-compat.js';
            script.async = true;
            script.onload = function() { resolve(typeof firebase !== 'undefined' && typeof firebase.auth === 'function'); };
            script.onerror = function() { resolve(false); };
            document.head.appendChild(script);
        });
        return this._sdkPromise;
    },
    _describeAuthError: function(error) {
        var code = error && typeof error.code === 'string' ? error.code : 'auth/sdk-unavailable';
        var messages = {
            'auth/operation-not-allowed': 'Google-вход не активирован в Firebase Authentication. Сохрани настройки провайдера.',
            'auth/unauthorized-domain': 'Домен сайта не разрешён. Добавь doctorstrangesh.github.io в Authorized domains.',
            'auth/popup-blocked': 'Браузер заблокировал окно входа. Разреши всплывающие окна для DevSpace.',
            'auth/popup-closed-by-user': 'Окно входа закрыто до завершения авторизации.',
            'auth/network-request-failed': 'Ошибка сети. Проверь доступность Firebase и повтори попытку.',
            'auth/account-exists-with-different-credential': 'Этот адрес уже привязан к другому способу входа.',
            'auth/cancelled-popup-request': 'Предыдущее окно авторизации было закрыто новым запросом.',
            'auth/sdk-unavailable': 'Не удалось подготовить Firebase Authentication. Обнови страницу.'
        };
        return (messages[code] || 'Не удалось выполнить вход. Проверь настройки Firebase.') + ' [' + code.slice(0, 80) + ']';
    },
    _ensureReady: function() {
        var self = this;
        return SyncModule._loadFirebaseSDK().then(function(loaded) {
            if (!loaded) throw new Error('Не удалось загрузить Firebase');
            return FirebaseService.init();
        }).then(function() { return self._loadAuthSDK(); }).then(function(ready) {
            if (!ready || !firebase.apps.length) throw new Error('Firebase Authentication недоступен');
            if (!self._auth) {
                self._auth = firebase.auth();
                self._auth.onAuthStateChanged(function(user) {
                    var nextUid = user && user.uid || null;
                    if (nextUid !== self._activeUid) {
                        self._activeUid = nextUid;
                        self._previewRequestId++;
                        self._previewBusy = false;
                        self._uploadBusy = false;
                        self._downloadBusy = false;
                        self._backupReady = false;
                        self._eligibleUploads = [];
                        self._eligibleDownloads = [];
                        var previewStatus = document.getElementById('cloudMigrationPreviewStatus');
                        if (previewStatus) previewStatus.textContent = nextUid
                            ? 'Аккаунт подключён. Нажми «Проверить перенос в облако».'
                            : 'Войди через Google, чтобы проверить возможные конфликты. Данные не будут отправлены.';
                    }
                    self._user = user || null;
                    if (user) self._lastError = null;
                    self._render();
                });
            }
            return self._auth;
        });
    },
    toggleSignIn: function() {
        var self = this;
        this._lastError = null;
        var button = document.getElementById('cloudIdentityBtn');
        if (button) button.disabled = true;
        var action;
        try {
            if (!this._ready || !this._auth) throw new Error('Firebase ещё не готов');
            action = this._auth.currentUser ? this._auth.signOut() : this._auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (error) { action = Promise.reject(error); }
        return Promise.resolve(action).catch(function(error) {
            var message = self._describeAuthError(error);
            self._lastError = message;
            if (typeof NotificationModule !== 'undefined') NotificationModule.error('Вход в облако: ' + message);
        }).finally(function() { if (button) button.disabled = false; self._render(); });
    },
    previewMigration: function() {
        var self = this;
        var status = document.getElementById('cloudMigrationPreviewStatus');
        var user = this._auth && this._auth.currentUser;
        if (this._previewBusy || this._uploadBusy || this._downloadBusy || !user || !user.uid || !this._ready) return Promise.resolve(false);
        var uid = user.uid;
        var requestId = ++this._previewRequestId;
        this._previewBusy = true;
        this._eligibleUploads = [];
        this._eligibleDownloads = [];
        this._render();
        if (status) status.textContent = 'Проверяем облачные проекты… Никакой записи не выполняется.';
        return FirebaseService.getPrivateProjectPreview().then(function(remote) {
            if (requestId !== self._previewRequestId || !self._auth ||
                !self._auth.currentUser || self._auth.currentUser.uid !== uid) {
                return false;
            }
            if (!Array.isArray(remote)) {
                if (status) status.textContent = FirebaseService._describePrivatePreviewError(
                    FirebaseService._lastPrivatePreviewError) + ' Локальные проекты сохранены.';
                return false;
            }
            var local = StateManager.get('projects') || [];
            var plan = SyncModule._planPrivateMigration(local, remote);
            self._eligibleUploads = plan.upload;
            var localIds = new Set(local.filter(function(project) { return project && typeof project.id === 'string'; })
                .map(function(project) { return project.id; }));
            self._eligibleDownloads = remote.filter(function(project) { return !localIds.has(project.id); });
            if (status) status.textContent = 'Предпросмотр: новых — ' + plan.upload.length +
                ', совпадающих ID — ' + plan.conflicts.length + ', пропущено — ' + plan.skipped +
                ', в облаке — ' + remote.length + ', доступно для получения — ' + self._eligibleDownloads.length +
                '. Перенос не выполнялся. ' +
                (plan.upload.length ? 'Скачай резервную копию, выбери один проект и подтверди загрузку.' :
                    'Новых проектов для загрузки нет. Локальные данные сохранены.');
            return true;
        }).catch(function() {
            if (requestId === self._previewRequestId && status) {
                status.textContent = 'Не удалось проверить перенос. Локальные данные не изменены.';
            }
            return false;
        }).finally(function() {
            if (requestId !== self._previewRequestId) return;
            self._previewBusy = false;
            self._render();
        });
    },
    // First migration: one explicit create, after a fresh remote check. Never merge,
    // overwrite, delete or automatically upload the remaining projects.
    uploadOneProject: function() {
        var self = this;
        var select = document.getElementById('cloudMigrationProjectSelect');
        var status = document.getElementById('cloudMigrationPreviewStatus');
        var user = this._auth && this._auth.currentUser;
        var projectId = select && select.value;
        if (this._uploadBusy || this._downloadBusy || this._previewBusy || !this._ready || !this._backupReady ||
            !user || !user.uid || !projectId ||
            !this._eligibleUploads.some(function(project) { return project.id === projectId; })) {
            return Promise.resolve(false);
        }
        var uid = user.uid;
        var selected = this._eligibleUploads.find(function(project) { return project.id === projectId; });
        var expected = JSON.stringify(selected);
        if (!window.confirm('Загрузить только «' + (selected.name || selected.title || projectId) +
            '» в личное облако?\n\nУбедись, что резервная копия скачана. Остальные проекты останутся на устройстве.')) {
            return Promise.resolve(false);
        }
        var requestId = ++this._previewRequestId;
        this._uploadBusy = true;
        this._eligibleUploads = [];
        this._render();
        if (status) status.textContent = 'Повторно сверяем облако перед загрузкой одного проекта…';
        return FirebaseService.getPrivateProjectPreview().then(function(remote) {
            if (requestId !== self._previewRequestId || !self._auth ||
                !self._auth.currentUser || self._auth.currentUser.uid !== uid) return false;
            if (!Array.isArray(remote)) {
                if (status) status.textContent = FirebaseService._describePrivatePreviewError(
                    FirebaseService._lastPrivatePreviewError) + ' Ничего не отправлено.';
                return false;
            }
            var local = StateManager.get('projects') || [];
            var candidate = SyncModule._prepareSinglePrivateMigration(projectId, local, remote);
            if (!candidate || JSON.stringify(candidate) !== expected) {
                if (status) status.textContent = 'Проект или облако изменились. Загрузка отменена. Запусти проверку заново.';
                return false;
            }
            if (status) status.textContent = 'Отправляем один проект…';
            return FirebaseService.createPrivateProjectIfAbsent(candidate, uid).then(function(created) {
                if (requestId !== self._previewRequestId || !self._auth ||
                    !self._auth.currentUser || self._auth.currentUser.uid !== uid) return false;
                if (status) status.textContent = created
                    ? 'Готово! Один проект проверен и сохранён в личном облаке. Локальная копия не изменена. Для следующего проекта повтори проверку.'
                    : FirebaseService._describePrivateCreateError(FirebaseService._lastPrivateCreateError) +
                        ' Локальные данные сохранены.';
                return created;
            });
        }).catch(function() {
            if (requestId === self._previewRequestId && status) {
                status.textContent = 'Загрузка не подтверждена. Проверь облако повторной проверкой; локальная копия сохранена.';
            }
            return false;
        }).finally(function() {
            if (requestId !== self._previewRequestId) return;
            self._uploadBusy = false;
            self._render();
        });
    },
    // Import ONE missing project only. The fresh cloud read and a second local
    // conflict check happen immediately before any local state mutation.
    downloadOneProject: function() {
        var self = this;
        var select = document.getElementById('cloudMigrationDownloadSelect');
        var status = document.getElementById('cloudMigrationPreviewStatus');
        var user = this._auth && this._auth.currentUser;
        var projectId = select && select.value;
        if (this._previewBusy || this._uploadBusy || this._downloadBusy || !this._ready ||
            !this._backupReady || !user || !user.uid || !projectId ||
            !this._eligibleDownloads.some(function(project) { return project.id === projectId; })) {
            return Promise.resolve(false);
        }
        var uid = user.uid;
        var expected = JSON.stringify(this._eligibleDownloads.find(function(project) { return project.id === projectId; }));
        if (!window.confirm('Получить один проект из личного облака?\n\nСначала проверь скачанную резервную копию. Существующие локальные проекты не заменяются.')) {
            return Promise.resolve(false);
        }
        var requestId = ++this._previewRequestId;
        this._downloadBusy = true;
        this._eligibleDownloads = [];
        this._eligibleUploads = [];
        this._render();
        if (status) status.textContent = 'Проверяем свежую облачную копию…';
        return FirebaseService.getPrivateProjectPreview().then(function(remote) {
            if (requestId !== self._previewRequestId || !self._auth ||
                !self._auth.currentUser || self._auth.currentUser.uid !== uid) return false;
            if (!Array.isArray(remote)) {
                if (status) status.textContent = FirebaseService._describePrivatePreviewError(
                    FirebaseService._lastPrivatePreviewError) + ' Локальные проекты не изменены.';
                return false;
            }
            var matches = remote.filter(function(project) { return project.id === projectId; });
            var currentLocal = StateManager.get('projects') || [];
            if (matches.length !== 1 || JSON.stringify(matches[0]) !== expected ||
                !Array.isArray(currentLocal) || currentLocal.some(function(project) { return project && project.id === projectId; })) {
                if (status) status.textContent = 'Облачный проект изменился или такой ID уже есть локально. Ничего не заменено.';
                return false;
            }
            // Revalidate and clone to avoid passing a shared mutable object to StateManager.
            var candidate = FirebaseService._preparePrivateProjectEnvelope(matches[0]);
            if (!candidate) {
                if (status) status.textContent = 'Облачный проект не прошёл проверку. Загрузка отменена.';
                return false;
            }
            try {
                StateManager.addProject(JSON.parse(candidate.payload));
                if (typeof RendererModule !== 'undefined') {
                    RendererModule.renderProjects();
                    RendererModule.renderStats();
                }
                if (status) status.textContent = 'Готово! Один проект получен из облака. Остальные локальные проекты сохранены.';
                return true;
            } catch (error) {
                if (status) status.textContent = 'Не удалось сохранить проект на устройстве. Проверь свободное место и резервную копию.';
                return false;
            }
        }).catch(function() {
            if (requestId === self._previewRequestId && status) {
                status.textContent = 'Не удалось получить проект. Локальные данные сохранены.';
            }
            return false;
        }).finally(function() {
            if (requestId !== self._previewRequestId) return;
            self._downloadBusy = false;
            self._render();
        });
    },
    _render: function() {
        var button = document.getElementById('cloudIdentityBtn');
        if (!button) return;
        var user = this._user;
        button.textContent = user ? 'Google: выйти' : 'Google: войти';
        button.title = user ? 'Аккаунт: ' + (user.email || 'Google') + '. Автоматическая облачная запись отключена.' : 'Войти через Google. Облачная запись пока отключена.';
        button.setAttribute('aria-label', button.title);
        var status = document.getElementById('cloudIdentityStatus');
        if (status) status.textContent = user ? 'Вход выполнен · доступен ручной перенос одного проекта' : (this._lastError || 'Для загрузки одного проекта войди через Google');
        var previewButton = document.getElementById('cloudMigrationPreviewBtn');
        if (previewButton) previewButton.disabled = !user || !this._ready || this._previewBusy || this._uploadBusy || this._downloadBusy;
        var select = document.getElementById('cloudMigrationProjectSelect');
        if (select) {
            var previous = select.value;
            select.replaceChildren();
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = this._eligibleUploads.length ? 'Выбери проект' : 'Сначала проверь перенос';
            select.appendChild(empty);
            this._eligibleUploads.forEach(function(project) {
                var option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name || project.title || project.id;
                select.appendChild(option);
            });
            if (this._eligibleUploads.some(function(project) { return project.id === previous; })) select.value = previous;
            select.disabled = !user || this._previewBusy || this._uploadBusy || this._downloadBusy || !this._eligibleUploads.length;
        }
        var uploadButton = document.getElementById('cloudMigrationUploadBtn');
        if (uploadButton) uploadButton.disabled = !user || !this._ready || this._previewBusy ||
            this._uploadBusy || this._downloadBusy || !this._backupReady || !select || !select.value;
        var downloadSelect = document.getElementById('cloudMigrationDownloadSelect');
        if (downloadSelect) {
            var selectedDownload = downloadSelect.value;
            downloadSelect.replaceChildren();
            var emptyDownload = document.createElement('option');
            emptyDownload.value = '';
            emptyDownload.textContent = this._eligibleDownloads.length ? 'Выбери облачный проект' : 'Сначала проверь облако';
            downloadSelect.appendChild(emptyDownload);
            this._eligibleDownloads.forEach(function(project) {
                var option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name || project.title || project.id;
                downloadSelect.appendChild(option);
            });
            if (this._eligibleDownloads.some(function(project) { return project.id === selectedDownload; })) downloadSelect.value = selectedDownload;
            downloadSelect.disabled = !user || this._previewBusy || this._uploadBusy || this._downloadBusy || !this._eligibleDownloads.length;
            if (!downloadSelect._cloudDownloadListenerBound) {
                downloadSelect.addEventListener('change', this._render.bind(this));
                downloadSelect._cloudDownloadListenerBound = true;
            }
        }
        var downloadButton = document.getElementById('cloudMigrationDownloadBtn');
        if (downloadButton) downloadButton.disabled = !user || !this._ready || !this._backupReady ||
            this._previewBusy || this._uploadBusy || this._downloadBusy || !downloadSelect || !downloadSelect.value;
        if (select && !select._cloudUploadListenerBound) {
            select.addEventListener('change', this._render.bind(this));
            select._cloudUploadListenerBound = true;
        }
        if (!user) {
            var previewStatus = document.getElementById('cloudMigrationPreviewStatus');
            if (previewStatus) previewStatus.textContent = 'Войди через Google, чтобы проверить возможные конфликты. Данные не будут отправлены.';
        }
    }
};
window.FirebaseIdentityModule = FirebaseIdentityModule;
