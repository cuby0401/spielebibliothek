#!/bin/sh
# Spielt einen Release-Stand LIVE ein – läuft auf der NAS (Zentrale 1.3.0).
# Aufgerufen von scripts/deploy.sh (Mac, über ssh) und vom Auftragsdienst nach der Freigabe in der Probe.
#
#   sh nas-deploy.sh <release.tar> <version> <commit>
#
# <release.tar> = alle von git verfolgten Dateien eines Commits, unverändert (auch examples/).
# Umgebung (nur zum Testen ändern): ZIEL, RELEASES, QUELLE, STARTEN=0 (nicht starten), SICHERN=0 (keine DB-Sicherung)
#
# Ablauf – wie bisher in deploy.sh:
#   1. laufenden Stand archivieren ($RELEASES/<alte Version>.tar, die letzten 5) und Datenbank sichern (vor-deploy/, die letzten 10)
#   2. Dateien einspielen (ohne examples/), was nicht mehr im Release ist, entfernen; .env und config/ bleiben immer
#   3. __VERSION__ ersetzen, site/zentrale.json schreiben, Rechte setzen
#   4. vollständigen Stand (mit examples/) nach $QUELLE legen – daraus testet der Auftragsdienst „Live-Stand“
#   5. Container neu bauen und starten
set -eu
TAR="$1"; VERSION_ZENTRALE="$2"; COMMIT="$3"
ZIEL="${ZIEL:-/volume1/docker/spielebibliothek}"
RELEASES="${RELEASES:-/volume1/docker/spielebibliothek-releases}"
QUELLE="${QUELLE:-/volume1/docker/spielebibliothek-quelle}"
STARTEN="${STARTEN:-1}"
SICHERN="${SICHERN:-1}"
echo "$VERSION_ZENTRALE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Version ungültig: $VERSION_ZENTRALE" >&2; exit 2; }
echo "$COMMIT" | grep -Eq '^[0-9a-f]{7,40}$' || { echo "Commit ungültig: $COMMIT" >&2; exit 2; }
[ -f "$TAR" ] || { echo "Release fehlt: $TAR" >&2; exit 2; }
tar -tf "$TAR" | grep -qx 'VERSION' || { echo "Release ohne VERSION – kein vollständiger Stand" >&2; exit 2; }
[ "$(tar -xOf "$TAR" VERSION | tr -d ' \n')" = "$VERSION_ZENTRALE" ] || { echo "VERSION im Release passt nicht zu $VERSION_ZENTRALE" >&2; exit 2; }
# Not-Aus (1.4.0): ein Deploy würde den Tunnel wieder starten – erst am Mac scripts/deploy.sh --notaus-aus
[ ! -f "$ZIEL/config/notaus.json" ] || { echo "Not-Aus ist aktiv – kein Deploy. Erst: scripts/deploy.sh --notaus-aus" >&2; exit 3; }

