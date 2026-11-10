# UI-Bausteine – der Werkzeugkasten für jede Oberfläche der Zentrale

Stand 10.11.2026. Seb: „Diese Vorlagen sind dafür da, dass ich besser die Server bauen kann. Dann kannst du immer auf die
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
7. **Wächter:** `node scripts/ui-pruefen.mjs` prüft die Seiten in `UMGEBAUT` und läuft in `deploy.sh` mit.
   `node scripts/kontrast-pruefen.mjs` prüft alle Farbpaare gegen WCAG AA. Eine Seite, die in Phase 2 umgebaut ist,
   kommt in die Liste `UMGEBAUT`.

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
- Upload-Host: braucht in der Caddyfile eine eigene Route für `/ui/*` (Phase 2). Dort gibt es kein
  `/api/einstellungen`, der Upload bleibt vorerst auf „automatisch“.
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
| `UI.knopf` | jede Aktion | `text, art: primaer\|standard\|leise\|gefahr\|gefahr-leise, groesse: s\|m\|l, ikon, ikonRechts, nurIkon + label (Pflicht), zahl, href, neuesFenster, typ, breit, laedt, deaktiviert, onclick, id`. Methoden `.laden(bool)`, `.aus(bool)` |
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
| `UI.spielkachel` | ein Spiel | `titel, untertitel, bild, farbe 1–4, ikon, marken: [{text, art}], fortschritt 0..1, favorit (bool, zeigt Stern), onfavorit, href/onclick, spielId` |
| `UI.liste([zeilen])` / `UI.zeile` | Listen (Glocke, Konto-Menüpunkte, Personen) | Zeile: `ikon oder avatar, titel, text, rechts, href/onclick, gefahr, ungelesen` |
| `UI.tabelle` | Daten in Spalten (Admin) | `spalten: [{titel, feld oder wert(z), sortierbar, sortWert, rechts, mono, leise, breite}], zeilen, leer, onzeile, schluessel`, `.zeilenSetzen(z)` |
| `UI.kennzahl` | eine Zahl (Admin-Übersicht) | `wert, label, hinweis, art: warnung\|gefahr\|erfolg, onclick/href` |
| `UI.fortschritt` | Fortschritt, Speicher | `wert, max, label, art, zeigeText (true oder Text), klein` |
| `UI.marke` | Status, Kategorie, Filter-Chip | `text, art: neutral\|akzent\|erfolg\|warnung\|gefahr\|info, punkt, ikon, onclick + an (Filter), onentfernen` |
| `UI.avatar` | Person | `name, bild, groesse: s\|m\|l\|xl`. Die Farbe folgt fest aus dem Namen |
| `UI.angaben([[Begriff, Wert]])` | Steckbrief, Personendaten | Wert darf ein Element sein |
| `UI.text(inhalt, {art: leise\|klein})` | Fließtext | |

### Navigation und Layout
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.kopfleiste` | Leiste oben (klebt, Milchglas) | `marke: {text, href}, mitte (z. B. Suche), rechts: [Elemente]` |
| `UI.menue` | Popover am Knopf (Glocke, Konto) | `ausloeser (UI.knopf), eintraege: [{text, ikon, onclick/href, gefahr, rechts} \| "trenner" \| {titel}]` oder `inhalt`, `breit, ausrichtung`. Esc, Klick daneben und Pfeiltasten gehen. Auf dem Handy erscheint es unten als Blatt |
| `UI.reiter` | Bereiche einer Seite (Admin, Tester) | `eintraege: [{id, text, zahl, ikon}], aktiv, onwechsel(id)`, `.setzen(id)`, `.zahlSetzen(id, n)` |
| `UI.seitenleiste` | Bereichsnavigation links (Konto, Admin) | `gruppen: [{titel, eintraege: [{id, text, ikon, href, zahl}]}], aktiv, onwechsel`. Auf dem Handy wird daraus eine waagerechte Leiste |
| `UI.seite` | Gerüst jeder Seite | `titel, untertitel, zurueck: {text, href}, aktionen, inhalt, schmal` |
| `UI.bereich` | Seite mit Seitenleiste | `leiste, inhalt` |
| `UI.abschnitt` | Startseiten-Reihe, Seitenbereich | `titel, untertitel, alle: {text, href/onclick}, aktionen, inhalt, einklappbar, offen, onklappen` |
| `UI.raster(kinder, {art: karten\|kennzahlen})` | Kacheln/Karten im Raster | Kachelbreite folgt der Kachelgröße des Spielers |
| `UI.reihe(kinder)` | waagerecht scrollende Reihe (Startseite) | |
| `UI.stapel(kinder, {abstand: s\|l})` / `UI.leiste(kinder, {verteilt})` | senkrecht bzw. waagerecht anordnen | |

### Rückmeldung und Dialoge
| Baustein | Wofür | Wichtigste Optionen |
|---|---|---|
| `UI.meldung(text, o)` | kurze Rückmeldung unten (Snackbar) | `art: info\|erfolg\|fehler, aktion: {text, onclick}` („Rückgängig“), `dauer`. Fehler bleiben, bis man sie schließt |
| `UI.hinweis` | Banner im Seitenfluss | `art: info\|erfolg\|warnung\|gefahr\|akzent, titel, text, inhalt, aktion, schliessbar` |
| `UI.leer` | leerer Zustand: was hier erscheint und wie man anfängt | `ikon, titel, text, aktion, klein` |
| `UI.laden` | Laden | `art: kreisel\|skelett, zeilen, form: kacheln, label` |
| `UI.dialog` | eigener Dialog | `titel, text, inhalt, aktionen, breit, gefahr, festhalten` → `{oeffnen(): Promise, schliessen(wert)}` |
| `UI.bestaetigen` | statt `confirm()` | `titel, text, ja, nein, gefahr` → `true/false`. Bei `gefahr` steht der Fokus auf „Abbrechen“ |
| `UI.eingabe` | statt `prompt()` | `titel, text, label, wert, hinweis, typ, mehrzeilig, pruefen(w) → Fehlertext` → Text oder `null` |
| `UI.hinweisDialog` | statt `alert()` | `titel, text` |

### Icons
`UI.ikon(name)`: suche, glocke, daumen, stern, herz, schliessen, haken, plus, minus, pfeil-links/-rechts/-hoch/-runter,
winkel-runter/-rechts/-links, mehr, einstellungen, benutzer, personen, abmelden, hochladen, herunterladen, spielen, spiel,
pokal, info, warnung, fehler, erfolg, bearbeiten, loeschen, kopieren, extern, auge, schloss, filter, sortieren, kalender,
uhr, bild, sonne, mond, geraet, raster, liste, aktualisieren, nachricht, verlauf, ordner, datei, schild, test, start,
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
- Bausteine-Abnahme durch Seb steht noch aus (Testplan `tests/manuell/ui-bausteine.json`). Danach beginnt Phase 2.
