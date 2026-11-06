#!/bin/sh
# Alle Ende-zu-Ende-Tests im Teststand auf der NAS (Idee 10, Zentrale 1.2.0). Läuft auch bei scripts/deploy.sh --gruendlich.
# Braucht auf dem Mac: Google Chrome und Node ≥ 22. Dauer ca. 6–8 Minuten. Der Teststand wird für jeden Test frisch aufgebaut
# und am Ende wieder entfernt – die echte Bibliothek wird nicht angefasst.
set -eu
cd "$(dirname "$0")/.."
NAS="${NAS:-$NAS}"
TMP=$(mktemp -d)
aufraeumen() {
	ssh -o LogLevel=ERROR "$NAS" "sh /tmp/sb-repo/scripts/teststand.sh down >/dev/null 2>&1; docker rmi spielebibliothek-savesvc:sbtest >/dev/null 2>&1; rm -rf /tmp/sb-repo" 2>/dev/null || true
	rm -rf "$TMP"
}
trap aufraeumen EXIT

python3 -I scripts/e2e-vorbereiten.py "$TMP"
git ls-files -co --exclude-standard | tar --no-mac-metadata --no-xattrs -cf - -T - | ssh -o LogLevel=ERROR "$NAS" "rm -rf /tmp/sb-repo && mkdir -p /tmp/sb-repo && tar -xf - -C /tmp/sb-repo"

# Teststand frisch aufbauen, Spiel von „paul“ anlegen, Upload-Passwort zurückgeben (gemeinsam mit dem Auftragsdienst)
teststand() {
	ssh -o LogLevel=ERROR "$NAS" 'sh /tmp/sb-repo/scripts/e2e-teststand.sh /tmp/sb-repo' 2>/dev/null
}

FEHLER=""
# Einzelne Tests: E2E_TESTS="zentrale-1.3-steckbrief" sh scripts/e2e-alle.sh
for t in ${E2E_TESTS:-versionierung zentrale-1.1 zentrale-1.2 zentrale-1.3 zentrale-1.3-steckbrief zentrale-1.3.1-antraege boese}; do
	echo "→ Ende-zu-Ende: $t"
	PW=$(teststand)
	rm -rf "$TMP/chrome-profil" "$TMP/chrome-profil2"
	if [ "$t" = boese ]; then set -- node scripts/e2e-boese.mjs "$TMP"; else set -- node "scripts/e2e-$t.mjs" "$TMP" "$PW"; fi
	if "$@" > "$TMP/log" 2>&1; then
		echo "  ✓ $(grep -c '^✓' "$TMP/log") Prüfpunkte grün"
	else
		grep -E "^✗|ABBRUCH" "$TMP/log" | sed 's/^/  /'
		FEHLER="$FEHLER $t"
	fi
done
[ -z "$FEHLER" ] || { echo "✗ Ende-zu-Ende fehlgeschlagen:$FEHLER"; exit 1; }
echo "✓ Alle Ende-zu-Ende-Tests grün"
