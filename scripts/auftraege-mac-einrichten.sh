#!/bin/sh
# Aufträge auf dem Mac (Zentrale 1.4.1, NAS entlasten) einrichten: launchd startet scripts/auftraege-mac.py alle 20 Sekunden.
# Läuft Docker Desktop, übernimmt der Mac Unit- und Ende-zu-Ende-Tests aus dem Admin-Panel (Live und Testserver),
# sonst wie bisher der Auftragsdienst auf der NAS.
#
#   sh scripts/auftraege-mac-einrichten.sh         einrichten bzw. aktualisieren
#   sh scripts/auftraege-mac-einrichten.sh --aus   austragen
#
# Log: ~/Library/Logs/spielebibliothek-auftraege.log
set -eu
cd "$(dirname "$0")/.."
NAME=uk.cuby0401.spielebibliothek-auftraege
PLIST="$HOME/Library/LaunchAgents/$NAME.plist"
launchctl bootout "gui/$(id -u)/$NAME" 2>/dev/null || true
if [ "${1:-}" = "--aus" ]; then
	rm -f "$PLIST"
	echo "✓ Aufträge auf dem Mac ausgetragen – Tests laufen wieder auf der NAS."
	exit 0
fi
[ -x .venv/bin/python ] || { echo "✗ .venv fehlt (python3 -m venv .venv && .venv/bin/pip install -r savesvc/requirements.txt pytest)"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$NAME</string>
	<key>ProgramArguments</key>
	<array>
		<string>$PWD/.venv/bin/python</string>
		<string>-I</string>
		<string>$PWD/scripts/auftraege-mac.py</string>
	</array>
	<key>StartInterval</key><integer>20</integer>
	<key>RunAtLoad</key><true/>
	<key>ProcessType</key><string>Background</string>
	<key>EnvironmentVariables</key>
	<dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
	<key>StandardOutPath</key><string>$HOME/Library/Logs/spielebibliothek-auftraege.log</string>
	<key>StandardErrorPath</key><string>$HOME/Library/Logs/spielebibliothek-auftraege.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ Aufträge auf dem Mac eingerichtet – im Admin-Panel unter „Aufgaben“ steht nach spätestens 20 Sekunden „Mac bereit“ (Docker Desktop muss laufen)."
