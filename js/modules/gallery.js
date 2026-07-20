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
        const project = StateManager.getProject(projectId);
        if (!project) return;

        const screenshots = [];
        
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            
            const base64 = await this._fileToBase64(file);
            screenshots.push({
                id: Helpers.generateId(),
                data: base64,
                caption: file.name,
                uploadedAt: new Date().toISOString()
            });
        }

        project.screenshots = [...(project.screenshots || []), ...screenshots];
        StateManager.updateProject(projectId, { screenshots: project.screenshots });
        StateManager.saveProjects();

        NotificationModule.success(`${screenshots.length} скриншотов добавлено`);
        EventBus.emit('gallery:updated', projectId);
    },

    deleteScreenshot(projectId, screenshotId) {
        const project = StateManager.getProject(projectId);
        if (!project) return;

        project.screenshots = (project.screenshots || []).filter(s => s.id !== screenshotId);
        StateManager.updateProject(projectId, { screenshots: project.screenshots });
        StateManager.saveProjects();
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