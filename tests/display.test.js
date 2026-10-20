const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../display/scripts/display.js'), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, '../display/sw.js'), 'utf8');
const settings = { effekt: 'keiner', anzeigedauer: 8, effektdauer: 0, uhrleiste: true, wetter: true };
const content = [{ typ: 'termine', eintraege: [{ titel: '<Hello>', text: 'Body' }] },
    { typ: 'steckbrief', bild: '/uploads/steckbriefe/a.png', name: 'A&B' }];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(storage = new Map(), blocked = false) {
    class Element {
        constructor() { this.children = []; this.style = {}; this.classList = { add() {}, remove() {} }; }
        appendChild(child) { child.parent = this; this.children.push(child); }
        remove() { this.parent.children = this.parent.children.filter(x => x !== this); }
        get lastElementChild() { return this.children.at(-1); }
        querySelectorAll() { return []; }
    }
    const nodes = Object.fromEntries(['slide', 'leiste', 'offline-status'].map(id => [id, new Element()]));
    const events = {}, intervals = new Map();
    let timer = 0;
    const ctx = vm.createContext({ console: { error() {}, warn() {} }, Element, AbortController,
        navigator: { onLine: true },
        document: { getElementById: id => nodes[id], createElement: () => new Element(), body: new Element() },
        localStorage: { getItem: key => { if (blocked) throw Error(); return storage.get(key) || null; },
            setItem: (key, value) => { if (blocked) throw Error(); storage.set(key, value); } },
        setInterval: (fn, ms) => { intervals.set(++timer, { fn, ms }); return timer; },
        clearInterval: id => intervals.delete(id), setTimeout: () => ++timer, clearTimeout() {},
        requestAnimationFrame: fn => fn(), fetch: async () => { throw Error('offline'); },
        inhaltZuHtml: text => `rendered:${text}`, addEventListener: (name, fn) => { events[name] = fn; } });
    ctx.window = ctx;
    vm.runInContext(source, ctx);
    return { ctx, nodes, storage, events, intervals, run: code => vm.runInContext(code, ctx) };
}
function online(h) {
    h.ctx.fetch = async url => ({ ok: true, json: async () => url.endsWith('/content') ? content
        : url.endsWith('/einstellungen') ? { ...settings } : { grad: 18, code: 2 } });
}
async function refresh(h) { await h.run('Promise.all([ladeInhalte(), ladeEinstellungen(), ladeWetter()])'); await flush(); }

test('successful render, rotation, persistence and immediate offline reload', async () => {
    const h = harness(); await flush(); online(h); await refresh(h);
    assert.match(h.nodes.slide.lastElementChild.innerHTML, /&lt;Hello&gt;/);
    assert.match(h.nodes.slide.lastElementChild.innerHTML, /rendered:Body/);
    h.run('naechsteSlide()'); await flush();
    assert.match(h.nodes.slide.lastElementChild.innerHTML, /a.png.*A&amp;B/);
    assert.equal(h.storage.size, 3);
    const reload = harness(h.storage); await flush();
    assert.match(reload.nodes.slide.lastElementChild.innerHTML, /Hello/);
    assert.match(reload.nodes.leiste.innerHTML, /18°C/);
    assert.match(reload.nodes['offline-status'].textContent, /gespeicherter Stand/);
    assert.equal(reload.nodes.slide.children.length, 1);
    assert.ok([...reload.intervals.values()].some(x => x.ms === 8000));
});

test('HTTP errors, malformed payloads and JSON errors never overwrite snapshots; recovery clears stale state', async () => {
    const h = harness(); await flush(); online(h); await refresh(h);
    const saved = [...h.storage];
    for (const response of [{ ok: false, status: 503, json: async () => [] },
        { ok: true, json: async () => ({ broken: true }) }, { ok: true, json: async () => { throw Error('JSON'); } }]) {
        h.ctx.fetch = async () => response;
        await refresh(h);
        assert.deepEqual([...h.storage], saved);
        assert.match(h.nodes.slide.lastElementChild.innerHTML, /Hello/);
        assert.match(h.nodes.leiste.innerHTML, /gespeichert/);
    }
    online(h); await refresh(h);
    assert.equal(h.run('bestaetigt.inhalte && bestaetigt.einstellungen && bestaetigt.wetter'), true);
    assert.doesNotMatch(h.nodes['offline-status'].textContent, /gespeicherter Stand/);
});

