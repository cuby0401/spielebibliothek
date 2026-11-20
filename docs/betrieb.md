# Betrieb

`$SERVER`, `$NAS`, `<NAS_GH>`, `<SERVER_LAN>` stehen für die Adressen aus `lokal.env` (siehe `docs/entwicklung.md`).

## Wo die Zentrale läuft (seit 20.11.2026: Docker-VM)

Die Zentrale läuft auf einer **Docker-VM** (Debian, Docker + Compose-Plugin) auf dem Proxmox-Server. Die NAS ist nur noch der
Speicher für die Spiele. Welcher Server gemeint ist, steht in `lokal.env` (`SERVER_ORT=vm` oder `nas`); alle Skripte gehen dorthin,
die Pfade je Ort stehen in `scripts/lokal.sh`.

| Pfad auf der VM | Inhalt | liegt | schreibt |
|---|---|---|---|
| `/mnt/nas/games/spiele/<benutzer>/<spiel>/` | hochgeladene Spiele, Entwürfe, Versionen | NAS, Freigabe `games` per **SMB** | Upload-Dienst (UID 10021) |
| `/mnt/nas/games/vm-sicherung/aktuell/` | nächtliche Kopie der Datenbanken und Konfiguration | NAS (borgmatic sichert sie) | root (`sicherung-export.sh`) |
| `/opt/stacks/spielebibliothek-daten/data/` | `saves.db`, `backup/` | lokale Platte | savesvc (UID 10022) |
| `/opt/stacks/spielebibliothek-daten/upload/` | `upload.db`, `geheimnis` | lokale Platte | Upload-Dienst (UID 10021) |
| `/opt/stacks/spielebibliothek/` | dieses Repo (per `deploy.sh`) + `.env` + `config/` | lokale Platte | Sebi |
| `/opt/stacks/spielebibliothek-{releases,quelle,probe,tests}/` | Versionsarchiv, Live-Stand für Tests, Probe, Testergebnisse | lokale Platte | Sebi / Probe |

Feste Regeln:
- **Datenbanken nie auf einer Netzwerkfreigabe.** Nur die Spiele liegen auf der NAS.
- **Freigaben nur per SMB (cifs), nie NFS** – NFS hat die NAS schon zum Absturz gebracht.
- SMB kennt keine ACLs: Die Freigabe ist mit `uid=10021,gid=10021,dir_mode=0770,file_mode=0660` eingebunden. Caddy und der
  Speicher-Dienst lesen über die Gruppe 10021 (`group_add` in `compose.yaml`), Sebi ist auf der VM ebenfalls in der Gruppe.
- Pfade bekommt `compose.yaml` aus der `.env` des Servers: `SPIELE_DIR`, `DATEN_DIR`, `UPLOAD_DATEN_DIR` (leer = Pfade der NAS).

**Einrichten** (einmalig, idempotent): Stack übertragen, dann auf der VM
`sudo sh /opt/stacks/spielebibliothek/scripts/server-setup.sh <LAN-Adresse der NAS>` – installiert `acl`, bindet `games` per SMB ein
(Zugangsdaten in `/etc/nas-cred`, NAS-Benutzer mit Lesen/Schreiben auf `games`), legt die lokalen Ordner mit Rechten an und
den Cron-Job der Sicherung. Danach `sh scripts/auftragsdienst-einrichten.sh` vom Mac.

## Ordner auf der NAS (bis 20.11.2026)

| Pfad | Inhalt | schreibt |
|---|---|---|
| `/volume1/games/spiele/<benutzer>/<spiel>/` | hochgeladene Spiele | filebrowser (UID 10021) |
| `/volume1/games/data/` | `saves.db`, `backup/` | savesvc (UID 10022) |
| `/volume1/games/filebrowser/` | File-Browser-Datenbank | filebrowser (UID 10021) |
| `/volume1/docker/spielebibliothek/` | dieses Repo (per `deploy.sh`) + `.env` | Seb |

