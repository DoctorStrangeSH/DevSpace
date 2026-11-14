const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
function execute(file, context = {}) {
  const sandbox = { console, Promise, ...context };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox;
}

test('public Firebase client rejects writes before touching a database', async () => {
  const ctx = execute('js/services/firebase.js');
  const firebase = ctx.FirebaseService;
  let writes = 0;
  firebase._db = { collection() { writes++; throw new Error('Unexpected remote write'); } };

  assert.equal(await firebase.deleteProject('p1'), false);
  assert.equal(await firebase.saveAllProjects([{ id: 'p1' }]), false);
  assert.equal(await firebase.saveSettings({ favorites: [] }), false);
  assert.equal(await firebase.clearAllProjects(), false);
  assert.equal(await firebase.clearAllData(), false);
  assert.equal(writes, 0);
});

test('sync never uploads a visitor’s local projects', async () => {
  const ctx = execute('js/core/sync.js');
  assert.equal(await ctx.SyncModule.uploadToCloud(), false);
  const source = fs.readFileSync(path.join(root, 'js/core/sync.js'), 'utf8');
  assert.doesNotMatch(source, /FirebaseService\.(saveAllProjects|saveSettings|clearAllProjects|deleteProject)\s*\(/);
});

test('featured projects are accessible links and GitHub Pages cache is scoped', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const stories = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  for (const repo of ['Skyward-Tales', 'Last-Ritual', 'GhostSignal', 'WorkPilot']) {
    assert.ok(stories.includes(`repository: '${repo}'`));
  }
  for (const slug of ['skyward-tales', 'last-ritual', 'ghost-signal', 'workpilot']) {
    assert.ok(html.includes(`href="#project/${slug}"`));
  }
  assert.ok(html.includes('<script src="js/portfolio.js?v=3.17.0"></script>'));
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(worker.includes("'css/portfolio.css'"));
  assert.ok(worker.includes("'js/portfolio.js'"));
  assert.doesNotMatch(worker, /^\s*'\/index\.html'/m);
});

test('public web-project cards have keyboard focus, touch targets and reduced motion', () => {
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.match(css, /\.web-project-card:focus-within\s*\{/);
  assert.match(css, /\.web-project-links a:focus-visible\s*\{/);
  assert.match(css, /\.web-project-links a\s*\{[^}]*min-height:46px/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\s*\{[^}]*\.web-project-card/);
  assert.match(css, /\.web-project-links a\{flex:1 1 160px\}/);
});

test('Vercel projects are represented without leaking private source links', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const name of ['dm-workspace', 'wanderers-order', 'aethel-vtt-web', 'ashes-of-truth']) {
    assert.ok(html.includes(`https://${name}.vercel.app`));
  }
  assert.ok(html.includes('href="#web-projects"'));
  assert.ok(html.includes('Доступ может требовать входа'));
  assert.ok(!html.includes('github.com/DoctorStrangeSH/WanderersOrder'));
});

test('GitHub live metadata is allowlisted, optional and token-free', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/github-metadata.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(html.includes('src="js/github-metadata.js?v=3.17.0"'));
  assert.ok(worker.includes("'js/github-metadata.js'"));
  assert.ok(source.includes('value.private !== false'));
  assert.ok(source.includes('value.full_name !=='));
  assert.ok(source.includes('sessionStorage'));
  assert.doesNotMatch(source, /WanderersOrder|SUPABASE_SERVICE_ROLE_KEY|Authorization:\s*['"`]/);
});

test('visual galleries use confirmed public repository screenshot paths', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const stories = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  for (const file of ['08-vtt-scene', '07-character-sheet', '03-dashboard']) {
    assert.ok(html.includes(`${file}-chromium-win32.png`));
  }
  for (const file of ['greenreach_village.png', 'greenreach_waterfall.png', 'greenreach_grove.jpg']) {
    assert.ok(stories.includes(file));
  }
  assert.ok(html.includes('Настоящие тестовые скриншоты'));
  assert.ok(stories.includes('МАТЕРИАЛЫ ИЗ РЕПОЗИТОРИЯ'));
});

