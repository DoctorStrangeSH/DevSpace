/* ============================================
   GALLERY MODULE
   Галерея скриншотов
   ============================================ */

const GalleryModule = {
    currentImages: [],
    currentIndex: 0,

    init() {
        this._bindLightboxEvents();
        console.log('GalleryModule initialized');
    },

    async addScreenshots(projectId, files) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        const project = StateManager.getProject(projectId);
        if (!project || !files || typeof files[Symbol.iterator] !== 'function') return false;

        const screenshots = [];

        try {
            for (const file of files) {
                if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) continue;

                const base64 = await this._fileToBase64(file);
                screenshots.push({
                    id: Helpers.generateId(),
                    data: base64,
                    caption: typeof file.name === 'string' ? file.name : 'Скриншот',
                    uploadedAt: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('GalleryModule: screenshot read failed:', error);
            NotificationModule.error('Не удалось прочитать изображения. Скриншоты не добавлены.');
            return false;
        }

        if (screenshots.length === 0) return false;

        const nextScreenshots = [...(Array.isArray(project.screenshots) ? project.screenshots : []), ...screenshots];
        const updatedProject = StateManager.updateProject(projectId, { screenshots: nextScreenshots });
        if (!updatedProject) {
            NotificationModule.error('Не удалось сохранить скриншоты. Проверьте свободное место в хранилище.');
            return false;
        }

        NotificationModule.success(`${screenshots.length} скриншотов добавлено`);
        EventBus.emit('gallery:updated', projectId);
        return true;
    },

    deleteScreenshot(projectId, screenshotId) {
        if (typeof AuthService !== 'undefined' && !AuthService.isOwner()) return false;
        const project = StateManager.getProject(projectId);
        if (!project || !Array.isArray(project.screenshots)) return false;

        const nextScreenshots = project.screenshots.filter(s => s.id !== screenshotId);
        if (nextScreenshots.length === project.screenshots.length) return false;

        const updatedProject = StateManager.updateProject(projectId, { screenshots: nextScreenshots });
        if (!updatedProject) {
            NotificationModule.error('Не удалось удалить скриншот. Изменения не сохранены.');
            return false;
        }

        EventBus.emit('gallery:updated', projectId);
        return true;
    },

    openLightbox(images, startIndex = 0) {
        this.currentImages = images;
        this.currentIndex = startIndex;
        this._showImage();
        document.getElementById('lightbox').classList.add('active');
    },

    _showImage() {
        const image = this.currentImages[this.currentIndex];
        if (!image) return;

        document.getElementById('lightboxImage').src = image.data || image;
        document.getElementById('lightboxCaption').textContent = 
            image.caption || `Изображение ${this.currentIndex + 1} из ${this.currentImages.length}`;
    },

    _bindLightboxEvents() {
        document.querySelector('.lightbox-close')?.addEventListener('click', () => {
            document.getElementById('lightbox').classList.remove('active');
        });

        document.querySelector('.lightbox-prev')?.addEventListener('click', () => {
            this.currentIndex = this.currentIndex > 0 
                ? this.currentIndex - 1 
                : this.currentImages.length - 1;
            this._showImage();
        });

        document.querySelector('.lightbox-next')?.addEventListener('click', () => {
            this.currentIndex = this.currentIndex < this.currentImages.length - 1 
                ? this.currentIndex + 1 
                : 0;
            this._showImage();
        });

        document.getElementById('lightbox')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.remove('active');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (!document.getElementById('lightbox').classList.contains('active')) return;
            
            if (e.key === 'Escape') {
                document.getElementById('lightbox').classList.remove('active');
            } else if (e.key === 'ArrowLeft') {
                document.querySelector('.lightbox-prev')?.click();
            } else if (e.key === 'ArrowRight') {
                document.querySelector('.lightbox-next')?.click();
            }
        });
    },

    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    renderGallery(screenshots) {
        if (!screenshots || screenshots.length === 0) return '';
        
        return `
            <div class="screenshots-gallery">
                ${screenshots.map((img, index) => `
                    <div class="screenshot-thumb" onclick="GalleryModule.openLightbox(
                        ${JSON.stringify(screenshots.map(s => s.data || s).join('|||').split('|||'))}, 
                        ${index}
                    )">
                        <img src="${img.data || img}" 
                             alt="${img.caption || 'Скриншот'}" 
                             loading="lazy">
                    </div>
                `).join('')}
            </div>
        `;
    }
};

window.GalleryModule = GalleryModule;