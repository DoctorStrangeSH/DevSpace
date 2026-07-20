/* ============================================
   STATS MODULE
   Статистика и аналитика
   ============================================ */

const StatsModule = {
    // Инициализация
    init() {
        this._bindEvents();
        console.log('StatsModule initialized');
    },

    // Привязка событий
    _bindEvents() {
        EventBus.on('stats:updated', this._updateDisplay.bind(this));
        EventBus.on('state:initialized', () => {
            this._updateDisplay(StateManager.get('stats'));
        });
    },

    // Обновление отображения статистики
    _updateDisplay(stats) {
        if (!stats) return;

        // Анимируем изменение чисел
        this._animateNumber('totalProjects', stats.totalProjects);
        this._animateNumber('completedTasks', stats.completedTasks);
        this._animateNumber('inProgress', stats.inProgress);
        this._animateNumber('totalUpdates', stats.totalUpdates);

        // Обновляем hero-статистику
        this._animateNumber('heroTotalProjects', stats.totalProjects);
        this._animateNumber('heroCompletedTasks', stats.completedTasks);
        this._animateNumber('heroUpdatesCount', stats.totalUpdates);
    },

    // Анимация изменения числа
    _animateNumber(elementId, targetValue) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const startValue = parseInt(element.textContent) || 0;
        const duration = 600;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing функция
            const eased = 1 - Math.pow(1 - progress, 3);
            const currentValue = Math.round(startValue + (targetValue - startValue) * eased);

            element.textContent = currentValue;

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    },

    // Получение полной статистики
    getFullStats() {
        const projects = StateManager.get('projects');
        
        const stats = {
            // Общая статистика
            total: projects.length,
            byStatus: {},
            byMonth: {},
            
            // Чеклисты
            checklistTotal: 0,
            checklistCompleted: 0,
            
            // Обновления
            updatesTotal: 0,
            
            // Технологии
            topTechnologies: [],
            
            // Активность
            lastActivity: null,
            mostActiveDay: null,
            
            // Прогресс
            averageProgress: 0,
            completedProjects: 0
        };

        // Счетчики
        const statusCount = {};
        const monthCount = {};
        const techCount = {};
        const dayActivity = {};

        projects.forEach(project => {
            // Статусы
            statusCount[project.status] = (statusCount[project.status] || 0) + 1;

            // По месяцам
            const month = project.createdAt?.substring(0, 7);
            if (month) {
                monthCount[month] = (monthCount[month] || 0) + 1;
            }

            // Технологии
            if (project.techStack) {
                project.techStack.forEach(tech => {
                    techCount[tech] = (techCount[tech] || 0) + 1;
                });
            }

            // Чеклисты
            if (project.checklist) {
                stats.checklistTotal += project.checklist.length;
                stats.checklistCompleted += project.checklist.filter(i => i.completed).length;
            }

            // Обновления
            if (project.updates) {
                stats.updatesTotal += project.updates.length;
            }

            // Активность по дням
            if (project.updatedAt) {
                const day = project.updatedAt.substring(0, 10);
                dayActivity[day] = (dayActivity[day] || 0) + 1;
            }

            // Прогресс
            stats.averageProgress += project.progress || 0;

            // Завершенные
            if (project.status === 'completed') {
                stats.completedProjects++;
            }
        });

        // Средний прогресс
        if (projects.length > 0) {
            stats.averageProgress = Math.round(stats.averageProgress / projects.length);
        }

        // Статусы
        stats.byStatus = statusCount;

        // По месяцам
        stats.byMonth = Object.entries(monthCount)
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 12)
            .reduce((acc, [month, count]) => {
                acc[month] = count;
                return acc;
            }, {});

        // Топ технологий
        stats.topTechnologies = Object.entries(techCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([tech, count]) => ({ tech, count }));

        // Самый активный день
        const mostActive = Object.entries(dayActivity)
            .sort(([, a], [, b]) => b - a)[0];
        
        if (mostActive) {
            stats.mostActiveDay = {
                date: mostActive[0],
                count: mostActive[1]
            };
        }

        // Последняя активность
        if (projects.length > 0) {
            const sorted = [...projects].sort((a, b) => 
                new Date(b.updatedAt) - new Date(a.updatedAt)
            );
            stats.lastActivity = sorted[0].updatedAt;
        }

        return stats;
    },

    // Экспорт статистики
    exportStats() {
        const stats = this.getFullStats();
        const data = JSON.stringify(stats, null, 2);
        const filename = `devspace-stats-${new Date().toISOString().split('T')[0]}.json`;
        
        Helpers.downloadFile(data, filename);
        NotificationModule.success('Статистика экспортирована');
    },

    // Генерация отчета
    generateReport() {
        const stats = this.getFullStats();
        const projects = StateManager.get('projects');

        let report = '# 📊 Отчет DevSpace\n\n';
        report += `Дата создания: ${new Date().toLocaleDateString('ru-RU')}\n\n`;
        
        report += '## 📈 Общая статистика\n\n';
        report += `- Всего проектов: **${stats.total}**\n`;
        report += `- Завершено проектов: **${stats.completedProjects}**\n`;
        report += `- Средний прогресс: **${stats.averageProgress}%**\n`;
        report += `- Всего задач: **${stats.checklistTotal}**\n`;
        report += `- Выполнено задач: **${stats.checklistCompleted}**\n`;
        report += `- Всего обновлений: **${stats.updatesTotal}**\n\n`;

        report += '## 📋 По статусам\n\n';
        Object.entries(stats.byStatus).forEach(([status, count]) => {
            const statusText = Helpers.getStatusText(status);
            report += `- ${statusText}: **${count}**\n`;
        });

        report += '\n## 🛠 Топ технологий\n\n';
        stats.topTechnologies.slice(0, 5).forEach(({ tech, count }) => {
            report += `- ${tech}: **${count}** проектов\n`;
        });

        report += '\n## 🚀 Проекты\n\n';
        projects.forEach(project => {
            report += `### ${project.name}\n`;
            report += `- Статус: ${Helpers.getStatusText(project.status)}\n`;
            report += `- Прогресс: ${project.progress}%\n`;
            if (project.description) {
                report += `- Описание: ${project.description}\n`;
            }
            report += '\n';
        });

        const filename = `devspace-report-${new Date().toISOString().split('T')[0]}.md`;
        Helpers.downloadFile(report, filename, 'text/markdown');
        NotificationModule.success('Отчет сгенерирован');
    }
};

window.StatsModule = StatsModule;