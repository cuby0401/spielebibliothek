# Betrieb

## Ordner auf der NAS

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

Dann `http://192.168.178.100:8088` (LAN) bzw. `http://<NAS_GH>:8088` (Tailnet) öffnen.
**Abnahme:** Kachel „Zähler“ erscheint, „Spielen“ startet das Spiel im iframe, +1 zählt hoch.

Prüfen, dass die Sandbox greift (Browser-Konsole, Kontext auf das iframe umschalten):
`document.cookie` → SecurityError, `parent.document` → SecurityError, `localStorage` → SecurityError.

## Testspiele hinzufügen (bis Phase 4)

Die Bibliothek liest in Phase 1 die Spiel-IDs aus `site/games.json`. Neue Spiele dort eintragen.
Ab Phase 4 kommt die Liste automatisch aus `GET /api/games`.

## Backup (Phase 8)

Nächtlich über den bestehenden borgmatic-Container `borgmatic` (`/volume1/docker/borg-hetzner`, Ziel: Hetzner Storage Box, verschlüsselt).

- **01:45** – savesvc legt `/volume1/games/data/backup/saves-latest.db` an (SQLite-Backup-API, konsistent). Zusätzlich bei jedem Start von savesvc.
- **02:00** – borgmatic sichert `/volume1/games` (→ `/mnt/games`) und `/volume1/docker/spielebibliothek` (→ `/mnt/spielebibliothek`, inkl. `.env` und `config/users.yaml`).
  Die laufende `saves.db` (+ `-wal`/`-shm`) ist per `exclude_patterns` ausgeschlossen.
- borgmatic hat **keinen** Zugriff auf den Docker-Socket – deshalb macht savesvc die DB-Kopie selbst.

## Wiederherstellen

Immer zuerst in den Testordner, nie direkt über den Live-Stand:

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

