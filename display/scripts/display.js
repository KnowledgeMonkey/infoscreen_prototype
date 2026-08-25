const POLL_INTERVAL_MS = 15000;

let slides = [];
let aktuellerIndex = 0;
let letzterStand = '';
let einstellungen = { effekt: 'fade', anzeigedauer: 8, effektdauer: 0.8, uhrleiste: true, wetter: true };
let wechselTimer = null;
let wetter = null;

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// WMO-Codes von Open-Meteo, auf ein paar Symbole eingedampft.
function wetterSymbol(code) {
    if (code === 0) return '☀';
    if (code <= 2) return '⛅';
    if (code <= 3) return '☁';
    if (code <= 48) return '🌫';
    if (code <= 67) return '🌧';
    if (code <= 77) return '❄';
    if (code <= 82) return '🌧';
    if (code <= 86) return '❄';
    return '⛈';
}

function escape(text) {
    return String(text ?? '').replace(/[&<>"']/g, z => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[z]);
}

function datumFormatiert(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return escape(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            .replace(/\./g, '·');
}

// ---------- Laden ----------

async function ladeEinstellungen() {
    try {
        const res = await fetch('/api/public/einstellungen');
        const neu = await res.json();
        const dauerGeaendert = neu.anzeigedauer !== einstellungen.anzeigedauer;
        einstellungen = neu;
        if (dauerGeaendert || !wechselTimer) starteWechsel();
        zeichneLeiste();
    } catch (err) {
        console.error('Konnte Einstellungen nicht laden:', err);
    }
}

async function ladeWetter() {
    if (!einstellungen.wetter) return;
    try {
        const res = await fetch('/api/public/wetter');
        const daten = await res.json();
        wetter = daten.fehler ? null : daten;
        zeichneLeiste();
    } catch (err) {
        wetter = null;
    }
}

async function ladeInhalte() {
    try {
        const res = await fetch('/api/public/content');
        const daten = await res.json();

        const stand = JSON.stringify(daten);
        if (stand === letzterStand) return;

        letzterStand = stand;
        slides = daten;
        if (aktuellerIndex >= slides.length) aktuellerIndex = 0;
        zeigeAktuelleSlide();
    } catch (err) {
        console.error('Konnte Inhalte nicht laden:', err);
    }
}

// ---------- Leiste mit Uhrzeit, Datum und Wetter ----------

function zeichneLeiste() {
    const leiste = document.getElementById('leiste');
    if (!einstellungen.uhrleiste) {
        leiste.hidden = true;
        return;
    }

    const jetzt = new Date();
    const uhr = jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const datum = jetzt.toLocaleDateString('de-DE',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const wetterTeil = (einstellungen.wetter && wetter)
        ? `<span class="leiste-wetter">${wetterSymbol(wetter.code)} ${wetter.grad}°C
             <span class="leiste-ort">Ingolstadt</span></span>`
        : '';

    leiste.hidden = false;
    leiste.innerHTML = `
        <span class="leiste-uhr">${uhr}</span>
        <span class="leiste-datum">${datum}</span>
        ${wetterTeil}
    `;
}

// ---------- Slides ----------

function zettel(m) {
    return `
        <article class="zettel">
            ${m.datum ? `<span class="datum">${datumFormatiert(m.datum)}</span>` : ''}
            <h2>${escape(m.titel)}</h2>
            <p>${escape(m.text)}</p>
        </article>
    `;
}

function wand(eyebrow, titel, inhalt) {
    return `
        <div class="wand">
            <header class="wand-kopf">
                <span class="eyebrow">${escape(eyebrow)}</span>
                <h1>${escape(titel)}</h1>
            </header>
            ${inhalt}
            <span class="klassifizierung">Internal</span>
        </div>
    `;
}

function pinnwand(eintraege) {
    const inhalt = eintraege.length
        ? eintraege.map(zettel).join('')
        : '<p class="wand-leer">Zurzeit nichts angepinnt.</p>';
    return wand('Ereignisse', MONATE[new Date().getMonth()], `<div class="zettel-feld">${inhalt}</div>`);
}

function geburtstagswand(eintraege) {
    const karten = eintraege.map(g => `
        <article class="zettel ${g.heute ? 'zettel-heute' : ''}">
            <span class="datum">${String(g.tag).padStart(2, '0')}·${String(g.monat).padStart(2, '0')}</span>
            <h2>${escape(g.name)}</h2>
            ${g.heute ? '<p>Heute! Alles Gute</p>' : ''}
        </article>
    `).join('');
    return wand('Wir gratulieren', 'Geburtstage', `<div class="zettel-feld">${karten}</div>`);
}

function kalenderwand(slide) {
    // Montag als erster Wochentag.
    const ersterTag = (new Date(slide.jahr, slide.monat - 1, 1).getDay() + 6) % 7;
    const tageImMonat = new Date(slide.jahr, slide.monat, 0).getDate();

    const terminTage = new Map();
    slide.termine.forEach(t => {
        const tag = Number(t.datum.slice(8, 10));
        if (!terminTage.has(tag)) terminTage.set(tag, []);
        terminTage.get(tag).push(t.titel);
    });
    const gebTage = new Map();
    (slide.geburtstage || []).forEach(g => {
        if (!gebTage.has(g.tag)) gebTage.set(g.tag, []);
        gebTage.get(g.tag).push(g.name);
    });

    let zellen = WOCHENTAGE.map(t => `<div class="kal-kopf">${t}</div>`).join('');
    zellen += '<div class="kal-leer"></div>'.repeat(ersterTag);

    for (let tag = 1; tag <= tageImMonat; tag++) {
        const termine = terminTage.get(tag) || [];
        const geb = gebTage.get(tag) || [];
        const klassen = ['kal-tag'];
        if (tag === slide.heute) klassen.push('kal-heute');
        if (termine.length || geb.length) klassen.push('kal-markiert');

        const marken = [
            ...termine.map(t => `<span class="kal-marke">${escape(t)}</span>`),
            ...geb.map(n => `<span class="kal-marke kal-marke-geb">${escape(n)}</span>`)
        ].join('');

        zellen += `<div class="${klassen.join(' ')}"><span class="kal-zahl">${tag}</span>${marken}</div>`;
    }

    return wand('Übersicht', `${MONATE[slide.monat - 1]} ${slide.jahr}`,
        `<div class="kalender">${zellen}</div>`);
}

function slideInhalt() {
    if (slides.length === 0) return pinnwand([]);

    const slide = slides[aktuellerIndex];
    if (slide.typ === 'steckbrief') {
        return `<img src="${escape(slide.bild)}" alt="${escape(slide.name)}">`;
    }
    if (slide.typ === 'termine') return pinnwand(slide.eintraege || []);
    if (slide.typ === 'geburtstage') return geburtstagswand(slide.eintraege || []);
    if (slide.typ === 'kalender') return kalenderwand(slide);
    if (slide.titel) return pinnwand([slide]);
    return pinnwand([]);
}

// Bilder erst laden, dann einblenden. Sonst haengt kurz ein leerer Rahmen im
// Bild, waehrend die Datei noch uebertragen wird.
async function warteAufBilder(ebene) {
    const bilder = [...ebene.querySelectorAll('img')];
    await Promise.all(bilder.map(img =>
        img.complete ? Promise.resolve() : img.decode().catch(() => {})
    ));
}

async function zeigeAktuelleSlide() {
    const container = document.getElementById('slide');
    const alteEbenen = [...container.children];

    const neueEbene = document.createElement('div');
    neueEbene.className = 'ebene';
    neueEbene.innerHTML = slideInhalt();

    await warteAufBilder(neueEbene);

    // Die neue Ebene liegt ueber der alten und blendet ein - deshalb blitzt
    // zwischendurch nichts weiss auf.
    container.appendChild(neueEbene);
    const dauerMs = spieleEffekt(neueEbene);
    setTimeout(() => alteEbenen.forEach(e => e.remove()), dauerMs);
}

function spieleEffekt(element) {
    if (einstellungen.effekt === 'keiner' || !einstellungen.effektdauer) return 0;
    element.style.setProperty('--fx-dauer', einstellungen.effektdauer + 's');
    element.classList.add('fx', 'fx-' + einstellungen.effekt);
    return einstellungen.effektdauer * 1000;
}

function naechsteSlide() {
    if (slides.length < 2) return;
    aktuellerIndex = (aktuellerIndex + 1) % slides.length;
    zeigeAktuelleSlide();
}

function starteWechsel() {
    if (wechselTimer) clearInterval(wechselTimer);
    wechselTimer = setInterval(naechsteSlide, einstellungen.anzeigedauer * 1000);
}

ladeEinstellungen().then(() => { ladeInhalte(); ladeWetter(); });
setInterval(ladeInhalte, POLL_INTERVAL_MS);
setInterval(ladeEinstellungen, POLL_INTERVAL_MS);
setInterval(zeichneLeiste, 20000);
setInterval(ladeWetter, 15 * 60 * 1000);
