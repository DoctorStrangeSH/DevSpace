const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('draft Firestore rules deny legacy and anonymous access, scope private records by UID', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /request\.auth\.uid == uid/);
  assert.doesNotMatch(rules, /allow create:|allow update:|allow delete:/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false/);
  assert.doesNotMatch(rules, /allow\s+(?:read|write|create|update|delete)\s*:\s*if\s*true/);
  assert.match(rules, /match \/users\/\{uid\}\/projects\/\{projectId\} \{\s*allow read: if isOwner\(uid\);\s*allow write: if false/);
});

test('private migration dry-run never overwrites cloud records or mutates local projects', () => {
  const sync = execute('js/core/sync.js').SyncModule;
  const local = [{ id: 'new', name: 'Локальный' }, { id: 'shared', name: 'Локальная версия' }, { id: 'new', name: 'Дубликат' }, { id: '../bad' }];
  const remote = [{ id: 'shared', name: 'Облачная версия' }];
  const original = JSON.stringify({ local, remote });
  const plan = sync._planPrivateMigration(local, remote);
  assert.deepEqual(Array.from(plan.upload, p => p.id), ['new']);
  assert.deepEqual(Array.from(plan.conflicts), ['shared']);
  assert.equal(plan.skipped, 2);
  assert.equal(JSON.stringify({ local, remote }), original);
  plan.upload[0].name = 'Меняем копию';
  assert.equal(local[0].name, 'Локальный');
  assert.throws(() => sync._planPrivateMigration(null, []), /Ожидаются два массива/);
  const oversized = sync._planPrivateMigration([{ id: 'huge', name: 'а'.repeat(200001) }], []);
  assert.equal(oversized.upload.length, 0);
  assert.equal(oversized.skipped, 1);
  const exact = sync._planPrivateMigration([{ id: 'small', name: 'обычный' }], []);
  assert.equal(exact.upload.length, 1);
});

test('private cloud preview uses authenticated UID and discards stale session results', async () => {
  let user = { uid: 'user-A' };
  const calls = [];
  let resolveRead;
  const db = { collection(name) {
    calls.push(name);
    return { doc(uid) {
      calls.push(uid);
      return { collection(child) {
        calls.push(child);
        return { limit(n) {
          calls.push(n);
          return { get() { return new Promise(resolve => { resolveRead = resolve; }); } };
        } };
      } };
    } };
  } };
  const ctx = execute('js/services/firebase.js', { firebase: { auth: () => ({ currentUser: user }) } });
  ctx.FirebaseService._db = db;
  const pending = ctx.FirebaseService.getPrivateProjectPreview();
  assert.deepEqual(calls, ['users', 'user-A', 'projects', 100]);
  user = { uid: 'user-B' };
  resolveRead({ forEach(cb) { cb({ id: 'a', data: () => ({ name: 'A' }) }); } });
  assert.equal(await pending, null);
  user = null;
  assert.equal(await ctx.FirebaseService.getPrivateProjectPreview(), null);
  assert.equal(ctx.FirebaseService._writesEnabled, false);
});

test('private cloud diagnostics distinguish rule denial and malformed data', async () => {
  const user = { uid: 'owner' };
  let result = Promise.reject({ code: 'permission-denied' });
  const db = { collection: () => ({ doc: () => ({ collection: () => ({ limit: () => ({
    get: () => result
  }) }) }) }) };
  const ctx = execute('js/services/firebase.js', { firebase: { auth: () => ({ currentUser: user }) } });
  const service = ctx.FirebaseService;
  service._db = db;
  assert.equal(await service.getPrivateProjectPreview(), null);
  assert.equal(service._lastPrivatePreviewError, 'permission-denied');
  assert.match(service._describePrivatePreviewError(service._lastPrivatePreviewError), /правилами Firestore/);
  result = Promise.resolve({ forEach(fn) { fn({ id: 'broken', data: () => ({ payload: '{' }) }); } });
  assert.equal(await service.getPrivateProjectPreview(), null);
  assert.equal(service._lastPrivatePreviewError, 'invalid-document');
  result = Promise.resolve({ forEach() {} });
  assert.deepEqual(Array.from(await service.getPrivateProjectPreview()), []);
  assert.equal(service._lastPrivatePreviewError, null);
  assert.equal(service._writesEnabled, false);
});

test('private project envelope round-trips only matching, bounded JSON', () => {
  const service = execute('js/services/firebase.js').FirebaseService;
  const project = { id: 'valid_1', name: 'Тест', nested: { progress: 42 } };
  const original = JSON.stringify(project);
  const envelope = service._preparePrivateProjectEnvelope(project);
  assert.deepEqual(Object.keys(envelope).sort(), ['id', 'payload', 'schemaVersion']);
  assert.equal(envelope.schemaVersion, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(service._decodePrivateProjectDocument(envelope, 'valid_1'))), project);
  assert.equal(JSON.stringify(project), original);
  assert.equal(service._preparePrivateProjectEnvelope({ id: '../bad' }), null);
  assert.equal(service._preparePrivateProjectEnvelope({ id: 'valid', value: 'x'.repeat(200001) }), null);
  assert.equal(service._preparePrivateProjectEnvelope({ id: 'valid', toJSON() { throw Error('bad'); } }), null);
  for (const corrupt of [
    { ...envelope, schemaVersion: 2 },
    { ...envelope, payload: '{' },
    { ...envelope, id: 'other' },
    { ...envelope, payload: '{"id":"other"}' },
    { ...envelope, payload: '{"id":"valid_1","__proto__":{"admin":true}}' },
    { ...envelope, extra: true }
  ]) assert.equal(service._decodePrivateProjectDocument(corrupt, 'valid_1'), null);
  assert.equal(service._writesEnabled, false);
});

test('private project preview refuses incomplete or malformed inventories', async () => {
  const user = { uid: 'owner-uid' };
  const serviceCtx = execute('js/services/firebase.js', { firebase: { auth: () => ({ currentUser: user }) } });
  const service = serviceCtx.FirebaseService;
  const good = service._preparePrivateProjectEnvelope({ id: 'good', name: 'Valid' });
  const docs = [
    { id: 'good', data: () => good },
    { id: 'bad', data: () => ({ id: 'bad', schemaVersion: 1, payload: '<img onerror=alert(1)>' }) }
  ];
  service._db = { collection: () => ({ doc: () => ({ collection: () => ({ limit: () => ({
    get: async () => ({ forEach: fn => docs.forEach(fn) })
  }) }) }) }) };
  const preview = await service.getPrivateProjectPreview();
  assert.equal(preview, null);
  assert.equal(service._writesEnabled, false);
});

