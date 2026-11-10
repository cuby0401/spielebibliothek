#!/bin/sh
# Zwei Arten von Test-Zentralen auf der NAS – beide mit der ECHTEN Caddyfile (Hostnamen ersetzt), nie in Produktion verwenden:
#
#   Teststand      leere Daten, für die automatischen Ende-zu-Ende-Tests (scripts/e2e-alle.sh)
#                  sh teststand.sh up <repo-dir> | down
#                  games → http://$GH:18088  play → http://$PH:18089  upload → http://$UH:18090
#
#   Probe-Zentrale KOPIE der echten Spiele, Spielstände, Konten und Upload-Passwörter – zum Ausprobieren vor dem Live-Gang (E56)
#                  ART=probe sh teststand.sh up <repo-dir> [--daten-behalten] | down
#                  Seit 1.4.0 zugleich der öffentliche TESTSERVER für die Tester (E76): nur über den Tunnel unter
#                  https://test.cuby0401.uk (play: test-play, upload: test-upload), geschützt durch die Access-Anwendung
#                  „Spielebibliothek Test“ – mit echter Anmeldung, OHNE DEV_USER. Die Ports hängen nur an der LAN-Adresse der
#                  NAS (dort holt sie der Tunnel ab); ohne gültiges Access-Token lehnt der Speicher-Dienst jede Anfrage ab.
#                  Änderungen dort bleiben dort. „Für Live freigeben“ im Admin-Panel der Probe schreibt data/freigabe.json,
#                  die scripts/deploy.sh vor jedem Live-Deploy prüft.
#
# LOKAL=1 (1.4.1, NAS entlasten): Teststand in Docker Desktop auf dem Mac statt auf der NAS. Ports nur an 127.0.0.1,
#                  Hostnamen 127.0.0.1 / localhost / upload.localhost (Chrome löst *.localhost selbst auf).
#
#   Design-Spielwiese (10.11.2026, neue UI): KOPIE der echten Daten wie die Probe, aber NUR über Tailscale erreichbar
#                  ART=design sh teststand.sh up <repo-dir> [--daten-behalten] | down     (sonst: scripts/deploy.sh --design)
#                  games → http://<NAS_GH>:18288  play → http://<NAS_PH>:18289  upload → http://<NAS_UH>:18290
#                  Automatisch als seb angemeldet (DEV_USER). Deshalb: NIE eine Cloudflare-Route auf 18288–18290 legen
#                  (Lehre vom 07.11.2026). Kein Wächter, kein Home Assistant, kein SMTP, kein Backup, kein Cloudflare-Abgleich.
#
# Im Teststand ist man automatisch als seb angemeldet (DEV_USER) – Cloudflare Access gibt es dort nicht.
# In der Probe nicht mehr (07.11.2026): Nach dem Anlegen der Tunnel-Routen war sie kurz ohne Anmeldung als „seb“ im Internet.
set -eu
ART=${ART:-test}
GH=${GH:-<NAS_GH>}
PH=${PH:-<NAS_PH>}
UH=${UH:-<NAS_UH>}
if [ "$ART" = probe ]; then
	N=sbprobe; T=/volume1/docker/spielebibliothek-probe; PG=18188; PP=18189; PU=18190
	GH=test.cuby0401.uk; PH=test-play.cuby0401.uk; UH=test-upload.cuby0401.uk
	G="https://$GH"; P="https://$PH"; U="https://$UH"
	LAN=${LAN:-192.168.178.100}   # nur hier lauschen – der Tunnel holt die Anfragen dort ab, Tailscale kommt nicht ran
	ANMELDUNG="-e ACCESS_TEAM_DOMAIN=cold-glitter-fc3b.cloudflareaccess.com -e ACCESS_AUD=04f54bd3a75c2ac0db275f6996c5761d9738b172bd57bdd64befcd99ed4db240"
	COOKIE_SECURE=1
	PORTS="-p $LAN:$PG:8080 -p $LAN:$PP:8080 -p $LAN:$PU:8080"
	TESTERGEBNISSE=/volume1/docker/spielebibliothek-tests   # bleibt über Neubauten der Probe erhalten
	NEUSTART="--restart unless-stopped"   # 1.5.0: nach einem NAS-Neustart (z. B. Update am 09.11.2026) von selbst wieder da
