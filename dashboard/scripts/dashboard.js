// ---------- Rueckmeldung ----------

let toastTimer = null;

function hinweis(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function leerZeile(spalten, text) {
    return `<tr class="leer-zeile"><td colspan="${spalten}">${text}</td></tr>`;
}

// ---------- Tab-Umschaltung ----------

document.querySelectorAll('.sidebar a').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        const target = link.getAttribute('href').slice(1);

        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.hidden = panel.id !== target;
        });
        document.querySelectorAll('.sidebar a').forEach(a => {
            a.classList.toggle('active', a === link);
        });
    });
});

// ---------- Steckbriefe ----------

async function ladeSteckbriefe() {
    const res = await fetch('/api/steckbriefe');
    const steckbriefe = await res.json();

    const tbody = document.getElementById('steckbrief-tbody');
    document.getElementById('steckbrief-zaehler').textContent = steckbriefe.length;
    tbody.innerHTML = steckbriefe.length ? '' : leerZeile(3, 'Noch keine Dateien hochgeladen.');
    steckbriefe.forEach(sb => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sb.name}</td>
            <td>${(sb.seiten || []).length}</td>
            <td class="aktionen"><button class="delete-btn" data-id="${sb.id}">Löschen</button></td>
        `;
        tbody.appendChild(row);
    });
}

document.getElementById('steckbrief-tbody').addEventListener('click', async e => {
    if (e.target.classList.contains('delete-btn')) {
        await fetch('/api/steckbriefe/' + e.target.dataset.id, { method: 'DELETE' });
        ladeSteckbriefe();
    }
});

document.getElementById('upload-btn').addEventListener('click', () => {
    document.getElementById('steckbrief-input').click();
});

document.getElementById('steckbrief-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('datei', file);
    formData.append('name', file.name.replace(/\.[^/.]+$/, ''));

    hinweis('Wird hochgeladen und umgewandelt …');
    const res = await fetch('/api/steckbriefe', { method: 'POST', body: formData });
    const ergebnis = await res.json();
    e.target.value = '';

    // Wenn beim Umwandeln etwas schiefging, soll das hier stehen und nicht
    // nur im Serverfenster.
    if (ergebnis.warnungen && ergebnis.warnungen.length) {
        hinweis(ergebnis.warnungen.join(' '));
    } else {
        hinweis(`Hochgeladen – ${ergebnis.seiten.length} Seite(n) auf dem Screen.`);
    }
    ladeSteckbriefe();
});

// ---------- Mitteilungen & Termine ----------

async function ladeMitteilungen() {
    const res = await fetch('/api/mitteilungen');
    const mitteilungen = await res.json();

    const sortiert = [...mitteilungen].sort((a, b) => {
        if (!a.datum) return 1;
        if (!b.datum) return -1;
        return a.datum.localeCompare(b.datum);
    });

    const tbody = document.getElementById('mitteilung-tbody');
    document.getElementById('mitteilung-zaehler').textContent = sortiert.length;
    tbody.innerHTML = sortiert.length ? '' : leerZeile(4, 'Noch nichts angepinnt.');
    sortiert.forEach(m => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${m.titel}</td>
            <td>${m.datum || '-'}</td>
            <td>${m.bis || '-'}</td>
            <td class="aktionen">
                <button class="edit-btn" data-id="${m.id}">Bearbeiten</button>
                <button class="delete-btn" data-id="${m.id}">Löschen</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Merkt sich welche Mitteilung gerade bearbeitet wird (null = neue anlegen).
let bearbeiteId = null;

function starteBearbeiten(m) {
    bearbeiteId = m.id;
    document.getElementById('mitteilung-titel').value = m.titel;
    document.getElementById('mitteilung-text').value = m.text || '';
    document.getElementById('mitteilung-datum').value = m.datum || '';
    document.getElementById('mitteilung-bis').value = m.bis || '';
    document.getElementById('mitteilung-submit').textContent = 'Speichern';
    document.getElementById('mitteilung-abbrechen').hidden = false;
    document.getElementById('mitteilung-formular-titel').textContent = 'Mitteilung bearbeiten';
    document.getElementById('mitteilung-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function beendeBearbeiten() {
    bearbeiteId = null;
    document.getElementById('mitteilung-form').reset();
    document.getElementById('mitteilung-submit').textContent = 'Hinzufügen';
    document.getElementById('mitteilung-abbrechen').hidden = true;
    document.getElementById('mitteilung-formular-titel').textContent = 'Neue Mitteilung';
}

document.getElementById('mitteilung-abbrechen').addEventListener('click', beendeBearbeiten);

document.getElementById('mitteilung-form').addEventListener('submit', async e => {
    e.preventDefault();
    const titel = document.getElementById('mitteilung-titel').value;
    const text = document.getElementById('mitteilung-text').value;
    const datum = document.getElementById('mitteilung-datum').value || null;
    const bis = document.getElementById('mitteilung-bis').value || null;

    const ziel = bearbeiteId ? '/api/mitteilungen/' + bearbeiteId : '/api/mitteilungen';
    await fetch(ziel, {
        method: bearbeiteId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titel, text, datum, bis })
    });

    hinweis(bearbeiteId ? 'Mitteilung gespeichert.' : 'Mitteilung hinzugefügt.');
    beendeBearbeiten();
    ladeMitteilungen();
});

document.getElementById('mitteilung-tbody').addEventListener('click', async e => {
    const id = Number(e.target.dataset.id);

    if (e.target.classList.contains('delete-btn')) {
        if (bearbeiteId === id) beendeBearbeiten();
        await fetch('/api/mitteilungen/' + id, { method: 'DELETE' });
        ladeMitteilungen();
    }

    if (e.target.classList.contains('edit-btn')) {
        const res = await fetch('/api/mitteilungen');
        const eintrag = (await res.json()).find(m => m.id === id);
        if (eintrag) starteBearbeiten(eintrag);
    }
});

// ---------- File Manager ----------

let aktuellerPfad = '';

async function ladeDateien() {
    const res = await fetch('/api/files?path=' + encodeURIComponent(aktuellerPfad));
    const data = await res.json();

    const tbody = document.getElementById('file-tbody');
    tbody.innerHTML = (data.ordner.length || data.dateien.length)
        ? '' : leerZeile(4, 'Dieser Ordner ist leer.');

    data.ordner.forEach(name => {
        const row = document.createElement('tr');
        row.innerHTML = `<td class="folder-row">📁 ${name}</td><td>Ordner</td><td>-</td><td></td>`;
        row.querySelector('.folder-row').addEventListener('click', () => {
            aktuellerPfad = aktuellerPfad ? aktuellerPfad + '/' + name : name;
            renderBreadcrumb();
            ladeDateien();
        });
        tbody.appendChild(row);
    });

    data.dateien.forEach(d => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d.name}</td>
            <td>${d.name.split('.').pop().toUpperCase()}</td>
            <td>${d.groesseKB} KB</td>
            <td class="aktionen"><button class="delete-btn" data-name="${d.name}">Löschen</button></td>
        `;
        tbody.appendChild(row);
    });
}

