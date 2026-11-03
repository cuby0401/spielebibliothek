#!/bin/sh
# Schiebt den Stack vom Mac per rsync auf die NAS und startet ihn neu.
#
#   scripts/deploy.sh             Stack-Dateien übertragen + docker compose up -d
#   scripts/deploy.sh --examples  zusätzlich examples/* nach /volume1/games/spiele/seb/ kopieren
#
# .env wird nie übertragen und nie überschrieben – sie wird auf der NAS gepflegt.

set -eu

NAS="${NAS:-$NAS}"
ZIEL=/volume1/docker/spielebibliothek
SPIELE=/volume1/games/spiele/seb

cd "$(dirname "$0")/.."

rsync -rlt --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
	--exclude .env --exclude .git --exclude .DS_Store \
	--exclude examples --exclude savesvc/.venv --exclude '__pycache__' \
	./ "$NAS:$ZIEL/"

if [ "${1:-}" = "--examples" ]; then
	for d in examples/*/; do
		name=$(basename "$d")
		# Gruppenbits offen lassen, damit die ACL-Maske filebrowser (rwX) nicht beschneidet
		rsync -rlt --delete --chmod=D770,F660 --exclude .DS_Store "$d" "$NAS:$SPIELE/$name/"
	done
fi

ssh "$NAS" "cd $ZIEL && { [ -f .env ] || cp .env.example .env; } && docker compose up -d --remove-orphans && docker compose ps"
