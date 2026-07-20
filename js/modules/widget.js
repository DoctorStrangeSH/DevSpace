const WidgetModule = {
    // Генерация кода для вставки
    generateEmbedCode(projectId, type = 'card') {
        const project = StateManager.getProject(projectId);
        if (!project) return '';

        const baseUrl = window.location.origin;

        switch (type) {
            case 'badge':
                return `<a href="${baseUrl}?project=${projectId}">
                    <img src="${baseUrl}/api/badge/${projectId}" 
                         alt="${project.name}" 
                         style="height: 20px;">
                </a>`;

            case 'card':
                return `<iframe src="${baseUrl}/embed/${projectId}" 
                        width="400" height="300" 
                        frameborder="0" 
                        style="border-radius: 12px; border: 1px solid #333;">
                </iframe>`;

            case 'progress':
                return `<div style="background:#1a1a1a;padding:16px;border-radius:12px;color:white;">
                    <strong>${project.name}</strong>
                    <div style="background:#333;border-radius:10px;height:8px;margin-top:8px;">
                        <div style="background:linear-gradient(135deg,#6366f1,#a855f7);height:100%;border-radius:10px;width:${project.progress}%;"></div>
                    </div>
                    <small style="color:#888;">Прогресс: ${project.progress}%</small>
                </div>`;
        }
    },

    // Копировать код виджета
    copyWidgetCode(projectId, type) {
        const code = this.generateEmbedCode(projectId, type);
        Helpers.copyToClipboard(code);
        NotificationModule.success('Код виджета скопирован');
    }
};