'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

module.exports = function createCMS({ DATA_DIR, UPLOADS_ROOT, TEAM_PASSWORD }) {
  const contentFiles = ['steckbriefe.json', 'mitteilungen.json', 'geburtstage.json', 'einstellungen.json'];
  const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
  function atomic(name, value) {
    const target = path.join(DATA_DIR, name);
    const tmp = target + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
      const fd = fs.openSync(tmp, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, target);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  function read(name, fallback = []) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
  }
  function snapshot() { return Object.fromEntries(contentFiles.map(name => [name, read(name, name === 'einstellungen.json' ? {} : [])])); }
  function versions() { return read('versions.json'); }
  function save(name, value) {
    if (contentFiles.includes(name)) {
      const history = versions();
      history.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), content: snapshot() });
      atomic('versions.json', history.slice(-100));
    }
    atomic(name, value);
  }
  function safe(relative = '') {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || relative.includes(':') || path.isAbsolute(relative)) throw fail(400, 'INVALID_PATH', 'Ungueltiger Pfad');
    const target = path.resolve(UPLOADS_ROOT, relative);
    const rel = path.relative(UPLOADS_ROOT, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail(400, 'INVALID_PATH', 'Pfad ausserhalb des Upload-Verzeichnisses');
    let current = UPLOADS_ROOT;
    for (const part of ['', ...rel.split(path.sep).filter(Boolean)]) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw fail(400, 'INVALID_PATH', 'Symbolische Links sind nicht erlaubt');
    }
    return target;
  }
  function filename(name) {
    if (typeof name !== 'string' || !name.length || name.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name.startsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) throw fail(400, 'INVALID_NAME', 'Ungueltiger Dateiname');
    return name;
  }
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  const url = rel => '/uploads/' + rel.split('/').map(encodeURIComponent).join('/');
  function metadata(rel) {
    const stat = fs.statSync(safe(rel));
    return { name: path.basename(rel), bytes: stat.size, groesseKB: Math.round(stat.size / 1024), url: url(rel), type: mime[path.extname(rel).toLowerCase()] || 'application/octet-stream', uploadedAt: stat.birthtime.toISOString() };
  }
  function assets(content) {
    const result = new Set();
    for (const sb of content['steckbriefe.json'] || []) for (const name of [sb.dateiname, ...(sb.seiten || []), sb.bild].filter(Boolean)) result.add('steckbriefe/' + name);
    const strings = JSON.stringify(content);
    for (const match of strings.matchAll(/\/uploads\/([^\s"<>\\)]+)(?:)/g)) {
      try { result.add(decodeURIComponent(match[1].split(/[?#]/)[0])); } catch { /* malformed references never become filesystem paths */ }
    }
    return result;
  }
  function protectedAssets() {
    return new Set([snapshot(), ...versions().map(v => v.content)].flatMap(c => [...assets(c)]));
  }
  function assertFree(rels) {
    const references = protectedAssets();
    const used = rels.filter(rel => references.has(rel));
    if (used.length) throw fail(409, 'ASSET_IN_USE', 'Datei wird von Inhalten oder Versionen verwendet: ' + used.join(', '));
  }
  function hash(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
  const initial = hash(TEAM_PASSWORD);
  function credentials() { return read('password.json', { ...initial, generation: 0 }); }
  function verifyPassword(password) {
    if (typeof password !== 'string' || password.length > 1024) return false;
    const stored = credentials();
    const actual = Buffer.from(hash(password, stored.salt).hash, 'hex');
    const expected = Buffer.from(stored.hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }
  function validSession(session) { return (session.generation || 0) === credentials().generation; }
  const maxSize = Number(process.env.MAX_UPLOAD_BYTES) || 100 * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxSize, files: 1, fields: 10 } });
  async function validate(file, mode) {
    if (!file || !file.size) throw fail(400, 'INVALID_FILE', 'Datei fehlt oder ist leer');
    filename(file.originalname);
    const ext = path.extname(file.originalname).toLowerCase();
    const image = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
    if (mode === 'image' && !image || mode === 'profile' && !image && !['.pdf', '.pptx', '.ppt', '.odp'].includes(ext)) throw fail(415, 'INVALID_TYPE', 'Dateityp nicht unterstuetzt');
    if (mime[ext] && file.mimetype !== mime[ext] && file.mimetype !== 'application/octet-stream') throw fail(415, 'INVALID_TYPE', 'MIME-Typ passt nicht zur Dateiendung');
    const b = file.buffer;
    if (image) {
      const signatures = { '.png': b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), '.jpg': b[0] === 255 && b[1] === 216 && b[2] === 255, '.jpeg': b[0] === 255 && b[1] === 216 && b[2] === 255, '.gif': /^GIF8[79]a$/.test(b.subarray(0, 6).toString()), '.webp': b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' };
      if (!signatures[ext]) throw fail(415, 'INVALID_SIGNATURE', 'Ungueltige Bildsignatur');
      try { const img = await require('@napi-rs/canvas').loadImage(b); if (img.width * img.height > 40000000) throw Error(); }
      catch { throw fail(415, 'INVALID_IMAGE', 'Bild kann nicht gelesen werden oder ist zu gross'); }
    }
    if (ext === '.pdf') {
      if (!b.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw fail(415, 'INVALID_SIGNATURE', 'Ungueltige PDF-Signatur');
      try { const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'); const doc = await getDocument({ data: new Uint8Array(b), disableWorker: true }).promise; if (!doc.numPages || doc.numPages > 100) throw Error(); await doc.destroy(); }
      catch { throw fail(415, 'INVALID_PDF', 'PDF unlesbar oder mehr als 100 Seiten'); }
    }
    if (ext === '.pptx' && !b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw fail(415, 'INVALID_SIGNATURE', 'Ungueltige Praesentationsdatei');
    if (ext === '.odp' && (!b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) || !b.includes(Buffer.from('application/vnd.oasis.opendocument.presentation')))) throw fail(415, 'INVALID_SIGNATURE', 'Ungueltige ODP-Datei');
    if (ext === '.ppt' && !b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw fail(415, 'INVALID_SIGNATURE', 'Ungueltige PPT-Datei');
    return ext;
  }
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  function cleanup() {
    const refs = protectedAssets(), deleted = [], cutoff = Date.now() - 7 * 86400000;
    const dir = safe('bilder');
    if (fs.existsSync(dir)) for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = 'bilder/' + entry.name;
      if (!entry.isFile() || refs.has(rel)) continue;
      const target = safe(rel), stat = fs.statSync(target);
      if (Math.max(stat.mtimeMs, stat.birthtimeMs) < cutoff) { fs.unlinkSync(target); deleted.push(entry.name); }
    }
    return deleted;
  }
  function install(app, { requireLogin, konvertiereZuSeiten }) {
    const cleanupTimer = setInterval(() => { try { const deleted = cleanup(); console.log(JSON.stringify({ event: 'editor_cleanup', deleted: deleted.length })); } catch { console.error(JSON.stringify({ event: 'editor_cleanup_failed' })); } }, 60 * 60 * 1000);
    cleanupTimer.unref();
    app.locals.stopCMS = () => clearInterval(cleanupTimer);
    app.use((req, res, next) => {
      const started = Date.now();
      res.on('finish', () => console.log(JSON.stringify({ time: new Date().toISOString(), event: 'request', method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started })));
      next();
    });
    app.use('/api/mitteilungen', (req, res, next) => {
      if (['POST', 'PUT'].includes(req.method) && req.path !== '/reihenfolge') {
        if (typeof req.body.titel !== 'string' || !req.body.titel.trim() || typeof req.body.text !== 'string' || ['datum', 'bis'].some(key => req.body[key] != null && req.body[key] !== '' && (typeof req.body[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(req.body[key]) || !Number.isFinite(Date.parse(req.body[key]))))) return next(fail(400, 'INVALID_CONTENT', 'Titel, Text oder Datum ungueltig'));
      }
      if (req.method === 'PUT' && req.path === '/reihenfolge' && (!Array.isArray(req.body.ids) || new Set(req.body.ids.map(Number)).size !== req.body.ids.length || req.body.ids.some(id => !read('mitteilungen.json').some(m => m.id === Number(id))))) return next(fail(400, 'INVALID_ORDER', 'Ungueltige Reihenfolge'));
      next();
    });
    app.post('/api/geburtstage', (req, res, next) => {
      const day = Number(req.body.tag), month = Number(req.body.monat);
      if (typeof req.body.name !== 'string' || !req.body.name.trim() || !Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1 || day > new Date(2000, month, 0).getDate()) return next(fail(400, 'INVALID_BIRTHDAY', 'Ungueltiger Geburtstag'));
      next();
    });
    app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
    app.put('/api/password', requireLogin, wrap((req, res) => {
      if (!verifyPassword(req.body.currentPassword)) throw fail(403, 'WRONG_PASSWORD', 'Aktuelles Passwort ist falsch');
      const password = req.body.newPassword;
      if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw fail(400, 'INVALID_PASSWORD', 'Passwort muss 8 bis 1024 Zeichen enthalten');
      const generation = credentials().generation + 1;
      atomic('password.json', { ...hash(password), generation });
      req.session.generation = generation;
      res.json({ ok: true });
    }));
    app.get('/api/files', requireLogin, wrap((req, res) => {
      const rel = req.query.path || '';
      const entries = fs.readdirSync(safe(rel), { withFileTypes: true });
      res.json({ ordner: entries.filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name), dateien: entries.filter(e => e.isFile()).map(e => metadata(path.posix.join(rel, e.name))) });
    }));
    app.post('/api/files', requireLogin, upload.single('datei'), wrap(async (req, res) => {
      await validate(req.file, 'any');
      const rel = path.posix.join(req.query.path || '', filename(req.file.originalname));
      fs.writeFileSync(safe(rel), req.file.buffer, { flag: 'wx' });
      res.status(201).json(metadata(rel));
    }));
    app.put('/api/files', requireLogin, wrap((req, res) => {
      const from = path.posix.join(req.body.path || '', filename(req.body.name));
      const to = path.posix.join(req.body.path || '', filename(req.body.newName));
      const source = safe(from), target = safe(to);
      assertFree([from]);
      if (path.extname(from).toLowerCase() !== path.extname(to).toLowerCase()) throw fail(400, 'INVALID_TYPE', 'Dateiendung darf nicht geaendert werden');
      if (!fs.statSync(source).isFile()) throw fail(400, 'INVALID_FILE', 'Keine Datei');
      if (fs.existsSync(target)) throw fail(409, 'FILE_EXISTS', 'Datei existiert bereits');
      fs.renameSync(source, target);
      res.json(metadata(to));
    }));
    app.delete('/api/files', requireLogin, wrap((req, res) => {
      const names = req.body.names || [req.body.name];
      if (!Array.isArray(names) || !names.length) throw fail(400, 'INVALID_NAMES', 'Dateinamen fehlen');
      const rels = [...new Set(names.map(n => path.posix.join(req.body.path || '', filename(n))))];
      const targets = rels.map(rel => safe(rel));
      for (const target of targets) if (!fs.statSync(target).isFile()) throw fail(400, 'INVALID_FILE', 'Keine Datei');
      assertFree(rels);
      targets.forEach(target => fs.unlinkSync(target));
      res.json({ ok: true, deleted: rels });
    }));
    app.post('/api/bilder', requireLogin, upload.single('bild'), wrap(async (req, res) => {
      const ext = await validate(req.file, 'image');
      const rel = 'bilder/' + crypto.randomUUID() + ext;
      fs.mkdirSync(safe('bilder'), { recursive: true });
      fs.writeFileSync(safe(rel), req.file.buffer, { flag: 'wx' });
      res.status(201).json(metadata(rel));
    }));
    function profiles() { return read('steckbriefe.json').map((sb, index) => { const seiten = sb.seiten || (sb.bild ? [sb.bild] : []); let info = {}; try { info = metadata('steckbriefe/' + sb.dateiname); } catch {} return { ...sb, seiten, position: sb.position ?? index, bytes: sb.bytes ?? info.bytes ?? null, uploadedAt: sb.uploadedAt || info.uploadedAt || null, originalName: sb.originalName || sb.dateiname, pages: seiten.length }; }).sort((a, b) => a.position - b.position); }
    app.get('/api/steckbriefe', requireLogin, (req, res) => res.json(profiles()));
    app.put('/api/steckbriefe/reihenfolge', requireLogin, wrap((req, res) => {
      const list = profiles(), ids = req.body.ids;
      if (!Array.isArray(ids) || ids.length !== list.length || new Set(ids.map(String)).size !== list.length || ids.some(id => !list.some(sb => String(sb.id) === String(id)))) throw fail(400, 'INVALID_ORDER', 'Alle IDs genau einmal angeben');
      const ordered = ids.map((id, position) => ({ ...list.find(sb => String(sb.id) === String(id)), position }));
      save('steckbriefe.json', ordered); res.json(ordered);
    }));
    app.put('/api/steckbriefe/:id', requireLogin, wrap((req, res) => {
      const list = profiles(), sb = list.find(s => String(s.id) === req.params.id);
      if (!sb) throw fail(404, 'NOT_FOUND', 'Steckbrief nicht gefunden');
      if ('name' in req.body) { if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 200) throw fail(400, 'INVALID_NAME', 'Titel fehlt oder ist zu lang'); sb.name = req.body.name.trim(); }
      if ('sichtbar' in req.body) { if (typeof req.body.sichtbar !== 'boolean') throw fail(400, 'INVALID_VISIBILITY', 'sichtbar muss boolean sein'); sb.sichtbar = req.body.sichtbar; }
      save('steckbriefe.json', list); res.json(sb);
    }));
    async function profileUpload(req, res) {
      if (req.params.id && !profiles().some(s => String(s.id) === req.params.id)) throw fail(404, 'NOT_FOUND', 'Steckbrief nicht gefunden');
      const ext = await validate(req.file, 'profile');
      const unique = crypto.randomUUID(), stored = unique + ext;
      const directory = safe('steckbriefe');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(safe('steckbriefe/' + stored), req.file.buffer, { flag: 'wx' });
      try {
        const { seiten, warnungen } = await konvertiereZuSeiten(path.join(directory, stored), directory);
        if (!seiten.length) throw fail(422, 'CONVERSION_FAILED', 'Keine Seiten erzeugt: ' + warnungen.join('; '));
        const list = profiles();
        let sb = req.params.id ? list.find(s => String(s.id) === req.params.id) : null;
        if (req.params.id && !sb) throw fail(409, 'CONCURRENT_CHANGE', 'Steckbrief wurde inzwischen entfernt');
        if (!sb) { sb = { id: Date.now() * 1000 + crypto.randomInt(1000), name: String(req.body.name || req.file.originalname).slice(0, 200), sichtbar: true, position: list.length }; list.push(sb); }
        Object.assign(sb, { dateiname: stored, seiten, originalName: req.file.originalname, bytes: req.file.size, uploadedAt: new Date().toISOString(), pages: seiten.length });
        delete sb.bild;
        save('steckbriefe.json', list); res.json({ ...sb, warnungen });
      } catch (err) { for (const name of fs.readdirSync(directory).filter(n => n.startsWith(unique))) fs.unlinkSync(safe('steckbriefe/' + name)); throw err; }
    }
    app.post('/api/steckbriefe', requireLogin, upload.single('datei'), wrap(profileUpload));
    app.post('/api/steckbriefe/:id/replace', requireLogin, upload.single('datei'), wrap(profileUpload));
    app.delete('/api/steckbriefe/:id', requireLogin, wrap((req, res) => {
      const list = profiles();
      if (!list.some(s => String(s.id) === req.params.id)) throw fail(404, 'NOT_FOUND', 'Steckbrief nicht gefunden');
      save('steckbriefe.json', list.filter(s => String(s.id) !== req.params.id)); res.json({ ok: true });
    }));
    app.get('/api/versions', requireLogin, wrap((req, res) => res.json(versions().map(({ id, createdAt }) => ({ id, createdAt })).reverse())));
    function revision(id) { const v = versions().find(v => v.id === id); if (!v) throw fail(404, 'NOT_FOUND', 'Version nicht gefunden'); return v; }
    app.get('/api/versions/:id', requireLogin, wrap((req, res) => res.json(revision(req.params.id))));
    app.post('/api/versions/:id/restore', requireLogin, wrap((req, res) => {
      const v = revision(req.params.id);
      const missing = [...assets(v.content)].filter(rel => { try { return !fs.statSync(safe(rel)).isFile(); } catch { return true; } });
      if (missing.length) throw fail(409, 'MISSING_ASSETS', 'Assets fehlen: ' + missing.join(', '));
      const history = versions(); history.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), content: snapshot() }); atomic('versions.json', history.slice(-100));
      for (const name of contentFiles) atomic(name, v.content[name]);
      res.json({ ok: true, id: v.id });
    }));
    app.post('/api/bilder/cleanup', requireLogin, wrap((req, res) => {
      const deleted = cleanup();
      res.json({ ok: true, deleted, graceDays: 7 });
    }));
    app.use('/uploads', wrap((req, res) => {
      const rel = decodeURIComponent(req.path).replace(/^\//, '');
      const target = safe(rel), info = metadata(rel);
      if (!fs.statSync(target).isFile()) throw fail(404, 'NOT_FOUND', 'Datei nicht gefunden');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', "default-src 'none'; sandbox");
      res.type(info.type);
      if (!/^(image\/(png|jpeg|gif|webp)|video\/mp4|audio\/mpeg|application\/pdf)$/.test(info.type)) res.attachment(info.name);
      res.sendFile(target);
    }));
  }
  function errors(app) {
    app.use((err, req, res, next) => {
      const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.code === 'EEXIST' ? 409 : err.code === 'ENOENT' ? 404 : err instanceof multer.MulterError ? 400 : 500);
      console.error(JSON.stringify({ time: new Date().toISOString(), event: 'error', code: err.code || 'INTERNAL_ERROR', status }));
      res.status(status).json({ error: status === 500 ? 'Interner Serverfehler' : err.message, code: err.code || 'INTERNAL_ERROR' });
    });
  }
  return { atomic, read, save, install, errors, verifyPassword, validSession, generation: () => credentials().generation };
};
