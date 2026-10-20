const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infoscreen-login-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.UPLOADS_ROOT = path.join(root, 'uploads');
process.env.DASHBOARD_PASSWORD = 'login-test-password';
const app = require('../server/server');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  app.locals.stopCMS();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});
function request(route, { cookie, ...options } = {}) {
  return fetch(base + route, { ...options, redirect: 'manual', headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
}
function login(password = process.env.DASHBOARD_PASSWORD, headers = {}) {
  return request('/login', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ password }) });
}
const sessionCookie = response => response.headers.get('set-cookie')?.split(';')[0];
const noStore = response => assert.match(response.headers.get('cache-control') || '', /no-store/);

test('fetch login saves a usable HTTP session without a redirect', async () => {
  const response = await login();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), { ok: true });
  noStore(response);
  const cookie = sessionCookie(response);
  assert.ok(cookie);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /; Secure/);
  const session = await request('/api/session', { cookie });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true });
  noStore(session);
  assert.equal((await request('/dashboard/dashboard.html', { cookie })).status, 200);
});

test('missing or rejected cookies are detected without redirecting the session check', async () => {
  await login(); // Simulate a browser discarding Set-Cookie.
  const response = await request('/api/session');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('location'), null);
  noStore(response);
});

test('wrong password returns JSON without navigation or a new session', async () => {
  const response = await login('incorrect');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).code, 'INVALID_PASSWORD');
  noStore(response);
});

test('reload of either login URL resumes an already authenticated session', async () => {
  const cookie = sessionCookie(await login());
  for (const route of ['/login.html', '/login', '/login.html?error=1']) {
    const response = await request(route, { cookie });
    assert.equal(response.status, 302, route);
    assert.equal(response.headers.get('location'), '/dashboard/dashboard.html');
    noStore(response);
  }
});

test('login pages and anonymous dashboard redirects cannot be cached', async () => {
  for (const route of ['/login.html', '/login', '/dashboard/dashboard.html']) {
    const response = await request(route);
    assert.equal(response.status, route.startsWith('/dashboard') ? 302 : 200, route);
    noStore(response);
  }
});

test('native form submission still uses POST/303/GET', async () => {
  const response = await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: new URLSearchParams({ password: process.env.DASHBOARD_PASSWORD }) });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/dashboard/dashboard.html');
  assert.equal((await request(response.headers.get('location'), { cookie: sessionCookie(response) })).status, 200);
  noStore(response);
});

test('logout and password rotation invalidate session probes and login-page recovery', async () => {
  const cookie = sessionCookie(await login());
  const logout = await request('/logout', { method: 'POST', cookie });
  assert.equal(logout.status, 303);
  noStore(logout);
  assert.equal((await request('/api/session', { cookie })).status, 401);
  const staleCookie = sessionCookie(await login());
  const currentCookie = sessionCookie(await login());
  const changed = await request('/api/password', { method: 'PUT', cookie: currentCookie, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: process.env.DASHBOARD_PASSWORD, newPassword: 'changed-test-password' }) });
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/session', { cookie: staleCookie })).status, 401);
  assert.equal((await request('/login.html', { cookie: staleCookie })).status, 200);
  assert.equal((await request('/api/session', { cookie: currentCookie })).status, 200);
});