Caddy läuft als UID 10020 und darf `spiele/` nur lesen. Sebi (1000) darf überall alles.
Die genauen ACLs setzt `scripts/nas-setup.sh`.

## Phase 0 – einmalige Einrichtung

1. **UGOS → Dateiverwaltung/Freigabeordner:** neuen Freigabeordner `games` auf volume1 anlegen.
   - Papierkorb für diesen Ordner ausschalten (sonst legt UGOS `#recycle/` an und gelöschte Spiele sammeln sich dort).
   - Zugriff: nur `Sebi` Lesen/Schreiben. Keine SMB-Freigabe für Kollegen.
2. **Stack übertragen** (vom Mac): `scripts/deploy.sh --no-start` – legt `/volume1/docker/spielebibliothek/` an.
   Noch nicht starten: Docker würde fehlende Mount-Pfade unter `/volume1/games` sonst als root anlegen.
3. **Rechte setzen** (auf der NAS, braucht sudo):
   ```sh
   ssh -t $NAS sudo sh /volume1/docker/spielebibliothek/scripts/nas-setup.sh
   ```
4. **Cloudflare prüfen:** Zone `cuby0401.uk` aktiv (✓ 03.11.2026: Nameserver `melissa`/`everton.ns.cloudflare.com`),
   Zero-Trust-Team `cold-glitter-fc3b.cloudflareaccess.com` (✓ 03.11.2026, wird in Phase 4 für die JWT-Prüfung gebraucht).

**Achtung UGOS:** Wenn die Rechte des Freigabeordners später in der UGOS-Oberfläche geändert werden,
kann UGOS die ACLs überschreiben. Danach `nas-setup.sh` erneut laufen lassen.

## Phase 1 – Bibliothek im LAN

```sh
scripts/deploy.sh --examples
```

Dann `http://<NAS_LAN>:8088` (LAN) bzw. `http://<NAS_GH>:8088` (Tailnet) öffnen.
**Abnahme:** Kachel „Zähler“ erscheint, „Spielen“ startet das Spiel im iframe, +1 zählt hoch.

Prüfen, dass die Sandbox greift (Browser-Konsole, Kontext auf das iframe umschalten):
`document.cookie` → SecurityError, `parent.document` → SecurityError, `localStorage` → SecurityError.

## Testspiele hinzufügen (bis Phase 4)

Die Bibliothek liest in Phase 1 die Spiel-IDs aus `site/games.json`. Neue Spiele dort eintragen.
Ab Phase 4 kommt die Liste automatisch aus `GET /api/games`.

## Backup (Phase 8, seit 20.11.2026 mit Docker-VM)

Nächtlich über den bestehenden borgmatic-Container `borgmatic` auf der NAS (`/volume1/docker/borg-hetzner`, Ziel: Hetzner Storage Box, verschlüsselt).

**Auf der Docker-VM:**
- **01:45** – savesvc legt `data/backup/saves-latest.db` an (lokal, wie bisher).
- **01:50** – `scripts/sicherung-export.sh` (Cron als root, `/etc/cron.d/spielebibliothek-sicherung`, Log `/var/log/sb-sicherung.log`)
  legt konsistente Kopien von `saves.db` und `upload.db` (SQLite-Backup-API in den Containern), `ergebnisse.db`, `geheimnis`,
  `vor-deploy/`, `config/` und `.env` (als `env`) nach `/mnt/nas/games/vm-sicherung/aktuell/` – erst vollständig, dann getauscht,
  jede Datenbank-Kopie mit `integrity_check` geprüft.
