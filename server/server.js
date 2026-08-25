const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { execFileSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
const STECKBRIEFE_DIR = path.join(UPLOADS_ROOT, 'steckbriefe');

// Ordner sicherstellen, falls sie noch nicht existieren (frischer Rock Pi z.B.)
[DATA_DIR, UPLOADS_ROOT, STECKBRIEFE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// kleine Helper fuer die JSON-Dateien - liest/schreibt jedes Mal komplett neu,
// reicht locker fuer die Datenmenge die wir hier haben
function ladeJSON(dateiname) {
  const dateipfad = path.join(DATA_DIR, dateiname);
  if (!fs.existsSync(dateipfad)) return [];
  return JSON.parse(fs.readFileSync(dateipfad, 'utf-8'));
}

function speichereJSON(dateiname, daten) {
  const dateipfad = path.join(DATA_DIR, dateiname);
  fs.writeFileSync(dateipfad, JSON.stringify(daten, null, 2));
}

// Wandelt die erste Folie einer PPTX in ein PNG um (LibreOffice macht bei
// Impress-Dateien im PNG-Export ohnehin nur die erste Folie).
// Gibt den Dateinamen des erzeugten Bilds zurueck, oder null bei Fehler.
// Liest Breite/Hoehe direkt aus dem PNG-Header (IHDR steht immer an Byte 16-24).
function lesePngGroesse(bildpfad) {
  const fd = fs.openSync(bildpfad, 'r');
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return { breite: buf.readUInt32BE(16), hoehe: buf.readUInt32BE(20) };
}

function soffice(args) {
  execFileSync('soffice', args, { timeout: 90000 });
}

function konvertierePptxZuBild(pptxPfad, zielOrdner) {
  const bildname = path.basename(pptxPfad, path.extname(pptxPfad)) + '.png';
  const bildpfad = path.join(zielOrdner, bildname);

  try {
    // 1. Durchgang: Standardaufloesung, nur um das Seitenverhaeltnis zu kennen.
    soffice(['--headless', '--convert-to', 'png', '--outdir', zielOrdner, pptxPfad]);
    if (!fs.existsSync(bildpfad)) return null;

    // 2. Durchgang: gleiche Proportionen, aber in voller Breite neu exportieren,
    // sonst ist das Bild auf einem 1080p-Screen sichtbar unscharf. Hoehe wird
    // aus dem Seitenverhaeltnis berechnet - sonst verzerrt LibreOffice das Bild.
    const { breite, hoehe } = lesePngGroesse(bildpfad);
    if (breite < 1920) {
      const zielHoehe = Math.round(1920 * hoehe / breite);
      const filter = `png:impress_png_Export:{"PixelWidth":{"type":"long","value":1920},`
        + `"PixelHeight":{"type":"long","value":${zielHoehe}}}`;
      soffice(['--headless', '--convert-to', filter, '--outdir', zielOrdner, pptxPfad]);
    }

    return bildname;
  } catch (err) {
    console.error('PPTX-Konvertierung fehlgeschlagen:', err.message);
    return fs.existsSync(bildpfad) ? bildname : null;
  }
}

// Team-Passwort fuers Dashboard. Fuer Phase 1 reicht eine Umgebungsvariable,
// spaeter evtl. in eine config-Datei auslagern.
const TEAM_PASSWORD = process.env.DASHBOARD_PASSWORD || 'aendern-mich';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'infoscreen-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12 // 12 Stunden eingeloggt bleiben
  }
}));

// Display-Seite ist immer oeffentlich erreichbar, kein Login noetig
// Kein Caching: sonst laeuft auf dem Screen nach einem Update wochenlang die
// alte display.js weiter, ohne dass jemand merkt woran es liegt.
const nichtCachen = {
  etag: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store, must-revalidate')
};

app.use('/display', express.static(path.join(__dirname, '..', 'display'), nichtCachen));

// Login-Route: prueft nur das eine Team-Passwort
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === TEAM_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect('/dashboard/dashboard.html');
  }
  res.redirect('/login.html?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// Login-Seite selbst darf jeder aufrufen
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Alles unter /dashboard ist geschuetzt - ohne Session geht's zurueck zum Login
function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  res.redirect('/login.html');
}

