# Erzeugt das Design-System „Spielebibliothek Bausteine“ (Claude Design, https://claude.ai/artifact/44bcauRAN8ZCegDucpatkT) aus site/ui/.
# Aufruf: python3 -I scripts/design-system-erzeugen.py <leerer-ordner>  – danach den Ordner mit Claude (Artifact, root=<ordner>) veröffentlichen.
# Tokens, Bundle (= bausteine.js/.css) und Leitlinien kommen so immer aus dem Code; im Design-System nichts von Hand ändern, was hier entsteht.
import json, re, os, sys, datetime, shutil
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = sys.argv[1]
P = os.path.join(ZIEL, "project")
shutil.rmtree(ZIEL, ignore_errors=True)
os.makedirs(os.path.join(P, "components"), exist_ok=True)
lies = lambda p: open(os.path.join(REPO, p), encoding="utf-8").read()
tokens_css = lies("site/ui/tokens.css")

def block(anfang):
    i = tokens_css.index(anfang); return tokens_css[i:tokens_css.index("}", i)]
def werte(text):
    return dict(re.findall(r"--(b-[a-z0-9-]+):\s*([^;]+);", text))
hell = werte(block(':root, [data-thema="hell"] {'))
dunkel = werte(block('[data-thema="dunkel"] {'))
form = werte(block("/* ---------- Form, Schrift, Bewegung"))
akz = werte(block(":root {\n\t--b-akzent-h"))

NUTZUNG = {
 "b-grund": "Seitenhintergrund unter allem.", "b-flaeche": "Karten, Kacheln, Dialoge, Menüs, Eingabefelder.",
 "b-flaeche-2": "Leise Füllung: Segment-Hintergrund, Suchfeld, Hover, Standard-Knopf.", "b-flaeche-3": "Gedrückt, Hover auf Standard-Knopf, Schalter aus.",
 "b-text": "Text auf grund, flaeche, flaeche-2 und auf allen -zart-Flächen.", "b-text-leise": "Nebentexte, Hinweise, Tabellenkopf auf grund und flaeche (≥ 4,5:1).",
 "b-linie": "Trennlinien und Kartenränder, nur Deko.", "b-linie-feld": "Rand von Eingabefeld, Haken, Radio, Datei-Fläche (≥ 3:1 auf flaeche).",
 "b-akzent": "Hauptknopf, Links, Fokusring, gewählte Elemente. Spieler wählen die Farbe selbst (Presets).", "b-akzent-zart": "Hintergrund gewählter Einträge (Seitenleiste, Akzent-Marke).",
 "b-akzent-text": "Text und Icons auf b-akzent.", "b-erfolg": "Erfolgs-Icon und -Kennzahl auf flaeche.", "b-erfolg-zart": "Hintergrund von Erfolgs-Marke und -Hinweis.",
 "b-warnung": "Warn-Icon, Favoriten-Stern auf flaeche.", "b-warnung-zart": "Hintergrund von Warn-Marke und -Hinweis.",
 "b-gefahr": "Gefahr-Knopf, Fehlertext, Fehlerrahmen. Nur für Löschen, Sperren, Fehler.", "b-gefahr-zart": "Hintergrund von Gefahr-Marke und -Hinweis.",
 "b-gefahr-text": "Text auf b-gefahr.", "b-info": "Info-Icon auf flaeche.", "b-info-zart": "Hintergrund von Info-Marke und -Hinweis.",
 "b-kopf": "Kopfleiste mit Milchglas (mit backdrop-filter).", "b-abdunkeln": "Hintergrund hinter offenen Dialogen.",
 "b-meldung": "Meldung (Snackbar) unten in der Mitte.", "b-meldung-text": "Text auf b-meldung.", "b-schalter-knopf": "Der runde Knopf im Schalter, in beiden Themen weiß.",
}
for i in range(1, 7): NUTZUNG[f"b-avatar-{i}"] = f"Avatar-Farbe {i}, fest aus dem Namen berechnet; Initialen in b-flaeche."
for i in range(1, 5): NUTZUNG[f"b-bild-{i}"] = f"Kachelfläche {i} für Spiele ohne Vorschaubild; Icon in b-text."
farben = []
for name, wert in hell.items():
    if name.startswith("b-schatten"): continue
    w = wert.strip(); d = dunkel.get(name, w).strip()
    if w.startswith("var("):   # Akzent: Standard Blau
        w = akz[w[6:-1]]; d = akz[d[6:-1]]
    farben.append({"name": name, "value": {"light": w, "dark": d}, "usage": NUTZUNG.get(name, "")})
schatten = [{"name": n, "value": {"light": hell[n].strip(), "dark": dunkel[n].strip()},
             "usage": {"b-schatten-1": "Karten, Kacheln, Tabellen, Listen.", "b-schatten-2": "Menüs, Meldungen, Hover von Karten und Kacheln.", "b-schatten-3": "Dialoge."}[n]}
            for n in ("b-schatten-1", "b-schatten-2", "b-schatten-3")]