test('portfolio has a dedicated accessible screenshot viewer', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(html.includes('id="portfolioGalleryViewer"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('src="js/portfolio-gallery.js?v=3.17.0"'));
  assert.ok(sw.includes("'js/portfolio-gallery.js'"));
  for (const key of ['Escape', 'ArrowLeft', 'ArrowRight', 'Tab']) assert.ok(source.includes(key));
  assert.ok(source.includes('stopImmediatePropagation'));
  assert.ok(source.includes('returnFocus.focus()'));
});

test('legacy password is discarded and editing is explicitly browser-local', () => {
  const storage = new Map([['devspace_auth_key', 'legacy-credential']]);
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, val),
    removeItem: key => storage.delete(key)
  };
  const button = { style: {}, setAttribute() {} };
  const document = {
    getElementById: id => id === 'authBtn' ? button : null,
    querySelectorAll: () => []
  };
  const ctx = execute('js/services/auth.js', { localStorage, document, confirm: () => true });
  ctx.AuthService.init();
  assert.equal(storage.has('devspace_auth_key'), false);
  assert.equal(ctx.AuthService.isOwner(), false);
  ctx.AuthService._showLoginDialog();
  assert.equal(ctx.AuthService.isOwner(), true);
  assert.equal(storage.get('devspace_local_edit_mode'), 'enabled');
  assert.match(button.title, /локальное редактирование/);
  ctx.AuthService.logout();
  assert.equal(ctx.AuthService.isOwner(), false);
  assert.equal(storage.has('devspace_local_edit_mode'), false);
  const source = fs.readFileSync(path.join(root, 'js/services/auth.js'), 'utf8');
  assert.doesNotMatch(source, /_secretKey\s*:/);
});

test('mobile navigation is labelled and collapses after in-page navigation', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/portfolio-nav.js'), 'utf8');
  assert.ok(html.includes('aria-controls="navbarContent"'));
  assert.ok(html.includes('aria-label="Открыть меню навигации"'));
  assert.ok(html.includes('src="js/portfolio-nav.js?v=3.17.0"'));
  assert.ok(worker.includes("'js/portfolio-nav.js'"));
  assert.ok(source.includes("navigation.classList.contains('show')"));
  assert.ok(source.includes('getOrCreateInstance'));
  assert.ok(source.includes('.hide()'));
});

test('mobile screenshot gestures ignore vertical swipes and keep touch targets accessible', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(source.includes('Math.abs(dx) > Math.abs(dy) * 1.3'));
  assert.ok(source.includes("'touchcancel'"));
  assert.match(css, /portfolio-gallery-viewer button\{width:44px;height:44px\}/);
  assert.ok(css.includes('safe-area-inset-bottom'));
});

test('each featured story explains its intent, current focus and next step', () => {
  const stories = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.equal((stories.match(/journey:\s*\[/g) || []).length, 4);
  assert.ok(stories.includes('project.journey.forEach'));
  assert.ok(stories.includes("aria-label', 'Путь развития проекта'"));
  assert.ok(css.includes('.showcase-journey-grid'));
  assert.ok(css.includes('grid-template-columns:1fr'));
});

test('Skyward Tales uses a verified screenshot as the leading visual', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(source.includes('showcase-gallery-item showcase-gallery-featured'));
  assert.ok(source.includes('ГЛАВНЫЙ КАДР'));
  assert.ok(css.includes('.showcase-gallery-featured img'));
  assert.ok(source.includes('greenreach_village.png'));
  assert.ok(css.includes('.showcase-gallery-grid { grid-template-columns:repeat(2'));
});

test('offline page fallback respects GitHub Pages subpath', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  const callbacks = {};
  const seen = [];
  const offlinePage = { ok: true, source: 'cached-home' };
  const scope = 'https://doctorstrangesh.github.io/DevSpace/';
  const sandbox = {
    console, Promise, URL, Response,
    self: { registration: { scope }, addEventListener: (name, callback) => { callbacks[name] = callback; } },
    caches: { match: async key => { seen.push(key); return key === scope + 'index.html' ? offlinePage : undefined; } },
    fetch: async () => { throw new Error('offline'); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sandbox);
  let response;
  callbacks.fetch({
    request: { url: scope + 'unknown', method: 'GET', mode: 'navigate', headers: { get: () => 'text/html' } },
    respondWith: value => { response = value; }
  });
  assert.equal(await response, offlinePage);
  assert.ok(seen.includes(scope + 'index.html'));
  assert.ok(seen.every(key => !String(key).startsWith('https://doctorstrangesh.github.io/index.html')));
});

