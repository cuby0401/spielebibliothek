#!/bin/sh
# Verwaltung des Uploads (File Browser) – AUF DER NAS ausführen, z. B. vom Mac aus:
#
#   ssh -t $NAS sh /volume1/docker/spielebibliothek/scripts/filebrowser.sh <befehl>
#
#   einrichten           Grundeinstellungen setzen (idempotent, legt KEINEN Admin an)
#   anlegen <name>       Benutzer + Ordner spiele/<name> anlegen; das Passwort wird EINMAL angezeigt
#   passwort <name>      neues Passwort erzeugen und anzeigen
#   sperren <name>       Benutzer löschen (sein Spielordner und die Spielstände bleiben)
#   liste                Benutzer anzeigen
#
# Spezifikation: seb-brain → Projekte/Spielebibliothek/Sicherheit (File Browser härten), Betrieb/Benutzerverwaltung
# Passwörter: 20 Zeichen, nur auf diesem Terminal sichtbar – persönlich weitergeben, nicht per Mail.

set -eu
cd "$(dirname "$0")/.."

SPIELE=/volume1/games/spiele
FB_DIR=/volume1/games/filebrowser
MUSTER='^[a-z0-9][a-z0-9_-]{0,31}$'

# File Browser nutzt eine Bolt-Datenbank mit exklusiver Sperre: CLI nur bei gestopptem Dienst
fb() { docker compose run --rm --no-deps -T filebrowser "$@"; }
gestoppt() {
	docker compose stop filebrowser >/dev/null 2>&1 || true
	"$@" || { rc=$?; docker compose up -d filebrowser >/dev/null 2>&1 || true; return $rc; }
	docker compose up -d filebrowser >/dev/null
}

passwort_neu() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-20; }

name_pruefen() {
	echo "$1" | grep -Eq "$MUSTER" || { echo "Ungültiger Name: klein, a–z, 0–9, _ und -, max. 32 Zeichen." >&2; exit 2; }
}

# Grundeinstellungen + Vorgaben für neue Benutzer
# root/address/port ausdrücklich: config init übernimmt sie NICHT aus settings.json (sonst Root "." →
# Benutzerordner landen außerhalb von /srv, Address 127.0.0.1)
# fileMode/dirMode mit Gruppenbits: Sie bilden die ACL-Maske – sonst kann Sebi Uploads nicht ändern/löschen.
# "other" bleibt 0.
EINSTELLUNGEN="--root=/srv --address=0.0.0.0 --port=8080 --fileMode=0o660 --dirMode=0o770 --auth.method=json --signup=false --createUserDir=false --disableExec \
  --minimumPasswordLength=16 --branding.name=Spielebibliothek-Upload \
  --branding.disableExternal --branding.disableUsedPercentage \
  --perm.admin=false --perm.execute=false --perm.share=false \
  --perm.create --perm.rename --perm.modify --perm.delete --perm.download \
  --lockPassword --hideDotfiles --locale=de"

RECHTE="--perm.admin=false --perm.execute=false --perm.share=false \
  --perm.create --perm.rename --perm.modify --perm.delete --perm.download \
  --lockPassword --hideDotfiles --locale=de"

case "${1:-}" in
einrichten)
	mkdir -p "$FB_DIR/config" "$FB_DIR/database"
	if [ -f "$FB_DIR/database/filebrowser.db" ]; then
		# shellcheck disable=SC2086
		gestoppt fb config set $EINSTELLUNGEN >/dev/null
		echo "Einstellungen aktualisiert."
	else
		# shellcheck disable=SC2086
		gestoppt fb config init $EINSTELLUNGEN >/dev/null
		echo "Datenbank angelegt (ohne Benutzer). Als Nächstes: anlegen <name>"
	fi
	;;
anlegen)
	name="${2:-}"; name_pruefen "$name"
	[ -f "$FB_DIR/database/filebrowser.db" ] || { echo "Erst: einrichten" >&2; exit 1; }
	mkdir -p "$SPIELE/$name"   # erbt die Default-ACLs von spiele/
	pw=$(passwort_neu)
	# shellcheck disable=SC2086
	gestoppt fb users add "$name" "$pw" --scope="/$name" $RECHTE >/dev/null
	echo
	echo "Benutzer:  $name"
	echo "Passwort:  $pw"
	echo "Ordner:    $SPIELE/$name"
	echo
	echo "Passwort jetzt notieren und persönlich weitergeben – es wird nicht gespeichert."
	;;
passwort)
	name="${2:-}"; name_pruefen "$name"
	pw=$(passwort_neu)
	gestoppt fb users update "$name" --password "$pw" >/dev/null
	echo "Neues Passwort für $name:  $pw"
	;;
sperren)
	name="${2:-}"; name_pruefen "$name"
	gestoppt fb users rm "$name" >/dev/null
	echo "$name gelöscht. Ordner $SPIELE/$name und Spielstände bleiben erhalten."
	;;
liste)
	gestoppt fb users ls
	;;
*)
	sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
	;;
esac