function renderBreadcrumb() {
    const el = document.getElementById('file-breadcrumb');
    const teile = ['uploads', ...aktuellerPfad.split('/').filter(Boolean)];
    el.innerHTML = teile.map((teil, i) => `<span class="crumb" data-index="${i}">${teil}</span>`).join(' / ');
}

document.getElementById('file-breadcrumb').addEventListener('click', e => {
    if (e.target.classList.contains('crumb')) {
        const index = Number(e.target.dataset.index);
        aktuellerPfad = aktuellerPfad.split('/').filter(Boolean).slice(0, index).join('/');
        renderBreadcrumb();
        ladeDateien();
    }
});

document.getElementById('file-tbody').addEventListener('click', async e => {
    if (e.target.classList.contains('delete-btn')) {
        await fetch('/api/files', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: aktuellerPfad, name: e.target.dataset.name })
        });
        ladeDateien();
    }
});

document.getElementById('file-upload-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    console.log('Upload:', file.name);
    // File-Manager-Upload braucht noch einen eigenen /api/files POST-Endpoint,
    // machen wir als naechstes falls gebraucht - Steckbrief-Upload laeuft schon echt.
});

// ---------- Initial laden ----------

ladeSteckbriefe();
ladeMitteilungen();
renderBreadcrumb();
ladeDateien();

// ---------- Auto-Refresh ----------
// Alle 10s neu laden, damit Aenderungen von anderen Geraeten (z.B. Kollege
// legt am Handy eine Mitteilung an) auch ohne manuellen Reload auftauchen.
// Wichtig fuer einen Dauerbetrieb-Screen, der nie manuell aktualisiert wird.
setInterval(() => {
    ladeSteckbriefe();
    ladeDateien();
    // Nicht neu laden solange jemand tippt - sonst springt das Formular weg.
    if (bearbeiteId === null) ladeMitteilungen();
}, 10000);

// ---------- Einstellungen ----------

async function ladeEinstellungen() {
    const res = await fetch('/api/einstellungen');
    const e = await res.json();
    document.getElementById('effekt').value = e.effekt;
    document.getElementById('anzeigedauer').value = e.anzeigedauer;
    document.getElementById('effektdauer').value = e.effektdauer;
    ['uhrleiste', 'wetter', 'kalenderSlide', 'geburtstageSlide'].forEach(schluessel => {
        document.getElementById(schluessel).checked = Boolean(e[schluessel]);
    });
}