# ---------- 1. vorher sichern ----------
mkdir -p "$RELEASES"
ALT=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ZIEL/site/zentrale.json" 2>/dev/null || true)
[ -n "$ALT" ] || ALT="vor-versionierung"
if [ -d "$ZIEL/site" ]; then
	tar -cf "$RELEASES/$ALT.tar" -C "$ZIEL" --exclude=./.env --exclude=./config .
	echo "  laufender Stand $ALT archiviert"
	ls -1t "$RELEASES"/*.tar | tail -n +6 | while IFS= read -r a; do rm -f "$a"; echo "  altes Archiv entfernt: $a"; done
fi
if [ "$SICHERN" = 1 ] && docker inspect -f "{{.State.Running}}" spielebibliothek-savesvc 2>/dev/null | grep -q true; then
	# nur im Container – die Datenbank nie vom Host aus öffnen (06.11.2026)
	docker exec spielebibliothek-savesvc sh -c "mkdir -p /data/backup/vor-deploy && python -m savesvc backup /data/backup/vor-deploy/vor-$VERSION_ZENTRALE-\$(date +%Y%m%d-%H%M%S).db >/dev/null && ls -1t /data/backup/vor-deploy/*.db | tail -n +11 | xargs -r rm -f"
	echo "  Datenbank gesichert (data/backup/vor-deploy/)"
elif [ "$SICHERN" = 1 ]; then
	echo "  Hinweis: Speicher-Dienst läuft nicht – keine Datenbank-Sicherung vor dem Deploy"
fi

# ---------- 2. einspielen ----------
mkdir -p "$ZIEL" && cd "$ZIEL"
tar -tf "$TAR" | sed 's|^\./||' | grep -v '/$' | grep -v '^examples/' | grep -vx -e '.env' -e 'config/users.yaml' > /tmp/sb-deploy-liste.$$
# -m: Dateien bekommen die Uhrzeit des Einspielens. Sonst trägt z. B. eine wieder eingespielte ältere Version ein
# älteres Datum als die zuletzt ausgelieferte, Browser fragen mit If-Modified-Since nach und behalten per 304 die
# alte index.html, die dann nicht zum neuen app.js passt („Spielen“ tut nichts, 07.11.2026).
tar --no-same-owner -m -xf "$TAR" -T /tmp/sb-deploy-liste.$$
# Was nicht mehr im Release ist, entfernen (nur Dateien; .env, config/ und erzeugte Dateien bleiben)
printf '%s\n' .env config/users.yaml users.yaml site/zentrale.json site/admin/CHANGELOG.md >> /tmp/sb-deploy-liste.$$
find . -type f ! -path './config/*' | sed 's|^\./||' | grep -vxF -f /tmp/sb-deploy-liste.$$ | while IFS= read -r f; do
	echo "  entfernt: $f"; rm -f -- "$f"
done
rm -f /tmp/sb-deploy-liste.$$
find . -mindepth 1 -type d -empty ! -path './config*' -delete

# ---------- 3. Version, Rechte, Konfiguration ----------
CACHE="$COMMIT-$(date +%s)"
ZEIT="$(date -u +%Y-%m-%dT%H:%M:%S+00:00)"
find site -name '*.html' -exec sed -i "s/__VERSION__/$CACHE/g" {} +
printf '{"version": "%s", "commit": "%s", "zeit": "%s"}\n' "$VERSION_ZENTRALE" "$COMMIT" "$ZEIT" > site/zentrale.json
cp CHANGELOG.md site/admin/CHANGELOG.md
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
setfacl -m u:10022:rwx,u:10021:rx -d -m u:1000:rw,u:10022:rw,u:10021:r config 2>/dev/null || true
if [ -O config/users.yaml ]; then chmod 660 config/users.yaml && { setfacl -m u:10022:rw,u:10021:r config/users.yaml 2>/dev/null || true; }; fi
grep -q "^INTERN_TOKEN=" .env || printf "INTERN_TOKEN=%s\n" "$(head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | cut -c1-40)" >> .env

# ---------- 4. vollständiger Stand für die Tests „Live-Stand“ ----------
rm -rf "$QUELLE.neu" && mkdir -p "$QUELLE.neu" && tar --no-same-owner -xf "$TAR" -C "$QUELLE.neu"
printf '{"version": "%s", "commit": "%s", "zeit": "%s"}\n' "$VERSION_ZENTRALE" "$COMMIT" "$ZEIT" > "$QUELLE.neu/release.json"
rm -rf "$QUELLE" && mv "$QUELLE.neu" "$QUELLE"

# ---------- 5. starten ----------
if [ "$STARTEN" = 1 ]; then
	# Caddyfile ist als Einzeldatei eingebunden: tar ersetzt sie, der laufende Container sähe weiter die alte → caddy immer neu starten
	docker compose up -d --build --remove-orphans && docker compose restart caddy && docker compose ps
fi
echo "✓ Zentrale $VERSION_ZENTRALE (Commit $COMMIT) eingespielt"
