/* ============================================
   ACHIEVEMENTS MODULE
   Система достижений
   ============================================ */

var AchievementsModule = {
    achievements: [
        { id: 'first_project', name: 'Первый проект', description: 'Создайте свой первый проект', icon: '🎯' },
        { id: 'three_projects', name: 'Начинающий', description: 'Создайте 3 проекта', icon: '🌱' },
        { id: 'five_projects', name: 'Коллекционер', description: 'Создайте 5 проектов', icon: '📚' },
        { id: 'ten_projects', name: 'Фабрика', description: 'Создайте 10 проектов', icon: '🏭' },
        { id: 'ten_tasks', name: 'Продуктивность', description: 'Выполните 10 задач', icon: '✅' },
        { id: 'fifty_tasks', name: 'Машина', description: 'Выполните 50 задач', icon: '🚀' },
        { id: 'hundred_tasks', name: 'Терминатор', description: 'Выполните 100 задач', icon: '🤖' },
        { id: 'all_completed', name: 'Финиш', description: 'Завершите проект на 100%', icon: '🏆' },
        { id: 'first_favorite', name: 'Избранное', description: 'Добавьте проект в избранное', icon: '⭐' },
        { id: 'first_export', name: 'На экспорт', description: 'Экспортируйте проект', icon: '📤' },
        { id: 'first_screenshot', name: 'Скриншот', description: 'Добавьте скриншот к проекту', icon: '📸' },
        { id: 'five_updates', name: 'Летописец', description: 'Добавьте 5 обновлений', icon: '📝' },
        { id: 'ten_notes', name: 'Планировщик', description: 'Создайте 10 заметок', icon: '📋' }
    ],

    unlocked: [],

    init: function() {
        // Загружаем сохранённые достижения
        var saved = StorageService.get('achievements');
        if (saved && Array.isArray(saved) && saved.length > 0) {
            this.unlocked = saved;
        }
        
        // НЕ рендерим здесь — app.js сделает это один раз
        
        this._bindEvents();
        
        // Проверяем достижения после загрузки проектов
        var self = this;
        setTimeout(function() {
            self._checkAll();
        }, 1000);
        
        console.log('Achievements: ' + this.unlocked.length + ' разблокировано');
    },

    _bindEvents: function() {
        var self = this;
        
        EventBus.on('project:added', function() {
            setTimeout(function() { self._checkAll(); }, 300);
        });
        EventBus.on('checklist:changed', function() {
            setTimeout(function() { self._checkAll(); }, 300);
        });
        EventBus.on('favorites:updated', function() {
            setTimeout(function() { self._checkAll(); }, 300);
        });
        EventBus.on('notes:added', function() {
            setTimeout(function() { self._checkAll(); }, 300);
        });
        EventBus.on('update:added', function() {
            setTimeout(function() { self._checkAll(); }, 300);
        });
        
        // При получении данных из облака
        EventBus.on('data:imported', function() {
            var saved = StorageService.get('achievements');
            if (saved && Array.isArray(saved)) {
                self.unlocked = saved;
            }
            self._renderAchievements();
            setTimeout(function() { self._checkAll(); }, 1000);
        });
    },

    check: function(achievementId) {
        // Уже разблокирована
        if (this.unlocked.indexOf(achievementId) !== -1) {
            return false;
        }

        var achievement = null;
        for (var i = 0; i < this.achievements.length; i++) {
            if (this.achievements[i].id === achievementId) {
                achievement = this.achievements[i];
                break;
            }
        }
        
        if (!achievement) return false;

        // Разблокируем
        this.unlocked.push(achievementId);
        
        // Сохраняем локально
        StorageService.set('achievements', this.unlocked);
        
        // Обновляем отображение
        this._renderAchievements();
        
        // Уведомление
        if (typeof NotificationModule !== 'undefined') {
            NotificationModule.show(
                achievement.icon + ' ' + achievement.name,
                'achievement',
                { duration: 3000 }
            );
        }
        
        console.log('🏆 ' + achievement.name);
        return true;
    },

    _checkAll: function() {
        var projects = StateManager.get('projects') || [];
        var stats = StateManager.get('stats') || {};
        var totalUpdates = 0;
        var totalNotes = 0;
        var hasScreenshot = false;
        
        for (var i = 0; i < projects.length; i++) {
            totalUpdates += (projects[i].updates || []).length;
            totalNotes += (projects[i].notes || []).length;
            if ((projects[i].screenshots || []).length > 0) {
                hasScreenshot = true;
            }
        }

        // Проверяем все достижения
        if (projects.length >= 1) this.check('first_project');
        if (projects.length >= 3) this.check('three_projects');
        if (projects.length >= 5) this.check('five_projects');
        if (projects.length >= 10) this.check('ten_projects');
        
        if ((stats.completedTasks || 0) >= 10) this.check('ten_tasks');
        if ((stats.completedTasks || 0) >= 50) this.check('fifty_tasks');
        if ((stats.completedTasks || 0) >= 100) this.check('hundred_tasks');
        
        // Проверяем завершённые проекты
        for (var j = 0; j < projects.length; j++) {
            if ((projects[j].progress || 0) === 100) {
                this.check('all_completed');
                break;
            }
        }
        
        if (typeof FavoritesModule !== 'undefined' && FavoritesModule.favorites && FavoritesModule.favorites.length > 0) {
            this.check('first_favorite');
        }
        if (totalUpdates >= 5) this.check('five_updates');
        if (totalNotes >= 10) this.check('ten_notes');
        if (hasScreenshot) this.check('first_screenshot');
    },

    _renderAchievements: function() {
        var container = document.getElementById('achievementsContainer');
        if (!container) return;

        var self = this;
        var html = '';
        
        for (var i = 0; i < this.achievements.length; i++) {
            var a = this.achievements[i];
            var unlocked = self.unlocked.indexOf(a.id) !== -1;
            
            html += '<div class="col-lg-3 col-md-4 col-6" data-aos="fade-up">' +
                '<div class="achievement-card ' + (unlocked ? 'unlocked' : 'locked') + '">' +
                    '<div class="achievement-icon">' + a.icon + '</div>' +
                    '<div class="achievement-name">' + a.name + '</div>' +
                    '<div class="achievement-desc">' + a.description + '</div>' +
                    (unlocked ? '' : '<div class="achievement-lock"><i class="bi bi-lock"></i></div>') +
                '</div>' +
            '</div>';
        }
        
        container.innerHTML = html;
    }
};

window.AchievementsModule = AchievementsModule;