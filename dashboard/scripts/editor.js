/* Markdown-Editor mit Werkzeugleiste, Farbwahl, Bild-Upload und Vorschau. */
(function () {
    'use strict';

    const feld = document.getElementById('mitteilung-text');
    const leiste = document.getElementById('editor-leiste');
    const vorschau = document.getElementById('editor-vorschau');
    const bildFeld = document.getElementById('editor-bild');

    // Text um die Auswahl herum einsetzen und die Auswahl danach behalten,
    // damit man mehrere Formatierungen hintereinander anwenden kann.
    function umschliessen(vorn, hinten, platzhalter) {
        const start = feld.selectionStart;
        const ende = feld.selectionEnd;
        const ausgewaehlt = feld.value.slice(start, ende) || platzhalter || '';

        feld.setRangeText(vorn + ausgewaehlt + hinten, start, ende, 'end');
        feld.focus();

        // Auswahl auf den Inhalt zwischen den Markierungen legen.
        const neuStart = start + vorn.length;
        feld.setSelectionRange(neuStart, neuStart + ausgewaehlt.length);
        aktualisiereVorschau();
    }

    // Zeilenanfang markieren (Überschrift, Liste, Zitat).
    function zeilenPraefix(praefix) {
        const start = feld.selectionStart;
        const ende = feld.selectionEnd;
        const zeilenStart = feld.value.lastIndexOf('\n', start - 1) + 1;
        const zeilenEnde = feld.value.indexOf('\n', ende) === -1
            ? feld.value.length
            : feld.value.indexOf('\n', ende);

        const block = feld.value.slice(zeilenStart, zeilenEnde);
        const umgestellt = block.split('\n').map(zeile => {
            // Zweiter Klick nimmt die Markierung wieder weg.
            return zeile.startsWith(praefix) ? zeile.slice(praefix.length) : praefix + zeile;
        }).join('\n');

        feld.setRangeText(umgestellt, zeilenStart, zeilenEnde, 'end');
        feld.focus();
        aktualisiereVorschau();
    }

    function einfuegen(text) {
        const start = feld.selectionStart;
        feld.setRangeText(text, start, feld.selectionEnd, 'end');
        feld.focus();
        aktualisiereVorschau();
    }

    const WERKZEUGE = [
        { titel: 'Fett',          text: 'B',  stil: 'font-weight:700',      tun: () => umschliessen('**', '**', 'Text') },
        { titel: 'Kursiv',        text: 'I',  stil: 'font-style:italic',    tun: () => umschliessen('*', '*', 'Text') },
        { titel: 'Durchgestrichen', text: 'S', stil: 'text-decoration:line-through', tun: () => umschliessen('~~', '~~', 'Text') },
        { titel: 'Überschrift',   text: 'H',  tun: () => zeilenPraefix('## ') },
        { titel: 'Liste',         text: '•',  tun: () => zeilenPraefix('- ') },
        { titel: 'Nummerierte Liste', text: '1.', tun: () => zeilenPraefix('1. ') },
        { titel: 'Zitat',         text: '❝',  tun: () => zeilenPraefix('> ') },
        { titel: 'Code',          text: '</>', tun: () => umschliessen('`', '`', 'Code') },
        { titel: 'Link',          text: '🔗', tun: () => umschliessen('[', '](https://)', 'Beschriftung') },
        { titel: 'Trennlinie',    text: '—',  tun: () => einfuegen('\n\n---\n\n') },
        { titel: 'Tabelle',       text: '▦',  tun: () => einfuegen('\n\n| Spalte | Spalte |\n| --- | --- |\n| Wert | Wert |\n\n') }
    ];

    function baueLeiste() {
        WERKZEUGE.forEach(w => {
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'werkzeug';
            knopf.title = w.titel;
            knopf.textContent = w.text;
            if (w.stil) knopf.setAttribute('style', w.stil);
            knopf.addEventListener('click', w.tun);
            leiste.appendChild(knopf);
        });

        leiste.appendChild(trenner());

        // Farbwahl: faerbt die Auswahl ueber ein span mit Farbangabe.
        const farbe = document.createElement('input');
        farbe.type = 'color';
        farbe.className = 'werkzeug-farbe';
        farbe.title = 'Ausgewählten Text einfärben';
        farbe.value = '#00B0F0';
        farbe.addEventListener('input', () => {
            umschliessen(`<span style="color:${farbe.value}">`, '</span>', 'Text');
        });
        leiste.appendChild(farbe);

        VORGABEN.forEach(f => {
            const tupfer = document.createElement('button');
            tupfer.type = 'button';
            tupfer.className = 'farbtupfer';
            tupfer.title = f.name;
            tupfer.style.backgroundColor = f.wert;
            tupfer.addEventListener('click', () => {
                umschliessen(`<span style="color:${f.wert}">`, '</span>', 'Text');
            });
            leiste.appendChild(tupfer);
        });

        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'werkzeug';
        marker.title = 'Hervorheben';
        marker.textContent = '🖍';
        marker.addEventListener('click', () => umschliessen('<mark>', '</mark>', 'Text'));
        leiste.appendChild(marker);

        leiste.appendChild(trenner());

        const bild = document.createElement('button');
        bild.type = 'button';
        bild.className = 'werkzeug';
        bild.title = 'Bild hochladen';
        bild.textContent = '🖼';
        bild.addEventListener('click', () => bildFeld.click());
        leiste.appendChild(bild);

        const einbetten = document.createElement('button');
        einbetten.type = 'button';
        einbetten.className = 'werkzeug';
        einbetten.title = 'Webseite einbetten (iframe)';
        einbetten.textContent = '⧉';
        einbetten.addEventListener('click', () => {
            einfuegen('\n<iframe src="https://" width="100%" height="320" frameborder="0"></iframe>\n');
        });
        leiste.appendChild(einbetten);
    }

    const VORGABEN = [
        { name: 'Dunkelblau', wert: '#001E50' },
        { name: 'Hellblau',   wert: '#00B0F0' },
        { name: 'Grün',       wert: '#3C9F3C' },
        { name: 'Rot',        wert: '#C62828' },
        { name: 'Schwarz',    wert: '#14181F' }
    ];

    function trenner() {
        const t = document.createElement('span');
        t.className = 'werkzeug-trenner';
        return t;
    }

    async function ladeBildHoch(datei) {
        const daten = new FormData();
        daten.append('bild', datei);

        const res = await fetch('/api/bilder', { method: 'POST', body: daten });
        if (!res.ok) {
            const fehler = await res.json().catch(() => ({}));
            throw new Error(fehler.error || 'Upload fehlgeschlagen');
        }
        return (await res.json()).url;
    }

    bildFeld.addEventListener('change', async e => {
        const datei = e.target.files[0];
        if (!datei) return;
        try {
            const url = await ladeBildHoch(datei);
            einfuegen(`\n![${datei.name}](${url})\n`);
        } catch (err) {
            alert(err.message);
        }
        e.target.value = '';
    });

    // Bild direkt in den Text ziehen oder einfuegen.
    feld.addEventListener('drop', async e => {
        const datei = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
        if (!datei) return;
        e.preventDefault();
        try {
            einfuegen(`\n![${datei.name}](${await ladeBildHoch(datei)})\n`);
        } catch (err) {
            alert(err.message);
        }
    });

    feld.addEventListener('paste', async e => {
        const datei = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
        if (!datei) return;
        e.preventDefault();
        try {
            einfuegen(`\n![Eingefügtes Bild](${await ladeBildHoch(datei)})\n`);
        } catch (err) {
            alert(err.message);
        }
    });

    function aktualisiereVorschau() {
        vorschau.innerHTML = window.inhaltZuHtml(feld.value);

        // Fehlen die Bibliotheken, bliebe Markdown roh stehen. Das soll man
        // sehen und nicht raten muessen.
        if (window.inhaltBereit && !window.inhaltBereit()) {
            const warnung = document.createElement('p');
            warnung.className = 'editor-warnung';
            warnung.textContent = 'Markdown wird gerade nicht umgewandelt: '
                + '/vendor/marked.js oder /vendor/purify.js konnte nicht geladen werden.';
            vorschau.prepend(warnung);
        }
    }

    feld.addEventListener('input', aktualisiereVorschau);

    // Tastenkuerzel wie gewohnt.
    feld.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const taste = e.key.toLowerCase();
        if (taste === 'b') { e.preventDefault(); umschliessen('**', '**', 'Text'); }
        if (taste === 'i') { e.preventDefault(); umschliessen('*', '*', 'Text'); }
    });

    baueLeiste();
    aktualisiereVorschau();

    // Damit dashboard.js die Vorschau nach dem Laden einer Mitteilung auffrischen kann.
    window.editorAuffrischen = aktualisiereVorschau;
})();