elif [ "$ART" = design ]; then
	N=sbdesign; T=/volume1/docker/spielebibliothek-design; PG=18288; PP=18289; PU=18290
	G="http://$GH:$PG"; P="http://$PH:$PP"; U="http://$UH:$PU"
	TS=${TS:-<NAS_PH>}   # nur an der Tailscale-Adresse lauschen – nicht im LAN, nie über den Tunnel
	ANMELDUNG="-e DEV_USER=seb -e DEV_ALLOW=1"
	COOKIE_SECURE=0
	PORTS="-p $TS:$PG:8080 -p $TS:$PP:8080 -p $TS:$PU:8080"
	TESTERGEBNISSE=$T/tests
	NEUSTART="--restart unless-stopped"
else
	N=sbtest; T=/tmp/sb-teststand; PG=18088; PP=18089; PU=18090
	G="http://$GH:$PG"; P="http://$PH:$PP"; U="http://$UH:$PU"
	ANMELDUNG="-e DEV_USER=seb -e DEV_ALLOW=1"
	NEUSTART=""                            # Teststand für die automatischen Tests: nur kurz, nicht neu starten
	COOKIE_SECURE=0
	PORTS="-p $PG:8080 -p $PP:8080 -p $PU:8080"
	[ "${LOKAL:-0}" = 1 ] && PORTS="-p 127.0.0.1:$PG:8080 -p 127.0.0.1:$PP:8080 -p 127.0.0.1:$PU:8080"
	TESTERGEBNISSE=$T/tests
fi
LIVE=/volume1/games
BEHALTEN=0; [ "${3:-}" = "--daten-behalten" ] && BEHALTEN=1

entfernen() {
	docker rm -f $N-caddy $N-savesvc $N-upload >/dev/null 2>&1 || true
	docker network rm $N >/dev/null 2>&1 || true
}

# site/ für diese Instanz umschreiben: Cache-Kennung, Version fürs Admin-Panel, Hostnamen. $1 = site-Ordner, $2 = Repo (VERSION, CHANGELOG)
site_umschreiben() {
	# Neue Kennung je Bau, sonst mischt der Browser alte und neue Skripte (10.11.2026: Safari nahm eine alte konto.js zur
	# neuen admin.js → „Can't find variable: anzeige“). Live setzt nas-deploy.sh die Kennung genauso.
	CACHE="${ZENTRALE_COMMIT:-test}-$(date +%s)"
	find "$1" -name '*.html' -exec sh -c 'if sed --version >/dev/null 2>&1; then sed -i "$0" "$@"; else sed -i "" "$0" "$@"; fi' "s/__VERSION__/$CACHE/g" {} +
	# Version und Änderungsprotokoll fürs Admin-Panel wie live (sonst „Version unbekannt“, 10.11.2026)
	printf '{"version": "%s", "commit": "%s", "zeit": "%s"}\n' "${ZENTRALE_VERSION:-$(cat "$2/VERSION" 2>/dev/null)}" "${ZENTRALE_COMMIT:-test}" \
		"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)" > "$1/zentrale.json"
	cp "$2/CHANGELOG.md" "$1/admin/CHANGELOG.md" 2>/dev/null || true
	find "$1" -type f \( -name '*.js' -o -name '*.html' \) \
		-exec sh -c 'if sed --version >/dev/null 2>&1; then sed -i "$0" "$@"; else sed -i "" "$0" "$@"; fi' "s#https://games.cuby0401.uk#$G#g; s#https://play.cuby0401.uk#$P#g; s#https://upload.cuby0401.uk#$U#g" {} +
}

