#!/bin/sh
# Schiebt den Stack (die „Zentrale“) vom Mac auf die NAS und startet ihn – versioniert (E39).
#
#   scripts/deploy.sh --probe            neue Version zuerst in die PROBE-Zentrale (Kopie der echten Daten, nur über Tailscale)
#   scripts/deploy.sh --probe --daten-behalten   Probe aktualisieren, ohne die Daten neu zu kopieren
#   scripts/deploy.sh                    neue Version LIVE – nur wenn genau dieser Commit in der Probe freigegeben wurde (E56).
#                                        Seit 1.3.0 meist unnötig: „Für Live freigeben“ in der Probe spielt automatisch ein
#                                        (Auftragsdienst auf der NAS, scripts/auftragsdienst.py). deploy.sh holt dann nur den Git-Tag nach.
#   scripts/deploy.sh --ohne-probe       Live ohne Freigabe (nur im Notfall, z. B. dringender Hotfix)
#   scripts/deploy.sh --examples         zusätzlich examples/* nach /volume1/games/spiele/seb/ kopieren
#   scripts/deploy.sh --no-start         nur übertragen, nicht starten
#   scripts/deploy.sh --gruendlich       zusätzlich alle Ende-zu-Ende-Tests und „Böse“ im Teststand (ca. 6–8 Min., für große Updates)
#   scripts/deploy.sh --ohne-tests       Tests überspringen (nur im Notfall)
#   scripts/deploy.sh --zurueck 1.1.0    auf eine früher deployte Version zurück (aus dem Release-Archiv)
#   scripts/deploy.sh --versionen        aufgehobene Versionen auf der NAS anzeigen
#   scripts/deploy.sh --notaus           NOT-AUS vom Mac: alle Daten sofort gesperrt, Tunnel aus (auch im Admin-Panel auslösbar)
#   scripts/deploy.sh --notaus-aus       Not-Aus aufheben – geht NUR hier, nicht im Admin-Panel (mit --probe: in der Probe)
#   scripts/deploy.sh --notaus-status    Zustand anzeigen
#
# Schutz vor „Peng, alles kaputt“:
#   0. Live nur nach Test in der Probe-Zentrale und „Für Live freigeben“ im Admin-Panel der Probe.
#   1. Nur ein sauberer, committeter Stand wird deployt – mit neuer Nummer in VERSION und Eintrag „## <Version>“ in CHANGELOG.md.
#      Dieselbe Nummer für einen anderen Commit wird abgelehnt (Git-Tag zentrale-v<Version>).
#   2. Vorher laufen alle Unit-Tests auf dem Mac (Python 3.12 wie in Produktion, ca. 10 s, ohne uv auf der NAS). Rot = kein Deploy.
#      Nach --probe laufen die Ende-zu-Ende-Tests im Hintergrund auf der NAS weiter – der Testserver wartet nicht darauf.
#   3. Vorher wird die Datenbank gesichert: /volume1/games/data/backup/vor-deploy/<Anlass>-<Zeit>.db (die letzten 10).
#   4. Vorher wird der laufende Stand archiviert: /volume1/docker/spielebibliothek-releases/<Version>.tar (die letzten 5).
#   5. Spiele, Spielstände, .env und config/ liegen außerhalb und werden nie angefasst.
#
# Übertragen werden alle von git verfolgten Dateien außer examples/. Dateien, die im Repo gelöscht wurden,
# werden auf der NAS ebenfalls entfernt. Warum tar statt rsync: macOS liefert openrsync, das mit dem rsync der NAS nicht zusammenspielt.

set -eu

NAS="${NAS:-$NAS}"
ZIEL="${ZIEL:-/volume1/docker/spielebibliothek}"
RELEASES="${RELEASES:-/volume1/docker/spielebibliothek-releases}"
SPIELE=/volume1/games/spiele/seb

