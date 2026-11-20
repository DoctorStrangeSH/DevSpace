/* ============================================
   FAVORITES MODULE
   Система избранного
   ============================================ */

var FavoritesModule = {
    favorites: [],

    init: function() {
        var saved = StorageService.get('favorites');
        if (saved && Array.isArray(saved)) {
            this.favorites = saved;
        }
        this._bindEvents();
        console.log('FavoritesModule initialized');
    },

    _bindEvents: function() {
        var self = this;
        
        EventBus.on('favorites:updated', function() {
            if (typeof RendererModule !== 'undefined') {
                RendererModule.renderProjects();
            }
        });
    },

    toggleFavorite: function(projectId) {
        var index = this.favorites.indexOf(projectId);
        var wasFavorite = index !== -1;
        var nextFavorites = this.favorites.slice();
        if (wasFavorite) nextFavorites.splice(index, 1);
        else nextFavorites.push(projectId);

        if (StorageService.set('favorites', nextFavorites) === false) {
            if (typeof NotificationModule !== 'undefined') {
                var message = 'Не удалось сохранить избранное. Проверьте свободное место в хранилище.';
                if (typeof NotificationModule.error === 'function') NotificationModule.error(message);
                else if (typeof NotificationModule.warning === 'function') NotificationModule.warning(message);
            }
            return wasFavorite;
        }

        this.favorites = nextFavorites;
        if (typeof NotificationModule !== 'undefined') {
            if (wasFavorite) NotificationModule.info('Удалено из избранного');
            else NotificationModule.success('⭐ Добавлено в избранное');
        }
        EventBus.emit('favorites:updated', this.favorites);
        
        // Обновляем быстрое меню
        if (typeof RendererModule !== 'undefined' && typeof RendererModule._updateQuickAccess === 'function') {
            RendererModule._updateQuickAccess();
        }
        
        return index === -1;
    },

    isFavorite: function(projectId) {
        return this.favorites.indexOf(projectId) !== -1;
    },

    getFavorites: function() {
        var projects = StateManager.get('projects') || [];
        var self = this;
        return projects.filter(function(p) {
            return self.favorites.indexOf(p.id) !== -1;
        });
    }
};

window.FavoritesModule = FavoritesModule;