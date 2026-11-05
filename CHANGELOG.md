# Änderungsprotokoll der Zentrale (Spielebibliothek)

Versionen der Bibliothek selbst – nicht der Spiele. Schema `MAJOR.MINOR.PATCH` wie bei den Spielen (E39):
**großes Update** (Umbau, Abläufe für Entwickler ändern sich), **kleines Update** (neue Funktionen), **Patch/Hotfix** (Fehler behoben).
Vor jedem Deploy: Nummer in `VERSION` erhöhen und hier einen Abschnitt ergänzen – `scripts/deploy.sh` prüft beides.
Zurück auf eine frühere Version: `scripts/deploy.sh --zurueck <version>`.

## 1.3.0 – 06.11.2026

- **Geändert:** „Mein Profil“ ist die zentrale Seite mit Spielen, Spielständen und Anmeldungen. „Meine Spielstände“ und „Meine Anmeldungen“ sind aus dem Kontextmenü entfernt, die alten Adressen leiten aufs Profil um.
- **Neu:** Anmeldungen trennen, einzeln oder „alle anderen Geräte“. Das Gerät wird beim nächsten Klick abgemeldet, der Fortschritt landet vorher im Zwischenspeicher. Admins können Anmeldungen aller Benutzer trennen.
- **Neu:** Meldungen in der Glocke archivieren, löschen oder alle archivieren. Archivierte lassen sich zurückholen.
- **Geändert:** Glocke und Daumen als schlichte Symbole statt Emojis, Meldungstexte ohne Emojis.
- **Geändert:** Größen in passender Einheit (B, KB, MB, GB, TB, PB) statt immer MB.
- **Behoben:** Das Profil zählte Testspiele (Spike) als gespielte Spiele.
- **Tests:** E2E-Skripte warten bis zu 15 s auf Chrome und beenden Chrome auch bei Abbruch. Neuer Test `scripts/e2e-zentrale-1.3.mjs`.

## 1.2.0 – 05.11.2026

Enthält auch 1.1.1, das nicht einzeln ausgeliefert wurde.

- **Neu:** Speichergrenze je Entwickler, Standard 1 GB (`UPLOAD_KONTINGENT_MB`), mit Anzeige auf der Upload-Seite. Das Admin-Panel warnt, wenn auf der NAS wenig Platz frei ist.
- **Neu:** Spielzeit wird gemessen, solange der Tab sichtbar ist. Dazu die Sortierung „meistgespielt“, „du: …“ auf der Kachel, die Spielzeit unter „Meine Spielstände“, „Meine Spiele“ und im Admin-Panel.
- **Neu:** Glocke in der Taskleiste, für alle mit eigenen Meldungen:
  - Antrag beantwortet
  - neues Spiel (an alle)
  - Updates nur von Spielen, die du als Favorit hast
  - „… hat dich überholt“
  - Erfolge
  - Spiel der Woche
- **Neu:** Wichtige Meldungen machen die Glocke rot und lassen sie wackeln, dazu eine einmalige Einblendung:
  - neuer Fehler in deinem Spiel (höchstens eine Meldung je Spiel und Stunde)
  - ein Spieler meldet einen Fehler in deinem Spiel
  - neuer Antrag (für Admins)
- **Neu:** Wächter. Er prüft alle 5 Minuten Datenbank, Upload-Dienst, Caddy, die Erreichbarkeit über Cloudflare, den Speicher und die Backup-Kopie. Er meldet an Home Assistant (Lebenszeichen, Probleme, neue Anträge) und zeigt den Status im Admin-Panel. Einrichtung: `docs/home-assistant.md`.
- **Neu:** `scripts/deploy.sh --gruendlich` fährt vor dem Deploy alle Ende-zu-Ende-Tests und „Böse“ im Teststand durch. Einzeln: `scripts/e2e-alle.sh`.
- **Neu:** Probe-Zentrale. `scripts/deploy.sh --probe` setzt eine Kopie mit den echten Spielen und Daten auf, nur über Tailscale erreichbar, mit orangem Band.
  - Dort testen, dann im Admin-Panel der Probe „Für Live freigeben“.
  - `scripts/deploy.sh` spielt nur freigegebene Commits live ein. Notfall: `--ohne-probe`.
