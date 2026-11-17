# Entwicklung – Aufbau, feste Regeln, Tests

Für alle, die an der Bibliothek selbst arbeiten (Seb, Claude-Sitzungen). Die Spezifikation und alle Entscheidungen (E1–E38)
stehen im Vault `seb-brain` unter `Projekte/Spielebibliothek/`. Diese Datei ist die Kurzfassung für den Code.

**Adressen der NAS:** stehen nicht im Repo, sondern in `lokal.env` im Repo-Wurzelordner (in `.gitignore`, Vorlage
`lokal.env.example`): `NAS` (ssh-Ziel) sowie `NAS_GH`, `NAS_PH`, `NAS_UH` (Tailscale-Name, -IP und Kurzname für Teststand
und Design-Spielwiese). Die Skripte lesen sie selbst ein; in dieser Doku stehen sie als `$NAS` bzw. `<NAS_GH>`.

## Dienste

| Dienst | Code | Darf | Erreichbar |
|---|---|---|---|
| caddy | `Caddyfile` | liefert `site/`, `lib/` und Spieldateien aus, leitet `/api/*` weiter | `games`, `play`, `upload` über den Tunnel |
| savesvc (Speicher-Dienst) | `savesvc/savesvc/app.py`, `verwaltung.py`, `intern.py`, `gemeinschaft.py` (Spielzeit, Glocke, Erfolge, Profil, Spiel der Woche), `waechter.py` (Gesundheit, Home Assistant), `multiplayer.py` (Räume, WebSocket, 1.6.0) | Datenbank lesen/schreiben, Spiele **nur lesen** | `/api/*` unter `games`, `/intern/*` nur im Docker-Netz |
| upload (Upload-Dienst) | `savesvc/savesvc/upload.py`, `mcp.py` (MCP-Server für Claude, 1.6.0) | Spieldateien schreiben, Upload-Konten, KI-Zugänge | `/api/upload/*` unter `upload`, `/mcp`, `/oauth/*` und `/.well-known/oauth-*` unter `mcp`, `/intern/*` nur im Docker-Netz |

Die beiden Python-Dienste rufen sich gegenseitig über `/intern/*` mit `INTERN_TOKEN` auf (aus `.env`, legt `deploy.sh` an):
- Speicher-Dienst → Upload-Dienst: Spiele löschen, Upload-Konten, Ereignisse (Admin-Panel)
- Upload-Dienst → Speicher-Dienst: Testergebnisse für die Prüfung, neue Season, Spielstände beim Rollback, Entwurf zurücksetzen

## Ablage

```
/volume1/games/spiele/<benutzer>/
  <ordner>/                     live
    .version.json               Versionsnummer dieser Version (release.py)
  <ordner>~entwurf/             Entwurf (+ .entwurf.json: Zeitpunkt des Uploads)
  <ordner>~v<zeitstempel>/      ältere Versionen (die letzten 5), jede mit eigener .version.json
  .<ordner>.versionen.json      Versionsverlauf + gesammelte Änderungen
/volume1/games/data/saves.db    Spielstände, Verlauf, save_vor_update, Bestenliste, Einstellungen, Anträge, Fehler, Daumen, entwurf_tests
```

## Feste Regeln (nicht brechen)

1. **`~` ist reserviert.** Ordner mit `~` sind nie eigene Spiele (Entwurf, Versionen). Spieler-IDs mit `~` sind simulierte Rollen
   („Ansicht als …“, z. B. `seb~spieler`) und zählen in keiner Statistik (`db.ECHT`).
2. **Versteckte Dateien** (`.…`) liefert Caddy unter `play` nie aus, und ein ZIP kann sie nicht anlegen (`zipinstall`). Deshalb liegen Metadaten
   der Bibliothek als versteckte Dateien neben bzw. in den Spielordnern.
3. **Jeder Upload ist ein Entwurf.** Live geht ein Spiel nur über `POST …/veroeffentlichen` (Update-Fenster). Der Server prüft dort
   noch einmal selbst (`release.pruefen` + Testergebnisse) – dem Browser wird nichts geglaubt.
