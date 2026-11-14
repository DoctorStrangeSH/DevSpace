/* Public showcase search. Never reads or changes the browser-local tracker. */
(function () {
    'use strict';
    const input = document.getElementById('portfolioSearch');
    const clear = document.getElementById('portfolioSearchClear');
    const status = document.getElementById('portfolioSearchStatus');
    const empty = document.getElementById('portfolioSearchEmpty');
    if (!input || !clear || !status || !empty) return;

    const featured = Array.from(document.querySelectorAll('#featuredGrid .feature-card'));
    const web = Array.from(document.querySelectorAll('#webProjectsGrid .web-project-card'));
    const all = [...featured, ...web].map(card => ({
        card,
        // Cache static labels; ignore live GitHub metadata and mutable tracker state.
        terms: card.textContent.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
    }));

    function update() {
        const query = input.value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
        let matches = 0;
        let webMatches = 0;
        for (const item of all) {
            const visible = !query || item.terms.includes(query);
            item.card.hidden = !visible;
            if (visible) {
                matches++;
                if (web.includes(item.card)) webMatches++;
            }
        }
        clear.hidden = !query;
        empty.hidden = !query || matches > 0;
        status.textContent = !query
            ? 'Показаны все работы и веб-проекты'
            : matches === 0
                ? 'Совпадений не найдено'
                : `Найдено: ${matches}. Веб-проектов ниже: ${webMatches}.`;
    }

    input.addEventListener('input', update);
    clear.addEventListener('click', () => { input.value = ''; update(); input.focus(); });
    update();
})();
