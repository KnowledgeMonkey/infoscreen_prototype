'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infoscreen-contract-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.UPLOADS_ROOT = path.join(root, 'uploads');
process.env.DASHBOARD_PASSWORD = 'contract-test-password';
let server, base, cookie;
async function request(route, method = 'GET', body, authenticated = true) {
  const headers = authenticated ? { Cookie: cookie } : {};
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  return fetch(base + route, { method, headers, body, redirect: 'manual' });
}
async function json(route, method, body) {
  const response = await request(route, method, body);
  const value = await response.json();
  assert.ok(response.ok, `${method || 'GET'} ${route}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
function form(name = 'pixel.png', bytes = png, type = 'image/png') {
  const body = new FormData(); body.append('datei', new Blob([bytes], { type }), name); return body;
}
before(async () => {
  const app = require('../server/server');
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const response = await request('/login', 'POST', { password: process.env.DASHBOARD_PASSWORD }, false);
  assert.equal(response.status, 303); cookie = response.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true });
});
test('private endpoints reject anonymous requests', async () => {
  for (const route of ['/api/files', '/api/versions', '/api/steckbriefe', '/api/mitteilungen', '/api/geburtstage', '/api/einstellungen', '/api/hotspot']) {
    const response = await request(route, 'GET', undefined, false); assert.equal(response.status, 401, route);
  }
});
test('stored HTML is downloaded with a sandbox and nosniff', async () => {
  const file = await json('/api/files', 'POST', form('payload.html', '<script>alert(1)</script>', 'text/html'));
  const response = await request(file.url, 'GET', undefined, false);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /^attachment/);
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
test('concurrent uploads preserve both profiles; replacement, deletion and restore preserve assets', async () => {
  const before = await json('/api/steckbriefe');
  const uploaded = await Promise.all([json('/api/steckbriefe', 'POST', form()), json('/api/steckbriefe', 'POST', form())]);
  const list = await json('/api/steckbriefe'); assert.equal(list.length, before.length + 2);
  for (const item of uploaded) assert.ok(list.some(x => x.id === item.id));
  const original = uploaded[0];
  const replacement = await json(`/api/steckbriefe/${original.id}/replace`, 'POST', form());
  assert.equal(replacement.id, original.id); assert.notEqual(replacement.dateiname, original.dateiname);
  const version = (await json('/api/versions'))[0];
  for (const method of ['PUT', 'DELETE']) {
    const response = await request('/api/files', method, { path: 'steckbriefe', name: original.dateiname, newName: 'renamed.png' });
    assert.equal(response.status, 409, method);
  }
  await json(`/api/steckbriefe/${original.id}`, 'DELETE');
  await json(`/api/versions/${version.id}/restore`, 'POST');
  const restored = (await json('/api/steckbriefe')).find(x => x.id === original.id);
  assert.equal(restored.dateiname, original.dateiname);
  assert.equal((await request('/uploads/steckbriefe/' + restored.seiten[0], 'GET', undefined, false)).status, 200);
});
test('invalid replacement leaves metadata and files untouched', async () => {
  await json('/api/steckbriefe', 'POST', form());
  const profiles = await json('/api/steckbriefe');
  const directory = path.join(process.env.UPLOADS_ROOT, 'steckbriefe');
  const files = fs.readdirSync(directory).sort();
  const response = await request(`/api/steckbriefe/${profiles[0].id}/replace`, 'POST', form('broken.png', 'bad'));
  assert.equal(response.status, 415);
  assert.deepEqual(await json('/api/steckbriefe'), profiles);
  assert.deepEqual(fs.readdirSync(directory).sort(), files);
});
test('mixed bulk deletion fails without deleting existing files', async () => {
  await json('/api/files', 'POST', form('keep.txt', 'keep', 'text/plain'));
  const response = await request('/api/files', 'DELETE', { names: ['keep.txt', 'missing.txt'] });
  assert.equal(response.status, 404);
  assert.equal(fs.readFileSync(path.join(process.env.UPLOADS_ROOT, 'keep.txt'), 'utf8'), 'keep');
});
test('malformed announcement date is rejected and cannot break public content', async () => {
  const response = await request('/api/mitteilungen', 'POST', { titel: 'Malformed date', text: 'test', datum: { invalid: true } });
  assert.equal(response.status, 400);
  assert.equal((await request('/api/public/content', 'GET', undefined, false)).status, 200);
});
test('duplicate announcement order cannot duplicate records', async () => {
  const item = await json('/api/mitteilungen', 'POST', { titel: 'Order test', text: 'test' });
  const response = await request('/api/mitteilungen/reihenfolge', 'PUT', { ids: [item.id, item.id] });
  assert.equal(response.status, 400);
  const list = await json('/api/mitteilungen'); assert.equal(list.filter(x => x.id === item.id).length, 1);
});
test('malformed birthday is rejected', async () => {
  const response = await request('/api/geburtstage', 'POST', { name: 'Invalid', tag: 'NaN', monat: {} });
  assert.equal(response.status, 400);
});
test('conversion failure rolls back original and partial rendered pages', async () => {
  const express = require('express');
  const isolated = path.join(root, 'conversion');
  const data = path.join(isolated, 'data'), uploads = path.join(isolated, 'uploads');
  fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(uploads, { recursive: true });
  const cms = require('../server/cms')({ DATA_DIR: data, UPLOADS_ROOT: uploads, TEAM_PASSWORD: 'test' });
  const app = express();
  cms.install(app, { requireLogin: (req, res, next) => next(), konvertiereZuSeiten: async (source, directory) => {
    fs.writeFileSync(path.join(directory, path.basename(source, '.png') + '-001.png'), png);
    throw new Error('Injected renderer failure after first page');
  } });
  cms.errors(app);
  const temporary = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${temporary.address().port}/api/steckbriefe`, { method: 'POST', body: form() });
    assert.equal(response.status, 500);
    assert.deepEqual(fs.readdirSync(path.join(uploads, 'steckbriefe')), []);
    assert.deepEqual(cms.read('steckbriefe.json'), []);
    assert.deepEqual(cms.read('versions.json'), []);
  } finally { temporary.closeAllConnections(); await new Promise(resolve => temporary.close(resolve)); }
});
test('single-quoted HTML image references protect uploads against deletion', async () => {
  await json('/api/files?path=bilder', 'POST', form('referenced.png'));
  await json('/api/mitteilungen', 'POST', { titel: 'HTML image', text: "<img src='/uploads/bilder/referenced.png'>" });
  const response = await request('/api/files', 'DELETE', { path: 'bilder', name: 'referenced.png' });
  assert.equal(response.status, 409);
  assert.equal((await request('/uploads/bilder/referenced.png', 'GET', undefined, false)).status, 200);
});
test('failed login cannot revive a session invalidated by password rotation', async () => {
  const login = await request('/login', 'POST', { password: process.env.DASHBOARD_PASSWORD }, false);
  const oldCookie = login.headers.get('set-cookie').split(';')[0];
  await json('/api/password', 'PUT', { currentPassword: process.env.DASHBOARD_PASSWORD, newPassword: 'rotated-test-password' });
  const stale = async route => fetch(base + route, { headers: { Cookie: oldCookie }, redirect: 'manual' });
  assert.equal((await stale('/api/files')).status, 401);
  await fetch(base + '/login', { method: 'POST', headers: { Cookie: oldCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'incorrect' }), redirect: 'manual' });
  assert.equal((await stale('/api/files')).status, 401, 'wrong password must not refresh the session generation');
});
