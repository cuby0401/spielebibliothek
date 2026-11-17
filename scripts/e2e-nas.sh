#!/bin/sh
# Alle Ende-zu-Ende-Tests direkt auf der NAS – für den Auftragsdienst (Zentrale 1.3.0). Gegenstück zu e2e-alle.sh (Mac).
#   sh e2e-nas.sh <repo-dir>
# Chrome läuft im Container sb-e2e (scripts/e2e-container), der Teststand wie immer unter /tmp/sb-teststand.
# Hostnamen nur lokal: games 127.0.0.1:18088, play localhost:18089, upload 127.0.0.2:18090 (drei verschiedene Ursprünge).
set -eu
REPO="$1"
export GH=127.0.0.1 PH=localhost UH=127.0.0.2
TMP=$(mktemp -d /tmp/sb-e2e.XXXXXX)
aufraeumen() {
	sh "$REPO/scripts/teststand.sh" down >/dev/null 2>&1 || true
	docker rmi spielebibliothek-savesvc:sbtest >/dev/null 2>&1 || true
	rm -rf "$TMP"
}
trap aufraeumen EXIT
docker build -q -t sb-e2e "$REPO/scripts/e2e-container" >/dev/null
python3 -I "$REPO/scripts/e2e-vorbereiten.py" "$TMP"
chmod -R a+rwX "$TMP"
FEHLER=""
for t in ${E2E_TESTS:-versionierung zentrale-1.1 zentrale-1.2 zentrale-1.3 zentrale-1.3-steckbrief zentrale-1.3.1-antraege zentrale-1.4-crm zentrale-1.5 zentrale-1.6-multiplayer boese}; do
	echo "→ Ende-zu-Ende: $t"
	PW=$(sh "$REPO/scripts/e2e-teststand.sh" "$REPO")
	rm -rf "$TMP/chrome-profil" "$TMP/chrome-profil2"
	if [ "$t" = boese ]; then set -- "$TMP"; else set -- "$TMP" "$PW"; fi
	if docker run --rm --network host -v "$REPO/scripts:/s:ro" -v "$TMP:$TMP" \
		-e E2E_G=http://$GH:18088 -e E2E_U=http://$UH:18090 sb-e2e node "/s/e2e-$t.mjs" "$@" > "$TMP/log" 2>&1; then
		echo "  ✓ $(grep -c '^✓' "$TMP/log") Prüfpunkte grün"
	else
		grep -E "^✗|ABBRUCH" "$TMP/log" | sed 's/^/  /' || tail -5 "$TMP/log" | sed 's/^/  /'
		FEHLER="$FEHLER $t"
	fi
done
[ -z "$FEHLER" ] || { echo "✗ Ende-zu-Ende fehlgeschlagen:$FEHLER"; exit 1; }
echo "✓ Alle Ende-zu-Ende-Tests grün"
