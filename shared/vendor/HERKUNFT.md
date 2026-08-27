# Mitgelieferte Bibliotheken

Diese beiden Dateien liegen bewusst im Projekt statt nur in `node_modules`.
So funktioniert der Screen auch dann, wenn `npm install` nicht gelaufen ist
oder das Projekt nur entpackt wurde.

- `marked.js` – Markdown nach HTML. MIT-Lizenz. https://github.com/markedjs/marked
- `purify.js` – DOMPurify, entfernt gefaehrliches HTML. Apache-2.0 / MPL-2.0.
  https://github.com/cure53/DOMPurify

Zum Aktualisieren:

    npm install marked@latest dompurify@latest
    cp node_modules/marked/lib/marked.umd.js shared/vendor/marked.js
    cp node_modules/dompurify/dist/purify.js shared/vendor/purify.js