test('corrupt or unavailable storage does not stop rendering; status independent of clock bar', async () => {
    for (const h of [harness(new Map([['infoscreen.display.v1.inhalte', '{']])), harness(new Map(), true)]) {
        await flush(); online(h); await refresh(h);
        assert.match(h.nodes.slide.lastElementChild.innerHTML, /Hello/);
        h.run('einstellungen.uhrleiste = false; zeichneLeiste()');
        h.ctx.navigator.onLine = false; h.events.offline();
        assert.equal(h.nodes.leiste.hidden, true);
        assert.match(h.nodes['offline-status'].textContent, /Offline/);
    }
});

test('calendar, birthday, pagination, empty content and overlapping renders', async () => {
    const h = harness(); await flush();
    assert.match(h.run("kalenderwand({jahr:2024,monat:2,heute:29,termine:[{datum:'2024-02-29',titel:'<Event>'}],geburtstage:[]})"), /&lt;Event&gt;/);
    assert.match(h.run("geburtstagswand([{name:'<Name>',tag:1,monat:2,heute:true}])"), /&lt;Name&gt;/);
    assert.equal(h.run('teileAufSeiten(Array.from({length:15}, () => ({text:""}))).length'), 3);
    h.run('uebernehmeInhalte([])'); await flush();
    assert.match(h.nodes.slide.lastElementChild.innerHTML, /nichts angepinnt/);
    h.run('zeigeAktuelleSlide(); zeigeAktuelleSlide(); zeigeAktuelleSlide()'); await flush();
    assert.equal(h.nodes.slide.children.length, 1);
});

test('weather uses direct fallback and saved weather when both sources fail', async () => {
    const h = harness(); await flush();
    h.ctx.fetch = async url => ({ ok: true, json: async () => url.startsWith('https:')
        ? { current: { temperature_2m: 21.4, weather_code: 3 } } : { fehler: true } });
    await h.run('ladeWetter()');
    assert.equal(h.run('wetter.grad'), 21);
    h.ctx.fetch = async () => { throw Error(); };
    await h.run('ladeWetter()');
    assert.equal(h.run('wetter.grad'), 21);
    assert.equal(h.run('bestaetigt.wetter'), false);
});

test('worker caches shell dependencies and raster images only; supports offline fallback', async () => {
    const handlers = {}, stores = new Map();
    const key = r => typeof r === 'string' ? r : r.url;
    const caches = { open: async name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name);
        return { addAll: async urls => urls.forEach(url => store.set(url, 'shell')),
            match: async r => store.get(key(r)), put: async (r, value) => store.set(key(r), value),
            keys: async () => [...store.keys()], delete: async r => store.delete(key(r)) };
    } };
    const ctx = vm.createContext({ URL, Response, AbortController, setTimeout, clearTimeout, caches,
        self: { location: { origin: 'https://screen.test' }, clients: { claim: async () => {} },
            addEventListener: (name, fn) => { handlers[name] = fn; } },
        fetch: async () => new Response('image', { headers: { 'content-type': 'image/png' } }) });
    vm.runInContext(worker, ctx);
    let install; handlers.install({ waitUntil: p => { install = p; } }); await install;
    const shell = stores.get('infoscreen-display-shell-v1');
    for (const resource of ['/vendor/marked.js', '/vendor/purify.js', '/shared/inhalt.js?v=16', '/display/']) assert.ok(shell.has(resource));
    function request(pathname, destination = 'image', mode = 'cors') {
        let result;
        handlers.fetch({ request: { url: 'https://screen.test' + pathname, method: 'GET', destination, mode },
            respondWith: p => { result = p; } });
        return result;
    }
    for (const url of ['/api/public/content', '/api/einstellungen', '/uploads/bilder/test.html', '/uploads/bilder/test.svg']) assert.equal(request(url), undefined);
    assert.equal(request('/uploads/bilder/test.png', 'iframe', 'navigate'), undefined);
    assert.equal((await request('/uploads/bilder/test.png')).status, 200);
    assert.equal((await request('/uploads/foo.png')).status, 200);
    ctx.fetch = async () => { throw Error('offline'); };
    assert.equal((await request('/uploads/bilder/test.png')).status, 200);
    assert.equal((await request('/uploads/foo.png')).status, 200);
    assert.equal(await request('/display/?screen=1', 'document', 'navigate'), 'shell');
    ctx.fetch = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    await request('/uploads/bilder/active.png');
    await request('/uploads/active.png');
    assert.equal(request('/uploads/active.html'), undefined);
    assert.equal(request('/uploads/active.svg'), undefined);
    assert.equal(request('/uploads/foo.png', 'document', 'navigate'), undefined);
    assert.equal(stores.get('infoscreen-display-images-v1').size, 2);
});

