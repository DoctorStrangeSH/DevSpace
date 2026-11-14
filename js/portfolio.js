/* Public, buildless project stories. Kept separate from the local tracker. */
(function () {
    'use strict';

    const projects = {
        'skyward-tales': {
            title: 'Skyward Tales', eyebrow: '01 / ФЭНТЕЗИ RPG', symbol: '✦', art: 'sky',
            tagline: 'Мир над облаками, где каждый остров — новая история.',
            intro: 'Моя большая RPG в стиле детализированного пиксель-арта. Хочу, чтобы путешествие чувствовалось настоящим приключением: с живыми поселениями, магией, тайнами и местами, в которые хочется возвращаться.',
            focus: ['Летающие острова, мосты и исследование мира', 'Два героя с боевыми анимациями в восьми направлениях', 'Магия, ресурсы, выращивание растений и развитие поселения'],
            loop: [
                ['ИССЛЕДОВАТЬ', 'Выбрать остров, найти безопасный путь и открыть новые уголки мира.'],
                ['ДЕЙСТВОВАТЬ', 'Сражаться, применять магию, собирать ресурсы и взаимодействовать с окружением.'],
                ['РАЗВИВАТЬ', 'Возвращаться в поселение, выращивать и создавать полезное, готовиться к новым маршрутам.']
            ],
            status: 'Активная разработка', stack: ['Godot', 'GDScript', 'Pixel art', 'RPG'],
            repository: 'Skyward-Tales', next: 'Развитие островов, анимаций и игрового цикла.',
            journey: [
                ['ЗАМЫСЕЛ', 'Большая фэнтези-RPG о путешествиях между летающими островами.'],
                ['В РАБОТЕ', 'Первый остров, единый стиль окружения и наборы анимаций двух героев.'],
                ['ДАЛЬШЕ', 'Связать исследование мира, магию и развитие поселения в цельное приключение.']
            ],
            gallery: [
                { file: 'greenreach_village.png', caption: 'Поселение Зелёные пределы' },
                { file: 'greenreach_waterfall.png', caption: 'Кромка острова и водопад' },
                { file: 'greenreach_grove.jpg', caption: 'Лесная локация' },
                { file: 'greenreach_preview.jpg', caption: 'Общий вид Зелёных пределов' },
                { file: 'resource_growth.gif', caption: 'Анимация восстановления ресурсов', kind: 'animation' }
            ]
        },
        workpilot: {
            title: 'WorkPilot / Malenia', eyebrow: '02 / AI-АВТОМАТИЗАЦИЯ', symbol: '◎', art: 'work',
            coverTagline: 'AUTOMATION / OBSERVABILITY',
            tagline: 'Помощник, который должен не просто отвечать, а выполнять работу.',
            intro: 'Разрабатываю настольного ассистента для многовкладочной работы с сервисами и документами. Моя цель — понятный интерфейс и наблюдаемая автоматизация без бесконечной ручной настройки.',
            focus: ['Работа с браузером и несколькими источниками данных', 'Анализ заказов, таблиц и рабочих систем', 'Прозрачный прогресс выполнения и контроль пользователя'],
            loop: [
                ['ПОЛУЧИТЬ КОНТЕКСТ', 'Распознать открытые вкладки, таблицу и доступные пользователю источники.'],
                ['ВЫПОЛНИТЬ ЗАДАЧУ', 'Сопоставить данные и провести согласованные действия в рабочих интерфейсах.'],
                ['ПОДТВЕРДИТЬ РЕЗУЛЬТАТ', 'Показать, что именно обработано, откуда взяты данные и где требуется решение человека.']
            ],
            status: 'Прототип и отладка', stack: ['Python', 'Desktop', 'Browser integration', 'AI'],
            repository: 'WorkPilot', next: 'Надёжный сквозной сценарий обработки заказа.',
            journey: [
                ['ЗАМЫСЕЛ', 'Настольный помощник, работающий с открытыми сервисами пользователя.'],
                ['В РАБОТЕ', 'Подключение таблиц, браузерных вкладок и рабочего процесса проверки заказов.'],
                ['ДАЛЬШЕ', 'Подтвердить полный разбор заказа через все необходимые источники.']
            ]
        },
        'ghost-signal': {
            title: 'Ghost Signal', eyebrow: '03 / НАРРАТИВНЫЙ ДЕТЕКТИВ', symbol: '⌁', art: 'ghost',
            coverTagline: 'EVERY SIGNAL LEAVES A TRACE',
            tagline: 'Правда складывается из памяти, сомнений и последствий.',
            intro: 'Детективный проект, где важен не только ответ на загадку, но и путь к нему. Свидетели могут ошибаться, пересказывать чужие слова и менять отношение к расследованию.',
            focus: ['Память и доверие персонажей', 'Источники показаний и проверка слухов', 'Обещания, последствия и альтернативные исходы'],
            loop: [
                ['СОБРАТЬ СЛЕДЫ', 'Найти улики, показания и слухи, не принимая каждое слово за факт.'],
                ['ПРОВЕРИТЬ ВЕРСИИ', 'Сопоставить источники, выявить противоречия и выяснить, кто что мог знать.'],
                ['ПРИНЯТЬ РЕШЕНИЕ', 'Допросить, дать обещание или обвинить — и столкнуться с последствиями для людей.']
            ],
            status: 'Активный рефакторинг', stack: ['JavaScript', 'Narrative design', 'Game systems'],
            repository: 'GhostSignal', next: 'Более глубокая логика расследований и реакций NPC.',
            journey: [
                ['ЗАМЫСЕЛ', 'Расследование, в котором свидетельские слова не равны установленным фактам.'],
                ['В РАБОТЕ', 'Память свидетелей, происхождение слухов, обещания и последствия решений.'],
                ['ДАЛЬШЕ', 'Развить правдоподобные реакции персонажей и цену ошибок детектива.']
            ]
        },
        'last-ritual': {
            title: 'Last Ritual', eyebrow: '04 / STRATEGY × ROGUELIKE', symbol: '✺', art: 'ritual',
            coverTagline: 'FIVE DAYS / FIVE NIGHTS',
            tagline: 'Пять дней, чтобы подготовить ритуал. Пять ночей, чтобы выжить.',
            intro: 'Смешиваю тактику обороны крепости и ночные вылазки в подземелья. Цель — создать напряжённый забег, где каждое улучшение и рискованное решение меняют шансы на успех.',
            focus: ['Дневная оборона с меняющимися путями и местами башен', 'Ночные комнаты и исследование в духе roguelike', 'Развитие башен, специализации и разнообразные враги'],
            loop: [
                ['ПОДГОТОВИТЬСЯ', 'Изучить маршрут дня, выбрать позиции башен и распределить ограниченные ресурсы.'],
                ['ВЫЖИТЬ НОЧЬ', 'Отправиться в комнаты, сразиться с врагами и добыть ресурсы для ритуала.'],
                ['УСИЛИТЬ ОБОРОНУ', 'Улучшить башни, выбрать специализацию и подготовиться к следующему дню.']
            ],
            status: 'Активная разработка', stack: ['Godot', 'GDScript', 'Tower defense', 'Roguelike'],
            repository: 'Last-Ritual', next: 'Баланс волн, процедурные карты и продолжительность забегов.',
            journey: [
                ['ЗАМЫСЕЛ', 'Пять дней обороны крепости чередуются с ночными вылазками.'],
                ['В РАБОТЕ', 'Башни, специализации, изменяющиеся маршруты и структура забегов.'],
                ['ДАЛЬШЕ', 'Сделать каждый забег длиннее, разнообразнее и интереснее тактически.']
            ]
        }
    };

    const shell = document.getElementById('portfolioDetail');
    const content = document.getElementById('showcaseContent');
    if (!shell || !content) return;
    const portfolioTitle = document.title;

    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    let previousFocus = null;
    let wasOpen = false;
    let backgroundInert = [];
    let sectionScrollFrame = null;

    function syncActiveSection() {
        if (!wasOpen) return;
        const buttons = Array.from(content.querySelectorAll('.showcase-section-link'));
        const sectionIds = ['showcase-overview', 'showcase-media', 'showcase-process', 'showcase-progress', 'showcase-more'];
        const top = shell.getBoundingClientRect().top + 125;
        let activeId = sectionIds[0];
        sectionIds.forEach(id => {
            const section = content.querySelector(`#${id}`);
            if (section && section.getBoundingClientRect().top <= top) activeId = id;
        });
        buttons.forEach(button => {
            const active = button.dataset.section === activeId;
            const wasActive = button.classList.contains('is-active');
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'location');
            else button.removeAttribute('aria-current');
            if (active && !wasActive) {
                const nav = button.closest('.showcase-section-nav');
                if (nav && nav.scrollWidth > nav.clientWidth) {
                    const navRect = nav.getBoundingClientRect();
                    const buttonRect = button.getBoundingClientRect();
                    nav.scrollTo({
                        left: nav.scrollLeft + buttonRect.left - navRect.left - (nav.clientWidth - buttonRect.width) / 2,
                        behavior: 'auto'
                    });
                }
            }
        });
    }

    shell.addEventListener('scroll', () => {
        if (!wasOpen || sectionScrollFrame !== null) return;
        sectionScrollFrame = requestAnimationFrame(() => {
            sectionScrollFrame = null;
            syncActiveSection();
        });
    }, { passive: true });

    function isolateShowcase() {
        backgroundInert = Array.from(shell.parentElement.children)
            .filter(element => element !== shell)
            .map(element => ({ element, inert: element.inert }));
        backgroundInert.forEach(({ element }) => { element.inert = true; });
    }

    function restoreBackground() {
        backgroundInert.forEach(({ element, inert }) => { element.inert = inert; });
        backgroundInert = [];
    }

    function render(project) {
        content.replaceChildren();
        const header = node('header', 'showcase-header');
        header.append(node('span', 'portfolio-kicker', project.eyebrow));
        const title = node('h1', '', project.title);
        title.id = 'showcaseTitle';
        header.append(title, node('p', 'showcase-tagline', project.tagline));
        const sectionNav = node('nav', 'showcase-section-nav');
        sectionNav.setAttribute('aria-label', 'Разделы проекта');
        const sections = [
            ['О проекте', 'showcase-overview'],
            ['Материалы', 'showcase-media'],
            ['Как работает', 'showcase-process'],
            ['Путь проекта', 'showcase-progress'],
            ['Другие работы', 'showcase-more']
        ];
        sections.forEach(([label, id]) => {
            const button = node('button', 'showcase-section-link', label);
            button.type = 'button';
            button.dataset.section = id;
            button.addEventListener('click', () => content.querySelector(`#${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
            sectionNav.append(button);
        });
        const art = node('div', `showcase-art art-${project.art}`);
        art.setAttribute('aria-label', 'Декоративная концептуальная иллюстрация проекта');
        if (project.coverTagline) art.append(node('span', 'showcase-art-theme', project.coverTagline));
        art.append(node('span', 'showcase-symbol', project.symbol));
        const figcaption = node('span', 'showcase-concept', 'КОНЦЕПТУАЛЬНАЯ ОБЛОЖКА');
        art.append(figcaption);

        const main = node('div', 'showcase-columns');
        main.id = 'showcase-overview';
        const story = node('div', 'showcase-story');
        story.append(node('span', 'portfolio-kicker', 'О ПРОЕКТЕ'));
        story.append(node('p', 'showcase-intro', project.intro));
        story.append(node('h2', '', 'Над чем работаю'));
        const list = node('ul', 'showcase-list');
        project.focus.forEach(item => list.append(node('li', '', item)));
        story.append(list);

        const aside = node('aside', 'showcase-aside');
        aside.append(node('div', 'showcase-aside-label', 'СТАТУС'), node('p', '', project.status));
        aside.append(node('div', 'showcase-aside-label', 'ТЕХНОЛОГИИ'));
        const tags = node('div', 'about-pills');
        project.stack.forEach(tag => tags.append(node('span', '', tag)));
        aside.append(tags, node('div', 'showcase-aside-label', 'СЛЕДУЮЩИЙ ШАГ'), node('p', '', project.next));
        const link = node('a', 'showcase-repo', 'Открыть репозиторий ↗');
        link.href = `https://github.com/DoctorStrangeSH/${project.repository}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        aside.append(link);
        const shareButton = node('button', 'showcase-share', 'Скопировать ссылку на проект');
        shareButton.type = 'button';
        const shareStatus = node('span', 'showcase-share-status', '');
        shareStatus.setAttribute('role', 'status');
        shareButton.addEventListener('click', async () => {
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(window.location.href);
                shareStatus.textContent = 'Ссылка скопирована';
            } catch (_) {
                shareStatus.textContent = 'Не удалось скопировать. Адрес проекта можно взять из строки браузера.';
            }
        });
        aside.append(shareButton, shareStatus);
        main.append(story, aside);
        const loop = node('section', 'showcase-loop');
        loop.id = 'showcase-process';
        loop.setAttribute('aria-label', 'Основной игровой или рабочий цикл');
        loop.append(node('span', 'portfolio-kicker', 'ОСНОВНОЙ ЦИКЛ'));
        loop.append(node('h2', '', 'Как это работает'));
        const loopGrid = node('div', 'showcase-loop-grid');
        project.loop.forEach((entry, index) => {
            const step = node('article', 'showcase-loop-step');
            step.append(node('span', 'showcase-loop-index', `0${index + 1}`));
            step.append(node('h3', '', entry[0]));
            step.append(node('p', '', entry[1]));
            loopGrid.append(step);
        });
        loop.append(loopGrid);
        const journey = node('section', 'showcase-journey');
        journey.id = 'showcase-progress';
        journey.setAttribute('aria-label', 'Путь развития проекта');
        journey.append(node('span', 'portfolio-kicker', 'ПУТЬ ПРОЕКТА'));
        journey.append(node('h2', '', 'От идеи к следующему этапу'));
        const journeyGrid = node('div', 'showcase-journey-grid');
        project.journey.forEach((entry, index) => {
            const step = node('article', 'showcase-journey-step');
            step.append(node('span', 'showcase-journey-index', `0${index + 1} / ${entry[0]}`));
            step.append(node('p', '', entry[1]));
            journeyGrid.append(step);
        });
        journey.append(journeyGrid);
        const related = node('nav', 'showcase-related');
        related.id = 'showcase-more';
        related.setAttribute('aria-label', 'Другие проекты');
        related.append(node('span', 'portfolio-kicker', 'СМОТРЕТЬ ДАЛЬШЕ'));
        related.append(node('h2', '', 'Каждый мир — другая история'));
        const relatedGrid = node('div', 'showcase-related-grid');
        Object.entries(projects).filter(([, entry]) => entry !== project).forEach(([slug, entry]) => {
            const card = node('a', `showcase-related-card art-${entry.art}`);
            card.href = `#project/${slug}`;
            card.append(node('span', 'showcase-related-eyebrow', entry.eyebrow));
            card.append(node('strong', '', entry.title));
            card.append(node('span', 'showcase-related-arrow', 'Открыть историю ↗'));
            relatedGrid.append(card);
        });
        related.append(relatedGrid);
        if (project.gallery && project.gallery.length) {
            const section = node('section', 'showcase-gallery');
            section.id = 'showcase-media';
            section.setAttribute('aria-label', 'Медиа из репозитория проекта');
            section.append(node('span', 'portfolio-kicker', 'МАТЕРИАЛЫ ИЗ РЕПОЗИТОРИЯ'));
            section.append(node('p', 'showcase-gallery-note', 'Скриншоты и анимации из открытого репозитория, без сгенерированных подмен. Нажмите на кадр, чтобы открыть оригинал.'));
            const grid = node('div', 'showcase-gallery-grid');
            project.gallery.forEach((item, index) => {
                const folder = project.galleryFolder || 'docs/screenshots';
                const url = `https://raw.githubusercontent.com/DoctorStrangeSH/${encodeURIComponent(project.repository)}/main/${folder}/${encodeURIComponent(item.file)}`;
                const link = node('a', index === 0 ? 'showcase-gallery-item showcase-gallery-featured' : 'showcase-gallery-item');
                link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                link.setAttribute('aria-label', `Открыть ${item.kind === 'animation' ? 'анимацию' : 'скриншот'}: ${item.caption}`);
                const img = node('img');
                img.src = url; img.alt = item.caption;
                img.loading = 'lazy'; img.decoding = 'async';
                img.addEventListener('error', () => {
                    const unavailable = node('div', 'showcase-gallery-unavailable', `Не удалось загрузить: ${item.caption}`);
                    unavailable.setAttribute('role', 'status');
                    link.replaceWith(unavailable);
                }, { once: true });
                const description = node('span', '', (item.kind === 'animation' ? 'АНИМАЦИЯ · ' : index === 0 ? 'ГЛАВНЫЙ КАДР · ' : '') + item.caption + ' ↗');
                link.append(img, description);
                grid.append(link);
            });
            section.append(grid);
            content.append(header, sectionNav, main, section, loop, journey, related);
        } else {
            const section = node('section', 'showcase-gallery showcase-media-pending');
            section.id = 'showcase-media';
            section.setAttribute('aria-label', 'Доступные материалы проекта');
            section.append(node('span', 'portfolio-kicker', 'МАТЕРИАЛЫ ПРОЕКТА'));
            section.append(node('h2', '', 'Пока без публичной галереи'));
            section.append(node('p', 'showcase-gallery-note', 'Подтверждённые скриншоты или демонстрация пока не опубликованы. Обложка выше — концептуальная иллюстрация, а не кадр из приложения.'));
            const sourceLink = node('a', 'showcase-repo', 'Посмотреть исходники и документацию ↗');
            sourceLink.href = `https://github.com/DoctorStrangeSH/${project.repository}`;
            sourceLink.target = '_blank';
            sourceLink.rel = 'noopener noreferrer';
            section.append(sourceLink);
            content.append(header, sectionNav, art, section, main, loop, journey, related);
        }
    }

    function route() {
        const match = /^#project\/([a-z-]+)$/.exec(window.location.hash);
        const project = match && projects[match[1]];
        if (!project) {
            document.title = portfolioTitle;
            if (wasOpen) {
                if (sectionScrollFrame !== null) {
                    cancelAnimationFrame(sectionScrollFrame);
                    sectionScrollFrame = null;
                }
                shell.hidden = true;
                document.body.classList.remove('showcase-open');
                restoreBackground();
                wasOpen = false;
                if (previousFocus && previousFocus.isConnected) previousFocus.focus();
            }
            return;
        }
        document.title = `${project.title} | DevSpace`;
        if (!wasOpen) {
            previousFocus = document.activeElement;
            isolateShowcase();
        }
        render(project);
        shell.hidden = false;
        document.body.classList.add('showcase-open');
        wasOpen = true;
        shell.scrollTop = 0;
        syncActiveSection();
        document.getElementById('showcaseBack').focus();
    }

    document.addEventListener('keydown', event => {
        if (!wasOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            window.location.hash = '#featured';
        }
        if (event.key === 'Tab') {
            const focusable = Array.from(shell.querySelectorAll('a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'))
                .filter(element => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true');
            if (!focusable.length) {
                event.preventDefault();
                shell.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const focusIsOutside = !shell.contains(document.activeElement);
            if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    window.addEventListener('hashchange', route);
    route();
})();
