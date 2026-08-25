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
    tbody.innerHTML = '';
    steckbriefe.forEach(sb => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sb.name}</td>
            <td><button class="delete-btn" data-id="${sb.id}">Löschen</button></td>
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

    await fetch('/api/steckbriefe', { method: 'POST', body: formData });
    e.target.value = '';
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
    tbody.innerHTML = '';
    sortiert.forEach(m => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${m.titel}</td>
            <td>${m.datum || '-'}</td>
            <td><button class="delete-btn" data-id="${m.id}">Löschen</button></td>
        `;
        tbody.appendChild(row);
    });
}

document.getElementById('mitteilung-form').addEventListener('submit', async e => {
    e.preventDefault();
    const titel = document.getElementById('mitteilung-titel').value;
    const text = document.getElementById('mitteilung-text').value;
    const datum = document.getElementById('mitteilung-datum').value || null;

    await fetch('/api/mitteilungen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titel, text, datum })
    });

    e.target.reset();
    ladeMitteilungen();
});

document.getElementById('mitteilung-tbody').addEventListener('click', async e => {
    if (e.target.classList.contains('delete-btn')) {
        await fetch('/api/mitteilungen/' + e.target.dataset.id, { method: 'DELETE' });
        ladeMitteilungen();
    }
});

// ---------- File Manager ----------

let aktuellerPfad = '';

async function ladeDateien() {
    const res = await fetch('/api/files?path=' + encodeURIComponent(aktuellerPfad));
    const data = await res.json();

    const tbody = document.getElementById('file-tbody');
    tbody.innerHTML = '';

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
            <td><button class="delete-btn" data-name="${d.name}">Löschen</button></td>
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
    ladeMitteilungen();
    ladeDateien();
}, 10000);
