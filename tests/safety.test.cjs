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
