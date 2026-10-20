# Infoscreen CMS

## Lokal starten

```powershell
npm install
npm start
```

Dashboard: <http://localhost:3000/dashboard/dashboard.html>

Anzeige: <http://localhost:3000/display/index.html>

Nach Server-Änderungen den laufenden Prozess mit `Ctrl+C` beenden und `npm start` erneut ausführen. Ein Browser-Reload allein lädt keinen neuen Server-Code.

## Anmeldung auf Mac und Safari

Die Anmeldung erfolgt ohne Formular-Weiterleitung im Hintergrund. Erst wenn eine separate Anfrage die gespeicherte Sitzung bestätigt, öffnet sich das Dashboard. Fehlen die Cookies, erscheint eine Meldung auf der Login-Seite. Doppelklicks und Verbindungsabbrüche lösen keine automatischen Neuanmeldungen aus.

Wird die Login-Seite nach dem Apple-Passwortspeicherdialog neu geladen oder aus dem Browserverlauf wiederhergestellt, wird eine bereits gültige Sitzung übernommen. Login-Antworten und geschützte Weiterleitungen werden nicht zwischengespeichert. Ohne JavaScript bleibt die normale Formularanmeldung mit HTTP 303 verfügbar.

Nach Installation dieses Fixes den Server neu starten und eine bereits offene Login-Seite einmal neu laden. Die Tests in `test/login.test.js` und `test/login-client.test.js` sind Bestandteil von `npm test` und sichern Sitzungsbestätigung, Cookie-Fehler, Wiederherstellung, Doppelklicks, Netzwerkfehler und die Formularanmeldung ab. Der native Apple-Systemdialog muss zusätzlich auf einem echten Mac geprüft werden.

## Inhalte verwalten

- **Steckbriefe:** Der Anzeigename ist unabhängig vom Dateinamen. Vorschau, Reihenfolge, Sichtbarkeit und Dateiersatz werden am Eintrag verwaltet. Das Ersetzen behält den Eintrag bei.
- **Medien:** Dateien hochladen, suchen, nach Typ filtern, umbenennen, URLs kopieren und mehrere Dateien auswählen. Bilder und PDFs haben eine Vorschau; andere Dateitypen werden heruntergeladen.
- **Listen:** Suchfeld, sortierbare Spalten und Seitenwechsel helfen bei größeren Beständen. Die sichtbare Sortierung einer Tabelle ist nicht automatisch die Abspielreihenfolge.
- **Formulare:** Änderungen erst speichern, bevor die Seite geschlossen wird. Die Warnung vor ungespeicherten Änderungen ersetzt kein Speichern.
- **Einstellungen:** Das Team-Passwort lässt sich nach Eingabe des bisherigen Passworts ändern. Das neue Passwort sicher aufbewahren.
- **Versionen:** Gespeicherte Inhaltsstände lassen sich ansehen und wiederherstellen. Eine Wiederherstellung wirkt auf die jeweilige Inhaltssammlung; den angezeigten Umfang vor der Bestätigung prüfen.

Dateien, die noch von Inhalten oder gespeicherten Versionen benötigt werden, sind vor dem Löschen geschützt. Die automatische Bereinigung behandelt ungenutzte Editor-Bilder konservativ, damit laufende Bearbeitungen keine Bilder verlieren.

## Anzeige ohne Verbindung

Die Anzeige bewahrt zuletzt erfolgreich geladene Inhalte, Einstellungen und Wetterdaten. Ein Hinweis kennzeichnet nicht bestätigte oder veraltete Daten. Eingebettete externe Webseiten benötigen weiterhin ihre eigene Verbindung.

Für einen vollständigen Offline-Neustart einschließlich HTML, Skripten und Bildern muss der Browser die Anzeige zuvor online geladen haben und Service Worker unterstützen. Das funktioniert auf **localhost oder HTTPS**. Eine normale HTTP-Adresse im lokalen Netz erlaubt diese Browserfunktion nicht; eine bereits offene Anzeige kann trotzdem mit dem letzten geladenen Inhalt weiterlaufen. Gelöschter oder voller Browserspeicher kann die Offline-Verfügbarkeit einschränken.

## Betrieb und Tests

PowerPoint-/ODP-Konvertierung benötigt weiterhin LibreOffice (`soffice` im Suchpfad). Bilder können ohne LibreOffice hochgeladen werden; PDFs verwenden den vorhandenen PDF-Renderer.

`GET /api/health` liefert den Serverzustand. Serverereignisse werden als JSON-Zeilen ausgegeben. Inhalte werden über temporäre Dateien und anschließendes Umbenennen gespeichert, damit ein abgebrochener Schreibvorgang keine halbe JSON-Datei hinterlässt.

Die Umgebungsvariablen `DATA_DIR` und `UPLOADS_ROOT` erlauben getrennte Datenverzeichnisse für Tests. Tests niemals auf die laufenden produktiven Verzeichnisse umstellen. Für Backups sowohl das Datenverzeichnis als auch das Upload-Verzeichnis sichern, damit Inhaltsversionen ihre Dateien behalten.

```powershell
npm test
```

Die automatisierten Tests verwenden eigene temporäre Daten. Browserabhängige Dialoge wie Apples Passwortspeicher sollten zusätzlich auf dem jeweiligen Gerät geprüft werden.
