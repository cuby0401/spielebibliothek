#!/bin/sh
# Auftragsdienst auf dem Server einrichten (einmalig, vom Mac aus) – Zentrale 1.3.0. Server und Pfade aus lokal.env (SERVER_ORT).
# Legt /etc/cron.d/spielebibliothek-auftragsdienst an: startet scripts/auftragsdienst.py jede Minute ALS Sebi (nicht als root).
# Eine eigene crontab darf Sebi auf UGOS nicht anlegen (/var/spool/cron gehört root) – deshalb einmal sudo.
# Auf der Docker-VM gibt es sudo ohne Passwort. Die Pfade bekommt der Dienst über die Umgebung (SB_LIVE …).
#
#   sh scripts/auftragsdienst-einrichten.sh            einrichten (NAS: fragt einmal nach dem Passwort von Sebi)
#   sh scripts/auftragsdienst-einrichten.sh --aus      wieder austragen
#
# Im normalen Terminal ausführen (nicht über „!“ in Claude Code) – sudo braucht eine Passwort-Eingabe.
# Voraussetzung: Zentrale ab 1.3.0 ist live. Nach einem UGOS-Update prüfen, ob die Datei noch da ist –
# fehlt sie, meldet das der Wächter („Auftragsdienst meldet sich nicht mehr“).
set -eu
. "$(dirname "$0")/lokal.sh"   # SERVER und Pfade aus lokal.env
server_noetig
NUTZER="${SERVER%@*}"          # der Benutzer aus <benutzer>@<host>
DATEI=/etc/cron.d/spielebibliothek-auftragsdienst
UMGEBUNG="SB_LIVE=$SB_STACK SB_QUELLE=$SB_QUELLE SB_PROBE=$SB_PROBE SB_RELEASES=$SB_RELEASES"
ZEILE='* * * * * '"$NUTZER $UMGEBUNG"' /usr/bin/python3 -I '"$SB_STACK"'/scripts/auftragsdienst.py >> /tmp/sb-auftragsdienst.log 2>&1'
if [ "${1:-}" = "--aus" ]; then
	ssh -t -o LogLevel=ERROR "$SERVER" "sudo rm -f $DATEI && echo '✓ Auftragsdienst ausgetragen.'"
	exit 0
fi
ssh -t -o LogLevel=ERROR "$SERVER" "
	set -e
	[ -f $SB_STACK/scripts/auftragsdienst.py ] || { echo '✗ Erst Zentrale 1.3.0 live einspielen.'; exit 1; }
	printf '%s\n' '# Spielebibliothek: Auftragsdienst (scripts/auftragsdienst.py, Zentrale 1.3.0) – läuft als Sebi' '$ZEILE' | sudo tee $DATEI >/dev/null
	sudo chown root:root $DATEI && sudo chmod 644 $DATEI
	echo; cat $DATEI
"
echo "✓ Auftragsdienst eingerichtet – im Admin-Panel unter „Aufgaben“ steht nach spätestens einer Minute „läuft“."
