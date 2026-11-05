#!/bin/sh
# Schiebt den Stack vom Mac auf die NAS und startet ihn.
#
#   scripts/deploy.sh             Stack-Dateien übertragen + docker compose up -d
#   scripts/deploy.sh --examples  zusätzlich examples/* nach /volume1/games/spiele/seb/ kopieren
#   scripts/deploy.sh --no-start  nur übertragen, nicht starten
#
# Übertragen werden alle von git verfolgten Dateien (Stand der Arbeitskopie) außer examples/.
# Dateien, die im Repo gelöscht wurden, werden auf der NAS ebenfalls entfernt.
# .env und users.yaml werden nie übertragen und nie überschrieben – sie werden auf der NAS gepflegt.
#
# Warum tar statt rsync: macOS liefert openrsync, das mit dem rsync der NAS nicht zusammenspielt.

set -eu

NAS="${NAS:-$NAS}"
ZIEL=/volume1/docker/spielebibliothek
SPIELE=/volume1/games/spiele/seb

BEISPIELE=0
STARTEN=1
for arg in "$@"; do
	case "$arg" in
		--examples) BEISPIELE=1 ;;
		--no-start) STARTEN=0 ;;
		*) echo "Unbekannte Option: $arg" >&2; exit 2 ;;
	esac
done

cd "$(dirname "$0")/.."
export COPYFILE_DISABLE=1 # keine ._-Dateien von macOS

LISTE=$(git ls-files | grep -v '^examples/' | grep -vx -e '.env' -e 'users.yaml')

echo "→ Stack nach $NAS:$ZIEL"
# shellcheck disable=SC2086
tar --no-mac-metadata --no-xattrs -cf - $LISTE | ssh "$NAS" "
	set -e
	mkdir -p $ZIEL && cd $ZIEL
	tar --no-same-owner -xf -
	# Was nicht mehr im Repo ist, entfernen (nur Dateien, .env und users.yaml bleiben)
	printf '%s\n' $(printf '%s ' $LISTE) .env users.yaml > .deploy-liste
	find . -type f ! -name .deploy-liste | sed 's|^\./||' | grep -vxF -f .deploy-liste | while IFS= read -r f; do
		echo \"  entfernt: \$f\"; rm -f -- \"\$f\"
	done
	find . -mindepth 1 -type d -empty -delete
	rm -f .deploy-liste
	[ -f .env ] || cp .env.example .env
	[ -f users.yaml ] || cp users.example.yaml users.yaml
	# /volume1/docker vererbt per Default-ACL 777 – hier zurücknehmen.
	# Caddy (UID 10020) liest site/, lib/, Caddyfile über other=r. .env enthält den Tunnel-Token.
	find . -type d -exec chmod 755 {} +
	find . -type f -exec chmod 644 {} +
	chmod 755 scripts/*.sh
	chmod 600 .env
	# users.yaml: savesvc (UID 10022) darf lesen, sonst niemand außer Sebi
	chmod 640 users.yaml && setfacl -m u:10022:r users.yaml
"

if [ "$BEISPIELE" = 1 ]; then
	for d in examples/*/; do
		name=$(basename "$d")
		echo "→ Testspiel $name nach $SPIELE/$name"
		tar --no-mac-metadata --no-xattrs -C "$d" -cf - . | ssh "$NAS" "
			set -e
			rm -rf '$SPIELE/$name' && mkdir -p '$SPIELE/$name'
			tar --no-same-owner -xf - -C '$SPIELE/$name'
			# Gruppenbits offen, damit die ACL-Maske filebrowser (rwX) nicht beschneidet
			chmod -R ug+rwX,o= '$SPIELE/$name'
		"
	done
fi

if [ "$STARTEN" = 1 ]; then
	# Caddyfile ist als Einzeldatei eingebunden: tar ersetzt sie, der laufende Container sähe
	# weiter die alte. Deshalb caddy immer neu starten (admin ist aus, also kein reload).
	ssh "$NAS" "cd $ZIEL && docker compose up -d --build --remove-orphans && docker compose restart caddy && docker compose ps"
fi
