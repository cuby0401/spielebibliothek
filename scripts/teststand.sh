#!/bin/sh
# Teststand fuer Ende-zu-Ende-Tests (Phase 4+). Auf der NAS ausfuehren:
#   tar des Repos nach /tmp/sb-repo, dann: sh scripts/teststand.sh up /tmp/sb-repo  (spaeter: down)
# games → http://<NAS_GH>:18088, play → http://<NAS_PH>:18089, upload → http://<NAS_UH>:18090
# Echte Caddyfile mit ersetzten Hostnamen, savesvc/upload mit DEV_USER=seb, eigene leere Daten. Nie in Produktion verwenden.
# Temporärer Teststand auf der NAS mit der ECHTEN Caddyfile:
#   games → http://$GH:18088   play → http://$PH:18089   savesvc mit DEV_USER, eigene DB
# Aufruf: sh teststand.sh up <repo-dir> | down
set -eu
T=/tmp/sb-teststand
GH=${GH:-<NAS_GH>}
PH=${PH:-<NAS_PH>}
UH=${UH:-<NAS_UH>}
G="http://$GH:18088"; P="http://$PH:18089"; U="http://$UH:18090"
case "$1" in
down)
	docker rm -f sbtest-caddy sbtest-savesvc sbtest-upload >/dev/null 2>&1 || true
	docker network rm sbtest >/dev/null 2>&1 || true
	# Dateien der Container (UID 10021/10022) darf Sebi nicht löschen – über einen Container aufräumen
	[ -d "$T" ] && docker run --rm -v /tmp:/t caddy:2 rm -rf /t/sb-teststand
	rm -rf "$T"; echo "Teststand entfernt";;
up)
	sh "$0" down >/dev/null 2>&1 || true
	mkdir -p "$T/data" "$T/udata" "$T/config" "$T/spiele/seb"; chmod 777 "$T/data" "$T/udata" "$T/config"
	printf 'seb@example.com: seb\npaul@example.com: paul\n' > "$T/config/users.yaml"; chmod 666 "$T/config/users.yaml"
	cp -r "$2"/. "$T/repo"
	find "$T/repo/site" "$T/repo/lib" "$T/repo/examples" -type f \( -name '*.js' -o -name '*.html' \) \
		-exec sed -i "s#https://games.cuby0401.uk#$G#g; s#https://play.cuby0401.uk#$P#g; s#https://upload.cuby0401.uk#$U#g" {} +
	sed -e "s#https://games.cuby0401.uk#$G#g" -e "s#https://play.cuby0401.uk#$P#g" -e "s#https://upload.cuby0401.uk#$U#g" \
		-e "s#play.cuby0401.uk#$PH#g" -e "s#upload.cuby0401.uk#$UH#g" \
		-e "s#savesvc:8000#sbtest-savesvc:8000#" -e "s#upload:8000#sbtest-upload:8000#" "$T/repo/Caddyfile" > "$T/Caddyfile"
	for d in "$T/repo/examples"/*/; do cp -r "$d" "$T/spiele/seb/$(basename "$d")"; done
	chmod -R a+rX "$T"; chmod -R a+rwX "$T/spiele"
	# wie auf der NAS: Default-ACLs, damit Ordner des Upload-Dienstes (770) für Caddy/savesvc lesbar bleiben
	setfacl -R -m u:10020:rX,u:10022:rX,u:10021:rwX "$T/spiele" && setfacl -R -d -m u:10020:rX,u:10022:rX,u:10021:rwX "$T/spiele"
	docker network create sbtest >/dev/null
	docker build -q -t spielebibliothek-savesvc:test "$T/repo/savesvc" >/dev/null
	docker run -d --name sbtest-savesvc --network sbtest -e DEV_USER=seb -e DEV_ALLOW=1 \
		-e ADMINS=seb -e INTERN_TOKEN=test-token -e UPLOAD_URL=http://sbtest-upload:8000 \
		-v "$T/data:/data" -v "$T/spiele:/spiele:ro" -v "$T/config:/config" spielebibliothek-savesvc:test >/dev/null
	docker run -d --name sbtest-upload --network sbtest --user 10021:10021 -e DEV_USER=seb -e DEV_ALLOW=1 -e UPLOAD_DATA=/data \
		-e UPLOAD_COOKIE_SECURE=0 -e INTERN_TOKEN=test-token -v "$T/udata:/data" -v "$T/config:/config:ro" -v "$T/spiele:/spiele" spielebibliothek-savesvc:test \
		uvicorn savesvc.upload:app_factory --factory --host 0.0.0.0 --port 8000 >/dev/null
	docker run -d --name sbtest-caddy --network sbtest --user 10020:10020 -e XDG_CONFIG_HOME=/tmp -e XDG_DATA_HOME=/tmp \
		-p 18088:8080 -p 18089:8080 -p 18090:8080 \
		-v "$T/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$T/repo/site:/srv/site:ro" -v "$T/repo/lib:/srv/lib:ro" -v "$T/spiele:/srv/spiele:ro" \
		caddy:2 >/dev/null
	sleep 2; docker logs sbtest-caddy 2>&1 | grep -iE "error|warn" | grep -v "not formatted" | head -3 || true
	echo "Teststand: $G (games)  $P (play)  $U (upload)";;
esac