test('PWA manifest icon declarations resolve to real PNGs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    const file = path.join(root, icon.src);
    assert.ok(fs.existsSync(file), `Missing app icon: ${icon.src}`);
    const data = fs.readFileSync(file);
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [width, height] = [data.readUInt32BE(16), data.readUInt32BE(20)];
    assert.equal(`${width}x${height}`, icon.sizes);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('rel="icon"'));
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(worker.includes("'images/icons/icon-192x192.png'"));
  assert.ok(worker.includes("'images/icons/icon-512x512.png'"));
  assert.ok(worker.includes("clients.openWindow(self.registration.scope)"));
});

test('installed DevSpace keeps its scope, supports rotation and exposes quick links', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.orientation, 'any');
  assert.deepEqual(manifest.shortcuts.map(item => item.url), ['./#featured', './#web-projects']);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const anchor of ['featured', 'web-projects']) assert.ok(html.includes(`id="${anchor}"`));
});

test('conceptual project artwork is distinct and never mislabelled as gameplay', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  for (const theme of ['work', 'ghost', 'ritual']) {
    assert.ok(css.includes(`.showcase-art.art-${theme}::before`));
    assert.ok(css.includes(`.showcase-art.art-${theme} .showcase-symbol`));
  }
  assert.ok(source.includes('Декоративная концептуальная иллюстрация проекта'));
  assert.ok(source.includes('КОНЦЕПТУАЛЬНАЯ ОБЛОЖКА'));
  assert.ok(source.includes('coverTagline'));
});

test('featured cards use a genuine Skyward image and keyboard-visible focus', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(html.includes('class="feature-art art-sky feature-art-screenshot"'));
  assert.ok(html.includes('Skyward-Tales/main/docs/screenshots/greenreach_village.png'));
  assert.ok(html.includes('РЕАЛЬНЫЙ КАДР · SKYWARD TALES'));
  assert.ok(css.includes('.feature-card:focus-visible'));
  assert.ok(css.includes('.feature-art.art-ghost::before'));
  assert.ok(css.includes('.feature-art.art-ritual::before'));
  assert.ok(css.includes('.feature-art.art-work::before'));
});

test('project stories offer accessible links to the other three projects', () => {
  const stories = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(stories.includes("related.setAttribute('aria-label', 'Другие проекты')"));
  assert.ok(stories.includes("entry !== project"));
  assert.ok(stories.includes('card.href = `#project/${slug}`'));
  assert.ok(stories.includes('journey, related'));
  assert.ok(css.includes('.showcase-related-card:focus-visible'));
  assert.ok(css.includes('.showcase-related-grid{grid-template-columns:1fr}'));
});

test('public portfolio search filters featured and web cards without touching tracker', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/portfolio-search.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(html.includes('id="portfolioSearch"'));
  assert.ok(html.includes('id="webProjectsGrid"'));
  assert.ok(html.includes('id="featuredGrid"'));
  assert.ok(html.includes('role="status" aria-live="polite"'));
  assert.ok(source.includes("#featuredGrid .feature-card"));
  assert.ok(source.includes("#webProjectsGrid .web-project-card"));
  assert.doesNotMatch(source, /StateManager|StorageService|localStorage|searchProjects/);
  assert.ok(css.includes('.web-project-card[hidden]'));
  assert.ok(worker.includes("'js/portfolio-search.js'"));
});

test('portfolio search matches words in any order and links to web-only results', () => {
  const listeners = {};
  const input = { value: '', addEventListener: (name, cb) => { listeners[name] = cb; }, focus() {} };
  const clear = { hidden: true, addEventListener: (name, cb) => { listeners[`clear-${name}`] = cb; } };
  const status = { textContent: '' };
  const empty = { hidden: true, textContent: '', children: [], appendChild(node) { this.children.push(node); } };
  const featured = [{ textContent: 'Skyward Tales RPG Godot', hidden: false }];
  const web = [{ textContent: 'DM Workspace платформа Next.js VTT', hidden: false }];
  const elements = { portfolioSearch: input, portfolioSearchClear: clear, portfolioSearchStatus: status, portfolioSearchEmpty: empty };
  const document = {
    getElementById: id => elements[id],
    querySelectorAll: selector => selector === '#featuredGrid .feature-card' ? featured : web,
    createElement: tag => ({ tagName: tag, href: '', textContent: '' })
  };
  execute('js/portfolio-search.js', { document });
  input.value = 'godot skyward';
  listeners.input();
  assert.equal(featured[0].hidden, false);
  assert.equal(web[0].hidden, true);
  input.value = 'workspace next.js';
  listeners.input();
  assert.equal(featured[0].hidden, true);
  assert.equal(web[0].hidden, false);
  assert.equal(empty.hidden, false);
  assert.equal(empty.children.at(-1).href, '#web-projects');
  assert.match(status.textContent, /Веб-проектов: 1/);
  listeners['clear-click']();
  assert.equal(input.value, '');
  assert.equal(featured[0].hidden, false);
  assert.equal(web[0].hidden, false);
});


