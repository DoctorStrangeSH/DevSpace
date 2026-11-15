/* Google identity only. This does not authorize project editing or cloud writes. */
var FirebaseIdentityModule = {
    _auth: null,
    _user: null,
    _lastError: null,
    _ready: false,
    _sdkPromise: null,
    init: function() {
        var self = this;
        var button = document.getElementById('cloudIdentityBtn');
        if (!button) return;
        button.addEventListener('click', function() { self.toggleSignIn(); });
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
                self._auth.onAuthStateChanged(function(user) { self._user = user || null; if (user) self._lastError = null; self._render(); });
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
    _render: function() {
        var button = document.getElementById('cloudIdentityBtn');
        if (!button) return;
        var user = this._user;
        button.textContent = user ? 'Google: выйти' : 'Google: войти';
        button.title = user ? 'Аккаунт: ' + (user.email || 'Google') + '. Облачная запись пока отключена.' : 'Войти через Google. Облачная запись пока отключена.';
        button.setAttribute('aria-label', button.title);
        var status = document.getElementById('cloudIdentityStatus');
        if (status) status.textContent = user ? 'Вход выполнен · синхронизация записи ещё не включена' : (this._lastError || 'Облачная запись недоступна до настройки правил доступа');
    }
};
window.FirebaseIdentityModule = FirebaseIdentityModule;
