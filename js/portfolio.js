/* Public, buildless project stories. Kept separate from the local tracker. */
(function () {
    'use strict';

    const projects = {
        'skyward-tales': {
            title: 'Skyward Tales', eyebrow: '01 / ФЭНТЕЗИ RPG', symbol: '✦', art: 'sky',
            tagline: 'Мир над облаками, где каждый остров — новая история.',
            intro: 'Моя большая RPG в стиле детализированного пиксель-арта. Хочу, чтобы путешествие чувствовалось настоящим приключением: с живыми поселениями, магией, тайнами и местами, в которые хочется возвращаться.',
            focus: ['Летающие острова, мосты и исследование мира', 'Два героя с боевыми анимациями в восьми направлениях', 'Магия, ресурсы, выращивание растений и развитие поселения'],
            status: 'Активная разработка', stack: ['Godot', 'GDScript', 'Pixel art', 'RPG'],
            repository: 'Skyward-Tales', next: 'Развитие островов, анимаций и игрового цикла.'
        },
        workpilot: {
            title: 'WorkPilot / Malenia', eyebrow: '02 / AI-АВТОМАТИЗАЦИЯ', symbol: '◎', art: 'work',
            tagline: 'Помощник, который должен не просто отвечать, а выполнять работу.',
            intro: 'Разрабатываю настольного ассистента для многовкладочной работы с сервисами и документами. Моя цель — понятный интерфейс и наблюдаемая автоматизация без бесконечной ручной настройки.',
            focus: ['Работа с браузером и несколькими источниками данных', 'Анализ заказов, таблиц и рабочих систем', 'Прозрачный прогресс выполнения и контроль пользователя'],
            status: 'Прототип и отладка', stack: ['Python', 'Desktop', 'Browser integration', 'AI'],
            repository: 'WorkPilot', next: 'Надёжный сквозной сценарий обработки заказа.'
        },
        'ghost-signal': {
            title: 'Ghost Signal', eyebrow: '03 / НАРРАТИВНЫЙ ДЕТЕКТИВ', symbol: '⌁', art: 'ghost',
            tagline: 'Правда складывается из памяти, сомнений и последствий.',
            intro: 'Детективный проект, где важен не только ответ на загадку, но и путь к нему. Свидетели могут ошибаться, пересказывать чужие слова и менять отношение к расследованию.',
            focus: ['Память и доверие персонажей', 'Источники показаний и проверка слухов', 'Обещания, последствия и альтернативные исходы'],
            status: 'Активный рефакторинг', stack: ['JavaScript', 'Narrative design', 'Game systems'],
            repository: 'GhostSignal', next: 'Более глубокая логика расследований и реакций NPC.'
        },
        'last-ritual': {
            title: 'Last Ritual', eyebrow: '04 / STRATEGY × ROGUELIKE', symbol: '✺', art: 'ritual',
            tagline: 'Пять дней, чтобы подготовить ритуал. Пять ночей, чтобы выжить.',
            intro: 'Смешиваю тактику обороны крепости и ночные вылазки в подземелья. Цель — создать напряжённый забег, где каждое улучшение и рискованное решение меняют шансы на успех.',
            focus: ['Дневная оборона с меняющимися путями и местами башен', 'Ночные комнаты и исследование в духе roguelike', 'Развитие башен, специализации и разнообразные враги'],
            status: 'Активная разработка', stack: ['Godot', 'GDScript', 'Tower defense', 'Roguelike'],
            repository: 'Last-Ritual', next: 'Баланс волн, процедурные карты и продолжительность забегов.'
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
        content.append(header, art, main);
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
