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

    navigation.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !navigation.classList.contains('show')) return;
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
