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

// WMO-Codes von Open-Meteo. Bewusst als SVG statt Emoji: Emoji fehlen auf
// vielen Linux-Systemen und erscheinen dann als leeres Kaestchen.
function wetterIcon(code) {
    const sonne = '<circle cx="12" cy="12" r="5" fill="#FDB813"/>'
        + '<g stroke="#FDB813" stroke-width="2" stroke-linecap="round">'
        + '<path d="M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1"/></g>';
    const wolke = '<path d="M7 19h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.6A3.7 3.7 0 0 0 7 19z" fill="#E8EDF3"/>';
    const wolkeDunkel = '<path d="M7 19h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.6A3.7 3.7 0 0 0 7 19z" fill="#B9C3D0"/>';
    const regen = '<g stroke="#4FA3E3" stroke-width="2" stroke-linecap="round">'
        + '<path d="M8 20.5l-1 2.5M12 20.5l-1 2.5M16 20.5l-1 2.5"/></g>';
    const schnee = '<g stroke="#8ECDF5" stroke-width="2" stroke-linecap="round">'
        + '<path d="M8 21h.01M12 22h.01M16 21h.01"/></g>';
    const blitz = '<path d="M13 13l-4 6h3l-1 4 4-6h-3z" fill="#FDB813"/>';

    let inhalt;
    if (code === 0) inhalt = sonne;
    else if (code <= 2) inhalt = '<g transform="translate(-2 -2) scale(0.8)">' + sonne + '</g>' + wolke;
    else if (code <= 3) inhalt = wolkeDunkel;
    else if (code <= 48) inhalt = '<g stroke="#B9C3D0" stroke-width="2" stroke-linecap="round">'
        + '<path d="M3 9h18M3 13h18M5 17h14"/></g>';
    else if (code <= 67) inhalt = wolke + regen;
    else if (code <= 77) inhalt = wolke + schnee;
    else if (code <= 82) inhalt = wolkeDunkel + regen;
    else if (code <= 86) inhalt = wolke + schnee;
    else inhalt = wolkeDunkel + blitz;

    return `<svg class="wetter-icon" viewBox="0 0 24 26" aria-hidden="true">${inhalt}</svg>`;
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

const WETTER_DIREKT = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=48.7665&longitude=11.4258'
    + '&current=temperature_2m,weather_code&timezone=Europe%2FBerlin';

async function ladeWetter() {
    if (!einstellungen.wetter) { wetter = null; zeichneLeiste(); return; }

    try {
        const res = await fetch('/api/public/wetter');
        const daten = await res.json();
        if (!daten.fehler) {
            wetter = daten;
            zeichneLeiste();
            return;
        }
        console.warn('Wetter ueber den Server fehlgeschlagen:', daten.grund);
    } catch (err) {
        console.warn('Wetter ueber den Server nicht erreichbar:', err.message);
    }

    // Zweiter Versuch direkt aus dem Browser - hilft, wenn der Server nicht
    // ins Internet kommt, das Anzeigegeraet aber schon.
    try {
        const res = await fetch(WETTER_DIREKT);
        const roh = await res.json();
        wetter = { grad: Math.round(roh.current.temperature_2m), code: roh.current.weather_code };
    } catch (err) {
        console.warn('Wetter auch direkt nicht erreichbar:', err.message);
        wetter = null;
    }
    zeichneLeiste();
}

async function ladeInhalte() {
    try {
        const res = await fetch('/api/public/content');
        const daten = await res.json();

        const stand = JSON.stringify(daten);
        if (stand === letzterStand) return;

        letzterStand = stand;
        // Zu viele Mitteilungen fuer eine Seite werden auf mehrere verteilt,
        // sonst laufen die unteren Zettel aus dem Bild.
        slides = daten.flatMap(s => {
            if (s.typ !== 'termine') return [s];
            const seiten = teileAufSeiten(s.eintraege || []);
            return seiten.map((eintraege, i) => ({
                typ: 'termine', eintraege, seite: i + 1, seiten: seiten.length
            }));
        });
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
        document.body.classList.remove('mit-leiste');
        return;
    }
    document.body.classList.add('mit-leiste');

    const jetzt = new Date();
    const uhr = jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const datum = jetzt.toLocaleDateString('de-DE',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const wetterTeil = (einstellungen.wetter && wetter)
        ? `<span class="leiste-wetter">${wetterIcon(wetter.code)}<span>${wetter.grad}°C</span>
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

// Wie viel Platz ein Zettel ungefaehr braucht. Ein Bild wiegt schwerer als
// eine Zeile Text, deshalb wird nicht stumpf nach Anzahl aufgeteilt.
function gewicht(m) {
    const text = String(m.text || '');
    let g = 1;
    g += text.length / 220;                                  // Textmenge
    g += (text.match(/\n/g) || []).length / 6;                // Zeilenumbrueche
    g += (text.match(/<img|!\[/g) || []).length * 1.6;        // Bilder
    g += (text.match(/<iframe/g) || []).length * 2;           // Einbettungen
    g += (text.match(/^\s*[-*+]\s|^\s*\d+\.\s/gm) || []).length / 4; // Listen
    return g;
}

// Auf so viele Seiten verteilen, dass nichts unten aus dem Bild laeuft.
const PLATZ_JE_SEITE = 7;

function teileAufSeiten(eintraege) {
    const seiten = [];
    let laufend = [];
    let summe = 0;

    eintraege.forEach(m => {
        const g = Math.min(gewicht(m), PLATZ_JE_SEITE);
        // Passt der Zettel nicht mehr drauf, faengt eine neue Seite an.
        if (laufend.length && summe + g > PLATZ_JE_SEITE) {
            seiten.push(laufend);
            laufend = [];
            summe = 0;
        }
        laufend.push(m);
        summe += g;
    });

    if (laufend.length) seiten.push(laufend);
    return seiten.length ? seiten : [[]];
}

function zettel(m) {
    // Der Text darf Markdown und einfaches HTML enthalten, deshalb kein
    // escape() - inhaltZuHtml raeumt stattdessen auf, was nicht erlaubt ist.
    return `
        <article class="zettel">
            ${m.datum ? `<span class="datum">${datumFormatiert(m.datum)}</span>` : ''}
            <h2>${escape(m.titel)}</h2>
            <div class="inhalt">${window.inhaltZuHtml(m.text)}</div>
        </article>
    `;
}

function wand(eyebrow, titel, inhalt, zusatz) {
    return `
        <div class="wand">
            <header class="wand-kopf">
                <div>
                    <span class="eyebrow">${escape(eyebrow)}</span>
                    <h1>${escape(titel)}</h1>
                </div>
                ${zusatz || ''}
            </header>
            ${inhalt}
            <span class="klassifizierung">Internal</span>
        </div>
    `;
}

function pinnwand(eintraege, seite, seiten) {
    const inhalt = eintraege.length
        ? eintraege.map(zettel).join('')
        : '<p class="wand-leer">Zurzeit nichts angepinnt.</p>';

    const zaehler = seiten > 1
        ? `<span class="wand-seite">${seite} / ${seiten}</span>`
        : '';

    return wand('Ereignisse', MONATE[new Date().getMonth()],
        `<div class="zettel-feld">${inhalt}</div>`, zaehler);
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
    if (slides.length === 0) return pinnwand([], 1, 1);

    const slide = slides[aktuellerIndex];
    if (slide.typ === 'steckbrief') {
        return `<img src="${escape(slide.bild)}" alt="${escape(slide.name)}">`;
    }
    if (slide.typ === 'termine') return pinnwand(slide.eintraege || [], slide.seite, slide.seiten);
    if (slide.typ === 'geburtstage') return geburtstagswand(slide.eintraege || []);
    if (slide.typ === 'kalender') return kalenderwand(slide);
    if (slide.titel) return pinnwand([slide], 1, 1);
    return pinnwand([], 1, 1);
}

// Bilder erst laden, dann einblenden. Sonst haengt kurz ein leerer Rahmen im
// Bild, waehrend die Datei noch uebertragen wird.
async function warteAufBilder(ebene) {
    // Auch Bilder aus Mitteilungen, sonst springt das Layout mitten im
    // Uebergang, wenn ein eingebettetes Bild nachtraeglich Platz braucht.
    const bilder = [...ebene.querySelectorAll('img')];
    await Promise.all(bilder.map(img =>
        img.complete ? Promise.resolve() : img.decode().catch(() => {})
    ));
}

// Zaehlt jeden Zeichenvorgang mit. Waehrend auf Bilder gewartet wird, kann
// naemlich schon der naechste starten (Rotation und Inhalts-Update treffen sich).
// Ohne diese Sperre bleiben mehrere Ebenen liegen und scheinen durcheinander.
let zeichenLauf = 0;

// Alle Uebergaenge bewegen beide Ebenen gleichzeitig. Dadurch gibt es weder
// eine weisse Luecke (die alte Ebene bleibt bis zum Schluss stehen) noch zwei
// gleichzeitig lesbare Seiten (die Ebenen ueberlappen sich nie am selben Ort).
const UEBERGAENGE = {
    schieben: {
        alt: [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(-100%,0,0)' }],
        neu: [{ transform: 'translate3d(100%,0,0)' }, { transform: 'translate3d(0,0,0)' }],
        kurve: 'cubic-bezier(.65,0,.35,1)'
    },
    hoch: {
        alt: [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,-100%,0)' }],
        neu: [{ transform: 'translate3d(0,100%,0)' }, { transform: 'translate3d(0,0,0)' }],
        kurve: 'cubic-bezier(.65,0,.35,1)'
    }
};

function warte(ms) {
    return new Promise(aufloesen => setTimeout(aufloesen, ms));
}

// Aeltere Browser kennen element.animate nicht. Dann laeuft der Screen ohne
// Effekt weiter, statt beim ersten Wechsel abzustuerzen.
const KANN_ANIMIEREN = typeof Element !== 'undefined'
    && typeof Element.prototype.animate === 'function';

function animiere(element, bilder, optionen) {
    if (!KANN_ANIMIEREN) return Promise.resolve();
    return element.animate(bilder, optionen).finished.catch(() => {});
}

// Weiches Ab- und Aufblenden nacheinander statt uebereinander. So ist nie
// beides gleichzeitig lesbar und es blitzt trotzdem nichts hart auf.
async function blende(alteEbene, neueEbene, dauerMs) {
    neueEbene.style.opacity = '0';

    if (alteEbene) {
        await animiere(alteEbene, [{ opacity: 1 }, { opacity: 0 }],
            { duration: dauerMs / 2, easing: 'ease-in', fill: 'forwards' });
        alteEbene.remove();
    }

    await animiere(neueEbene, [{ opacity: 0 }, { opacity: 1 }],
        { duration: alteEbene ? dauerMs / 2 : dauerMs, easing: 'ease-out', fill: 'forwards' });

    neueEbene.style.opacity = '';
}

async function schiebe(alteEbene, neueEbene, dauerMs, art) {
    const { alt, neu, kurve } = UEBERGAENGE[art];
    const optionen = { duration: dauerMs, easing: kurve, fill: 'forwards' };

    const laeufe = [animiere(neueEbene, neu, optionen)];
    if (alteEbene) laeufe.push(animiere(alteEbene, alt, optionen));

    await Promise.all(laeufe);
    if (alteEbene) alteEbene.remove();
}

async function zeigeAktuelleSlide() {
    const container = document.getElementById('slide');
    const meinLauf = ++zeichenLauf;

    const neueEbene = document.createElement('div');
    neueEbene.className = 'ebene';
    neueEbene.innerHTML = slideInhalt();

    // Bilder und Schriften vorher fertig laden, sonst ruckelt der Uebergang
    // oder der Text springt mitten in der Bewegung um.
    await warteAufBilder(neueEbene);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    if (meinLauf !== zeichenLauf) return;

    const alteEbene = container.lastElementChild;
    const dauerMs = einstellungen.effektdauer * 1000;
    const effekt = einstellungen.effekt;

    // Die neue Ebene wird eingehaengt, waehrend die alte noch steht.
    container.appendChild(neueEbene);

    // Einen Frame warten, damit der Browser die neue Ebene fertig aufgebaut
    // hat, bevor die Bewegung startet - sonst hakt das erste Bild.
    await new Promise(requestAnimationFrame);
    if (meinLauf !== zeichenLauf) { neueEbene.remove(); return; }

    if (effekt === 'keiner' || !dauerMs) {
        if (alteEbene) alteEbene.remove();
        return;
    }

    if (effekt === 'schieben' || effekt === 'hoch') {
        await schiebe(alteEbene, neueEbene, dauerMs, effekt);
    } else {
        await blende(alteEbene, neueEbene, dauerMs);
    }

    // Falls waehrend der Bewegung schon wieder gewechselt wurde, raeumt der
    // neuere Durchgang auf - hier bleibt nur die eigene Ebene stehen.
    if (meinLauf === zeichenLauf) {
        [...container.children].forEach(e => { if (e !== neueEbene) e.remove(); });
    }
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
