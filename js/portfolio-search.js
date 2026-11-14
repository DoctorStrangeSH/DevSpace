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
    const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
    const all = [...featured, ...web].map(card => ({
        card,
        // Cache static labels; ignore live GitHub metadata and mutable tracker state.
        terms: normalize(card.textContent),
        isWeb: web.includes(card)
    }));

    function update() {
        const query = normalize(input.value);
        const words = query.split(' ').filter(Boolean);
        let matches = 0;
        let webMatches = 0;
        let featuredMatches = 0;
        for (const item of all) {
            const visible = words.every(word => item.terms.includes(word));
            item.card.hidden = !visible;
            if (visible) {
                matches++;
                if (item.isWeb) webMatches++;
                else featuredMatches++;
            }
        }
        clear.hidden = !query;
        empty.hidden = !query || featuredMatches > 0;
        empty.textContent = matches === 0
            ? 'Ничего не найдено. Попробуйте другое название или технологию.'
            : 'В избранных работах совпадений нет. ';
        if (query && featuredMatches === 0 && webMatches > 0) {
            const webLink = document.createElement('a');
            webLink.href = '#web-projects';
            webLink.textContent = `Смотреть веб-проекты (${webMatches}) →`;
            empty.appendChild(webLink);
        }
        status.textContent = !query
            ? 'Показаны все работы и веб-проекты'
            : matches === 0
                ? 'Совпадений не найдено'
                : `Найдено: ${matches}. Избранных работ: ${featuredMatches}. Веб-проектов: ${webMatches}.`;
    }

    input.addEventListener('input', update);
    clear.addEventListener('click', () => { input.value = ''; update(); input.focus(); });
    update();
})();
