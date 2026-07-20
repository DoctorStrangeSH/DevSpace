/* ============================================
   AUTH SERVICE
   Аутентификация по секретному ключу
   ============================================ */

var AuthService = {
    _isOwner: false,
    _secretKey: 'DevSpace',

    init: function() {
        var savedKey = localStorage.getItem('devspace_auth_key');
        if (savedKey === this._secretKey) {
            this._isOwner = true;
        }
        this._updateUI();
        console.log('AuthService: isOwner =', this._isOwner);
    },

    login: function(key) {
        if (key === this._secretKey) {
            this._isOwner = true;
            localStorage.setItem('devspace_auth_key', key);
            this._updateUI();
            
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.success('Вы вошли как владелец');
            }
            if (typeof EventBus !== 'undefined') {
                EventBus.emit('auth:login');
            }
            return true;
        }
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.error('Неверный ключ');
        }
        return false;
    },

    logout: function() {
        this._isOwner = false;
        localStorage.removeItem('devspace_auth_key');
        this._updateUI();
        
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.info('Вы вышли');
        }
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('auth:logout');
        }
    },

    isOwner: function() {
        return this._isOwner;
    },

    _updateUI: function() {
        var self = this;
        
        // Кнопка входа в navbar
        var authBtn = document.getElementById('authBtn');
        if (authBtn) {
            if (this._isOwner) {
                authBtn.innerHTML = '<i class="bi bi-unlock-fill"></i>';
                authBtn.title = 'Вы владелец. Нажмите чтобы выйти';
                authBtn.style.color = '#22c55e';
                authBtn.onclick = function() { self.logout(); };
            } else {
                authBtn.innerHTML = '<i class="bi bi-lock-fill"></i>';
                authBtn.title = 'Войти как владелец';
                authBtn.style.color = '';
                authBtn.onclick = function() { self._showLoginDialog(); };
            }
        }

        // Все элементы с классом owner-only и sync-owner-only
        var ownerElements = document.querySelectorAll('.owner-only, .sync-owner-only');
        ownerElements.forEach(function(el) {
            el.style.display = self._isOwner ? '' : 'none';
        });

        // Кнопка нового проекта в navbar
        var newBtn = document.getElementById('newProjectBtn');
        if (newBtn) newBtn.style.display = this._isOwner ? '' : 'none';

        // Кнопка добавления в hero
        var heroBtn = document.getElementById('heroAddProjectBtn');
        if (heroBtn) heroBtn.style.display = this._isOwner ? '' : 'none';
    },

    _showLoginDialog: function() {
        var key = prompt('🔐 Введите секретный ключ для редактирования:');
        if (key) this.login(key);
    }
};

window.AuthService = AuthService;