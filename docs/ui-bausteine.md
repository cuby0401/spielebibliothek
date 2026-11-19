# UI-Bausteine – der Werkzeugkasten für jede Oberfläche der Zentrale

Stand 13.11.2026. Seb: „Diese Vorlagen sind dafür da, dass ich besser die Server bauen kann. Dann kannst du immer auf die
Bausteine zugreifen und kannst auch nichts Falsches bauen. Dann ist alles einheitlich.“

Die Bausteine sind **kein Angebot für Spiele-Entwickler** und es gibt keine Schauseite dafür. Sie sind die Pflicht für jede
neue oder umgebaute Seite der Zentrale (Bibliothek, Konto, Upload, Hilfe, Handbuch, Tester-Panel, Admin-Panel).

## Regeln

1. **Jede neue oder umgebaute Oberfläche nur mit `UI.*`.** Kein eigenes `button`, `input`, `select`, `textarea` oder
   `dialog`. Kein `confirm`, `prompt` oder `alert`, sondern `UI.bestaetigen`, `UI.eingabe` und `UI.hinweisDialog`.
2. **Kein eigenes CSS auf umgebauten Seiten.** Aussehen gibt es nur in `site/ui/bausteine.css`, Werte nur in
   `site/ui/tokens.css`. Keine Farben, Abstände oder Radien im Skript.
3. **Fehlt etwas, kommt zuerst ein neuer Baustein dazu:** in `bausteine.js`/`bausteine.css`, auf der Testseite
   `site/ui-test/test.js`, im Design-System (Claude Design) und hier in der Liste. Erst danach wird die Seite gebaut.
4. **Look-Entscheidungen gehen über Claude Design**, das Design-System „Spielebibliothek Bausteine“:
   https://claude.ai/artifact/44bcauRAN8ZCegDucpatkT. Dort und in `tokens.css` stehen dieselben Werte.
5. **Texte immer über die Bausteine** (`textContent`), nie `innerHTML`. Die einzige Ausnahme sind die festen Icon-Pfade
   in `ikonen.js`.
6. **Eine Hauptaktion je Bereich.** Höchstens ein `primaer`-Knopf pro Karte, Dialog oder Formular. Gefährliches ist
   `gefahr` (rot) und wird mit `UI.bestaetigen({gefahr: true})` abgefragt.
7. **Wächter:** `node scripts/ui-pruefen.mjs` prüft die Seiten in `UMGEBAUT` und läuft in `deploy.sh` mit. Seit
   11.11.2026 sind **alle** Seiten umgebaut, und der Wächter bricht ab, wenn eine `.html`-Seite unter `site/` nicht in
   `UMGEBAUT` steht. `node scripts/kontrast-pruefen.mjs` prüft alle Farbpaare gegen WCAG AA.
8. **Was man einstellen kann, muss wirken.** Kachelgröße, Abstände, Thema und Farbe gelten auf jeder Seite – darum nur
   Tokens benutzen (z. B. Spielkacheln immer in `UI.raster`/`UI.reihe`). Verbindliche Kurzfassung: `CLAUDE.md` im Repo.
9. **Volle Fensterbreite** (Seb, 10./11.11.2026): `--b-inhalt-max` ist `none`, den Abstand zum Fensterrand regelt `--b-rand`
   (ab 900 px `--b-abstand-6`). Schmal bleibt nur Fließtext (`b-lesetext`, `--b-text-max`, `UI.seite({schmal})`: Hilfe, Handbuch).
   Eine einzelne Anfrage ist seit 13.11.2026 ebenfalls breit.

## Einbinden (Reihenfolge wichtig)

```html
<head>
<script src="/ui/thema-frueh.js?v=__VERSION__"></script>          <!-- synchron, VOR den Stylesheets: kein Aufblitzen -->
<link rel="stylesheet" href="/ui/tokens.css?v=__VERSION__">
<link rel="stylesheet" href="/ui/bausteine.css?v=__VERSION__">
<script src="/ui/ikonen.js?v=__VERSION__" defer></script>
<script src="/ui/bausteine.js?v=__VERSION__" defer></script>
<script src="/meine-seite.js?v=__VERSION__" defer></script>
</head>
<body class="b-ui">
```