test('cloud migration preview is user-initiated, read-only and reports conflicts', async () => {
  const source = fs.readFileSync(path.join(root, 'js/services/firebase-identity.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="cloudMigrationPreviewBtn" disabled/);
  assert.match(html, /id="cloudMigrationBackupBtn"/);
  assert.match(html, /id="cloudMigrationPreviewStatus" role="status" aria-live="polite"/);
  assert.match(source, /FirebaseService\.getPrivateProjectPreview\(\)/);
  assert.match(source, /SyncModule\._planPrivateMigration\(local, remote\)/);
  assert.doesNotMatch(source, /FirebaseService\.saveAllProjects|\.set\(|\.batch\(/);
  assert.match(source, /ExportModule\.createBackup\(\)/);
});

test('cloud migration preview ignores an older response after an account switch', async () => {
  const status = { textContent: '' };
  const button = { disabled: false };
  const identityButton = { textContent: '', title: '', setAttribute() {} };
  const elements = {
    cloudMigrationPreviewStatus: status,
    cloudMigrationPreviewBtn: button,
    cloudIdentityBtn: identityButton
  };
  let resolveRead;
  let localReads = 0;
  const user = { uid: 'user-A', email: 'a@example.com' };
  const auth = { currentUser: user };
  const ctx = execute('js/services/firebase-identity.js', {
    document: { getElementById: id => elements[id] || null },
    FirebaseService: { getPrivateProjectPreview: () => new Promise(resolve => { resolveRead = resolve; }) },
    StateManager: { get() { localReads++; return [{ id: 'local' }]; } },
    SyncModule: { _planPrivateMigration() { throw Error('Stale result must not be planned'); } }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = auth;
  identity._user = user;
  identity._ready = true;
  const pending = identity.previewMigration();
  assert.equal(button.disabled, true);
  auth.currentUser = { uid: 'user-B' };
  identity._user = auth.currentUser;
  identity._activeUid = 'user-B';
  identity._previewRequestId++;
  identity._previewBusy = false;
  status.textContent = 'Аккаунт B';
  resolveRead([{ id: 'remote' }]);
  assert.equal(await pending, false);
  assert.equal(status.textContent, 'Аккаунт B');
  assert.equal(localReads, 0);
  assert.equal(identity._previewBusy, false);
});

test('cloud migration preview reports a read failure without changing local projects', async () => {
  const status = { textContent: '' };
  const button = { disabled: false };
  const user = { uid: 'owner', email: 'owner@example.com' };
  let localWrites = 0;
  const ctx = execute('js/services/firebase-identity.js', {
    document: { getElementById: id => ({
      cloudMigrationPreviewStatus: status,
      cloudMigrationPreviewBtn: button,
      cloudIdentityBtn: { setAttribute() {} }
    })[id] || null },
    FirebaseService: { getPrivateProjectPreview: () => Promise.reject(Error('permission-denied')) },
    StateManager: { get() { throw Error('Must not read projects on failed Firestore read'); }, set() { localWrites++; } }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: user };
  identity._user = user;
  identity._ready = true;
  assert.equal(await identity.previewMigration(), false);
  assert.match(status.textContent, /Не удалось проверить перенос/);
  assert.equal(localWrites, 0);
  assert.equal(button.disabled, false);
});

test('cloud sync security plan requires UID ownership and preserves disabled client writes', () => {
  const plan = fs.readFileSync(path.join(root, 'docs/FIREBASE_SECURITY_PLAN.md'), 'utf8');
  const firebaseService = fs.readFileSync(path.join(root, 'js/services/firebase.js'), 'utf8');
  assert.match(plan, /Единственный актуальный прототип/);
  assert.match(fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'), /request\.auth\.uid == uid/);
  assert.match(plan, /подтвердил публикацию правил/);
  assert.match(plan, /Перед будущим деплоем обязательны успешные эмуляторные тесты/);
  assert.match(firebaseService, /_writesEnabled: false/);
});

test('Google identity is separated from local owner editing and cloud writes remain disabled', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const identity = fs.readFileSync(path.join(root, 'js/services/firebase-identity.js'), 'utf8');
  const firebaseService = fs.readFileSync(path.join(root, 'js/services/firebase.js'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'js/core/sync.js'), 'utf8');
  assert.match(html, /id="cloudIdentityBtn"/);
  assert.match(identity, /signInWithPopup\(new firebase\.auth\.GoogleAuthProvider\(\)\)/);
  assert.match(identity, /onAuthStateChanged/);
  assert.doesNotMatch(identity, /AuthService\.login|_writesEnabled\s*=\s*true|uploadToCloud/);
  assert.match(firebaseService, /_writesEnabled: false/);
  assert.match(sync, /uploadToCloud: function\(\) \{\s*return Promise\.resolve\(false\)/);
});

test('Google login errors show actionable Firebase codes', () => {
  const identity = execute('js/services/firebase-identity.js').FirebaseIdentityModule;
  assert.match(identity._describeAuthError({ code: 'auth/unauthorized-domain' }), /doctorstrangesh\.github\.io/);
  assert.match(identity._describeAuthError({ code: 'auth/operation-not-allowed' }), /Сохрани настройки/);
  assert.match(identity._describeAuthError({ code: 'auth/popup-blocked' }), /всплывающие окна/);
  assert.match(identity._describeAuthError({ code: 'auth/unknown' }), /\[auth\/unknown\]/);
});

test('task CSV export preserves rows, escapes punctuation and neutralizes spreadsheet formulas', () => {
  const module = execute('js/modules/export.js').ExportModule;
  const result = module._tasksCsv([
    { name: 'Проект; "один"', status: 'active', checklist: [
      { text: '=HYPERLINK("evil")', priority: 'high', deadline: '2026-11-21' },
      { text: 'Обычная; задача\nв две строки', completed: true, priority: 'other', deadline: 'bad' }
    ] },
    { name: '+опасное имя', checklist: [{ text: ' @SUM(1)', completed: false }] }
  ]);
  assert.equal(result.count, 3);
  assert.ok(result.csv.startsWith('\uFEFF"Проект";'));
  assert.ok(result.csv.includes('"Проект; ""один"""'));
  assert.ok(result.csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(result.csv.includes('"\'+опасное имя"'));
  assert.ok(result.csv.includes('"\' @SUM(1)"'));
  assert.ok(result.csv.includes('"Обычная; задача\nв две строки"'));
  assert.ok(result.csv.includes('"Выполнена";"normal";""'));
  assert.ok(result.csv.endsWith('\r\n'));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /id="footerTasksExportBtn"/);
});

test('recent completion feed includes only completed tasks with genuine dates in the last week', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const now = new Date('2026-11-19T12:00:00.000Z');
  const projects = [
    { id: 'p1', name: 'Проект', checklist: [
      { id: 'fresh', text: '<b>Готово</b>', completed: true, completedAt: '2026-11-19T11:00:00Z' },
      { id: 'older', text: 'Старое', completed: true, completedAt: '2026-11-10T11:00:00Z' },
      { id: 'undated', text: 'Без даты', completed: true },
      { id: 'pending', text: 'В работе', completed: false, completedAt: '2026-11-19T10:00:00Z' },
      { id: 'future', text: 'Будущее', completed: true, completedAt: '2026-11-20T10:00:00Z' }
    ] },
    { id: 'p2', name: 'Другой', checklist: [{ id: 'yesterday', text: 'Вчера', completed: true, completedAt: '2026-11-18T11:00:00Z' }] }
  ];
  const result = renderer._collectRecentCompletions(projects, now);
  assert.deepEqual(Array.from(result, row => row.taskId), ['fresh', 'yesterday']);
  assert.equal(result[0].text, '<b>Готово</b>');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<details class="workspace-activity" id="workspaceActivity">/);
  assert.match(html, /id="workspaceActivityList"/);
  assert.match(fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8'), /\.workspace-activity > summary:focus-visible/);
  assert.match(fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8'), /title\.textContent = item\.text/);
});

test('recent completion feed excludes tasks without stable project and task identifiers', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const now = new Date('2026-11-19T12:00:00.000Z');
  const rows = renderer._collectRecentCompletions([
    { name: 'Без ID проекта', checklist: [{ id: 'task', text: 'Не открывается', completed: true, completedAt: '2026-11-19T11:00:00Z' }] },
    { id: 'project', name: 'Проект', checklist: [
      { text: 'Без ID задачи', completed: true, completedAt: '2026-11-19T10:00:00Z' },
      { id: 'valid', text: 'Корректная задача', completed: true, completedAt: '2026-11-19T09:00:00Z' }
    ] }
  ], now);
  assert.deepEqual(Array.from(rows, row => [row.projectId, row.taskId]), [['project', 'valid']]);
});

test('deadline alerts show overdue and next two days without duplicate persistent notifications', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const now = new Date(2026, 10, 19, 12);
  const data = [
    { id: 'active', status: 'active', name: 'Работа', checklist: [
      { id: 'old', text: 'Просрочена', deadline: '2026-11-18' },
      { id: 'today', text: 'Сегодня', deadline: '2026-11-19' },
      { id: 'soon', text: 'Скоро', deadline: '2026-11-21' },
      { id: 'later', text: 'Позже', deadline: '2026-11-22' },
      { id: 'done', text: 'Готово', deadline: '2026-11-18', completed: true },
      { id: 'bad', text: 'Неверная дата', deadline: '2026-02-30' }
    ] },
    { id: 'archived', status: 'archived', checklist: [{ id: 'skip', text: 'Архив', deadline: '2026-11-18' }] }
  ];
  assert.deepEqual(Array.from(renderer._collectDeadlineAlerts(data, now), item => item.taskId), ['old', 'today', 'soon']);
  assert.deepEqual(Array.from(renderer._collectDeadlineAlerts(data, now), item => item.taskId), ['old', 'today', 'soon']);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="workspaceDeadlineAlerts"/);
  assert.match(html, /id="workspaceDeadlineList"/);
  assert.match(fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8'), /title\.textContent = item\.text/);
});

test('health history transfer validates and merges daily readings without overwriting local scores', () => {
  const exportModule = execute('js/modules/export.js').ExportModule;
  const incoming = [{ date: '2026-11-14', scores: { a: 70, b: 60 } }, { date: '2026-11-15', scores: { a: 80, __proto__: 10 } }];
  const local = [{ date: '2026-11-14', scores: { a: 72 } }];
  const combined = exportModule._mergeHealthHistory(local, incoming);
  assert.equal(combined.length, 2);
  assert.equal(combined[0].scores.a, 72);
  assert.equal(combined[0].scores.b, 60);
  assert.equal(combined[1].scores.a, 80);
  assert.equal(exportModule._cleanHealthHistory([{ date: '2026-02-30', scores: { a: 50 } }]).length, 0);
  assert.throws(() => exportModule._cleanHealthHistory(null));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="healthExportBtn"/);
  assert.match(html, /id="healthImportBtn"/);
});

test('createBackup serializes every supported workspace data section', () => {
  let downloaded = null;
  const ctx = execute('js/modules/export.js', {
    App: { config: { version: '3.66.24' } },
    StateManager: { get(path) {
      return path === 'projects' ? [{ id: 'p1', name: 'Project One', checklist: [{ id: 't1', text: 'Task' }], notes: [{ id: 'n1', title: 'Note' }] }]
        : path === 'theme' ? 'light' : null;
    } },
    FavoritesModule: { favorites: ['p1'] },
    AchievementsModule: { unlocked: ['first_project'] },
    StorageService: {
      KEYS: { SETTINGS: 'settings', ACTIVITY: 'activity' },
      get(key, fallback) {
        const values = {
          settings: { syncMode: 'local', compactMode: true },
          activity: [{ type: 'project-created', id: 'evt1' }],
          healthHistory: [{ date: '2026-11-19', scores: { focus: 80 } }]
        };
        return values[key] === undefined ? fallback : values[key];
      }
    },
    Helpers: { downloadFile(data, filename) { downloaded = { data, filename }; } },
    NotificationModule: { success() {} }
  });
  ctx.ExportModule.createBackup();
  assert.ok(downloaded);
  const backup = JSON.parse(downloaded.data);
  assert.equal(backup.version, '3.66.24');
  assert.equal(backup.projects[0].checklist[0].text, 'Task');
  assert.equal(backup.projects[0].notes[0].title, 'Note');
  assert.equal(backup.theme, 'light');
  assert.deepEqual(backup.favorites, ['p1']);
  assert.deepEqual(backup.achievements, ['first_project']);
  assert.equal(backup.settings.compactMode, true);
  assert.equal(backup.activity[0].id, 'evt1');
  assert.equal(backup.healthHistory[0].scores.focus, 80);
  assert.match(downloaded.filename, /^devspace-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test('full backup includes settings and activity alongside projects and theme', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/export.js'), 'utf8');
  assert.match(source, /settings: StorageService\.get\(StorageService\.KEYS\.SETTINGS, \{\}\)/);
  assert.match(source, /activity: StorageService\.get\(StorageService\.KEYS\.ACTIVITY, \[\]\)/);
  assert.match(source, /StorageService\.set\(StorageService\.KEYS\.SETTINGS, importedSettings\)/);
  assert.match(source, /StorageService\.set\(StorageService\.KEYS\.ACTIVITY, importedActivity\)/);
  assert.match(source, /_validateBackupMetadata/);
});

test('backup project validator rejects malformed, duplicate and unsafe records', () => {
  const service = execute('js/modules/export.js').ExportModule;
  const valid = [{ id: 'project_1', name: 'Project One', checklist: [{ text: 'Task' }] }];
  const normalized = service._validateBackupProjects(valid);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), valid);
  assert.notEqual(normalized, valid);
  assert.notEqual(normalized[0], valid[0]);
  assert.throws(() => service._validateBackupProjects([{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }]), /повторяющиеся ID/);
  assert.throws(() => service._validateBackupProjects([{ id: 'bad id', name: 'Invalid' }]), /некорректный проект/);
  assert.throws(() => service._validateBackupProjects([null]), /некорректный проект/);
  const unsafe = JSON.parse('[{"id":"p1","name":"Unsafe","meta":{"constructor":{"prototype":{"polluted":true}}}}]');
  assert.throws(() => service._validateBackupProjects(unsafe), /небезопасные поля/);
  assert.throws(() => service._validateBackupProjects(Array(1001).fill({ id: 'p', name: 'Too many' })), /список проектов/);
});

test('backup importer validates payload before confirmation and restores a valid theme', async () => {
  const service = execute('js/modules/export.js', {
    Helpers: { readFile: () => Promise.resolve(JSON.stringify({
      theme: 'light',
      projects: [{ id: 'p1', name: 'Imported project' }],
      favorites: ['p1'],
      achievements: [],
      settings: { compactMode: true },
      activity: [{ type: 'project-created', at: '2026-11-20T09:00:00.000Z' }]
    })) },
    confirm: () => true,
    StateManager: {
      get() { return []; },
      set(path, value) { writes.push([path, value]); },
      saveProjects() { writes.push(['saveProjects']); return true; }
    },
    StorageService: {
      KEYS: { SETTINGS: 'settings', ACTIVITY: 'activity' },
      get(key) { return key === 'theme' ? 'light' : []; },
      set(key, value) { writes.push([key, value]); return true; }
    },
    ThemeModule: { setTheme(theme, persist) { writes.push(['theme-module', theme, persist]); writes.push(['theme', theme]); } },
    FavoritesModule: { favorites: [] },
    RendererModule: {
      _updateQuickAccess() { writes.push(['quick-access-refresh']); },
      renderProjects() {}, renderStats() {}, _renderInsights() {}
    },
    NotificationModule: { success() {}, error(message) { errors.push(message); } }
  }).ExportModule;
  const writes = [];
  const errors = [];
  service._importFile({ size: 20 });
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(writes.some(([key, value]) => key === 'theme' && value === 'light'));
  assert.ok(writes.some(([key, value, persist]) => key === 'theme-module' && value === 'light' && persist === true));
  assert.ok(writes.some(([key]) => key === 'quick-access-refresh'));
  assert.ok(writes.some(([key, value]) => key === 'settings' && value.compactMode === true));
  assert.ok(writes.some(([key, value]) => key === 'activity' && value[0].type === 'project-created'));
  assert.equal(errors.length, 0);
});

test('backup importer reports storage quota failures instead of claiming a full restore', async () => {
  const writes = [];
  const errors = [];
  let successes = 0;
  const service = execute('js/modules/export.js', {
    Helpers: { readFile: () => Promise.resolve(JSON.stringify({
      projects: [{ id: 'p1', name: 'Valid project' }],
      settings: { compactMode: true },
      activity: [{ type: 'created' }]
    })) },
    confirm: () => true,
    StateManager: {
      get() { return []; },
      set(path, value) { writes.push([path, value]); },
      saveProjects() { return true; }
    },
    StorageService: {
      KEYS: { SETTINGS: 'settings', ACTIVITY: 'activity' },
      get() { return []; },
      set(key, value) {
        writes.push([key, value]);
        return key !== 'activity';
      }
    },
    RendererModule: { renderProjects() {}, renderStats() {}, _renderInsights() {} },
    NotificationModule: { success() { successes++; }, error(message) { errors.push(message); } }
  }).ExportModule;
  service._importFile({ size: 10 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(successes, 0);
  assert.match(errors[0], /журнал активности не удалось сохранить/);
});

test('backup importer rolls back every store when a later write fails', async () => {
  const errors = [];
  const values = new Map([
    ['theme', 'dark'],
    ['favorites', ['old_favorite']],
    ['achievements', ['old_achievement']],
    ['settings', { compactMode: false }],
    ['activity', [{ type: 'old-event' }]],
    ['healthHistory', [{ date: '2026-11-01', scores: { focus: 50 } }]]
  ]);
  const state = { projects: [{ id: 'old_project', name: 'Old project' }], theme: 'dark' };
  const favorites = { favorites: ['old_favorite'] };
  const achievements = { unlocked: ['old_achievement'] };
  let failActivityWriteOnce = true;
  const storage = {
    KEYS: { SETTINGS: 'settings', ACTIVITY: 'activity' },
    get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    set(key, value) {
      if (key === 'activity' && failActivityWriteOnce) {
        failActivityWriteOnce = false;
        return false;
      }
      values.set(key, value);
      return true;
    },
    remove(key) { values.delete(key); return true; }
  };
  const ctx = execute('js/modules/export.js', {
    Helpers: { readFile: () => Promise.resolve(JSON.stringify({
      projects: [{ id: 'new_project', name: 'New project' }],
      theme: 'light',
      favorites: ['new_favorite'],
      achievements: ['new_achievement'],
      settings: { compactMode: true },
      activity: [{ type: 'new-event' }]
    })) },
    confirm: () => true,
    StateManager: {
      get(key) { return state[key]; },
      set(key, value) { state[key] = value; },
      saveProjects() { return true; },
      _updateStats() {}
    },
    StorageService: storage,
    FavoritesModule: favorites,
    AchievementsModule: achievements,
    ThemeModule: { setTheme(value) { state.theme = value; values.set('theme', value); } },
    RendererModule: { renderProjects() {}, renderStats() {}, _renderInsights() {}, _updateQuickAccess() {}, _renderAchievements() {} },
    NotificationModule: { success() { throw new Error('must not report success'); }, error(message) { errors.push(message); } }
  });
  ctx.ExportModule._importFile({ size: 10 });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(state.projects, [{ id: 'old_project', name: 'Old project' }]);
  assert.equal(state.theme, 'dark');
  assert.deepEqual(favorites.favorites, ['old_favorite']);
  assert.deepEqual(achievements.unlocked, ['old_achievement']);
  assert.deepEqual(values.get('theme'), 'dark');
  assert.deepEqual(values.get('favorites'), ['old_favorite']);
  assert.deepEqual(values.get('achievements'), ['old_achievement']);
  assert.deepEqual(values.get('settings'), { compactMode: false });
  assert.deepEqual(values.get('activity'), [{ type: 'old-event' }]);
  assert.deepEqual(values.get('healthHistory'), [{ date: '2026-11-01', scores: { focus: 50 } }]);
  assert.match(errors[0], /Импорт отменён, прежние данные восстановлены/);
});

test('backup importer warns when rollback itself cannot restore every storage key', async () => {
  const errors = [];
  const values = new Map([
    ['theme', 'dark'],
    ['settings', { compactMode: false }],
    ['activity', [{ type: 'old-event' }]]
  ]);
  let activityFailureTriggered = false;
  let settingsRollbackFailureTriggered = false;
  const storage = {
    KEYS: { SETTINGS: 'settings', ACTIVITY: 'activity' },
    get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    set(key, value) {
      if (key === 'activity' && !activityFailureTriggered) {
        activityFailureTriggered = true;
        return false;
      }
      if (key === 'settings' && settingsRollbackFailureTriggered && value.compactMode === false) {
        return false;
      }
      values.set(key, value);
      if (key === 'settings' && value.compactMode === true) settingsRollbackFailureTriggered = true;
      return true;
    },
    remove(key) { values.delete(key); return true; }
  };
  const state = { projects: [{ id: 'old_project', name: 'Old project' }], theme: 'dark' };
  const ctx = execute('js/modules/export.js', {
    Helpers: { readFile: () => Promise.resolve(JSON.stringify({
      projects: [{ id: 'new_project', name: 'New project' }],
      theme: 'light',
      settings: { compactMode: true },
      activity: [{ type: 'new-event' }]
    })) },
    confirm: () => true,
    StateManager: {
      get(key) { return state[key]; },
      set(key, value) { state[key] = value; },
      saveProjects() { return true; },
      _updateStats() {}
    },
    StorageService: storage,
    ThemeModule: { setTheme(value) { state.theme = value; values.set('theme', value); } },
    RendererModule: { renderProjects() {}, renderStats() {}, _renderInsights() {} },
    NotificationModule: { success() { throw new Error('must not report success'); }, error(message) { errors.push(message); } }
  });
  ctx.ExportModule._importFile({ size: 10 });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.match(errors[0], /автоматическое восстановление завершилось не полностью/);
  assert.equal(state.projects[0].id, 'old_project');
  assert.equal(JSON.stringify(values.get('settings')), JSON.stringify({ compactMode: true }));
});

test('backup importer restores prior projects when the initial project save fails', async () => {
  const errors = [];
  const oldProjects = [{ id: 'old_project', name: 'Old project' }];
  const state = { projects: oldProjects };
  let saveCalls = 0;
  const storageWrites = [];
  const ctx = execute('js/modules/export.js', {
    Helpers: { readFile: () => Promise.resolve(JSON.stringify({
      projects: [{ id: 'new_project', name: 'New project' }],
      theme: 'light',
      favorites: ['new_project'],
      settings: { compactMode: true }
    })) },
    confirm: () => true,
    StateManager: {
      get(key) { return state[key]; },
      set(key, value) { state[key] = value; },
      saveProjects() { saveCalls++; return saveCalls > 1; },
      _updateStats() {}
    },
    StorageService: {
      KEYS: { SETTINGS: 'settings', ACTIVITY: 'activity' },
      get(key, fallback) { return fallback; },
      set(key, value) { storageWrites.push([key, value]); return true; },
      remove() { return true; }
    },
    ThemeModule: { setTheme() { throw Error('theme must not be applied after failed project save'); } },
    RendererModule: { renderProjects() {}, renderStats() {}, _renderInsights() {}, _updateQuickAccess() {} },
    NotificationModule: { success() { throw Error('must not report success'); }, error(message) { errors.push(message); } }
  });
  ctx.ExportModule._importFile({ size: 10 });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(state.projects, oldProjects);
  assert.equal(saveCalls, 2, 'the failed write is followed by a rollback save');
  assert.deepEqual(storageWrites, [], 'metadata must not be changed if projects cannot be saved');
  assert.match(errors[0], /прежние данные восстановлены/);
});

test('backup importer rejects invalid settings before writing any project data', async () => {
  const writes = [];
  const errors = [];
  const service = execute('js/modules/export.js', {
    Helpers: { readFile: () => Promise.resolve(JSON.stringify({
      projects: [{ id: 'p1', name: 'Valid project' }],
      settings: ['not', 'an', 'object']
    })) },
    confirm: () => { throw Error('Invalid backup must not ask for confirmation'); },
    StateManager: { set(path, value) { writes.push([path, value]); }, saveProjects() { writes.push(['saveProjects']); } },
    StorageService: { get() { return []; }, set(key, value) { writes.push([key, value]); return true; } },
    NotificationModule: { success() {}, error(message) { errors.push(message); } }
  }).ExportModule;
  service._importFile({ size: 10 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes.length, 0);
  assert.match(errors[0], /настройки/);
});

test('backup importer rejects malformed favorites and achievements before changing state', async () => {
  for (const payload of [
    { favorites: ['p1', { unsafe: true }] },
    { achievements: ['first_project', 'first_project'] }
  ]) {
    const writes = [];
    const errors = [];
    const service = execute('js/modules/export.js', {
      Helpers: { readFile: () => Promise.resolve(JSON.stringify({
        projects: [{ id: 'p1', name: 'Valid project' }],
        ...payload
      })) },
      confirm: () => { throw Error('Invalid list must not ask for confirmation'); },
      StateManager: { set(path, value) { writes.push([path, value]); }, saveProjects() { writes.push(['saveProjects']); } },
      StorageService: { get() { return []; }, set(key, value) { writes.push([key, value]); return true; } },
      NotificationModule: { success() {}, error(message) { errors.push(message); } }
    }).ExportModule;
    service._importFile({ size: 10 });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(writes.length, 0);
    assert.match(errors[0], /списка|избранное|достижения/);
  }
});

test('theme module persists an imported preference even when that theme is already active', () => {
  const writes = [];
  const ctx = execute('js/modules/theme.js', {
    StorageService: {
      KEYS: { THEME: 'theme' },
      set(key, value) { writes.push([key, value]); return true; }
    }
  });
  ctx.ThemeModule.setTheme('dark', true);
  assert.deepEqual(writes, [['theme', 'dark']]);
  writes.length = 0;
  ctx.ThemeModule.setTheme('dark', false);
  assert.deepEqual(writes, []);
});

test('theme remains unchanged and reports an error when preference persistence fails', () => {
  const errors = [];
  const events = [];
  const applied = [];
  const ctx = execute('js/modules/theme.js', {
    StorageService: { KEYS: { THEME: 'theme' }, set() { return false; } },
    NotificationModule: { error(message) { errors.push(message); } },
    EventBus: { emit(name) { events.push(name); } }
  });
  const theme = ctx.ThemeModule;
  theme._applyThemeToDOM = value => applied.push(value);
  theme._updateToggleButton = () => {};
  assert.equal(theme.setTheme('light', true), false);
  assert.equal(theme.currentTheme, 'dark');
  assert.deepEqual(applied, []);
  assert.deepEqual(events, []);
  assert.equal(errors.length, 1);
  assert.equal(theme.setTheme('light', false), true);
  assert.equal(theme.currentTheme, 'light');
  assert.deepEqual(applied, ['light']);
});

test('project backup carries health history while legacy backup import remains supported', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/export.js'), 'utf8');
  assert.match(source, /healthHistory: this\._cleanHealthHistory\(StorageService\.get\('healthHistory', \[\]\)\)/);
  assert.match(source, /Array\.isArray\(data\.healthHistory\)/);
  assert.match(source, /data\.healthHistory !== undefined/);
  assert.match(source, /StorageService\.set\('healthHistory', mergedHistory\)/);
});

test('health analytics creates safe bounded trends and explains score penalties', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const series = renderer._healthSeries([{ date: '2026-11-14', scores: { a: 62 } }, { date: '2026-11-15', scores: { a: 80 } }], 'a');
  assert.deepEqual(Array.from(series, item => item.score), [62, 80]);
  const svg = renderer._healthChartSvg(series);
  assert.match(svg, /<svg/);
  assert.match(svg, /80\/100/);
  const compared = renderer._healthChartSvg(series, [{ date: '2026-11-15', score: 45 }]);
  assert.match(compared, /health-comparison/);
  assert.match(compared, /Сравнение: 45\/100/);
  assert.match(renderer._healthChartSvg([]), /История появится/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="healthProjectFilter"/);
  assert.match(html, /id="healthScoreDetails"/);
  assert.match(html, /id="healthCompareFilter"/);
  assert.match(html, /id="healthPeriodFilter"/);
  assert.match(html, /id="healthRecommendations"/);
});

test('health recommendations prioritize overdue, stale and undated work', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const tips = renderer._healthRecommendations({ score: 35, overdue: 2, inactiveDays: 30, completed: 0, total: 3, undated: 0 });
  assert.deepEqual(Array.from(tips, tip => tip.kind), ['overdue', 'stale', 'progress']);
  assert.match(tips[0].detail, /20 баллов/);
  assert.equal(renderer._healthRecommendations({ score: null })[0].kind, 'plan');
  assert.equal(renderer._healthRecommendations({ score: 100, overdue: 0, inactiveDays: 0, completed: 1, total: 1, undated: 0 })[0].kind, 'stable');
});

test('project health alerts identify significant score drops and critical risk', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const history = [{ date: '2026-11-14', scores: { a: 90, b: 40 } }, { date: '2026-11-15', scores: { a: 55, b: 45 } }];
  const alerts = renderer._collectHealthAlerts([{ id: 'a', name: 'A', score: 55 }, { id: 'b', name: 'B', score: 45 }, { id: 'c', name: 'C', score: null }], history);
  assert.deepEqual(Array.from(alerts, alert => alert.kind), ['decline', 'risk', 'risk']);
  assert.equal(alerts[0].id, 'a');
  assert.equal(renderer._collectHealthAlerts([{ id: 'a', name: 'A', score: 95 }], history).length, 0);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /id="healthAlerts"/);
});

test('deadline outlook buckets real unfinished work and ignores closed projects', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const projects = [
    { id: 'a', name: 'Active', status: 'active', checklist: [
      { text: 'Late', deadline: '2026-11-14' }, { text: 'Soon', deadline: '2026-11-15' },
      { text: 'This week', deadline: '2026-11-21' }, { text: 'Next week', deadline: '2026-11-22' },
      { text: 'Future', deadline: '2026-11-29' }, { text: 'Unscheduled' },
      { text: 'Bad date', deadline: '2026-02-30' }, { text: 'Finished', deadline: '2026-11-01', completed: true }
    ] },
    { id: 'b', status: 'completed', checklist: [{ text: 'Archived deadline', deadline: '2026-11-01' }] }
  ];
  const result = renderer._collectDeadlineOutlook(projects, new Date(2026, 10, 15));
  assert.deepEqual([result.overdue, result.week, result.fortnight, result.later, result.unscheduled], [1, 2, 1, 1, 2]);
  assert.equal(result.projects.length, 1);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /id="deadlineOutlook"/);
});

test('health history records real daily scores, overwrites same-day readings and caps retention', () => {
  const ctx = execute('js/ui/renderer.js');
  const renderer = ctx.RendererModule;
  const one = renderer._updateHealthHistory([], [{ id: 'p', score: 70 }, { id: 'q', score: null }], new Date(2026, 10, 14));
  const sameDay = renderer._updateHealthHistory(one, [{ id: 'p', score: 75 }], new Date(2026, 10, 14));
  assert.equal(sameDay.length, 1);
  assert.equal(sameDay[0].scores.p, 75);
  assert.equal(sameDay[0].scores.q, undefined);
  const second = renderer._updateHealthHistory(sameDay, [{ id: 'p', score: 85 }], new Date(2026, 10, 15));
  assert.deepEqual(JSON.parse(JSON.stringify(renderer._healthTrend(second, 'p', 85))), { label: '↑ +10 с прошлого замера', direction: 'up' });
  assert.equal(renderer._healthTrend(second, 'missing', null).direction, 'neutral');
  assert.equal(one[0].scores.p, 70);
  let rolling = second;
  for (let i = 0; i < 45; i++) rolling = renderer._updateHealthHistory(rolling, [{ id: 'p', score: 80 }], new Date(2026, 10, 16 + i));
  assert.equal(rolling.length, 30);
  assert.equal(rolling.at(-1).scores.p, 80);
});

test('project health distinguishes risk, inactivity and missing plans without mutating projects', () => {
  const ctx = execute('js/ui/renderer.js');
  const projects = [
    { id: 'r', name: 'Риск', status: 'active', updatedAt: '2026-10-01', checklist: [{ text: 'Просрочено', deadline: '2026-11-10' }, { text: 'Вторая', deadline: '2026-11-09' }] },
    { id: 'g', name: 'Хорошо', status: 'active', updatedAt: '2026-11-14', checklist: [{ text: 'Работа', deadline: '2026-11-23' }] },
    { id: 'u', name: 'Без задач', status: 'planning', checklist: [] },
    { id: 'c', name: 'Закрыт', status: 'completed', checklist: [{ text: 'Старое' }] }
  ];
  const snapshot = JSON.stringify(projects);
  const results = ctx.RendererModule._collectProjectHealth(projects, new Date(2026, 10, 15));
  assert.deepEqual(Array.from(results, item => item.id), ['r', 'g', 'u']);
  assert.equal(results[0].score, 35);
  assert.equal(results[1].score, 90);
  assert.equal(results[2].score, null);
  assert.equal(results[2].advice, 'Добавь первые задачи');
  assert.equal(JSON.stringify(projects), snapshot);
});

test('smart project overview detects stale active projects and overdue tasks only', () => {
  const ctx = execute('js/ui/renderer.js');
  const projects = [
    { id: 'old', name: 'Давно не обновляли', status: 'active', updatedAt: '2026-10-20T12:00:00Z', checklist: [{ text: 'Открытая', deadline: '2026-11-10' }, { text: 'Готовая', completed: true, deadline: '2026-11-01' }] },
    { id: 'done', status: 'completed', updatedAt: '2026-10-01T12:00:00Z', checklist: [{ text: 'Поздно', deadline: '2026-11-01' }] },
    { id: 'new', status: 'planning', updatedAt: '2026-11-14T12:00:00Z', checklist: [{ text: 'Скоро', deadline: '2026-11-20' }] }
  ];
  const snapshot = JSON.stringify(projects);
  const insights = ctx.RendererModule._collectInsights(projects, new Date(2026, 10, 15));
  assert.deepEqual(Array.from(insights, item => item.kind), ['overdue', 'stale']);
  assert.ok(insights.every(item => item.projectId === 'old'));
  assert.equal(JSON.stringify(projects), snapshot);
});

test('smart overview has safe project navigation elements', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  assert.match(html, /id="insightsPanel"/);
  assert.match(js, /data-insight-project/);
  assert.match(js, /Helpers\.escapeHtml\(item\.name\)/);
});

test('collapsible tracker panels expose accessible controls and preserve section structure', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/components/cards.css'), 'utf8');
  for (const id of ['todayPanel', 'productivityPanel', 'roadmapOverview', 'scheduleCalendar', 'focusPanel']) {
    assert.ok(html.includes(`data-collapse-panel="${id}"`));
  }
  assert.match(css, /\.schedule-calendar\.is-collapsed/);
  assert.match(css, /\.today-panel\.is-collapsed/);
});

test('collapsed panel state updates button label and aria-expanded consistently', () => {
  const ctx = execute('js/ui/renderer.js');
  const classes = new Set();
  const panel = { classList: { toggle(cls, enabled) { if (enabled) classes.add(cls); else classes.delete(cls); } } };
  const button = { textContent: '', setAttribute(key, value) { this[key] = value; } };
  ctx.RendererModule._setPanelCollapsed(panel, button, true);
  assert.ok(classes.has('is-collapsed'));
  assert.equal(button['aria-expanded'], 'false');
  assert.equal(button.textContent, 'Развернуть');
  ctx.RendererModule._setPanelCollapsed(panel, button, false);
  assert.equal(classes.has('is-collapsed'), false);
  assert.equal(button['aria-expanded'], 'true');
});

test('today dashboard prioritizes overdue and high-priority tasks from every project', () => {
  const ctx = execute('js/ui/renderer.js');
  const now = new Date(2026, 10, 15);
  const projects = [
    { id: 'a', name: 'Первый', checklist: [{ id: '1', text: 'Важно', priority: 'high' }, { id: '2', text: 'Давно пора', deadline: '2026-11-14', priority: 'low' }] },
    { id: 'b', name: 'Второй', checklist: [{ id: '3', text: 'Закрыто', completed: true, priority: 'high' }, { id: '4', text: 'Обычная без срока' }, { id: '5', text: 'Срок сегодня', deadline: '2026-11-15' }] }
  ];
  const urgent = ctx.RendererModule._collectTodayTasks(projects, now, 'all', 'urgent');
  assert.deepEqual(Array.from(urgent, task => task.text), ['Давно пора', 'Важно', 'Срок сегодня']);
  assert.equal(ctx.RendererModule._collectTodayTasks(projects, now, 'high', 'all').length, 1);
  assert.equal(ctx.RendererModule._collectTodayTasks(projects, now, 'all', 'all').length, 4);
});

test('today dashboard filters weekly due tasks and ignores completed entries', () => {
  const ctx = execute('js/ui/renderer.js');
  const tasks = [{ id: '1', text: 'Успеть', deadline: '2026-11-21' }, { id: '2', text: 'Позже', deadline: '2026-11-22' }, { id: '3', text: 'Готово', completed: true, deadline: '2026-11-15' }];
  const result = ctx.RendererModule._collectTodayTasks([{ id: 'p', checklist: tasks }], new Date(2026, 10, 15), 'all', 'week');
  assert.deepEqual(Array.from(result, task => task.text), ['Успеть']);
  assert.equal(tasks.length, 3);
});

test('workspace next tasks exclude archived projects, prioritize deadlines and keep input unchanged', () => {
  const ctx = execute('js/ui/renderer.js');
  const projects = [
    { id: 'active', name: '<script>name</script>', status: 'active', checklist: [
      { id: 'unsafe-html', text: '<img src=x onerror=alert(1)>', priority: 'high' },
      { id: 'overdue', text: 'Просрочено', deadline: '2026-11-14' },
      { id: 'done', text: 'Готово', completed: true }
    ] },
    { id: 'archived', status: 'archived', checklist: [{ id: 'archived-task', text: 'Скрыто', deadline: '2026-01-01' }] },
    { id: 'completed', status: 'completed', checklist: [{ id: 'completed-task', text: 'Тоже скрыто' }] }
  ];
  const before = JSON.stringify(projects);
  const tasks = ctx.RendererModule._getOverviewNextTasks(projects, new Date(2026, 10, 15));
  assert.deepEqual(Array.from(tasks, task => task.text), ['Просрочено', '<img src=x onerror=alert(1)>']);
  assert.equal(tasks[0].projectName, '<script>name</script>');
  assert.equal(JSON.stringify(projects), before);
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  assert.match(renderer, /name\.textContent = task\.text/);
  assert.match(renderer, /project\.textContent = task\.projectName/);
});

test('workspace task shortcuts open the specific checklist item with keyboard focus', () => {
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  assert.match(renderer, /button\.dataset\.nextProject = String\(task\.projectId\)/);
  assert.match(renderer, /button\.dataset\.nextTask = String\(task\.id\)/);
  assert.match(renderer, /ProjectDetailModule\.showTask\(button\.dataset\.nextProject, button\.dataset\.nextTask\)/);
  assert.match(detail, /showTask: function\(projectId, taskId\)/);
  assert.match(detail, /item\.dataset\.itemId === String\(taskId\)/);
  assert.match(detail, /row\.focus\(\{ preventScroll: true \}\)/);
  assert.match(detail, /\{ once: true \}/);
  assert.match(css, /\.workspace-next-open:focus-visible/);
});

test('overview keeps secondary panels available but collapsed until explicitly expanded', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'js/ui/workspace-view.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  assert.match(html, /id="workspaceMoreToggle" aria-expanded="false" aria-controls="focusPanel roadmapOverview productivityPanel"/);
  assert.match(view, /classList\.toggle\('is-overview-expanded'\)/);
  assert.match(view, /moreToggle\.setAttribute\('aria-expanded', String\(expanded\)\)/);
  assert.match(css, /:not\(\.is-overview-expanded\) > \.focus-panel/);
  assert.match(css, /:not\(\.is-overview-expanded\) > \.roadmap-overview/);
  assert.match(css, /:not\(\.is-overview-expanded\) > \.productivity-panel/);
});