- **Einmalig auf der NAS** (mit sudo), bevor der Export läuft: Der Ordner `vm-sicherung/` braucht enge Rechte, weil darin Tunnel-Token
  und Schlüssel liegen. Ein über SMB direkt in `games` angelegter Ordner wäre auf der NAS für alle lesbar (777); das Skript legt ihn
  deshalb nie selbst an. Eigentümer ist der SMB-Benutzer der VM, Default-ACLs vererben die engen Rechte an alles, was neu entsteht:

  ```sh
  sudo mkdir -p /volume1/games/vm-sicherung
  sudo chown -R <SMB-Benutzer der VM> /volume1/games/vm-sicherung
  sudo setfacl -R -b /volume1/games/vm-sicherung
  sudo chmod -R u=rwX,go= /volume1/games/vm-sicherung
  sudo find /volume1/games/vm-sicherung -type d -exec setfacl -d -m u::rwx,g::---,o::--- {} +
  ```
- **02:00** – borgmatic sichert `/volume1/games` und damit auch die Spiele und `vm-sicherung/` außer Haus.
- Zusätzlich sichert Proxmox die ganze VM nachts auf die NAS (Freigabe `proxmox-backups`) – das liegt aber nur im Haus und reicht
  allein nicht, deshalb der Export.

**Auf der NAS (bis 20.11.2026):**

- **01:45** – savesvc legt `/volume1/games/data/backup/saves-latest.db` an (SQLite-Backup-API, konsistent). Zusätzlich bei jedem Start von savesvc.
- **02:00** – borgmatic sichert `/volume1/games` (→ `/mnt/games`) und `/volume1/docker/spielebibliothek` (→ `/mnt/spielebibliothek`, inkl. `.env` und `config/users.yaml`).
  Die laufende `saves.db` (+ `-wal`/`-shm`) ist per `exclude_patterns` ausgeschlossen.
- borgmatic hat **keinen** Zugriff auf den Docker-Socket – deshalb macht savesvc die DB-Kopie selbst.

## Wiederherstellen

**Docker-VM:** Spiele wie unten aus `mnt/games/spiele/…`. Datenbanken aus `mnt/games/vm-sicherung/aktuell/` (bzw. aus dem Proxmox-Backup der VM):
1. `docker compose down` in `/opt/stacks/spielebibliothek`
2. `vm-sicherung/aktuell/saves.db` → `/opt/stacks/spielebibliothek-daten/data/saves.db` (alte `-wal`/`-shm` vorher löschen),
   `upload.db` und `geheimnis` → `…-daten/upload/`, `config/` und `env` (als `.env`) → Stack-Ordner
3. `sudo sh scripts/server-setup.sh <LAN-Adresse der NAS>` (setzt die Rechte neu), dann `docker compose up -d`

**NAS (bis 20.11.2026):** Immer zuerst in den Testordner, nie direkt über den Live-Stand:

```sh
ssh $NAS
docker exec borgmatic borgmatic list --archive latest --path mnt/games          # was ist drin
docker exec borgmatic borgmatic extract --archive latest \
    --path mnt/games/spiele/<benutzer>/<spiel> --destination /mnt/restore-test
# liegt dann unter /volume1/docker/borg-hetzner/restore-test/mnt/games/...
```

- **Ein Spielstand:** zuerst der Verlauf (die letzten 5 Stände) – kein Backup nötig:
  `docker exec spielebibliothek-savesvc python -m savesvc history <spieler> <benutzer>/<spiel> <key>`, dann `… restore <id>`.
- **Ein Spiel:** extrahieren (s. o.) und den Ordner nach `/volume1/games/spiele/<benutzer>/<spiel>/` zurückkopieren.
- **Alles:**
  1. `docker compose down` im Stack-Ordner
  2. `mnt/games` und `mnt/spielebibliothek` extrahieren, zurückkopieren; `data/backup/saves-latest.db` als `data/saves.db` einsetzen (alte `saves.db-wal`/`-shm` vorher löschen)
  3. `sudo sh scripts/nas-setup.sh` – setzt die ACLs neu (borg stellt Besitzer und Rechte her, die ACLs sicherheitshalber neu setzen)
  4. `docker compose up -d`
