#!/bin/sh
# Phase 0: Ordner und Rechte unter /volume1/games anlegen.
# Läuft AUF DER NAS mit sudo, nachdem der Freigabeordner "games" in UGOS angelegt wurde:
#
#   sudo sh /volume1/docker/spielebibliothek/scripts/nas-setup.sh
#
# Idempotent: kann beliebig oft laufen und setzt die Rechte jedes Mal neu.
#
# Muster wie /volume1/seb-brain (seb-brain → Vault-Migration): Default-ACLs statt Gruppe,
# damit die umask der Container die Rechte nicht verbiegt.
#
#   UID    wer           spiele/   data/   filebrowser/
#   1000   Sebi (Admin)  rwX       rwX     rwX
#   10020  caddy         r-X       –       –
#   10021  filebrowser   rwX       –       rwX
#   10022  savesvc       r-X       rwX     –
#
# "other" bekommt nichts – die UGOS-Freigabe startet mit 777, das wird hier entzogen.

set -eu

G=/volume1/games
SEBI=1000
CADDY=10020
FILEBROWSER=10021
SAVESVC=10022

if [ "$(id -u)" != 0 ]; then
	echo "Bitte mit sudo ausführen." >&2
	exit 1
fi
if [ ! -d "$G" ]; then
	echo "$G fehlt. Erst in UGOS den Freigabeordner \"games\" auf volume1 anlegen." >&2
	exit 1
fi

mkdir -p "$G/spiele/seb" "$G/data/backup" "$G/filebrowser"

# Wurzel: nur durchgehen (x) für die Container, Sebi voll, other nichts
chmod o= "$G"
setfacl -m "u:$SEBI:rwx,u:$CADDY:--x,u:$FILEBROWSER:--x,u:$SAVESVC:--x,o::---" "$G"

# Bestehende Rechte und Default-ACLs in den drei Bereichen setzen
acl() { # acl <ordner> <acl-einträge>
	chmod -R o= "$1"
	setfacl -R -m "$2,o::---" "$1"
	setfacl -R -d -m "$2,o::---" "$1"
}

acl "$G/spiele"      "u:$SEBI:rwX,u:$FILEBROWSER:rwX,u:$CADDY:r-X,u:$SAVESVC:r-X"
acl "$G/data"        "u:$SEBI:rwX,u:$SAVESVC:rwX"
acl "$G/filebrowser" "u:$SEBI:rwX,u:$FILEBROWSER:rwX"

echo "Fertig. Kontrolle:"
for d in "$G" "$G/spiele" "$G/data" "$G/filebrowser"; do
	echo "--- $d"
	getfacl -p "$d" 2>/dev/null | grep -v '^#'
done
