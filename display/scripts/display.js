const POLL_INTERVAL_MS = 15000;   // wie oft neu beim Server nachgefragt wird

let slides = [];
let aktuellerIndex = 0;
let letzterStand = '';
let einstellungen = { effekt: 'fade', anzeigedauer: 8, effektdauer: 0.8 };
let wechselTimer = null;

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Titel und Texte kommen aus dem Dashboard - vor dem Einsetzen entschaerfen,
// sonst kann ein < im Text das Layout zerlegen.
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
    } catch (err) {
        console.error('Konnte Einstellungen nicht laden:', err);
    }
}

async function ladeInhalte() {
    try {
        const res = await fetch('/api/public/content');
        const daten = await res.json();

        // Nur neu zeichnen wenn sich wirklich was geaendert hat. Sonst wuerde
        // der Screen alle 15s neu aufbauen und der Effekt staendig neu laufen.
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

// ---------- Darstellung ----------

function zettel(m) {
    return `
        <article class="zettel">
            ${m.datum ? `<span class="datum">${datumFormatiert(m.datum)}</span>` : ''}
            <h2>${escape(m.titel)}</h2>
            <p>${escape(m.text)}</p>
        </article>
    `;
}

function pinnwand(eintraege) {
    const inhalt = eintraege.length
        ? eintraege.map(zettel).join('')
        : '<p class="wand-leer">Zurzeit nichts angepinnt.</p>';

    return `
        <div class="wand">
            <header class="wand-kopf">
                <span class="eyebrow">Ereignisse</span>
                <h1>${MONATE[new Date().getMonth()]}</h1>
            </header>
            <div class="zettel-feld">${inhalt}</div>
            <span class="klassifizierung">Internal</span>
        </div>
    `;
}

function zeigeAktuelleSlide() {
    const el = document.getElementById('slide');
    let inhalt;

    if (slides.length === 0) {
        inhalt = pinnwand([]);
    } else {
        const slide = slides[aktuellerIndex];
        if (slide.typ === 'steckbrief') {
            inhalt = `<img src="${escape(slide.bild)}" alt="${escape(slide.name)}">`;
        } else if (slide.typ === 'termine') {
            inhalt = pinnwand(slide.eintraege || []);
        } else if (slide.titel) {
            inhalt = pinnwand([slide]);
        } else {
            inhalt = pinnwand([]);
        }
    }

    el.innerHTML = inhalt;
    spieleEffekt(el.firstElementChild);
}

function spieleEffekt(element) {
    if (!element || einstellungen.effekt === 'keiner') return;
    element.style.setProperty('--fx-dauer', einstellungen.effektdauer + 's');
    element.classList.add('fx', 'fx-' + einstellungen.effekt);
}

// ---------- Ablauf ----------

function naechsteSlide() {
    // Bei nur einer Slide nicht neu zeichnen - sonst laeuft der Effekt dauernd.
    if (slides.length < 2) return;
    aktuellerIndex = (aktuellerIndex + 1) % slides.length;
    zeigeAktuelleSlide();
}

function starteWechsel() {
    if (wechselTimer) clearInterval(wechselTimer);
    wechselTimer = setInterval(naechsteSlide, einstellungen.anzeigedauer * 1000);
}

ladeEinstellungen().then(ladeInhalte);
setInterval(ladeInhalte, POLL_INTERVAL_MS);
setInterval(ladeEinstellungen, POLL_INTERVAL_MS);