test('project cards keep deletion out of the primary action row and inside owner-only details', () => {
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  const start = renderer.indexOf("var actions = '';", renderer.indexOf('_renderProjectCard:'));
  const end = renderer.indexOf("return '<div class=\"project-card\"", start);
  const actions = renderer.slice(start, end);
  assert.doesNotMatch(actions, /delete-project/);
  assert.match(renderer, /mHTML \+ \(isOwner \? '<div class="project-card-danger"><button type="button" class="delete-project"/);
  assert.match(css, /\.project-card-danger \.delete-project:focus-visible/);
});

test('project cards support keyboard opening while list view shows a compact summary', () => {
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  assert.match(renderer, /tabindex="0" role="group" aria-label=/);
  assert.match(renderer, /event\.target !== card \|\| !\['Enter', ' '\]\.includes\(event\.key\)/);
  assert.match(renderer, /ProjectDetailModule\.show\(card\.dataset\.projectId\)/);
  assert.match(css, /\.project-card:focus-visible/);
  assert.match(css, /#projectsContainer\.list-view \.project-card-extras[^\n]*display:none/);
  assert.match(css, /#projectsContainer\.list-view \.project-card-snapshot \{ grid-column:1\/-1/);
});

test('project filters have a reset action and distinguish empty results from an empty collection', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const projects = fs.readFileSync(path.join(root, 'js/modules/projects.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  assert.match(html, /id="projectsClearFilters" hidden/);
  assert.match(html, /id="projectsEmptyTitle"/);
  assert.match(projects, /search\.value = ''/);
  assert.match(projects, /StateManager\.set\('filters\.search', ''\)/);
  assert.match(projects, /StateManager\.set\('filters\.status', 'all'\)/);
  assert.match(renderer, /clearFilters\.hidden = !hasFilters/);
  assert.match(renderer, /hasFilters \? 'Ничего не найдено' : 'Нет проектов'/);
});

test('empty project search has a nearby reset and never suggests creation for filter-only emptiness', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const projects = fs.readFileSync(path.join(root, 'js/modules/projects.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  assert.match(html, /id="projectsEmptyReset" hidden/);
  assert.match(html, /id="projectsEmptyCreate"/);
  assert.match(projects, /emptyReset\.addEventListener\('click', resetFilters\)/);
  assert.match(renderer, /emptyReset\.hidden = !hasFilters/);
  assert.match(renderer, /emptyCreate\.hidden = hasFilters/);
  assert.match(css, /#projectsEmptyCreate\[hidden\] \{ display:none!important/);
  assert.match(html, /id="emptyState" class="empty-state" hidden/);
  assert.match(renderer, /emptyState\.hidden = false/);
  assert.match(renderer, /emptyState\.hidden = true/);
  assert.match(css, /#tabProjects\[data-workspace-view="projects"\] > #emptyState\[hidden\] \{ display:none!important/);
});

test('short screens keep project forms scrollable and release sticky workspace navigation', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  assert.match(html, /modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg/);
  assert.match(css, /@media\(max-height:650px\)/);
  assert.match(css, /\.workspace-switcher \{ position:relative; top:auto; \}/);
  assert.match(css, /#projectModal \.modal-body \{ min-height:0; overflow-y:auto; overscroll-behavior:contain; \}/);
  assert.match(css, /#projectDetailModal \.modal-content,#githubModal \.modal-content \{ max-height:calc\(100dvh - 20px\); \}/);
});

test('project filters announce the visible result count near the controls', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
  assert.match(html, /id="projectsResultsStatus" class="projects-results-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(renderer, /resultsStatus\.textContent = projects\.length \? 'Найдено: ' \+ projects\.length : 'Совпадений нет'/);
  assert.match(css, /\.projects-results-status \{/);
});

test('pagination and sorting can refresh cards without recomputing dashboard panels', () => {
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById() { return null; } },
    StateManager: { get() { return ''; } }
  });
  const renderer = ctx.RendererModule;
  let refreshes = 0;
  renderer._renderWorkspaceSummary = () => { refreshes++; };
  renderer.containers = { projects: null, emptyState: null };
  renderer.renderProjects({ listOnly: true });
  assert.equal(refreshes, 0);
  renderer.renderProjects();
  assert.equal(refreshes, 1);
  const source = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  assert.match(source, /_visibleCount \+= self\._pageSize;\s*self\.renderProjects\(\{ listOnly: true \}\)/);
  assert.match(source, /_sortMode = \['updated', 'name', 'status'\][^\n]+[\s\S]*?self\.renderProjects\(\{ listOnly: true \}\)/);
});

test('calendar filters by project and event type without mutating events', () => {
  const ctx = execute('js/ui/renderer.js');
  const events = [{ projectId: 'a', type: 'task' }, { projectId: 'a', type: 'stage' }, { projectId: 'b', type: 'task' }];
  assert.equal(ctx.RendererModule._filterScheduleItems(events, 'a', 'task').length, 1);
  assert.equal(ctx.RendererModule._filterScheduleItems(events, 'a', 'all').length, 2);
  assert.equal(ctx.RendererModule._filterScheduleItems(events, 'all', 'stage').length, 1);
  assert.equal(ctx.RendererModule._filterScheduleItems(events, 'missing', 'all').length, 0);
  assert.equal(events.length, 3);
});

test('calendar exposes accessible project and type selectors and nearest-work list', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/components/cards.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
  assert.match(html, /id="scheduleProjectFilter"/);
  assert.match(html, /id="scheduleTypeFilter"/);
  assert.match(html, /id="scheduleUpcoming"/);
  assert.match(css, /\.schedule-day\.is-overdue/);
  assert.match(js, /schedule-upcoming-item/);
});

test('monthly development calendar combines unfinished checklist and roadmap dates without changing source data', () => {
  const ctx = execute('js/ui/renderer.js');
  const projects = [{ id: 'one', name: 'Проект', milestones: ['Прототип', 'Готово'], milestoneDeadlines: { Прототип: '2026-11-18', Готово: '2026-11-02' }, completedMilestones: ['Готово'], checklist: [{ text: 'Проверка', deadline: '2026-11-18', completed: false }, { text: 'Закрыто', deadline: '2026-11-01', completed: true }] }];
  const before = JSON.stringify(projects);
  const events = ctx.RendererModule._collectScheduleItems(projects);
  assert.equal(events.length, 2);
  assert.deepEqual(Array.from(events, item => item.type).sort(), ['stage', 'task']);
  assert.ok(events.every(item => item.date === '2026-11-18'));
  assert.equal(JSON.stringify(projects), before);
});

test('monthly development calendar rejects invalid dates and completed linked stages', () => {
  const ctx = execute('js/ui/renderer.js');
  const events = ctx.RendererModule._collectScheduleItems([{ id: 'a', milestones: ['Готово', 'Открыто'], milestoneDeadlines: { Готово: '2026-11-20', Открыто: '2026-02-30' }, checklist: [{ milestone: 'Готово', completed: true }, { text: 'Ошибка', deadline: '2026-11-31' }, { text: 'Норма', deadline: '2026-12-01' }] }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Норма');
});

test('cross-project roadmap overview separates late and upcoming stages while excluding completed stages', () => {
  const ctx = execute('js/ui/renderer.js');
  const projects = [{
    id: 'a', name: 'Острова',
    milestones: ['Опоздал', 'На неделе', 'Позже', 'Готово', 'Без срока'],
    milestoneDeadlines: { 'Опоздал': '2026-11-13', 'На неделе': '2026-11-18', 'Позже': '2026-11-22', 'Готово': '2026-11-10' },
    checklist: [{ milestone: 'Готово', completed: true }]
  }];
  const result = ctx.RendererModule._collectRoadmapDeadlines(projects, new Date(2026, 10, 14));
  assert.equal(result.total, 5);
  assert.equal(result.completed, 1);
  assert.deepEqual(Array.from(result.overdue, item => item.stage), ['Опоздал']);
  assert.deepEqual(Array.from(result.week, item => item.stage), ['На неделе']);
});

test('cross-project roadmap overview counts manually finished milestones and sorts upcoming dates', () => {
  const ctx = execute('js/ui/renderer.js');
  const projects = [
    { id: 'a', name: 'А', milestones: ['Сделано', 'Второй'], completedMilestones: ['Сделано'], milestoneDeadlines: { 'Сделано': '2026-11-01', 'Второй': '2026-11-20' } },
    { id: 'b', name: 'Б', milestones: ['Первый'], milestoneDeadlines: { 'Первый': '2026-11-14' } }
  ];
  const result = ctx.RendererModule._collectRoadmapDeadlines(projects, new Date(2026, 10, 14));
  assert.equal(result.completed, 1);
  assert.equal(result.overdue.length, 0);
  assert.deepEqual(Array.from(result.week, item => item.stage), ['Первый', 'Второй']);
});

test('GitHub repository import clears legacy plaintext tokens and uses the public API without credentials', async () => {
  const removed = [];
  const requests = [];
  const localStorage = {
    getItem(key) { throw new Error('GitHub service must not read stored credentials: ' + key); },
    removeItem(key) { removed.push(key); }
  };
  const ctx = execute('js/services/github.js', {
    localStorage,
    fetch: async function(url, options) {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => [{
          id: 7, name: 'public-project', html_url: 'https://github.com/DoctorStrangeSH/public-project',
          description: 'Public only', stargazers_count: 3, forks_count: 1,
          language: 'JavaScript', updated_at: '2026-11-20T00:00:00Z', topics: ['demo']
        }]
      };
    }
  });
  ctx.GitHubService.init();
  assert.deepEqual(removed, ['github_token']);
  const repos = await ctx.GitHubService.getRepos();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.github\.com\/users\/DoctorStrangeSH\/repos/);
  assert.equal(requests[0].options, undefined);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].name, 'public-project');
  assert.equal('setToken' in ctx.GitHubService, false);
  assert.equal('isConnected' in ctx.GitHubService, false);
});

function execute(file, context = {}) {
  const sandbox = { console, Promise, ...context };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox;
}

test('StorageService.clearAll removes every app key but preserves unrelated origin data', () => {
  const values = new Map([
    ['devspace_projects', '[]'],
    ['devspace_favorites', '["p1"]'],
    ['devspace_healthHistory', '[]'],
    ['other-app-session', 'keep']
  ]);
  const events = [];
  const localStorage = {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); }
  };
  const ctx = execute('js/core/storage.js', {
    localStorage,
    EventBus: { emit(name) { events.push(name); } }
  });
  assert.equal(ctx.StorageService.clearAll(), true);
  assert.deepEqual(Array.from(values.entries()), [['other-app-session', 'keep']]);
  assert.deepEqual(events, ['storage:cleared']);
});

test('StateManager reports project persistence failures and only emits saved after success', () => {
  let allowSave = false;
  const events = [];
  const ctx = execute('js/core/state.js', {
    StorageService: { KEYS: { PROJECTS: 'projects' }, set() { return allowSave; } },
    EventBus: { emit(name) { events.push(name); } }
  });
  ctx.StateManager._state.projects = [{ id: 'p1', name: 'Project' }];
  assert.equal(ctx.StateManager.saveProjects(), false);
  assert.equal(events.includes('projects:saved'), false);
  allowSave = true;
  assert.equal(ctx.StateManager.saveProjects(), true);
  assert.equal(events.includes('projects:saved'), true);
});

test('project create, update and delete roll back in-memory state when storage is full', () => {
  const events = [];
  const ctx = execute('js/core/state.js', {
    StorageService: { KEYS: { PROJECTS: 'projects' }, set() { return false; } },
    EventBus: { emit(name) { events.push(name); } }
  });
  const state = ctx.StateManager;
  const original = [{ id: 'p1', name: 'Original', status: 'development' }];
  state._state.projects = original.slice();

  assert.equal(state.addProject({ id: 'p2', name: 'New' }), null);
  assert.equal(JSON.stringify(state.get('projects')), JSON.stringify(original));

  assert.equal(state.updateProject('p1', { name: 'Changed' }), null);
  assert.equal(JSON.stringify(state.get('projects')), JSON.stringify(original));

  assert.equal(state.removeProject('p1'), false);
  assert.equal(JSON.stringify(state.get('projects')), JSON.stringify(original));

  assert.equal(events.includes('project:added'), false);
  assert.equal(events.includes('project:updated'), false);
  assert.equal(events.includes('project:removed'), false);
  assert.equal(events.includes('projects:saved'), false);
});

test('StateManager updates multiple projects in one storage write and rolls all of them back on failure', () => {
  const events = [];
  let allowSave = false;
  const ctx = execute('js/core/state.js', {
    StorageService: { KEYS: { PROJECTS: 'projects' }, set() { return allowSave; } },
    EventBus: { emit(name) { events.push(name); } }
  });
  const state = ctx.StateManager;
  const original = [{ id: 'a', name: 'A', notes: [{ id: 'n1' }] }, { id: 'b', name: 'B', notes: [] }];
  state._state.projects = original;
  assert.equal(state.updateProjects([
    { projectId: 'a', updates: { notes: [] } },
    { projectId: 'b', updates: { notes: [{ id: 'n1' }] } }
  ]), null);
  assert.equal(state._state.projects, original);
  assert.equal(state.getProject('a'), original[0]);
  assert.equal(state.getProject('b'), original[1]);
  assert.equal(events.includes('project:updated'), false);

  allowSave = true;
  const updated = state.updateProjects([
    { projectId: 'a', updates: { name: 'A2' } },
    { projectId: 'b', updates: { name: 'B2' } }
  ]);
  assert.equal(updated.length, 2);
  assert.equal(state.getProject('a').name, 'A2');
  assert.equal(state.getProject('b').name, 'B2');
  assert.equal(events.filter(name => name === 'project:updated').length, 2);
});

test('project creation does not sync an item when local persistence fails', () => {
  let synced = 0;
  const ctx = execute('js/modules/projects.js', {
    Helpers: { generateId() { return 'new-project'; } },
    StateManager: { addProject() { return null; } },
    SupabaseService: { isEnabled() { return true; }, saveProject() { synced++; } },
    window: {}
  });
  const created = ctx.ProjectsModule.createProject({ name: 'Новый проект' });
  assert.equal(created, null);
  assert.equal(synced, 0);
});

test('failed project edits keep the modal open and preserve the entered form data', () => {
  const errors = [];
  let modalLookups = 0;
  const values = {
    projectId: { value: 'p1' }, projectTech: { value: 'Godot' }, projectMilestones: { value: 'MVP' },
    projectName: { value: 'Изменённое название' }, projectDescription: { value: 'Описание' },
    projectStatus: { value: 'development' }, projectGithub: { value: '' },
    projectSupabase: { value: '' }, projectDemo: { value: '' }, projectModal: {}
  };
  const ctx = execute('js/modules/projects.js', {
    document: { getElementById(id) { return values[id] || null; } },
    Validators: { validateProject() { return { valid: true, errors: [] }; } },
    StateManager: { updateProject() { return null; } },
    NotificationModule: { error(message) { errors.push(message); } },
    bootstrap: { Modal: { getInstance() { modalLookups++; return { hide() {} }; } } },
    window: {}
  });
  const result = ctx.ProjectsModule._handleSaveProject();
  assert.equal(result, false);
  assert.equal(modalLookups, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Не удалось сохранить проект/);
});

test('active service worker precaches every first-party stylesheet and script', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const registeredWorker = app.match(/serviceWorker\.register\(['"]([^'"]+)/);
  assert.ok(registeredWorker, 'app must register a service worker');
  assert.match(registeredWorker[1], /^sw\.js\?v=/, 'app must register the maintained sw.js worker');

  const appVersion = app.match(/version:\s*['"]([^'"]+)['"]/);
  const workerAssetVersion = worker.match(/const ASSET_VERSION = ['"]([^'"]+)['"]/);
  assert.ok(appVersion && workerAssetVersion, 'app and worker asset versions must be declared');
  assert.equal(workerAssetVersion[1], appVersion[1], 'worker cache-busting version must match the app');

  const precacheBlock = worker.match(/const PRECACHE_URLS = \[([\s\S]*?)\]\.map/);
  assert.ok(precacheBlock, 'worker must declare its precache list');
  const precached = new Set(Array.from(precacheBlock[1].matchAll(/['"]((?:css|js)\/[^'"]+)['"]/g), match => match[1].split('?')[0]));
  const localAssets = [
    ...Array.from(html.matchAll(/<script[^>]+src=['"]((?:css|js)\/[^'"]+)/g), match => match[1]),
    ...Array.from(html.matchAll(/<link[^>]+href=['"]((?:css|js)\/[^'"]+\.css[^'"]*)/g), match => match[1])
  ].map(asset => asset.split('?')[0]);
  const missing = Array.from(new Set(localAssets)).filter(asset => !precached.has(asset));
  assert.deepEqual(missing, [], 'all first-party scripts and stylesheets must be available to the offline shell');
});

test('service worker keeps the previous version when a required offline asset fails', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const installStart = worker.indexOf("self.addEventListener('install'");
  const activateStart = worker.indexOf("self.addEventListener('activate'");
  assert.ok(installStart >= 0 && activateStart > installStart, 'worker install handler must exist');
  const installHandler = worker.slice(installStart, activateStart);
  assert.match(installHandler, /Promise\.allSettled\s*\(/, 'installation must wait for every required asset request to settle');
  assert.match(installHandler, /results\.find\(result => result\.status === 'rejected'\)/, 'any failed asset must abort installation after all writes finish');
  assert.match(installHandler, /!response\s*\|\|\s*!response\.ok/, 'non-success responses must abort installation');
  assert.match(installHandler, /caches\.delete\(STATIC_CACHE\)/, 'partial static cache must be removed after failure');
  assert.match(installHandler, /throw error/, 'install failure must reject and preserve the active worker');
});

test('failed PWA installation waits for pending cache writes before deleting partial cache', async () => {
  const handlers = {};
  const calls = [];
  let releasePendingWrite;
  let deleted = false;
  let skippedWaiting = false;
  const pendingWrite = new Promise(resolve => { releasePendingWrite = resolve; });
  const sandbox = {
    console: { log() {}, error() {} },
    URL,
    Promise,
    self: {
      addEventListener(name, callback) { handlers[name] = callback; },
      skipWaiting() { skippedWaiting = true; return Promise.resolve(); },
      registration: { scope: 'https://example.test/DevSpace/' }
    },
    caches: {
      open: async () => ({
        put(url) {
          calls.push(['put', url]);
          return url.startsWith('css/main.css') ? pendingWrite : Promise.resolve();
        }
      }),
      delete: async name => { calls.push(['delete', name]); deleted = true; return true; }
    },
    fetch: async url => url === 'index.html'
      ? { ok: false, status: 503 }
      : { ok: true, status: 200 }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sandbox);
  let installPromise;
  handlers.install({ waitUntil(promise) { installPromise = promise; } });

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(deleted, false, 'partial cache must not be deleted while another put is pending');
  assert.equal(skippedWaiting, false, 'failed install must not call skipWaiting');

  releasePendingWrite();
  await assert.rejects(installPromise, /Required offline asset failed to load/);
  assert.equal(deleted, true, 'partial cache must be removed after every put settles');
  assert.equal(skippedWaiting, false, 'failed install must never activate the new worker');
  assert.ok(calls.some(([kind]) => kind === 'delete'));
});

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

test('tracker renders large project lists in batches and resets pagination on filter change', () => {
  const allProjects = Array.from({ length: 65 }, (_, i) => ({ id: 'p' + i }));
  const container = { innerHTML: '' };
  const count = { textContent: '' };
  const loadMore = { hidden: true, textContent: '', addEventListener(event, fn) { if (event === 'click') this.click = fn; } };
  const elements = { projectsContainer: container, filteredCount: count, projectsLoadMore: loadMore };
  let status = 'all';
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return elements[id] || null; } },
    StateManager: { get(key) { return key === 'filters.status' ? status : ''; } },
    ProjectsModule: { getFilteredProjects() { return allProjects; } }
  });
  const renderer = ctx.RendererModule;
  renderer._cacheContainers();
  renderer._renderProjectCard = item => `<div data-id="${item.id}"></div>`;
  renderer._attachProjectEvents = () => {};
  renderer.renderProjects();
  assert.equal((container.innerHTML.match(/data-id=/g) || []).length, 24);
  assert.equal(count.textContent, 65);
  assert.equal(loadMore.hidden, false);
  assert.match(loadMore.textContent, /24 из 41/);
  loadMore.click();
  assert.equal((container.innerHTML.match(/data-id=/g) || []).length, 48);
  loadMore.click();
  assert.equal((container.innerHTML.match(/data-id=/g) || []).length, 65);
  assert.equal(loadMore.hidden, true);
  status = 'development';
  renderer.renderProjects();
  assert.equal((container.innerHTML.match(/data-id=/g) || []).length, 24);
  assert.equal(loadMore.hidden, false);
});

test('tracker sorting changes card order, resets pagination, and remembers selection', () => {
  const projects = Array.from({ length: 30 }, (_, i) => ({
    id: String(i), name: 'Проект ' + String(i + 1).padStart(2, '0'),
    status: i % 2 ? 'planning' : 'completed',
    updatedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString()
  }));
  const container = { innerHTML: '' };
  const sort = { value: 'updated', addEventListener(type, fn) { if (type === 'change') this.change = fn; } };
  const loadMore = { hidden: true, addEventListener(type, fn) { if (type === 'click') this.click = fn; } };
  const elements = { projectsContainer: container, projectsSort: sort, projectsLoadMore: loadMore };
  const saved = {};
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return elements[id] || null; } },
    sessionStorage: { getItem(key) { return saved[key]; }, setItem(key, value) { saved[key] = value; } },
    StateManager: { get() { return ''; } },
    ProjectsModule: { getFilteredProjects() { return projects; } }
  });
  const renderer = ctx.RendererModule;
  renderer._renderProjectCard = p => `[${p.id}]`;
  renderer._attachProjectEvents = () => {};
  renderer._cacheContainers();
  renderer.renderProjects();
  assert.ok(container.innerHTML.startsWith('[29]'), 'default newest first');
  loadMore.click();
  assert.equal((container.innerHTML.match(/\[\d+\]/g) || []).length, 30);
  sort.value = 'name';
  sort.change();
  assert.equal(saved.devspace_sort, 'name');
  assert.ok(container.innerHTML.startsWith('[0]'), 'alphabetical first');
  assert.equal((container.innerHTML.match(/\[\d+\]/g) || []).length, 24);
  sort.value = 'status';
  sort.change();
  assert.ok(container.innerHTML.startsWith('[28]'), 'completed before planning');
});

test('tracker switches between grid and list without re-rendering projects', () => {
  const saved = {};
  const classes = new Set();
  const container = { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
  const makeButton = mode => ({ dataset: { projectsView: mode }, attrs: {},
    classList: { toggle(name, enabled) { this.active = enabled; } },
    addEventListener(event, callback) { if (event === 'click') this.click = callback; },
    setAttribute(name, value) { this.attrs[name] = value; }
  });
  const grid = makeButton('grid');
  const list = makeButton('list');
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'projectsContainer' ? container : null; }, querySelectorAll() { return [grid, list]; } },
    sessionStorage: { getItem(key) { return saved[key]; }, setItem(key, value) { saved[key] = value; } }
  });
  const renderer = ctx.RendererModule;
  renderer.renderProjects = () => { throw new Error('View toggle must not re-render the project cards'); };
  renderer._cacheContainers();
  assert.equal(grid.attrs['aria-pressed'], 'true');
  list.click();
  assert.equal(saved.devspace_view, 'list');
  assert.equal(classes.has('list-view'), true);
  assert.equal(list.attrs['aria-pressed'], 'true');
  assert.equal(grid.attrs['aria-pressed'], 'false');
  grid.click();
  assert.equal(classes.has('list-view'), false);
  assert.equal(saved.devspace_view, 'grid');
});