- Danach: `boese` in der Bibliothek öffnen (alles ✓) und Testordner leeren: `docker exec borgmatic rm -rf /mnt/restore-test/mnt`

Getestet am 05.11.2026: ein Spiel (bit-genau), alles (identisch, DB `integrity_check: ok`), einzelner Spielstand per CLI.


## Not-Aus (Zentrale 1.4.0)

Bei Verdacht auf ein Datenleck oder einen Angriff. Wirkt nur auf die Spielebibliothek, alle anderen Dienste auf dem Server laufen weiter.

**Auslösen** – eins von beiden:
- Admin-Panel → Übersicht → ganz oben „Not-Aus“ aufklappen → „Not-Aus auslösen …“, Grund angeben, `NOT-AUS` eintippen.
- Am Mac: `scripts/deploy.sh --notaus` (falls das Admin-Panel nicht mehr erreichbar ist).

**Was passiert:**
1. Sofort: `config/notaus.json` wird angelegt. Speicher-Dienst und Upload-Dienst antworten auf **jede** Anfrage mit 503 – keine Daten mehr.
   Caddy liefert ab dann auf allen Adressen nur noch die Seite „Not-Aus aktiv“ (503) – auch Hilfe, Handbuch und Spieldateien.
   Dafür darf Caddy (UID 10020) `config/` durchqueren (ACL `u:10020:x`), lesen kann er dort nichts.
2. Innerhalb einer Minute: Der Auftragsdienst stoppt den Tunnel (`spielebibliothek-cloudflared`). Die Seite ist von außen weg.
   Er prüft das jede Minute als Erstes, auch während lange Tests laufen.
3. Solange die Datei da ist, spielen Auftragsdienst, `nas-deploy.sh` und `deploy.sh --zurueck` nichts ein (das würde den Tunnel wieder starten).
4. Home Assistant bekommt eine Meldung (wenn `HA_WEBHOOK_URL` gesetzt ist). Der Wächter meldet nur noch „Not-Aus aktiv“.

**Aufheben – nur am Mac** (bewusst nicht im Admin-Panel, damit ein gekapertes Admin-Konto es nicht rückgängig machen kann):
```
scripts/deploy.sh --notaus-status   # Zustand
scripts/deploy.sh --notaus-aus      # fragt nach, entfernt die Datei, startet den Tunnel
```
Mit `--probe` wirken alle drei auf die Probe-Zentrale (zum Ausprobieren, dort gibt es keinen Tunnel).

Ein- und Ausschalten stehen im **Sicherheitsprotokoll** (Admin-Panel → Not-Aus → „Sicherheitsprotokoll“, Tabelle `sicherheit`, ein Jahr aufbewahrt).

## Umzug NAS → Docker-VM und Rückweg (20.11.2026)

Ablauf: VM einrichten (`server-setup.sh`) → auf der NAS Auftragsdienst stilllegen und alle Container der Spielebibliothek stoppen,
Neustart-Regel `no` (nichts gelöscht) → `data/`, `filebrowser/upload/`, `config/`, `.env`, Release-Archiv, `-quelle`, `-tests` bei
gestoppten Diensten auf die VM kopieren → `lokal.env`: `SERVER_ORT=vm` → `scripts/deploy.sh --ohne-probe` → Probe neu aufbauen
(`deploy.sh --probe`), Tunnel-Routen des Testservers auf `<SERVER_LAN>` stellen → testen.
Auf einer frischen Debian-VM fehlte `cron` – `server-setup.sh` installiert ihn seitdem mit (sonst laufen weder Auftragsdienst noch Sicherung).
Es läuft nie mehr als ein Tunnel: Der Tunnel der NAS ist gestoppt, bevor der auf der VM startet (gleicher `TUNNEL_TOKEN`).