test('each project detail explains its real core gameplay or work loop', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.equal((source.match(/loop:\s*\[/g) || []).length, 4);
  assert.ok(source.includes("aria-label', 'Основной игровой или рабочий цикл'"));
  assert.ok(source.includes("node('h2', '', 'Как это работает')"));
  for (const step of ['ИССЛЕДОВАТЬ', 'ПОДТВЕРДИТЬ РЕЗУЛЬТАТ', 'ПРОВЕРИТЬ ВЕРСИИ', 'ВЫЖИТЬ НОЧЬ']) assert.ok(source.includes(step));
  assert.ok(css.includes('.showcase-loop-grid'));
  assert.ok(css.includes('@media(max-width:700px){.showcase-loop{margin-top:58px}.showcase-loop-grid{grid-template-columns:1fr}'));
});

test('Skyward Tales gallery links five genuine repository visuals, including resource animation', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  for (const asset of ['greenreach_village.png', 'greenreach_waterfall.png', 'greenreach_grove.jpg', 'greenreach_preview.jpg', 'resource_growth.gif']) {
    assert.ok(source.includes(`file: '${asset}'`));
  }
  assert.ok(source.includes("kind: 'animation'"));
  assert.ok(source.includes('project.gallery && project.gallery.length'));
  assert.ok(source.includes('encodeURIComponent(project.repository)'));
  assert.ok(css.includes('.showcase-gallery-note'));
});

test('every project story has honest materials navigation without invented screenshots', () => {
  const stories = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(stories.includes("['Материалы', 'showcase-media']"));
  assert.ok(stories.includes("section.id = 'showcase-media'"));
  assert.ok(stories.includes('Пока без публичной галереи'));
  assert.ok(stories.includes('концептуальная иллюстрация, а не кадр из приложения'));
  assert.ok(stories.includes('Посмотреть исходники и документацию'));
  assert.ok(css.includes('.showcase-media-pending'));
  for (const repo of ['WorkPilot', 'GhostSignal', 'Last-Ritual']) {
    assert.ok(stories.includes(`repository: '${repo}'`));
  }
});

test('project stories expose keyboard-friendly local section navigation with graceful image failure', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(source.includes("sectionNav.setAttribute('aria-label', 'Разделы проекта')"));
  for (const label of ['О проекте', 'Материалы', 'Как работает', 'Путь проекта', 'Другие работы']) assert.ok(source.includes(label));
  for (const id of ['showcase-overview', 'showcase-media', 'showcase-process', 'showcase-progress', 'showcase-more']) assert.ok(source.includes(id));
  assert.ok(source.includes("button.type = 'button'"));
  assert.ok(source.includes("img.addEventListener('error'"));
  assert.ok(source.includes('link.replaceWith(unavailable)'));
  assert.ok(css.includes('.showcase-section-link:focus-visible'));
  assert.ok(css.includes('.showcase-gallery-unavailable'));
});

test('nested project and image dialogs isolate background content and restore prior inert state', () => {
  const stories = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const gallery = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  for (const source of [stories, gallery]) {
    assert.ok(source.includes('backgroundInert'));
    assert.ok(source.includes('element.inert = true'));
    assert.ok(source.includes('element.inert = inert'));
    assert.ok(source.includes('restoreBackground()'));
  }
  assert.ok(stories.includes('isolateShowcase()'));
  assert.ok(gallery.includes('isolateViewer()'));
});


