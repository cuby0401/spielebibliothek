# Entwicklung – Aufbau, feste Regeln, Tests

Für alle, die an der Bibliothek selbst arbeiten (Seb, Claude-Sitzungen). Die Spezifikation und alle Entscheidungen (E1–E38)
stehen im Vault `seb-brain` unter `Projekte/Spielebibliothek/`. Diese Datei ist die Kurzfassung für den Code.

## Dienste

| Dienst | Code | Darf | Erreichbar |
|---|---|---|---|
| caddy | `Caddyfile` | liefert `site/`, `lib/` und Spieldateien aus, leitet `/api/*` weiter | `games`, `play`, `upload` über den Tunnel |
| savesvc (Speicher-Dienst) | `savesvc/savesvc/app.py`, `verwaltung.py`, `intern.py` | Datenbank lesen/schreiben, Spiele **nur lesen** | `/api/*` unter `games`, `/intern/*` nur im Docker-Netz |
| upload (Upload-Dienst) | `savesvc/savesvc/upload.py` | Spieldateien schreiben, Upload-Konten | `/api/upload/*` unter `upload`, `/intern/*` nur im Docker-Netz |

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
9. **Prompt-Block nur in `site/handbuch/prompt.txt` ändern** und danach `scripts/startvorlage.sh` laufen lassen.

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
