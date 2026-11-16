/* Google identity only. This does not authorize project editing or cloud writes. */
var FirebaseIdentityModule = {
    _auth: null,
    _user: null,
    _lastError: null,
    _ready: false,
    _sdkPromise: null,
    _previewBusy: false,
    _previewRequestId: 0,
    _activeUid: null,
    init: function() {
        var self = this;
        var button = document.getElementById('cloudIdentityBtn');
        if (!button) return;
        button.addEventListener('click', function() { self.toggleSignIn(); });
        var previewButton = document.getElementById('cloudMigrationPreviewBtn');
        if (previewButton) previewButton.addEventListener('click', function() { self.previewMigration(); });
        var backupButton = document.getElementById('cloudMigrationBackupBtn');
        if (backupButton) backupButton.addEventListener('click', function() {
            if (typeof ExportModule !== 'undefined') ExportModule.createBackup();
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
        if (this._previewBusy || !user || !user.uid || !this._ready) return Promise.resolve(false);
        var uid = user.uid;
        var requestId = ++this._previewRequestId;
        this._previewBusy = true;
        this._render();
        if (status) status.textContent = 'Проверяем облачные проекты… Никакой записи не выполняется.';
        return FirebaseService.getPrivateProjectPreview().then(function(remote) {
            if (requestId !== self._previewRequestId || !self._auth ||
                !self._auth.currentUser || self._auth.currentUser.uid !== uid) {
                return false;
            }
            if (!Array.isArray(remote)) {
                if (status) status.textContent = 'Приватное облако пока недоступно. Проверь правила Firestore; локальные проекты сохранены.';
                return false;
            }
            var local = StateManager.get('projects') || [];
            var plan = SyncModule._planPrivateMigration(local, remote);
            if (status) status.textContent = 'Предпросмотр: новых — ' + plan.upload.length +
                ', совпадающих ID — ' + plan.conflicts.length + ', пропущено — ' + plan.skipped +
                ', в облаке — ' + remote.length + '. Перенос не выполнялся.';
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
    _render: function() {
        var button = document.getElementById('cloudIdentityBtn');
        if (!button) return;
        var user = this._user;
        button.textContent = user ? 'Google: выйти' : 'Google: войти';
        button.title = user ? 'Аккаунт: ' + (user.email || 'Google') + '. Облачная запись пока отключена.' : 'Войти через Google. Облачная запись пока отключена.';
        button.setAttribute('aria-label', button.title);
        var status = document.getElementById('cloudIdentityStatus');
        if (status) status.textContent = user ? 'Вход выполнен · синхронизация записи ещё не включена' : (this._lastError || 'Облачная запись недоступна до настройки правил доступа');
        var previewButton = document.getElementById('cloudMigrationPreviewBtn');
        if (previewButton) previewButton.disabled = !user || !this._ready || this._previewBusy;
        if (!user) {
            var previewStatus = document.getElementById('cloudMigrationPreviewStatus');
            if (previewStatus) previewStatus.textContent = 'Войди через Google, чтобы проверить возможные конфликты. Данные не будут отправлены.';
        }
    }
};
window.FirebaseIdentityModule = FirebaseIdentityModule;
