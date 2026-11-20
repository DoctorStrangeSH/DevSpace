/* Close the collapsed navigation after following an in-page link on mobile. */
(function () {
    'use strict';
    const navigation = document.getElementById('navbarContent');
    const toggler = document.querySelector('[data-bs-target="#navbarContent"]');
    if (!navigation || !toggler) return;

    const updateToggleLabel = () => {
        const isOpen = navigation.classList.contains('show');
        toggler.setAttribute('aria-label', isOpen ? 'Закрыть меню навигации' : 'Открыть меню навигации');
    };
    navigation.addEventListener('shown.bs.collapse', updateToggleLabel);
    navigation.addEventListener('hidden.bs.collapse', updateToggleLabel);
    updateToggleLabel();

    // Listen on document: focus commonly stays on the menu toggle button,
    // which is outside the collapsed navigation element itself.
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !navigation.classList.contains('show')) return;
        // Let Bootstrap close an expanded dropdown before collapsing the whole menu.
        if (navigation.querySelector('.dropdown-menu.show')) return;
        if (!window.bootstrap || !window.bootstrap.Collapse) return;
        window.bootstrap.Collapse.getOrCreateInstance(navigation, { toggle: false }).hide();
        toggler.focus();
        event.preventDefault();
    });

    navigation.addEventListener('click', event => {
        const link = event.target.closest('a.nav-link[href^="#"]');
        if (!link || link.getAttribute('href') === '#' || !navigation.classList.contains('show')) return;
        if (!window.bootstrap || !window.bootstrap.Collapse) return;
        window.bootstrap.Collapse.getOrCreateInstance(navigation, { toggle: false }).hide();
    });
})();

/* Keep long portfolio/workshop pages navigable without occupying the first screen. */
(function () {
    'use strict';
    const dock = document.getElementById('sectionDock');
    if (!dock) return;

    const updateDock = () => {
        const visible = window.scrollY > Math.max(420, window.innerHeight * .65);
        dock.classList.toggle('is-visible', visible);
        dock.setAttribute('aria-hidden', String(!visible));
        if (visible) dock.removeAttribute('inert');
        else dock.setAttribute('inert', '');
    };

    window.addEventListener('scroll', updateDock, { passive: true });
    window.addEventListener('resize', updateDock, { passive: true });
    updateDock();
})();