app.use('/dashboard', requireLogin, express.static(path.join(__dirname, '..', 'dashboard'), nichtCachen));

// ---------- Steckbriefe ----------

const steckbriefUpload = multer({
  storage: multer.diskStorage({
    destination: STECKBRIEFE_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
  })
});

app.get('/api/steckbriefe', requireLogin, (req, res) => {
  res.json(ladeJSON('steckbriefe.json'));
});

app.post('/api/steckbriefe', requireLogin, steckbriefUpload.single('datei'), (req, res) => {
  const steckbriefe = ladeJSON('steckbriefe.json');
  const bildname = konvertierePptxZuBild(
    path.join(STECKBRIEFE_DIR, req.file.filename),
    STECKBRIEFE_DIR
  );
  const neuerEintrag = {
    id: Date.now(),
    name: req.body.name || req.file.originalname,
    dateiname: req.file.filename,
    bild: bildname // null falls die Konvertierung fehlgeschlagen ist
  };
  steckbriefe.push(neuerEintrag);
  speichereJSON('steckbriefe.json', steckbriefe);
  res.json(neuerEintrag);
});

app.delete('/api/steckbriefe/:id', requireLogin, (req, res) => {
  const steckbriefe = ladeJSON('steckbriefe.json');
  const eintrag = steckbriefe.find(sb => sb.id === Number(req.params.id));
  if (eintrag) {
    fs.unlinkSync(path.join(STECKBRIEFE_DIR, eintrag.dateiname));
    if (eintrag.bild) fs.unlinkSync(path.join(STECKBRIEFE_DIR, eintrag.bild));
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
    datum: req.body.datum || null
  };
  mitteilungen.push(neuerEintrag);
  speichereJSON('mitteilungen.json', mitteilungen);
  res.json(neuerEintrag);
});

app.delete('/api/mitteilungen/:id', requireLogin, (req, res) => {
  const mitteilungen = ladeJSON('mitteilungen.json');
  speichereJSON('mitteilungen.json', mitteilungen.filter(m => m.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ---------- File Manager ----------

function sicherenPfad(relativerPfad) {
  const ziel = path.resolve(UPLOADS_ROOT, relativerPfad || '');
  if (!ziel.startsWith(UPLOADS_ROOT)) {
    throw new Error('Ungueltiger Pfad');
  }
  return ziel;
}

app.get('/api/files', requireLogin, (req, res) => {
  try {
    const zielPfad = sicherenPfad(req.query.path);
    const eintraege = fs.readdirSync(zielPfad, { withFileTypes: true });

    const ordner = eintraege.filter(e => e.isDirectory()).map(e => e.name);
    const dateien = eintraege.filter(e => e.isFile()).map(e => {
      const stat = fs.statSync(path.join(zielPfad, e.name));
      return { name: e.name, groesseKB: Math.round(stat.size / 1024) };
    });

    res.json({ ordner, dateien });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/files', requireLogin, (req, res) => {
  try {
    const zielPfad = sicherenPfad(path.join(req.body.path || '', req.body.name));
    fs.unlinkSync(zielPfad);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Oeffentlich fuer die Display-Seite (kein Login) ----------

// Bilder muessen oeffentlich erreichbar sein, sonst kann der Screen sie nicht laden
app.use('/uploads/steckbriefe', express.static(STECKBRIEFE_DIR));

app.get('/api/public/content', (req, res) => {
  const steckbriefe = ladeJSON('steckbriefe.json')
    .filter(sb => sb.bild)
    .map(sb => ({ typ: 'steckbrief', name: sb.name, bild: '/uploads/steckbriefe/' + sb.bild }));

  const mitteilungen = ladeJSON('mitteilungen.json').sort((a, b) => {
    if (!a.datum) return 1;
    if (!b.datum) return -1;
    return a.datum.localeCompare(b.datum);
  });

  const slides = [...steckbriefe];
  if (mitteilungen.length > 0) {
    slides.push({ typ: 'termine', eintraege: mitteilungen });
  }

  res.json(slides);
});

app.listen(PORT, () => {
  console.log(`Infoscreen-Server laeuft auf Port ${PORT}`);
});
