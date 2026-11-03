# Spielebibliothek

Bibliothek für kleine Browser-Spiele der Kollegen auf Sebs NAS.
Spielen unter `games.cuby0401.uk`, Hochladen unter `upload.cuby0401.uk`.

Die **Spezifikation** steht im Obsidian-Vault `seb-brain` unter `Projekte/Spielebibliothek.md`
(Ziel, Entscheidungen, Architektur, Sicherheit, Betrieb, Umsetzungsplan). Dieses Repo enthält nur den Code.

## Aufbau

```
compose.yaml  Caddyfile  .env.example
site/          Bibliotheksseite (statisch, ohne Build-Schritt)
lib/           gamesave.js (für Spiele), später bridge.js
savesvc/       Speicher-Dienst (FastAPI + SQLite), ab Phase 4
examples/      Testspiele: zaehler (ab Phase 1), legacy-localstorage, boese (später)
scripts/       nas-setup.sh (Ordner + ACLs), deploy.sh (rsync vom Mac)
docs/          Betriebsnotizen
```

## Stand

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Ordner, Repo, Cloudflare prüfen | ✓ abgenommen 03.11.2026 |
| 1 | Statische Bibliothek im LAN | ✓ abgenommen 03.11.2026 |
| 2–9 | Tunnel, Sandbox-Spike, savesvc, Bestenliste, Upload, Härtung, Backup, Anleitung | offen |

## Deploy

```sh
scripts/deploy.sh             # Stack übertragen (git-verfolgte Dateien) und starten
scripts/deploy.sh --examples  # zusätzlich Testspiele nach spiele/seb/
```

Phase 1: Die Bibliothek ist dann unter `http://<NAS>:8088` erreichbar (LAN oder Tailnet).
Der Port wird in Phase 2 wieder entfernt.
