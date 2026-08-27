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

    // Gezeichnete Symbole statt Emoji: auf Linux ist oft keine Emoji-Schrift
    // installiert, dann stuenden hier nur leere Kaestchen.
    function svg(inhalt, box) {
        return `<svg viewBox="${box || '0 0 24 24'}" class="werkzeug-icon" aria-hidden="true">${inhalt}</svg>`;
    }

    const SYMBOL = {
        zitat: svg('<path d="M9 7H5.5A2.5 2.5 0 0 0 3 9.5v3A2.5 2.5 0 0 0 5.5 15H7c0 1.5-.8 2.4-2 2.8V20c3-.6 4.5-2.6 4.5-5.6V7zm11 0h-3.5A2.5 2.5 0 0 0 14 9.5v3a2.5 2.5 0 0 0 2.5 2.5H18c0 1.5-.8 2.4-2 2.8V20c3-.6 4.5-2.6 4.5-5.6V7z" fill="currentColor"/>'),
        link: svg('<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 11a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5"/></g>'),
        linie: svg('<path d="M4 12h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
        tabelle: svg('<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M9.5 9.5v10M15 9.5v10"/></g>'),
        liste: svg('<g fill="currentColor"><circle cx="5" cy="7" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="17" r="1.6"/><rect x="9" y="6.2" width="11" height="1.7" rx=".8"/><rect x="9" y="11.2" width="11" height="1.7" rx=".8"/><rect x="9" y="16.2" width="11" height="1.7" rx=".8"/></g>'),
        nummern: svg('<g fill="currentColor"><text x="2.5" y="9" font-size="7" font-family="sans-serif">1</text><text x="2.5" y="19" font-size="7" font-family="sans-serif">2</text><rect x="9" y="4.2" width="11" height="1.7" rx=".8"/><rect x="9" y="9.2" width="11" height="1.7" rx=".8"/><rect x="9" y="14.2" width="11" height="1.7" rx=".8"/><rect x="9" y="18.5" width="11" height="1.7" rx=".8"/></g>'),
        marker: svg('<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 4l7 7-7 7-4-4z"/><path d="M9 14l-3 3v3h3l3-3"/></g>'),
        bild: svg('<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-2.5 4 3.5"/></g>'),
        einbetten: svg('<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 8.5h17"/><path d="M8 13l-2 2 2 2M16 13l2 2-2 2"/></g>'),
        code: svg('<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></g>')
    };

    const WERKZEUGE = [
        { titel: 'Fett',          text: 'B',  stil: 'font-weight:700',      tun: () => umschliessen('**', '**', 'Text') },
        { titel: 'Kursiv',        text: 'I',  stil: 'font-style:italic',    tun: () => umschliessen('*', '*', 'Text') },
        { titel: 'Durchgestrichen', text: 'S', stil: 'text-decoration:line-through', tun: () => umschliessen('~~', '~~', 'Text') },
        { titel: 'Überschrift',   text: 'H',  tun: () => zeilenPraefix('## ') },
        { titel: 'Liste',         html: SYMBOL.liste,     tun: () => zeilenPraefix('- ') },
        { titel: 'Nummerierte Liste', html: SYMBOL.nummern, tun: () => zeilenPraefix('1. ') },
        { titel: 'Zitat',         html: SYMBOL.zitat,     tun: () => zeilenPraefix('> ') },
        { titel: 'Code',          html: SYMBOL.code,      tun: () => umschliessen('`', '`', 'Code') },
        { titel: 'Link',          html: SYMBOL.link,      tun: () => umschliessen('[', '](https://)', 'Beschriftung') },
        { titel: 'Trennlinie',    html: SYMBOL.linie,     tun: () => einfuegen('\n\n---\n\n') },
        { titel: 'Tabelle',       html: SYMBOL.tabelle,   tun: () => einfuegen('\n\n| Spalte | Spalte |\n| --- | --- |\n| Wert | Wert |\n\n') }
    ];

    function baueLeiste() {
        WERKZEUGE.forEach(w => {
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'werkzeug';
            knopf.title = w.titel;
            if (w.html) knopf.innerHTML = w.html; else knopf.textContent = w.text;
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
        marker.innerHTML = SYMBOL.marker;
        marker.addEventListener('click', () => umschliessen('<mark>', '</mark>', 'Text'));
        leiste.appendChild(marker);

        leiste.appendChild(trenner());

        const bild = document.createElement('button');
        bild.type = 'button';
        bild.className = 'werkzeug';
        bild.title = 'Bild hochladen';
        bild.innerHTML = SYMBOL.bild;
        bild.addEventListener('click', () => bildFeld.click());
        leiste.appendChild(bild);

        const einbetten = document.createElement('button');
        einbetten.type = 'button';
        einbetten.className = 'werkzeug';
        einbetten.title = 'Webseite einbetten (iframe)';
        einbetten.innerHTML = SYMBOL.einbetten;
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