test('pinned projects stay first across sort modes and persist locally', () => {
  const saved = {};
  const projects = [
    { id: 'a', name: 'Alpha', status: 'development', updatedAt: '2026-11-01' },
    { id: 'b', name: 'Bravo', status: 'completed', updatedAt: '2026-11-02' },
    { id: 'c', name: 'Charlie', status: 'development', updatedAt: '2026-11-03' }
  ];
  const container = { innerHTML: '' };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'projectsContainer' ? container : null; } },
    StorageService: { get(key, fallback) { return saved[key] || fallback; }, set(key, value) { saved[key] = value; } },
    StateManager: { get() { return ''; } },
    ProjectsModule: { getFilteredProjects() { return projects; } }
  });
  const renderer = ctx.RendererModule;
  renderer._renderProjectCard = p => `[${p.id}]`;
  renderer._attachProjectEvents = () => {};
  renderer._updateQuickAccess = () => {};
  renderer.containers = { projects: container };
  renderer.renderProjects();
  assert.equal(container.innerHTML, '[c][b][a]');
  renderer.togglePinned('a');
  assert.equal(container.innerHTML, '[a][c][b]');
  assert.deepEqual(Array.from(saved.pinnedProjects), ['a']);
  renderer._sortMode = 'status';
  renderer.renderProjects();
  assert.ok(container.innerHTML.startsWith('[a]'));
  renderer.togglePinned('a');
  assert.equal(renderer.isPinned('a'), false);
  assert.deepEqual(Array.from(saved.pinnedProjects), []);
});

test('focus panel summarizes pinned projects and their next incomplete checklist item', () => {
  const panel = { hidden: true };
  const focus = { innerHTML: '' };
  const projects = [
    { id: 'a', name: 'Skyward Tales', status: 'development', checklist: [
      { text: 'Готово', completed: true }, { text: 'Доделать остров', completed: false }
    ] },
    { id: 'b', name: 'Last Ritual', status: 'planning', checklist: [] }
  ];
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return { focusPanel: panel, focusProjects: focus }[id] || null; } },
    StateManager: { get() { return projects; } },
    Helpers: { escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
      getStatusText(s) { return s; }, truncateText(s) { return s; } }
  });
  const renderer = ctx.RendererModule;
  renderer._renderFocus();
  assert.equal(panel.hidden, true);
  renderer._pinnedIds = ['a'];
  renderer._renderFocus();
  assert.equal(panel.hidden, false);
  assert.match(focus.innerHTML, /Skyward Tales/);
  assert.match(focus.innerHTML, /Доделать остров/);
  assert.match(focus.innerHTML, /width:50%/);
  assert.doesNotMatch(focus.innerHTML, /Last Ritual/);
  renderer._pinnedIds = [];
  renderer._renderFocus();
  assert.equal(panel.hidden, true);
  assert.equal(focus.innerHTML, '');
});

test('focus task list includes only unfinished tasks from pinned projects and clears when unpinned', () => {
  const panel = { hidden: true }, focus = { innerHTML: '' }, taskArea = { hidden: true };
  const list = { innerHTML: '' }, count = { textContent: '' };
  const projects = [
    { id: 'a', name: 'Первый', status: 'development', checklist: [
      { text: 'Уже готово', completed: true }, { text: 'Анимации', completed: false }, { text: 'Звуки', completed: false }
    ] },
    { id: 'b', name: 'Второй', status: 'planning', checklist: [{ text: 'Не должен появиться', completed: false }] }
  ];
  const nodes = { focusPanel: panel, focusProjects: focus, focusTaskArea: taskArea, focusTaskList: list, focusTaskCount: count };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return nodes[id] || null; } },
    StateManager: { get() { return projects; } },
    Helpers: { escapeHtml(s) { return String(s); }, getStatusText(s) { return s; }, truncateText(s) { return s; } }
  });
  const renderer = ctx.RendererModule;
  renderer._pinnedIds = ['a'];
  renderer._renderFocus();
  assert.equal(taskArea.hidden, false);
  assert.equal(count.textContent, '(2)');
  assert.match(list.innerHTML, /Анимации/);
  assert.match(list.innerHTML, /Звуки/);
  assert.doesNotMatch(list.innerHTML, /Уже готово|Не должен появиться/);
  renderer._pinnedIds = [];
  renderer._renderFocus();
  assert.equal(taskArea.hidden, true);
  assert.equal(list.innerHTML, '');
});

test('focus task completion uses checklist handler without opening project details', () => {
  let handler;
  const toggled = [], opened = [];
  const focusPanel = { addEventListener(type, callback) { if (type === 'click') handler = callback; } };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'focusPanel' ? focusPanel : null; }, querySelectorAll() { return []; } },
    ChecklistModule: { toggleItem(project, task) { toggled.push([project, task]); } },
    ProjectDetailModule: { show(project) { opened.push(project); } }
  });
  ctx.RendererModule._cacheContainers();
  assert.equal(typeof handler, 'function');
  const taskButton = { dataset: { focusProjectId: 'project-a', focusComplete: 'task-1' } };
  handler({ target: { closest(selector) { return selector === '[data-focus-complete]' ? taskButton : { dataset: { focusProject: 'project-a' } }; } } });
  assert.deepEqual(toggled, [['project-a', 'task-1']]);
  assert.deepEqual(opened, []);
  handler({ target: { closest(selector) { return selector === '[data-focus-project]' ? { dataset: { focusProject: 'project-a' } } : null; } } });
  assert.deepEqual(opened, ['project-a']);
});

test('focus task list shows separate controls only for tasks with identifiers', () => {
  const nodes = { focusPanel: { hidden: true }, focusProjects: { innerHTML: '' }, focusTaskArea: { hidden: true }, focusTaskList: { innerHTML: '' } };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return nodes[id] || null; } },
    StateManager: { get() { return [{ id: 'a', name: 'Проект', checklist: [{ id: 'task-1', text: 'Сделать', completed: false }, { text: 'Без ID', completed: false }] }]; } },
    Helpers: { escapeHtml(s) { return String(s); }, getStatusText(s) { return s; }, truncateText(s) { return s; } }
  });
  ctx.RendererModule._pinnedIds = ['a'];
  ctx.RendererModule._renderFocus();
  assert.match(nodes.focusTaskList.innerHTML, /data-focus-complete="task-1"/);
  assert.match(nodes.focusTaskList.innerHTML, /aria-label="Отметить выполненной: Сделать"/);
  assert.equal((nodes.focusTaskList.innerHTML.match(/data-focus-complete=/g) || []).length, 1);
  assert.equal((nodes.focusTaskList.innerHTML.match(/data-focus-project="a"/g) || []).length, 2);
});

test('priority changes persist in checklist without changing completion', () => {
  const task = { id: 't1', text: 'Главная задача', completed: false };
  const project = { id: 'p1', checklist: [task] };
  const updates = [], events = [];
  const ctx = execute('js/modules/checklist.js', {
    StateManager: { getProject(id) { return id === 'p1' ? project : null; }, updateProject(id, changes) { updates.push([id, changes]); } },
    EventBus: { emit(name, data) { events.push([name, data]); } }
  });
  ctx.ChecklistModule._updateChecklistDOM = () => {};
  assert.equal(ctx.ChecklistModule.setPriority('p1', 't1', 'high'), true);
  assert.equal(task.priority, 'high');
  assert.equal(task.completed, false);
  assert.equal(updates.length, 1);
  assert.equal(events[0][0], 'checklist:changed');
  assert.equal(ctx.ChecklistModule.setPriority('p1', 't1', 'unknown'), false);
  assert.equal(updates.length, 1);
  assert.equal(ctx.ChecklistModule.setPriority('p1', 't1', 'normal'), true);
  assert.equal(Object.hasOwn(task, 'priority'), false);
  assert.equal(updates.length, 2);
  assert.equal(ctx.ChecklistModule.setPriority('p1', 'missing', 'high'), false);
});

test('focus tasks are sorted globally by priority and keep legacy default normal', () => {
  const nodes = { focusPanel: { hidden: true }, focusProjects: { innerHTML: '' }, focusTaskArea: { hidden: true }, focusTaskList: { innerHTML: '' }, focusTaskCount: { textContent: '' } };
  const projects = [{ id: 'a', name: 'А', checklist: [
    { id: '1', text: 'Низкая', priority: 'low' },
    { id: '2', text: 'Без приоритета' },
    { id: '3', text: 'Самая важная', priority: 'high' }
  ] }];
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return nodes[id] || null; } },
    StateManager: { get() { return projects; } },
    Helpers: { escapeHtml(s) { return String(s); }, getStatusText(s) { return s; }, truncateText(s) { return s; } }
  });
  ctx.RendererModule._pinnedIds = ['a'];
  ctx.RendererModule._renderFocus();
  const html = nodes.focusTaskList.innerHTML;
  assert.ok(html.indexOf('Самая важная') < html.indexOf('Без приоритета'));
  assert.ok(html.indexOf('Без приоритета') < html.indexOf('Низкая'));
  assert.match(html, /data-focus-priority="3"/);
  assert.match(html, /priority-high/);
  assert.equal(nodes.focusTaskCount.textContent, '(3)');
});

test('focus priority selector calls the checklist service without opening details', () => {
  const callbacks = {}, updates = [], opened = [];
  const panel = { addEventListener(name, fn) { callbacks[name] = fn; } };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'focusPanel' ? panel : null; }, querySelectorAll() { return []; } },
    ChecklistModule: { setPriority(project, task, priority) { updates.push([project, task, priority]); } },
    ProjectDetailModule: { show(id) { opened.push(id); } }
  });
  ctx.RendererModule._cacheContainers();
  const selector = { dataset: { focusProjectId: 'project-a', focusPriority: 'task-b' }, value: 'high' };
  callbacks.change({ target: { closest(query) { return query === '[data-focus-priority]' ? selector : null; } } });
  assert.deepEqual(updates, [['project-a', 'task-b', 'high']]);
  assert.deepEqual(opened, []);
});

test('checklist deadline validates calendar dates and preserves other task fields', () => {
  const task = { id: 't1', text: 'Задача', priority: 'high', completed: false };
  const project = { id: 'p1', checklist: [task] };
  const saved = [], events = [];
  const ctx = execute('js/modules/checklist.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { saved.push(patch); } },
    EventBus: { emit(name) { events.push(name); } }
  });
  const module = ctx.ChecklistModule;
  module._updateChecklistDOM = () => {};
  assert.equal(module.setDeadline('p1', 't1', '2026-02-30'), false);
  assert.equal(module.setDeadline('p1', 't1', '2026-11-17'), true);
  assert.equal(task.deadline, '2026-11-17');
  assert.equal(task.priority, 'high');
  assert.equal(task.completed, false);
  assert.equal(saved.length, 1);
  assert.deepEqual(events, ['checklist:changed']);
  assert.equal(module.setDeadline('p1', 't1', '2026-11-17'), true);
  assert.equal(saved.length, 1);
  assert.equal(module.setDeadline('p1', 't1', ''), true);
  assert.equal(Object.hasOwn(task, 'deadline'), false);
  assert.equal(module.setDeadline('p1', 'missing', '2026-11-18'), false);
});

test('deadline input routes changes to checklist service', () => {
  const callbacks = {}, changed = [];
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'focusPanel' ? { addEventListener(name, fn) { callbacks[name] = fn; } } : null; }, querySelectorAll() { return []; } },
    ChecklistModule: { setDeadline(project, task, value) { changed.push([project, task, value]); } }
  });
  ctx.RendererModule._cacheContainers();
  const control = { dataset: { focusProjectId: 'p', focusDeadline: 't' }, value: '2026-11-17' };
  callbacks.change({ target: { closest(selector) { return selector === '[data-focus-deadline]' ? control : null; } } });
  assert.deepEqual(changed, [['p', 't', '2026-11-17']]);
});

test('focus deadline summary and weekly list use local dates and hide completed tasks', () => {
  const nodes = { focusPanel: { hidden: true }, focusProjects: { innerHTML: '' }, focusTaskArea: { hidden: true }, focusTaskList: { innerHTML: '' }, focusTaskCount: { textContent: '' }, focusDeadlineSummary: { hidden: true, textContent: '' }, focusWeekArea: { hidden: true }, focusWeekList: { innerHTML: '' }, focusWeekCount: { textContent: '' } };
  const now = new Date();
  const localDate = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const tomorrow = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const projects = [{ id: 'p', name: 'Дела', checklist: [
    { id: '1', text: 'Просрочено', deadline: yesterday, completed: false },
    { id: '2', text: 'На завтра', deadline: tomorrow, completed: false },
    { id: '3', text: 'Готово', deadline: yesterday, completed: true }
  ] }];
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return nodes[id] || null; } },
    StateManager: { get() { return projects; } },
    Helpers: { escapeHtml(s) { return String(s); }, getStatusText(s) { return s; }, truncateText(s) { return s; } }
  });
  ctx.RendererModule._pinnedIds = ['p'];
  ctx.RendererModule._renderFocus();
  assert.equal(nodes.focusDeadlineSummary.hidden, false);
  assert.match(nodes.focusDeadlineSummary.textContent, /Просрочено: 1/);
  assert.equal(nodes.focusWeekArea.hidden, false);
  assert.match(nodes.focusWeekList.innerHTML, /На завтра/);
  assert.doesNotMatch(nodes.focusWeekList.innerHTML, /Готово|Просрочено/);
  assert.match(nodes.focusTaskList.innerHTML, /focus-task-overdue/);
  ctx.RendererModule._pinnedIds = [];
  ctx.RendererModule._renderFocus();
  assert.equal(nodes.focusWeekArea.hidden, true);
});

test('productivity summarizes dated completions without inventing old completion dates', () => {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 15);
  const old = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 12, 15);
  const nodes = {
    productivityPanel: { hidden: true }, productivityDone: { textContent: '' }, productivityStreak: { textContent: '' },
    productivityProgress: { textContent: '' }, productivityBarFill: { style: {} },
    productivityBar: { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } },
    productivityAchievement: { hidden: true }
  };
  const projects = [{ checklist: [
    { id: 'a', completed: true, completedAt: now.toISOString() },
    { id: 'b', completed: true, completedAt: previous.toISOString() },
    { id: 'c', completed: true, completedAt: old.toISOString() },
    { id: 'd', completed: true },
    { id: 'e', completed: false, completedAt: now.toISOString() }
  ] }];
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return nodes[id] || null; } },
    StateManager: { get() { return projects; } },
    StorageService: { get() { return 2; } }
  });
  ctx.RendererModule._renderProductivity();
  assert.equal(nodes.productivityPanel.hidden, false);
  assert.equal(nodes.productivityDone.textContent, '2');
  assert.equal(nodes.productivityStreak.textContent, '2');
  assert.equal(nodes.productivityProgress.textContent, '100%');
  assert.equal(nodes.productivityBarFill.style.width, '100%');
  assert.equal(nodes.productivityBar.attrs['aria-valuenow'], '100');
  assert.equal(nodes.productivityAchievement.hidden, false);
});

test('weekly goal validates values and stores only chosen target', () => {
  const saved = [];
  const goal = { value: '', addEventListener(name, fn) { if (name === 'change') this.changed = fn; } };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'productivityGoal' ? goal : null; }, querySelectorAll() { return []; } },
    StorageService: { get() { return 5; }, set(key, value) { saved.push([key, value]); } }
  });
  ctx.RendererModule._renderProductivity = () => {};
  ctx.RendererModule._cacheContainers();
  assert.equal(goal.value, '5');
  goal.value = '0';
  goal.changed();
  assert.equal(goal.value, '5');
  goal.value = '7';
  goal.changed();
  assert.deepEqual(saved, [['weeklyGoal', 7]]);
});

test('productivity panel hides when no project checklist has tasks', () => {
  const panel = { hidden: false };
  const ctx = execute('js/ui/renderer.js', {
    document: { getElementById(id) { return id === 'productivityPanel' ? panel : null; } },
    StateManager: { get() { return [{ id: 'p', checklist: [] }]; } }
  });
  ctx.RendererModule._renderProductivity();
  assert.equal(panel.hidden, true);
});

test('roadmap derives stage progress from linked checklist tasks without modifying legacy milestones', () => {
  const project = {
    id: 'p', milestones: ['Фундамент', 'Первый остров'], completedMilestones: ['Фундамент'],
    checklist: [{ id: 'a', text: 'Сцена', milestone: 'Первый остров', completed: true }, { id: 'b', text: 'Водопад', milestone: 'Первый остров', completed: false }]
  };
  const ctx = execute('js/modules/project-detail.js', {
    Helpers: { escapeHtml(x) { return String(x); } }, AuthService: { isOwner() { return true; } }
  });
  const html = ctx.ProjectDetailModule._renderRoadmap(project);
  assert.match(html, /Фундамент/);
  assert.match(html, /Первый остров/);
  assert.match(html, /50%/);
  assert.match(html, /Сцена/);
  assert.match(html, /Водопад/);
  assert.match(html, /data-roadmap-task="b"/);
  assert.deepEqual(project.milestones, ['Фундамент', 'Первый остров']);
});

test('roadmap task assignment validates stage names and keeps checklist flags', () => {
  const project = { id: 'p', milestones: ['Дизайн', 'Тесты'], checklist: [{ id: 't', text: 'Меню', completed: true }] };
  const saved = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, data) { saved.push(data); } },
    AuthService: { isOwner() { return true; } },
    document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.assignTaskStage('p', 't', 'Unknown'), false);
  assert.equal(roadmap.assignTaskStage('p', 't', 'Дизайн'), true);
  assert.equal(project.checklist[0].milestone, undefined);
  assert.equal(saved[0].checklist[0].milestone, 'Дизайн');
  assert.equal(saved[0].checklist[0].completed, true);
  assert.equal(saved.length, 1);
  assert.equal(roadmap.assignTaskStage('p', 't', ''), true);
  assert.equal(Object.hasOwn(saved[1].checklist[0], 'milestone'), false);
});

test('manual roadmap completion refuses stages containing linked tasks', () => {
  const project = { id: 'p', milestones: ['Разработка', 'Релиз'], completedMilestones: [], checklist: [{ id: 't', milestone: 'Разработка' }] };
  const saved = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, data) { saved.push(data); } },
    AuthService: { isOwner() { return true; } },
    document: { getElementById() { return null; } }
  });
  assert.equal(ctx.ProjectDetailModule.toggleRoadmapStage('p', 'Разработка'), false);
  assert.equal(ctx.ProjectDetailModule.toggleRoadmapStage('p', 'Релиз'), true);
  assert.equal(saved.length, 1);
  assert.deepEqual([...project.completedMilestones], []);
  assert.deepEqual([...saved[0].completedMilestones], ['Релиз']);
});

test('roadmap remains read-only without local editing enabled', () => {
  const project = { id: 'p', milestones: ['Этап'], checklist: [{ id: 't', text: 'Задача' }] };
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject() { throw Error('Must not save'); } },
    AuthService: { isOwner() { return false; } },
    Helpers: { escapeHtml(s) { return String(s); } }
  });
  assert.equal(ctx.ProjectDetailModule.assignTaskStage('p', 't', 'Этап'), false);
  assert.equal(ctx.ProjectDetailModule.toggleRoadmapStage('p', 'Этап'), false);
  assert.doesNotMatch(ctx.ProjectDetailModule._renderRoadmap(project), /data-roadmap-task|data-roadmap-stage/);
  assert.doesNotMatch(ctx.ProjectDetailModule._renderRoadmap(project), /data-roadmap-create|data-roadmap-move/);
  assert.doesNotMatch(ctx.ProjectDetailModule._renderRoadmap(project), /data-roadmap-rename|data-roadmap-task-create/);
  assert.doesNotMatch(ctx.ProjectDetailModule._renderRoadmap(project), /data-roadmap-remove/);
  assert.doesNotMatch(ctx.ProjectDetailModule._renderRoadmap(project), /data-roadmap-deadline/);
  assert.equal(ctx.ProjectDetailModule.addRoadmapStage('p', 'Новый'), false);
  assert.equal(ctx.ProjectDetailModule.moveRoadmapStage('p', 0, 'down'), false);
  assert.equal(ctx.ProjectDetailModule.renameRoadmapStage('p', 'Этап', 'Другой'), false);
  assert.equal(ctx.ProjectDetailModule.addRoadmapTask('p', 'Этап', 'Задача'), false);
  assert.equal(ctx.ProjectDetailModule.removeRoadmapStage('p', 'Этап'), false);
  assert.equal(ctx.ProjectDetailModule.setRoadmapDeadline('p', 'Этап', '2026-12-15'), false);
});

test('roadmap mutations report persistence failures without changing live project data', () => {
  const project = {
    id: 'p', milestones: ['Разработка', 'Релиз'],
    checklist: [{ id: 't1', text: 'Task', milestone: 'Разработка' }],
    completedMilestones: [], milestoneDeadlines: {}
  };
  const errors = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject() { return null; } },
    AuthService: { isOwner() { return true; } },
    NotificationModule: { error(message) { errors.push(message); } },
    document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;

  assert.equal(roadmap.addRoadmapStage('p', 'Тестирование'), false);
  assert.equal(roadmap.moveRoadmapStage('p', 0, 'down'), false);
  assert.equal(roadmap.renameRoadmapStage('p', 'Разработка', 'Реализация'), false);
  assert.equal(roadmap.removeRoadmapStage('p', 'Релиз'), false);
  assert.equal(roadmap.setRoadmapDeadline('p', 'Разработка', '2026-12-15'), false);
  assert.equal(roadmap.assignTaskStage('p', 't1', 'Релиз'), false);
  assert.equal(roadmap.toggleRoadmapStage('p', 'Релиз'), false);

  assert.deepEqual(Array.from(project.milestones), ['Разработка', 'Релиз']);
  assert.equal(project.checklist[0].milestone, 'Разработка');
  assert.deepEqual(Object.keys(project.milestoneDeadlines), []);
  assert.deepEqual(Array.from(project.completedMilestones), []);
  assert.equal(errors.length, 7);
});

test('roadmap deadlines validate calendar dates, persist by stage and allow clearing', () => {
  const project = { id: 'p', milestones: ['Разработка'], checklist: [] };
  const patches = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { patches.push(patch); Object.assign(project, patch); } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } },
    Helpers: { escapeHtml(s) { return String(s); } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.setRoadmapDeadline('p', 'Несуществующий', '2026-12-15'), false);
  assert.equal(roadmap.setRoadmapDeadline('p', 'Разработка', '2026-02-30'), false);
  assert.equal(roadmap.setRoadmapDeadline('p', 'Разработка', 'tomorrow'), false);
  assert.equal(patches.length, 0);
  assert.equal(roadmap.setRoadmapDeadline('p', 'Разработка', '2026-12-15'), true);
  assert.equal(project.milestoneDeadlines['Разработка'], '2026-12-15');
  assert.match(roadmap._renderRoadmap(project), /data-roadmap-deadline="Разработка" value="2026-12-15"/);
  assert.equal(roadmap.setRoadmapDeadline('p', 'Разработка', ''), true);
  assert.equal(Object.hasOwn(project.milestoneDeadlines, 'Разработка'), false);
});

