const SLIDE_INTERVAL_MS = 8000;   // wie lange eine Slide gezeigt wird
const POLL_INTERVAL_MS = 15000;   // wie oft neu beim Server nachgefragt wird

let slides = [];
let aktuellerIndex = 0;

async function ladeInhalte() {
    try {
        const res = await fetch('/api/public/content');
        slides = await res.json();
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
    } else {
        el.innerHTML = `
            <div class="mitteilung-slide">
                <h1>${slide.titel}</h1>
                <p>${slide.text}</p>
                ${slide.datum ? `<p class="datum">${slide.datum}</p>` : ''}
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
