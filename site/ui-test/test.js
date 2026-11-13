// Testseite: jeder Baustein in seinen Zuständen, mit Beispieldaten. Keine Navigation, keine echten Daten.
"use strict";
(function () {
	const { h } = UI;
	const fehlerListe = [];
	window.addEventListener("error", (e) => fehlerListe.push(String(e.message)));
	window.uiTestFehler = fehlerListe;

	const block = (titel, ...inhalt) => UI.karte({ titel, inhalt: UI.stapel(inhalt), id: "t-" + titel.toLowerCase().replace(/[^a-z0-9]+/g, "-") });

	const aussehen = { thema: "auto", akzent: "blau", dichte: "normal", kachelgroesse: "mittel" };
	const anwenden = (k, w) => { aussehen[k] = w; UI.aussehenAnwenden(aussehen); };
	const steuerung = UI.leiste([
		UI.segment({ id: "t-thema", label: "Thema", optionen: UI.AUSSEHEN.thema, wert: "auto", onwechsel: (w) => anwenden("thema", w) }),
		UI.farbwahl({ id: "t-akzent", label: "Akzent", wert: "blau", onwechsel: (w) => anwenden("akzent", w) }),
		UI.segment({ id: "t-dichte", label: "Dichte", optionen: UI.AUSSEHEN.dichte, wert: "normal", onwechsel: (w) => anwenden("dichte", w) }),
		UI.segment({ id: "t-kachel", label: "Kachelgröße", optionen: UI.AUSSEHEN.kachelgroesse, wert: "mittel", onwechsel: (w) => anwenden("kachelgroesse", w) }),
	]);

	const glocke = UI.knopf({ art: "leise", nurIkon: true, ikon: "glocke", label: "Benachrichtigungen", zahl: 2, id: "t-glocke" });
	const glockeMenue = UI.menue({ ausloeser: glocke, label: "Benachrichtigungen", breit: true, id: "t-glocke-menue",
		inhalt: UI.stapel([UI.liste([
			{ ikon: "spiel", titel: "Dino_Park 1.2.0 ist da", text: "vor 2 Stunden", ungelesen: true, onclick: () => {} },
			{ ikon: "nachricht", titel: "Paul hat auf deine Anfrage geantwortet", text: "gestern", onclick: () => {} },
		], { ohneRahmen: true })], { abstand: "s" }) });
	const benutzer = UI.knopf({ art: "leise", nurIkon: true, label: "Konto", id: "t-konto" });
	benutzer.append(UI.avatar({ name: "Sebastian Erben" }));
	const kontoMenue = UI.menue({ ausloeser: benutzer, label: "Konto", id: "t-konto-menue", eintraege: [
		{ titel: "Angemeldet als @cuby0401" }, { text: "Profil", ikon: "benutzer" }, { text: "Einstellungen", ikon: "einstellungen" }, "trenner",
		{ text: "Admin-Panel", ikon: "schild", rechts: "↗" }, { text: "Abmelden", ikon: "abmelden", gefahr: true }] });
	const kopf = UI.kopfleiste({ mitte: UI.suche({ platzhalter: "Spiele suchen", id: "t-suche-kopf" }), rechts: [glockeMenue, kontoMenue] });

	const kacheln = () => [
		UI.spielkachel({ titel: "Sternenfänger", untertitel: "Level 7 von 12", fortschritt: 0.58, favorit: true, farbe: 1, ikon: "stern", onclick: () => UI.meldung("Sternenfänger öffnen") }),
		UI.spielkachel({ titel: "Dino_Park", untertitel: "von Paul", fortschritt: 0.24, favorit: false, farbe: 3, marken: [{ text: "Aktualisiert", art: "akzent" }], onclick: () => {} }),
		UI.spielkachel({ titel: "Wortjagd mit einem sehr langen Titel, der abgeschnitten wird", untertitel: "Tagesrätsel offen", favorit: false, farbe: 2, ikon: "raster", onclick: () => {} }),
		UI.spielkachel({ titel: "Keks-Klicker", untertitel: "von Seb", marken: [{ text: "Neu", art: "erfolg" }], farbe: 4, onclick: () => {} }),
		UI.spielkachel({ titel: "Turmbau", untertitel: "von Emil", favorit: false, onclick: () => {} }),
	];
	const k1 = kacheln(), k2 = kacheln();

	const tabelle = UI.tabelle({ id: "t-tabelle", titel: "Personen", schluessel: "handle", onzeile: (z) => UI.meldung("Person " + z.name),
		spalten: [
			{ titel: "Person", wert: (z) => UI.leiste([UI.avatar({ name: z.name, groesse: "s" }), h("span", { text: z.name })]), sortWert: (z) => z.name, sortierbar: true },
			{ titel: "Rolle", wert: (z) => UI.marke({ text: z.rolle, art: z.rolle === "Admin" ? "akzent" : "neutral" }) },
			{ titel: "Status", wert: (z) => UI.marke({ text: z.status, punkt: true, art: { Aktiv: "erfolg", Verwarnt: "warnung", Gesperrt: "gefahr" }[z.status] || "neutral" }), sortWert: (z) => z.status, sortierbar: true },
			{ titel: "Spielzeit", feld: "zeit", rechts: true, sortierbar: true, sortWert: (z) => z.min },
		],
		zeilen: [
			{ handle: "cuby0401", name: "Seb", rolle: "Admin", status: "Aktiv", zeit: "12 h 5 min", min: 725 },
			{ handle: "paul", name: "Paul", rolle: "Entwickler", status: "Aktiv", zeit: "3 h 40 min", min: 220 },
			{ handle: "emil", name: "Emil", rolle: "Tester", status: "Verwarnt", zeit: "48 min", min: 48 },
			{ handle: "eli", name: "Eli", rolle: "Spieler", status: "Eingeladen", zeit: "–", min: 0 },
		] });

	const formular = UI.formular({ id: "t-formular", absenden: "Speichern", onabsenden: async () => { await new Promise((r) => setTimeout(r, 600)); UI.meldung("Gespeichert.", { art: "erfolg", aktion: { text: "Rückgängig", onclick: () => UI.meldung("Rückgängig gemacht.") } }); },
		aktionen: [UI.knopf({ text: "Abbrechen" })],
		inhalt: [
			UI.feld({ id: "t-name", label: "Anzeigename", wert: "Seb", hinweis: "So sehen dich die anderen in Bestenlisten.", pflicht: true, max: 30 }),
			UI.feld({ id: "t-mail", label: "E-Mail", typ: "email", platzhalter: "name@beispiel.de", optional: true }),
			UI.feld({ id: "t-passwort", label: "Upload-Passwort", typ: "password", wert: "geheim123" }),
			UI.feld({ id: "t-fehler", label: "Handle", wert: "Seb!", fehler: "Nur Buchstaben, Ziffern, Punkt und Bindestrich." }),
			UI.feld({ id: "t-aus", label: "Konto-ID", wert: "8f3c…a91", nurLesen: true }),
			UI.auswahl({ id: "t-sort", label: "Sortierung", wert: "zuletzt", optionen: [["alphabetisch", "Alphabetisch"], ["zuletzt", "Zuletzt gespielt"], ["neu", "Neueste zuerst"], ["meistgespielt", "Meistgespielt"]] }),
			UI.textbereich({ id: "t-text", label: "Beschreibung", platzhalter: "Worum geht es in deinem Spiel?", hinweis: "Höchstens 500 Zeichen.", max: 500 }),
			UI.schalter({ id: "t-schalter", label: "Spiel der Woche zeigen", hinweis: "Großes Bild oben auf der Startseite.", an: true }),
			UI.schalter({ id: "t-schalter2", label: "Bestenliste neben dem Spiel", an: false }),
			UI.haken({ id: "t-haken", label: "Als Testspiel markieren", hinweis: "Testspiele zählen nicht in der Statistik.", an: true }),
			UI.radio({ name: "t-art", label: "Art des Uploads", wert: "update", optionen: [["neu", "Neues Spiel", "Landet als Entwurf, nur du siehst es."], ["update", "Update eines Spiels", "Spielstände bleiben erhalten."]] }),
			UI.datei({ id: "t-datei", label: "Vorschaubild", hinweis: "PNG oder JPG, höchstens 2 MB.", accept: "image/png,image/jpeg", ondatei: (d) => UI.meldung(d[0].name + " gewählt") }),
		] });

	const knoepfe = UI.stapel([
		UI.leiste([UI.knopf({ art: "primaer", text: "Speichern", id: "t-k-primaer" }), UI.knopf({ text: "Abbrechen" }), UI.knopf({ art: "leise", text: "Mehr anzeigen", ikonRechts: "winkel-runter" }),
			UI.knopf({ art: "gefahr-leise", text: "Zurücksetzen" }), UI.knopf({ art: "gefahr", text: "Endgültig löschen", ikon: "loeschen" })]),
		UI.leiste([UI.knopf({ art: "primaer", groesse: "s", text: "Klein" }), UI.knopf({ art: "primaer", groesse: "l", text: "Spielen", ikon: "spielen" }),
			UI.knopf({ art: "primaer", text: "Lädt", laedt: true }), UI.knopf({ text: "Deaktiviert", deaktiviert: true }),
			UI.knopf({ art: "leise", nurIkon: true, ikon: "einstellungen", label: "Einstellungen" }), UI.knopf({ nurIkon: true, ikon: "mehr", label: "Mehr" })]),
	], { abstand: "s" });

	const dialoge = UI.leiste([
		UI.knopf({ id: "t-bestaetigen", text: "Bestätigen-Dialog", onclick: async () => { const ja = await UI.bestaetigen({ titel: "Person löschen?", text: "Paul und alle seine Spielstände werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.", ja: "Endgültig löschen", gefahr: true }); window.uiTestErgebnis = ja; UI.meldung(ja ? "Gelöscht." : "Abgebrochen."); } }),
		UI.knopf({ id: "t-eingabe", text: "Eingabe-Dialog", onclick: async () => { const w = await UI.eingabe({ titel: "Grund für die Verwarnung", label: "Grund", hinweis: "Die Person sieht diesen Text.", ja: "Verwarnen", pruefen: (w) => w.length < 5 ? "Bitte etwas genauer (mindestens 5 Zeichen)." : "" }); window.uiTestErgebnis = w; if (w) UI.meldung("Verwarnt: " + w); } }),
		UI.knopf({ id: "t-hinweisdialog", text: "Hinweis-Dialog", onclick: () => UI.hinweisDialog({ titel: "Version 1.5.0", text: "Neu: Handles, komplettes CRM und Sicherheitsprotokoll." }) }),
		UI.knopf({ id: "t-meldung", text: "Meldung", onclick: () => UI.meldung("Gespeichert.", { art: "erfolg" }) }),
		UI.knopf({ id: "t-meldung-fehler", text: "Fehlermeldung", onclick: () => UI.meldung("Speichern hat nicht geklappt: Der Server antwortet nicht. Bitte gleich noch einmal versuchen.", { art: "fehler" }) }),
	]);

	const reiter = UI.reiter({ id: "t-reiter", label: "Admin-Bereiche", aktiv: "uebersicht", onwechsel: (id) => { document.getElementById("t-reiter-ziel").textContent = "Gewählt: " + id; },
		eintraege: [{ id: "uebersicht", text: "Übersicht" }, { id: "spiele", text: "Spiele" }, { id: "personen", text: "Personen", zahl: 3 }, { id: "protokoll", text: "Protokoll" }, { id: "aufgaben", text: "Aufgaben" }] });

	const startseite = UI.sortierliste({ label: "Startseite anordnen", hinweis: "Haken weg blendet einen Bereich aus.", onwechsel: (l) => { window.uiTestStartseite = l; },
		eintraege: [{ id: "weiterspielen", text: "Weiterspielen" }, { id: "favoriten", text: "Favoriten" }, { id: "neu", text: "Neu in der Bibliothek" }, { id: "spiel-der-woche", text: "Spiel der Woche", sichtbar: false }, { id: "alle", text: "Alle Spiele" }] });

	document.getElementById("test").append(
		kopf,
		UI.seite({ titel: "Bausteine", untertitel: "Testseite für die automatischen Tests. Jeder Baustein in seinen Zuständen, mit Beispieldaten.",
			zurueck: { text: "Bibliothek", href: "/" }, aktionen: [UI.knopf({ art: "primaer", text: "Spiel hochladen", ikon: "hochladen" })],
			inhalt: [
				UI.karte({ titel: "Aussehen", untertitel: "Wirkt sofort auf die ganze Seite.", inhalt: steuerung, id: "t-aussehen" }),
				UI.abschnitt({ titel: "Weiterspielen", alle: { text: "Alle anzeigen", href: "#" }, inhalt: UI.reihe(k1.slice(0, 4)), id: "t-weiterspielen" }),
				UI.abschnitt({ titel: "Alle Spiele", untertitel: "5 Spiele", einklappbar: true, inhalt: UI.raster(k2), id: "t-alle" }),
				block("Knöpfe", knoepfe),
				block("Formular", formular),
				block("Dialoge und Meldungen", dialoge),
				block("Reiter", reiter, UI.text("Gewählt: uebersicht", { art: "leise", id: "t-reiter-ziel" }), UI.segment({ label: "Segment", optionen: [["woche", "Woche"], ["monat", "Monat"], ["immer", "Immer"]], wert: "monat" })),
				block("Tabelle", tabelle, UI.tabelle({ spalten: [{ titel: "Spiel" }, { titel: "Fehler" }], zeilen: [], leer: "Keine Fehlerberichte. Gut so." })),
				block("Liste", UI.liste([
					{ ikon: "benutzer", titel: "Profil", text: "Anzeigename, Handle, Geburtstag", href: "#" },
					{ ikon: "einstellungen", titel: "Einstellungen", text: "Aussehen, Startseite, Sortierung", href: "#" },
					{ avatar: "Paul", titel: "Paul", text: "@paul · Entwickler", rechts: UI.marke({ text: "Aktiv", punkt: true, art: "erfolg" }) },
					{ ikon: "loeschen", titel: "Konto löschen", gefahr: true, onclick: () => {} },
				])),
				block("Kennzahlen", UI.raster([UI.kennzahl({ wert: 14, label: "Personen", onclick: () => {} }), UI.kennzahl({ wert: 9, label: "Spiele" }),
					UI.kennzahl({ wert: "2", label: "Offene Anfragen", art: "warnung", onclick: () => {} }), UI.kennzahl({ wert: "0", label: "Fehler heute", art: "erfolg" }),
					UI.kennzahl({ wert: "71 %", label: "Speicher belegt", hinweis: "2,1 GB von 3 GB" })], { art: "kennzahlen" }),
				block("Kennzahlen kompakt (in einer Karte)", UI.karte({ inhalt: UI.leiste([UI.kennzahl({ kompakt: true, wert: "1 h 41 min", label: "Spielzeit" }),
					UI.kennzahl({ kompakt: true, wert: 10, label: "gespielt", hinweis: "Spiele, egal von wem" }), UI.kennzahl({ kompakt: true, wert: 26, label: "Erfolge" })]) })),
					UI.fortschritt({ wert: 71, label: "Speicher", zeigeText: true }), UI.fortschritt({ wert: 94, art: "gefahr", label: "Speicher Emil", zeigeText: "94 %" })),
				block("Marken und Avatare", UI.leiste(["neutral", "akzent", "erfolg", "warnung", "gefahr", "info"].map((art) => UI.marke({ text: art, art }))),
					UI.leiste(["Aktiv", "Eingeladen", "Verwarnt", "Gesperrt"].map((t, i) => UI.marke({ text: t, punkt: true, art: ["erfolg", "neutral", "warnung", "gefahr"][i] }))),
					UI.leiste([UI.marke({ text: "Action", onclick: () => {}, an: true }), UI.marke({ text: "Rätsel", onclick: () => {}, an: false }), UI.marke({ text: "Filter: Neu", onentfernen: () => {} })]),
					UI.leiste(["Seb", "Paul", "Emil", "Eli", "Moritz Bauer", "Anna"].map((n, i) => UI.avatar({ name: n, groesse: ["s", "m", "l", "xl", "m", "m"][i] })))),
				block("Hinweise", UI.hinweis({ art: "info", titel: "Neue Version", text: "Zentrale 1.5.0 bringt Handles und das komplette CRM." }),
					UI.hinweis({ art: "erfolg", text: "Alle 21 Tests bestanden." }),
					UI.hinweis({ art: "warnung", titel: "Speicher fast voll", text: "Emil hat 94 % seines Speichers belegt.", aktion: { text: "Ansehen" } }),
					UI.hinweis({ art: "gefahr", titel: "Not-Aus aktiv", text: "Alle Daten sind gesperrt. Aufheben geht nur am Mac.", schliessbar: true }),
					UI.hinweis({ art: "akzent", text: "Design-Spielwiese – eine Kopie nur über Tailscale. Nichts hier ist live." })),
				block("Leer und Laden", UI.leer({ ikon: "spiel", titel: "Noch keine Favoriten", text: "Tippe bei einem Spiel auf den Stern, dann erscheint es hier.", aktion: { text: "Spiele entdecken" } }),
					UI.laden({}), UI.laden({ art: "skelett", zeilen: 3 }), UI.laden({ art: "skelett", form: "kacheln", zeilen: 4 })),
				block("Angaben", UI.angaben([["Handle", "@cuby0401"], ["Anzeigename", "Seb"], ["Dabei seit", "03.11.2026"], ["Rollen", UI.leiste([UI.marke({ text: "Admin", art: "akzent" }), UI.marke({ text: "Entwickler" })])]])),
				block("Startseite anordnen", startseite),
				block("Lesetext und Bilder", UI.lesetext([UI.h("h3", { text: "So testest du" }), UI.h("p", { text: "Lange Texte (Hilfe, Handbuch, Anleitungen) setzt der Lesetext einheitlich." }),
					UI.h("ol", {}, ["Spiel öffnen", "Einmal speichern", "Neu laden"].map((t) => UI.h("li", { text: t }))), UI.h("pre", { text: "await GameSave.save(\"spielstand\", { level: 3 });" })]),
					UI.bilder([{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'/%3E", alt: "Leeres Bild", unter: "12 KB" }], { format: "breit" })),
			] }),
	);
	window.uiTestBereit = true;
})();
