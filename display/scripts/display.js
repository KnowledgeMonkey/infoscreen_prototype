const SLIDE_INTERVAL_MS = 8000;   // wie lange eine Slide gezeigt wird
const POLL_INTERVAL_MS = 15000;   // wie oft neu beim Server nachgefragt wird

let slides = [];
let aktuellerIndex = 0;

// Baut aus den Roh-Inhalten die Slide-Liste:
//  - jeder Steckbrief ist eine eigene Vollbild-Slide
//  - ALLE Mitteilungen/Termine kommen zusammen auf eine einzige Slide
function baueSlides(inhalte) {
    const steckbriefe = inhalte.filter(i => i.typ === 'steckbrief');
    const termine = inhalte.filter(i => i.typ === 'mitteilung');

    const neueSlides = steckbriefe.map(sb => ({ typ: 'steckbrief', name: sb.name, bild: sb.bild }));

    if (termine.length > 0) {
        neueSlides.push({ typ: 'termine', eintraege: termine });
    }

    return neueSlides;
}

async function ladeInhalte() {
    try {
        const res = await fetch('/api/public/content');
        const inhalte = await res.json();
        slides = baueSlides(inhalte);
        if (aktuellerIndex >= slides.length) aktuellerIndex = 0;
    } catch (err) {
        console.error('Konnte Inhalte nicht laden:', err);
    }
}

function zeigeAktuelleSlide() {
    const el = document.getElementById('slide');

    if (slides.length === 0) {
        el.innerHTML = '';
        return;
    }

    const slide = slides[aktuellerIndex];

    if (slide.typ === 'steckbrief') {
        el.innerHTML = `<img src="${slide.bild}" alt="${slide.name}">`;
    } else if (slide.typ === 'termine') {
        const eintraege = slide.eintraege.map(t => `
            <div class="termin">
                <div class="termin-kopf">
                    <h2>${t.titel}</h2>
                    ${t.datum ? `<span class="datum">${t.datum}</span>` : ''}
                </div>
                <p>${t.text}</p>
            </div>
        `).join('');

        el.innerHTML = `
            <div class="termine-slide">
                <h1>Mitteilungen &amp; Termine</h1>
                <div class="termine-liste">${eintraege}</div>
            </div>
        `;
    }
}

function naechsteSlide() {
    if (slides.length === 0) return;
    aktuellerIndex = (aktuellerIndex + 1) % slides.length;
    zeigeAktuelleSlide();
}

ladeInhalte().then(zeigeAktuelleSlide);
setInterval(naechsteSlide, SLIDE_INTERVAL_MS);
setInterval(ladeInhalte, POLL_INTERVAL_MS);