- **Neu:** „Meine Anmeldungen“ (Menü) zeigt Gerät, Ort, IP, Anmeldezeit und letzte Aktivität je Sitzung. Im Admin-Panel unter Benutzer stehen alle.
- **Neu:** Speicher je Spiel auf der Upload-Seite (live, Entwurf, ältere Versionen, Anteil am Kontingent).
- **Neu:** Suche und Kategorien (`"tags"` in der `game.json`) in der Übersicht.
- **Neu:** Erfolge (`"erfolge"` in der `game.json`, `GameSave.erfolg(id)`). Sie erscheinen neben dem Spiel, als Einblendung und auf der Profilseite. Die Profilseite (Menü → Mein Profil, Klick auf Namen in der Bestenliste) zeigt Spielzeit, Erfolge und Plätze.
- **Neu:** Spiel der Woche (Admin-Panel → Spiele). Es gibt ein Banner, eine Meldung an alle und eine eigene Wochen-Bestenliste.
- **Neu:** 👍 auch auf den Kacheln der Übersicht. Bei eigenen Spielen steht deutlich „eigenes Spiel“ dabei, statt den Knopf nur auszugrauen.
- **Geändert:** Startvorlage, Prompt-Block, Handbuch und Hilfe sind ergänzt. Die Prüfung vor dem Veröffentlichen gibt Hinweise zu Kategorien und Erfolgen.

## 1.1.1 – 05.11.2026

- **Behoben:** Testspiele (Spike, Böse, Bestenlisten-Vorlage …) erscheinen nicht mehr unter „Meine Spiele“ – verwaltet werden sie nur im Admin-Panel.
- **Geändert:** „Ansicht als Spieler/Entwickler“ beginnt bei jedem Start mit leerem Konto (Spielstände, Einstellungen, Zwischenspeicher).

## 1.1.0 – 05.11.2026

- **Neu:** Die Zentrale ist versioniert. Deploy nur mit neuer Nummer, Tests vorher, Datenbank-Sicherung und Archiv des alten Stands vorher, Rückweg mit `--zurueck`.
- **Neu:** Entwickler können eigene Spiele offline nehmen (Meine Spiele), z. B. bei vielen Fehlern. Admins können es ebenfalls.
- **Neu:** „Update hochladen“ an jedem Spiel auf der Upload-Seite legt den Ordner fest. Ein neuer Ordnername wird vorher nachgefragt.
- **Neu:** Hilfe-Center mit den Reitern „Spielen“ und „Spiele entwickeln“, Fußzeile mit Hilfe, Handbuch, Fehler melden und Version. Das Handbuch ist nicht mehr im Kontextmenü.
- **Behoben:** Das Admin-Panel zählte Testspiele als Spiele (7 statt 4).
- **Behoben:** Das Testspiel „Sandbox-Spike“ zeigt seine Ergebnisse jetzt selbst an. Bisher tat das nur die Testseite `/spike/`, in der Bibliothek blieb „läuft …“ stehen. Wird mit `--examples` ausgeliefert.

## 1.0.0 – 05.11.2026

Erster versionierter Stand. Er umfasst alles bis hierher:
- Bibliothek, Spiele auf eigenem Origin, GameSave mit `localStorage`-Ersatz, Bestenliste mit Seasons und Spalten
- ZIP-Upload, Härtung, Backup
- Kontextmenü, Anträge, Admin-Panel, „Ansicht als …“
- Entwürfe, Versionen der Spiele, Fehlerberichte
- Zwischenspeicher bei Sitzungsablauf
- „Was ist neu“, Daumen hoch
- Versionierung der Spiele mit Update-Fenster, Prüfung und Rollback samt Spielständen
- Hilfe und Entwickler-Handbuch, Startvorlage, Testspiele