case "$1" in
site)
	# Nur site/ erneuern, ohne Neustart (schnelle Design-Runden, deploy.sh --design --nur-site). $2 = Repo mit neuem site/.
	# An Ort und Stelle kopieren: Caddy hängt per Bind-Mount an $T/repo/site – ein mv auf einen neuen Ordner sähe er nicht.
	[ -d "$T/repo/site" ] || { echo "$ART läuft nicht – erst up"; exit 1; }
	rm -rf "$T/site.neu"; cp -r "$2/site" "$T/site.neu"
	site_umschreiben "$T/site.neu" "$2"
	cp -r "$T/site.neu"/. "$T/repo/site/"
	(cd "$T/repo/site" && find . -type f | while read -r f; do [ -e "$T/site.neu/$f" ] || rm -f "$f"; done)
	chmod -R a+rX "$T/repo/site"; rm -rf "$T/site.neu"
	echo "$ART: site/ erneuert";;
down)
	entfernen
	# Dateien der Container (UID 10021/10022) darf Sebi nicht löschen – über einen Container aufräumen
	[ -d "$T" ] && docker run --rm -v "$(dirname "$T")":/t caddy:2 rm -rf "/t/$(basename "$T")"
	rm -rf "$T" 2>/dev/null || true; echo "$ART entfernt";;