- Nach dem Laden der Einstellungen: `UI.aussehenAnwenden(einstellungen.aussehen)`.
- Upload-Host: hat in der Caddyfile die Route `/ui/*` (seit 11.11.2026). Dort gibt es kein `/api/einstellungen`;
  der Upload folgt dem Gerät bzw. dem Zwischenspeicher `sb-aussehen` dieses Browsers (`thema-frueh.js`).
- Testseite: `/ui-test/` zeigt jeden Baustein in seinen Zuständen. Sie ist live gesperrt und nur auf Teststand und
  Design-Spielwiese erreichbar. Der Test dazu ist `scripts/e2e-bausteine.mjs`.

## Anpassen je Spieler

Server: `GET/PUT /api/einstellungen` liefert immer vollständig:

```json
"aussehen":   {"thema": "auto|hell|dunkel", "akzent": "blau|gruen|tuerkis|violett|rosa|orange",
               "dichte": "kompakt|normal|luftig", "kachelgroesse": "klein|mittel|gross"},
"startseite": {"abschnitte": [{"id": "weiterspielen", "sichtbar": true}, {"id": "favoriten", …}, {"id": "neu", …},
                              {"id": "spiel-der-woche", …}, {"id": "alle", …}]}
```

- `PUT` mischt `aussehen` je Schlüssel. `abschnitte` wird geprüft und vervollständigt.
- Wahlmöglichkeiten mit deutschen Namen: `UI.AUSSEHEN.thema`, `.akzent`, `.dichte` und `.kachelgroesse`, passend
  für `UI.segment` und `UI.farbwahl`.
- Wirkung: Attribute an `<html>` (`data-thema`, `data-akzent`, `data-dichte`, `data-kachel`), gesetzt von
  `UI.aussehenAnwenden`. Der Zwischenspeicher `localStorage["sb-aussehen"]` gilt für `thema-frueh.js`.

## Die Bausteine

Jede Fabrik nimmt **ein Optionsobjekt** und gibt ein **DOM-Element** zurück. Dialoge geben ein **Promise** zurück.
Formularbausteine haben `.wert` (lesen/setzen) und `.eingabe` (das eigentliche Steuerelement). Felder haben zusätzlich
`.fehlerSetzen(text)`.

### Aktionen
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.knopf` | jede Aktion | `text, art: primaer\|standard\|leise\|gefahr\|gefahr-leise, groesse: s\|m\|l, ikon, ikonRechts, nurIkon + label (Pflicht), zahl, href, neuesFenster, typ, breit, laedt, deaktiviert, onclick, id`. Methoden `.laden(bool)`, `.aus(bool)`. Attribut `data-alarm`: rot und wackelnd (Glocke mit dringender Meldung). In der Kopfleiste zeigt das Handy nur das Symbol |
| `UI.knopfleiste([knöpfe], {ausrichtung})` | Knöpfe am Ende von Karte/Formular/Dialog | rechtsbündig; `links`, `verteilt` |
| `UI.segment` | 2–4 feste Möglichkeiten, sofort wirksam (Thema, Zeitraum) | `label, optionen: [[wert, text, ikon?]], wert, onwechsel` |
| `UI.farbwahl` | Akzentfarbe wählen | `label, wert, onwechsel` (Optionen: `UI.AUSSEHEN.akzent`) |

### Formular
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.formular` | jedes Formular mit Speichern | `inhalt, absenden: "Speichern"\|false, aktionen, onabsenden(formData)`. Der Hauptknopf zeigt „lädt“, Fehler kommen als Meldung, Pflichtfelder werden geprüft |
| `UI.feld` | einzeiliger Text | `label, name, typ (text, email, password, number, date, …), wert, platzhalter, hinweis, fehler, pflicht, optional, max, nurLesen, oninput, onchange` |
| `UI.textbereich` | mehrzeiliger Text | wie `feld`, dazu `zeilen` |
| `UI.auswahl` | Liste mit vielen Möglichkeiten | `label, optionen: [[wert, text]] oder [{gruppe, optionen}], wert, platzhalter, onchange` |
| `UI.schalter` | an/aus mit sofortiger Wirkung (Einstellungen) | `label, hinweis, an, onwechsel(bool)` |
| `UI.haken` | an/aus, das erst mit „Speichern“ gilt | `label, hinweis, an, onwechsel` |
| `UI.radio` | 2–6 Möglichkeiten mit Erklärung | `label, name, optionen: [[wert, text, hinweis?]], wert, onwechsel` |
| `UI.datei` | Datei wählen oder hineinziehen | `label, hinweis, accept, mehrfach, ondatei(dateien)`, `.leeren()` |
| `UI.suche` | Suchfeld (filtert beim Tippen) | `platzhalter, wert, verzoegerung (200 ms), oninput(text)`. Esc leert |
| `UI.sortierliste` | Reihenfolge und Sichtbarkeit (Startseite anordnen) | `label, eintraege: [{id, text, sichtbar}], onwechsel(liste)` |

