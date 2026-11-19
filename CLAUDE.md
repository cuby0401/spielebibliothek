# Spielebibliothek – Regeln für Claude

Diese Datei gilt für jede Claude-Session, die in diesem Repo arbeitet. Sie ist verbindlich.

## 0. Das Repo ist öffentlich – keine sensiblen Daten (Seb, 17.11.2026)

Das komplette Projekt geht öffentlich auf GitHub: Code, Doku, CHANGELOG, Testpläne, Testdaten **und die Commit-Nachrichten**.
Deshalb darf nie etwas hinein, das Personen oder die eigene Infrastruktur verrät:

1. **Keine Namen echter Personen**: keine Kollegen, Tester, Entwickler, Familie oder Freunde – weder in Code und Kommentaren noch in
   Doku, CHANGELOG, Testplänen (`tests/manuell/`), Beispielspielen oder Commit-Nachrichten. Stattdessen Rollen („ein Entwickler“,
   „ein Tester“, „der Admin“) oder neutrale Platzhalter.
2. **Keine echten E-Mail-Adressen**, Handles oder Benutzernamen echter Personen. In Tests und Beispielen nur `@example.com`.
3. **Keine Adressen der eigenen Infrastruktur**: Tailscale-Namen und -IPs, ssh-Ziele, NAS-Namen gehören in `lokal.env` (gitignored,
   Vorlage `lokal.env.example`). `deploy.sh` bricht ab, wenn eine Adresse aus `lokal.env` in einer Datei steht.
4. **Keine Geheimnisse und keine echten Daten**: keine Passwörter, Tokens, Schlüssel, `.env`, `config/users.yaml`, Datenbanken, Backups,
   Logs, Screenshots oder Fotos mit echten Inhalten, keine Inhalte aus Anfragen, Fehlerberichten oder dem CRM.
5. **Vorfälle und Entscheidungen ohne Personenbezug beschreiben** („Ein Spieler meldete …“). Wer was gesagt oder gemacht hat, gehört in den
   privaten Vault (`~/seb-brain`), nicht ins Repo.
6. **Vor jedem Commit den Diff durchsehen** (`git diff --cached`, auch die Commit-Nachricht) – im Zweifel weglassen und Seb fragen.

## 1. Oberfläche: NUR aus den UI-Bausteinen (Seb, 10./11.11.2026, E85)

Seb: „Es sollte alles einheitlich werden. Einheitlichkeit ist wichtig.“ Darum gibt es den Werkzeugkasten in `site/ui/`.
Jede Seite der Zentrale (Bibliothek, Konto, Upload, Hilfe, Handbuch, Tester-Panel, Admin-Panel) wird **ausschließlich**
daraus gebaut. Nachschlagewerk mit allen Bausteinen und Optionen: **`docs/ui-bausteine.md` – vor jeder Arbeit an der
Oberfläche lesen.**

Pflicht:

1. **Nur `UI.*` benutzen** (`UI.knopf`, `UI.feld`, `UI.auswahl`, `UI.karte`, `UI.tabelle`, `UI.menue`, `UI.dialog` …).
   - Kein eigenes `button`, `input`, `select`, `textarea` oder `dialog` – weder im HTML noch per `createElement`/`h()`.
   - Kein `confirm`, `prompt`, `alert` → `await UI.bestaetigen(…)`, `await UI.eingabe(…)`, `await UI.hinweisDialog(…)`.
   - Meldungen nur über `UI.meldung` (eine Art für alles), Hinweise im Seitenfluss über `UI.hinweis`, Bänder über `UI.band`.
2. **Kein eigenes CSS.** Keine Stylesheets neben `/ui/tokens.css` und `/ui/bausteine.css`, keine `style`-Attribute,
   keine Farben/Abstände/Radien im Skript, nur Klassen mit Präfix `b-`. Werte stehen ausschließlich in `site/ui/tokens.css`.
3. **Fehlt etwas, zuerst einen Baustein bauen** – generisch und wiederverwendbar, in `site/ui/bausteine.js` und
   `bausteine.css`, auf der Testseite `site/ui-test/test.js`, in `docs/ui-bausteine.md` und im Design-System
   (`python3 -I scripts/design-system-erzeugen.py <ordner>`, dann in Claude Design veröffentlichen). Erst danach die Seite.
   Nie eine Sonderlösung „nur für diese eine Seite“.
4. **Gleiche Dinge sehen gleich aus und heißen gleich:** Konto-Menü oben rechts = `UI.menue`, Bereiche mit Navigation =
   `UI.bereich` + `UI.seitenleiste`, Titel = `UI.seite`/`b-seite__titel`, Status = `UI.marke({punkt: true})`,
   leere Listen = `UI.leer`, Laden = `UI.laden`. Eine Hauptaktion (`primaer`) je Bereich; Gefährliches `gefahr` + Bestätigung.
5. **Texte nur über die Bausteine** (`textContent`), nie `innerHTML` (einzige Ausnahme: feste Icon-Pfade in `ikonen.js`).
   Icons statt Emojis (`UI.ikon`, Liste in `ikonen.js`).
6. **Look-Fragen über Claude Design** („Spielebibliothek Bausteine“, https://claude.ai/artifact/44bcauRAN8ZCegDucpatkT).
   Seb hat „Klar“ (Apple-nah, ruhig, Farbe erlaubt) mit Akzent Blau gewählt. Spieler können Thema, Farbe, Abstände,
   Kachelgröße und die Startseite selbst einstellen – neue Seiten müssen das mitmachen (nur Tokens benutzen).

Wächter (laufen in `scripts/deploy.sh` mit, ein Fehler bricht ab):

- `node scripts/ui-pruefen.mjs` – jede Seite in der Liste `UMGEBAUT` hält die Regeln ein. Neue Seiten kommen dort hinein.
- `node scripts/kontrast-pruefen.mjs` – alle Farbpaare (hell/dunkel × 6 Farben) erfüllen WCAG AA.
- Ende-zu-Ende: `scripts/e2e-bausteine.mjs` und `scripts/e2e-alle.sh`.

## 2. Wo ausprobieren

- **Design-Spielwiese:** seit 20.11.2026 geschlossen (gibt es auf der Docker-VM nicht). Früher nur Tailscale, Kopie der echten Daten,
  automatisch als seb: `scripts/deploy.sh --design` → `http://<NAS_GH>:18288`, geht nur noch mit `SERVER_ORT=nas`.
  **Nie eine Cloudflare-Route auf die Ports 18288–18290 legen** (Auto-Anmeldung, Lehre vom 07.11.2026).
- Nicht ungefragt auf live oder den Testserver (`test.cuby0401.uk`) deployen. Live-Deploys macht Seb.

## 3. Sonst

- Ablauf, Probe/Testserver, Versionen, Tests: `docs/entwicklung.md`. Betrieb: `docs/betrieb.md`.
- Die Zentrale läuft seit 20.11.2026 auf der Docker-VM (`SERVER_ORT=vm` in `lokal.env`), die Spiele liegen per SMB auf der NAS.
  Datenbanken nur auf der lokalen Platte des Servers, nie auf einer Freigabe; Freigaben nur per SMB, nie NFS (`docs/betrieb.md`).
- Datenbanken nur im Container lesen (`docker exec`), nie `sqlite3` auf dem Host.
- Projektwissen und Entscheidungen stehen im Vault `~/seb-brain` unter `Projekte/Spielebibliothek/`.
