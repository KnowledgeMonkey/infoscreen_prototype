const SLIDE_INTERVAL_MS = 8000;   // wie lange eine Slide gezeigt wird
const POLL_INTERVAL_MS = 15000;   // wie oft neu beim Server nachgefragt wird

let slides = [];
let aktuellerIndex = 0;
let letzterStand = '';

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
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function ladeInhalte() {
    try {
        const res = await fetch('/api/public/content');
        const daten = await res.json();

        // Nur neu zeichnen wenn sich wirklich was geaendert hat. Sonst wuerde
        // der Screen alle 15s neu aufbauen und die Zettel neu einblenden.
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

function zettel(m) {
    return `
        <article class="zettel">
            <h2>${escape(m.titel)}</h2>
            <p>${escape(m.text)}</p>
            ${m.datum ? `<span class="datum">${datumFormatiert(m.datum)}</span>` : ''}
        </article>
    `;
}

function pinnwand(eintraege) {
    const inhalt = eintraege.length
        ? eintraege.map(zettel).join('')
        : '<p class="wand-leer">Zurzeit nichts angepinnt.</p>';

    return `
        <div class="wand">
            <header class="wand-kopf"><h1>Mitteilungen &amp; Termine</h1></header>
            <div class="zettel-feld">${inhalt}</div>
        </div>
    `;
}

function zeigeAktuelleSlide() {
    const el = document.getElementById('slide');

    if (slides.length === 0) {
        el.innerHTML = pinnwand([]);
        return;
    }

    const slide = slides[aktuellerIndex];

    if (slide.typ === 'steckbrief') {
        el.innerHTML = `<img src="${escape(slide.bild)}" alt="${escape(slide.name)}">`;
    } else if (slide.typ === 'termine') {
        el.innerHTML = pinnwand(slide.eintraege);
    }
}

function naechsteSlide() {
    // Bei nur einer Slide nicht neu zeichnen - sonst flackert sie dauernd.
    if (slides.length < 2) return;
    aktuellerIndex = (aktuellerIndex + 1) % slides.length;
    zeigeAktuelleSlide();
}

ladeInhalte();
setInterval(naechsteSlide, SLIDE_INTERVAL_MS);
setInterval(ladeInhalte, POLL_INTERVAL_MS);