test('project cards show next unfinished milestone and actual completed count from linked tasks', () => {
  const ctx = execute('js/ui/renderer.js', { Helpers: { escapeHtml(s) { return String(s); }, truncateText(s) { return s; } } });
  const project = { milestones: ['Первый', 'Второй', 'Третий'], completedMilestones: ['Третий'], checklist: [{ id: 1, milestone: 'Первый', completed: true }, { id: 2, milestone: 'Второй', completed: false }] };
  const html = ctx.RendererModule._roadmapCardSummary(project);
  assert.match(html, /2\/3/);
  assert.match(html, /Следующий этап/);
  assert.match(html, /Второй/);
  assert.doesNotMatch(html, /roadmap-card-late/);
  assert.equal(ctx.RendererModule._roadmapCardSummary({ milestones: [] }), '');
});

test('project card marks overdue next stage and escapes its title', () => {
  const ctx = execute('js/ui/renderer.js', { Helpers: { escapeHtml(s) { return String(s).replace(/</g, '&lt;'); }, truncateText(s) { return s; } } });
  const html = ctx.RendererModule._roadmapCardSummary({ milestones: ['<Дизайн>'], milestoneDeadlines: { '<Дизайн>': '2020-01-01' } });
  assert.match(html, /roadmap-card-late/);
  assert.match(html, /Просрочено · 01\.01\.2020/);
  assert.match(html, /&lt;Дизайн>/);
  assert.doesNotMatch(html, /<Дизайн>/);
});

test('roadmap stage rename moves deadline and removal cleans it without touching tasks', () => {
  const project = { id: 'p', milestones: ['Старый', 'Другой'], milestoneDeadlines: { Старый: '2026-11-01', Другой: '2026-12-31' }, checklist: [{ id: 1, milestone: 'Старый', completed: false }] };
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { Object.assign(project, patch); } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.renameRoadmapStage('p', 'Старый', 'Новый'), true);
  assert.equal(project.milestoneDeadlines['Новый'], '2026-11-01');
  assert.equal(Object.hasOwn(project.milestoneDeadlines, 'Старый'), false);
  assert.equal(project.milestoneDeadlines['Другой'], '2026-12-31');
  assert.equal(roadmap.removeRoadmapStage('p', 'Новый'), true);
  assert.equal(Object.hasOwn(project.milestoneDeadlines, 'Новый'), false);
  assert.equal(project.checklist.length, 1);
});

test('roadmap summary averages stages and reports accessible progress without mutating project', () => {
  const project = { id: 'p', milestones: ['Готово', 'Работа', 'Позже'], completedMilestones: ['Готово'], checklist: [{ id: 1, milestone: 'Работа', completed: true }, { id: 2, milestone: 'Работа', completed: false }] };
  const ctx = execute('js/modules/project-detail.js', {
    Helpers: { escapeHtml(s) { return String(s); } }, AuthService: { isOwner() { return false; } }
  });
  const html = ctx.ProjectDetailModule._renderRoadmap(project);
  assert.match(html, /Общий прогресс/);
  assert.match(html, /aria-valuenow="50"/);
  assert.match(html, /50% · 3 этапов/);
  assert.equal(project.checklist[0].completed, true);
});

test('removing roadmap stage keeps tasks and their completion but clears stage assignment', () => {
  const project = { id: 'p', milestones: ['Дизайн', 'Релиз'], completedMilestones: ['Дизайн'], checklist: [{ id: 1, milestone: 'Дизайн', text: 'Макет', completed: true, priority: 'high' }, { id: 2, milestone: 'Релиз', completed: false }] };
  const patches = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { patches.push(patch); Object.assign(project, patch); } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.removeRoadmapStage('p', 'Не существует'), false);
  assert.equal(roadmap.removeRoadmapStage('p', 'Дизайн'), true);
  assert.deepEqual([...project.milestones], ['Релиз']);
  assert.equal(project.checklist.length, 2);
  assert.equal(Object.hasOwn(project.checklist[0], 'milestone'), false);
  assert.equal(project.checklist[0].text, 'Макет');
  assert.equal(project.checklist[0].completed, true);
  assert.equal(project.checklist[0].priority, 'high');
  assert.equal(project.checklist[1].milestone, 'Релиз');
  assert.deepEqual([...project.completedMilestones], []);
  assert.equal(patches.length, 1);
});

test('roadmap rename updates linked checklist and manual completion in one patch', () => {
  const project = { id: 'p', milestones: ['Дизайн', 'Релиз'], completedMilestones: ['Дизайн'], checklist: [{ id: 't', text: 'Макет', milestone: 'Дизайн', completed: true }] };
  const writes = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { writes.push(patch); Object.assign(project, patch); } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.renameRoadmapStage('p', 'Дизайн', ' Релиз '), false);
  assert.equal(roadmap.renameRoadmapStage('p', 'Дизайн', ''), false);
  assert.equal(roadmap.renameRoadmapStage('p', 'Нет', 'UI'), false);
  assert.equal(roadmap.renameRoadmapStage('p', 'Дизайн', ' Интерфейс '), true);
  assert.deepEqual([...project.milestones], ['Интерфейс', 'Релиз']);
  assert.equal(project.checklist[0].milestone, 'Интерфейс');
  assert.equal(project.checklist[0].completed, true);
  assert.deepEqual([...project.completedMilestones], ['Интерфейс']);
  assert.equal(writes.length, 1);
});

test('roadmap creates checklist tasks only for a valid stage and links returned id', () => {
  const project = { id: 'p', milestones: ['Фундамент'], checklist: [] };
  const calls = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { calls.push(patch); } },
    ChecklistModule: { addItem(id, name) { calls.push({ name }); const item = { id: 14, text: name, completed: false }; project.checklist.push(item); return item; } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.addRoadmapTask('p', 'Чужой этап', 'Тест'), false);
  assert.equal(roadmap.addRoadmapTask('p', 'Фундамент', ' '), false);
  assert.equal(roadmap.addRoadmapTask('p', 'Фундамент', 'x'.repeat(241)), false);
  assert.equal(calls.length, 0);
  assert.equal(roadmap.addRoadmapTask('p', 'Фундамент', '  Проверить сборку '), true);
  assert.equal(project.checklist[0].text, 'Проверить сборку');
  assert.equal(project.checklist[0].milestone, undefined);
  assert.equal(calls[1].checklist[0].milestone, 'Фундамент');
  assert.equal(calls.length, 2);
});

test('roadmap can add distinct stages without changing checklist or completed stages', () => {
  const project = { id: 'p', milestones: ['Дизайн'], completedMilestones: ['Дизайн'], checklist: [{ id: 1, text: 'Меню' }] };
  const saved = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { saved.push(patch); project.milestones = patch.milestones; } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } },
    Helpers: { escapeHtml(s) { return String(s); } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.addRoadmapStage('p', '  Разработка  '), true);
  assert.equal(roadmap.addRoadmapStage('p', 'разработка'), false);
  assert.equal(roadmap.addRoadmapStage('p', '  '), false);
  assert.equal(roadmap.addRoadmapStage('p', 'x'.repeat(101)), false);
  assert.deepEqual([...project.milestones], ['Дизайн', 'Разработка']);
  assert.deepEqual(project.completedMilestones, ['Дизайн']);
  assert.equal(project.checklist[0].text, 'Меню');
  assert.equal(saved.length, 1);
  assert.match(roadmap._renderRoadmap(project), /data-roadmap-create/);
});

test('roadmap stage reordering preserves task links by name and rejects invalid moves', () => {
  const project = { id: 'p', milestones: ['А', 'Б', 'В'], checklist: [{ id: 1, milestone: 'Б', completed: true }] };
  const saved = [];
  const ctx = execute('js/modules/project-detail.js', {
    StateManager: { getProject() { return project; }, updateProject(id, patch) { saved.push(patch); project.milestones = patch.milestones; } },
    AuthService: { isOwner() { return true; } }, document: { getElementById() { return null; } }
  });
  const roadmap = ctx.ProjectDetailModule;
  assert.equal(roadmap.moveRoadmapStage('p', 1, 'up'), true);
  assert.deepEqual([...project.milestones], ['Б', 'А', 'В']);
  assert.equal(project.checklist[0].milestone, 'Б');
  assert.equal(roadmap.moveRoadmapStage('p', 0, 'up'), false);
  assert.equal(roadmap.moveRoadmapStage('p', 2, 'down'), false);
  assert.equal(roadmap.moveRoadmapStage('p', 1.5, 'down'), false);
  assert.equal(roadmap.moveRoadmapStage('p', 0, 'sideways'), false);
  assert.equal(saved.length, 1);
});

test('public page loads only vendor SDKs that it actually uses', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'js/core/sync.js'), 'utf8');
  for (const unused of ['typed.js@', 'firebase-auth-compat.js', '@supabase/supabase-js@']) {
    assert.ok(!html.includes(unused), `${unused} should not load on a public page`);
  }
  assert.ok(!html.includes('firebase-app-compat.js'), 'Firebase must not delay the first paint');
  assert.ok(!html.includes('firebase-firestore-compat.js'), 'Firestore must not delay the first paint');
  assert.ok(sync.includes('firebase-app-compat.js'));
  assert.ok(sync.includes('firebase-firestore-compat.js'));
  assert.ok(html.includes('aos.js'));
  assert.ok(!app.includes('new Typed('));
});

test('all external scripts load in parallel while preserving execution order', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
  assert.ok(scripts.length >= 35);
  for (const [tag, src] of scripts) {
    assert.match(tag, /\sdefer(?:\s|>)/, `${src} should not block HTML parsing`);
    assert.doesNotMatch(tag, /\sasync(?:\s|>)/, `${src} must retain dependency order`);
  }
  const sources = scripts.map(match => match[1]);
  assert.ok(sources.indexOf('js/core/state.js?v=3.66.24') < sources.indexOf('js/app.js?v=3.66.24'));
  assert.ok(sources.indexOf('js/core/sync.js?v=3.66.24') < sources.indexOf('js/app.js?v=3.66.24'));
});

test('Firebase cloud read starts after idle, loads SDKs in order, and never runs in local mode', async () => {
  const injected = [];
  const idle = [];
  const sync = execute('js/core/sync.js', {
    document: {
      getElementById() { return { textContent: '' }; },
      createElement() { return {}; },
      head: { appendChild(script) { injected.push(script); } }
    },
    addEventListener() {},
    requestIdleCallback(callback) { idle.push(callback); },
    LocalStorageService: { get(key, fallback) { return Promise.resolve(key === 'settings' ? { syncMode: 'read-only' } : fallback); } },
    FirebaseService: { _initialized: false, init() { this._initialized = true; return Promise.resolve(); } }
  });
  let cloudReads = 0;
  sync.SyncModule._syncFromCloud = () => { cloudReads++; return Promise.resolve(); };
  const pending = sync.SyncModule.init();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(injected.length, 0);
  assert.equal(cloudReads, 0);
  assert.equal(idle.length, 1);
  idle[0]();
  assert.match(injected[0].src, /firebase-app-compat\.js$/);
  injected[0].onload();
  assert.match(injected[1].src, /firebase-firestore-compat\.js$/);
  injected[1].onload();
  await pending;
  assert.equal(cloudReads, 1);

  const local = execute('js/core/sync.js', {
    addEventListener() {},
    document: { getElementById() { return null; } },
    LocalStorageService: { get(key, fallback) { return Promise.resolve(key === 'settings' ? { syncMode: 'local' } : fallback); } },
    FirebaseService: { init() { throw Error('Local mode should never fetch SDK'); } }
  });
  await local.SyncModule.init();
  assert.equal(local.SyncModule._mode, 'local');
  assert.equal(local.SyncModule._sdkPromise, null);
});

test('sync binds one online reconnect handler during initialization', async () => {
  const listeners = {};
  const idle = [];
  const ctx = execute('js/core/sync.js', {
    addEventListener(name, callback) {
      listeners[name] = listeners[name] || [];
      listeners[name].push(callback);
    },
    requestIdleCallback(callback) { idle.push(callback); },
    document: { getElementById() { return null; } },
    LocalStorageService: {
      get(key, fallback) {
        return Promise.resolve(key === 'settings' ? { syncMode: 'local' } : fallback);
      }
    },
    FirebaseService: { _initialized: false }
  });
  let syncCalls = 0;
  ctx.SyncModule._syncFromCloud = () => { syncCalls++; return Promise.resolve(); };

  await ctx.SyncModule.init();
  await ctx.SyncModule.init();
  assert.equal(listeners.online.length, 1);
  listeners.online[0]();
  assert.equal(syncCalls, 1);
});

test('local storage getAll resolves values instead of returning nested promises', async () => {
  const values = new Map();
  const ctx = execute('js/services/localStorage.js', {
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    }
  });
  const storage = ctx.LocalStorageService;
  await storage.set('projects', [{ id: 'p1' }]);
  await storage.set('theme', 'dark');
  const all = await storage.getAll();
  assert.deepEqual(JSON.parse(JSON.stringify(all.projects)), [{ id: 'p1' }]);
  assert.equal(all.theme, 'dark');
  assert.equal(all.settings, null);
  assert.equal(all.last_sync, null);
});

test('decorative particles are fetched only after idle on capable screens', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.ok(!html.includes('particles.min.js'), 'particle script must not block page parsing');
  assert.ok(app.includes("window.requestIdleCallback(loadParticles"));
  assert.ok(app.includes('!prefersReducedMotion && !compactViewport'));
  assert.ok(app.includes('if (document.hidden) return;'));
  assert.ok(app.includes("script.onload = startParticles"));
});

test('tracker never intercepts native browser new-window or text-undo shortcuts', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const projects = fs.readFileSync(path.join(root, 'js/modules/projects.js'), 'utf8');
  assert.ok(!app.includes("e.ctrlKey && e.key === 'n'"));
  assert.ok(!projects.includes("e.ctrlKey && e.key === 'n'"));
  assert.ok(!projects.includes("e.ctrlKey && e.key === 'z'"));
});

test('scroll controls honour reduced motion and expose an accessible name', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.match(html, /id="scrollTopBtn"[^>]+aria-label="Наверх"/);
  assert.ok((app.match(/reduceMotion \? 'instant' : 'smooth'/g) || []).length >= 2);
});

test('mobile menu announces its state, supports Escape and fits the viewport', () => {
  const navigation = fs.readFileSync(path.join(root, 'js/portfolio-nav.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/components/navbar.css'), 'utf8');
  assert.ok(navigation.includes('shown.bs.collapse'));
  assert.ok(navigation.includes('hidden.bs.collapse'));
  assert.ok(navigation.includes('Закрыть меню навигации'));
  assert.ok(navigation.includes("event.key !== 'Escape'"));
  assert.ok(navigation.includes('toggler.focus()'));
  assert.ok(css.includes('max-height: calc(100dvh - 92px)'));
  assert.ok(css.includes('overscroll-behavior: contain'));
});

test('project story keeps the active section tab visible in narrow viewports', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  assert.ok(source.includes("button.closest('.showcase-section-nav')"));
  assert.ok(source.includes('nav.scrollWidth > nav.clientWidth'));
  assert.ok(source.includes('active && !wasActive'));
  assert.ok(source.includes('buttonRect.left - navRect.left'));
  assert.ok(source.includes("behavior: 'auto'"));
});

test('mobile gallery only swipes from the image and explains touch controls', () => {
  const script = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(script.includes("event.target.closest('.portfolio-gallery-stage figure')"));
  assert.ok(html.includes('Листайте свайпом'));
  assert.ok(html.includes('aria-keyshortcuts="ArrowLeft"'));
  assert.ok(html.includes('aria-keyshortcuts="ArrowRight"'));
  assert.ok(css.includes('touch-action:pan-y pinch-zoom'));
});

test('screenshot viewer distinguishes loading, loaded and failed images', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(html.includes('id="portfolioGalleryLoading"'));
  assert.ok(html.includes('Загружаем скриншот'));
  assert.ok(script.includes('pendingImage.onload = () =>'));
  assert.ok(script.includes('pendingImage.onerror = () =>'));
  assert.ok(script.includes('imageLoading.hidden = false'));
  assert.ok(script.includes('imageLoading.hidden = true'));
  assert.ok(css.includes('.portfolio-gallery-loading[hidden]'));
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
  assert.ok(html.includes('<script src="js/portfolio.js?v=3.66.24" defer></script>'));
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
  assert.ok(html.includes('src="js/github-metadata.js?v=3.66.24"'));
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
  assert.ok(html.includes('src="js/portfolio-gallery.js?v=3.66.24"'));
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
  const attributes = {};
  const button = { style: {}, setAttribute(name, value) { attributes[name] = value; }, classList: { toggle() {} } };
  const document = {
    getElementById: id => id === 'authBtn' ? button : null,
    querySelectorAll: () => []
  };
  const ctx = execute('js/services/auth.js', { localStorage, document, confirm: () => true });
  ctx.AuthService.init();
  assert.equal(storage.has('devspace_auth_key'), false);
  assert.equal(ctx.AuthService.isOwner(), false);
  assert.equal(attributes['aria-pressed'], 'false');
  ctx.AuthService._showLoginDialog();
  assert.equal(ctx.AuthService.isOwner(), true);
  assert.equal(storage.get('devspace_local_edit_mode'), 'enabled');
  assert.match(button.title, /локальные правки/);
  assert.equal(attributes['aria-pressed'], 'true');
  assert.match(button.innerHTML, /Правки: вкл\./);
  ctx.AuthService.logout();
  assert.equal(ctx.AuthService.isOwner(), false);
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(storage.has('devspace_local_edit_mode'), false);
  const source = fs.readFileSync(path.join(root, 'js/services/auth.js'), 'utf8');
  assert.doesNotMatch(source, /_secretKey\s*:/);
});

