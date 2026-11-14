/* Close the collapsed navigation after following an in-page link on mobile. */
(function () {
    'use strict';
    const navigation = document.getElementById('navbarContent');
    const toggler = document.querySelector('[data-bs-target="#navbarContent"]');
    if (!navigation || !toggler) return;

    navigation.addEventListener('click', event => {
        const link = event.target.closest('a.nav-link[href^="#"]');
        if (!link || link.getAttribute('href') === '#' || !navigation.classList.contains('show')) return;
        if (!window.bootstrap || !window.bootstrap.Collapse) return;
        window.bootstrap.Collapse.getOrCreateInstance(navigation, { toggle: false }).hide();
    });
})();