test('mobile navbar controls fill the available width without affecting unrelated flex layouts', () => {
  const css = fs.readFileSync(path.join(root, 'css/components/navbar.css'), 'utf8');
  assert.ok(css.includes('.navbar-collapse > .d-flex.align-items-center'));
  assert.ok(css.includes('.navbar-collapse .search-box'));
  assert.ok(css.includes('.navbar-collapse .search-input:focus'));
  assert.ok(css.includes('flex: 0 0 40px'));
  assert.doesNotMatch(css, /\.d-flex\.align-items-center\s*\{\s*flex-wrap:\s*wrap/);
});

test('project card actions remain visible on touch devices and keyboard focus', () => {
  const css = fs.readFileSync(path.join(root, 'css/components/cards.css'), 'utf8');
  assert.ok(css.includes('.project-card:focus-within .project-actions'));
  assert.ok(css.includes('@media (hover: none), (pointer: coarse)'));
  assert.ok(css.includes('grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr))'));
});


test('project detail dialog traps Tab across every control, not only links', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  assert.ok(source.includes('button:not([disabled])'));
  assert.ok(source.includes('focusIsOutside = !shell.contains(document.activeElement)'));
  assert.ok(source.includes('focusable[focusable.length - 1]'));
});

test('screenshot viewer keeps keyboard focus inside when focus starts outside', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  assert.ok(source.includes('focusIsOutside = !viewer.contains(document.activeElement)'));
  assert.ok(source.includes('closeButton.focus()'));
});

test('3.17 cache, HTML fallback and visible application version are aligned', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(app.includes("version: '3.17.0'"));
  assert.ok(worker.includes("const CACHE_VERSION = 'devspace-v3.17'"));
  assert.ok(html.includes('id="appVersion">v3.17.0</span>'));
});

test('every local script and stylesheet is versioned and included in offline precache', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const resources = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+)(\?v=[^"]+)?"/g)];
  assert.ok(resources.length > 40);
  for (const [, file, version] of resources) {
    assert.equal(version, '?v=3.17.0', `${file} is not versioned`);
    assert.ok(worker.includes(`'${file}'`), `${file} is not precached`);
  }
  assert.ok(worker.includes("const ASSET_VERSION = '3.17.0'"));
  assert.ok(worker.includes("].map(url => /^(css|js)\\//.test(url)"));
  assert.ok(app.includes("navigator.serviceWorker.register('sw.js?v='"));
});

test('public header and hero remain legible with a light tracker theme', () => {
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(css.includes('#mainNavbar .nav-link { color:#d5d0dc!important; }'));
  assert.ok(css.includes('.hero-section .hero-title { color:#f3eef1; }'));
  assert.ok(css.includes('.hero-section .btn-glass { color:#ece6f1;'));
  assert.ok(css.includes('#mainNavbar .navbar-collapse.show'));
});

test('featured portfolio cards expose a consistent visible action and flexible content', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.equal((html.match(/class="feature-open" aria-hidden="true"/g) || []).length, 4);
  assert.ok(css.includes('.feature-card .feature-copy { display:flex;flex:1;flex-direction:column; }'));
  assert.ok(css.includes('.feature-card .feature-tags { margin-top:auto;'));
  assert.ok(css.includes('.feature-card:focus-visible .feature-open i'));
  assert.ok(css.includes('@media (max-width: 670px)'));
});

test('gallery failure provides a visible accessible fallback and mobile image keeps its width', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(html.includes('id="portfolioGalleryError"'));
  assert.ok(html.includes('class="portfolio-gallery-unavailable" role="status" hidden'));
  assert.ok(js.includes("image.addEventListener('error'"));
  assert.ok(js.includes('imageError.hidden = false'));
  assert.ok(js.includes('imageError.hidden = true'));
  assert.ok(css.includes('.portfolio-gallery-unavailable[hidden]'));
  assert.ok(css.includes('.portfolio-gallery-stage { position:relative;display:flex;'));
  assert.ok(css.includes('#portfolioGalleryPrev { left:calc(50% - 55px); }'));
});

test('reduced motion and compact displays skip costly background animation', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.ok(app.includes("window.matchMedia('(prefers-reduced-motion: reduce)').matches"));
  assert.ok(app.includes("window.matchMedia('(max-width: 670px)').matches"));
  assert.ok(app.includes('disable: !!prefersReducedMotion'));
  assert.ok(app.includes('!prefersReducedMotion && !compactViewport'));
});

test('mobile first screen fits content and reduced motion leaves hero text visible', () => {
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(css.includes('@media (max-width: 670px)'));
  assert.ok(css.includes('.hero-section .min-vh-100 { min-height: 0 !important;'));
  assert.ok(css.includes('.hero-section .col-lg-6.text-center { display: none; }'));
  assert.ok(css.includes('.hero-section .hero-actions > a'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('.hero-title, .hero-description, .hero-actions, .hero-stats, .hero-badge { animation: none; opacity: 1; }'));
});
