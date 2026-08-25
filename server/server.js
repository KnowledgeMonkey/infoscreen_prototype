const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { execFileSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const nodeHauptversion = Number(process.versions.node.split('.')[0]);

const TEAM_PASSWORD = process.env.DASHBOARD_PASSWORD || 'aendern-mich';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
const STECKBRIEFE_DIR = path.join(UPLOADS_ROOT, 'steckbriefe');

[DATA_DIR, UPLOADS_ROOT, STECKBRIEFE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function ladeJSON(dateiname) {
  const dateipfad = path.join(DATA_DIR, dateiname);
  if (!fs.existsSync(dateipfad)) return [];
  return JSON.parse(fs.readFileSync(dateipfad, 'utf-8'));
}

function speichereJSON(dateiname, daten) {
  fs.writeFileSync(path.join(DATA_DIR, dateiname), JSON.stringify(daten, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'infoscreen-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// Kein Caching: sonst laeuft auf dem Screen nach einem Update wochenlang die
// alte display.js weiter, ohne dass jemand merkt woran es liegt.
const nichtCachen = {
  etag: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store, must-revalidate')
};

app.get('/', (req, res) => res.redirect('/login.html'));

app.use('/display', express.static(path.join(__dirname, '..', 'display'), nichtCachen));

app.post('/login', (req, res) => {
  if (req.body.password === TEAM_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect('/dashboard/dashboard.html');
  }
  res.redirect('/login.html?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login.html');
}

app.use('/dashboard', requireLogin, express.static(path.join(__dirname, '..', 'dashboard'), nichtCachen));

// ---------- Dateien in Bildseiten umwandeln ----------

function lauf(befehl, args) {
  execFileSync(befehl, args, { timeout: 180000 });
}

// PDF-Seiten zu Bildern rendern. Laeuft in reinem JavaScript, damit es auf
// Windows genauso funktioniert wie auf dem Rock Pi - poppler ist auf Windows
// nicht vorhanden und frueher kam deshalb nur die erste Folie an.
async function pdfZuSeiten(pdfPfad, zielOrdner, praefix) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');

  const doc = await getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPfad)),
    disableWorker: true
  }).promise;

  const seiten = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const seite = await doc.getPage(n);
    // Auf 1920 Pixel Breite rendern, sonst ist es auf dem Screen unscharf.
    const skala = 1920 / seite.getViewport({ scale: 1 }).width;
    const viewport = seite.getViewport({ scale: skala });

    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await seite.render({ canvasContext: ctx, viewport, canvas }).promise;

    const name = `${praefix}-${String(n).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(zielOrdner, name), canvas.toBuffer('image/png'));
    seiten.push(name);
  }

  return seiten;
}

// Nimmt PPTX, PDF oder ein Bild und gibt die Liste der anzeigbaren Bilder
// zurueck - eine Datei kann also mehrere Seiten auf den Screen bringen.
async function konvertiereZuSeiten(dateipfad, zielOrdner) {
  const endung = path.extname(dateipfad).toLowerCase();
  const basis = path.basename(dateipfad, endung);
  const warnungen = [];

  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(endung)) {
    return { seiten: [path.basename(dateipfad)], warnungen };
  }

  // Der PDF-Weg liefert alle Seiten. Er steht in einem eigenen try, damit ein
  // Fehler hier nicht den ganzen Upload abbricht, sondern nur auf die
  // einseitige Notloesung zurueckfaellt.
  let pdfPfad = null;

  try {
    if (endung === '.pdf') {
      pdfPfad = dateipfad;
    } else {
      lauf('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', zielOrdner, dateipfad]);
      const erzeugt = path.join(zielOrdner, basis + '.pdf');
      if (fs.existsSync(erzeugt)) pdfPfad = erzeugt;
      else warnungen.push('LibreOffice hat kein PDF erzeugt.');
    }

    if (pdfPfad) {
      const seiten = await pdfZuSeiten(pdfPfad, zielOrdner, basis);
      // Das Zwischen-PDF wieder entfernen, das Original bleibt liegen.
      if (pdfPfad !== dateipfad) fs.unlinkSync(pdfPfad);
      if (seiten.length) return { seiten, warnungen };
      warnungen.push('Das PDF enthielt keine Seiten.');
    }
  } catch (err) {
    console.error('Seitenzerlegung fehlgeschlagen:', err.message);
    warnungen.push(nodeHauptversion < 18
      ? `Node ${process.versions.node} ist zu alt fuer die Seitenzerlegung, benoetigt wird Node 18 oder neuer.`
      : 'Seitenzerlegung fehlgeschlagen: ' + err.message);
  }

  // Notloesung: wenigstens die erste Folie ueber den PNG-Export.
  try {
    lauf('soffice', ['--headless', '--convert-to', 'png', '--outdir', zielOrdner, dateipfad]);
    const einzel = basis + '.png';
    if (fs.existsSync(path.join(zielOrdner, einzel))) {
      warnungen.push('Nur die erste Seite konnte umgewandelt werden.');
      return { seiten: [einzel], warnungen };
    }
    warnungen.push('LibreOffice hat kein Bild erzeugt.');
  } catch (err) {
    console.error('Umwandlung fehlgeschlagen:', err.message);
    warnungen.push('LibreOffice nicht erreichbar: ' + err.message);
  }

  return { seiten: [], warnungen };
}

// ---------- Steckbriefe ----------

const steckbriefUpload = multer({
  storage: multer.diskStorage({
    destination: STECKBRIEFE_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^\w.\-]/g, '_'))
  })
});

// Aeltere Eintraege hatten ein einzelnes Feld "bild" statt "seiten".
function seitenVon(eintrag) {
  if (Array.isArray(eintrag.seiten)) return eintrag.seiten;
  return eintrag.bild ? [eintrag.bild] : [];
}

app.get('/api/steckbriefe', requireLogin, (req, res) => {
  res.json(ladeJSON('steckbriefe.json').map(sb => ({ ...sb, seiten: seitenVon(sb) })));
});

app.post('/api/steckbriefe', requireLogin, steckbriefUpload.single('datei'), async (req, res) => {
  const steckbriefe = ladeJSON('steckbriefe.json');
  const { seiten, warnungen } = await konvertiereZuSeiten(
    path.join(STECKBRIEFE_DIR, req.file.filename), STECKBRIEFE_DIR);

  const neuerEintrag = {
    id: Date.now(),
    name: req.body.name || req.file.originalname,
    dateiname: req.file.filename,
    seiten,
    sichtbar: true
  };
  steckbriefe.push(neuerEintrag);
  speichereJSON('steckbriefe.json', steckbriefe);

  // Warnungen mitschicken, damit im Dashboard steht warum etwas fehlt,
  // statt dass die Datei kommentarlos ohne Seiten dasteht.
  res.json({ ...neuerEintrag, warnungen });
});

app.delete('/api/steckbriefe/:id', requireLogin, (req, res) => {
  const steckbriefe = ladeJSON('steckbriefe.json');
  const eintrag = steckbriefe.find(sb => sb.id === Number(req.params.id));

  if (eintrag) {
    [eintrag.dateiname, ...seitenVon(eintrag)].forEach(name => {
      const p = path.join(STECKBRIEFE_DIR, name);
      if (name && fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
  speichereJSON('steckbriefe.json', steckbriefe.filter(sb => sb.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ---------- Mitteilungen & Termine ----------

app.get('/api/mitteilungen', requireLogin, (req, res) => {
  res.json(ladeJSON('mitteilungen.json'));
});

app.post('/api/mitteilungen', requireLogin, (req, res) => {
  const mitteilungen = ladeJSON('mitteilungen.json');
  const neuerEintrag = {
    id: Date.now(),
    titel: req.body.titel,
    text: req.body.text,
    datum: req.body.datum || null,
    bis: req.body.bis || null      // Ablaufdatum, danach verschwindet sie vom Screen
  };
  mitteilungen.push(neuerEintrag);
  speichereJSON('mitteilungen.json', mitteilungen);
  res.json(neuerEintrag);
});

app.put('/api/mitteilungen/:id', requireLogin, (req, res) => {
  const mitteilungen = ladeJSON('mitteilungen.json');
  const eintrag = mitteilungen.find(m => m.id === Number(req.params.id));
  if (!eintrag) return res.status(404).json({ error: 'Nicht gefunden' });

  eintrag.titel = req.body.titel;
  eintrag.text = req.body.text;
  eintrag.datum = req.body.datum || null;
  eintrag.bis = req.body.bis || null;
  speichereJSON('mitteilungen.json', mitteilungen);
  res.json(eintrag);
});

app.delete('/api/mitteilungen/:id', requireLogin, (req, res) => {
  const mitteilungen = ladeJSON('mitteilungen.json');
  speichereJSON('mitteilungen.json', mitteilungen.filter(m => m.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ---------- Geburtstage ----------

app.get('/api/geburtstage', requireLogin, (req, res) => {
  res.json(ladeJSON('geburtstage.json'));
});

app.post('/api/geburtstage', requireLogin, (req, res) => {
  const liste = ladeJSON('geburtstage.json');
  // Bewusst nur Tag und Monat - das Geburtsjahr braucht der Screen nicht.
  const neuerEintrag = {
    id: Date.now(),
    name: req.body.name,
    tag: Math.min(31, Math.max(1, Number(req.body.tag))),
    monat: Math.min(12, Math.max(1, Number(req.body.monat)))
  };
  liste.push(neuerEintrag);
  speichereJSON('geburtstage.json', liste);
  res.json(neuerEintrag);
});

app.delete('/api/geburtstage/:id', requireLogin, (req, res) => {
  const liste = ladeJSON('geburtstage.json');
  speichereJSON('geburtstage.json', liste.filter(g => g.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ---------- File Manager ----------

function sicherenPfad(relativerPfad) {
  const ziel = path.resolve(UPLOADS_ROOT, relativerPfad || '');
  if (!ziel.startsWith(UPLOADS_ROOT)) throw new Error('Ungueltiger Pfad');
  return ziel;
}

app.get('/api/files', requireLogin, (req, res) => {
  try {
    const zielPfad = sicherenPfad(req.query.path);
    const eintraege = fs.readdirSync(zielPfad, { withFileTypes: true });
    res.json({
      ordner: eintraege.filter(e => e.isDirectory()).map(e => e.name),
      dateien: eintraege.filter(e => e.isFile()).map(e => ({
        name: e.name,
        groesseKB: Math.round(fs.statSync(path.join(zielPfad, e.name)).size / 1024)
      }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/files', requireLogin, (req, res) => {
  try {
    fs.unlinkSync(sicherenPfad(path.join(req.body.path || '', req.body.name)));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Einstellungen ----------

const STANDARD_EINSTELLUNGEN = {
  effekt: 'fade',
  anzeigedauer: 8,
  effektdauer: 0.8,
  uhrleiste: true,
  wetter: true,
  kalenderSlide: true,
  geburtstageSlide: true
};

function ladeEinstellungen() {
  const dateipfad = path.join(DATA_DIR, 'einstellungen.json');
  if (!fs.existsSync(dateipfad)) return { ...STANDARD_EINSTELLUNGEN };
  return { ...STANDARD_EINSTELLUNGEN, ...JSON.parse(fs.readFileSync(dateipfad, 'utf-8')) };
}

app.get('/api/einstellungen', requireLogin, (req, res) => res.json(ladeEinstellungen()));

app.put('/api/einstellungen', requireLogin, (req, res) => {
  const erlaubteEffekte = ['fade', 'slide', 'zoom', 'flip', 'keiner'];
  const neu = {
    effekt: erlaubteEffekte.includes(req.body.effekt) ? req.body.effekt : 'fade',
    // eingrenzen, damit eine Fehleingabe den Screen nicht unbrauchbar macht
    anzeigedauer: Math.min(300, Math.max(2, Number(req.body.anzeigedauer) || 8)),
    effektdauer: Math.min(5, Math.max(0, Number(req.body.effektdauer) || 0.8)),
    uhrleiste: Boolean(req.body.uhrleiste),
    wetter: Boolean(req.body.wetter),
    kalenderSlide: Boolean(req.body.kalenderSlide),
    geburtstageSlide: Boolean(req.body.geburtstageSlide)
  };
  speichereJSON('einstellungen.json', neu);
  res.json(neu);
});

// ---------- Wetter ----------

// Ingolstadt. Open-Meteo braucht keinen Schluessel.
const WETTER_URL = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=48.7665&longitude=11.4258'
  + '&current=temperature_2m,weather_code&timezone=Europe%2FBerlin';

let wetterCache = { zeit: 0, daten: null };

app.get('/api/public/wetter', async (req, res) => {
  // Hoechstens alle 15 Minuten abfragen - der Screen fragt oefter nach.
  if (Date.now() - wetterCache.zeit < 15 * 60 * 1000 && wetterCache.daten) {
    return res.json(wetterCache.daten);
  }
  try {
    const antwort = await fetch(WETTER_URL, { signal: AbortSignal.timeout(8000) });
    const roh = await antwort.json();
    wetterCache = {
      zeit: Date.now(),
      daten: { grad: Math.round(roh.current.temperature_2m), code: roh.current.weather_code }
    };
    res.json(wetterCache.daten);
  } catch (err) {
    // Ohne Internet einfach nichts liefern, der Screen blendet es dann aus.
    console.error('Wetterabruf fehlgeschlagen:', err.message);
    res.json({ fehler: true, grund: err.message });
  }
});

// ---------- Oeffentlich fuer die Display-Seite ----------

app.use('/uploads/steckbriefe', express.static(STECKBRIEFE_DIR));

app.get('/api/public/einstellungen', (req, res) => res.json(ladeEinstellungen()));

function heuteISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Sortiert nach dem naechsten Auftreten im Jahreslauf, damit oben steht wer
// als naechstes dran ist - auch ueber den Jahreswechsel hinweg.
function kommendeGeburtstage(anzahl) {
  const jetzt = new Date();
  const heuteWert = (jetzt.getMonth() + 1) * 100 + jetzt.getDate();

  return ladeJSON('geburtstage.json')
    .map(g => ({ ...g, wert: g.monat * 100 + g.tag }))
    .sort((a, b) => {
      const av = a.wert < heuteWert ? a.wert + 1300 : a.wert;
      const bv = b.wert < heuteWert ? b.wert + 1300 : b.wert;
      return av - bv;
    })
    .slice(0, anzahl)
    .map(g => ({ name: g.name, tag: g.tag, monat: g.monat, heute: g.wert === heuteWert }));
}

app.get('/api/public/content', (req, res) => {
  const e = ladeEinstellungen();
  const heute = heuteISO();
  const slides = [];

  ladeJSON('steckbriefe.json')
    .filter(sb => sb.sichtbar !== false)
    .forEach(sb => {
      seitenVon(sb).forEach(seite => {
        slides.push({ typ: 'steckbrief', name: sb.name, bild: '/uploads/steckbriefe/' + seite });
      });
    });

  // Abgelaufene Mitteilungen verschwinden von selbst vom Screen.
  const mitteilungen = ladeJSON('mitteilungen.json')
    .filter(m => !m.bis || m.bis >= heute)
    .sort((a, b) => {
      if (!a.datum) return 1;
      if (!b.datum) return -1;
      return a.datum.localeCompare(b.datum);
    });

  if (mitteilungen.length) slides.push({ typ: 'termine', eintraege: mitteilungen });

  if (e.kalenderSlide) {
    const jetzt = new Date();
    const monatsPraefix = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}`;
    slides.push({
      typ: 'kalender',
      jahr: jetzt.getFullYear(),
      monat: jetzt.getMonth() + 1,
      heute: jetzt.getDate(),
      // Nur Termine aus diesem Monat, sonst landet ein September-Termin
      // im August-Kalender - der Tag allein sagt ja nichts.
      termine: mitteilungen
        .filter(m => m.datum && m.datum.startsWith(monatsPraefix))
        .map(m => ({ datum: m.datum, titel: m.titel })),
      geburtstage: ladeJSON('geburtstage.json')
        .filter(g => g.monat === jetzt.getMonth() + 1)
        .map(g => ({ tag: g.tag, name: g.name }))
    });
  }

  if (e.geburtstageSlide) {
    const kommend = kommendeGeburtstage(8);
    if (kommend.length) slides.push({ typ: 'geburtstage', eintraege: kommend });
  }

  res.json(slides);
});

// Die Seitenzerlegung (pdfjs-dist) braucht mindestens Node 18. Auf aelteren
// Versionen scheitert schon das Laden mit "Unexpected token '.'", weil die
// moderne Schreibweise nicht verstanden wird - das hier sagt es direkt beim
// Start statt erst beim ersten Upload.
app.listen(PORT, () => {
  console.log(`Infoscreen-Server laeuft auf Port ${PORT}`);

  if (nodeHauptversion < 18) {
    console.warn('');
    console.warn(`ACHTUNG: Node ${process.versions.node} ist zu alt.`);
    console.warn('Mehrseitige Dateien werden dann nur mit der ersten Seite angezeigt.');
    console.warn('Benoetigt wird Node 18 oder neuer.');
    console.warn('');
  }
});
