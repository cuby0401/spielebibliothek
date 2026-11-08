#!/bin/sh
# Teststand frisch aufbauen und für die Ende-zu-Ende-Tests vorbereiten – läuft auf der NAS (Zentrale 1.3.0).
# Gemeinsam genutzt von scripts/e2e-alle.sh (Mac, über ssh) und scripts/e2e-nas.sh (Auftragsdienst).
#   sh e2e-teststand.sh <repo-dir>      → gibt das Upload-Passwort von seb aus
# Hostnamen wie in teststand.sh über GH/PH/UH (Mac: Tailscale-Namen, NAS: 127.0.0.1/localhost/127.0.0.2).
set -eu
REPO="$1"
sh "$REPO/scripts/teststand.sh" up "$REPO" >&2; sleep 3   # Ausgaben nach stderr – e2e-alle.sh legt sie ins Log
# Spiel von „paul“ mit Kategorien, Erfolgen und Bestenliste
d=/tmp/sb-teststand/spiele/paul/raetsel; mkdir -p $d
printf "%s" "{\"title\":\"Rätselspaß\",\"description\":\"Test\",\"tags\":[\"Puzzle\",\"Wörter\"],\"leaderboard\":{\"enabled\":true},\"erfolge\":[{\"id\":\"start\",\"titel\":\"Losgelegt\"},{\"id\":\"profi\",\"titel\":\"Profi\",\"geheim\":true}]}" > $d/game.json
printf "%s" "<!doctype html><script src=\"/lib/gamesave.js\"></script><p>R</p><script>setTimeout(()=>GameSave.erfolg(\"start\"),800)</script>" > $d/index.html
chmod -R a+rwX /tmp/sb-teststand/spiele/paul
docker exec sbtest-upload python -m savesvc entwickler anlegen seb 2>&1 | sed -n "s/^Passwort: *//p"
