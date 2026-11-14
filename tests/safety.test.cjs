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
  assert.ok(html.includes('<script src="js/portfolio.js"></script>'));
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(worker.includes("'css/portfolio.css'"));
  assert.ok(worker.includes("'js/portfolio.js'"));
  assert.doesNotMatch(worker, /^\s*'\/index\.html'/m);
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
  assert.ok(html.includes('src="js/github-metadata.js"'));
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
  assert.ok(stories.includes('РЕАЛЬНЫЕ КАДРЫ ИЗ ПРОЕКТА'));
});

test('portfolio has a dedicated accessible screenshot viewer', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(html.includes('id="portfolioGalleryViewer"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('src="js/portfolio-gallery.js"'));
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
  assert.ok(html.includes('src="js/portfolio-nav.js"'));
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
