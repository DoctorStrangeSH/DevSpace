/* ============================================
   TAGS MODULE
   Управление тегами проектов
   ============================================ */

const TagsModule = {
    defaultTags: [
        'Frontend', 'Backend', 'Fullstack', 'React', 'Vue', 'Angular',
        'Node.js', 'Python', 'PHP', 'Laravel', 'Django', 'API',
        'Mobile', 'Desktop', 'Game', 'Bot', 'AI', 'E-commerce',
        'Blog', 'Portfolio', 'Dashboard', 'Landing Page',
        'Верстка', 'SPA', 'PWA', 'Chrome Extension', 'CLI'
    ],

    init() {
        this._renderTagsCloud();
        this._bindEvents();
        console.log('TagsModule initialized');
    },

    _bindEvents() {
        EventBus.on('project:added', () => this._renderTagsCloud());
        EventBus.on('project:removed', () => this._renderTagsCloud());
        EventBus.on('project:updated', () => this._renderTagsCloud());
        EventBus.on('projects:saved', () => this._renderTagsCloud());

        // Сброс фильтра по тегу
        const clearBtn = document.getElementById('clearTagFilter');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                StateManager.set('filters.selectedTag', null);
                this._renderTagsCloud();
                RendererModule.renderProjects();
                clearBtn.style.display = 'none';
            });
        }
    },

    getAllUsedTags() {
        const projects = StateManager.get('projects');
        const tagCount = {};
        
        projects.forEach(project => {
            (project.tags || []).forEach(tag => {
                tagCount[tag] = (tagCount[tag] || 0) + 1;
            });
        });

        return Object.entries(tagCount)
            .sort(([,a], [,b]) => b - a)
            .map(([tag, count]) => ({ tag, count }));
    },

    _renderTagsCloud() {
        const container = document.getElementById('tagsCloud');
        if (!container) return;

        const usedTags = this.getAllUsedTags();
        const selectedTag = StateManager.get('filters.selectedTag');
        const clearBtn = document.getElementById('clearTagFilter');

        // Показываем/скрываем кнопку сброса
        if (clearBtn) {
            clearBtn.style.display = selectedTag ? 'inline-block' : 'none';
        }

        if (usedTags.length === 0) {
            container.innerHTML = '<span class="text-muted small">Нет тегов</span>';
            return;
        }

        const maxCount = usedTags[0]?.count || 1;

        container.innerHTML = usedTags.map(({ tag, count }) => {
            const size = 0.8 + (count / maxCount) * 0.6;
            const isActive = selectedTag === tag;
            
            return `
                <span class="tag-item ${isActive ? 'active' : ''}" 
                      data-tag="${Helpers.escapeHtml(tag)}"
                      style="font-size: ${size}rem;">
                    ${Helpers.escapeHtml(tag)}
                    <span class="tag-count">${count}</span>
                </span>
            `;
        }).join('');

        // Обработчики кликов
        container.querySelectorAll('.tag-item').forEach(tagEl => {
            tagEl.addEventListener('click', () => {
                const tag = tagEl.dataset.tag;
                const currentFilter = StateManager.get('filters.selectedTag');
                
                if (currentFilter === tag) {
                    StateManager.set('filters.selectedTag', null);
                } else {
                    StateManager.set('filters.selectedTag', tag);
                }
                
                this._renderTagsCloud();
                RendererModule.renderProjects();
            });
        });
    },

    addTagsToProject(projectId, tags) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        project.tags = [...new Set([...(project.tags || []), ...tags])];
        StateManager.updateProject(projectId, { tags: project.tags });
        StateManager.saveProjects();
    }
};

window.TagsModule = TagsModule;