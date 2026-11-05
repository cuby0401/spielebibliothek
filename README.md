# Spielebibliothek

Bibliothek für kleine Browser-Spiele der Kollegen auf Sebs NAS.
Spielen unter `games.cuby0401.uk`, Spieldateien unter `play.cuby0401.uk` (eigener Origin), Hochladen unter `upload.cuby0401.uk`.

Die **Spezifikation** steht im Obsidian-Vault `seb-brain` unter `Projekte/Spielebibliothek.md`
(Ziel, Entscheidungen, Architektur, Sicherheit, Betrieb, Umsetzungsplan). Dieses Repo enthält nur den Code.

## Aufbau

```
compose.yaml  Caddyfile  .env.example
site/          Bibliotheksseite (statisch, ohne Build-Schritt)
  hilfe/       Hilfe für Spieler
  handbuch/    Entwickler-Handbuch, prompt.txt (Prompt-Block, einzige Quelle), startvorlage.zip
  upload/      Upload-Seite mit Update-Fenster
  admin/       Admin-Panel
lib/           gamesave.js (für Spiele, inkl. localStorage-Ersatz), bridge.js (Bibliothek, Zwischenspeicher)
savesvc/       Speicher-Dienst und Upload-Dienst (ein Image, FastAPI + SQLite); Tests: docker build --target test savesvc
vorlage/       Startvorlage für neue Spiele → scripts/startvorlage.sh baut daraus site/handbuch/startvorlage.zip
examples/      Testspiele: zaehler, legacy-localstorage, boese (Sicherheitstest), spike, spalten-demo, wortjagd
scripts/       nas-setup.sh, deploy.sh, teststand.sh, startvorlage.sh
docs/          betrieb.md (NAS, Backup), entwicklung.md (Aufbau, Regeln, Tests – vor Änderungen lesen)
```

## Stand

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Ordner, Repo, Cloudflare prüfen | ✓ abgenommen 03.11.2026 |
| 1 | Statische Bibliothek im LAN | ✓ abgenommen 03.11.2026 |
| 2 | Tunnel und Access | ✓ abgenommen 05.11.2026 |
| 3 | Sandbox-Spike → Spiele auf `play.cuby0401.uk`, localStorage-Ersatz | ✓ abgenommen 05.11.2026 (Mac/Safari; iPad/Windows offen) |
| 4 | Speicher-Dienst, GameSave, localStorage-Ersatz | ✓ abgenommen 05.11.2026 (zweites Gerät/Konto offen) |
| 5 | Bestenliste mit Seasons | deployt 05.11.2026, Abnahme mit zweitem Konto offen |
| 6 | Upload (File Browser) | deployt 05.11.2026, Abnahme offen |
| 7 | Härtung: Dateityp-Whitelist, CSP, SVG, Test-Spiel `boese` | deployt 05.11.2026 |
| 6b | Eigener ZIP-Upload ersetzt File Browser (archiviert) | ✓ 05.11.2026 |
| 8 | Backup über borgmatic, Wiederherstellung getestet | ✓ 05.11.2026 |
| 10 | GameSave-Migration, Bestenliste mit Spalten, Kontextmenü, Anträge, Admin-Panel, Ansicht als …, Entwürfe, Versionen, Fehlerberichte | ✓ 05.11.2026 |
| 9 | Anleitung, erster Kollege | Paul und Emil freigeschaltet, Abnahme offen |
| 11 | Zwischenspeicher bei Sitzungsablauf, Was ist neu, Daumen, Testspiele | ✓ 05.11.2026 |
| 12 | Versionierung: Entwurf → Update-Fenster mit Prüfung → Versionsnummer, Rollback mit Spielständen, Handbuch, Startvorlage | 05.11.2026 |

## Deploy

Die Zentrale ist versioniert (`VERSION`, `CHANGELOG.md`, Details in `docs/entwicklung.md`):

```sh
scripts/deploy.sh             # neue Version: Tests, DB-Sicherung, Archiv, übertragen, starten, Tag
scripts/deploy.sh --zurueck 1.0.0   # zurück auf eine archivierte Version
scripts/deploy.sh --versionen # archivierte Versionen anzeigen
scripts/deploy.sh --examples  # zusätzlich Testspiele nach spiele/seb/
scripts/startvorlage.sh       # nach Änderungen an vorlage/ oder site/handbuch/prompt.txt – ZIP mit committen
```

Erreichbar nur über `https://games.cuby0401.uk` (Cloudflare Tunnel + Access).
Für LAN-Tests den Port in `compose.yaml` vorübergehend einkommentieren.

## Konfiguration auf der NAS (nicht im Git)

- `.env`: `TUNNEL_TOKEN`
- `config/users.yaml`: Login-E-Mail → Benutzername (Vorlage `users.example.yaml`), wirkt ohne Neustart
- Upload-Konten (Entwickler): `docker exec spielebibliothek-upload python -m savesvc entwickler anlegen|passwort|sperren|liste <name>`
