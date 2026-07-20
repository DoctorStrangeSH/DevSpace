const CommentsModule = {
    init() {
        this._bindEvents();
    },

    // Добавить комментарий к обновлению
    addComment(projectId, updateId, text, author = 'Я') {
        const project = StateManager.getProject(projectId);
        if (!project) return null;

        const update = project.updates.find(u => u.id === updateId);
        if (!update) return null;

        if (!update.comments) {
            update.comments = [];
        }

        const comment = {
            id: Helpers.generateId(),
            text,
            author,
            timestamp: new Date().toISOString(),
            likes: 0
        };

        update.comments.push(comment);
        StateManager.updateProject(projectId, { updates: project.updates });
        StateManager.saveProjects();

        return comment;
    },

    // Лайк комментария
    likeComment(projectId, updateId, commentId) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        const update = project.updates.find(u => u.id === updateId);
        if (!update || !update.comments) return;

        const comment = update.comments.find(c => c.id === commentId);
        if (comment) {
            comment.likes = (comment.likes || 0) + 1;
            StateManager.updateProject(projectId, { updates: project.updates });
        }
    }
};