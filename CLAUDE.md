# Spielebibliothek – Regeln für Claude

Diese Datei gilt für jede Claude-Session, die in diesem Repo arbeitet. Sie ist verbindlich.

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

- **Design-Spielwiese** (nur Tailscale, Kopie der echten Daten, automatisch als seb): `scripts/deploy.sh --design`,
  schnelle Runden `scripts/deploy.sh --design --nur-site` → `http://<NAS_GH>:18288`.
  **Nie eine Cloudflare-Route auf die Ports 18288–18290 legen** (Auto-Anmeldung, Lehre vom 07.11.2026).
- Nicht ungefragt auf live oder den Testserver (`test.cuby0401.uk`) deployen. Live-Deploys macht Seb.

## 3. Sonst

- Ablauf, Probe/Testserver, Versionen, Tests: `docs/entwicklung.md`. Betrieb: `docs/betrieb.md`.
- Datenbanken auf der NAS nur im Container lesen (`docker exec`), nie `sqlite3` auf dem Host.
- Projektwissen und Entscheidungen stehen im Vault `~/seb-brain` unter `Projekte/Spielebibliothek/`.