test('activity actor distinguishes Google identity from local browser editing', () => {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const ctx = execute('js/services/auth.js', {
    localStorage,
    window: { crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' } },
    document: { getElementById: () => null, querySelectorAll: () => [] }
  });
  const service = ctx.AuthService;
  service.init();
  const guest = service.getActivityActor();
  assert.equal(guest.type, 'anonymous');
  assert.equal(guest.name, 'Гость (локально)');
  service.login();
  const local = service.getActivityActor();
  assert.equal(local.type, 'local-editor');
  assert.equal(local.id, guest.id);
  assert.equal(local.name, 'Локальный редактор');
  ctx.FirebaseIdentityModule = { _user: { uid: 'uid-1', displayName: '<Admin>', email: 'admin@example.com', photoURL: 'https://example.com/avatar.png' } };
  const google = service.getActivityActor();
  assert.equal(google.id, 'google:uid-1');
  assert.equal(google.name, '<Admin>');
  assert.equal(google.email, 'admin@example.com');
  assert.equal(google.type, 'google');
});

test('task activity stores an immutable actor snapshot and escapes actor display', () => {
  const project = { id: 'p', checklist: [{ id: 't', text: 'Task', completed: false }] };
  const actor = { id: 'google:uid-1', name: '<Admin>', email: 'admin@example.com', photoURL: '', type: 'google' };
  const ctx = execute('js/modules/checklist.js', {
    StateManager: { getProject: () => project, updateProject() {} },
    EventBus: { emit() {} },
    Helpers: { generateId: () => 'event-1', escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') },
    AuthService: { isOwner: () => true, getActivityActor: () => actor },
    NotificationModule: { success() {}, warning() {} }
  });
  ctx.ChecklistModule._updateChecklistDOM = () => {};
  assert.equal(ctx.ChecklistModule.updateText('p', 't', 'Changed'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(project.taskActivity[0].actor)), actor);
  actor.name = 'Changed after the event';
  assert.equal(project.taskActivity[0].actor.name, '<Admin>');
  const detail = execute('js/modules/project-detail.js', {
    Helpers: { escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
  }).ProjectDetailModule;
  const html = detail._renderTaskActivity(project);
  assert.match(html, /&lt;Admin&gt;/);
  assert.match(html, /admin@example\.com/);
  assert.match(html, /Google/);
  assert.doesNotMatch(html, /<Admin>/);
});

test('mobile navigation is labelled and collapses after in-page navigation', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/portfolio-nav.js'), 'utf8');
  assert.ok(html.includes('aria-controls="navbarContent"'));
  assert.ok(html.includes('aria-label="Открыть меню навигации"'));
  assert.ok(html.includes('src="js/portfolio-nav.js?v=3.66.24"'));
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

test('project stories update browser title and offer a safe shareable deep link', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(source.includes('const portfolioTitle = document.title'));
  assert.ok(source.includes('document.title = portfolioTitle'));
  assert.ok(source.includes('document.title = `${project.title} | DevSpace`'));
  assert.ok(source.includes('navigator.clipboard.writeText(window.location.href)'));
  assert.ok(source.includes("shareStatus.setAttribute('role', 'status')"));
  assert.ok(source.includes('Не удалось скопировать'));
  assert.ok(css.includes('.showcase-share:focus-visible'));
});

test('project section navigation tracks scroll position and follows visual order', () => {
  const source = fs.readFileSync(path.join(root, 'js/portfolio.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.ok(source.includes("shell.addEventListener('scroll'"));
  assert.ok(source.includes('requestAnimationFrame('));
  assert.ok(source.includes("button.setAttribute('aria-current', 'location')"));
  assert.ok(source.includes("button.removeAttribute('aria-current')"));
  assert.ok(source.includes('content.append(header, sectionNav, main, section, loop, journey, related)'));
  assert.ok(css.includes('.showcase-section-link.is-active'));
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

test('3.66.24 cache, HTML fallback and visible application version are aligned', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(app.includes("version: '3.66.24'"));
  assert.ok(worker.includes("const CACHE_VERSION = 'devspace-v3.66.24'"));
  assert.ok(html.includes('id="appVersion">v3.66.24</span>'));
});

test('every local script and stylesheet is versioned and included in offline precache', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const resources = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+)(\?v=[^"]+)?"/g)];
  assert.ok(resources.length > 40);
  for (const [, file, version] of resources) {
    assert.equal(version, '?v=3.66.24', `${file} is not versioned`);
    assert.ok(worker.includes(`'${file}'`), `${file} is not precached`);
  }
  assert.ok(worker.includes("const ASSET_VERSION = '3.66.24'"));
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
  assert.ok(js.includes('pendingImage.onerror = () =>'));
  assert.ok(js.includes('imageError.hidden = false'));
  assert.ok(js.includes('imageError.hidden = true'));
  assert.ok(css.includes('.portfolio-gallery-unavailable[hidden]'));
  assert.ok(css.includes('.portfolio-gallery-stage { position:relative;display:flex;'));
  assert.ok(css.includes('#portfolioGalleryPrev { left:calc(50% - 55px); }'));
});

test('gallery ignores late loads and failures after rapid navigation or close', () => {
  const handlers = new Map();
  const images = [];
  const elements = Object.fromEntries([
    'portfolioGalleryViewer', 'portfolioGalleryImage', 'portfolioGalleryLoading',
    'portfolioGalleryError', 'portfolioGalleryRetry', 'portfolioGalleryCaption', 'portfolioGalleryCount',
    'portfolioGalleryOriginal', 'portfolioGalleryClose', 'portfolioGalleryPrev',
    'portfolioGalleryNext'
  ].map(id => [id, {
    hidden: id === 'portfolioGalleryViewer',
    addEventListener(type, fn) { handlers.set(`${id}:${type}`, fn); },
    removeAttribute(key) { delete this[key]; },
    focus() {},
    contains() { return false; }
  }]));
  const anchor = (src) => ({ href: src, querySelector(selector) {
    return selector === 'img' ? { alt: src } : { textContent: src };
  } });
  const links = [anchor('/first.png'), anchor('/second.png')];
  const gallery = { querySelectorAll() { return links; } };
  links.forEach(link => {
    link.closest = selector => selector.includes('gallery-item') ? link : gallery;
  });
  const document = {
    body: { children: [elements.portfolioGalleryViewer], classList: { add() {}, remove() {} } },
    getElementById(id) { return elements[id]; },
    addEventListener(type, fn) { handlers.set(`document:${type}`, fn); }
  };
  class PendingImage { constructor() { images.push(this); } }
  execute('js/portfolio-gallery.js', { document, Image: PendingImage });

  handlers.get('document:click')({
    defaultPrevented: false, button: 0, target: { closest() { return links[0]; } },
    preventDefault() {}
  });
  assert.equal(images.length, 1);
  handlers.get('portfolioGalleryNext:click')();
  assert.equal(images.length, 2);
  images[0].onerror();
  assert.equal(elements.portfolioGalleryError.hidden, true);
  assert.equal(elements.portfolioGalleryLoading.hidden, false);
  images[1].onload();
  assert.equal(elements.portfolioGalleryImage.src, '/second.png');
  assert.equal(elements.portfolioGalleryLoading.hidden, true);
  images[0].onload();
  assert.equal(elements.portfolioGalleryImage.src, '/second.png');
  handlers.get('portfolioGalleryPrev:click')();
  images[2].onerror();
  assert.equal(elements.portfolioGalleryError.hidden, false);
  assert.equal(elements.portfolioGalleryRetry.hidden, false);
  handlers.get('portfolioGalleryRetry:click')();
  assert.equal(images.length, 4);
  images[3].onload();
  assert.equal(elements.portfolioGalleryError.hidden, true);
  assert.equal(elements.portfolioGalleryRetry.hidden, true);
  handlers.get('portfolioGalleryClose:click')();
  images[3].onerror();
  assert.equal(elements.portfolioGalleryError.hidden, true);
  assert.equal(elements.portfolioGalleryViewer.hidden, true);
});

test('gallery offers an accessible retry after a failed image download', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
  assert.match(html, /id="portfolioGalleryRetry"[^>]+hidden>Повторить загрузку/);
  assert.ok(js.includes("retryButton.addEventListener('click', display)"));
  assert.ok(js.includes('retryButton.hidden = false'));
  assert.ok(js.includes('retryButton.hidden = true'));
  assert.ok(js.includes('prev, next, retryButton, original'));
  assert.ok(css.includes('.portfolio-gallery-retry[hidden]'));
});

test('adjacent preloading respects metered connections and stays bounded', () => {
  const js = fs.readFileSync(path.join(root, 'js/portfolio-gallery.js'), 'utf8');
  assert.ok(js.includes("connection.effectiveType !== '4g'"));
  assert.ok(js.includes('connection.saveData'));
  assert.ok(js.includes("window.matchMedia('(min-width: 900px)').matches"));
  assert.ok(js.includes('request !== imageRequest'));
  assert.ok(js.includes('prefetchedImage = null'));
  assert.ok(js.includes('pendingImage.complete && pendingImage.naturalWidth > 0'));
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

test('manual cloud upload is gated by backup, a selected project and fresh remote read', async () => {
  const elements = {
    cloudMigrationProjectSelect: {
      value: 'one', disabled: false, replaceChildren() {},
      appendChild() {}, addEventListener() {}
    },
    cloudMigrationPreviewStatus: { textContent: '' },
    cloudIdentityBtn: { textContent: '', title: '', setAttribute() {} },
    cloudMigrationPreviewBtn: { disabled: false },
    cloudMigrationUploadBtn: { disabled: true }
  };
  let reads = 0;
  let writes = 0;
  const user = { uid: 'uid1', email: 'owner@example.com' };
  const local = [{ id: 'one', name: 'Первый' }, { id: 'two', name: 'Второй' }];
  const ctx = execute('js/services/firebase-identity.js', {
    confirm: () => true,
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => ({ value: '', textContent: '' })
    },
    FirebaseService: {
      getPrivateProjectPreview: () => { reads++; return Promise.resolve([]); },
      createPrivateProjectIfAbsent: (project, uid) => {
        writes++;
        assert.equal(project.id, 'one');
        assert.equal(uid, 'uid1');
        return Promise.resolve(true);
      }
    },
    StateManager: { get: () => local },
    SyncModule: {
      _prepareSinglePrivateMigration: (id, localProjects, remoteProjects) =>
        remoteProjects.some(p => p.id === id) ? null : localProjects.find(p => p.id === id)
    }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: user };
  identity._user = user;
  identity._ready = true;
  identity._eligibleUploads = [{ id: 'one', name: 'Первый' }];
  assert.equal(await identity.uploadOneProject(), false);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  identity._backupReady = true;
  assert.equal(await identity.uploadOneProject(), true);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.match(elements.cloudMigrationPreviewStatus.textContent, /Один проект/);
  assert.equal(local.length, 2);
});

test('manual upload refuses a new remote conflict without writing', async () => {
  const elements = {
    cloudMigrationProjectSelect: { value: 'one', replaceChildren() {}, appendChild() {}, addEventListener() {} },
    cloudMigrationPreviewStatus: { textContent: '' },
    cloudIdentityBtn: { setAttribute() {} },
    cloudMigrationPreviewBtn: {},
    cloudMigrationUploadBtn: {}
  };
  let writes = 0;
  const ctx = execute('js/services/firebase-identity.js', {
    confirm: () => true,
    document: {
      getElementById: id => elements[id] || null,
      createElement: () => ({})
    },
    FirebaseService: {
      getPrivateProjectPreview: () => Promise.resolve([{ id: 'one' }]),
      createPrivateProjectIfAbsent: () => { writes++; return Promise.resolve(true); }
    },
    StateManager: { get: () => [{ id: 'one', name: 'Локальный' }] },
    SyncModule: { _prepareSinglePrivateMigration: () => null }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: { uid: 'uid1' } };
  identity._user = identity._auth.currentUser;
  identity._ready = true;
  identity._backupReady = true;
  identity._eligibleUploads = [{ id: 'one', name: 'Локальный' }];
  assert.equal(await identity.uploadOneProject(), false);
  assert.equal(writes, 0);
  assert.match(elements.cloudMigrationPreviewStatus.textContent, /отменена/);
});

test('private creation reports rule rejection without touching local projects', async () => {
  const user = { uid: 'uid1' };
  const ctx = execute('js/services/firebase.js', {
    firebase: {
      auth: () => ({ currentUser: user }),
      firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => ({}) } })
    }
  });
  const service = ctx.FirebaseService;
  let transactionCalls = 0;
  service._db = {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
    runTransaction: () => {
      transactionCalls++;
      return Promise.reject({ code: 'permission-denied' });
    }
  };
  const project = { id: 'one', name: 'Local original' };
  const before = JSON.stringify(project);
  assert.equal(await service.createPrivateProjectIfAbsent(project, 'uid1'), false);
  assert.equal(transactionCalls, 1);
  assert.equal(service._lastPrivateCreateError, 'permission-denied');
  assert.match(service._describePrivateCreateError(service._lastPrivateCreateError), /правила/);
  assert.equal(JSON.stringify(project), before);
});

test('private creation reports an existing document and never sets it', async () => {
  const user = { uid: 'uid1' };
  const ctx = execute('js/services/firebase.js', {
    firebase: {
      auth: () => ({ currentUser: user }),
      firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => ({}) } })
    }
  });
  const service = ctx.FirebaseService;
  let writes = 0;
  service._db = {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
    runTransaction: transactionFn => transactionFn({
      get: () => Promise.resolve({ exists: true }),
      set: () => { writes++; }
    })
  };
  assert.equal(await service.createPrivateProjectIfAbsent({ id: 'one' }, 'uid1'), false);
  assert.equal(service._lastPrivateCreateError, 'already-exists');
  assert.equal(writes, 0);
});

test('one cloud project can be imported without replacing other local projects', async () => {
  const local = [{ id: 'local', name: 'Существующий' }];
  const elements = {
    cloudIdentityBtn: { setAttribute() {} },
    cloudMigrationPreviewStatus: { textContent: '' },
    cloudMigrationDownloadSelect: { value: 'remote', replaceChildren() {}, appendChild() {}, addEventListener() {} },
    cloudMigrationDownloadBtn: {}, cloudMigrationPreviewBtn: {}, cloudMigrationUploadBtn: {}
  };
  const remote = { id: 'remote', name: 'Из облака' };
  let writes = 0;
  const ctx = execute('js/services/firebase-identity.js', {
    confirm: () => true,
    document: { getElementById: id => elements[id] || null, createElement: () => ({}) },
    FirebaseService: {
      getPrivateProjectPreview: () => Promise.resolve([remote]),
      _preparePrivateProjectEnvelope: project => ({ payload: JSON.stringify(project) })
    },
    StateManager: {
      get: () => local,
      addProject: project => { writes++; local.unshift(project); }
    }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: { uid: 'owner' } };
  identity._user = identity._auth.currentUser;
  identity._ready = true;
  identity._backupReady = true;
  identity._eligibleDownloads = [remote];
  assert.equal(await identity.downloadOneProject(), true);
  assert.equal(writes, 1);
  assert.deepEqual(local.map(project => project.id), ['remote', 'local']);
});

test('cloud download refuses a local ID conflict without replacing data', async () => {
  const local = [{ id: 'remote', name: 'Моя версия' }];
  const elements = {
    cloudIdentityBtn: { setAttribute() {} },
    cloudMigrationPreviewStatus: { textContent: '' },
    cloudMigrationDownloadSelect: { value: 'remote', replaceChildren() {}, appendChild() {}, addEventListener() {} }
  };
  let writes = 0;
  const remote = { id: 'remote', name: 'Облачная версия' };
  const ctx = execute('js/services/firebase-identity.js', {
    confirm: () => true,
    document: { getElementById: id => elements[id] || null, createElement: () => ({}) },
    FirebaseService: { getPrivateProjectPreview: () => Promise.resolve([remote]) },
    StateManager: { get: () => local, addProject: () => { writes++; } }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: { uid: 'owner' } };
  identity._user = identity._auth.currentUser;
  identity._ready = true;
  identity._backupReady = true;
  identity._eligibleDownloads = [remote];
  assert.equal(await identity.downloadOneProject(), false);
  assert.equal(writes, 0);
  assert.equal(local[0].name, 'Моя версия');
});

test('batch migration creates missing projects sequentially after a fresh check', async () => {
  const local = [{ id: 'one', name: 'Первый' }, { id: 'two', name: 'Второй' }];
  const elements = { cloudIdentityBtn: { setAttribute() {} }, cloudMigrationPreviewStatus: { textContent: '' } };
  const written = [];
  const ctx = execute('js/services/firebase-identity.js', {
    confirm: () => true,
    document: { getElementById: id => elements[id] || null },
    FirebaseService: {
      getPrivateProjectPreview: () => Promise.resolve([]),
      createPrivateProjectIfAbsent: project => { written.push(project.id); return Promise.resolve(true); }
    },
    StateManager: { get: () => local },
    SyncModule: { _prepareSinglePrivateMigration: (id, projects) => projects.find(project => project.id === id) }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: { uid: 'owner' } };
  identity._user = identity._auth.currentUser;
  identity._ready = true;
  identity._backupReady = true;
  identity._eligibleUploads = local.map(project => ({ ...project }));
  assert.equal(await identity.uploadRemainingProjects(), true);
  assert.deepEqual(written, ['one', 'two']);
  assert.match(elements.cloudMigrationPreviewStatus.textContent, /сохранено 2 из 2/);
});

test('batch migration stops on the first rejected create and never overwrites', async () => {
  const local = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const elements = { cloudIdentityBtn: { setAttribute() {} }, cloudMigrationPreviewStatus: { textContent: '' } };
  const attempts = [];
  const service = {
    _lastPrivateCreateError: 'permission-denied',
    _describePrivateCreateError: () => 'Доступ запрещён',
    getPrivateProjectPreview: () => Promise.resolve([]),
    createPrivateProjectIfAbsent: project => {
      attempts.push(project.id);
      return Promise.resolve(project.id !== 'two');
    }
  };
  const ctx = execute('js/services/firebase-identity.js', {
    confirm: () => true,
    document: { getElementById: id => elements[id] || null },
    FirebaseService: service,
    StateManager: { get: () => local },
    SyncModule: { _prepareSinglePrivateMigration: (id, projects) => projects.find(project => project.id === id) }
  });
  const identity = ctx.FirebaseIdentityModule;
  identity._auth = { currentUser: { uid: 'owner' } };
  identity._user = identity._auth.currentUser;
  identity._ready = true;
  identity._backupReady = true;
  identity._eligibleUploads = local;
  assert.equal(await identity.uploadRemainingProjects(), false);
  assert.deepEqual(attempts, ['one', 'two']);
  assert.match(elements.cloudMigrationPreviewStatus.textContent, /Остановлено после 1/);
});
test('workspace navigation separates cloud, projects, planning and analytics', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css/workspace.css'), 'utf8');
    const module = fs.readFileSync(path.join(__dirname, '..', 'js/ui/workspace-view.js'), 'utf8');
    assert.match(html, /id="workspaceSwitcher"/);
    for (const view of ['overview', 'projects', 'planning', 'cloud', 'analytics']) {
        assert.match(html, new RegExp('data-workspace-view="' + view + '"'));
    }
    assert.match(html, /id="cloudWorkspacePanel"/);
    assert.match(css, /data-workspace-view="cloud"/);
    assert.match(module, /devspace_workspace_view/);
    assert.match(html, /css\/workspace\.css\?v=3\.66\.23/);
});

test('project cards keep detailed content collapsible without hiding task data', () => {
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css/workspace.css'), 'utf8');
    assert.match(renderer, /project-card-snapshot/);
    assert.match(renderer, /<details class="project-card-extras"/);
    assert.match(renderer, /<\/details>/);
    assert.match(renderer, /card-mini-sections/);
    assert.match(css, /project-card-extras\[open\]/);
});

test('compact header exposes a real project search and keyboard navigation', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const module = fs.readFileSync(path.join(__dirname, '..', 'js/ui/workspace-view.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css/workspace.css'), 'utf8');
    assert.match(html, /id="searchProjects"[^>]*aria-label="Поиск по проектам"/);
    assert.match(html, /workspace-nav-link/);
    assert.match(module, /event\.key\.toLowerCase\(\) === 'k'/);
    assert.match(module, /self\.setView\('projects'\)/);
    assert.match(css, /\.workspace-switcher \{ position:sticky/);
});

test('personal account menu keeps Google login and manual cloud transfer distinct', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const identity = fs.readFileSync(path.join(__dirname, '..', 'js/services/firebase-identity.js'), 'utf8');
    assert.match(html, /id="cloudProfileButton"/);
    assert.match(html, /id="cloudProfileStatus"/);
    assert.match(html, /id="cloudProfileEmail"/);
    assert.match(html, /id="cloudIdentityBtn"/);
    assert.match(html, /data-workspace-jump="cloud"/);
    assert.match(identity, /profileButton\.classList\.toggle\('is-connected', !!user\)/);
    assert.match(html, /Перенос данных только по твоему подтверждению/);
});

test('workspace overview presents live project and task metrics', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css/workspace.css'), 'utf8');
    for (const id of ['workspaceActiveProjects', 'workspaceOpenTasks', 'workspaceOverdueTasks', 'workspaceDoneTasks']) {
        assert.match(html, new RegExp('id="' + id + '"'));
        assert.match(renderer, new RegExp(id));
    }
    assert.match(renderer, /_renderWorkspaceSummary\(\)/);
    assert.match(renderer, /StateManager\.get\('projects'\)/);
    assert.match(css, /\.workspace-metrics \{ display:grid/);
});

test('task center provides time lanes while retaining safe checklist completion', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css/workspace.css'), 'utf8');
    for (const view of ['today', 'upcoming', 'overdue', 'all']) {
        assert.match(html, new RegExp('data-today-view="' + view + '"'));
    }
    assert.match(renderer, /_todayView/);
    assert.match(renderer, /ChecklistModule\.toggleItem/);
    assert.match(css, /\.today-tab\.is-active/);
});

test('quick task form uses existing checklist APIs and requires local owner access', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'js/ui/renderer.js'), 'utf8');
    assert.match(html, /id="quickTaskForm"[^>]*owner-only/);
    for (const id of ['quickTaskProject', 'quickTaskText', 'quickTaskPriority', 'quickTaskDeadline']) {
        assert.match(html, new RegExp('id="' + id + '"'));
    }
    assert.match(renderer, /AuthService\.isOwner\(\)/);
    assert.match(renderer, /ChecklistModule\.addItem/);
    assert.match(renderer, /ChecklistModule\.setPriority/);
    assert.match(renderer, /ChecklistModule\.setDeadline/);
});

