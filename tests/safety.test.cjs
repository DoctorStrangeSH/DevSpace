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
  assert.equal(project.checklist[0].milestone, 'Дизайн');
  assert.equal(project.checklist[0].completed, true);
  assert.equal(saved.length, 1);
  assert.equal(roadmap.assignTaskStage('p', 't', ''), true);
  assert.equal(Object.hasOwn(project.checklist[0], 'milestone'), false);
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
  assert.equal(project.checklist[0].milestone, 'Фундамент');
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
  assert.ok(sources.indexOf('js/core/state.js?v=3.62.5') < sources.indexOf('js/app.js?v=3.62.5'));
  assert.ok(sources.indexOf('js/core/sync.js?v=3.62.5') < sources.indexOf('js/app.js?v=3.62.5'));
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
    requestIdleCallback(callback) { idle.push(callback); },
    LocalStorageService: { get(key) { return key === 'settings' ? { syncMode: 'read-only' } : null; } },
    FirebaseService: { _initialized: false, init() { this._initialized = true; return Promise.resolve(); } }
  });
  let cloudReads = 0;
  sync.SyncModule._syncFromCloud = () => { cloudReads++; return Promise.resolve(); };
  const pending = sync.SyncModule.init();
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
    document: { getElementById() { return null; } },
    LocalStorageService: { get(key) { return key === 'settings' ? { syncMode: 'local' } : null; } },
    FirebaseService: { init() { throw Error('Local mode should never fetch SDK'); } }
  });
  await local.SyncModule.init();
  assert.equal(local.SyncModule._sdkPromise, null);
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
  assert.ok(html.includes('<script src="js/portfolio.js?v=3.62.5" defer></script>'));
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
  assert.ok(html.includes('src="js/github-metadata.js?v=3.62.5"'));
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
  assert.ok(html.includes('src="js/portfolio-gallery.js?v=3.62.5"'));
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
  assert.ok(html.includes('src="js/portfolio-nav.js?v=3.62.5"'));
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

test('3.62.5 cache, HTML fallback and visible application version are aligned', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(app.includes("version: '3.62.5'"));
  assert.ok(worker.includes("const CACHE_VERSION = 'devspace-v3.62.5'"));
  assert.ok(html.includes('id="appVersion">v3.62.5</span>'));
});

test('every local script and stylesheet is versioned and included in offline precache', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const resources = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+)(\?v=[^"]+)?"/g)];
  assert.ok(resources.length > 40);
  for (const [, file, version] of resources) {
    assert.equal(version, '?v=3.62.5', `${file} is not versioned`);
    assert.ok(worker.includes(`'${file}'`), `${file} is not precached`);
  }
  assert.ok(worker.includes("const ASSET_VERSION = '3.62.5'"));
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