4. **Versionsnummern vergibt nur die Bibliothek** (`release.naechste`). `version` in der `game.json` wird ignoriert.
5. **`saveVersion` darf nie sinken.** Vor jeder Umwandlung auf eine höhere `saveVersion` wird der alte Stand dauerhaft in `save_vor_update`
   gesichert (`db.speichern`). Darauf baut der Rollback mit „Spielstände zurückholen“ auf.
6. **Spiele bestimmen nie selbst ihre ID.** Die Bridge hängt die ID an das iframe-Fenster, nicht an die Nachricht.
7. **Ändernde Anfragen brauchen `X-Bibliothek: 1`** (bzw. `X-Upload: 1`) gegen CSRF. `/intern/*` ist davon ausgenommen und hat das Token.
8. **Neue Felder in API-Antworten** sind ok, entfernte oder umbenannte brechen die Seiten – dann alle Aufrufer in `site/` anpassen.
9. **Prompt-Block nur in `site/handbuch/prompt.txt` ändern** und danach `scripts/startvorlage.sh` laufen lassen (baut auch die
   Multiplayer-Vorlage aus `examples/vier-gewinnt/`, 1.6.0).
10. **Multiplayer (1.6.0): Auf der NAS läuft kein Code der Entwickler.** Der Dienst bringt nur Raum, Spieler und Nachrichten zusammen,
   die Regeln rechnet der Browser des Hosts (`GameSave.multiplayer.spiel`). Die Verbindung hält die Bibliotheksseite, nicht das Spiel.
11. **MCP (1.6.0): Die KI veröffentlicht nie.** Uploads über MCP landen wie alle anderen als Entwurf (`entwurf_installieren`).

## Tests

```sh
# Unit-Tests (Python 3.12 im Container – lokal läuft 3.14):
git ls-files -co --exclude-standard savesvc | tar -cf - -T - | ssh $NAS \
  'rm -rf /tmp/sb-test && mkdir -p /tmp/sb-test && tar -xf - -C /tmp/sb-test && cd /tmp/sb-test/savesvc &&
   docker build -q --target test -t savesvc-test . && docker run --rm savesvc-test; docker rmi savesvc-test; rm -rf /tmp/sb-test'
```

- Ende-zu-Ende: `scripts/teststand.sh` (eigener Teststand auf der NAS) und headless Chrome über das DevTools-Protokoll.
- Nach jeder Änderung an Caddyfile oder Bridge: Testspiel „Böse“ öffnen – alle Angriffe müssen abgewehrt sein.
- Zwischenspeicher in `lib/bridge.js` (Sitzungsablauf/offline): `node scripts/bridge-test.js lib/bridge.js` (stellt Browser und Server nach).
- Versionierung Ende-zu-Ende (Upload → Entwurf → Update-Fenster → Migration → Rollback): `scripts/e2e-versionierung.mjs`, Anleitung im Dateikopf.
- Zentrale 1.1 (Offline, Update hochladen, Hilfe-Center) und 1.2 (Suche, Glocke, Erfolge, Spiel der Woche, Spielzeit, Profil): `scripts/e2e-zentrale-1.1.mjs`, `scripts/e2e-zentrale-1.2.mjs`, 1.2.1 (Profil, Glocke archivieren, Symbole, Größen): `scripts/e2e-zentrale-1.3.mjs`, 1.3.0 (Beschreibung und Vorschaubild, „noch nie angemeldet“, Cloudflare-Hinweis): `scripts/e2e-zentrale-1.3-steckbrief.mjs`, 1.3.1 (Zurück zum Hochladen, Antragsseite, Bilder an Anträgen): `scripts/e2e-zentrale-1.3.1-antraege.mjs`. Einzelne Tests: `E2E_TESTS="zentrale-1.3-steckbrief" sh scripts/e2e-alle.sh`.
- 1.6.0 (Multiplayer mit zwei Tabs im Entwurf, MCP-Schlüssel, Freigabe-Seite der Claude-App): `scripts/e2e-zentrale-1.6.mjs`.
- **Alle Ende-zu-Ende-Tests auf einmal:** `scripts/e2e-alle.sh` (frischer Teststand je Test, räumt danach auf). Vor dem Deploy automatisch mit `scripts/deploy.sh --gruendlich`.
- **Seit 1.4.1 auf dem Mac (NAS entlasten):** Läuft Docker Desktop, steht der Teststand auf dem Mac (Ports nur an 127.0.0.1, Hostnamen `127.0.0.1` / `localhost` / `upload.localhost`), volle Runde ca. 2:35 Min. Sonst wie bisher auf der NAS. Erzwingen: `E2E_ORT=mac` bzw. `E2E_ORT=nas`. `deploy.sh --probe` legt dafür einen Auftrag an. Den holt der Mac (`scripts/auftraege-mac.py`, siehe docs/betrieb.md), das Ergebnis steht unter „Aufgaben“. Log: `~/Library/Logs/spielebibliothek-auftraege.log`.
- **Warten in den Tests:** `gehe(url, ms)` wartet höchstens `ms`, bis die Seite geladen ist und das DOM 400 ms still steht. Wo echte Zeit vergehen muss (Spielzeit, verzögerte Erfolge), ausdrücklich `warte()` nehmen.

