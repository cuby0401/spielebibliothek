#!/bin/sh
# Alle Ende-zu-Ende-Tests (Idee 10, Zentrale 1.2.0). Läuft auch bei scripts/deploy.sh --gruendlich.
# Braucht auf dem Mac: Google Chrome und Node ≥ 22. Der Teststand wird für jeden Test frisch aufgebaut und am Ende wieder
# entfernt – die echte Bibliothek wird nicht angefasst.
#
# Seit 1.4.1 (NAS entlasten): Läuft Docker Desktop auf dem Mac, steht auch der Teststand auf dem Mac – die NAS hat dann
# nichts zu tun. Sonst wie bisher auf der NAS (über ssh). Erzwingen: E2E_ORT=mac oder E2E_ORT=nas.
# Einzelne Tests: E2E_TESTS="zentrale-1.3-steckbrief" sh scripts/e2e-alle.sh
set -eu
cd "$(dirname "$0")/.."
NAS="${NAS:-$NAS}"
ORT="${E2E_ORT:-$(docker info >/dev/null 2>&1 && echo mac || echo nas)}"
TMP=$(mktemp -d)
if [ "$ORT" = mac ]; then
	export LOKAL=1 GH=127.0.0.1 PH=localhost UH=upload.localhost
	export E2E_G="http://$GH:18088" E2E_U="http://$UH:18090"
	REPO="$TMP/repo"
	aufraeumen() {
		sh "$REPO/scripts/teststand.sh" down >/dev/null 2>&1 || true
		rm -rf "$TMP"
	}
else
	aufraeumen() {
		ssh -o LogLevel=ERROR "$NAS" "sh /tmp/sb-repo/scripts/teststand.sh down >/dev/null 2>&1; docker rmi spielebibliothek-savesvc:sbtest >/dev/null 2>&1; rm -rf /tmp/sb-repo" 2>/dev/null || true
		rm -rf "$TMP"
	}
fi
trap aufraeumen EXIT
if [ "$ORT" = mac ]; then
	# Nie zwei Runden gleichzeitig auf dem Mac – sie teilen sich Teststand und Ports (1.4.1). Die zweite wartet.
	SPERRE=/tmp/sb-e2e-mac.sperre
	until mkdir "$SPERRE" 2>/dev/null; do
		kill -0 "$(cat "$SPERRE/pid" 2>/dev/null)" 2>/dev/null || { rm -rf "$SPERRE"; continue; }
		[ -n "${GEWARTET:-}" ] || { echo "  Warte, bis die laufende Runde fertig ist …"; GEWARTET=1; }
		sleep 5
	done
	echo $$ > "$SPERRE/pid"
	trap 'aufraeumen; rm -rf "$SPERRE"' EXIT
fi
echo "  Teststand auf: $ORT"

python3 -I scripts/e2e-vorbereiten.py "$TMP"
# Dateiliste: im Git-Repo alle versionierten und neuen Dateien, sonst (Release-Stand beim Auftrag auf dem Mac, 1.4.1) alles
dateien() { if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard; else find . -type f ! -path './.git/*' ! -name '.DS_Store'; fi; }
if [ "$ORT" = mac ]; then
	mkdir -p "$REPO" && dateien | tar --no-mac-metadata --no-xattrs -cf - -T - | tar -xf - -C "$REPO"
else
	dateien | tar --no-mac-metadata --no-xattrs -cf - -T - | ssh -o LogLevel=ERROR "$NAS" "rm -rf /tmp/sb-repo && mkdir -p /tmp/sb-repo && tar -xf - -C /tmp/sb-repo"
fi

# Teststand frisch aufbauen, Spiel von „paul“ anlegen, Upload-Passwort zurückgeben (gemeinsam mit dem Auftragsdienst)
teststand_einmal() {
	if [ "$ORT" = mac ]; then sh "$REPO/scripts/e2e-teststand.sh" "$REPO" 2>"$TMP/teststand.log"
	else ssh -o LogLevel=ERROR "$NAS" 'sh /tmp/sb-repo/scripts/e2e-teststand.sh /tmp/sb-repo' 2>"$TMP/teststand.log"; fi
}
# Ein zweiter Versuch, falls der Aufbau einmal hakt (1.4.1); schlägt auch der fehl, steht der Grund im Log
teststand() {
	teststand_einmal && return 0
	echo "  Teststand: zweiter Versuch" >&2
	teststand_einmal && return 0
	echo "ABBRUCH: Teststand ließ sich nicht aufbauen:" >&2; tail -15 "$TMP/teststand.log" | sed 's/^/  /' >&2
	return 1
}

FEHLER=""
for t in ${E2E_TESTS:-versionierung zentrale-1.1 zentrale-1.2 zentrale-1.3 zentrale-1.3-steckbrief zentrale-1.3.1-antraege zentrale-1.4-crm zentrale-1.5 zentrale-1.6 bausteine boese}; do
	echo "→ Ende-zu-Ende: $t"
	PW=$(teststand) || { FEHLER="$FEHLER $t"; continue; }
	rm -rf "$TMP/chrome-profil" "$TMP/chrome-profil2"
	# Auf dem Mac aus der Kopie – so stört es nicht, wenn während eines Hintergrundlaufs am Repo weitergearbeitet wird
	S=scripts; [ "$ORT" = mac ] && S="$REPO/scripts"
	if [ "$t" = boese ]; then set -- node "$S/e2e-boese.mjs" "$TMP"; else set -- node "$S/e2e-$t.mjs" "$TMP" "$PW"; fi
	# Höchstens 5 Minuten je Test – ein hängender Test soll die Runde nicht blockieren (1.4.1)
	if perl -e 'alarm shift; exec @ARGV' 300 "$@" > "$TMP/log" 2>&1; then
		echo "  ✓ $(grep -c '^✓' "$TMP/log") Prüfpunkte grün"
	else
		# Ohne ✗/ABBRUCH (Absturz, Zeitgrenze) die letzten Zeilen zeigen – vorher blieb es dann stumm (1.5.0)
		if grep -qE "^✗|ABBRUCH" "$TMP/log"; then grep -E "^✗|ABBRUCH" "$TMP/log" | sed 's/^/  /'; else echo "  (Abbruch ohne Prüfpunkt – letzte Zeilen:)"; tail -8 "$TMP/log" | sed 's/^/  /'; fi
		FEHLER="$FEHLER $t"
	fi
done
[ -z "$FEHLER" ] || { echo "✗ Ende-zu-Ende fehlgeschlagen:$FEHLER"; exit 1; }
echo "✓ Alle Ende-zu-Ende-Tests grün"
