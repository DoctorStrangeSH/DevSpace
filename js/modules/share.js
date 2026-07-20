/* ============================================
   SHARE MODULE
   Шаринг проектов
   ============================================ */

const ShareModule = {
    init() {
        console.log('ShareModule initialized');
    },

    async shareProject(projectId) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        const shareData = {
            title: project.name,
            text: project.description || '',
            url: window.location.href
        };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return;
            } catch (err) {
                console.log('Share cancelled');
            }
        }

        await Helpers.copyToClipboard(window.location.href);
        NotificationModule.info('Ссылка скопирована');
    },

    shareToTwitter(projectId) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        const text = encodeURIComponent(`Мой проект: ${project.name}\n${project.description || ''}`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'width=600,height=400');
    },

    shareToTelegram(projectId) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        const text = encodeURIComponent(`${project.name}\n\n${project.description || ''}`);
        window.open(`https://t.me/share/url?text=${text}`, '_blank', 'width=600,height=400');
    },

    generateWidgetCode(projectId) {
        const project = StateManager.getProject(projectId);
        if (!project) return '';

        return `<div style="background:#1a1a1a;padding:16px;border-radius:12px;color:white;font-family:sans-serif;max-width:400px;">
    <strong>${project.name}</strong>
    <p style="color:#888;font-size:14px;margin:8px 0;">${project.description || ''}</p>
    <div style="background:#333;border-radius:10px;height:8px;margin:12px 0;">
        <div style="background:linear-gradient(135deg,#6366f1,#a855f7);height:100%;border-radius:10px;width:${project.progress}%;"></div>
    </div>
    <small style="color:#6366f1;">Прогресс: ${project.progress}%</small>
</div>`;
    },

    copyWidgetCode(projectId) {
        const code = this.generateWidgetCode(projectId);
        Helpers.copyToClipboard(code);
        NotificationModule.success('Код виджета скопирован');
    }
};

window.ShareModule = ShareModule;