## Oberfläche: nur mit den UI-Bausteinen (seit 10.11.2026)

- **Jede neue oder umgebaute Oberfläche nur mit `UI.*`** aus `site/ui/` (Knöpfe, Felder, Karten, Tabellen, Dialoge, Meldungen …). Kein eigenes `button`/`input`/`select`/`dialog`, kein `confirm`/`prompt`/`alert`, kein eigenes CSS, keine Farben im Skript.
- Fehlt ein Baustein: **zuerst den Baustein ergänzen** (bausteine.js/.css, Testseite, Claude Design, Liste), dann die Seite.
- Nachschlagewerk: `docs/ui-bausteine.md`. Wächter: `node scripts/ui-pruefen.mjs` (umgebaute Seiten in der Liste `UMGEBAUT`) und `node scripts/kontrast-pruefen.mjs`, beide laufen in `deploy.sh` mit. Ende-zu-Ende: `scripts/e2e-bausteine.mjs` (Testseite `/ui-test/`, live gesperrt).
- Ausprobieren auf der **Design-Spielwiese**: `scripts/deploy.sh --design` → `http://<NAS_GH>:18288`, Kopie der echten Daten, nur über Tailscale, automatisch als seb. **Nie eine Cloudflare-Route darauf legen.** Schnelle CSS-Runden: `--design --nur-site`.

## Probe-Zentrale (E56) – erst testen, dann live

1. `scripts/deploy.sh --probe` (gleiche Prüfungen wie live: committet, neue Nummer, Changelog, Tests) baut auf der NAS eine zweite Zentrale auf:
   - eine **frische Kopie** der echten Spiele, Datenbank, Konten und Upload-Passwörter
   - seit 1.4.0 zugleich der **Testserver** unter `https://test.cuby0401.uk` (Cloudflare Access, echte Anmeldung per E-Mail-Code, kein automatisches seb; die Ports hängen nur an der LAN-Adresse, Tailscale kommt nicht ran)
   - Ein oranges Band zeigt „Probe-Zentrale“.
   - Mit `--daten-behalten` bleiben die Probe-Daten, nur der Code wird erneuert.
2. Dort testen. Was dort passiert, bleibt dort.
3. Admin-Panel der Probe → „Getestet – für Live freigeben“ (optional mit Notiz). Das schreibt `data/freigabe.json` mit dem Commit.
4. `scripts/deploy.sh` prüft als Erstes, ob genau dieser Commit freigegeben ist, sonst Abbruch. Notfall: `--ohne-probe`.

