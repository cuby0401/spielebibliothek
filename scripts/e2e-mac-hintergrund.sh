#!/bin/sh
# Ende-zu-Ende-Tests im Hintergrund auf dem Mac (1.4.1, NAS entlasten) – startet scripts/deploy.sh --probe, wenn Docker Desktop läuft.
# Teststand und Chrome laufen auf dem Mac, die NAS rechnet nichts. Das Ergebnis landet wie bisher im Admin-Panel unter
# „Aufgaben“ (bei Rot rote Glocke und Home Assistant) – dafür meldet das Skript Start und Ende an den Speicher-Dienst.
# Log: ~/Library/Logs/spielebibliothek-e2e.log
set -u
cd "$(dirname "$0")/.."
NAS="${NAS:-$NAS}"
LOG="$HOME/Library/Logs/spielebibliothek-e2e.log"
START=$(date -u +%Y-%m-%dT%H:%M:%S+00:00)
melden() {   # status, zusammenfassung, [id] → gibt die Auftragsnummer aus
	python3 -I -c 'import json, sys; s, z, i, start, log = sys.argv[1:6]
print(json.dumps({"art": "e2e-tests", "ziel": "probe", "status": s, "zusammenfassung": z, "start": start,
                  "id": int(i) if i.isdigit() else None, "log": open(log, encoding="utf-8", errors="replace").read() if log else ""}))' \
		"$1" "$2" "${3:-}" "$START" "${4:-}" |
		ssh -o LogLevel=ERROR "$NAS" "docker exec -i spielebibliothek-savesvc python -m savesvc auftrag-fertig" 2>/dev/null |
		python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])' 2>/dev/null
}
AID=$(melden laeuft "läuft auf dem Mac" "" "")
if E2E_ORT=mac sh scripts/e2e-alle.sh > "$LOG" 2>&1; then S=ok; else S=fehler; fi
melden "$S" "Mac: $(tail -1 "$LOG")" "$AID" "$LOG" >/dev/null
