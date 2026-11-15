/* Google identity only. This does not authorize project editing or cloud writes. */
var FirebaseIdentityModule = {
    _auth: null,
    _user: null,
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
    _ensureReady: function() {
        var self = this;
        return SyncModule._loadFirebaseSDK().then(function(loaded) {
            if (!loaded) throw new Error('Не удалось загрузить Firebase');
            return FirebaseService.init();
        }).then(function() { return self._loadAuthSDK(); }).then(function(ready) {
            if (!ready || !firebase.apps.length) throw new Error('Firebase Authentication недоступен');
            if (!self._auth) {
                self._auth = firebase.auth();
                self._auth.onAuthStateChanged(function(user) { self._user = user || null; self._render(); });
            }
            return self._auth;
        });
    },
    toggleSignIn: function() {
        var self = this;
        var button = document.getElementById('cloudIdentityBtn');
        if (button) button.disabled = true;
        var action;
        try {
            if (!this._ready || !this._auth) throw new Error('Firebase ещё не готов');
            action = this._auth.currentUser ? this._auth.signOut() : this._auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (error) { action = Promise.reject(error); }
        return Promise.resolve(action).catch(function(error) {
            if (typeof NotificationModule !== 'undefined') NotificationModule.error('Вход в облако: ' + (error.code === 'auth/popup-closed-by-user' ? 'окно закрыто' : 'не удалось выполнить вход. Проверь Google-вход в Firebase и разрешённые домены.'));
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
        if (status) status.textContent = user ? 'Вход выполнен · синхронизация записи ещё не включена' : 'Облачная запись недоступна до настройки правил доступа';
    }
};
window.FirebaseIdentityModule = FirebaseIdentityModule;
