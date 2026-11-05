# Spielebibliothek

Bibliothek für kleine Browser-Spiele der Kollegen auf Sebs NAS.
Spielen unter `games.cuby0401.uk`, Spieldateien unter `play.cuby0401.uk` (eigener Origin), Hochladen unter `upload.cuby0401.uk`.

Die **Spezifikation** steht im Obsidian-Vault `seb-brain` unter `Projekte/Spielebibliothek.md`
(Ziel, Entscheidungen, Architektur, Sicherheit, Betrieb, Umsetzungsplan). Dieses Repo enthält nur den Code.

## Aufbau

```
compose.yaml  Caddyfile  .env.example
site/          Bibliotheksseite (statisch, ohne Build-Schritt)
lib/           gamesave.js (für Spiele, inkl. localStorage-Ersatz), bridge.js (Bibliothek)
savesvc/       Speicher-Dienst (FastAPI + SQLite); Tests: docker build --target test savesvc
examples/      Testspiele: zaehler, legacy-localstorage (localStorage-Ersatz), boese (Sicherheitstest: alles muss ✓ zeigen), spike
scripts/       nas-setup.sh (Ordner + ACLs), deploy.sh (rsync vom Mac)
docs/          Betriebsnotizen
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
| 6b | Eigener ZIP-Upload ersetzt File Browser (archiviert) | geplant |
| 8 | Backup über borgmatic, Wiederherstellung getestet | ✓ 05.11.2026 |
| 9 | Anleitung, erster Kollege | offen |

## Deploy

```sh
scripts/deploy.sh             # Stack übertragen (git-verfolgte Dateien) und starten
scripts/deploy.sh --examples  # zusätzlich Testspiele nach spiele/seb/
```

Erreichbar nur über `https://games.cuby0401.uk` (Cloudflare Tunnel + Access).
Für LAN-Tests den Port in `compose.yaml` vorübergehend einkommentieren.

## Konfiguration auf der NAS (nicht im Git)

- `.env`: `TUNNEL_TOKEN`
- `config/users.yaml`: Login-E-Mail → Benutzername (Vorlage `users.example.yaml`), wirkt ohne Neustart
- File-Browser-Benutzer: nur über `scripts/filebrowser.sh` (einrichten · anlegen · passwort · sperren · liste)
