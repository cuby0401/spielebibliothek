#!/bin/sh
# Nächtliche Sicherung der Docker-VM auf die NAS (20.11.2026) – läuft um 01:50 als root (/etc/cron.d/spielebibliothek-sicherung,
# legt scripts/server-setup.sh an). Log: /var/log/sb-sicherung.log
#
# Warum: Auf der VM liegen die Datenbanken auf der lokalen Platte. Das Proxmox-Backup sichert die ganze VM, aber nur auf die NAS –
# nicht außer Haus. Deshalb kommen konsistente Kopien in die Freigabe „games“ (Ordner vm-sicherung/aktuell/), die borgmatic um 02:00
# ohnehin verschlüsselt zur Hetzner Storage Box sichert.
#
# Kopiert werden:
#   saves.db         Spielstände usw. – SQLite-Backup-API im Speicher-Dienst (python -m savesvc backup)
#   upload.db        Upload-Konten, KI-Zugänge – SQLite-Backup-API im Upload-Dienst
#   geheimnis        Sitzungs-Schlüssel des Upload-Dienstes
#   ergebnisse.db    Testergebnisse der Tester – über den Speicher-Dienst der Probe, wenn sie läuft
#   vor-deploy/      Datenbank-Sicherungen vor Deploys
#   config/, env     users.yaml, Not-Aus-Datei, .env (TUNNEL_TOKEN usw. – borg verschlüsselt)
# Die Datenbanken werden nie vom Host aus geöffnet – nur die fertige Kopie wird auf integrity_check geprüft.
set -eu
STACK=${SB_STACK:-/opt/stacks/spielebibliothek}
DATEN=${SB_DATEN:-/opt/stacks/spielebibliothek-daten/data}
UDATEN=${SB_UDATEN:-/opt/stacks/spielebibliothek-daten/upload}
TESTS=${SB_TESTS:-/opt/stacks/spielebibliothek-tests}
MNT=${SB_MNT:-/mnt/nas/games}
# vm-sicherung/ wird einmal von Hand auf der NAS mit engen Rechten angelegt (docs/betrieb.md) – NICHT von hier aus: ein über SMB
# angelegter Ordner direkt in „games“ wäre auf der NAS für alle lesbar (777), und hier liegen Token und Schlüssel.
BASIS=$MNT/vm-sicherung
ZIEL=$BASIS/aktuell
echo "$(date -Is) Sicherung beginnt"
mountpoint -q "$MNT" || mount "$MNT"
mountpoint -q "$MNT" || { echo "✗ $MNT nicht eingebunden – keine Sicherung"; exit 1; }
[ -d "$BASIS" ] || { echo "✗ $BASIS fehlt – erst auf der NAS mit engen Rechten anlegen (docs/betrieb.md)"; exit 1; }
TMP=$(mktemp -d /tmp/sb-sicherung.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

docker exec spielebibliothek-savesvc python -m savesvc backup /data/backup/export-saves.db >/dev/null
mv "$DATEN/backup/export-saves.db" "$TMP/saves.db"
docker exec spielebibliothek-upload python -c "import sqlite3; q = sqlite3.connect('/data/upload.db'); z = sqlite3.connect('/data/export-upload.db'); q.backup(z); z.close(); q.close()"
mv "$UDATEN/export-upload.db" "$TMP/upload.db"
cp "$UDATEN/geheimnis" "$TMP/geheimnis"
if [ -f "$TESTS/ergebnisse.db" ]; then
	if docker exec sbprobe-savesvc python -c "import sqlite3; q = sqlite3.connect('/tests/ergebnisse.db'); z = sqlite3.connect('/tests/export.db'); q.backup(z); z.close(); q.close()" 2>/dev/null; then
		mv "$TESTS/export.db" "$TMP/ergebnisse.db"
	else
		cp "$TESTS/ergebnisse.db" "$TMP/ergebnisse.db"   # Probe läuft nicht – dann schreibt auch niemand hinein
	fi
fi
[ -d "$DATEN/backup/vor-deploy" ] && cp -R "$DATEN/backup/vor-deploy" "$TMP/vor-deploy"
cp -R "$STACK/config" "$TMP/config"
cp "$STACK/.env" "$TMP/env"

# Kopien prüfen (nur die Kopien, nie die laufenden Dateien)
for db in "$TMP"/*.db; do
	r=$(python3 -I -c "import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute('pragma integrity_check').fetchone()[0])" "$db")
	[ "$r" = ok ] || { echo "✗ $(basename "$db"): integrity_check = $r – Sicherung abgebrochen, alter Stand bleibt"; exit 1; }
done

# Erst vollständig schreiben, dann tauschen – eine abgebrochene Übertragung lässt den letzten guten Stand stehen
rm -rf "$ZIEL.neu"
mkdir -p "$ZIEL.neu"
cp -R "$TMP"/. "$ZIEL.neu"/
date -Is > "$ZIEL.neu/stand"
rm -rf "$ZIEL.alt"
[ -d "$ZIEL" ] && mv "$ZIEL" "$ZIEL.alt"
mv "$ZIEL.neu" "$ZIEL"
rm -rf "$ZIEL.alt"
echo "$(date -Is) ✓ gesichert nach $ZIEL: $(ls "$ZIEL" | tr '\n' ' ')"