document.getElementById('einstellungen-form').addEventListener('submit', async e => {
    e.preventDefault();
    const res = await fetch('/api/einstellungen', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            effekt: document.getElementById('effekt').value,
            anzeigedauer: document.getElementById('anzeigedauer').value,
            effektdauer: document.getElementById('effektdauer').value,
            uhrleiste: document.getElementById('uhrleiste').checked,
            wetter: document.getElementById('wetter').checked,
            kalenderSlide: document.getElementById('kalenderSlide').checked,
            geburtstageSlide: document.getElementById('geburtstageSlide').checked
        })
    });
    const gespeichert = await res.json();

    // Server begrenzt die Werte - zurueckschreiben, damit man sieht was gilt.
    document.getElementById('anzeigedauer').value = gespeichert.anzeigedauer;
    document.getElementById('effektdauer').value = gespeichert.effektdauer;

    const status = document.getElementById('einstellungen-status');
    status.textContent = 'Gespeichert. Der Screen übernimmt es innerhalb von 15 Sekunden.';
    hinweis('Einstellungen gespeichert.');
    setTimeout(() => { status.textContent = ''; }, 5000);
});

ladeEinstellungen();


// ---------- Geburtstage ----------

async function ladeGeburtstage() {
    const res = await fetch('/api/geburtstage');
    const liste = (await res.json())
        .sort((a, b) => (a.monat * 100 + a.tag) - (b.monat * 100 + b.tag));

    const tbody = document.getElementById('geburtstag-tbody');
    document.getElementById('geburtstag-zaehler').textContent = liste.length;
    tbody.innerHTML = liste.length ? '' : leerZeile(3, 'Noch keine Geburtstage eingetragen.');

    liste.forEach(g => {
        const row = document.createElement('tr');
        const tag = String(g.tag).padStart(2, '0');
        const monat = String(g.monat).padStart(2, '0');
        row.innerHTML = `
            <td>${g.name}</td>
            <td>${tag}.${monat}.</td>
            <td class="aktionen"><button class="delete-btn" data-id="${g.id}">Löschen</button></td>
        `;
        tbody.appendChild(row);
    });
}

// Nimmt 07.10, 7.10, 07.10., 7/10 oder 07-10 entgegen - Hauptsache Tag zuerst.
// Aus dem Datumsfeld kommt immer JJJJ-MM-TT. Gespeichert werden nur Tag und
// Monat - welches Jahr jemand geboren ist, braucht der Screen nicht.
function leseTagMonat(eingabe) {
    const [, monat, tag] = String(eingabe).split('-').map(Number);
    if (!tag || !monat) return null;
    return { tag, monat };
}

document.getElementById('geburtstag-form').addEventListener('submit', async e => {
    e.preventDefault();
    const feld = document.getElementById('geburtstag-datum');
    const datum = leseTagMonat(feld.value);

    if (!datum) {
        hinweis('Bitte ein Datum auswählen.');
        feld.focus();
        return;
    }
    const { tag, monat } = datum;

    await fetch('/api/geburtstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('geburtstag-name').value,
            tag: Number(tag),
            monat: Number(monat)
        })
    });

    e.target.reset();
    hinweis('Geburtstag eingetragen.');
    ladeGeburtstage();
});

document.getElementById('geburtstag-tbody').addEventListener('click', async e => {
    if (e.target.classList.contains('delete-btn')) {
        await fetch('/api/geburtstage/' + e.target.dataset.id, { method: 'DELETE' });
        hinweis('Geburtstag entfernt.');
        ladeGeburtstage();
    }
});

// ---------- Vorschau ----------

function passeVorschauAn() {
    const rahmen = document.querySelector('.vorschau-rahmen');
    if (!rahmen) return;
    rahmen.style.setProperty('--vorschau-faktor', rahmen.clientWidth / 1920);
}

window.addEventListener('resize', passeVorschauAn);

function ladeVorschau() {
    passeVorschauAn();
    // Zeitstempel erzwingt eine frische Seite statt der zwischengespeicherten.
    document.getElementById('vorschau-frame').src = '/display/index.html?vorschau=' + Date.now();
}

document.getElementById('vorschau-neu').addEventListener('click', ladeVorschau);

// Erst laden wenn der Tab wirklich geoeffnet wird - der Screen soll nicht
// dauerhaft im Hintergrund mitlaufen.
document.querySelector('.sidebar a[href="#vorschau"]').addEventListener('click', ladeVorschau);

ladeGeburtstage();