test('shell at unchanged URL updates online and falls back on errors and bounded timeout', async () => {
    const url = 'https://screen.test/display/scripts/display.js?v=16';
    const saved = new Map([[url, new Response('old')]]);
    let timeout, signal;
    const ctx = vm.createContext({ URL, Response, AbortController,
        setTimeout: (fn, ms) => { assert.equal(ms, 5000); timeout = fn; return 1; }, clearTimeout() {},
        self: { addEventListener() {} },
        caches: { open: async () => ({ match: async r => saved.get(r)?.clone(),
            put: async (r, response) => { saved.set(r, response); } }) },
        fetch: async (r, options) => { assert.equal(r, url); assert.equal(options.cache, 'no-store'); return new Response('new'); } });
    vm.runInContext(worker, ctx);
    const get = () => vm.runInContext(`shellAntwort(${JSON.stringify(url)})`, ctx);
    assert.equal(await (await get()).text(), 'new');
    assert.equal(await saved.get(url).clone().text(), 'new');
    for (const fetch of [async () => { throw Error('offline'); }, async () => new Response('error', { status: 503 })]) {
        ctx.fetch = fetch;
        assert.equal(await (await get()).text(), 'new');
    }
    // Headers arrive, but the body stalls indefinitely.
    ctx.fetch = async (_, options) => { signal = options.signal; return { ok: true, blob: () => new Promise(() => {}) }; };
    const pending = get(); await flush(); timeout();
    assert.equal(await (await pending).text(), 'new');
    assert.equal(signal.aborted, true);
    assert.equal(await saved.get(url).clone().text(), 'new');
});

test('backend disk weather is visibly stale and preserves its original timestamp', async () => {
    const h = harness(); await flush(); online(h); await refresh(h);
    const updatedAt = '2026-09-20T12:00:00.000Z';
    h.ctx.fetch = async () => ({ ok: true, json: async () => ({ grad: 12, code: 3, stale: true, updatedAt }) });
    await h.run('ladeWetter()');
    assert.equal(h.run('bestaetigt.wetter'), false);
    assert.equal(h.run('staende.wetter'), Date.parse(updatedAt));
    assert.match(h.nodes.leiste.innerHTML, /gespeichert/);
    assert.match(h.nodes['offline-status'].textContent, /Wetter: gespeicherter Stand/);
    const saved = JSON.parse(h.storage.get('infoscreen.display.v1.wetter'));
    assert.equal(saved.zeit, Date.parse(updatedAt));
    assert.equal(saved.daten.stale, true);
    online(h); await h.run('ladeWetter()');
    assert.equal(h.run('bestaetigt.wetter'), true);
    assert.doesNotMatch(h.nodes.leiste.innerHTML, /gespeichert/);
});
