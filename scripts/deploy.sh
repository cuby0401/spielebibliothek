#!/bin/sh
# Schiebt den Stack (die „Zentrale“) vom Mac auf die NAS und startet ihn – versioniert (E39).
#
#   scripts/deploy.sh                    neue Version deployen (VERSION + CHANGELOG.md), vorher Tests auf der NAS
#   scripts/deploy.sh --examples         zusätzlich examples/* nach /volume1/games/spiele/seb/ kopieren
#   scripts/deploy.sh --no-start         nur übertragen, nicht starten
#   scripts/deploy.sh --ohne-tests       Tests überspringen (nur im Notfall)
#   scripts/deploy.sh --zurueck 1.1.0    auf eine früher deployte Version zurück (aus dem Release-Archiv)
#   scripts/deploy.sh --versionen        aufgehobene Versionen auf der NAS anzeigen
#
# Schutz vor „Peng, alles kaputt“:
#   1. Nur ein sauberer, committeter Stand wird deployt – mit neuer Nummer in VERSION und Eintrag „## <Version>“ in CHANGELOG.md.
#      Dieselbe Nummer für einen anderen Commit wird abgelehnt (Git-Tag zentrale-v<Version>).
#   2. Vorher laufen alle Unit-Tests auf der NAS (Python 3.12 wie in Produktion). Rot = kein Deploy.
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
ZURUECK=""
while [ $# -gt 0 ]; do
	case "$1" in
		--examples) BEISPIELE=1 ;;
		--no-start) STARTEN=0 ;;
		--ohne-tests) TESTS=0 ;;
		--zurueck) shift; ZURUECK="${1:-}"; [ -n "$ZURUECK" ] || { echo "--zurueck braucht eine Version, z. B. 1.1.0" >&2; exit 2; } ;;
		--versionen) ssh "$NAS" "ls -1t $RELEASES 2>/dev/null | sed 's/\.tar\$//' || echo '(noch keine)'"; exit 0 ;;
		*) echo "Unbekannte Option: $1" >&2; exit 2 ;;
	esac
	shift
done

cd "$(dirname "$0")/.."
export COPYFILE_DISABLE=1 # keine ._-Dateien von macOS

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
	# config/: savesvc (UID 10022) schreibt users.yaml (Admin-Panel), der Upload-Dienst (10021) liest, Sebi darf alles
	chmod 770 config
	setfacl -m u:10022:rwx,u:10021:rx -d -m u:1000:rw,u:10022:rw,u:10021:r config
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
		tar --no-same-owner -xf /tmp/sb-zurueck.tar
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
grep -q "^## $VERSION_ZENTRALE" CHANGELOG.md || { echo "✗ CHANGELOG.md hat keinen Abschnitt „## $VERSION_ZENTRALE“." >&2; exit 1; }
TAG="zentrale-v$VERSION_ZENTRALE"
COMMIT="$(git rev-parse --short HEAD)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	if [ "$(git rev-parse --short "$TAG^{commit}")" != "$COMMIT" ]; then
		echo "✗ Version $VERSION_ZENTRALE wurde schon für einen anderen Commit deployt. VERSION erhöhen und CHANGELOG.md ergänzen." >&2
		exit 1
	fi
	echo "  (Version $VERSION_ZENTRALE, Commit $COMMIT wird erneut deployt)"
fi

if [ "$TESTS" = 1 ]; then
	echo "→ Tests auf der NAS (dauert ca. 2–3 Minuten) …"
	if ! git ls-files savesvc | tar --no-mac-metadata --no-xattrs -cf - -T - | ssh "$NAS" "
		rm -rf /tmp/sb-deploy-test && mkdir -p /tmp/sb-deploy-test && tar -xf - -C /tmp/sb-deploy-test && cd /tmp/sb-deploy-test/savesvc &&
		docker build -q --target test -t savesvc-deploytest . >/dev/null && docker run --rm savesvc-deploytest > /tmp/sb-deploy-test.log 2>&1;
		r=\$?; tail -1 /tmp/sb-deploy-test.log; docker rmi savesvc-deploytest >/dev/null 2>&1; rm -rf /tmp/sb-deploy-test; exit \$r"; then
		echo "✗ Tests fehlgeschlagen – nichts deployt. Log auf der NAS: /tmp/sb-deploy-test.log" >&2
		exit 1
	fi
fi

# Versionskennung gegen Browser-/CDN-Cache: Commit plus Zeitstempel, ersetzt __VERSION__ in site/**/*.html
CACHE="$COMMIT-$(date +%s)"
ZEIT="$(date -u +%Y-%m-%dT%H:%M:%S+00:00)"
LISTE=$(git ls-files | grep -v '^examples/' | grep -vx -e '.env' -e 'config/users.yaml')

echo "→ Zentrale $VERSION_ZENTRALE (Commit $COMMIT) nach $NAS:$ZIEL"
# shellcheck disable=SC2086
tar --no-mac-metadata --no-xattrs -cf - $LISTE | ssh "$NAS" "
	set -e
	ANLASS=vor-$VERSION_ZENTRALE
	$VORHER
	mkdir -p $ZIEL && cd $ZIEL
	tar --no-same-owner -xf -
	# Was nicht mehr im Repo ist, entfernen (nur Dateien, .env und config/users.yaml bleiben)
	printf '%s\n' $(printf '%s ' $LISTE) .env config/users.yaml users.yaml > .deploy-liste
	find . -type f ! -name .deploy-liste | sed 's|^\./||' | grep -vxF -f .deploy-liste | while IFS= read -r f; do
		echo \"  entfernt: \$f\"; rm -f -- \"\$f\"
	done
	find . -mindepth 1 -type d -empty -delete
	rm -f .deploy-liste
	find site -name '*.html' -exec sed -i 's/__VERSION__/$CACHE/g' {} +
	# Version der Zentrale für Fußzeile und Admin-Panel
	printf '{\"version\": \"%s\", \"commit\": \"%s\", \"zeit\": \"%s\"}\n' '$VERSION_ZENTRALE' '$COMMIT' '$ZEIT' > site/zentrale.json
	cp CHANGELOG.md site/admin/CHANGELOG.md
	$NACHARBEIT
"

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

if [ "$STARTEN" = 1 ]; then
	# Caddyfile ist als Einzeldatei eingebunden: tar ersetzt sie, der laufende Container sähe
	# weiter die alte. Deshalb caddy immer neu starten (admin ist aus, also kein reload).
	ssh "$NAS" "$STARTBEFEHL"
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	git tag -a "$TAG" -m "Zentrale $VERSION_ZENTRALE deployt $ZEIT"
	git push -q origin "$TAG" || echo "Hinweis: Tag $TAG lokal angelegt, Push fehlgeschlagen – später: git push origin $TAG"
fi
echo "✓ Zentrale $VERSION_ZENTRALE läuft. Bei Problemen: scripts/deploy.sh --zurueck <version>  (welche es gibt: scripts/deploy.sh --versionen)"