BEISPIELE=0
STARTEN=1
TESTS=1
GRUENDLICH=0
PROBE=0
OHNE_PROBE=0
BEHALTEN=""
PROBE_DIR=/volume1/docker/spielebibliothek-probe
PROBE_URL=https://test.cuby0401.uk
ZURUECK=""
NOTAUS=""
while [ $# -gt 0 ]; do
	case "$1" in
		--examples) BEISPIELE=1 ;;
		--no-start) STARTEN=0 ;;
		--ohne-tests) TESTS=0 ;;
		--gruendlich) GRUENDLICH=1 ;;
		--probe) PROBE=1 ;;
		--ohne-probe) OHNE_PROBE=1 ;;
		--daten-behalten) BEHALTEN="--daten-behalten" ;;
		--zurueck) shift; ZURUECK="${1:-}"; [ -n "$ZURUECK" ] || { echo "--zurueck braucht eine Version, z. B. 1.1.0" >&2; exit 2; } ;;
		--versionen) ssh "$NAS" "ls -1t $RELEASES 2>/dev/null | sed 's/\.tar\$//' || echo '(noch keine)'"; exit 0 ;;
		--notaus) NOTAUS=ein ;;
		--notaus-aus) NOTAUS=aus ;;
		--notaus-status) NOTAUS=status ;;
		*) echo "Unbekannte Option: $1" >&2; exit 2 ;;
	esac
	shift
done

cd "$(dirname "$0")/.."
export COPYFILE_DISABLE=1 # keine ._-Dateien von macOS

# ---------- Not-Aus (Zentrale 1.4.0, E72) ----------
# Ein: sperrt sofort alle Daten und stoppt den Tunnel. Aus: NUR hier vom Mac – nicht aus dem Admin-Panel.
# Mit --probe wirkt es auf die Probe-Zentrale (zum Ausprobieren; die hat keinen Tunnel).
if [ -n "$NOTAUS" ]; then
	if [ "$PROBE" = 1 ]; then C=sbprobe-savesvc; T=""; else C=spielebibliothek-savesvc; T=spielebibliothek-cloudflared; fi
	case "$NOTAUS" in
		ein) ssh -o LogLevel=ERROR "$NAS" "docker exec $C python -m savesvc notaus ein --von mac --grund 'am Mac ausgelöst (deploy.sh --notaus)' ${T:+&& docker stop $T >/dev/null && echo 'Tunnel gestoppt'}" ;;
		aus)
			printf 'Not-Aus wirklich aufheben? Vorher sicherstellen, dass das Leck geschlossen ist. [ja/nein] '
			read -r ANTWORT; [ "$ANTWORT" = ja ] || { echo "Abgebrochen – Not-Aus bleibt an."; exit 1; }
			ssh -o LogLevel=ERROR "$NAS" "docker exec $C python -m savesvc notaus aus --von mac ${T:+&& docker start $T >/dev/null && echo 'Tunnel läuft wieder'}" ;;
		status) ssh -o LogLevel=ERROR "$NAS" "docker exec $C python -m savesvc notaus status; ${T:+docker inspect -f 'Tunnel läuft: {{.State.Running}}' $T}" ;;
	esac
	exit $?
fi