### Inhalt
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.karte` | abgeschlossener Block (Einstellungsgruppe, Personendaten) | `titel, untertitel, aktionen, inhalt, fuss, onclick/href, flach, art: gefahr` |
| `UI.spielkachel` | ein Spiel | `titel, untertitel, beschreibung (2 Zeilen), bild, farbe 1–4, ikon, marken: [{text, art}], fortschritt 0..1, favorit (bool, zeigt Stern), onfavorit, href/onclick, spielId, fuss (Knöpfe unten, z. B. Daumen), deaktiviert (true oder Grund als Text)` |
| `UI.liste([zeilen])` / `UI.zeile` | Listen (Glocke, Konto-Menüpunkte, Personen) | Zeile: `ikon oder avatar, titel, text, rechts, href/onclick, gefahr, ungelesen, pfeil: false, aktionen: [Knöpfe]` (stehen neben, nie in dem Link) |
| `UI.rangliste` | Bestenlisten (Spiel, Spiel der Woche) | `spalten: [{titel}], eintraege: [{platz, name, href, titel, werte: [Text], ich}], rang` (Index der Rangspalte) |
| `UI.tabelle` | Daten in Spalten (Admin) | `spalten: [{titel, feld oder wert(z), sortierbar, sortWert, rechts, mono, leise, breite}], zeilen, leer, onzeile, schluessel`, `.zeilenSetzen(z)` |
| `UI.kennzahl` | eine Zahl (Admin-Übersicht) | `wert, label, hinweis, art: warnung\|gefahr\|erfolg, onclick/href, kompakt` – `kompakt`: ohne eigene Fläche, Wert in einer Zeile, zum Einbetten in eine Karte (mehrere in `UI.leiste`, Hinweis dann beim Drüberfahren), z. B. im Profilkopf (Seb, 13.11.2026) |
| `UI.fortschritt` | Fortschritt, Speicher | `wert, max, label, art, zeigeText (true oder Text), klein` |
| `UI.marke` | Status, Kategorie, Filter-Chip | `text, art: neutral\|akzent\|erfolg\|warnung\|gefahr\|info, punkt, ikon, onclick + an (Filter), onentfernen` |
| `UI.avatar` | Person | `name, bild, groesse: s\|m\|l\|xl`. Die Farbe folgt fest aus dem Namen |
| `UI.angaben([[Begriff, Wert]])` | Steckbrief, Personendaten | Wert darf ein Element sein |
| `UI.text(inhalt, {art: leise\|klein})` | Fließtext | |
| `UI.code(text, o)` | technischer Text in Festbreitenschrift: Fehlermeldung, Log, JSON, Stacktrace, Passwort | `block` (eigener Kasten, scrollt), `gross` (zum Abtippen), `kopieren` (Knopf „Kopieren“) |
| `UI.aufklappen` | Selteneres oder Gefährliches eingeklappt (Not-Aus, Änderungsprotokoll, „nur zur Info“) | `titel, inhalt, offen, art: gefahr, rechts, onoeffnen`. Natives `<details>` |
| `UI.lesetext(kinder)` / Klasse `b-lesetext` | lange Texte: Hilfe, Handbuch, Testanleitungen | setzt `h1–h3, p, ul/ol, dl, code, kbd, pre`, Tabellen (`<div class="b-tabelle"><table>`) einheitlich. Ganze Lesetext-Seite: `<main class="b-lesetext b-lesetext--seite">`; Inhaltsverzeichnis `nav.b-lesetext__inhalt`, Abhakliste `ul.b-lesetext__abhaken`. In festen HTML-Seiten werden `<p data-hinweis="info\|akzent\|…">` per Skript zu `UI.hinweis` |
| `UI.bilder([{src, alt, href, unter, aktion}], o)` | Vorschaubilder: Fotos an Ergebnissen/Anfragen, Vorschaubild eines Spiels | `format: frei\|breit (16:9)`, `onentfernen(i)` (Entfernen-Knopf je Bild), `sofort` (nicht lazy) |

### Navigation und Layout
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.kopfleiste` | Leiste oben (klebt, Milchglas) | `marke: {text, href}, mitte (z. B. Suche), rechts: [Elemente]`. Das Milchglas liegt auf `::before`: ein `backdrop-filter` direkt an der Kopfleiste macht sie zum Bezugsrahmen für `position: fixed`, dann ragte das Konto-Menü (am Handy ein Blatt unten) oben aus dem Bild (13.11.2026). |
| `UI.menue` | Popover am Knopf (Glocke, Konto) | `ausloeser (UI.knopf), eintraege: [{text, ikon, onclick/href, gefahr, rechts} \| "trenner" \| {titel}]` oder `inhalt`, `breit, ausrichtung`. Esc, Klick daneben und Pfeiltasten gehen. Auf dem Handy erscheint es unten als Blatt. In einer `UI.tabelle` schwebt es fest am Knopf (wird nicht abgeschnitten) – gut für „…“-Aktionen je Zeile |
| `UI.reiter` | Bereiche einer Seite (Admin, Tester) | `eintraege: [{id, text, zahl, ikon}], aktiv, onwechsel(id)`, `.setzen(id)`, `.zahlSetzen(id, n)`. Mit `href` je Eintrag: Links zwischen Seiten (Hilfe-Center), aktiv = `aria-current="page"` |
| `UI.seitenleiste` | Bereichsnavigation links (Konto, Admin) | `gruppen: [{titel, eintraege: [{id, text, ikon, href, zahl}]}], aktiv, onwechsel`. Auf dem Handy wird daraus eine waagerechte Leiste , `.setzen(id)`, `.zahlSetzen(id, n)` |
| `UI.seite` | Gerüst jeder Seite | `titel, untertitel, zurueck: {text, href}, aktionen, inhalt, schmal` |
| `UI.bereich` | Seite mit Seitenleiste | `leiste, inhalt` |
| `UI.abschnitt` | Startseiten-Reihe, Seitenbereich | `titel, untertitel, alle: {text, href/onclick}, aktionen, inhalt, einklappbar, offen, onklappen` |
| `UI.raster(kinder, {art: karten\|kennzahlen})` | Kacheln/Karten im Raster | Kachelbreite folgt der Kachelgröße des Spielers |
| `UI.mauer(karten, {spalte, breit})` | Karten unterschiedlicher Höhe ohne Lücken (Personenkarte im CRM) | jede Karte in die gerade kürzeste Spalte, Wichtiges zuerst übergeben; `spalte` = Mindestbreite (360), `breit` = Elemente über die ganze Breite darunter |
| `UI.reihe(kinder)` | waagerecht scrollende Reihe (Startseite) | Breite je Kachel folgt der Kachelgröße des Spielers (`--b-kachel-min` × 1,25), auch bei voller Fensterbreite. |
| `UI.buehne` | laufendes Spiel: großer Rahmen + schmale Spalte (Bestenliste, Erfolge) | `rahmenId, seite: [Elemente]`; am Element `.gross(an)` (Fensterhöhe), `.ohneSeite(an)`, `.inhalt(an)` (Rahmen zeigt Inhalt wie die Lobby statt eines Spiels: so hoch wie der Inhalt, ohne Fläche), Attribut `data-flach` (niedriger Rahmen, Technik-Test) |
| `UI.fusszeile` | Fußzeile jeder Seite | `links: [{text, href}], rechts (Text), rechtsId` |
| `UI.stapel(kinder, {abstand: s\|l, tag: ul})` / `UI.leiste(kinder, {verteilt})` | senkrecht bzw. waagerecht anordnen | |

