#!/usr/bin/env bash
# Richtet den WLAN-Hotspot nach den im Dashboard gespeicherten Einstellungen
# ein. Braucht Root, deshalb laeuft das bewusst als eigenes Skript und nicht
# aus der Weboberflaeche heraus.
#
#   sudo ./scripts/hotspot.sh          Hotspot nach Konfiguration einrichten
#   sudo ./scripts/hotspot.sh aus      Hotspot abschalten
#   sudo ./scripts/hotspot.sh status   Zustand anzeigen

set -euo pipefail

PROJEKT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KONFIG="$PROJEKT/server/data/hotspot.json"
VERBINDUNG="infoscreen-ap"

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo ausfuehren." >&2
  exit 1
fi

if ! command -v nmcli > /dev/null; then
  echo "nmcli fehlt. Installieren mit: sudo apt install -y network-manager" >&2
  exit 1
fi

lies() {
  # Wert aus der JSON-Datei holen. node ist ohnehin vorhanden.
  node -e "
    const fs = require('fs');
    let k = {};
    try { k = JSON.parse(fs.readFileSync('$KONFIG', 'utf8')); } catch (e) {}
    const wert = k['$1'];
    process.stdout.write(wert === undefined || wert === null ? '' : String(wert));
  "
}

case "${1:-an}" in
  aus)
    nmcli con down "$VERBINDUNG" 2>/dev/null || true
    nmcli con modify "$VERBINDUNG" connection.autoconnect no 2>/dev/null || true
    echo "Hotspot abgeschaltet."
    exit 0
    ;;
  status)
    nmcli -f NAME,DEVICE,STATE con show --active | grep -E "NAME|$VERBINDUNG" || echo "Hotspot laeuft nicht."
    exit 0
    ;;
esac

if [[ ! -f "$KONFIG" ]]; then
  echo "Keine Konfiguration gefunden. Im Dashboard unter Einstellungen anlegen." >&2
  exit 1
fi

SSID="$(lies ssid)"
PSK="$(lies passwort)"
SICHERHEIT="$(lies sicherheit)"
KANAL="$(lies kanal)"
GERAET="$(lies geraet)"

[[ -z "$SSID" ]] && { echo "Kein Netzname (SSID) gesetzt." >&2; exit 1; }
[[ -z "$GERAET" ]] && GERAET="wlan0"

if [[ "$SICHERHEIT" != "offen" && ${#PSK} -lt 8 ]]; then
  echo "Das Passwort muss mindestens 8 Zeichen haben." >&2
  exit 1
fi

echo "Richte Hotspot \"$SSID\" auf $GERAET ein ..."

# Vorherige Einrichtung entfernen, damit Aenderungen sicher greifen.
nmcli con delete "$VERBINDUNG" 2>/dev/null || true

nmcli con add type wifi ifname "$GERAET" con-name "$VERBINDUNG" autoconnect yes ssid "$SSID" > /dev/null

nmcli con modify "$VERBINDUNG" \
  802-11-wireless.mode ap \
  802-11-wireless.band bg \
  ipv4.method shared \
  ipv6.method ignore \
  connection.autoconnect yes > /dev/null

[[ -n "$KANAL" && "$KANAL" != "0" ]] && nmcli con modify "$VERBINDUNG" 802-11-wireless.channel "$KANAL" > /dev/null

case "$SICHERHEIT" in
  offen)
    nmcli con modify "$VERBINDUNG" wifi-sec.key-mgmt none > /dev/null
    echo "Achtung: Das Netz ist offen und ohne Passwort erreichbar."
    ;;
  wpa3)
    nmcli con modify "$VERBINDUNG" wifi-sec.key-mgmt sae wifi-sec.psk "$PSK" > /dev/null
    ;;
  *)
    nmcli con modify "$VERBINDUNG" wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn \
      wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.psk "$PSK" > /dev/null
    ;;
esac

nmcli con up "$VERBINDUNG"

ADRESSE="$(nmcli -g IP4.ADDRESS device show "$GERAET" | head -1 | cut -d/ -f1)"
echo ""
echo "Hotspot laeuft."
echo "  Netz:      $SSID"
echo "  Dashboard: http://${ADRESSE:-<ip>}:${PORT:-3000}/login.html"
echo "  Screen:    http://${ADRESSE:-<ip>}:${PORT:-3000}/display/index.html"