**Rückweg auf die NAS** (die Daten der NAS sind auf dem Stand des Umzugs – was seitdem auf der VM gespeichert wurde, fehlt,
außer man kopiert `saves.db` und `upload.db` vorher bei gestoppten Diensten zurück):
```sh
ssh $VM  'cd /opt/stacks/spielebibliothek && docker compose down && docker rm -f sbprobe-caddy sbprobe-savesvc sbprobe-upload'
ssh $VM  'sudo rm /etc/cron.d/spielebibliothek-auftragsdienst /etc/cron.d/spielebibliothek-sicherung'   # nur die Cron-Einträge
ssh $NAS 'cd /volume1/docker/spielebibliothek && docker update --restart unless-stopped $(docker compose ps -aq) && docker compose start'
ssh $NAS 'cd /volume1/docker/spielebibliothek && mv scripts/auftragsdienst.py.aus scripts/auftragsdienst.py'
# lokal.env: SERVER_ORT=nas; Tunnel-Routen des Testservers wieder auf <NAS_LAN>; Probe mit scripts/deploy.sh --probe neu
```

**Design-Spielwiese:** gibt es auf der VM nicht (geschlossen 20.11.2026). `deploy.sh --design` geht nur mit `SERVER_ORT=nas`.

## Testserver und Tester-Panel (Zentrale 1.4.0)

Die Probe-Zentrale ist zugleich der Testserver für die Tester:

- **Adressen:** `https://test.cuby0401.uk` (Bibliothek), `test-play` (Spiele), `test-upload` (Upload). Tunnel-Routen auf
  `http://<SERVER_LAN>:18188/18189/18190` (LAN-Adresse des Servers aus `lokal.env`; seit 20.11.2026 die Docker-VM), geschützt durch die Access-Anwendung **„Spielebibliothek Test“**
  (AUD `04f54bd3…`, Richtlinie „Tester“: Seb + Tester). Wer dort rein darf, regelt allein diese Richtlinie.
- **Anmeldung:** echt, per E-Mail-Code – kein `DEV_USER` mehr. Die Ports hängen nur an der LAN-Adresse des Servers.
  **Nie Tunnel-Routen auf einen Dienst mit `DEV_USER` anlegen** (07.11.2026 war die Probe so für wenige Minuten offen).
- **Testplan:** `tests/manuell/<Version>.json` im Repo (Format in `savesvc/savesvc/tester.py`). Kommt mit `scripts/deploy.sh --probe` mit.
  Ergebnisse gelten für die ganze Version, auch nach neuen Commits. Muss ein Test nach einer Korrektur neu geprüft werden,
  bekommt er `"neuAb": "<ISO-Zeit>"` – ältere Ergebnisse zählen dann nicht mehr, im Panel steht „Bitte neu testen“.
  Tests, die nur ein Admin machen kann, bekommen `"nurAdmin": true`: Andere Tester sehen sie nicht, der Admin ganz oben.
- **Tester-Rolle bei der Übernahme ins CRM:** `TESTER` in `compose.yaml` (danach zählt nur das CRM).
- **Ergebnisse:** `<Ablage>/spielebibliothek-tests/ergebnisse.db` (VM: `/opt/stacks/…`) (überlebt Neubauten), im Admin-Panel der Probe bei der Freigabe.
- **Tester benachrichtigen:** `deploy.sh --probe` schickt allen mit der CRM-Rolle „Tester“ eine Glocke (ab 1.4.0 live).
- **Neuen Tester aufnehmen:** E-Mail in die Richtlinie „Tester“ der Access-Anwendung, Rolle „Tester“ im CRM (für Link und Glocke).
- **MCP-Server auf dem Testserver (1.6.0):** Tunnel-Route `test-mcp.cuby0401.uk` → `http://<SERVER_LAN>:18188` (gleicher Port
  wie `test`, Caddy wählt nach dem Hostnamen). **Ohne Access-Anwendung** – der MCP-Server meldet selbst an (Schlüssel/OAuth).

## MCP-Server (Zentrale 1.6.0, E88)