test('task list supports guarded inline priority and deadline edits', () => {
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css/workspace.css'), 'utf8');
    assert.match(renderer, /data-today-edit-priority/);
    assert.match(renderer, /data-today-edit-deadline/);
    assert.match(renderer, /AuthService\.isOwner\(\)/);
    assert.match(renderer, /ChecklistModule\.setPriority\(editor\.dataset/);
    assert.match(renderer, /ChecklistModule\.setDeadline\(editor\.dataset/);
    assert.match(css, /today-inline-edit/);
});

test('weekly planner counts only open tasks in active projects, including month boundaries', () => {
    const ctx = execute('js/ui/renderer.js');
    const projects = [
        { id: 'active', status: 'active', checklist: [
            { id: 1, text: 'Сегодня', deadline: '2026-11-29' },
            { id: 2, text: 'Декабрь', deadline: '2026-12-01', priority: 'high' },
            { id: 3, text: 'Готово', deadline: '2026-11-29', completed: true },
            { id: 4, text: 'Без срока' }
        ] },
        { id: 'archived', status: 'archived', checklist: [{ id: 5, text: 'В архиве', deadline: '2026-11-29' }] }
    ];
    const snapshot = JSON.stringify(projects);
    const week = Array.from(ctx.RendererModule._collectWeeklyLoad(projects, new Date(2026, 10, 29)));
    assert.equal(week.length, 7);
    assert.equal(week[0].key, '2026-11-29');
    assert.equal(week[0].count, 1);
    assert.equal(week[2].key, '2026-12-01');
    assert.equal(week[2].count, 1);
    assert.equal(week.reduce((sum, day) => sum + day.count, 0), 2);
    assert.equal(JSON.stringify(projects), snapshot);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    for (const id of ['weeklyLoadDays', 'weeklyLoadSummary', 'weeklyLoadClear']) assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(css, /\.weekly-load-day\.is-busy/);
    assert.match(css, /\.weekly-load-day\.is-selected/);
});

test('smart scheduling suggests less busy dates without mutating task data', () => {
    const renderer = execute('js/ui/renderer.js').RendererModule;
    const days = [
        { key: '2026-11-17', count: 5 },
        { key: '2026-11-18', count: 2 },
        { key: '2026-11-19', count: 1 },
        { key: '2026-11-20', count: 4 }
    ];
    const original = JSON.stringify(days);
    assert.equal(renderer._suggestWeeklyDate(days, '2026-11-17').key, '2026-11-19');
    assert.equal(renderer._suggestWeeklyDate(days, '').key, '2026-11-19');
    assert.equal(renderer._suggestWeeklyDate(days, '2026-11-18'), null);
    assert.equal(renderer._suggestWeeklyDate(days, '2026-11-20'), null);
    assert.equal(renderer._suggestWeeklyDate(days, '2026-11-16'), null);
    assert.equal(JSON.stringify(days), original);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    assert.match(html, /data-today-view="undated"/);
    assert.match(js, /data-today-move/);
    assert.match(js, /AuthService\.isOwner\(\)/);
    assert.match(css, /today-suggest-move/);
});

test('task center searches all project names and sorts matches without mutating data', () => {
    const renderer = execute('js/ui/renderer.js').RendererModule;
    const tasks = [
        { text: 'Подготовить релиз', projectName: 'Звёзды', deadline: '2026-11-29', priority: 'high' },
        { text: 'Исправить меню', projectName: 'Тихий берег', deadline: '2026-11-18', priority: 'low' },
        { text: 'Проверить сборку', projectName: 'Звёзды', deadline: '', priority: 'normal' }
    ];
    const before = JSON.stringify(tasks);
    assert.deepEqual(Array.from(renderer._filterAndSortTasks(tasks, 'звЁзды', 'priority'), task => task.text), ['Подготовить релиз', 'Проверить сборку']);
    assert.deepEqual(Array.from(renderer._filterAndSortTasks(tasks, 'МЕНЮ', 'deadline'), task => task.text), ['Исправить меню']);
    assert.deepEqual(Array.from(renderer._filterAndSortTasks(tasks, '', 'deadline'), task => task.text), ['Исправить меню', 'Подготовить релиз', 'Проверить сборку']);
    assert.deepEqual(Array.from(renderer._filterAndSortTasks(tasks, '', 'project'), task => task.projectName), ['Звёзды', 'Звёзды', 'Тихий берег']);
    assert.equal(JSON.stringify(tasks), before);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    for (const id of ['todaySearch', 'todaySort', 'todayMore']) assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(js, /_todayVisibleCount \+= 8/);
    assert.match(css, /\.today-more\[hidden\]/);
});

test('bulk task controls validate active, unfinished targets and require confirmation', () => {
    const ctx = execute('js/ui/renderer.js');
    const renderer = ctx.RendererModule;
    const projects = {
        a: { id: 'a', status: 'active', checklist: [{ id: '1', completed: false }, { id: '2', completed: true }] },
        b: { id: 'b', status: 'archived', checklist: [{ id: '3', completed: false }] }
    };
    ctx.StateManager = { getProject(id) { return projects[id] || null; } };
    renderer._todaySelectedTasks = new Map([
        ['a1', { projectId: 'a', itemId: '1' }],
        ['a2', { projectId: 'a', itemId: '2' }],
        ['b3', { projectId: 'b', itemId: '3' }],
        ['missing', { projectId: 'missing', itemId: '4' }]
    ]);
    assert.deepEqual(Array.from(renderer._validBulkTargets(), target => target.itemId), ['1']);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    assert.match(html, /id="todayBulkForm"[^>]*owner-only/);
    assert.match(html, /id="todayBulkCount"/);
    assert.match(html, /id="todayBulkPriority"/);
    assert.match(html, /id="todayBulkDeadline"/);
    assert.match(js, /window\.confirm\(/);
    assert.match(js, /ChecklistModule\.setPriority\(target/);
    assert.match(js, /ChecklistModule\.setDeadline\(target/);
    assert.match(css, /\.today-bulk\[hidden\]/);
});

test('bulk undo snapshots prior fields and refuses stale or deleted tasks', () => {
    const ctx = execute('js/ui/renderer.js');
    const renderer = ctx.RendererModule;
    const project = { id: 'p', status: 'active', checklist: [{ id: '1', text: 'Задача', priority: 'high', deadline: '2026-11-17' }] };
    ctx.StateManager = { getProject(id) { return id === 'p' ? project : null; } };
    const record = renderer._prepareBulkUndo([{ projectId: 'p', itemId: '1' }], 'low', '2026-11-19');
    assert.equal(record.entries[0].beforePriority, 'high');
    assert.equal(record.entries[0].beforeDeadline, '2026-11-17');
    assert.equal(renderer._canUndoBulk(record), false);
    project.checklist[0].priority = 'low';
    project.checklist[0].deadline = '2026-11-19';
    assert.equal(renderer._canUndoBulk(record), true);
    project.checklist[0].priority = 'normal';
    assert.equal(renderer._canUndoBulk(record), false);
    project.checklist[0].priority = 'low';
    project.checklist[0].completed = true;
    assert.equal(renderer._canUndoBulk(record), false);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    assert.match(html, /id="todayUndoBulk"[^>]*owner-only/);
    assert.match(js, /_canUndoBulk\(self\._todayBulkUndo\)/);
    assert.match(css, /\.today-undo-bulk\[hidden\]/);
});

test('task preferences restore only known filters and project grouping is collapsible', () => {
    const ctx = execute('js/ui/renderer.js');
    const renderer = ctx.RendererModule;
    const priority = { value: 'all' };
    const sort = { value: 'priority' };
    const group = { checked: false };
    const controls = { todayPriority: priority, todaySort: sort, todayGroupByProject: group };
    ctx.document = { getElementById(id) { return controls[id] || null; } };
    const writes = [];
    ctx.StorageService = { get() { return { view: 'overdue', priority: 'high', sort: 'project', group: true }; }, set(key, data) { writes.push({ key, data }); } };
    renderer._restoreTodayPreferences();
    assert.equal(renderer._todayView, 'overdue');
    assert.equal(priority.value, 'high');
    assert.equal(sort.value, 'project');
    assert.equal(group.checked, true);
    renderer._saveTodayPreferences();
    assert.equal(writes[0].key, 'todayPreferences');
    assert.equal(writes[0].data.group, true);
    ctx.StorageService.get = () => ({ view: '__invalid', priority: '__invalid', sort: '__invalid', group: 'true' });
    renderer._restoreTodayPreferences();
    assert.equal(renderer._todayView, 'overdue');
    assert.equal(priority.value, 'high');
    assert.equal(sort.value, 'project');
    assert.equal(group.checked, false);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(html, /id="todayGroupByProject"/);
    assert.match(css, /\.today-project-group\.is-collapsed \.today-project-rows/);
    assert.match(js, /data-today-group/);
});

test('mobile task cards collapse inline controls but keep editing available', () => {
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    assert.match(renderer, /data-today-edit-toggle/);
    assert.match(renderer, /taskRow\.classList\.toggle\('is-editing'\)/);
    assert.match(renderer, /editToggle\.setAttribute\('aria-expanded'/);
    assert.match(renderer, /AuthService\.isOwner\(\)/);
    assert.match(css, /\.today-task:not\(\.is-editing\) \.today-inline-edit \{ display:none; \}/);
    assert.match(css, /\.today-edit-toggle \{ display:inline-flex;/);
    assert.match(css, /#todayPanel \.today-task:not\(\.is-editing\) \.today-inline-edit \{ display:none; \}/);
    assert.match(css, /@media\(max-width:600px\)/);
});

test('mobile quick task creation keeps optional fields behind an accessible toggle', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(html, /id="quickTaskOptionsToggle"[^>]*aria-controls="quickTaskPriority quickTaskDeadline"[^>]*aria-expanded="false"/);
    assert.equal((html.match(/class="quick-task-field quick-task-advanced"/g) || []).length, 2);
    assert.match(css, /\.quick-task-form:not\(\.is-expanded\) \.quick-task-advanced \{ display:none; \}/);
    assert.match(css, /\.quick-task-options-toggle \{ display:inline-flex;/);
    assert.match(renderer, /quickTaskForm\.classList\.toggle\('is-expanded'\)/);
    assert.match(renderer, /quickTaskOptionsToggle\.setAttribute\('aria-expanded', String\(expanded\)\)/);
});

test('weekly workload on narrow screens remains legible and explains day density', () => {
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(css, /\.weekly-load-days \{ display:flex; gap:7px; overflow-x:auto;/);
    assert.match(css, /scroll-snap-type:x proximity/);
    assert.match(css, /\.weekly-load-day \{ flex:0 0 67px;/);
    assert.match(css, /\.weekly-load-day\.is-light \.weekly-load-bar/);
    assert.match(css, /\.weekly-load-day\.is-moderate \.weekly-load-bar/);
    assert.match(renderer, /'Высокая нагрузка'/);
    assert.match(renderer, /'Свободный день'/);
    assert.match(renderer, /aria-pressed="' \+ active/);
});

test('mobile task actions navigate to owner creation, overdue work and search', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(html, /class="today-mobile-actions" aria-label="Быстрые действия с задачами"/);
    for (const action of ['create', 'overdue', 'search']) assert.match(html, new RegExp('data-today-quick="' + action + '"'));
    assert.match(html, /data-today-quick="create" class="owner-only" style="display:none"/);
    assert.match(css, /\.today-mobile-actions \{ display:none; \}/);
    assert.match(css, /\.today-mobile-actions \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(renderer, /event\.target\.closest\('\[data-today-quick\]'\)/);
    assert.match(renderer, /self\._todayView = 'overdue'/);
    assert.match(renderer, /AuthService\.isOwner\(\)/);
});

test('mobile task filters collapse while preserving search and active preferences', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(html, /id="todayMobileFilterToggle" aria-expanded="false" aria-controls="todayPriority todaySort todayGroupByProject"/);
    assert.match(css, /#todayPanel:not\(\.is-filters-expanded\) \.today-filters/);
    assert.match(css, /#todayPanel \.today-search \{ flex-basis:100%; \}/);
    assert.match(renderer, /todayPanel\.classList\.toggle\('is-filters-expanded'\)/);
    assert.match(renderer, /filterToggle\.setAttribute\('aria-expanded', String\(expanded\)\)/);
    assert.match(renderer, /filterLabel\.textContent = 'Дополнительные фильтры'/);
});

test('task view tabs form a single scrollable mobile strip with accessible selection', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(css, /\.today-tabs \{ display:flex; flex-wrap:nowrap; gap:7px; overflow-x:auto;/);
    assert.match(css, /\.today-tab \{ flex:0 0 auto; scroll-snap-align:start; min-height:43px;/);
    assert.match(css, /\.today-tab\.is-active \{ box-shadow:/);
    for (const view of ['today', 'upcoming', 'overdue', 'undated', 'all']) assert.match(html, new RegExp('data-today-view="' + view + '"'));
    assert.match(renderer, /button\.setAttribute\('aria-pressed', String\(active\)\)/);
});

test('workspace navigation centers selected mobile section and supports keyboard travel', () => {
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const nav = fs.readFileSync(path.join(root, 'js/ui/workspace-view.js'), 'utf8');
    assert.match(css, /\.workspace-switcher \{ gap:6px; padding:7px; scroll-snap-type:x proximity/);
    assert.match(css, /\.workspace-switch \{ flex:0 0 auto; scroll-snap-align:center; min-height:44px/);
    assert.match(nav, /switcher\.addEventListener\('keydown'/);
    assert.match(nav, /'ArrowLeft', 'ArrowRight', 'Home', 'End'/);
    assert.match(nav, /buttons\[next\]\.focus\(\)/);
    assert.match(nav, /switcher\.scrollTo\(\{ left: active\.offsetLeft/);
});

test('mobile project cards expose readable actions and keep edit modal footer reachable', () => {
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(css, /#tabProjects \.project-action-btn \{ width:42px; height:42px;/);
    assert.match(css, /#projectModal \.modal-content \{ max-height:calc\(100dvh - 24px\); display:flex; flex-direction:column;/);
    assert.match(css, /#projectModal \.modal-body \{ min-height:0; overflow-y:auto;/);
    assert.match(css, /#projectModal \.modal-footer \{ flex-shrink:0;/);
    assert.match(renderer, /aria-label="Редактировать проект"/);
    assert.match(renderer, /aria-label="Удалить проект"/);
    assert.match(renderer, /'Добавить в избранное'/);
});

test('mobile project details keep notes and checklist controls reachable', () => {
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const notes = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    assert.match(css, /#projectDetailModal \.modal-content \{ max-height:calc\(100dvh - 20px\); \}/);
    assert.match(css, /#projectDetailModal \.checklist-delete \{ opacity:1; width:42px; height:42px;/);
    assert.match(css, /#projectDetailModal \.note-actions \{ opacity:1; margin-left:auto; \}/);
    assert.match(css, /#projectDetailModal \.add-checklist-form \{ flex-wrap:wrap; \}/);
    assert.match(detail, /aria-label="Удалить задачу"/);
    assert.match(notes, /aria-label="Редактировать заметку"/);
    assert.match(notes, /aria-label="Удалить заметку"/);
});

test('grouped task lists can collapse and expand all visible project groups', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(html, /id="todayGroupsToggleAll"[^>]*hidden aria-controls="todayList"/);
    assert.match(css, /\.today-groups-toggle-all\[hidden\] \{ display:none; \}/);
    assert.match(renderer, /event\.target\.closest\('#todayGroupsToggleAll'\)/);
    assert.match(renderer, /self\._todayCollapsedGroups\.add\(heading\.dataset\.todayGroup\)/);
    assert.match(renderer, /heading\.setAttribute\('aria-expanded', String\(!collapse\)\)/);
    assert.match(renderer, /_updateTodayGroupsToggle: function\(\)/);
    assert.match(renderer, /button\.hidden = groups\.length === 0/);
});

test('project notes search, filters and confirmed bulk completion preserve active view', () => {
    const notes = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/components/notes.css'), 'utf8');
    for (const id of ['notesSearch', 'notesPriorityFilter', 'notesStatusFilter', 'notesCompleteVisible']) {
        assert.match(detail, new RegExp('id="' + id + '"'));
    }
    assert.match(detail, /_notesFilter = \{ search: '', priority: '', completed: '', type: '', sort: 'priority' \}/);
    assert.match(detail, /NotesModule\.renderNotes\(projectId, this\._getNotesFilter\(\)\)/);
    assert.match(detail, /_completeVisibleNotes: function\(projectId\)/);
    assert.match(detail, /!confirm\('Отметить выполненными '/);
    assert.match(detail, /\(typeof AuthService !== 'undefined' && !AuthService\.isOwner\(\)\)/);
    assert.match(detail, /EventBus\.emit\('notes:bulk-completed'/);
    assert.match(notes, /filter\.type === key \? 'active' : ''/);
    assert.match(notes, /String\(n\.title \|\| ''\)\.toLowerCase\(\)/);
    assert.match(notes, /Показано ' \+ notes\.length \+ ' из '/);
    assert.match(css, /\.notes-search-toolbar \{[\s\S]*?display: grid;/);
    assert.match(css, /@media \(max-width: 420px\)/);
});

test('pinned project notes sort ahead of ordinary notes and keep filter matches', () => {
    const source = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const project = { id: 'p', notes: [
        { id: 'a', title: 'Альфа', description: '', priority: 'low', completed: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'b', title: 'Бета', description: '', priority: 'critical', completed: false, createdAt: '2026-02-01', updatedAt: '2026-02-01' },
        { id: 'c', title: 'Вега', description: '', priority: 'medium', completed: true, createdAt: '2026-03-01', updatedAt: '2026-03-01' }
    ] };
    let saves = 0;
    const sandbox = {
        StateManager: { getProject: () => project, updateProject: () => { saves++; return project; }, saveProjects: () => { throw new Error('NotesModule must not save the same project twice'); } },
        EventBus: { emit: () => {} },
        window: {}, console
    };
    vm.runInNewContext(source, sandbox);
    const notes = sandbox.window.NotesModule;
    assert.deepEqual(Array.from(notes.getNotes('p', { sort: 'title' }), n => n.id), ['a', 'b', 'c']);
    assert.equal(notes.togglePin('p', 'a'), true);
    assert.equal(saves, 1);
    assert.deepEqual(Array.from(notes.getNotes('p', { sort: 'newest' }), n => n.id), ['a', 'b', 'c']);
    assert.deepEqual(Array.from(notes.getNotes('p', { search: 'бета' }), n => n.id), ['b']);
    assert.equal(notes.togglePin('p', 'a'), false);
    assert.deepEqual(Array.from(notes.getNotes('p', { sort: 'newest' }), n => n.id), ['b', 'a', 'c']);
});

test('project note detail renders pin actions and four sort modes', () => {
    const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const notes = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/components/notes.css'), 'utf8');
    for (const mode of ['priority', 'newest', 'oldest', 'title']) assert.match(detail, new RegExp('value="' + mode + '"'));
    assert.match(detail, /NotesModule\.togglePin\(project\.id, noteId\)/);
    assert.match(detail, /\['notesSort', 'sort'\]/);
    assert.match(notes, /class="note-action-btn pin-btn"/);
    assert.match(notes, /if \(!!a\.pinned !== !!b\.pinned\)/);
    assert.match(css, /\.note-card\.note-pinned/);
});

test('project notes support multi-selection, bulk priority and cross-project transfers', () => {
    const notes = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/components/notes.css'), 'utf8');
    for (const id of ['notesSelectVisible', 'notesClearSelection', 'notesSelectedCount', 'notesBulkPriority', 'notesApplyPriority', 'notesMoveTarget', 'notesMoveSelected']) {
        assert.match(detail, new RegExp('id="' + id + '"'));
    }
    assert.match(notes, /class="note-select-input" type="checkbox"/);
    assert.match(detail, /_selectedNoteIds = new Set\(\)/);
    assert.match(detail, /self\._selectedNoteIds\.add\(note\.id\)/);
    assert.match(detail, /_applySelectedPriority: function\(projectId\)/);
    assert.match(detail, /_moveSelectedNotes: function\(projectId\)/);
    assert.match(detail, /target\.id === source\.id/);
    assert.match(detail, /!confirm\('Перенести '/);
    assert.match(detail, /StateManager\.updateProjects\(\[/);
    assert.match(css, /\.notes-bulk-toolbar \{/);
    assert.match(css, /\.note-select-input \{/);
});

test('bulk note transfer changes only selected notes and respects cancellation', () => {
    const source = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const from = { id: 'a', name: 'Источник', notes: [
        { id: 'one', priority: 'low' }, { id: 'two', priority: 'medium' }
    ] };
    const to = { id: 'b', name: 'Назначение', notes: [] };
    const projects = { a: from, b: to };
    const updates = [];
    let shouldConfirm = false;
    const sandbox = {
        StateManager: {
            getProject: id => projects[id],
            updateProject: (id, patch) => { updates.push([id, patch]); Object.assign(projects[id], patch); return projects[id]; },
            updateProjects: entries => {
                updates.push(['transaction', entries]);
                entries.forEach(entry => Object.assign(projects[entry.projectId], entry.updates));
                return entries.map(entry => projects[entry.projectId]);
            }
        },
        AuthService: { isOwner: () => true },
        document: { getElementById: id => ({ value: id === 'notesMoveTarget' ? 'b' : 'high' }) },
        NotesModule: { priorities: { high: true } },
        EventBus: { emit: () => {} },
        confirm: () => shouldConfirm,
        window: {}, Set, Date, console
    };
    vm.runInNewContext(source, sandbox);
    const detail = sandbox.window.ProjectDetailModule;
    detail._selectedNoteIds = new Set(['one']);
    detail._refreshNotes = () => {};
    detail._moveSelectedNotes('a');
    assert.deepEqual(from.notes.map(n => n.id), ['one', 'two']);
    assert.equal(to.notes.length, 0);
    shouldConfirm = true;
    detail._applySelectedPriority('a');
    assert.equal(from.notes[0].priority, 'high');
    assert.equal(from.notes[1].priority, 'medium');
    detail._moveSelectedNotes('a');
    assert.deepEqual(from.notes.map(n => n.id), ['two']);
    assert.deepEqual(to.notes.map(n => n.id), ['one']);
    assert.deepEqual(updates.map(update => update[0]), ['a', 'transaction']);
    assert.equal(updates[1][1].length, 2);
    assert.equal(detail._selectedNoteIds.size, 0);
});

test('bulk note actions do not mutate or report success when persistence fails', () => {
    const source = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const from = { id: 'a', name: 'Источник', notes: [
        { id: 'one', priority: 'low', completed: false },
        { id: 'two', priority: 'medium', completed: false }
    ], checklist: [] };
    const to = { id: 'b', name: 'Назначение', notes: [] };
    const projects = { a: from, b: to };
    const errors = [];
    const events = [];
    const sandbox = {
        StateManager: {
            getProject: id => projects[id],
            updateProject: () => null,
            updateProjects: () => null
        },
        AuthService: { isOwner: () => true },
        document: { getElementById: id => ({ value: id === 'notesMoveTarget' ? 'b' : 'high' }) },
        NotesModule: { priorities: { high: true }, getNotes: () => [from.notes[0]] },
        NotificationModule: { error: message => errors.push(message), warning() {}, success() {} },
        EventBus: { emit: name => events.push(name) },
        confirm: () => true,
        window: {}, Set, Date, console
    };
    vm.runInNewContext(source, sandbox);
    const detail = sandbox.window.ProjectDetailModule;
    detail._selectedNoteIds = new Set(['one']);
    detail._refreshNotes = () => {};
    detail._getNotesFilter = () => ({});
    detail._applySelectedPriority('a');
    assert.equal(from.notes[0].priority, 'low');
    assert.equal(events.length, 0);
    detail._moveSelectedNotes('a');
    assert.deepEqual(from.notes.map(note => note.id), ['one', 'two']);
    assert.equal(to.notes.length, 0);
    assert.equal(detail._selectedNoteIds.has('one'), true);
    detail._completeVisibleNotes('a');
    assert.equal(from.notes[0].completed, false);
    assert.equal(events.length, 0);
    assert.equal(errors.length, 3);
});

test('note-to-task conversion retains links and prevents duplicate tasks', () => {
    const src = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const note = { id: 'n1', title: 'Поправить карту', priority: 'critical', description: 'Длинные детали' };
    const project = { id: 'p1', notes: [note], checklist: [] };
    let created = 0;
    let updates = 0;
    let assignedPriority = '';
    const sandbox = {
        StateManager: { getProject: () => project, updateProject: () => { updates++; } },
        ChecklistModule: {
            addItem: (id, title) => { created++; const task = { id: 'task1', text: title }; project.checklist.push(task); return task; },
            setPriority: (id, itemId, priority) => { assignedPriority = priority; },
            _updateChecklistDOM: () => {}
        },
        AuthService: { isOwner: () => true },
        EventBus: { emit: () => {} },
        window: {}, console
    };
    vm.runInNewContext(src, sandbox);
    const api = sandbox.window.NotesModule;
    const first = api.createTaskFromNote('p1', 'n1');
    assert.equal(first.id, 'task1');
    assert.equal(first.sourceNoteId, 'n1');
    assert.equal(note.linkedTaskId, 'task1');
    assert.equal(assignedPriority, 'high');
    assert.equal(api.createTaskFromNote('p1', 'n1'), first);
    assert.equal(created, 1);
    assert.equal(updates, 1);
    assert.equal(api.createTaskFromNote('p1', 'missing'), null);
});

test('linked notes and tasks have navigation buttons without toggling task completion', () => {
    const notes = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const checklist = fs.readFileSync(path.join(root, 'js/modules/checklist.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/components/notes.css'), 'utf8');
    assert.match(notes, /class="note-action-btn task-from-note-btn"/);
    assert.match(detail, /NotesModule\.createTaskFromNote\(project\.id, noteId\)/);
    assert.match(detail, /_focusTask: function\(taskId\)/);
    assert.match(detail, /_focusNote: function\(projectId, noteId\)/);
    assert.match(detail, /class="task-source-note"/);
    assert.match(checklist, /class="task-source-note"/);
    assert.match(checklist, /EventBus\.emit\('notes:focus'/);
    assert.match(checklist, /if \(sourceNote\) \{/);
    assert.match(css, /\.note-linked-highlight/);
});

test('linked note cards reflect task completion and expose safe quick toggles', () => {
    const notes = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const detail = fs.readFileSync(path.join(root, 'js/modules/project-detail.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/components/notes.css'), 'utf8');
    assert.match(notes, /task\.id === note\.linkedTaskId && task\.sourceNoteId === note\.id/);
    assert.match(notes, /note-linked-task-status/);
    assert.match(notes, /Задача: ' \+ \(linkedTask\.completed \? 'выполнена' : 'в работе'\)/);
    assert.match(notes, /class="note-linked-task-toggle"/);
    assert.match(detail, /card\.querySelector\('\.note-linked-task-toggle'\)/);
    assert.match(detail, /task\.sourceNoteId === noteId\) ChecklistModule\.toggleItem\(project\.id, task\.id\)/);
    assert.match(detail, /if \(document\.getElementById\('notesContainer'\)\) self\._refreshNotes\(data\.projectId\)/);
    assert.match(css, /\.note-linked-task-status\.is-done/);
    assert.match(css, /\.note-linked-task-toggle/);
});

test('note rendering escapes untrusted text, tags, dates and attributes', () => {
    const src = fs.readFileSync(path.join(root, 'js/modules/notes.js'), 'utf8');
    const project = { id: 'p', checklist: [], notes: [{
        id: 'bad" onmouseover="alert(1)', title: '<img src=x onerror=alert(1)>',
        description: '<script>alert(2)</script>', tags: ['<svg/onload=alert(3)>'],
        createdAt: '<iframe>', priority: '" onclick="alert(4)'
    }] };
    const sandbox = {
        StateManager: { getProject: () => project },
        Helpers: {
            escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
            formatDate: value => value
        },
        AuthService: { isOwner: () => true }, window: {}, console
    };
    vm.runInNewContext(src, sandbox);
    const html = sandbox.window.NotesModule.renderNotes('p');
    assert.doesNotMatch(html, /<img|<script|<svg|<iframe|onmouseover="alert|onclick="alert/);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;script/);
    assert.match(html, /&lt;svg/);
    assert.match(html, /note-priority-medium/);
    assert.match(html, /data-note-id="bad&quot;/);
});

test('checklist completion timestamps are set on completion and cleared on reopening', () => {
    const project = { id: 'p', progress: 0, checklist: [
        { id: 'task', text: 'Проверяемый этап', completed: false, completedAt: null }
    ] };
    const saved = [];
    const events = [];
    const sandbox = {
        StateManager: {
            getProject: () => project,
            updateProject: (id, data) => { saved.push({ id, data }); }
        },
        EventBus: { emit: (name, data) => events.push({ name, data }) },
        window: {}, console
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/modules/checklist.js'), 'utf8'), sandbox);
    const checklist = sandbox.window.ChecklistModule;
    checklist._updateChecklistDOM = () => {};
    checklist.toggleItem('p', 'task');
    assert.equal(project.checklist[0].completed, true);
    assert.equal(typeof project.checklist[0].completedAt, 'string');
    assert.ok(Number.isFinite(Date.parse(project.checklist[0].completedAt)));
    assert.equal(project.progress, 100);
    assert.equal(saved.length, 1);
    assert.equal(events.at(-1).name, 'checklist:changed');

    checklist.toggleItem('p', 'task');
    assert.equal(project.checklist[0].completed, false);
    assert.equal(project.checklist[0].completedAt, null);
    assert.equal(project.progress, 0);
    assert.equal(saved.length, 2);
    assert.equal(events.at(-1).name, 'checklist:changed');
});

test('checklist mutations restore the original project when persistence fails', () => {
  const task = { id: 'task', text: 'Original', completed: false };
  const project = { id: 'p', checklist: [task], taskActivity: [] };
  const events = [];
  const errors = [];
  const ctx = execute('js/modules/checklist.js', {
    StateManager: {
      getProject() { return project; },
      updateProject() { return null; },
      _updateStats() {}
    },
    EventBus: { emit(name) { events.push(name); }, on() {} },
    Helpers: { generateId: () => 'new-task', escapeHtml: value => String(value) },
    NotificationModule: { error(message) { errors.push(message); } },
    document: { querySelector() { return null; } }
  });
  const checklist = ctx.ChecklistModule;
  checklist._updateChecklistDOM = () => {};

  assert.equal(checklist.setPriority('p', 'task', 'high'), false);
  assert.equal(project.checklist[0].priority, undefined);
  assert.equal(project.taskActivity.length, 0);

  assert.equal(checklist.updateText('p', 'task', 'Changed'), false);
  assert.equal(task.text, 'Original');
  assert.equal(project.taskActivity.length, 0);

  assert.equal(checklist.addItem('p', 'New task'), false);
  assert.equal(project.checklist.length, 1);

  assert.equal(checklist.deleteItem('p', 'task'), false);
  assert.equal(project.checklist.length, 1);
  assert.equal(project.checklist[0].text, 'Original');

  assert.equal(events.includes('checklist:changed'), false);
  assert.equal(errors.length, 4);
});

test('note mutations restore note and linked-task state when project persistence fails', () => {
  const originalNote = { id: 'n1', title: 'Original', description: 'Keep me', completed: false, pinned: false, updatedAt: '2026-01-01T00:00:00.000Z', linkedTaskId: 't1' };
  const linkedTask = { id: 't1', text: 'Task', sourceNoteId: 'n1' };
  const project = { id: 'p1', notes: [originalNote], checklist: [linkedTask] };
  const events = [];
  const errors = [];
  const ctx = execute('js/modules/notes.js', {
    StateManager: {
      getProject() { return project; },
      updateProject() { return null; },
      _updateStats() {}
    },
    Helpers: { generateId: () => 'n2' },
    EventBus: { emit(name) { events.push(name); }, on() {} },
    NotificationModule: { error(message) { errors.push(message); }, success() {} }
  });
  const notes = ctx.NotesModule;

  assert.equal(notes.updateNote('p1', 'n1', { title: 'Changed' }), null);
  assert.equal(project.notes[0].title, 'Original');

  assert.equal(notes.toggleComplete('p1', 'n1'), false);
  assert.equal(project.notes[0].completed, false);

  assert.equal(notes.togglePin('p1', 'n1'), false);
  assert.equal(project.notes[0].pinned, false);

  assert.equal(notes.deleteNote('p1', 'n1'), false);
  assert.equal(project.notes.length, 1);
  assert.equal(project.checklist[0].sourceNoteId, 'n1');

  assert.equal(notes.addNote('p1', { title: 'New note' }), null);
  assert.equal(project.notes.length, 1);
  assert.equal(project.notes[0].title, 'Original');

  assert.equal(events.length, 0);
  assert.equal(errors.length, 5);
});

test('tag updates restore the previous project tags when persistence fails', () => {
  const project = { id: 'p1', tags: ['existing'] };
  const errors = [];
  const ctx = execute('js/modules/tags.js', {
    StateManager: { getProject() { return project; }, updateProject() { return null; } },
    NotificationModule: { error(message) { errors.push(message); } }
  });
  assert.equal(ctx.TagsModule.addTagsToProject('p1', ['new']), false);
  assert.deepEqual(Array.from(project.tags), ['existing']);
  assert.equal(errors.length, 1);
});

test('favorites do not change or emit success when storage rejects a write', () => {
  const events = [];
  const errors = [];
  const ctx = execute('js/modules/favorites.js', {
    StorageService: { get() { return []; }, set() { return false; } },
    EventBus: { emit(name) { events.push(name); }, on() {} },
    NotificationModule: { error(message) { errors.push(message); }, success() {}, info() {} }
  });
  const favorites = ctx.FavoritesModule;
  favorites.favorites = ['p1'];
  assert.equal(favorites.toggleFavorite('p2'), false);
  assert.deepEqual(Array.from(favorites.favorites), ['p1']);
  assert.equal(favorites.toggleFavorite('p1'), true);
  assert.deepEqual(Array.from(favorites.favorites), ['p1']);
  assert.equal(events.length, 0);
  assert.equal(errors.length, 2);
});

test('time tracker keeps the active session when saving tracked time fails', () => {
  const project = { id: 'p1', trackedTime: 1200 };
  const errors = [];
  const ctx = execute('js/modules/timetracker.js', {
    StateManager: { getProject() { return project; }, updateProject() { return null; } },
    NotificationModule: { error(message) { errors.push(message); }, info() {}, success() {} },
    EventBus: { emit() {}, on() {} },
    clearInterval() {},
    setInterval() { return 2; }
  });
  const tracker = ctx.TimeTrackerModule;
  tracker.activeSession = { projectId: 'p1', startTime: Date.now() - 5000, paused: false, pausedTime: 0, pauseStart: null };
  tracker.timerInterval = 1;
  assert.equal(tracker.stopTracking(), false);
  assert.equal(project.trackedTime, 1200);
  assert.ok(tracker.activeSession);
  assert.equal(tracker.activeSession.projectId, 'p1');
  assert.equal(tracker.timerInterval, 2);
  assert.equal(errors.length, 1);
});

test('editing a checklist task preserves completion history and rejects invalid text', () => {
    const project = { id: 'p', progress: 100, checklist: [
        { id: 'task', text: 'Старое название', completed: true, completedAt: '2026-11-19T10:00:00.000Z', sourceNoteId: 'note' }
    ] };
    const saved = [];
    const events = [];
    const sandbox = {
        StateManager: { getProject: () => project, updateProject: (id, data) => saved.push({ id, data }) },
        EventBus: { emit: (name, data) => events.push({ name, data }) },
        window: {}, console
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/modules/checklist.js'), 'utf8'), sandbox);
    const checklist = sandbox.window.ChecklistModule;
    checklist._updateChecklistDOM = () => {};
    const completedAt = project.checklist[0].completedAt;
    assert.equal(checklist.updateText('p', 'task', '  Новое название  '), true);
    assert.equal(project.checklist[0].text, 'Новое название');
    assert.equal(project.checklist[0].completed, true);
    assert.equal(project.checklist[0].completedAt, completedAt);
    assert.equal(project.checklist[0].sourceNoteId, 'note');
    assert.equal(typeof project.checklist[0].updatedAt, 'string');
    assert.equal(saved.length, 1);
    assert.equal(events.at(-1).name, 'checklist:changed');
    assert.equal(checklist.updateText('p', 'task', '   '), false);
    assert.equal(checklist.updateText('p', 'task', 'x'.repeat(241)), false);
    assert.equal(checklist.updateText('p', 'missing', 'Другое'), false);
    assert.equal(saved.length, 1);
});
test('priority and deadline edits validate values, refresh task UI and preserve completion history', () => {
    const project = { id: 'p', checklist: [
        { id: 'task', text: 'Этап', completed: true, completedAt: '2026-11-19T10:00:00.000Z', priority: 'low', deadline: '2026-11-20' }
    ] };
    const saved = [];
    const events = [];
    const sandbox = {
        StateManager: { getProject: () => project, updateProject: (id, data) => saved.push({ id, data }) },
        EventBus: { emit: (name, data) => events.push({ name, data }) },
        window: {}, console
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/modules/checklist.js'), 'utf8'), sandbox);
    const checklist = sandbox.window.ChecklistModule;
    let rendered = 0;
    checklist._updateChecklistDOM = () => { rendered++; };
    const completedAt = project.checklist[0].completedAt;
    assert.equal(checklist.setPriority('p', 'task', 'high'), true);
    assert.equal(project.checklist[0].priority, 'high');
    assert.equal(typeof project.checklist[0].updatedAt, 'string');
    assert.equal(checklist.setPriority('p', 'task', 'critical'), false);
    assert.equal(checklist.setDeadline('p', 'task', '2026-11-22'), true);
    assert.equal(project.checklist[0].deadline, '2026-11-22');
    assert.equal(checklist.setDeadline('p', 'task', '2026-02-30'), false);
    assert.equal(checklist.setDeadline('p', 'task', ''), true);
    assert.equal(Object.hasOwn(project.checklist[0], 'deadline'), false);
    assert.equal(project.checklist[0].completed, true);
    assert.equal(project.checklist[0].completedAt, completedAt);
    assert.equal(rendered, 3);
    assert.equal(saved.length, 3);
    assert.equal(events.length, 3);
});
test('unified checklist editor update validates and persists title, priority and deadline atomically', () => {
    const project = { id: 'p', checklist: [{ id: 'task', text: 'Старое', completed: true, completedAt: '2026-11-19T10:00:00Z', sourceNoteId: 'note' }] };
    const saved = []; const events = [];
    const ctx = execute('js/modules/checklist.js', {
        StateManager: { getProject: () => project, updateProject: (id, data) => saved.push({ id, data }) },
        EventBus: { emit: (name, data) => events.push({ name, data }) }
    });
    ctx.ChecklistModule._updateChecklistDOM = () => {};
    assert.equal(ctx.ChecklistModule.updateDetails('p', 'task', { text: '  Новое  ', priority: 'high', deadline: '2026-11-25' }), true);
    assert.equal(project.checklist[0].text, 'Новое');
    assert.equal(project.checklist[0].priority, 'high');
    assert.equal(project.checklist[0].deadline, '2026-11-25');
    assert.equal(project.checklist[0].completed, true);
    assert.equal(project.checklist[0].completedAt, '2026-11-19T10:00:00Z');
    assert.equal(project.checklist[0].sourceNoteId, 'note');
    assert.equal(project.taskActivity.length, 1);
    assert.deepEqual(Array.from(project.taskActivity[0].changes, change => [change.field, change.from, change.to]), [['text', 'Старое', 'Новое'], ['priority', 'normal', 'high'], ['deadline', '', '2026-11-25']]);
    assert.equal(project.taskActivity[0].action, 'updated');
    assert.equal(saved.length, 1); assert.equal(events.length, 1);
    assert.equal(ctx.ChecklistModule.updateDetails('p', 'task', { text: '', priority: 'high', deadline: '2026-11-25' }), false);
    assert.equal(ctx.ChecklistModule.updateDetails('p', 'task', { text: 'OK', priority: 'urgent', deadline: '' }), false);
    assert.equal(ctx.ChecklistModule.updateDetails('p', 'task', { text: 'OK', priority: 'normal', deadline: '2026-02-30' }), false);
    assert.equal(saved.length, 1);
});
test('checklist activity records completion and reopening with a bounded history', () => {
    const project = { id: 'p', checklist: [{ id: 'task', text: 'Этап', completed: false }] };
    const saved = [];
    const ctx = execute('js/modules/checklist.js', {
        StateManager: { getProject: () => project, updateProject: (id, data) => saved.push(data) },
        EventBus: { emit() {} }
    });
    ctx.ChecklistModule._updateChecklistDOM = () => {};
    ctx.ChecklistModule.toggleItem('p', 'task');
    ctx.ChecklistModule.toggleItem('p', 'task');
    assert.deepEqual(Array.from(project.taskActivity, event => event.action), ['completed', 'reopened']);
    assert.deepEqual(Array.from(project.taskActivity, event => event.changes[0].field), ['completed', 'completed']);
    assert.equal(project.taskActivity[0].changes[0].from, false);
    assert.equal(project.taskActivity[0].changes[0].to, true);
    assert.equal(project.taskActivity[1].changes[0].from, true);
    assert.equal(project.taskActivity[1].changes[0].to, false);
    assert.equal(saved.length, 2);
    project.taskActivity = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }));
    ctx.ChecklistModule._recordTaskActivity(project, project.checklist[0], 'updated', [{ field: 'text', from: 'A', to: 'B' }]);
    assert.equal(project.taskActivity.length, 200);
    assert.equal(project.taskActivity[0].id, '1');
});

test('project detail renders escaped task activity and filters event types', () => {
    const ctx = execute('js/modules/project-detail.js', {
        Helpers: { escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); } }
    });
    const module = ctx.ProjectDetailModule;
    const project = { id: 'p1', taskActivity: [
        { id: 'a1', taskId: 't1', taskText: '<script>alert(1)</script>', action: 'updated', createdAt: '2026-11-20T10:00:00Z', changes: [{ field: 'text', from: 'Old', to: 'New' }] },
        { id: 'a2', taskId: 't1', taskText: 'Task', action: 'completed', createdAt: '2026-11-20T11:00:00Z', changes: [{ field: 'completed', from: false, to: true }] }
    ] };
    const all = module._renderTaskActivity(project);
    assert.match(all, /История действий/);
    assert.match(all, /&lt;script&gt;/);
    assert.doesNotMatch(all, /<script>alert/);
    assert.match(all, /Старое|Old/);
    const onlyCompleted = module._renderTaskActivity(project, 'completed');
    assert.match(onlyCompleted, /Задача завершена/);
    assert.doesNotMatch(onlyCompleted, /Изменение задачи/);
    assert.match(module._renderTaskActivity({ id: 'p2', taskActivity: [] }), /История пока пуста/);
});

test('checklist undo and redo restore fields only when current values match', () => {
    const project = { id: 'p', checklist: [{ id: 'task', text: 'Before', completed: false }] };
    const saved = [];
    const ctx = execute('js/modules/checklist.js', {
        StateManager: { getProject: () => project, updateProject: (id, data) => saved.push(data) },
        EventBus: { emit() {} },
        Helpers: { generateId: (() => { let id = 0; return () => 'event-' + (++id); })() },
        NotificationModule: { success() {}, warning() {} }
    });
    ctx.ChecklistModule._updateChecklistDOM = () => {};
    assert.equal(ctx.ChecklistModule.updateDetails('p', 'task', { text: 'After', priority: 'high', deadline: '2026-11-25' }), true);
    assert.equal(ctx.ChecklistModule.undoLastChange('p'), true);
    assert.equal(project.checklist[0].text, 'Before');
    assert.equal(project.checklist[0].priority, undefined);
    assert.equal(project.checklist[0].deadline, undefined);
    assert.equal(ctx.ChecklistModule.redoLastChange('p'), true);
    assert.equal(project.checklist[0].text, 'After');
    assert.equal(project.checklist[0].priority, 'high');
    assert.equal(project.checklist[0].deadline, '2026-11-25');
    assert.equal(project.taskActivity.filter(entry => entry.action === 'undone').length, 1);
    assert.equal(project.taskActivity.filter(entry => entry.action === 'redone').length, 1);
    assert.ok(saved.length >= 3);
});

test('checklist undo refuses stale values and a new edit invalidates redo', () => {
    const project = { id: 'p', checklist: [{ id: 'task', text: 'Before', completed: false }] };
    const ctx = execute('js/modules/checklist.js', {
        StateManager: { getProject: () => project, updateProject() {} },
        EventBus: { emit() {} },
        Helpers: { generateId: (() => { let id = 0; return () => 'event-' + (++id); })() },
        NotificationModule: { success() {}, warning() {} }
    });
    ctx.ChecklistModule._updateChecklistDOM = () => {};
    ctx.ChecklistModule.updateText('p', 'task', 'After');
    project.checklist[0].text = 'Changed elsewhere';
    assert.equal(ctx.ChecklistModule.undoLastChange('p'), false);
    project.checklist[0].text = 'After';
    assert.equal(ctx.ChecklistModule.undoLastChange('p'), true);
    ctx.ChecklistModule.updateText('p', 'task', 'Branch');
    assert.equal(ctx.ChecklistModule.redoLastChange('p'), false);
    assert.equal(project.checklist[0].text, 'Branch');
});

test('deleting a linked checklist task clears its note link', () => {
    const project = { id: 'p', progress: 0, notes: [{ id: 'n', linkedTaskId: 't' }],
        checklist: [{ id: 't', sourceNoteId: 'n', completed: false }] };
    let saved;
    const sandbox = {
        StateManager: { getProject: () => project, updateProject: (id, data) => { saved = data; } },
        EventBus: { emit: () => {} }, window: {}, console
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/modules/checklist.js'), 'utf8'), sandbox);
    const checklist = sandbox.window.ChecklistModule;
    checklist._updateChecklistDOM = () => {};
    assert.equal(checklist.deleteItem('p', 'missing'), false);
    assert.equal(checklist.deleteItem('p', 't'), true);
    assert.equal(project.notes[0].linkedTaskId, undefined);
    assert.equal(saved.notes, project.notes);
    assert.equal(project.checklist.length, 0);
});

test('long-page section dock has working targets and stays keyboard inaccessible while hidden', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(root, 'js/portfolio-nav.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/portfolio.css'), 'utf8');
    assert.match(html, /id="sectionDock"[^>]*aria-hidden="true" inert/);
    for (const anchor of ['featured', 'web-projects', 'projects', 'hero']) {
        assert.match(html, new RegExp('href="#' + anchor + '"'));
        assert.match(html, new RegExp('id="' + anchor + '"'));
    }
    assert.match(script, /dock\.removeAttribute\('inert'\)/);
    assert.match(script, /dock\.setAttribute\('inert', ''\)/);
    assert.match(script, /window\.addEventListener\('scroll', updateDock, \{ passive: true \}\)/);
    assert.match(css, /\.section-dock\.is-visible/);
    assert.match(css, /\.portfolio-viewer-open \.section-dock/);
    assert.match(html, /href="#projects" data-workspace-jump="overview" aria-label="К обзору мастерской"/);
    const workspaceCss = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    assert.match(workspaceCss, /\.content-wrapper:has\(\.section-dock\.is-visible\) > \.workspace-launch/);
});

test('cloud migration keeps all controls accessible inside a progressive disclosure', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    const advanced = html.match(/<details class="cloud-migration-advanced"[\s\S]*?<\/details>/);
    assert.ok(advanced);
    assert.match(advanced[0], /<summary>/);
    for (const id of ['cloudMigrationProjectSelect', 'cloudMigrationUploadBtn', 'cloudMigrationBatchBtn', 'cloudMigrationDownloadSelect', 'cloudMigrationDownloadBtn']) {
        assert.match(advanced[0], new RegExp('id="' + id + '"'));
    }
    assert.ok(html.indexOf('id="cloudMigrationPreviewStatus"') < html.indexOf('<details class="cloud-migration-advanced"'));
    assert.match(css, /\.cloud-migration-actions \{ display:grid/);
    assert.match(css, /\.cloud-migration-advanced > summary:focus-visible/);
});

test('workspace tabs expose selected state and arrow-key navigation', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.match(html, /class="tab-nav mt-3" role="tablist"/);
    for (const [name, panel] of [['Projects', 'tabProjects'], ['Stats', 'tabStats'], ['Achievements', 'tabAchievements']]) {
        assert.match(html, new RegExp('id="tabButton' + name + '" role="tab" aria-controls="' + panel + '"'));
        assert.match(html, new RegExp('id="' + panel + '" role="tabpanel" aria-labelledby="tabButton' + name + '"'));
    }
    assert.match(renderer, /event\.key === 'ArrowRight'/);
    assert.match(renderer, /tabs\[next\]\.focus\(\)/);
    assert.match(renderer, /b\.setAttribute\('aria-selected', String\(selected\)\)/);
    assert.match(app, /b\.setAttribute\('aria-selected', String\(selected\)\)/);
});

test('CI validates stacked pull requests targeting non-main branches', () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/tests.yml'), 'utf8');
    assert.match(workflow, /pull_request:\s*\n/);
    assert.doesNotMatch(workflow, /pull_request:\s*\n\s+branches:/);
    assert.match(workflow, /node --test tests\/safety\.test\.cjs/);
    assert.match(workflow, /firebase emulators:exec/);
});

test('workspace overview shortcuts focus task list and calendar without mutating data', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const view = fs.readFileSync(path.join(root, 'js/ui/workspace-view.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/workspace.css'), 'utf8');
    assert.match(html, /data-workspace-focus="todayPanel" data-focus-view="overview"/);
    assert.match(html, /data-workspace-focus="scheduleCalendar" data-focus-view="planning"/);
    assert.match(view, /document\.querySelectorAll\('\[data-workspace-focus\]'\)/);
    assert.match(view, /self\.setView\(view\)/);
    assert.match(view, /target\.scrollIntoView\(/);
    assert.match(css, /#todayPanel,#scheduleCalendar \{ scroll-margin-top:155px; \}/);
});

 
test('project search and filters refresh only the project list and avoid duplicate search scans', () => {
    const projects = fs.readFileSync(path.join(root, 'js/modules/projects.js'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8');
    assert.match(projects, /StateManager\.set\('filters\.search',[\s\S]*?RendererModule\.renderProjects\(\{ listOnly: true \}\)/);
    assert.match(projects, /StateManager\.set\('filters\.status', 'all'\)[\s\S]*?RendererModule\.renderProjects\(\{ listOnly: true \}\)/);
    assert.match(projects, /StateManager\.set\('filters\.status', btn\.dataset\.filter\)[\s\S]*?RendererModule\.renderProjects\(\{ listOnly: true \}\)/);
    assert.match(renderer, /if \(filterStatus === 'favorites' && sq\)/);
    assert.doesNotMatch(renderer, /if \(sq\) \{\s*var t = sq\.toLowerCase\(\);\s*projects = projects\.filter/);
    assert.match(renderer, /if \(!options \|\| !options\.listOnly\) \{/);
});


test('deadline alerts keep upcoming tasks visible when overdue backlog is large and require stable task links', () => {
  const renderer = execute('js/ui/renderer.js').RendererModule;
  const now = new Date(2026, 10, 19, 12);
  const project = { id: 'p', name: 'Проект', status: 'active', checklist: [
    { id: 'oldest', text: 'Старая просрочка', deadline: '2026-10-01' },
    { id: 'recent', text: 'Вчерашняя просрочка', deadline: '2026-11-18' },
    { id: 'older2', text: 'Позавчерашняя просрочка', deadline: '2026-11-17' },
    { id: 'today', text: 'Срок сегодня', deadline: '2026-11-19' },
    { id: 'tomorrow', text: 'Срок завтра', deadline: '2026-11-20' },
    { id: 'soon', text: 'Срок послезавтра', deadline: '2026-11-21' },
    { text: 'Без ID не должна вести в задачу', deadline: '2026-11-19' }
  ] };
  const alerts = renderer._collectDeadlineAlerts([project], now);
  assert.deepEqual(Array.from(alerts, item => item.taskId), ['recent', 'older2', 'oldest', 'today', 'tomorrow', 'soon']);
  const overdue = alerts.filter(item => item.overdue);
  const upcoming = alerts.filter(item => !item.overdue);
  const visible = Array.from(overdue.slice(0, 3)).concat(Array.from(upcoming.slice(0, 2)));
  assert.deepEqual(visible.map(item => item.taskId), ['recent', 'older2', 'oldest', 'today', 'tomorrow']);
  assert.match(fs.readFileSync(path.join(root, 'js/ui/renderer.js'), 'utf8'), /Ещё '\s*\+/);
});