Technisch ist die Probe derselbe Aufbau wie der Teststand (`scripts/teststand.sh`, `ART=probe`, Container `sbprobe-*`, Ordner `/volume1/docker/spielebibliothek-probe`). Wächter und Home Assistant sind dort aus.

## Deploy und Versionen der Zentrale (E39)

- **Neue Version:**
  - `VERSION` erhöhen, in `CHANGELOG.md` einen Abschnitt `## <Version> – <Datum>` ergänzen, committen.
  - Dann `scripts/deploy.sh`. Das Skript macht danach den Rest:
    - verweigert nicht committete Stände und doppelte Nummern
    - führt die Unit-Tests auf der NAS aus
    - sichert die Datenbank nach `data/backup/vor-deploy/`
    - archiviert den laufenden Stand nach `/volume1/docker/spielebibliothek-releases/<alt>.tar`
    - überträgt, startet und setzt den Git-Tag `zentrale-v<Version>`
- **Zurück:** `scripts/deploy.sh --zurueck <version>` (die vorhandenen zeigt `--versionen`). Auch dabei werden vorher Datenbank und laufender Stand gesichert.
- **Datenbank:** Erweiterungen laufen beim Start automatisch (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`). Deshalb laufen alte Stände der Zentrale mit einer neueren Datenbank weiter: Spalten nie löschen oder umbenennen.
- **Anzeige:** Die Version steht in der Fußzeile und im Admin-Panel (`site/zentrale.json`, `site/admin/CHANGELOG.md`, beide schreibt `deploy.sh`).
- `scripts/deploy.sh --examples` kopiert zusätzlich die Testspiele aus `examples/`.

## Home Assistant

Wächter und Anträge melden sich per Webhook (`HA_WEBHOOK_URL` in der `.env`). Einrichtung mit Automationen zum Einfügen: `docs/home-assistant.md`.

## Cloudflare-Abgleich

Richtlinien „Kollegen“/„Entwickler“ ↔ Benutzerliste: Prüfen im Admin-Panel (Nur-Lese-Schlüssel auf der NAS), Schreiben nur am Mac mit `python3 scripts/cloudflare.py abgleichen` (Schreib-Schlüssel im Schlüsselbund). Warum so und wie einrichten: `docs/cloudflare-abgleich.md`. **Live-Datenbank nie mit `sqlite3` auf dem NAS-Host öffnen**, nur per `docker exec` im Container (sonst gehören die WAL-Dateien dem falschen Benutzer → Fehler 500, 06.11.2026).

## Auftragsdienst (Zentrale 1.3.0)

`scripts/auftragsdienst.py` läuft jede Minute als Cron-Job unter Sebi über `/etc/cron.d/spielebibliothek-auftragsdienst` (einrichten im normalen Terminal, einmal mit sudo-Passwort: `sh scripts/auftragsdienst-einrichten.sh`; eine eigene crontab darf Sebi auf UGOS nicht anlegen. Log `/tmp/sb-auftragsdienst.log`). Er
1. meldet ein Lebenszeichen (Admin-Panel → Aufgaben, Wächter),
2. spielt nach „Für Live freigeben“ in der Probe genau den dort abgelegten `release.tar` mit `scripts/nas-deploy.sh` live ein (pro Freigabe ein Versuch; neuer Versuch = Freigabe zurücknehmen und neu freigeben),
3. führt Aufträge aus dem Admin-Panel aus – nur `unit-tests` und `e2e-tests`, Ziel `live` (vollständiger Stand in `/volume1/docker/spielebibliothek-quelle`) oder `probe` (`release.tar`).

Er spricht mit dem Speicher-Dienst nur über `docker exec … python -m savesvc auftraege-holen | auftrag-fertig | lebenszeichen | live-status` und öffnet die Datenbank nie selbst. Testen gegen den Teststand: Umgebung `SB_LIVE`, `SB_QUELLE`, `SB_PROBE`, `SB_LIVE_C`, `SB_PROBE_C`, `SB_SPERRE` umlenken und `STARTEN=0 SICHERN=0 RELEASES=/tmp/…` setzen.

