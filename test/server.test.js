const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infoscreen-test-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.UPLOADS_ROOT = path.join(root, 'uploads');
process.env.DASHBOARD_PASSWORD = 'test-password';
process.env.MAX_UPLOAD_BYTES = '1048576';
const app = require('../server/server');
let server, base, cookie;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
async function request(url, method = 'GET', body, auth = cookie) {
  return fetch(base + url, { method, redirect: 'manual', headers: { ...(auth ? { cookie: auth } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
}
async function login(password = 'test-password') { const response = await request('/login', 'POST', { password }, ''); return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] }; }
function multipart(name, bytes, type, field = 'datei') { const form = new FormData(); form.append(field, new Blob([bytes], { type }), name); return form; }
const png = require('@napi-rs/canvas').createCanvas(2, 2).toBuffer('image/png');
test('isolated authenticated CMS lifecycle and public display payload', async () => {
  assert.equal((await request('/api/files', 'GET', undefined, '')).status, 401);
  assert.equal((await login('wrong')).response.headers.get('location'), '/login.html?error=1');
  const signed = await login(); cookie = signed.cookie; assert.equal(signed.response.status, 303);
  assert.equal((await request('/api/health')).status, 200);
  const upload = await request('/api/files', 'POST', multipart('photo.png', png, 'image/png'));
  assert.equal(upload.status, 201); const file = await upload.json(); assert.equal(file.bytes, png.length);
  assert.equal((await request(file.url)).headers.get('content-type'), 'image/png');
  assert.equal((await request('/api/files', 'POST', multipart('photo.png', png, 'image/png'))).status, 409);
  assert.equal((await request('/api/files', 'POST', multipart('fake.png', '<script>x</script>', 'image/png'))).status, 415);
  assert.equal((await request('/api/files', 'POST', multipart('bad.png', png, 'text/html'))).status, 415);
  assert.equal((await request('/api/files', 'POST', multipart('bad.pdf', '%PDF-broken', 'application/pdf'))).status, 415);
  assert.equal((await request('/api/files', 'POST', multipart('huge.bin', Buffer.alloc(1048577), 'application/octet-stream'))).status, 413);
  assert.equal((await request('/api/files?path=..%2Fuploads-other')).status, 400);
  const html = await (await request('/api/files', 'POST', multipart('page.html', '<script>alert(1)</script>', 'text/html'))).json();
  const served = await request(html.url); assert.match(served.headers.get('content-disposition'), /^attachment/); assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await request('/api/files', 'PUT', { name: 'photo.png', newName: 'renamed.png' })).status, 200);
  const image = await (await request('/api/bilder', 'POST', multipart('editor.png', png, 'image/png', 'bild'))).json();
  const announcement = await (await request('/api/mitteilungen', 'POST', { titel: 'Integration', text: `![Image](${image.url}) **Hello**`, datum: '2099-01-01', bis: '2099-12-31' })).json();
  assert.ok(announcement.id);
  const profile = await (await request('/api/steckbriefe', 'POST', multipart('profile.png', png, 'image/png'))).json();
  assert.equal(profile.pages, 1); assert.equal(profile.bytes, png.length); assert.ok(profile.uploadedAt);
  assert.equal((await request(`/api/steckbriefe/${profile.id}`, 'PUT', { name: 'Display title', sichtbar: false })).status, 200);
  let slides = await (await request('/api/public/content', 'GET', undefined, '')).json();
  assert.equal(slides.some(s => s.typ === 'steckbrief'), false); assert.equal(slides.find(s => s.typ === 'termine').eintraege[0].text, `![Image](${image.url}) **Hello**`);
  await request(`/api/steckbriefe/${profile.id}`, 'PUT', { sichtbar: true });
  await request('/api/steckbriefe/reihenfolge', 'PUT', { ids: [profile.id] });
  const replacement = await (await request(`/api/steckbriefe/${profile.id}/replace`, 'POST', multipart('replacement.png', png, 'image/png'))).json();
  assert.equal(replacement.name, 'Display title'); assert.notEqual(replacement.dateiname, profile.dateiname);
  slides = await (await request('/api/public/content')).json(); assert.equal(slides[0].name, 'Display title'); assert.equal((await request(slides[0].bild)).status, 200);
  assert.equal((await request('/api/files', 'DELETE', { path: 'steckbriefe', name: profile.dateiname })).status, 409);
  assert.equal((await request('/api/files', 'PUT', { path: 'steckbriefe', name: replacement.dateiname, newName: 'new.png' })).status, 409);
  assert.equal((await request('/api/files', 'DELETE', { path: 'bilder', names: [image.name] })).status, 409);
  const history = await (await request('/api/versions')).json(); assert.ok(history.length > 3);
  const version = await (await request('/api/versions/' + history[0].id)).json(); assert.deepEqual(Object.keys(version.content).sort(), ['einstellungen.json', 'geburtstage.json', 'mitteilungen.json', 'steckbriefe.json']);
  assert.equal((await request(`/api/versions/${version.id}/restore`, 'POST', {})).status, 200);
  assert.equal((await request('/api/files', 'DELETE', { names: ['renamed.png', 'page.html'] })).status, 200);
  assert.equal((await request('/api/bilder/cleanup', 'POST', {})).status, 200);
  const oldCookie = cookie;
  assert.equal((await request('/api/password', 'PUT', { currentPassword: 'wrong', newPassword: 'changed-password' })).status, 403);
  assert.equal((await request('/api/password', 'PUT', { currentPassword: 'test-password', newPassword: 'short' })).status, 400);
  assert.equal((await request('/api/password', 'PUT', { currentPassword: 'test-password', newPassword: 'changed-password' })).status, 200);
  assert.equal((await login()).response.headers.get('location'), '/login.html?error=1');
  assert.equal((await login('changed-password')).response.status, 303);
  const persisted = fs.readFileSync(path.join(process.env.DATA_DIR, 'password.json'), 'utf8'); assert.ok(!persisted.includes('changed-password')); assert.ok(JSON.parse(persisted).salt);
  const freshCMS = require('../server/cms')({ DATA_DIR: process.env.DATA_DIR, UPLOADS_ROOT: process.env.UPLOADS_ROOT, TEAM_PASSWORD: 'irrelevant' }); assert.equal(freshCMS.verifyPassword('changed-password'), true);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'versions.json'))); assert.ok(!JSON.stringify(saved).includes('changed-password'));
  // Missing historical assets must prevent restore before any content writes.
  const assetVersion = saved.find(v => v.content['steckbriefe.json'].length);
  const assetName = assetVersion.content['steckbriefe.json'][0].dateiname;
  fs.unlinkSync(path.join(process.env.UPLOADS_ROOT, 'steckbriefe', assetName));
  cookie = (await login('changed-password')).cookie;
  assert.equal((await request(`/api/versions/${assetVersion.id}/restore`, 'POST', {})).status, 409);
});
test('symlink traversal is rejected when host permits symlink creation', async t => {
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  try { fs.symlinkSync(outside, path.join(process.env.UPLOADS_ROOT, 'escape'), 'junction'); } catch (err) { if (['EPERM', 'EACCES'].includes(err.code)) return t.skip('Host disallows symlinks'); throw err; }
  assert.equal((await request('/api/files?path=escape')).status, 400);
  assert.equal((await request('/uploads/escape/secret.txt')).status, 400);
});