Für die KIs der Entwickler (Claude Code, Claude-App). Läuft im Upload-Dienst (`savesvc/savesvc/mcp.py`), Handbuch und Vorlagen
liest er aus `site/handbuch/` (in `compose.yaml` als `/handbuch` eingebunden).

- **Einmalig:** Tunnel-Route `mcp.cuby0401.uk` → `http://caddy:8080` anlegen, **ohne Access-Anwendung** (eine KI kann keinen
  E-Mail-Code eingeben). Caddy reicht unter diesem Namen nur `/mcp`, `/oauth/token`, `/oauth/register` und
  `/.well-known/oauth-*` an den Upload-Dienst weiter, alles andere ist 404.
- **Anmeldung:** Schlüssel für Claude Code (Upload-Seite → „KI-Zugang (Claude)“) oder OAuth für die Claude-App. Freigegeben wird auf
  `upload.cuby0401.uk/upload/mcp-freigabe.html` – dort gelten Access (Anwendung „upload“) und das Upload-Passwort.
  Gespeichert sind nur Hashes (Tabelle `mcp_zugang` in `upload.db`). Wird ein Upload-Konto gelöscht, sind alle seine Zugänge widerrufen.
- **Was die KI darf:** Handbuch, Vorlagen, eigene Spiele und Dateien lesen, Entwürfe hochladen, Prüfung und Fehlerberichte abrufen.
  **Nicht:** veröffentlichen, löschen, fremde Spiele. Jeder Upload steht im Sicherheitsprotokoll („als Entwurf hochgeladen (über Claude)“).
- **Andere KIs:** nicht gesperrt, bekommen aber in jeder Antwort einen Hinweis (Seb, 17.11.2026).
- **Not-Aus:** sperrt auch den MCP-Server (503).

## Multiplayer (Zentrale 1.6.0, E88)

Räume laufen im Speicher-Dienst (`savesvc/savesvc/multiplayer.py`) über einen WebSocket der Bibliotheksseite (`/api/mp/<spiel>`).
Auf dem Server läuft dabei kein Code der Entwickler – die Regeln rechnet der Browser des Hosts. Räume liegen nur im Arbeitsspeicher:
Ein Neustart des Speicher-Dienstes (Deploy) beendet laufende Räume, alle landen wieder in der Lobby. Gespeicherte Spielstände bleiben.
Grenzen: 300 Räume, 10 neue Räume je Person und Minute, 64 KB je Nachricht, 256 KB Spielstand, 40 Nachrichten je Sekunde.


## Aufträge auf dem Mac (Zentrale 1.4.1, NAS entlasten)

- Einmalig einrichten: `sh scripts/auftraege-mac-einrichten.sh` (launchd-Agent `uk.cuby0401.spielebibliothek-auftraege`, alle 20 s). Austragen: `--aus`.
- Läuft Docker Desktop, meldet der Mac „bereit“ an die Live-Bibliothek und den Testserver (Admin-Panel → Aufgaben zeigt es an) und holt dort wartende Unit- und Ende-zu-Ende-Aufträge ab. Quelle ist wie auf der NAS genau der Stand des Ziels (Probe: `release.tar`, Live: `spielebibliothek-quelle`). Unit-Tests laufen mit der `.venv` des Repos, Ende-zu-Ende mit `E2E_ORT=mac`.
- Solange das Lebenszeichen jünger als 90 s ist, lässt der Auftragsdienst auf dem Server diese Aufträge liegen (`auftraege-holen --ausser`). Ende-zu-Ende nur, wenn der Stand des Ziels schon auf dem Mac laufen kann (ab 1.4.1). Ältere Live-Stände bleiben bei der NAS.
- Im Testserver führt nur der Mac aus. Ist er aus, bleiben Aufträge dort auf „wartet“, bis er wieder da ist.
- Nie zwei Läufe gleichzeitig (Sperre `/tmp/sb-auftraege-mac.lock`). Log: `~/Library/Logs/spielebibliothek-auftraege.log`.