### Rückmeldung und Dialoge
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.meldung(text, o)` | kurze Rückmeldung unten (Snackbar) | `art: info\|erfolg\|fehler, aktion: {text, onclick}` („Rückgängig“), `dauer`. Fehler bleiben, bis man sie schließt. `UI.meldungsVerlauf()` liefert die letzten 20 Texte (Tests) |
| `UI.band` | Band über die ganze Breite unter der Kopfleiste: Probe/Design-Spielwiese, „Ansicht als …“, Anmeldung abgelaufen | `id, text, art: info\|akzent\|warnung\|gefahr, ikon, aktion, versteckt`; Text-Element hat die id `<id>-text` |
| `UI.hinweis` | Banner im Seitenfluss | `art: info\|erfolg\|warnung\|gefahr\|akzent, titel, text, inhalt, aktion, schliessbar` |
| `UI.leer` | leerer Zustand: was hier erscheint und wie man anfängt | `ikon, titel, text, aktion, klein` |
| `UI.laden` | Laden | `art: kreisel\|skelett, zeilen, form: kacheln, label` |
| `UI.dialog` | eigener Dialog | `titel, text, inhalt, aktionen, breit, gefahr, festhalten` → `{oeffnen(): Promise, schliessen(wert)}` |
| `UI.bestaetigen` | statt `confirm()` | `titel, text, ja, nein, gefahr` → `true/false`. Bei `gefahr` steht der Fokus auf „Abbrechen“. Der Dialog trägt `data-art="bestaetigen"` (E2E-Tests bestätigen ihn wie früher `confirm()` automatisch) |
| `UI.eingabe` | statt `prompt()` | `titel, text, label, wert, hinweis, typ, mehrzeilig, pruefen(w) → Fehlertext` → Text oder `null` |
| `UI.hinweisDialog` | statt `alert()` | `titel, text` |

### Icons
`UI.ikon(name)`: suche, glocke, daumen, stern, herz, schliessen, haken, plus, minus, pfeil-links/-rechts/-hoch/-runter,
winkel-runter/-rechts/-links, mehr, einstellungen, benutzer, personen, abmelden, hochladen, herunterladen, spielen, spiel,
pokal, info, warnung, fehler, erfolg, bearbeiten, loeschen, kopieren, extern, auge, schloss, filter, sortieren, kalender,
uhr, bild, sonne, mond, geraet, bot, raster, liste, aktualisieren, nachricht, verlauf, ordner, datei, schild, test, start,
hilfe, buch. Neues Icon: in `site/ui/ikonen.js` eintragen (Stil Lucide, 24×24, Strich).

## Muster großer Seiten, die die Bausteine übernehmen
- **Apple:** viel Luft, Systemschrift, eine Hauptaktion je Bereich, Kopfleiste mit Milchglas, Schalter und Segmente wie in iOS.
- **Netflix/Steam:** Startseite in Reihen („Weiterspielen“ mit Fortschritt, „Neu“) mit „Alle anzeigen“.
- **Google:** Meldung unten mit „Rückgängig“.
- **Stripe:** Label über dem Feld, Hinweis und Fehler darunter.
- **GitHub:** Status-Marken mit Punkt, Tabellen mit Leer-Zustand, Gefährliches rot und mit Bestätigung.
- **Linear:** ruhige Seitenleiste, Menüs mit Tastatur, Skelette beim Laden.

## Abnahme
- 10.11.2026: Richtung „Klar“ und Akzent Blau gewählt (Seb).
- 11.11.2026: Phase 2 vorgezogen, alle Seiten aus Bausteinen (E86). Testpläne der Design-Spielwiese: `tests/manuell/design/1.0.0.json` und `1.1.0.json`.
- 13.11.2026: Seb entscheidet, das neue Design zusammen mit Zentrale 1.5.0 auf den Testserver zu bringen (statt später als 2.0.0). Die Design-Tests stehen deshalb auch im Testplan `tests/manuell/1.5.0.json`.
