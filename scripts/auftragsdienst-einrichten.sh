#!/bin/sh
# Auftragsdienst auf der NAS einrichten (einmalig, vom Mac aus) – Zentrale 1.3.0.
# Legt /etc/cron.d/spielebibliothek-auftragsdienst an: startet scripts/auftragsdienst.py jede Minute ALS Sebi (nicht als root).
# Eine eigene crontab darf Sebi auf UGOS nicht anlegen (/var/spool/cron gehört root) – deshalb einmal sudo.
#
#   sh scripts/auftragsdienst-einrichten.sh            einrichten (fragt einmal nach dem NAS-Passwort von Sebi)
#   sh scripts/auftragsdienst-einrichten.sh --aus      wieder austragen
#
# Im normalen Terminal ausführen (nicht über „!“ in Claude Code) – sudo braucht eine Passwort-Eingabe.
# Voraussetzung: Zentrale ab 1.3.0 ist live. Nach einem UGOS-Update prüfen, ob die Datei noch da ist –
# fehlt sie, meldet das der Wächter („Auftragsdienst meldet sich nicht mehr“).
set -eu
NAS="${NAS:-$NAS}"
DATEI=/etc/cron.d/spielebibliothek-auftragsdienst
ZEILE='* * * * * Sebi /usr/bin/python3 -I /volume1/docker/spielebibliothek/scripts/auftragsdienst.py >> /tmp/sb-auftragsdienst.log 2>&1'
if [ "${1:-}" = "--aus" ]; then
	ssh -t -o LogLevel=ERROR "$NAS" "sudo rm -f $DATEI && echo '✓ Auftragsdienst ausgetragen.'"
	exit 0
fi
ssh -t -o LogLevel=ERROR "$NAS" "
	set -e
	[ -f /volume1/docker/spielebibliothek/scripts/auftragsdienst.py ] || { echo '✗ Erst Zentrale 1.3.0 live einspielen.'; exit 1; }
	printf '%s\n' '# Spielebibliothek: Auftragsdienst (scripts/auftragsdienst.py, Zentrale 1.3.0) – läuft als Sebi' '$ZEILE' | sudo tee $DATEI >/dev/null
	sudo chown root:root $DATEI && sudo chmod 644 $DATEI
	echo; cat $DATEI
"
echo "✓ Auftragsdienst eingerichtet – im Admin-Panel unter „Aufgaben“ steht nach spätestens einer Minute „läuft“."
