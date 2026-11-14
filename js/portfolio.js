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
                { file: 'greenreach_grove.jpg', caption: 'Лесная локация' }
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

    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    let previousFocus = null;
    let wasOpen = false;

    function render(project) {
        content.replaceChildren();
        const header = node('header', 'showcase-header');
        header.append(node('span', 'portfolio-kicker', project.eyebrow));
        const title = node('h1', '', project.title);
        title.id = 'showcaseTitle';
        header.append(title, node('p', 'showcase-tagline', project.tagline));
        const art = node('div', `showcase-art art-${project.art}`);
        art.setAttribute('aria-label', 'Декоративная концептуальная иллюстрация проекта');
        if (project.coverTagline) art.append(node('span', 'showcase-art-theme', project.coverTagline));
        art.append(node('span', 'showcase-symbol', project.symbol));
        const figcaption = node('span', 'showcase-concept', 'КОНЦЕПТУАЛЬНАЯ ОБЛОЖКА');
        art.append(figcaption);

        const main = node('div', 'showcase-columns');
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
        main.append(story, aside);
        const loop = node('section', 'showcase-loop');
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
        if (project.gallery && project.repository === 'Skyward-Tales') {
            const section = node('section', 'showcase-gallery');
            section.setAttribute('aria-label', 'Скриншоты игры');
            section.append(node('span', 'portfolio-kicker', 'РЕАЛЬНЫЕ КАДРЫ ИЗ ПРОЕКТА'));
            const grid = node('div', 'showcase-gallery-grid');
            project.gallery.forEach((item, index) => {
                const url = `https://raw.githubusercontent.com/DoctorStrangeSH/Skyward-Tales/main/docs/screenshots/${encodeURIComponent(item.file)}`;
                const link = node('a', index === 0 ? 'showcase-gallery-item showcase-gallery-featured' : 'showcase-gallery-item');
                link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                link.setAttribute('aria-label', `Открыть скриншот: ${item.caption}`);
                const img = node('img');
                img.src = url; img.alt = item.caption;
                img.loading = 'lazy'; img.decoding = 'async';
                const description = node('span', '', (index === 0 ? 'ГЛАВНЫЙ КАДР · ' : '') + item.caption + ' ↗');
                link.append(img, description);
                grid.append(link);
            });
            section.append(grid);
            content.append(header, section, main, loop, journey, related);
        } else {
            content.append(header, art, main, loop, journey, related);
        }
    }

    function route() {
        const match = /^#project\/([a-z-]+)$/.exec(window.location.hash);
        const project = match && projects[match[1]];
        if (!project) {
            if (wasOpen) {
                shell.hidden = true;
                document.body.classList.remove('showcase-open');
                wasOpen = false;
                if (previousFocus && previousFocus.isConnected) previousFocus.focus();
            }
            return;
        }
        if (!wasOpen) previousFocus = document.activeElement;
        render(project);
        shell.hidden = false;
        document.body.classList.add('showcase-open');
        wasOpen = true;
        shell.scrollTop = 0;
        document.getElementById('showcaseBack').focus();
    }

    document.addEventListener('keydown', event => {
        if (!wasOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            window.location.hash = '#featured';
        }
        if (event.key === 'Tab') {
            const links = Array.from(shell.querySelectorAll('a[href]'));
            const first = links[0], last = links[links.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        }
    });
    window.addEventListener('hashchange', route);
    route();
})();
