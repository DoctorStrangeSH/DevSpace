/* Accessible screenshot viewer, isolated from the project's legacy lightbox. */
(function () {
    'use strict';
    const viewer = document.getElementById('portfolioGalleryViewer');
    if (!viewer) return;

    const image = document.getElementById('portfolioGalleryImage');
    const imageError = document.getElementById('portfolioGalleryError');
    const caption = document.getElementById('portfolioGalleryCaption');
    const count = document.getElementById('portfolioGalleryCount');
    const original = document.getElementById('portfolioGalleryOriginal');
    const closeButton = document.getElementById('portfolioGalleryClose');
    const prev = document.getElementById('portfolioGalleryPrev');
    const next = document.getElementById('portfolioGalleryNext');
    let items = [];
    let index = 0;
    let returnFocus = null;
    let touchStart = null;
    let backgroundInert = [];

    function isolateViewer() {
        backgroundInert = Array.from(document.body.children)
            .filter(element => element !== viewer)
            .map(element => ({ element, inert: element.inert }));
        backgroundInert.forEach(({ element }) => { element.inert = true; });
    }

    function restoreBackground() {
        backgroundInert.forEach(({ element, inert }) => { element.inert = inert; });
        backgroundInert = [];
    }

    function display() {
        const item = items[index];
        if (!item) return;
        image.hidden = false;
        imageError.hidden = true;
        image.src = item.src;
        image.alt = item.alt;
        caption.textContent = item.caption;
        count.textContent = `${index + 1} / ${items.length}`;
        original.href = item.src;
        prev.disabled = items.length < 2;
        next.disabled = items.length < 2;
    }

    image.addEventListener('error', () => {
        if (viewer.hidden) return;
        image.hidden = true;
        imageError.hidden = false;
    });

    function close() {
        if (viewer.hidden) return;
        viewer.hidden = true;
        document.body.classList.remove('portfolio-viewer-open');
        restoreBackground();
        image.removeAttribute('src');
        image.hidden = false;
        imageError.hidden = true;
        items = [];
        if (returnFocus && returnFocus.isConnected) returnFocus.focus();
        returnFocus = null;
    }

    function move(delta) {
        if (!items.length) return;
        index = (index + delta + items.length) % items.length;
        display();
    }

    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('.showcase-gallery-item, .web-visual-grid a');
        if (!link) return;
        const gallery = link.closest('.showcase-gallery-grid, .web-visual-grid');
        if (!gallery) return;
        const candidates = Array.from(gallery.querySelectorAll('a[href]'));
        const selected = candidates.indexOf(link);
        if (selected < 0) return;
        event.preventDefault();
        items = candidates.map(anchor => {
            const img = anchor.querySelector('img');
            return { src: anchor.href, alt: img?.alt || 'Скриншот проекта', caption: anchor.querySelector('span')?.textContent || img?.alt || '' };
        });
        index = selected;
        returnFocus = link;
        viewer.hidden = false;
        document.body.classList.add('portfolio-viewer-open');
        isolateViewer();
        display();
        closeButton.focus();
    });

    closeButton.addEventListener('click', close);
    prev.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    viewer.addEventListener('click', event => { if (event.target === viewer) close(); });

    // Capture phase keeps Escape from closing the underlying project showcase.
    document.addEventListener('keydown', event => {
        if (viewer.hidden) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopImmediatePropagation(); move(-1); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); event.stopImmediatePropagation(); move(1); }
        else if (event.key === 'Tab') {
            const controls = [closeButton, prev, next, original].filter(el => !el.disabled && !el.hidden);
            const first = controls[0], last = controls[controls.length - 1];
            const focusIsOutside = !viewer.contains(document.activeElement);
            if (!first) {
                event.preventDefault();
                closeButton.focus();
            } else if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
                event.preventDefault();
                first.focus();
            }
        }
    }, true);

    viewer.addEventListener('touchstart', event => {
        const touch = event.changedTouches[0];
        touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
    }, { passive: true });
    viewer.addEventListener('touchend', event => {
        if (touchStart === null) return;
        const touch = event.changedTouches[0];
        const dx = touch ? touch.clientX - touchStart.x : 0;
        const dy = touch ? touch.clientY - touchStart.y : 0;
        touchStart = null;
        // A vertical scroll or diagonal gesture must not change screenshots.
        if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.3) move(dx > 0 ? -1 : 1);
    }, { passive: true });
    viewer.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
})();
