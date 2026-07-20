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
        
        if (index === -1) {
            this.favorites.push(projectId);
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.success('⭐ Добавлено в избранное');
            }
        } else {
            this.favorites.splice(index, 1);
            if (typeof NotificationModule !== 'undefined') {
                NotificationModule.info('Удалено из избранного');
            }
        }

        StorageService.set('favorites', this.favorites);
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