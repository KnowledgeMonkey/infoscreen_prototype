/* Wird von Dashboard und Screen gleichermassen geladen, damit die Vorschau
   exakt das zeigt, was spaeter auf dem Bildschirm haengt. */
(function (global) {
    'use strict';

    // Einmalige Einrichtung, sobald marked und DOMPurify geladen sind.
    function einrichten() {
        if (!global.marked || !global.DOMPurify) return false;

        global.marked.setOptions({
            // Ein einfacher Zeilenumbruch bleibt ein Umbruch. Ohne das klebt
            // Markdown untereinander geschriebene Zeilen zu einem Absatz
            // zusammen und alles steht nebeneinander.
            breaks: true,
            gfm: true
        });
        return true;
    }

    // Was im Text erlaubt ist. Bewusst grosszuegig, weil nur das Team mit dem
    // gemeinsamen Passwort hier schreibt - aber Skripte bleiben draussen.
    const REGELN = {
        ALLOWED_TAGS: [
            'p', 'br', 'hr', 'span', 'div',
            'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'small', 'sub', 'sup',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
            'a', 'img', 'iframe', 'figure', 'figcaption',
            'table', 'thead', 'tbody', 'tr', 'th', 'td'
        ],
        // Nur ergaenzen, nicht ersetzen: eine eigene ALLOWED_ATTR-Liste wuerde
        // die Standardliste ueberschreiben, dann verlieren Bilder und iframes
        // ihre width- und height-Angaben.
        ADD_ATTR: [
            'target', 'rel', 'loading',
            'allow', 'allowfullscreen', 'frameborder', 'scrolling'
        ],
        // Kein eigenes ALLOWED_URI_REGEXP: die Regel wird auf jeden
        // Attributwert angewendet, nicht nur auf Adressen - width="320" fiele
        // sonst mit heraus. Die Standardpruefung blockt javascript: bereits.
        ADD_TAGS: ['iframe'],
        FORBID_TAGS: ['script', 'style', 'form', 'input', 'button'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick']
    };

    function inhaltZuHtml(text) {
        if (!einrichten()) {
            // Ohne die Bibliotheken bliebe Markdown im Rohzustand stehen. Das
            // war frueher stumm - jetzt steht es in der Konsole und laesst sich
            // ueber inhaltBereit() abfragen.
            if (!global.__inhaltGemeldet) {
                global.__inhaltGemeldet = true;
                console.error(
                    'Markdown-Bibliotheken fehlen: ' +
                    (global.marked ? '' : 'marked ') + (global.DOMPurify ? '' : 'DOMPurify ') +
                    'nicht geladen. Pruefen: /vendor/marked.js und /vendor/purify.js erreichbar?'
                );
            }

            const roh = String(text ?? '');
            return roh.replace(/[&<>]/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[z])
                      .replace(/\n/g, '<br>');
        }

        const html = global.marked.parse(String(text ?? ''));
        return global.DOMPurify.sanitize(html, REGELN);
    }

    global.inhaltZuHtml = inhaltZuHtml;
    global.inhaltBereit = einrichten;
})(window);
