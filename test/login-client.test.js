const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../server/login.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness(fetcher) {
  const events = {}, calls = [], navigations = [], timers = new Map();
  const button = { disabled: false, textContent: 'Einloggen' };
  const nodes = {
    login: { querySelector: () => button, setAttribute() {}, addEventListener: (name, fn) => { events[name] = fn; } },
    password: { value: 'correct-password' },
    error: { hidden: true, textContent: '' }
  };
  const context = vm.createContext({ URLSearchParams, AbortController, TypeError,
    document: { getElementById: id => nodes[id] },
    window: { location: { search: '', replace: url => navigations.push(url) }, addEventListener: (name, fn) => { events[name] = fn; } },
    setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { calls.push({ url, options }); return fetcher(url, options); }
  });
  vm.runInContext(script, context);
  let prevented = 0;
  return { nodes, button, calls, navigations, timers, events,
    submit: () => events.submit({ preventDefault: () => prevented++ }),
    get prevented() { return prevented; } };
}

test('navigation waits for both password acceptance and a confirmed cookie', async () => {
  let confirm;
  const h = harness(url => url === '/login' ? reply(200, { ok: true }) : new Promise(resolve => { confirm = resolve; }));
  const submitted = h.submit();
  await flush();
  assert.deepEqual(h.navigations, []);
  assert.equal(h.button.disabled, true);
  confirm(reply(200, { authenticated: true }));
  await submitted;
  assert.deepEqual(h.navigations, ['/dashboard/dashboard.html']);
  assert.equal(h.prevented, 1);
  assert.deepEqual(h.calls.map(c => c.url), ['/login', '/api/session']);
  for (const { options } of h.calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
  }
  assert.equal(JSON.parse(h.calls[0].options.body).password, 'correct-password');
  assert.equal(h.timers.size, 0);
});

test('blocked cookies show an actionable error with no navigation or automatic retry', async () => {
  const h = harness(url => url === '/login' ? reply(200, { ok: true }) : reply(401, { code: 'UNAUTHORIZED' }));
  await h.submit();
  assert.deepEqual(h.navigations, []);
  assert.equal(h.calls.length, 2);
  assert.equal(h.nodes.error.hidden, false);
  assert.match(h.nodes.error.textContent, /Cookies/);
  assert.equal(h.button.disabled, false);
});

test('wrong password stays on the page and permits a corrected password', async () => {
  let valid = false;
  const h = harness(url => url === '/api/session' ? reply(200, { authenticated: true }) : valid ? reply(200, { ok: true }) : reply(401, { error: 'Falsches Passwort.' }));
  await h.submit();
  assert.deepEqual(h.navigations, []);
  assert.equal(h.nodes.error.textContent, 'Falsches Passwort.');
  valid = true;
  await h.submit();
  assert.deepEqual(h.navigations, ['/dashboard/dashboard.html']);
  assert.equal(h.nodes.error.hidden, true);
});

test('double submission sends only one password request', async () => {
  let accept;
  const h = harness(url => url === '/login' ? new Promise(resolve => { accept = resolve; }) : reply(200, { authenticated: true }));
  const first = h.submit();
  await h.submit();
  assert.equal(h.calls.length, 1);
  accept(reply(200, { ok: true }));
  await first;
  assert.equal(h.prevented, 2);
  assert.equal(h.calls.length, 2);
});

test('network failure and timeout release the form instead of reloading', async () => {
  for (const timeout of [false, true]) {
    const h = harness((url, options) => {
      if (!timeout) throw new TypeError('offline');
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' }))));
    });
    const pending = h.submit();
    if (timeout) [...h.timers.values()][0]();
    await pending;
    assert.deepEqual(h.navigations, []);
    assert.equal(h.button.disabled, false);
    assert.match(h.nodes.error.textContent, /Verbindung/);
    assert.equal(h.timers.size, 0);
  }
});

test('server and session probe errors never enter the dashboard', async () => {
  for (const failure of ['save', 'probe', 'old-server']) {
    const h = harness(url => {
      if (failure === 'old-server') return { json: async () => { throw new SyntaxError('HTML instead of JSON'); } };
      return failure === 'save' || url === '/api/session' ? reply(500, { error: 'Sitzung nicht verfügbar.' }) : reply(200, { ok: true });
    });
    await h.submit();
    assert.deepEqual(h.navigations, []);
    assert.equal(h.nodes.error.hidden, false);
    assert.equal(h.button.disabled, false);
  }
});

test('page restored from browser history resumes an existing login without reposting the password', async () => {
  const h = harness(() => reply(200, { authenticated: true }));
  await h.events.pageshow({ persisted: true });
  assert.deepEqual(h.calls.map(c => c.url), ['/api/session']);
  assert.deepEqual(h.navigations, ['/dashboard/dashboard.html']);
});

test('normal page display and restored expired session do not navigate or submit a password', async () => {
  const h = harness(() => reply(401, { code: 'UNAUTHORIZED' }));
  await h.events.pageshow({ persisted: false });
  assert.equal(h.calls.length, 0);
  await h.events.pageshow({ persisted: true });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.navigations, []);
  assert.equal(h.button.disabled, false);
});
