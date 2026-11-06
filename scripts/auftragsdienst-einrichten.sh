#!/bin/sh
# Auftragsdienst auf der NAS einrichten (einmalig, vom Mac aus) – Zentrale 1.3.0.
# Trägt in der crontab von Sebi eine Zeile ein, die scripts/auftragsdienst.py jede Minute startet.
#   sh scripts/auftragsdienst-einrichten.sh            einrichten (mehrfach aufrufen schadet nicht)
#   sh scripts/auftragsdienst-einrichten.sh --aus      wieder austragen
# Voraussetzung: Zentrale ab 1.3.0 ist live (das Skript liegt dann unter /volume1/docker/spielebibliothek/scripts/).
set -eu
NAS="${NAS:-$NAS}"
ZEILE='* * * * * /usr/bin/python3 -I /volume1/docker/spielebibliothek/scripts/auftragsdienst.py >> /tmp/sb-auftragsdienst.log 2>&1'
if [ "${1:-}" = "--aus" ]; then
	ssh -o LogLevel=ERROR "$NAS" "crontab -l 2>/dev/null | grep -v 'scripts/auftragsdienst.py' | crontab -"
	echo "✓ Auftragsdienst ausgetragen."; exit 0
fi
ssh -o LogLevel=ERROR "$NAS" "
	set -e
	[ -f /volume1/docker/spielebibliothek/scripts/auftragsdienst.py ] || { echo '✗ Erst Zentrale 1.3.0 live einspielen.'; exit 1; }
	( crontab -l 2>/dev/null | grep -v 'scripts/auftragsdienst.py'; echo '$ZEILE' ) | crontab -
	crontab -l | grep auftragsdienst
"
echo "✓ Auftragsdienst eingerichtet – im Admin-Panel unter „Aufgaben“ steht nach spätestens einer Minute „läuft“."
