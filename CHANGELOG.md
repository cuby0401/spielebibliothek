# Änderungsprotokoll der Zentrale (Spielebibliothek)

Versionen der Bibliothek selbst – nicht der Spiele. Schema `MAJOR.MINOR.PATCH` wie bei den Spielen (E39):
**großes Update** (Umbau, Abläufe für Entwickler ändern sich), **kleines Update** (neue Funktionen), **Patch/Hotfix** (Fehler behoben).
Vor jedem Deploy: Nummer in `VERSION` erhöhen und hier einen Abschnitt ergänzen – `scripts/deploy.sh` prüft beides.
Zurück auf eine frühere Version: `scripts/deploy.sh --zurueck <version>`.

## 1.3.1 – 06.11.2026

Bugfix-Update (Seb, 06.11.2026): Anträge leichter finden und öffnen, Bilder an Anträgen, Fehler von Emil beim Entwurf-Testen.

- **Behoben (Antrag #3 von Emil):** Nach „Testen“ auf der Upload-Seite führte der Zurück-Knopf in die Spieleübersicht, und man musste „Spiel hochladen“ neu öffnen. Jetzt öffnet „Testen“ den Entwurf im selben Tab. „← Zurück zum Hochladen“ und der Link im gelben Entwurf-Hinweis führen direkt zum Spiel auf der Upload-Seite (dort hervorgehoben), wo man veröffentlicht.
- **Neu:** Jeder Antrag hat eine eigene Seite (`#/antrag/<Nummer>`) mit Text, Bildern, Status und Antwortfeld. Ein Klick auf die Meldung in der Glocke öffnet sie direkt, ebenso „Öffnen“ in „Anträge“, „Meine Spiele“ und im Admin-Panel. Sehen dürfen nur Antragsteller, zuständiger Entwickler und Admin.
- **Neu:** Bilder an Anträgen (bis zu 5, PNG/JPG/WebP): beim Stellen „Bild anfügen“ oder Screenshot mit Strg/⌘+V einfügen, später auch in der Antragsseite. Die Seite verkleinert große Fotos vorher (max. 1600 px). Der Server prüft die Bildart an den Bytes und erlaubt kein SVG. Die Bilder liegen in der Datenbank und werden mitgesichert.
- **Geändert:** Anträge zu den eigenen Spielen sind leichter zu finden. Unter „Anträge“ stehen sie oben („An dich“), unter „Meine Spiele“ gibt es oben einen Hinweis auf offene Anträge und in der Tabelle die Spalte „Anträge“.
- **Hinweis:** Meldungen in der Glocke von vor 1.3.1 führen weiter auf die alten Seiten.

## 1.3.0 – 06.11.2026

- **Neu:** Cloudflare-Abgleich. Das Admin-Panel (Reiter Benutzer) zeigt, wer in den Richtlinien „Kollegen“/„Entwickler“ fehlt oder zu viel ist. Der Server bekommt dafür höchstens einen Nur-Lese-Schlüssel. Geschrieben wird nur vom Mac mit `scripts/cloudflare.py abgleichen`: Schlüssel im Schlüsselbund, Anzeige und Bestätigung, Sicherung vorher, Gegenprobe danach. Siehe `docs/cloudflare-abgleich.md`.
- **Neu:** „noch nie angemeldet“ in der Benutzerliste, wenn jemand weder angemeldet war noch gespielt oder hochgeladen hat. Der typische Fall, wenn der E-Mail-Code nicht ankommt.
- **Geändert:** Der Wächter schreibt jetzt bei jedem Lauf in die Datenbank und in die Upload-Datenbank (`/intern/gesund`) und prüft, ob der Spieleordner beschreibbar ist. Ein Schreibschutz wie am 06.11.2026 (Fehler 500) wird so nach spätestens 5 Minuten gemeldet.
- **Neu:** Auftragsdienst auf der NAS (`scripts/auftragsdienst.py`, Cron-Job jede Minute, einrichten mit `sh scripts/auftragsdienst-einrichten.sh`). Er führt nur fest eingebaute Aufgaben aus, kein Container bekommt Zugriff auf Docker.
- **Neu:** „Für Live freigeben“ in der Probe spielt die Version automatisch live ein, innerhalb einer Minute. `deploy.sh --probe` legt dafür den unveränderten Stand (`release.tar`) in der Probe ab. Das Einspielen übernimmt `scripts/nas-deploy.sh`, das jetzt auch `deploy.sh` nutzt. `deploy.sh` holt den Git-Tag nach.
- **Neu:** Reiter „Aufgaben“ im Admin-Panel: Unit- und Ende-zu-Ende-Tests für Live-Stand oder Probe per Knopf oder täglich zu einer Uhrzeit, mit Verlauf und Log. Bei Fehlern gibt es eine rote Glocke und eine Meldung an Home Assistant. Die Ende-zu-Ende-Tests laufen dafür auf der NAS mit Chrome im Container (`scripts/e2e-nas.sh`). Der Wächter meldet, wenn der Auftragsdienst stehen bleibt.
- **Geändert:** Anträge zu einem Spiel (Fehler, Wunsch, Sonstiges) gehen an dessen Entwickler, nicht mehr an den Admin. Er sieht sie unter „Meine Spiele“ pro Spiel (offen und geschlossen) und beantwortet sie dort. Im Admin-Panel stehen sie nur noch eingeklappt zur Info, ohne Glocke und ohne Zahl.
- **Geändert:** „Ansicht als …“ beenden führt zurück an die Stelle im Admin-Panel, an der die Ansicht gestartet wurde.
- **Tests:** neuer Ende-zu-Ende-Test `scripts/e2e-zentrale-1.3-steckbrief.mjs` (Beschreibung und Vorschaubild, „noch nie angemeldet“, Cloudflare-Hinweis). `E2E_TESTS="…" sh scripts/e2e-alle.sh` führt einzelne Tests aus.

## 1.2.1 – 06.11.2026

Als Bugfix-Update ohne Probe eingespielt (Seb, 06.11.2026). Enthält neben den Fixes auch die neuen Funktionen, die zuerst als 1.3.0 geplant waren.

- **Geändert:** „Mein Profil“ ist die zentrale Seite mit Spielen, Spielständen und Anmeldungen. „Meine Spielstände“ und „Meine Anmeldungen“ sind aus dem Kontextmenü entfernt, die alten Adressen leiten aufs Profil um.
- **Neu:** Anmeldungen trennen, einzeln oder „alle anderen Geräte“. Das Gerät wird beim nächsten Klick abgemeldet, der Fortschritt landet vorher im Zwischenspeicher. Admins können Anmeldungen aller Benutzer trennen.
- **Neu:** Meldungen in der Glocke archivieren, löschen oder alle archivieren. Archivierte lassen sich zurückholen.
- **Geändert:** Glocke und Daumen als schlichte Symbole statt Emojis, Meldungstexte ohne Emojis.
- **Geändert:** Größen in passender Einheit (B, KB, MB, GB, TB, PB) statt immer MB.
- **Behoben:** Das Profil zählte Testspiele (Spike) als gespielte Spiele.
- **Behoben:** „Zuletzt aktiv“ im Admin-Panel (Benutzer) zählte nur Spielstände und Scores. Jetzt zählen auch Anmeldungen und Uploads, sonst stand bei Entwicklern, die nur hochladen, und bei Spielern, die sich nur umsehen, „–“.
- **Neu:** Steckbrief auf der Upload-Seite: Titel, Beschreibung (Text unter dem Spiel) und Vorschaubild (PNG/JPG/WebP, max. 2 MB) direkt einstellen. Gilt sofort ohne neue Version, übersteht Updates und hat Vorrang vor der `game.json`. Beschrieben im Handbuch, Abschnitt 8b.
- **Geändert:** Die Hilfe verweist auf „Mein Profil → Spielstände“ statt auf „Meine Spielstände“.
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
