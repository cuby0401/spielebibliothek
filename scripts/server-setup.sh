#!/bin/sh
# Docker-VM für die Spielebibliothek einrichten – Gegenstück zu nas-setup.sh (20.11.2026).
# Läuft AUF DER VM mit sudo. Die Adresse der NAS kommt als Argument (steht in lokal.env, nicht im Repo):
#
#   sudo sh /opt/stacks/spielebibliothek/scripts/server-setup.sh <LAN-Adresse der NAS>
#
# Idempotent: kann beliebig oft laufen.
#
# Aufteilung (Grundsatz: Datenbanken nie auf einer Netzwerkfreigabe):
#   /mnt/nas/games/spiele                       Spiele – SMB-Freigabe „games“ der NAS (NIE NFS: hat die NAS schon abstürzen lassen)
#   /opt/stacks/spielebibliothek-daten/data     saves.db, backup/          – lokal, savesvc (UID 10022)
#   /opt/stacks/spielebibliothek-daten/upload   upload.db, geheimnis       – lokal, Upload-Dienst (UID 10021)
#   /opt/stacks/spielebibliothek(-releases|-quelle|-probe|-tests)           – lokal, Sebi
#
# SMB kennt keine ACLs: Alle Dateien der Freigabe erscheinen als UID/GID 10021 mit 0770/0660. Der Upload-Dienst (10021) schreibt,
# Caddy und Speicher-Dienst lesen über die Gruppe 10021 (group_add in compose.yaml, Ordner dort nur lesend eingebunden).
# Sebi kommt ebenfalls in die Gruppe (deploy.sh --examples).
#
# Dazu der Cron-Job für die nächtliche Sicherung auf die NAS (scripts/sicherung-export.sh, 01:50 – vor borgmatic um 02:00).

set -eu
NAS_LAN="${1:-}"
SEBI="${SUDO_USER:-sebi}"
STACKS=/opt/stacks
DATEN=$STACKS/spielebibliothek-daten
MNT=/mnt/nas/games
CRED=/etc/nas-cred
GRUPPE=sbspiele     # GID 10021 = Upload-Dienst

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }
[ -n "$NAS_LAN" ] || { echo "Aufruf: sudo sh server-setup.sh <LAN-Adresse der NAS>" >&2; exit 1; }
[ -f "$CRED" ] || { echo "$CRED fehlt (Zugangsdaten des NAS-Benutzers für SMB)." >&2; exit 1; }

# Werkzeuge: setfacl (deploy.sh setzt Rechte auf config/), mount.cifs
command -v setfacl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq acl; }
[ -x /sbin/mount.cifs ] || [ -x /usr/sbin/mount.cifs ] || apt-get install -y -qq cifs-utils
# cron für Auftragsdienst und Sicherung – fehlt in einer minimalen Debian-Installation
command -v cron >/dev/null 2>&1 || [ -x /usr/sbin/cron ] || apt-get install -y -qq cron
systemctl enable --now cron >/dev/null 2>&1 || true

# Gruppe 10021 für den Lesezugriff auf die Spiele
getent group 10021 >/dev/null || groupadd -g 10021 "$GRUPPE"
id -nG "$SEBI" | tr ' ' '\n' | grep -qx "$(getent group 10021 | cut -d: -f1)" || usermod -aG 10021 "$SEBI"

# SMB-Freigabe „games“ (Muster wie seb-brain in /etc/fstab)
mkdir -p "$MNT"
ZEILE="//$NAS_LAN/games $MNT cifs credentials=$CRED,uid=10021,gid=10021,file_mode=0660,dir_mode=0770,vers=3.0,_netdev,nofail 0 0"
if ! grep -q " $MNT cifs " /etc/fstab; then
	echo "$ZEILE" >> /etc/fstab
	systemctl daemon-reload
	echo "  /etc/fstab: $MNT eingetragen"
fi
mountpoint -q "$MNT" || mount "$MNT"
[ -d "$MNT/spiele" ] || { echo "✗ $MNT/spiele fehlt – ist die Freigabe richtig eingebunden?" >&2; exit 1; }

# Lokale Ordner: Datenbanken und Stack
mkdir -p "$DATEN/data/backup" "$DATEN/upload" "$STACKS/spielebibliothek-tests"
chown "$SEBI:$SEBI" "$STACKS" "$DATEN" "$STACKS/spielebibliothek-tests"
chmod 755 "$STACKS"; chmod 750 "$DATEN"
setfacl -m u:10021:x,u:10022:x "$DATEN"
acl() { # acl <ordner> <acl-einträge> – wie nas-setup.sh: Default-ACLs, damit die umask der Container nichts verbiegt
	chmod -R o= "$1"
	setfacl -R -m "$2,o::---" "$1"
	setfacl -R -d -m "$2,o::---" "$1"
}
acl "$DATEN/data"   "u:$SEBI:rwX,u:10022:rwX"
acl "$DATEN/upload" "u:$SEBI:rwX,u:10021:rwX"
# Testergebnisse der Probe: Speicher-Dienst der Probe schreibt (teststand.sh macht den Ordner selbst a+rwX)
for d in spielebibliothek spielebibliothek-releases spielebibliothek-quelle spielebibliothek-probe; do
	mkdir -p "$STACKS/$d"; chown "$SEBI:$SEBI" "$STACKS/$d"
done

# Nächtliche Sicherung auf die NAS (vor borgmatic, das /volume1/games zu Hetzner sichert)
printf '%s\n' '# Spielebibliothek: Datenbanken und Konfiguration auf die NAS (scripts/sicherung-export.sh) – borgmatic sichert sie um 02:00' \
	"50 1 * * * root sh $STACKS/spielebibliothek/scripts/sicherung-export.sh >> /var/log/sb-sicherung.log 2>&1" \
	> /etc/cron.d/spielebibliothek-sicherung
chmod 644 /etc/cron.d/spielebibliothek-sicherung

echo "Fertig. Kontrolle:"
mount | grep " $MNT " | sed 's/password=[^,]*/password=…/'
for d in "$DATEN/data" "$DATEN/upload"; do echo "--- $d"; getfacl -p "$d" 2>/dev/null | grep -v '^#'; done
cat /etc/cron.d/spielebibliothek-sicherung