px = lambda v: v.split("/*")[0].strip()
tokens = {
 "name": "Spielebibliothek Bausteine", "version": 1, "meta": {"source": "Repo cuby0401/spielebibliothek, site/ui/tokens.css (gleiche Werte)"},
 "color": {"themes": [{"id": "light", "name": "Hell"}, {"id": "dark", "name": "Dunkel"}], "tokens": farben},
 "type": {"fonts": [], "families": {"system": "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", system-ui, sans-serif",
                                     "mono": "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace"},
  "groups": [{"name": "Text", "family": "system", "styles": [
   {"name": "seitentitel", "fontSize": "28px", "lineHeight": 1.2, "fontWeight": 700, "letterSpacing": "-0.025em", "sample": "Einstellungen", "usage": "Titel einer Seite (UI.seite)."},
   {"name": "kennzahl", "fontSize": "36px", "lineHeight": 1.1, "fontWeight": 650, "letterSpacing": "-0.02em", "sample": "14", "usage": "Großer Wert in UI.kennzahl."},
   {"name": "abschnitt", "fontSize": "20px", "lineHeight": 1.2, "fontWeight": 650, "letterSpacing": "-0.015em", "sample": "Weiterspielen", "usage": "Titel einer Startseiten-Reihe (UI.abschnitt)."},
   {"name": "kartentitel", "fontSize": "17px", "lineHeight": 1.2, "fontWeight": 650, "sample": "Aussehen", "usage": "Titel in Karte und Dialog."},
   {"name": "text", "fontSize": "15px", "lineHeight": 1.45, "fontWeight": 400, "sample": "Spielstände und Bestenlisten gehen bei Updates nicht verloren.", "usage": "Fließtext, Knöpfe, Felder."},
   {"name": "label", "fontSize": "13px", "lineHeight": 1.45, "fontWeight": 600, "sample": "Anzeigename", "usage": "Label über einem Feld, Tabellenkopf (dort leise)."},
   {"name": "hinweis", "fontSize": "13px", "lineHeight": 1.45, "fontWeight": 400, "sample": "So sehen dich die anderen in Bestenlisten.", "usage": "Hinweis unter Feldern, Untertitel, in b-text-leise."},
   {"name": "marke", "fontSize": "12px", "lineHeight": 1, "fontWeight": 600, "sample": "Aktualisiert", "usage": "Marken und Zähler."}]}]},
 "spacing": {"tokens": [{"name": f"b-abstand-{i}", "value": px(form[f"b-abstand-{i}"]), "usage": u} for i, u in
   [(1, "Innen in Marken, zwischen Label und Feld."), (2, "Zwischen Knöpfen, kleine Lücken."), (3, "Innen in Feldern (seitlich), Zeilen in Tabellen."), (4, "Abstand zwischen Feldern und Kacheln, Seitenrand am Handy."),
    (5, "Innenabstand von Karten."), (6, "Zwischen Seitenkopf und Inhalt."), (7, "Zwischen Bereichen einer Seite."), (8, "Große Leerräume, leerer Zustand.")]]
   + [{"name": "b-steuer", "value": px(form["b-steuer"]), "usage": "Höhe von Knöpfen und Feldern (Dichte „normal“, kompakt 34, luftig 46, Finger mind. 44)."},
      {"name": "b-steuer-s", "value": px(form["b-steuer-s"]), "usage": "Höhe kleiner Knöpfe."}, {"name": "b-ziel", "value": px(form["b-ziel"]), "usage": "Mindestgröße für Finger."},
      {"name": "b-kachel-min", "value": px(form["b-kachel-min"]), "usage": "Mindestbreite einer Spielkachel (klein 140, groß 240, am Handy 140/100/200)."}]},
 "radius": {"tokens": [{"name": "b-radius-s", "value": "8px", "usage": "Felder, Knöpfe."}, {"name": "b-radius-m", "value": "12px", "usage": "Menüs, Hinweise, Listen, Tabellen, Kachelbild."},
   {"name": "b-radius-l", "value": "18px", "usage": "Karten, Kacheln, Dialoge."}, {"name": "b-radius-voll", "value": "999px", "usage": "Pillen, Marken, Suche, Schalter, Avatare."}]},
 "shadow": {"tokens": schatten},
 "schriftgroesse": {"note": "Schriftgrößen als Variablen für bausteine.css.", "tokens": [{"name": n, "value": px(form[n]), "usage": ""} for n in
   ("b-groesse-xs", "b-groesse-s", "b-groesse-m", "b-groesse-l", "b-groesse-xl", "b-groesse-xxl", "b-groesse-gross")]},
 "gewicht": {"tokens": [{"name": n, "value": px(form[n]), "usage": ""} for n in ("b-gewicht", "b-gewicht-mittel", "b-gewicht-fett", "b-gewicht-titel")]
   + [{"name": "b-zeile", "value": "1.45", "usage": "Zeilenhöhe Fließtext."}, {"name": "b-zeile-eng", "value": "1.2", "usage": "Zeilenhöhe Überschriften."}]},
 "bewegung": {"tokens": [{"name": "b-dauer-kurz", "value": "120ms", "usage": "Farbwechsel, Hover."}, {"name": "b-dauer-mittel", "value": "200ms", "usage": "Schalter, Dialog, Meldung."},
   {"name": "b-kurve", "value": "cubic-bezier(0.2, 0.8, 0.2, 1)", "usage": "Für alle Übergänge."}]},
 "masse": {"tokens": [{"name": "b-linie-breite", "value": "1px", "usage": ""}, {"name": "b-fokus-breite", "value": "2px", "usage": "Fokusring in b-akzent, 2px Abstand."},
   {"name": "b-inhalt-max", "value": "none", "usage": "Inhaltsbreite: volle Fensterbreite (nur Fließtext bleibt schmal)."}, {"name": "b-rand", "value": "var(--b-abstand-4), ab 900 px var(--b-abstand-6)", "usage": "Abstand des Inhalts zum Fensterrand."}, {"name": "b-text-max", "value": "68ch", "usage": "Höchstbreite von Fließtext."},
   {"name": "b-ebene-kopf", "value": "50", "usage": ""}, {"name": "b-ebene-menue", "value": "60", "usage": ""}, {"name": "b-ebene-meldung", "value": "90", "usage": ""}]},
}
json.dump(tokens, open(os.path.join(P, "tokens.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# Bundle = die echten Dateien aus dem Repo
KOMPONENTEN = []  # wird unten gefüllt
bausteine_js = lies("site/ui/ikonen.js") + "\n" + lies("site/ui/bausteine.js")
assert "</script" not in bausteine_js and "<!--" not in bausteine_js
# Akzent-Paare, Dichte, Kachelgröße und Schrift aus tokens.css, die nicht in tokens.json passen; data-theme (Design-System) = data-thema (Zentrale)
akzent_css = tokens_css[tokens_css.index("/* ---------- Akzent-Paare"):tokens_css.index("/* ---------- Farben hell")]
akzent_css = akzent_css.replace('[data-thema="dunkel"]', '[data-theme="dark"]').replace(':root:not([data-thema="hell"])', ':root:not([data-theme="light"])').replace('[data-thema="hell"]', '[data-theme="light"]')
akzent_css = akzent_css.replace("@media (prefers-color-scheme: dark) {", "@media (prefers-color-scheme: dark) { /* nur wenn das Design-System kein Thema setzt */")
dichte_css = tokens_css[tokens_css.index('[data-dichte="kompakt"]'):]
bundle_css = ("/* Spielebibliothek Bausteine – bundle.css = site/ui/bausteine.css aus dem Repo, dazu Akzent-Presets, Dichte und Kachelgröße aus site/ui/tokens.css */\n"
  ":root { --b-schrift: -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", system-ui, sans-serif; --b-schrift-mono: ui-monospace, \"SF Mono\", Menlo, Consolas, monospace; }\n"
  "[data-theme=\"dark\"] { color-scheme: dark; }\n"
  + akzent_css + "\n" + dichte_css + "\n" + lies("site/ui/bausteine.css")
  + "\nbody { background: var(--b-grund); color: var(--b-text); font-family: var(--b-schrift); }\n")
assert "</style" not in bundle_css
open(os.path.join(P, "components", "bundle.css"), "w").write(bundle_css)

# ---------- Komponenten: Vorschau + Leitlinie ----------
K = []
def komp(name, gruppe, hoehe, zusammenfassung, leitlinie, js):
    K.append(name)
    d = os.path.join(P, "components", name); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "preview.html"), "w").write(
      f'<!-- @dsCard group="{gruppe}" height={hoehe} -->\n<div id="v" class="b-ui" style="padding:16px;display:grid;gap:16px;background:var(--b-grund);min-height:100%"></div>\n'
      f'<script>\n(function(){{ document.body.classList.add("b-ui"); const v = document.getElementById("v"); const {{ h }} = UI;\n{js}\n}})();\n</script>\n')
    open(os.path.join(d, "README.md"), "w").write(f"# {name}\n\n{zusammenfassung}\n\n{leitlinie.strip()}\n")

reihe = lambda *x: "UI.leiste([" + ",".join(x) + "])"
komp("Knopf", "Aktionen", 150, "Jede Aktion ist ein UI.knopf; höchstens ein primärer Knopf je Bereich.", """
- `UI.knopf({text, art, groesse, ikon, ikonRechts, nurIkon, label, zahl, href, laedt, deaktiviert, onclick})`
- **art:** `primaer` (die eine Hauptaktion), `standard` (alles Übrige), `leise` (in Leisten, neben Text), `gefahr` (endgültig löschen, sperren), `gefahr-leise` (zurücksetzen, abmelden).
- **groesse:** `s` in Tabellen und Karten-Köpfen, `m` normal, `l` nur für „Spielen“.
- Nur-Icon-Knöpfe brauchen `label` (wird vorgelesen und als Tooltip gezeigt).
- `.laden(true)` während eine Anfrage läuft – der Knopf bleibt gleich breit.
- Knöpfe am Ende eines Bereichs in `UI.knopfleiste([...])`: rechtsbündig, Hauptaktion ganz rechts.
- Nicht: zwei primäre Knöpfe nebeneinander; Gefahr-Farbe für harmlose Aktionen; Links, die wie Knöpfe aussehen, ohne `UI.knopf({href})`.
""", "v.append(" + reihe('UI.knopf({art:"primaer",text:"Speichern"})','UI.knopf({text:"Abbrechen"})','UI.knopf({art:"leise",text:"Mehr",ikonRechts:"winkel-runter"})','UI.knopf({art:"gefahr-leise",text:"Zurücksetzen"})','UI.knopf({art:"gefahr",text:"Löschen",ikon:"loeschen"})') + ", " +
   reihe('UI.knopf({art:"primaer",groesse:"s",text:"Klein"})','UI.knopf({art:"primaer",groesse:"l",text:"Spielen",ikon:"spielen"})','UI.knopf({art:"primaer",text:"Lädt",laedt:true})','UI.knopf({text:"Deaktiviert",deaktiviert:true})','UI.knopf({art:"leise",nurIkon:true,ikon:"glocke",label:"Benachrichtigungen",zahl:2})','UI.knopf({nurIkon:true,ikon:"mehr",label:"Mehr"})') + ");")
komp("Segment", "Aktionen", 140, "Segment-Wahl für 2–4 feste Möglichkeiten, die sofort wirken (Thema, Zeitraum).", """
- `UI.segment({label, optionen: [[wert, text, ikon?]], wert, onwechsel})`
- Für mehr als 4 Möglichkeiten `UI.auswahl`, für Möglichkeiten mit Erklärung `UI.radio`.
- Pfeiltasten wechseln die Wahl (role=radiogroup).
""", 'v.append(UI.segment({label:"Thema",optionen:UI.AUSSEHEN.thema,wert:"auto"}), UI.segment({label:"Zeitraum",optionen:[["woche","Woche"],["monat","Monat"],["immer","Immer"]],wert:"monat"}));')
komp("Farbwahl", "Aktionen", 110, "Runde Farbpunkte, mit denen Spieler ihre Akzentfarbe wählen.", """
- `UI.farbwahl({label, wert, onwechsel})` – Möglichkeiten aus `UI.AUSSEHEN.akzent` (Blau ist Standard).
- Jeder Punkt zeigt die Farbe im aktuellen Thema; der gewählte hat Haken und Ring.
""", 'v.append(UI.farbwahl({label:"Farbe",wert:"blau"}));')
komp("Feld", "Formular", 330, "Textfeld mit Label oben, Hinweis und Fehler darunter.", """
- `UI.feld({label, typ, wert, platzhalter, hinweis, fehler, pflicht, optional, max, nurLesen, oninput})` → `.wert`, `.fehlerSetzen(text)`
- Label ist immer sichtbar (kein Platzhalter als Label). Hinweis erklärt, wozu das Feld dient; Fehler sagen, was zu tun ist.
- Passwörter bekommen automatisch das Auge zum Zeigen.
- Mehrzeilig: `UI.textbereich`. Formulare immer in `UI.formular` (prüft Pflichtfelder, sperrt den Knopf beim Speichern).
""", 'v.append(UI.feld({label:"Anzeigename",wert:"Seb",hinweis:"So sehen dich die anderen in Bestenlisten."}), UI.feld({label:"E-Mail",typ:"email",platzhalter:"name@beispiel.de",optional:true}), UI.feld({label:"Handle",wert:"Seb!",fehler:"Nur Buchstaben, Ziffern, Punkt und Bindestrich."}), UI.feld({label:"Upload-Passwort",typ:"password",wert:"geheim123"}));')
komp("Auswahl", "Formular", 110, "Auswahlliste (nativ) für viele Möglichkeiten.", """
- `UI.auswahl({label, optionen: [[wert, text]], wert, hinweis, onchange})`
- Bleibt ein natives `<select>`, damit Handy und Tastatur ihre gewohnte Liste zeigen.
""", 'v.append(UI.auswahl({label:"Spiele sortieren",wert:"zuletzt",optionen:[["alphabetisch","Alphabetisch"],["zuletzt","Zuletzt gespielt"],["neu","Neueste zuerst"]],hinweis:"Favoriten stehen immer oben."}));')
komp("Schalter", "Formular", 140, "Schalter-Zeile für Einstellungen, die sofort gelten.", """
- `UI.schalter({label, hinweis, an, onwechsel})` – Text links, Schalter rechts (wie iOS).
- Gilt etwas erst nach „Speichern“, nimm `UI.haken`.
""", 'v.append(UI.schalter({label:"Spiel der Woche zeigen",hinweis:"Großes Bild oben auf der Startseite.",an:true}), UI.schalter({label:"Bestenliste neben dem Spiel",an:false}));')
komp("HakenRadio", "Formular", 220, "Haken (an/aus mit Speichern) und Radio-Gruppe (eine von mehreren, mit Erklärung).", """
- `UI.haken({label, hinweis, an, onwechsel})`
- `UI.radio({label, optionen: [[wert, text, hinweis?]], wert, onwechsel})`
""", 'v.append(UI.haken({label:"Als Testspiel markieren",hinweis:"Testspiele zählen nicht in der Statistik.",an:true}), UI.radio({label:"Art des Uploads",wert:"update",optionen:[["neu","Neues Spiel","Landet als Entwurf, nur du siehst es."],["update","Update eines Spiels","Spielstände bleiben erhalten."]]}));')
komp("Datei", "Formular", 170, "Fläche zum Hineinziehen oder Auswählen einer Datei.", """
- `UI.datei({label, hinweis, accept, mehrfach, ondatei})` – Prüfung von Größe und Typ macht der Aufrufer und zeigt Fehler mit `.fehlerSetzen`.
""", 'v.append(UI.datei({label:"Vorschaubild",hinweis:"PNG oder JPG, höchstens 2 MB.",accept:"image/*"}));')
komp("Suche", "Formular", 80, "Suchfeld mit Lupe; filtert beim Tippen, Esc leert.", """
- `UI.suche({platzhalter, wert, oninput, verzoegerung})` – `oninput` kommt 200 ms nach dem letzten Tastendruck.
""", 'v.append(UI.suche({platzhalter:"Spiele suchen"}), UI.suche({wert:"Dino"}));')
komp("Sortierliste", "Formular", 300, "Reihenfolge und Sichtbarkeit einstellen, mit Pfeilen statt nur Ziehen.", """
- `UI.sortierliste({label, eintraege: [{id, text, sichtbar}], onwechsel(liste)})` – für „Startseite anordnen“.
""", 'v.append(UI.sortierliste({label:"Startseite anordnen",eintraege:[{id:"weiterspielen",text:"Weiterspielen"},{id:"favoriten",text:"Favoriten"},{id:"neu",text:"Neu in der Bibliothek"},{id:"sdw",text:"Spiel der Woche",sichtbar:false},{id:"alle",text:"Alle Spiele"}]}));')
komp("Karte", "Inhalt", 300, "Abgeschlossener Block mit Titel, Inhalt und optional Aktionen.", """
- `UI.karte({titel, untertitel, aktionen, inhalt, fuss, onclick/href, flach, art:"gefahr"})`
- Eine Karte je Thema (Aussehen, Konto, Personendaten). Keine Karten in Karten; innen gliedern `UI.stapel` und `UI.angaben`.
- `art:"gefahr"` nur für die „Gefahrenzone“ (Konto löschen, Not-Aus).
""", 'v.append(UI.karte({titel:"Aussehen",untertitel:"Gilt sofort und auf allen deinen Geräten.",aktionen:[UI.knopf({art:"leise",groesse:"s",text:"Zurücksetzen"})],inhalt:[UI.segment({label:"Thema",optionen:UI.AUSSEHEN.thema,wert:"dunkel"}),UI.schalter({label:"Spiel der Woche zeigen",an:true})]}), UI.karte({titel:"Gefahrenzone",art:"gefahr",inhalt:UI.leiste([UI.text("Löscht dein Konto und alle Spielstände."),UI.knopf({art:"gefahr",text:"Konto löschen"})],{verteilt:true})}));')
komp("Spielkachel", "Inhalt", 300, "Ein Spiel als Kachel: Bild, Titel, Untertitel, Marken, Fortschritt, Favoriten-Stern.", """
- `UI.spielkachel({titel, untertitel, bild, farbe, ikon, marken, fortschritt, favorit, onfavorit, href/onclick})`
- Ohne Vorschaubild eine ruhige Farbfläche (b-bild-1…4) mit Icon. Titel einzeilig mit Auslassung.
- Mehrere Kacheln in `UI.raster` (Breite folgt der Kachelgröße des Spielers) oder `UI.reihe` (Startseite).
""", 'v.append(UI.raster([UI.spielkachel({titel:"Sternenfänger",untertitel:"Level 7 von 12",fortschritt:0.58,favorit:true,farbe:1,ikon:"stern"}),UI.spielkachel({titel:"Dino_Park",untertitel:"von Paul",favorit:false,farbe:3,marken:[{text:"Aktualisiert",art:"akzent"}]}),UI.spielkachel({titel:"Wortjagd",untertitel:"Tagesrätsel offen",farbe:2,ikon:"raster",favorit:false}),UI.spielkachel({titel:"Keks-Klicker",untertitel:"von Seb",farbe:4,marken:[{text:"Neu",art:"erfolg"}]})]));')
komp("Liste", "Inhalt", 260, "Liste aus Zeilen mit Icon oder Avatar, Text und rechtem Teil.", """
- `UI.liste([zeilen])`, `UI.zeile({ikon|avatar, titel, text, rechts, href|onclick, gefahr, ungelesen})`
- Klickbare Zeilen bekommen den Pfeil rechts. Für die Glocke, Konto-Menüpunkte, Personen.
""", 'v.append(UI.liste([{ikon:"benutzer",titel:"Profil",text:"Anzeigename, Handle, Geburtstag",href:"#"},{avatar:"Paul",titel:"Paul",text:"@paul · Entwickler",rechts:UI.marke({text:"Aktiv",punkt:true,art:"erfolg"})},{ikon:"spiel",titel:"Dino_Park 1.2.0 ist da",text:"vor 2 Stunden",ungelesen:true,onclick(){}},{ikon:"loeschen",titel:"Konto löschen",gefahr:true,onclick(){}}]));')
komp("Tabelle", "Inhalt", 260, "Daten in Spalten, sortierbar, mit Leer-Zustand.", """
- `UI.tabelle({spalten: [{titel, feld|wert, sortierbar, rechts, mono, leise}], zeilen, leer, onzeile})`
- Zahlen rechtsbündig (`rechts`), IDs `mono`. Klickbare Zeilen mit `onzeile` (auch per Enter).
""", 'v.append(UI.tabelle({spalten:[{titel:"Person",wert:z=>UI.leiste([UI.avatar({name:z.n,groesse:"s"}),h("span",{text:z.n})]),sortierbar:true,sortWert:z=>z.n},{titel:"Status",wert:z=>UI.marke({text:z.s,punkt:true,art:z.a})},{titel:"Spielzeit",feld:"t",rechts:true}],zeilen:[{n:"Seb",s:"Aktiv",a:"erfolg",t:"12 h 5 min"},{n:"Paul",s:"Aktiv",a:"erfolg",t:"3 h 40 min"},{n:"Emil",s:"Verwarnt",a:"warnung",t:"48 min"}],onzeile(){}}));')
komp("Kennzahl", "Inhalt", 150, "Eine wichtige Zahl mit Beschriftung (Admin-Übersicht).", """
- `UI.kennzahl({wert, label, hinweis, art, onclick, kompakt})` – in `UI.raster([...], {art:"kennzahlen"})`; `kompakt` ohne eigene Fläche zum Einbetten in eine Karte, mehrere in `UI.leiste`.
- Nur Zahlen, die etwas bedeuten; `art:"warnung"` wenn etwas zu tun ist.
""", 'v.append(UI.raster([UI.kennzahl({wert:14,label:"Personen",onclick(){}}),UI.kennzahl({wert:9,label:"Spiele"}),UI.kennzahl({wert:2,label:"Offene Anfragen",art:"warnung"}),UI.kennzahl({wert:"71 %",label:"Speicher belegt",hinweis:"2,1 GB von 3 GB"})],{art:"kennzahlen"}));')
komp("Fortschritt", "Inhalt", 110, "Fortschrittsbalken für Spielstand und Speicher.", """
- `UI.fortschritt({wert, max, label, art, zeigeText})` – `art:"gefahr"` ab 90 % Speicher.
""", 'v.append(UI.fortschritt({wert:58,label:"Level",zeigeText:true}), UI.fortschritt({wert:94,art:"gefahr",label:"Speicher",zeigeText:"94 %"}));')
komp("Marke", "Inhalt", 150, "Kleine Marke für Status, Kategorie und Filter.", """
- `UI.marke({text, art, punkt, ikon, onclick + an, onentfernen})`
- Status immer mit Punkt **und** Wort (Farbe nie allein). Filter-Chips mit `onclick` und `an`.
""", 'v.append(UI.leiste(["neutral","akzent","erfolg","warnung","gefahr","info"].map(a=>UI.marke({text:a,art:a}))), UI.leiste([["Aktiv","erfolg"],["Eingeladen","neutral"],["Verwarnt","warnung"],["Gesperrt","gefahr"]].map(([t,a])=>UI.marke({text:t,art:a,punkt:true}))), UI.leiste([UI.marke({text:"Action",onclick(){},an:true}),UI.marke({text:"Rätsel",onclick(){},an:false}),UI.marke({text:"Filter: Neu",onentfernen(){}})]));')
komp("Avatar", "Inhalt", 110, "Avatar mit Initialen; die Farbe folgt fest aus dem Namen.", """
- `UI.avatar({name, bild, groesse: s|m|l|xl})`
""", 'v.append(UI.leiste(["Seb","Paul","Emil","Eli","Moritz Bauer","Anna"].map((n,i)=>UI.avatar({name:n,groesse:["s","m","l","xl","m","m"][i]}))));')
komp("Reiter", "Navigation", 90, "Reiter für die Bereiche einer Seite (Admin, Tester-Panel).", """
- `UI.reiter({eintraege: [{id, text, zahl}], aktiv, onwechsel})` – Pfeiltasten, Pos1/Ende.
""", 'v.append(UI.reiter({aktiv:"uebersicht",eintraege:[{id:"uebersicht",text:"Übersicht"},{id:"spiele",text:"Spiele"},{id:"personen",text:"Personen",zahl:3},{id:"protokoll",text:"Protokoll"},{id:"aufgaben",text:"Aufgaben"}]}));')
komp("Seitenleiste", "Navigation", 300, "Bereichsnavigation links (Konto, Admin); am Handy eine waagerechte Leiste.", """
- `UI.seitenleiste({gruppen: [{titel, eintraege: [{id, text, ikon, href, zahl}]}], aktiv, onwechsel})`, zusammen mit `UI.bereich({leiste, inhalt})`.
""", 'v.append(UI.seitenleiste({aktiv:"einstellungen",gruppen:[{titel:"Konto",eintraege:[{id:"profil",text:"Profil",ikon:"benutzer"},{id:"spiele",text:"Meine Spiele",ikon:"spiel"},{id:"anfragen",text:"Anfragen",ikon:"nachricht",zahl:2},{id:"einstellungen",text:"Einstellungen",ikon:"einstellungen"},{id:"sicherheit",text:"Sicherheit",ikon:"schloss"}]}]}));')
komp("Kopfleiste", "Navigation", 120, "Leiste oben mit Marke, Suche und Konto; klebt und ist leicht durchsichtig.", """
- `UI.kopfleiste({marke, mitte, rechts})` – rechts Glocke und Konto als `UI.menue`.
""", 'const g=UI.knopf({art:"leise",nurIkon:true,ikon:"glocke",label:"Benachrichtigungen",zahl:2}); const k=UI.knopf({art:"leise",nurIkon:true,label:"Konto"}); k.append(UI.avatar({name:"Sebastian Erben"})); v.style.padding="0"; v.append(UI.kopfleiste({mitte:UI.suche({platzhalter:"Spiele suchen"}),rechts:[g,k]}));')
komp("Menue", "Navigation", 330, "Popover-Menü am Knopf (Konto, Glocke); Esc, Klick daneben und Pfeiltasten.", """
- `UI.menue({ausloeser, eintraege: [{text, ikon, onclick|href, gefahr, rechts} | "trenner" | {titel}]})` oder `inhalt` für freie Inhalte (Glocke).
- Am Handy kommt es unten als Blatt herein.
""", 'const k=UI.knopf({text:"Konto",ikonRechts:"winkel-runter"}); const m=UI.menue({ausloeser:k,ausrichtung:"links",eintraege:[{titel:"Angemeldet als @cuby0401"},{text:"Profil",ikon:"benutzer"},{text:"Einstellungen",ikon:"einstellungen"},"trenner",{text:"Abmelden",ikon:"abmelden",gefahr:true}]}); v.append(m); setTimeout(()=>m.menue.oeffnen(),50);')
komp("Abschnitt", "Navigation", 330, "Bereich mit Titel und „Alle anzeigen“ – die Reihen der Startseite.", """
- `UI.abschnitt({titel, untertitel, alle:{text, href}, aktionen, inhalt, einklappbar})`, Inhalt meist `UI.reihe([...kacheln])`.
""", 'v.append(UI.abschnitt({titel:"Weiterspielen",alle:{text:"Alle anzeigen",href:"#"},inhalt:UI.reihe([UI.spielkachel({titel:"Sternenfänger",untertitel:"Level 7 von 12",fortschritt:.58,farbe:1,ikon:"stern"}),UI.spielkachel({titel:"Dino_Park",untertitel:"von Paul",fortschritt:.24,farbe:3}),UI.spielkachel({titel:"Wortjagd",untertitel:"Tagesrätsel offen",farbe:2,ikon:"raster"}),UI.spielkachel({titel:"Turmbau",untertitel:"von Emil",farbe:4})])}));')
komp("Meldung", "Rückmeldung", 200, "Kurze Rückmeldung unten in der Mitte, auf Wunsch mit „Rückgängig“.", """
- `UI.meldung(text, {art: info|erfolg|fehler, aktion:{text, onclick}, dauer})`
- Erfolge verschwinden nach 5 s, Fehler bleiben, bis man sie schließt. Ersetzt alle alten Pop-ups.
- Text sagt, was passiert ist („Gespeichert.“), Fehler sagen, was zu tun ist.
""", 'v.append(UI.leiste([UI.knopf({text:"Erfolg",onclick:()=>UI.meldung("Gespeichert.",{art:"erfolg",aktion:{text:"Rückgängig",onclick(){}}})}),UI.knopf({text:"Fehler",onclick:()=>UI.meldung("Speichern hat nicht geklappt. Bitte gleich noch einmal versuchen.",{art:"fehler"})})])); UI.meldung("Gespeichert.",{art:"erfolg",dauer:0,aktion:{text:"Rückgängig",onclick(){}}}); UI.meldung("Der Server antwortet nicht. Bitte gleich noch einmal versuchen.",{art:"fehler"});')
komp("Hinweis", "Rückmeldung", 330, "Banner im Seitenfluss für Info, Erfolg, Warnung und Gefahr.", """
- `UI.hinweis({art, titel, text, aktion, schliessbar})` – immer mit Icon; Gefahr nur, wenn wirklich etwas kaputt oder gesperrt ist.
""", 'v.append(UI.hinweis({art:"info",titel:"Neue Version",text:"Zentrale 1.5.0 bringt Handles und das komplette CRM."}),UI.hinweis({art:"erfolg",text:"Alle 21 Tests bestanden."}),UI.hinweis({art:"warnung",titel:"Speicher fast voll",text:"Emil hat 94 % belegt.",aktion:{text:"Ansehen"}}),UI.hinweis({art:"gefahr",titel:"Not-Aus aktiv",text:"Alle Daten sind gesperrt.",schliessbar:true}));')
komp("Leer", "Rückmeldung", 260, "Leerer Zustand: sagt, was hier erscheinen wird und wie man anfängt.", """
- `UI.leer({ikon, titel, text, aktion})` – nie eine leere Fläche ohne Erklärung.
""", 'v.append(UI.leer({ikon:"stern",titel:"Noch keine Favoriten",text:"Tippe bei einem Spiel auf den Stern, dann erscheint es hier.",aktion:{text:"Spiele entdecken"}}));')
komp("Laden", "Rückmeldung", 220, "Laden als Skelett in Form des Inhalts oder als kleiner Kreisel.", """
- `UI.laden({art: kreisel|skelett, zeilen, form:"kacheln"})` – Skelette für Listen und Kacheln, Kreisel nur für Kurzes.
""", 'v.append(UI.laden({}), UI.laden({art:"skelett",zeilen:3}));')
komp("Dialog", "Rückmeldung", 360, "Dialoge statt Browser-Pop-ups: bestätigen, eingeben, Hinweis.", """
- `await UI.bestaetigen({titel, text, ja, gefahr})` → true/false; bei `gefahr` steht der Fokus auf „Abbrechen“.
- `await UI.eingabe({titel, label, wert, pruefen})` → Text oder null. `UI.hinweisDialog({titel, text})`.
- Eigene Dialoge: `UI.dialog({titel, inhalt, aktionen})`. Am Handy kommen sie unten als Blatt.
""", 'v.append(UI.leiste([UI.knopf({text:"Bestätigen",onclick:()=>UI.bestaetigen({titel:"Person löschen?",text:"Paul und alle seine Spielstände werden endgültig gelöscht.",ja:"Endgültig löschen",gefahr:true})}),UI.knopf({text:"Eingabe",onclick:()=>UI.eingabe({titel:"Grund für die Verwarnung",label:"Grund"})})])); setTimeout(()=>UI.bestaetigen({titel:"Person löschen?",text:"Paul und alle seine Spielstände werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.",ja:"Endgültig löschen",gefahr:true}),50);')

header = "/* @ds-bundle: " + json.dumps({"format": 4, "namespace": "UI", "components": [{"name": n} for n in K]}) + " */\n"
open(os.path.join(P, "components", "bundle.js"), "w").write(header + "/* = site/ui/ikonen.js + site/ui/bausteine.js aus dem Repo cuby0401/spielebibliothek */\n" + bausteine_js)

# Cover
os.makedirs(os.path.join(P, "components", "Cover"), exist_ok=True)
open(os.path.join(P, "components", "Cover", "preview.html"), "w").write('''<!-- @dsCard height=300 -->
<div class="deckel">
<svg viewBox="0 0 960 300" width="960" height="300" aria-hidden="true">
<!-- Blöcke: b-akzent 240×176 (radius-l), b-bild-1 160×176, b-bild-3 160×104, b-bild-2 104×104, b-text 96×56 (radius-voll halbe Höhe)
     Anordnung: modulares Kachelraster rechts ab x=480, wie das Spielraster der Bibliothek, eine Kachel doppelt breit
     Muster: geometrische Kacheln mit den Radius-Tokens – die Bibliothek ist ein Raster aus runden Kacheln (Spielkacheln, Karten)
     Schritte: Lücke b-abstand-4 (16), Ecken b-radius-l (18) und b-radius-m (12), Pille halbe Höhe -->
<rect class="a" x="488" y="24" width="240" height="176" rx="18"/>
<rect class="b1" x="744" y="24" width="192" height="176" rx="18"/>
<rect class="b3" x="488" y="216" width="160" height="60" rx="12"/>
<rect class="b2" x="664" y="216" width="104" height="60" rx="12"/>
<rect class="t" x="784" y="216" width="152" height="60" rx="30"/>
<circle class="punkt" cx="608" cy="112" r="28"/>
</svg>
<div class="name"><b>Spielebibliothek</b><span>Bausteine für eine ruhige, klare Oberfläche.</span></div>
</div>
<style>
.deckel{position:relative;width:960px;height:300px;background:var(--b-grund)}
svg{position:absolute;inset:0}
.a{fill:var(--b-akzent)} .b1{fill:var(--b-bild-1)} .b2{fill:var(--b-bild-2)} .b3{fill:var(--b-bild-3)} .t{fill:var(--b-text)} .punkt{fill:var(--b-akzent-text)}
.name{position:absolute;left:40px;bottom:36px;max-width:420px;display:grid;gap:8px;font-family:var(--b-schrift)}
.name b{font-size:64px;line-height:.95;letter-spacing:-0.035em;color:var(--b-text);font-weight:700}
.name span{font-size:14px;color:var(--b-text-leise)}
</style>
''')

readme = lies("docs/ui-bausteine.md")
kopf = """Bausteine der Spielebibliothek, der Bibliothek für Browser-Spiele von Freunden und Kollegen auf Sebs NAS. Richtung „Klar“: ruhig, viel Luft, Systemschrift, eine Akzentfarbe (Standard Blau, Spieler wählen selbst), hell und dunkel.

## Grundsätze

- **Nie erschlagen:** Eine Hauptaktion je Bereich (`UI.knopf({art:"primaer"})`), alles andere `standard` oder `leise`. Lieber weniger auf einer Seite und „Alle anzeigen“.
- **Farbe sparsam:** `b-akzent` nur für die Hauptaktion, Links, Fokus und Gewähltes. Statusfarben (`b-erfolg`, `b-warnung`, `b-gefahr`, `b-info`) nur für Status, immer mit Wort oder Icon dazu. Flächen `b-grund` → `b-flaeche` → `b-flaeche-2`.
- **Schrift:** Systemschrift (SF auf Apple-Geräten). Seitentitel `seitentitel`, Bereiche `abschnitt`, Karten `kartentitel`, Fließtext `text`, Labels `label`, Nebentext `hinweis` in `b-text-leise`.
- **Form:** Felder und Knöpfe `b-radius-s`, Menüs und Hinweise `b-radius-m`, Karten, Kacheln und Dialoge `b-radius-l`, Pillen `b-radius-voll`. Karten haben `b-schatten-1`, keine Ränder; Menüs `b-schatten-2`, Dialoge `b-schatten-3`.
- **Abstände:** nur `b-abstand-1…8`. Spieler wählen die Dichte (kompakt/normal/luftig), alle Abstände skalieren mit.
- **Zugänglich:** Text mindestens 4,5:1, Feldränder und Icons 3:1 in jedem Thema und mit jedem Akzent. Fokusring 2px `b-akzent`. Finger-Ziele mindestens 44px.
- **Sprache:** Deutsch, du, kurz und direkt. Knöpfe sagen, was passiert („Speichern“, „Endgültig löschen“), Meldungen bestätigen („Gespeichert.“), Fehler sagen, was zu tun ist. Keine Emojis in Bausteinen, Icons aus `UI.ikon`.

"""
open(os.path.join(P, "README.md"), "w").write(kopf + readme.split("\n", 2)[2])
jetzt = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
index = {"v": 3, "layout": "files", "createdOnFiles": {"v": 1, "at": jetzt}, "title": "Spielebibliothek Bausteine", "namespace": "UI",
         "libraries": [], "sections": {}, "groups": [], "assetGroups": {}, "blobs": {}, "docs": {"readme": "project/README.md", "sections": []},
         "lastChange": {"by": "Seb", "at": jetzt, "via": "Claude Code", "note": "Erster Stand aus site/ui/ (Richtung Klar, Akzent Blau)"}}
json.dump(index, open(os.path.join(P, "design-system.json"), "w"), ensure_ascii=False, indent=1)
print(len(K), "Komponenten")
for r, _, fs in os.walk(P):
    for f in fs: print(os.path.relpath(os.path.join(r, f), ZIEL))