up)
	entfernen
	if [ "$BEHALTEN" = 1 ] && [ -d "$T/data" ]; then
		echo "  Daten der Probe bleiben (--daten-behalten)"
		docker run --rm -v "$(dirname "$T")":/t caddy:2 rm -rf "/t/$(basename "$T")/repo"
	else
		[ -d "$T" ] && docker run --rm -v "$(dirname "$T")":/t caddy:2 rm -rf "/t/$(basename "$T")"
		mkdir -p "$T/data" "$T/udata" "$T/config" "$T/spiele/seb"
		if [ "$ART" = probe ] || [ "$ART" = design ]; then
			# frische Kopie der echten Daten: konsistente DB-Kopie aus dem laufenden Dienst, dazu Spiele, Konten, Upload-Passwörter
			docker exec spielebibliothek-savesvc python -m savesvc backup /data/backup/probe-kopie.db >/dev/null
			docker run --rm -v $LIVE:/quelle:ro -v /volume1/docker/spielebibliothek/config:/konf:ro -v "$T":/ziel caddy:2 sh -c '
				cp -a /quelle/spiele/. /ziel/spiele/ && cp /quelle/data/backup/probe-kopie.db /ziel/data/saves.db &&
				cp /quelle/filebrowser/upload/upload.db /quelle/filebrowser/upload/geheimnis /ziel/udata/ && cp /konf/users.yaml /ziel/config/users.yaml'
			docker exec spielebibliothek-savesvc rm -f /data/backup/probe-kopie.db
			date -u +%Y-%m-%dT%H:%M:%S+00:00 > "$T/data/kopie-von" 2>/dev/null || docker run --rm -v "$T":/z caddy:2 sh -c "date -u +%Y-%m-%dT%H:%M:%S+00:00 > /z/data/kopie-von"
			echo "  Kopie der echten Daten angelegt"
		else
			printf 'seb@example.com: seb\npaul@example.com: paul\n' > "$T/config/users.yaml"
			mkdir -p "$T/spiele/paul"   # vor dem Start: Wer bei der Übernahme ins CRM einen Ordner hat, wird Entwickler (wie live)
		fi
		docker run --rm -v "$T":/z caddy:2 sh -c 'chmod -R a+rwX /z/data /z/udata /z/config /z/spiele'
		setfacl -R -m u:10020:rX,u:10022:rX,u:10021:rwX "$T/spiele" 2>/dev/null || true
		setfacl -R -d -m u:10020:rX,u:10022:rX,u:10021:rwX "$T/spiele" 2>/dev/null || true
	fi
	cp -r "$2"/. "$T/repo"
	site_umschreiben "$T/repo/site" "$T/repo"
	find "$T/repo/lib" "$T/repo/examples" -type f \( -name '*.js' -o -name '*.html' \) \
		-exec sh -c 'if sed --version >/dev/null 2>&1; then sed -i "$0" "$@"; else sed -i "" "$0" "$@"; fi' "s#https://games.cuby0401.uk#$G#g; s#https://play.cuby0401.uk#$P#g; s#https://upload.cuby0401.uk#$U#g" {} +
	sed -e "s#https://games.cuby0401.uk#$G#g" -e "s#https://play.cuby0401.uk#$P#g" -e "s#https://upload.cuby0401.uk#$U#g" \
		-e "s#\([^-]\)play\.cuby0401\.uk#\1$PH#g" -e "s#\([^-]\)upload\.cuby0401\.uk#\1$UH#g" \
		-e "s#savesvc:8000#$N-savesvc:8000#" -e "s#upload:8000#$N-upload:8000#" "$T/repo/Caddyfile" > "$T/Caddyfile"
	# Zeilen mit „# NUR-LIVE“ (z. B. die Sperre der Testseite /ui-test/) gelten nur live und auf dem Testserver
	if [ "$ART" != probe ]; then grep -v '# NUR-LIVE' "$T/Caddyfile" > "$T/Caddyfile.neu" && mv "$T/Caddyfile.neu" "$T/Caddyfile"; fi
	if [ "$ART" = test ]; then for d in "$T/repo/examples"/*/; do cp -r "$d" "$T/spiele/seb/$(basename "$d")"; done; fi
	chmod -R a+rX "$T/repo" "$T/Caddyfile"
	docker run --rm -v "$T":/z caddy:2 sh -c 'chmod -R a+rwX /z/spiele'
	docker network create $N >/dev/null
	docker build -q -t spielebibliothek-savesvc:$N "$T/repo/savesvc" >/dev/null
	mkdir -p "$TESTERGEBNISSE" 2>/dev/null || docker run --rm -v "$(dirname "$TESTERGEBNISSE")":/t caddy:2 mkdir -p "/t/$(basename "$TESTERGEBNISSE")"
	docker run --rm -v "$TESTERGEBNISSE":/z caddy:2 chmod a+rwX /z
	# IDENTITAET_UUID=0 (1.5.0): Teststand ohne Umstellung auf UUID, nur zum Vergleich mit dem alten Verhalten
	docker run -d $NEUSTART --name $N-savesvc --network $N $ANMELDUNG -e WAECHTER=0 -e IDENTITAET_UUID=${IDENTITAET_UUID:-1} \
		-e TESTPLAN_DIR=/testplan -e TESTERGEBNISSE=/tests/ergebnisse.db -v "$T/repo/tests/manuell:/testplan:ro" -v "$TESTERGEBNISSE:/tests" \
		-e ADMINS=seb -e TESTER=emil -e INTERN_TOKEN=test-token -e UPLOAD_URL=http://$N-upload:8000 \
		-e PROBE="$( [ "$ART" = probe ] && echo 1 || echo 0 )" -e DESIGN="$( [ "$ART" = design ] && echo 1 || echo 0 )" -e ZENTRALE_COMMIT="${ZENTRALE_COMMIT:-}" -e ZENTRALE_VERSION="${ZENTRALE_VERSION:-}" \
		-v "$T/data:/data" -v "$T/spiele:/spiele:ro" -v "$T/config:/config" spielebibliothek-savesvc:$N >/dev/null
	docker run -d $NEUSTART --name $N-upload --network $N --user 10021:10021 $ANMELDUNG -e UPLOAD_DATA=/data \
		-e UPLOAD_COOKIE_SECURE=$COOKIE_SECURE -e INTERN_TOKEN=test-token -e SAVESVC_URL=http://$N-savesvc:8000 -v "$T/udata:/data" -v "$T/config:/config:ro" -v "$T/spiele:/spiele" spielebibliothek-savesvc:$N \
		uvicorn savesvc.upload:app_factory --factory --host 0.0.0.0 --port 8000 >/dev/null
	docker run -d $NEUSTART --name $N-caddy --network $N --user 10020:10020 -e XDG_CONFIG_HOME=/tmp -e XDG_DATA_HOME=/tmp \
		$PORTS \
		-v "$T/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$T/repo/site:/srv/site:ro" -v "$T/repo/lib:/srv/lib:ro" -v "$T/spiele:/srv/spiele:ro" -v "$T/config:/config:ro" \
		caddy:2 >/dev/null
	sleep 2; docker logs $N-caddy 2>&1 | grep -iE "error" | grep -v "not formatted" | head -3 || true
	echo "$ART: $G (games)  $P (play)  $U (upload)";;
esac