# Git-Tags für Versionen nachholen, die der Auftragsdienst nach einer Freigabe live eingespielt hat (1.3.0)
tag_nachholen() {
	LIVE_JSON=$(ssh -o LogLevel=ERROR "$NAS" "cat $ZIEL/site/zentrale.json 2>/dev/null" || true)
	LV=$(printf '%s' "$LIVE_JSON" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')
	LC=$(printf '%s' "$LIVE_JSON" | sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p')
	[ -n "$LV" ] && [ -n "$LC" ] || return 0
	git rev-parse -q --verify "refs/tags/zentrale-v$LV" >/dev/null && return 0
	git cat-file -e "$LC^{commit}" 2>/dev/null || return 0
	git tag -a "zentrale-v$LV" "$LC" -m "Zentrale $LV live (Auftragsdienst nach Freigabe)" && echo "  Tag zentrale-v$LV nachgeholt (live per Freigabe)"
	git push -q origin "zentrale-v$LV" || echo "Hinweis: Tag zentrale-v$LV lokal angelegt, Push fehlgeschlagen"
}

# Gemeinsame Nacharbeiten auf der NAS (nach Deploy und nach --zurueck): Rechte, Konfiguration, Token
NACHARBEIT='
	[ -f .env ] || cp .env.example .env
	mkdir -p config
	[ -f users.yaml ] && [ ! -f config/users.yaml ] && mv users.yaml config/users.yaml
	rm -f users.yaml
	[ -f config/users.yaml ] || cp users.example.yaml config/users.yaml
	# /volume1/docker vererbt per Default-ACL 777 – hier zurücknehmen. Caddy (UID 10020) liest site/, lib/, Caddyfile über other=r.
	find . -path ./config -prune -o -type d -exec chmod 755 {} +
	find . -path ./config -prune -o -type f -exec chmod 644 {} +
	chmod 755 scripts/*.sh
	chmod 600 .env
	# config/: savesvc (UID 10022) schreibt users.yaml (Admin-Panel), der Upload-Dienst (10021) liest, Sebi darf alles.
	# Caddy (10020) darf nur hindurch (x), um config/notaus.json zu sehen (Not-Aus, 1.4.0, Nachtest 08.11.) – lesen kann er dort nichts
	chmod 770 config
	setfacl -m u:10022:rwx,u:10021:rx,u:10020:x -d -m u:1000:rw,u:10022:rw,u:10021:r config
	if [ -O config/users.yaml ]; then chmod 660 config/users.yaml && setfacl -m u:10022:rw,u:10021:r config/users.yaml; fi
	grep -q "^INTERN_TOKEN=" .env || printf "INTERN_TOKEN=%s\n" $(head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | cut -c1-40) >> .env
'

# Vor jeder Änderung: laufenden Stand archivieren und Datenbank sichern ($ANLASS steht im Dateinamen der Sicherung)
VORHER='
	mkdir -p '"$RELEASES"'
	ALT=$(sed -n "s/.*\"version\": *\"\([^\"]*\)\".*/\1/p" '"$ZIEL"'/site/zentrale.json 2>/dev/null || true)
	[ -n "$ALT" ] || ALT="vor-versionierung"
	if [ -d '"$ZIEL"'/site ]; then
		tar -cf '"$RELEASES"'/$ALT.tar -C '"$ZIEL"' --exclude=./.env --exclude=./config .
		echo "  laufender Stand $ALT archiviert"
		ls -1t '"$RELEASES"'/*.tar | tail -n +6 | while IFS= read -r a; do rm -f "$a"; echo "  altes Archiv entfernt: $a"; done
	fi
	if docker inspect -f "{{.State.Running}}" spielebibliothek-savesvc 2>/dev/null | grep -q true; then
		docker exec spielebibliothek-savesvc sh -c "mkdir -p /data/backup/vor-deploy && python -m savesvc backup /data/backup/vor-deploy/$ANLASS-\$(date +%Y%m%d-%H%M%S).db >/dev/null && ls -1t /data/backup/vor-deploy/*.db | tail -n +11 | xargs -r rm -f"
		echo "  Datenbank gesichert (data/backup/vor-deploy/)"
	else
		echo "  Hinweis: Speicher-Dienst läuft nicht – keine Datenbank-Sicherung vor dem Deploy"
	fi
'

STARTBEFEHL="cd $ZIEL && docker compose up -d --build --remove-orphans && docker compose restart caddy && docker compose ps"

# ---------- Zurück auf eine frühere Version ----------
if [ -n "$ZURUECK" ]; then
	# Not-Aus (1.4.0): das Zurückspringen startet alle Container neu, auch den Tunnel
	if ssh -o LogLevel=ERROR "$NAS" "test -f $ZIEL/config/notaus.json"; then echo "Not-Aus ist aktiv – erst scripts/deploy.sh --notaus-aus" >&2; exit 3; fi
	echo "→ Zentrale zurück auf $ZURUECK"
	ssh "$NAS" "
		set -e
		[ -f $RELEASES/$ZURUECK.tar ] || { echo 'Version $ZURUECK ist nicht archiviert. Vorhanden:'; ls -1t $RELEASES | sed 's/\.tar\$//'; exit 1; }
		cp $RELEASES/$ZURUECK.tar /tmp/sb-zurueck.tar
		ANLASS=vor-zurueck-$ZURUECK
		$VORHER
		cd $ZIEL
		tar -tf /tmp/sb-zurueck.tar | sed 's|^\./||' | grep -v '/\$' > .deploy-liste
		printf '%s\n' .env config/users.yaml >> .deploy-liste
		tar --no-same-owner -m -xf /tmp/sb-zurueck.tar   # -m: Zeitstempel = jetzt, siehe nas-deploy.sh
		find . -type f ! -name .deploy-liste ! -path './config/*' ! -name .env | sed 's|^\./||' | grep -vxF -f .deploy-liste | while IFS= read -r f; do
			echo \"  entfernt: \$f\"; rm -f -- \"\$f\"
		done
		find . -mindepth 1 -type d -empty -delete
		rm -f .deploy-liste /tmp/sb-zurueck.tar
		$NACHARBEIT
	"
	if [ "$STARTEN" = 1 ]; then ssh "$NAS" "$STARTBEFEHL"; fi
	echo "✓ Zentrale läuft wieder mit Version $ZURUECK. Datenbank-Sicherung von vorher: data/backup/vor-deploy/vor-zurueck-$ZURUECK-*.db"
	exit 0
fi

# ---------- Neue Version deployen ----------
VERSION_ZENTRALE="$(tr -d ' \n' < VERSION)"
echo "$VERSION_ZENTRALE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "VERSION muss MAJOR.MINOR.PATCH sein, ist: $VERSION_ZENTRALE" >&2; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
	echo "✗ Es gibt nicht committete Änderungen – erst committen, dann deployen (deployt wird immer ein Commit):" >&2
	git status --short >&2; exit 1
fi
grep -q "^## $VERSION_ZENTRALE" CHANGELOG.md || { echo "✗ CHANGELOG.md hat keinen Abschnitt „## ${VERSION_ZENTRALE}“." >&2; exit 1; }
TAG="zentrale-v$VERSION_ZENTRALE"
COMMIT="$(git rev-parse --short HEAD)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	if [ "$(git rev-parse --short "$TAG^{commit}")" != "$COMMIT" ]; then
		echo "✗ Version $VERSION_ZENTRALE wurde schon für einen anderen Commit deployt. VERSION erhöhen und CHANGELOG.md ergänzen." >&2
		exit 1
	fi
	echo "  (Version $VERSION_ZENTRALE, Commit $COMMIT wird erneut deployt)"
fi

tag_nachholen
# Schon live (z. B. vom Auftragsdienst nach der Freigabe)? Dann nichts mehr zu tun.
if [ "$PROBE" = 0 ]; then
	if [ "$(ssh -o LogLevel=ERROR "$NAS" "sed -n 's/.*\"commit\": *\"\([^\"]*\)\".*/\1/p' $ZIEL/site/zentrale.json 2>/dev/null" || true)" = "$COMMIT" ]; then
		echo "✓ Zentrale $VERSION_ZENTRALE (Commit $COMMIT) ist bereits live."
		exit 0
	fi
fi

# Live nur mit Freigabe aus der Probe (früh prüfen, damit niemand umsonst auf Tests wartet)
if [ "$PROBE" = 0 ] && [ "$OHNE_PROBE" = 0 ]; then
	FREIGABE=$(ssh "$NAS" "cat $PROBE_DIR/data/freigabe.json 2>/dev/null" || true)
	FC=$(printf '%s' "$FREIGABE" | sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p')
	if [ "$FC" != "$COMMIT" ]; then
		echo "✗ Commit $COMMIT ist nicht in der Probe-Zentrale freigegeben (freigegeben: ${FC:-nichts})." >&2
		echo "  1. scripts/deploy.sh --probe   2. $PROBE_URL testen   3. dort Admin-Panel → „Für Live freigeben“   4. scripts/deploy.sh" >&2
		echo "  Notfall ohne Probe: scripts/deploy.sh --ohne-probe" >&2
		exit 1
	fi
	echo "  ✓ in der Probe freigegeben: $(printf '%s' "$FREIGABE" | sed -n 's/.*"zeit": *"\([^"]*\)".*/\1/p')"
fi

if [ "$TESTS" = 1 ]; then
	# Seit 08.11.2026 auf dem Mac (ca. 10 s statt 8 Min. auf der NAS) – mit Python 3.12 wie in Produktion, über uv.
	# Die NAS-Runde im Container läuft weiter über den Auftragsdienst (Zeitplan im Admin-Panel, nach jedem Probe-Bau).
	if command -v uv >/dev/null 2>&1; then
		echo "→ Unit-Tests auf dem Mac (Python 3.12) …"
		if [ ! -x .venv/bin/python ] || ! .venv/bin/python -c 'import sys; sys.exit(sys.version_info[:2] != (3, 12))' 2>/dev/null; then
			uv venv -q --python 3.12 .venv
		fi
		uv pip install -q --python .venv/bin/python -r savesvc/requirements-dev.txt
		if ! (cd savesvc && ../.venv/bin/python -m pytest -q -p no:cacheprovider -W ignore::DeprecationWarning tests > /tmp/sb-deploy-test.log 2>&1); then
			tail -15 /tmp/sb-deploy-test.log >&2
			echo "✗ Tests fehlgeschlagen – nichts deployt. Log: /tmp/sb-deploy-test.log" >&2
			exit 1
		fi
		echo "  ✓ $(tail -1 /tmp/sb-deploy-test.log | tr -d '=')"
	else
		echo "→ Tests auf der NAS (uv fehlt auf dem Mac – dauert ca. 8 Minuten) …"
		if ! git ls-files savesvc | tar --no-mac-metadata --no-xattrs -cf - -T - | ssh "$NAS" "
			rm -rf /tmp/sb-deploy-test && mkdir -p /tmp/sb-deploy-test && tar -xf - -C /tmp/sb-deploy-test && cd /tmp/sb-deploy-test/savesvc &&
			docker build -q --target test -t savesvc-deploytest . >/dev/null && docker run --rm savesvc-deploytest > /tmp/sb-deploy-test.log 2>&1;
			r=\$?; tail -1 /tmp/sb-deploy-test.log; docker rmi savesvc-deploytest >/dev/null 2>&1; rm -rf /tmp/sb-deploy-test; exit \$r"; then
			echo "✗ Tests fehlgeschlagen – nichts deployt. Log auf der NAS: /tmp/sb-deploy-test.log" >&2
			exit 1
		fi
	fi
fi

if [ "$GRUENDLICH" = 1 ]; then
	echo "→ Ende-zu-Ende-Tests im Teststand (ca. 3 Min. auf dem Mac mit Docker Desktop, sonst ca. 6–8 Min. auf der NAS) …"
	sh scripts/e2e-alle.sh || { echo "✗ Ende-zu-Ende-Tests fehlgeschlagen – nichts deployt." >&2; exit 1; }
fi

# ---------- Probe-Zentrale aufsetzen ----------
if [ "$PROBE" = 1 ]; then
	echo "→ Probe-Zentrale $VERSION_ZENTRALE (Commit $COMMIT) mit ${BEHALTEN:+bisherigen Daten}${BEHALTEN:-frischer Kopie der echten Daten}"
	git ls-files | grep -vx -e '.env' -e 'config/users.yaml' | tar --no-mac-metadata --no-xattrs -cf - -T - | ssh "$NAS" "
		set -e
		cat > /tmp/sb-probe.tar
		rm -rf /tmp/sb-probe-repo && mkdir -p /tmp/sb-probe-repo && tar -xf /tmp/sb-probe.tar -C /tmp/sb-probe-repo
		ART=probe ZENTRALE_COMMIT=$COMMIT ZENTRALE_VERSION=$VERSION_ZENTRALE sh /tmp/sb-probe-repo/scripts/teststand.sh up /tmp/sb-probe-repo $BEHALTEN
		# unveränderter Stand für den Live-Deploy nach der Freigabe (die Probe selbst läuft mit ersetzten Hostnamen)
		mv /tmp/sb-probe.tar $PROBE_DIR/release.tar && chmod 644 $PROBE_DIR/release.tar
		printf '{\"version\": \"%s\", \"commit\": \"%s\"}\n' '$VERSION_ZENTRALE' '$COMMIT' > $PROBE_DIR/release.json
		rm -rf /tmp/sb-probe-repo"
	echo "✓ Probe läuft: $PROBE_URL  (zugleich Testserver; Anmeldung per E-Mail-Code über die Access-Anwendung „Spielebibliothek Test“, Upload: https://test-upload.cuby0401.uk mit deinem normalen Upload-Passwort)"
	echo "  Tester-Panel: $PROBE_URL/tester/  (Testplan: tests/manuell/$VERSION_ZENTRALE.json)"
	# Tester (1.4.0): Glocke auf der Live-Seite für alle mit der Rolle Tester – erst ab 1.4.0 live möglich, vorher still übersprungen
	if [ -f "tests/manuell/$VERSION_ZENTRALE.json" ]; then
		ANZAHL=$(grep -c '"id":' "tests/manuell/$VERSION_ZENTRALE.json" || true)
		ssh -o LogLevel=ERROR "$NAS" "docker exec spielebibliothek-savesvc python -m savesvc tester-melden $VERSION_ZENTRALE $ANZAHL 2>/dev/null" | sed 's/^/  /' || true
	fi
	# Ende-zu-Ende-Tests NICHT abwarten (08.11.2026): Der Testserver ist sofort da, die Tests laufen parallel im Teststand
	# auf der NAS (Auftragsdienst, Ziel „probe“ = genau dieser Stand). Ergebnis: Admin-Panel → Aufgaben, rot = rote Glocke.
	# Seit 1.4.1 (NAS entlasten): Läuft Docker Desktop auf dem Mac, laufen sie dort (ca. 3 Min.) und die NAS rechnet nichts.
	if [ "$TESTS" = 1 ] && docker info >/dev/null 2>&1; then
		# eigene Sitzung: läuft weiter, auch wenn das Terminal bzw. die aufrufende Shell endet (nohup allein reicht nicht)
		python3 -I -c 'import subprocess; subprocess.Popen(["sh", "scripts/e2e-mac-hintergrund.sh"], start_new_session=True,
    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)'
		echo "  Ende-zu-Ende-Tests laufen jetzt im Hintergrund auf dem Mac (ca. 3 Min., Log ~/Library/Logs/spielebibliothek-e2e.log) – Ergebnis: Admin-Panel → Aufgaben, bei Rot eine rote Glocke"
	elif [ "$TESTS" = 1 ]; then
		AID=$(ssh -o LogLevel=ERROR "$NAS" "docker exec spielebibliothek-savesvc python -c 'from pathlib import Path; from savesvc.db import Datenbank; print(Datenbank(Path(\"/data/saves.db\")).auftrag_anlegen(\"e2e-tests\", \"probe\", \"deploy\", \"mac\"))'" 2>/dev/null || true)
		case "$AID" in
			''|None) echo "  (Ende-zu-Ende-Tests nicht angestoßen – läuft schon einer? Sonst im Admin-Panel → Aufgaben starten)" ;;
			*) echo "  Ende-zu-Ende-Tests laufen jetzt im Hintergrund auf der NAS (Auftrag $AID, ca. 10 Min.) – Ergebnis: Admin-Panel → Aufgaben, bei Rot eine rote Glocke" ;;
		esac
	fi
	echo "  Testen, dann dort Admin-Panel → „Für Live freigeben“ – der Auftragsdienst spielt dann innerhalb einer Minute live ein."
	echo "  (Ohne eingerichteten Auftragsdienst danach: scripts/deploy.sh)"
	exit 0
fi

LISTE=$(git ls-files | grep -vx -e '.env' -e 'config/users.yaml')

echo "→ Zentrale $VERSION_ZENTRALE (Commit $COMMIT) nach $NAS:$ZIEL"
# Seit 1.3.0: gleicher Ablauf wie der Auftragsdienst – Release-Tar übertragen, scripts/nas-deploy.sh daraus ausführen
# shellcheck disable=SC2086
tar --no-mac-metadata --no-xattrs -cf - $LISTE | ssh "$NAS" "cat > /tmp/sb-release.tar"
ssh "$NAS" "
	set -e
	tar -xOf /tmp/sb-release.tar scripts/nas-deploy.sh > /tmp/sb-nas-deploy.sh
	STARTEN=$STARTEN sh /tmp/sb-nas-deploy.sh /tmp/sb-release.tar '$VERSION_ZENTRALE' '$COMMIT'
	rm -f /tmp/sb-release.tar /tmp/sb-nas-deploy.sh
"
ZEIT="$(date -u +%Y-%m-%dT%H:%M:%S+00:00)"

if [ "$BEISPIELE" = 1 ]; then
	for d in examples/*/; do
		name=$(basename "$d")
		echo "→ Testspiel $name nach $SPIELE/$name"
		tar --no-mac-metadata --no-xattrs -C "$d" -cf - . | ssh "$NAS" "
			set -e
			rm -rf '$SPIELE/$name' && mkdir -p '$SPIELE/$name'
			tar --no-same-owner -xf - -C '$SPIELE/$name'
			chmod -R ug+rwX,o= '$SPIELE/$name'
		"
	done
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	git tag -a "$TAG" -m "Zentrale $VERSION_ZENTRALE deployt $ZEIT"
	git push -q origin "$TAG" || echo "Hinweis: Tag $TAG lokal angelegt, Push fehlgeschlagen – später: git push origin $TAG"
fi
echo "✓ Zentrale $VERSION_ZENTRALE läuft. Bei Problemen: scripts/deploy.sh --zurueck <version>  (welche es gibt: scripts/deploy.sh --versionen)"
