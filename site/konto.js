// Konto-Bereich der Bibliothek: Profil, Meine Spiele, Spielstände, Anfragen, Einstellungen, Sicherheit.
// Nutzt aus app.js: seiten, einstellungen, einstellungenSpeichern, spiele, ich, meldung, anzeige, Bridge.
// Oberfläche (11.11.2026, E85): nur aus den UI-Bausteinen (docs/ui-bausteine.md) – keine eigenen Knöpfe, Felder, Dialoge, Klassen.
// Sicherheit: Inhalte nur per textContent (Titel, Anfragetexte usw. sind fremde Eingaben) – UI.* macht das.
//
// Wird auch vom Admin- und Tester-Panel geladen (Helfer h, dauer, datumZeit, groesse, ROLLEN_NAMEN, anmeldeTabelle).
"use strict";

// Auf der Admin-Seite gibt es kein app.js – dann werden die Seiten einfach nicht registriert
const SEITEN_REG = typeof seiten !== "undefined" ? seiten : {};

// Funktion (nicht const): Admin- und Tester-Panel laden diese Datei mit
function h(...a) { return UI.h(...a); }
// Spielzeit lesbar: 45 s → „< 1 min“, 3900 → „1 h 5 min“
function dauer(sek) {
	if (!sek || sek < 60) return "< 1 min";
	const st = Math.floor(sek / 3600), m = Math.floor(sek / 60) % 60;
	return st ? `${st} h ${m} min` : `${m} min`;
}
const datumZeit = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–";
// Größe lesbar, Einheit passend zur Größe: B, KB, MB, GB, TB, PB (Zentrale 1.2.1)
function groesse(b) {
	const einheiten = ["B", "KB", "MB", "GB", "TB", "PB"];
	let i = 0, n = Math.max(0, Number(b) || 0);
	while (n >= 1024 && i < einheiten.length - 1) { n /= 1024; i++; }
	const stellen = i === 0 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
	return n.toLocaleString("de-DE", { maximumFractionDigits: stellen }) + " " + einheiten[i];
}
const ROLLEN_NAMEN = { spieler: "Spieler", entwickler: "Entwickler", admin: "Admin", tester: "Tester" };
const titelVon = (id) => ((typeof spiele !== "undefined" ? spiele : []).find((s) => s.id === id) || {}).title || id;
const pfadVon = (id) => id.split("/").map(encodeURIComponent).join("/");
// Fehler beim Speichern: abgelaufene Anmeldung zeigt schon das Band, alles andere als Meldung
const fehlerZeigen = (f) => { if (!(f instanceof Bridge.SitzungAbgelaufen)) meldung(f.message, "fehler"); };
// Seitenkopf jeder Konto-Seite: Titel + Untertitel (app.js setzt „Zurück“ davor, wo nötig)
const titel = (text, untertitel) => h("div", { class: "b-seite__kopf" },
	h("h1", { class: "b-seite__titel", text }), untertitel ? h("p", { class: "b-seite__untertitel", text: untertitel }) : null);
// Status einer Anfrage als Marke mit Punkt
const STATUS_ART = { offen: "warnung", erledigt: "erfolg", abgelehnt: "gefahr" };
const statusMarke = (status, id) => { const m = UI.marke({ text: status, art: STATUS_ART[status] || "neutral", punkt: true }); if (id) m.id = id; return m; };

// ---------- Einstellungen ----------
SEITEN_REG["einstellungen"] = async (c) => {
	// Jede Änderung gilt sofort und auf allen Geräten.
	const aussehen = { ...(einstellungen.aussehen || {}) };
	const aussehenSetzen = async (schluessel, wert) => {
		aussehen[schluessel] = wert;
		UI.aussehenAnwenden(aussehen);
		await einstellungenSpeichern({ aussehen: { [schluessel]: wert } });
	};
	const NAMEN = { weiterspielen: "Weiterspielen", favoriten: "Favoriten", neu: "Neu in der Bibliothek", "spiel-der-woche": "Spiel der Woche", alle: "Alle Spiele" };
	const abschnitte = ((einstellungen.startseite || {}).abschnitte || Object.keys(NAMEN).map((id) => ({ id, sichtbar: true })))
		.map((a) => ({ ...a, text: NAMEN[a.id] || a.id }));
	const rolle = ich.admin ? "Admin" : ich.uploader ? "Entwickler" : "Spieler";
	c.append(
		titel("Einstellungen"),
		UI.stapel([
			UI.karte({ titel: "Aussehen", untertitel: "Gilt sofort und auf allen deinen Geräten.", inhalt: [
				UI.segment({ id: "e-thema", label: "Thema", optionen: UI.AUSSEHEN.thema, wert: aussehen.thema || "auto", onwechsel: (w) => aussehenSetzen("thema", w) }),
				UI.farbwahl({ id: "e-akzent", label: "Farbe", wert: aussehen.akzent || "blau", onwechsel: (w) => aussehenSetzen("akzent", w) }),
				UI.segment({ id: "e-dichte", label: "Abstände", hinweis: "Kompakt zeigt mehr auf einmal, luftig ist ruhiger.", optionen: UI.AUSSEHEN.dichte,
					wert: aussehen.dichte || "normal", onwechsel: (w) => aussehenSetzen("dichte", w) }),
				UI.segment({ id: "e-kachel", label: "Größe der Spielkacheln", hinweis: "Wie groß die Spiele auf der Startseite erscheinen.", optionen: UI.AUSSEHEN.kachelgroesse,
					wert: aussehen.kachelgroesse || "mittel", onwechsel: (w) => aussehenSetzen("kachelgroesse", w) }),
			] }),
			UI.karte({ titel: "Startseite", untertitel: "Welche Bereiche du auf der Startseite siehst und in welcher Reihenfolge. „Alle Spiele“ bleibt immer da.", inhalt: [
				UI.sortierliste({ label: "Bereiche", ohneLabel: true, eintraege: abschnitte,
					onwechsel: (liste) => einstellungenSpeichern({ startseite: { abschnitte: liste } }) }),
			] }),
			UI.karte({ titel: "Bibliothek", inhalt: [
				UI.auswahl({ id: "e-sortierung", label: "Spiele sortieren", hinweis: "Favoriten stehen immer oben, danach von Seb empfohlene Spiele.",
					wert: einstellungen.sortierung, optionen: [["alphabetisch", "Alphabetisch"], ["zuletzt", "Zuletzt gespielt"], ["neu", "Neueste zuerst"], ["meistgespielt", "Meistgespielt"]],
					onchange: (w) => einstellungenSpeichern({ sortierung: w }) }),
				UI.schalter({ id: "e-gross", label: "Großansicht", hinweis: "Spiele füllen das ganze Fenster. Echtes Vollbild weiter über den Knopf „Vollbild“.",
					an: !!einstellungen.grossansicht, onwechsel: (an) => einstellungenSpeichern({ grossansicht: an }) }),
				UI.schalter({ id: "e-bestenliste", label: "Bestenliste neben dem Spiel", an: einstellungen.bestenliste !== false,
					onwechsel: (an) => einstellungenSpeichern({ bestenliste: an }) }),
			] }),
			UI.karte({ titel: "Konto", inhalt: [
				UI.angaben([["Angemeldet als", "@" + ich.player], ["Rolle", UI.marke({ text: rolle, art: ich.admin ? "akzent" : "neutral" })]]),
				UI.knopfleiste([UI.knopf({ art: "gefahr-leise", text: "Abmelden", ikon: "abmelden", href: "/cdn-cgi/access/logout" })], { ausrichtung: "links" }),
				UI.text("Zum Beispiel an einem fremden Rechner. Beim nächsten Besuch ist ein neuer E-Mail-Code nötig.", { art: "klein" }),
			] }),
		]));
};

// ---------- Meine Spielstände ----------
async function spielstaendeAbschnitt(c) {
	const liste = await Bridge.json("GET", "/api/meine/spielstaende");
	if (!liste.length) return c.append(UI.leer({ ikon: "ordner", titel: "Noch keine Spielstände", text: "Sobald du ein Spiel spielst, das speichert, erscheint es hier." }));
	c.append(UI.tabelle({ titel: "Meine Spielstände", zeilen: liste, spalten: [
		{ titel: "Spiel", sortierbar: true, sortWert: (s) => s.title, wert: (s) => h("div", {}, h("strong", { text: s.title }), UI.text(s.spiel, { art: "klein" })) },
		{ titel: "Umfang", wert: (s) => s.keys.length + (s.keys.length === 1 ? " Eintrag" : " Einträge") + " · " + groesse(s.keys.reduce((n, k) => n + k.bytes, 0)) },
		{ titel: "Zuletzt", sortierbar: true, sortWert: (s) => s.zuletzt || "", wert: (s) => datumZeit(s.zuletzt) },
		{ titel: "Deine Spielzeit", wert: (s) => dauer((spiele.find((x) => x.id === s.spiel) || {}).meineSpielzeit) },
		{ titel: "", rechts: true, wert: (s) => UI.knopf({ art: "gefahr-leise", groesse: "s", text: "Neu anfangen", onclick: async () => {
			if (!await UI.bestaetigen({ titel: "Neu anfangen?", text: `Deine Spielstände für „${s.title}“ werden gelöscht. Die letzten 5 Stände bleiben im Verlauf, Seb kann sie wiederherstellen.`, ja: "Löschen und neu anfangen", gefahr: true })) return;
			try {
				await Bridge.json("DELETE", "/api/meine/spielstaende/" + pfadVon(s.spiel));
				meldung(`Spielstände für „${s.title}“ gelöscht.`, "erfolg");
				c.replaceChildren(); spielstaendeAbschnitt(c);
			} catch (f) { fehlerZeigen(f); }
		} }) },
	] }));
}

// ---------- Meine Spiele (Entwickler) ----------
SEITEN_REG["meine-spiele"] = async (c) => {
	const neu = () => { c.replaceChildren(); SEITEN_REG["meine-spiele"](c); };
	c.append(titel("Meine Spiele", "Hochladen, Entwürfe veröffentlichen und alte Versionen zurückholen geht auf der Upload-Seite."),
		UI.knopfleiste([
			UI.knopf({ art: "primaer", text: "Zur Upload-Seite", ikon: "hochladen", href: "https://upload.cuby0401.uk", neuesFenster: true }),
			UI.knopf({ art: "standard", text: "Entwickler-Handbuch", ikon: "buch", href: "/handbuch/" }),
		], { ausrichtung: "links" }));
	const [liste, fehler, antraege] = await Promise.all([Bridge.json("GET", "/api/entwickler/spiele"), Bridge.json("GET", "/api/entwickler/fehler"),
		Bridge.json("GET", "/api/entwickler/antraege").catch(() => [])]);
	if (!liste.length) return c.append(UI.leer({ ikon: "spiel", titel: "Noch keine Spiele", text: "Lade dein erstes Spiel auf der Upload-Seite hoch." }));
	// 1.3.1: offene Anfragen gleich oben sichtbar – ein Klick springt zu den Anfragen des Spiels
	const offeneAntraege = antraege.filter((a) => a.status === "offen" && a.player !== ich.player);
	const zuAntraegen = (spiel) => (e) => { e.preventDefault(); (document.getElementById("antraege-" + spiel) || document.getElementById("antraege"))?.scrollIntoView({ behavior: "smooth" }); };
	if (offeneAntraege.length) c.append(UI.hinweis({ art: "warnung", ikon: "nachricht",
		titel: `${offeneAntraege.length} ${offeneAntraege.length === 1 ? "offene Anfrage" : "offene Anfragen"} zu deinen Spielen`,
		aktion: { text: "Ansehen", onclick: zuAntraegen("") } }));
	const fehlerText = (f) => !f || !f.arten ? "–" : `${f.arten24h ? f.arten24h + " neu (24 h) · " : ""}${f.anzahl}× gesamt`;
	const offlineUmschalten = async (s) => {
		let grund = null;
		if (!s.offline) {
			grund = await UI.eingabe({ titel: `„${s.title}“ offline nehmen?`, text: "Andere sehen es dann nicht mehr in der Übersicht, bis du es wieder online stellst. Spielstände und Bestenliste bleiben.",
				label: "Grund", hinweis: "Optional, nur für dich und Seb.", pflicht: false, ja: "Offline nehmen" });
			if (grund === null) return;
		}
		try {
			await Bridge.json("PUT", "/api/entwickler/offline/" + pfadVon(s.id), { offline: !s.offline, grund });
			meldung(s.offline ? `„${s.title}“ ist wieder online.` : `„${s.title}“ ist offline – nur du und Seb sehen es.`, "erfolg");
			neu();
		} catch (f) { fehlerZeigen(f); }
	};
	const neueSeason = async (s) => {
		if (!await UI.bestaetigen({ titel: "Neue Season beginnen?", text: `Die Bestenliste von „${s.title}“ startet leer. Die alte bleibt über die Season-Auswahl abrufbar.`, ja: "Neue Season" })) return;
		try {
			const r = await Bridge.json("POST", "/api/entwickler/season/" + pfadVon(s.id));
			meldung(`„${s.title}“: Season ${r.season} hat begonnen.`, "erfolg");
			neu();
		} catch (f) { fehlerZeigen(f); }
	};
	c.append(UI.tabelle({ titel: "Meine Spiele", zeilen: liste, spalten: [
		{ titel: "Spiel", wert: (s) => {
			const ordner = s.id.split("/")[1], user = s.id.split("/")[0];
			return UI.stapel([
				h("strong", { text: s.title }),
				UI.text("Ordner " + ordner + (s.live ? "" : " · noch nicht veröffentlicht") + (s.versteckt ? " · von Seb ausgeblendet" : ""), { art: "klein" }),
				s.offline ? UI.leiste([UI.marke({ text: "offline", art: "gefahr", punkt: true }), s.offlineGrund ? UI.text(s.offlineGrund, { art: "klein", tag: "span" }) : null]) : null,
				s.entwurf ? UI.leiste([UI.marke({ text: "Entwurf", art: "warnung", punkt: true }), UI.text("vom " + datumZeit(s.entwurf.geaendert), { art: "klein", tag: "span" }),
					UI.knopf({ art: "leise", groesse: "s", text: "Entwurf testen", ikon: "spielen", href: `#/entwurf/${user}/${ordner}` })]) : null,
				s.warning ? UI.text("⚠ " + s.warning, { art: "klein" }) : null,
			], { abstand: "s" });
		} },
		{ titel: "Spieler", rechts: true, wert: (s) => String(s.spieler) },
		{ titel: "Daumen", rechts: true, wert: (s) => String(s.daumen || 0) },
		{ titel: "Spielzeit", wert: (s) => dauer(s.spielzeit) },
		{ titel: "Zuletzt gespielt", wert: (s) => datumZeit(s.zuletzt) },
		{ titel: "Bestenliste", wert: (s) => s.leaderboard.enabled ? `Season ${s.leaderboardSeason} · ${s.scores} Einträge` : "aus" },
		{ titel: "Fehler", wert: (s) => h("div", {}, fehlerText(s.fehler), s.fehlerEntwurf && s.fehlerEntwurf.arten ? UI.text("Entwurf: " + fehlerText(s.fehlerEntwurf), { art: "klein" }) : null) },
		{ titel: "Anfragen", wert: (s) => {
			const zuSpiel = antraege.filter((a) => a.spiel === s.id), offen = zuSpiel.filter((a) => a.status === "offen").length;
			return zuSpiel.length ? UI.marke({ text: offen ? `${offen} offen` : `${zuSpiel.length} erledigt`, art: offen ? "warnung" : "neutral", onclick: zuAntraegen(s.id) }) : "–";
		} },
		{ titel: "", wert: (s) => UI.leiste([
			s.live ? UI.knopf({ art: s.offline ? "primaer" : "standard", groesse: "s", text: s.offline ? "Wieder online stellen" : "Offline nehmen",
				titel: s.offline ? "Spiel wieder für alle sichtbar machen" : "Spiel vorübergehend für alle anderen ausblenden – z. B. bei vielen Fehlern", onclick: () => offlineUmschalten(s) }) : null,
			s.live && s.leaderboard.enabled ? UI.knopf({ art: "leise", groesse: "s", text: "Neue Season", titel: "Neue, leere Bestenliste beginnen – die alte bleibt abrufbar", onclick: () => neueSeason(s) }) : null,
		]) },
	] }));

	antraegeProSpiel(c, antraege, neu);

	c.append(UI.abschnitt({ titel: "Fehlerberichte", ebene: "h2",
		untertitel: "JavaScript-Fehler, die beim Spielen in deinen Spielen auftreten – automatisch gemeldet, gleiche Fehler zusammengefasst, ohne Spielernamen. „Erledigt“ entfernt einen Eintrag; tritt der Fehler wieder auf, erscheint er neu.",
		inhalt: fehler.length ? UI.stapel(fehler.map((f) => UI.karte({ flach: true, titel: f.title,
			untertitel: `${f.anzahl}× · zuletzt ${datumZeit(f.letztes)}${f.browser ? " · " + f.browser : ""}`,
			aktionen: [f.entwurf ? UI.marke({ text: "Entwurf", art: "warnung" }) : null,
				UI.knopf({ art: "standard", groesse: "s", text: "Erledigt", ikon: "haken", onclick: async () => {
					try { await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id); neu(); } catch (x) { fehlerZeigen(x); } } })],
			inhalt: [
				UI.text(f.meldung, { tag: "code" }),
				f.quelle || f.zeile ? UI.text("in " + (f.quelle || "(Inline-Script)") + (f.zeile ? `:${f.zeile}` + (f.spalte ? `:${f.spalte}` : "") : ""), { art: "klein" }) : null,
				f.stack ? UI.abschnitt({ titel: "Stacktrace", ebene: "h4", einklappbar: true, offen: false, inhalt: UI.text(f.stack, { tag: "pre", art: "vorformatiert" }) }) : null,
			] })), { abstand: "s" })
			: UI.leer({ klein: true, ikon: "erfolg", titel: "Keine Fehler gemeldet" }) }));
};

// ---------- Bilder an Anfragen (Zentrale 1.3.1) ----------
// Screenshots werden im Browser verkleinert (längste Seite 1600 px, WebP bzw. JPEG) – so passen auch Handy-Fotos unter 2 MB.
const BILD_SEITE = 1600, BILD_MAX = 2 * 1024 * 1024;
async function bildVorbereiten(datei) {
	if (!datei || !/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(datei.type)) throw new Error(`„${datei && datei.name}“ ist kein Bild (PNG, JPG oder WebP)`);
	const bild = await createImageBitmap(datei).catch(() => { throw new Error(`„${datei.name}“ lässt sich nicht öffnen`); });
	const f = Math.min(1, BILD_SEITE / Math.max(bild.width, bild.height));
	const leinwand = document.createElement("canvas");
	leinwand.width = Math.max(1, Math.round(bild.width * f)); leinwand.height = Math.max(1, Math.round(bild.height * f));
	leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
	for (const q of [0.88, 0.75, 0.6, 0.45]) {
		let url = leinwand.toDataURL("image/webp", q);
		if (!url.startsWith("data:image/webp")) url = leinwand.toDataURL("image/jpeg", q);   // Safari ohne WebP-Export
		if (url.length * 0.75 < BILD_MAX - 1024) return url;
	}
	throw new Error(`„${datei.name}“ ist zu groß`);
}
// Bildauswahl mit Vorschau: Dateien wählen/ziehen oder Screenshot einfügen (Strg/⌘+V im Textfeld). bilder() liefert die Daten-URLs.
function bildAuswahl(max, einfuegenIn) {
	const liste = [];
	const vorschau = h("div", { class: "b-stapel b-stapel--s" });
	let flaeche;
	const zeigen = () => {
		vorschau.replaceChildren(liste.length ? UI.bilder(liste.map((url, i) => ({ src: url, alt: `Bild ${i + 1}`,
			aktion: UI.knopf({ art: "gefahr-leise", groesse: "s", text: "Entfernen", onclick: () => { liste.splice(i, 1); zeigen(); } }) })), { id: "bild-vorschau" }) : "");
		flaeche.hidden = liste.length >= max;
	};
	const dazu = async (dateien) => {
		for (const d of dateien) {
			if (liste.length >= max) { meldung(`Höchstens ${max} Bilder.`, "fehler"); break; }
			try { liste.push(await bildVorbereiten(d)); } catch (f) { meldung(f.message, "fehler"); }
		}
		flaeche.leeren();
		zeigen();
	};
	flaeche = UI.datei({ label: "Bilder", optional: true, accept: "image/png,image/jpeg,image/webp", mehrfach: true, text: `Bilder hierher ziehen oder auswählen (bis zu ${max})`,
		hinweis: "Screenshot auch mit Strg/⌘+V ins Textfeld einfügen.", ondatei: dazu });
	if (einfuegenIn) einfuegenIn.addEventListener("paste", (e) => {
		const dateien = [...(e.clipboardData?.files || [])].filter((d) => d.type.startsWith("image/"));
		if (dateien.length) { e.preventDefault(); dazu(dateien); }
	});
	return { element: UI.stapel([flaeche, vorschau], { abstand: "s" }), bilder: () => liste.slice(), leeren: () => { liste.length = 0; zeigen(); } };
}
const bildText = (n) => n ? ` · ${n} ${n === 1 ? "Bild" : "Bilder"}` : "";
const oeffnen = (a) => UI.knopf({ art: "leise", groesse: "s", text: "Öffnen" + bildText(a.bilder), href: "#/antrag/" + a.id });

// Antworten-Feld mit Knöpfen Erledigt / Ablehnen / Wieder öffnen
function antwortBlock(a, setzen, { nurSpeichern } = {}) {
	const antwort = UI.textbereich({ label: "Antwort an " + anzeige(a.player), zeilen: 3, max: 4000, wert: a.antwort || "" });
	return UI.stapel([antwort, UI.knopfleiste([
		a.status !== "offen" ? UI.knopf({ art: "leise", text: "Wieder öffnen", onclick: () => setzen("offen", antwort.wert) })
			: nurSpeichern ? UI.knopf({ art: "leise", text: "Nur Antwort speichern", onclick: () => setzen("offen", antwort.wert) }) : null,
		UI.knopf({ art: "gefahr-leise", text: "Ablehnen", onclick: () => setzen("abgelehnt", antwort.wert) }),
		UI.knopf({ art: "primaer", text: "Erledigt", ikon: "haken", onclick: () => setzen("erledigt", antwort.wert) }),
	])], { abstand: "s" });
}

// Anfragen zu den eigenen Spielen (1.3.0): pro Spiel, offen zuerst, geschlossene eingeklappt. Nur der Entwickler (und der Absender) sieht sie.
function antraegeProSpiel(c, antraege, neu) {
	if (!antraege.length) {
		c.append(UI.abschnitt({ id: "antraege", titel: "Anfragen zu deinen Spielen", ebene: "h2",
			inhalt: UI.text("Keine Anfragen – Spieler können unter Konto → Anfragen Fehler und Wünsche zu deinen Spielen schicken.", { art: "leise" }) }));
		return;
	}
	const proSpiel = new Map();
	for (const a of antraege) { if (!proSpiel.has(a.spiel)) proSpiel.set(a.spiel, []); proSpiel.get(a.spiel).push(a); }
	const karte = (a) => {
		const setzen = async (status, text) => {
			try {
				await Bridge.json("PATCH", "/api/entwickler/antraege/" + a.id, { status, antwort: text || null });
				meldung(`Anfrage von ${anzeige(a.player)}: ${status}.`, "erfolg");
				neu();
			} catch (f) { fehlerZeigen(f); }
		};
		return UI.karte({ flach: true, titel: a.artText, untertitel: `von ${anzeigeMitHandle(a.player)} · ${datumZeit(a.erstellt)}`,
			aktionen: [statusMarke(a.status), oeffnen(a)],
			inhalt: [UI.text(a.text, { art: "vorformatiert" }), antwortBlock(a, setzen)] });
	};
	const teile = [];
	for (const [spiel, liste] of proSpiel) {
		const offen = liste.filter((a) => a.status === "offen"), zu = liste.filter((a) => a.status !== "offen");
		teile.push(UI.abschnitt({ id: "antraege-" + spiel, ebene: "h3", titel: liste[0].title || spiel, untertitel: `${offen.length} offen, ${zu.length} geschlossen`,
			inhalt: UI.stapel([...offen.map(karte),
				zu.length ? UI.abschnitt({ titel: `Geschlossen (${zu.length})`, ebene: "h4", einklappbar: true, offen: false, inhalt: UI.stapel(zu.map(karte), { abstand: "s" }) }) : null], { abstand: "s" }) }));
	}
	c.append(UI.abschnitt({ id: "antraege", titel: "Anfragen zu deinen Spielen", ebene: "h2", inhalt: UI.stapel(teile) }));
}

// ---------- Anfragen ----------
SEITEN_REG["antraege"] = async (c) => {
	const [arten, meine, anMich] = await Promise.all([Bridge.json("GET", "/api/antraege/arten"), Bridge.json("GET", "/api/antraege"),
		ich.uploader ? Bridge.json("GET", "/api/entwickler/antraege").catch(() => []) : Promise.resolve([])]);
	const eigene = spiele.slice().sort((x, y) => x.title.localeCompare(y.title, "de"));   // alle sichtbaren Spiele
	const art = UI.auswahl({ id: "antrag-art", label: "Art", pflicht: true, optionen: Object.entries(arten) });
	const spiel = UI.auswahl({ id: "antrag-spiel", label: "Spiel", optionen: [["", "– kein bestimmtes Spiel –"], ...eigene.map((s) => [s.id, s.title])], wert: "" });
	const text = UI.textbereich({ id: "antrag-text", label: "Beschreibung", zeilen: 5, pflicht: true, max: 4000, platzhalter: "Was soll passieren? Je genauer, desto schneller. Ein Screenshot hilft oft am meisten." });
	const auswahl = bildAuswahl(5, text.eingabe);
	const formular = UI.formular({ id: "antrag-formular", absenden: "Anfrage senden", inhalt: [art, spiel, text, auswahl.element], onabsenden: async () => {
		try {
			const r = await Bridge.json("POST", "/api/antraege", { art: art.wert, spiel: spiel.wert || null, text: text.wert });
			let fehlt = 0;   // Bilder einzeln hinterher (je Anfrage ein Bild)
			for (const bild of auswahl.bilder()) await Bridge.json("POST", `/api/antraege/${r.id}/bilder`, { bild }).catch((f) => { if (f instanceof Bridge.SitzungAbgelaufen) throw f; fehlt++; });
			if (fehlt) await UI.hinweisDialog({ titel: "Nicht alle Bilder angefügt", text: `${fehlt} Bild(er) konnten nicht angefügt werden. Du kannst sie in der Anfrage (Öffnen) noch einmal anfügen.` });
			meldung(r.an && r.an !== "admin"
				? `Anfrage verschickt – sie geht an ${r.an === ich.player ? "dich als Entwickler (unter „Meine Spiele“)" : anzeige(r.an) + ", den Entwickler des Spiels"}. Antwort und Status erscheinen hier.`
				: "Anfrage verschickt – Seb bekommt sie. Antwort und Status erscheinen hier.", "erfolg");
			c.replaceChildren(); SEITEN_REG["antraege"](c);
		} catch (f) { fehlerZeigen(f); }
	} });
	c.append(titel("Anfragen", "Fehler, Wünsche und Sonstiges zu einem bestimmten Spiel gehen direkt an dessen Entwickler – nur er und du sehen die Anfrage. "
		+ "Alles andere bekommt Seb: Fehler in der Bibliothek, Spielstand wiederherstellen" + (ich.uploader || ich.admin ? ", Bestenliste zurücksetzen, Spiel umbenennen." : ".")));
	// 1.3.1: Anfragen zu den eigenen Spielen auch hier – offene oben, ein Klick öffnet die Anfrage
	const fremde = anMich.filter((a) => a.player !== ich.player);
	if (fremde.length) {
		const offen = fremde.filter((a) => a.status === "offen");
		c.append(UI.karte({ titel: `An dich – Anfragen zu deinen Spielen (${offen.length} offen)`, ebene: "h2",
			aktionen: [UI.knopf({ art: "leise", groesse: "s", text: `Alle ${fremde.length} pro Spiel`, ikonRechts: "winkel-rechts", href: "#/meine-spiele" })],
			inhalt: offen.length ? UI.liste(offen.map((a) => ({ titel: `${a.title || a.spiel} · ${a.artText} von ${anzeigeMitHandle(a.player)}${bildText(a.bilder)}`,
				text: a.text.length > 140 ? a.text.slice(0, 140) + " …" : a.text, rechts: datumZeit(a.erstellt), href: "#/antrag/" + a.id })), { ohneRahmen: true })
				: UI.leer({ klein: true, ikon: "erfolg", titel: "Alles erledigt" }) }));
	}
	c.append(UI.karte({ titel: "Neue Anfrage", ebene: "h2", inhalt: formular }));
	if (!meine.length) {
		c.append(UI.abschnitt({ titel: "Meine Anfragen", ebene: "h2", inhalt: UI.leer({ klein: true, ikon: "nachricht", titel: "Noch keine Anfragen" }) }));
		return;
	}
	c.append(UI.abschnitt({ titel: "Meine Anfragen", ebene: "h2", inhalt: UI.stapel(meine.map((a) => UI.karte({ flach: true,
		titel: (arten[a.art] || a.art) + (a.spiel ? " · " + titelVon(a.spiel) : ""),
		untertitel: datumZeit(a.erstellt) + " · " + (a.zustaendig && a.zustaendig !== "admin" ? "geht an " + anzeige(a.zustaendig) + " (Entwickler)" : "geht an Seb"),
		aktionen: [statusMarke(a.status), oeffnen(a)],
		inhalt: [UI.text(a.text, { art: "vorformatiert" }),
			a.antwort ? UI.hinweis({ art: "akzent", ikon: "nachricht", titel: `Antwort von ${a.beantwortet_von || "Seb"}`, inhalt: UI.text(a.antwort, { art: "vorformatiert" }) }) : null] })), { abstand: "s" }) }));
};

// ---------- Eine Anfrage (Zentrale 1.3.1): #/antrag/<id> – aus der Glocke, „Anfragen“ und „Meine Spiele“ ----------
SEITEN_REG["antrag"] = async (c) => {
	const id = antragNr;
	const a = await Bridge.json("GET", "/api/antraege/" + id);
	const neu = () => zeigeSeite("antrag");   // ganz neu aufbauen – mit „Zurück“
	const an = a.zustaendig === "admin" ? "Seb (Bibliothek)" : a.zustaendig === ich.player ? "dich (Entwickler)" : anzeige(a.zustaendig) + " (Entwickler)";
	c.append(titel(`Anfrage #${a.id}`),
		UI.karte({ id: "antrag-ticket", titel: a.artText, untertitel: `von ${a.eigener ? "dir" : anzeigeMitHandle(a.player)} · ${datumZeit(a.erstellt)} · geht an ${an}` +
			(a.geaendert !== a.erstellt ? ` · zuletzt geändert ${datumZeit(a.geaendert)}` : ""),
			aktionen: [statusMarke(a.status, "antrag-status"), a.spiel ? UI.knopf({ art: "leise", groesse: "s", text: a.title || a.spiel, ikon: "spielen", href: "#/spiel/" + a.spiel }) : null],
			inhalt: UI.text(a.text, { art: "vorformatiert", id: "antrag-text" }) }));
	// Bilder: Klick öffnet groß in neuem Tab
	if (a.bilder.length || a.darfBilder) {
		const teile = [a.bilder.length ? UI.bilder(a.bilder.map((b) => ({ src: `/api/antraege/${a.id}/bilder/${b.id}`, href: `/api/antraege/${a.id}/bilder/${b.id}`,
			alt: "Bild von " + anzeige(b.von), unter: `${b.von === ich.player ? "von dir" : "von " + anzeige(b.von)} · ${groesse(b.bytes)}`,
			aktion: b.von === ich.player || ich.admin ? UI.knopf({ art: "gefahr-leise", groesse: "s", text: "Entfernen", onclick: async () => {
				if (!await UI.bestaetigen({ titel: "Bild entfernen?", ja: "Entfernen", gefahr: true })) return;
				try { await Bridge.json("DELETE", `/api/antraege/${a.id}/bilder/${b.id}`); neu(); } catch (f) { fehlerZeigen(f); }
			} }) : null })), { id: "antrag-galerie" }) : UI.text("Noch keine Bilder.", { art: "leise" })];
		if (a.darfBilder && a.bilder.length < a.bilderMax) {
			const auswahl = bildAuswahl(a.bilderMax - a.bilder.length);
			const hoch = UI.knopf({ art: "standard", text: "Bilder hochladen", ikon: "hochladen", onclick: async () => {
				const bilder = auswahl.bilder();
				if (!bilder.length) return meldung("Erst ein Bild auswählen.", "fehler");
				hoch.laden(true);
				try { for (const bild of bilder) await Bridge.json("POST", `/api/antraege/${a.id}/bilder`, { bild }); meldung("Bilder angefügt.", "erfolg"); neu(); }
				catch (f) { hoch.laden(false); fehlerZeigen(f); }
			} });
			teile.push(auswahl.element, UI.knopfleiste([hoch], { ausrichtung: "links" }));
		}
		c.append(UI.abschnitt({ titel: "Bilder", ebene: "h2", inhalt: UI.stapel(teile) }));
	}
	const antwortTeile = [];
	if (a.antwort) antwortTeile.push(UI.hinweis({ id: "antrag-antwort", art: "akzent", ikon: "nachricht", titel: a.beantwortet_von || "Seb", inhalt: UI.text(a.antwort, { art: "vorformatiert" }) }));
	else if (!a.darfAntworten) antwortTeile.push(UI.text("Noch keine Antwort.", { art: "leise" }));
	if (a.darfAntworten) {
		const setzen = async (status, text) => {
			try {
				await Bridge.json("PATCH", "/api/antraege/" + a.id, { status, antwort: text || null });
				meldung(`Anfrage #${a.id}: ${status}.` + (a.player !== ich.player && status !== "offen" ? ` ${anzeige(a.player)} bekommt eine Nachricht.` : ""), "erfolg");
				neu();
			} catch (f) { fehlerZeigen(f); }
		};
		antwortTeile.push(UI.karte({ flach: true, inhalt: antwortBlock(a, setzen, { nurSpeichern: true }) }));
	}
	c.append(UI.abschnitt({ titel: "Antwort", ebene: "h2", inhalt: UI.stapel(antwortTeile) }));
};

// ---------- Profil (Zentrale 1.2.0): Spielzeit, Erfolge, Bestplätze ----------
SEITEN_REG["profil"] = async (c) => {
	const d = await Bridge.json("GET", "/api/profil/" + encodeURIComponent(profilName));
	// Kopf (Zentrale 1.4.0): Bild, Name, Rollen, dabei seit – dazu Spielzeit, Spiele, Erfolge als Kennzahlen
	const rollen = (d.rollen || []).filter((r) => r !== "spieler" || d.rollen.length === 1);
	const name = d.anzeigename || d.name;
	c.append(titel(d.ich ? "Mein Profil" : "Profil von " + name),
		UI.karte({ id: "profil-kopf", inhalt: UI.leiste([
			UI.avatar({ name, groesse: "xl" }),
			UI.stapel([
				h("strong", { id: "profil-name", class: "b-karte__titel", text: name }),
				UI.text("@" + d.name + (d.dabeiSeit ? " · dabei seit " + new Date(d.dabeiSeit).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""), { art: "leise" }),
				rollen.length ? UI.leiste(rollen.map((r) => UI.marke({ text: ROLLEN_NAMEN[r] || r, art: r === "admin" ? "akzent" : r === "entwickler" ? "info" : "neutral" }))) : null,
			], { abstand: "s" }),
		]) }),
		UI.raster([
			UI.kennzahl({ wert: dauer(d.sekunden), label: "Spielzeit" }),
			// 1.4.1: „gespielt“ statt „Spiele“ – Admins gehören nicht alle Spiele, eigene Spiele zählen extra
			UI.kennzahl({ wert: d.spiele.length, label: "gespielt", hinweis: "Spiele, egal von wem" }),
			d.eigene ? UI.kennzahl({ wert: d.eigene, label: "eigene Spiele" }) : null,
			UI.kennzahl({ wert: d.erfolge, label: "Erfolge" }),
		].filter(Boolean), { art: "kennzahlen" }));
	// Nur im eigenen Profil: Meine Angaben (privat)
	if (d.ich) {
		const inhalt = h("div", { class: "b-stapel" });
		c.append(UI.abschnitt({ id: "angaben", titel: "Meine Angaben", ebene: "h2", untertitel: "Alles freiwillig. Den Anzeigenamen sehen andere, Name und Geburtstag nur du und Seb.", inhalt }));
		await angabenAbschnitt(inhalt);
	}
	const tabelle = d.spiele.length ? UI.tabelle({ titel: "Gespielte Spiele", zeilen: d.spiele, spalten: [
		{ titel: "Spiel", wert: (s) => h("a", { href: "#/spiel/" + s.id, text: s.title }) },
		{ titel: "von", wert: (s) => s.author === d.name ? (d.ich ? "dir" : anzeige(s.author)) : anzeige(s.author) },
		{ titel: "Spielzeit", wert: (s) => dauer(s.sekunden) },
		{ titel: "Platz (aktuelle Season)", wert: (s) => s.platz ? s.platz + "." : "–" },
		{ titel: "Erfolge", wert: (s) => h("div", {}, s.erfolgeGesamt ? `${s.erfolge.length}/${s.erfolgeGesamt}` : "–",
			s.erfolge.length ? UI.text(s.erfolge.map((e) => e.titel).join(" · "), { art: "klein" }) : null) },
	] }) : UI.leer({ klein: true, ikon: "spiel", titel: "Noch nichts gespielt" });
	c.append(UI.abschnitt({ titel: d.ich ? "Gespielte Spiele mit Plätzen und Erfolgen" : "Gespielte Spiele", ebene: "h2", inhalt: tabelle }));
};

// Konto-Bereich (Zentrale 1.4.0): Spielstände und Anmeldungen als eigene Seiten
SEITEN_REG["spielstaende"] = async (c) => {
	c.append(titel("Meine Spielstände", "Spielstände liegen auf dem Server und gelten auf allen deinen Geräten. „Neu anfangen“ löscht deine Spielstände für ein Spiel – die letzten 5 Stände bleiben im Verlauf, Seb kann sie wiederherstellen. Deine Bestenlisten-Einträge bleiben."));
	const inhalt = h("div", { id: "spielstaende", class: "b-stapel" });
	c.append(inhalt);
	await spielstaendeAbschnitt(inhalt);
};
SEITEN_REG["sicherheit"] = async (c) => {
	c.append(titel("Sicherheit"));
	const inhalt = h("div", { id: "anmeldungen", class: "b-stapel" });
	c.append(UI.abschnitt({ titel: "Anmeldungen", ebene: "h2", untertitel: "Jede Anmeldung per E-Mail-Code gilt eine Woche auf einem Gerät. „Trennen“ beendet eine Anmeldung: Das Gerät wird beim nächsten Klick abgemeldet und braucht einen neuen Code. Unbekanntes Gerät? Trennen und Seb Bescheid geben.", inhalt }));
	await anmeldungenAbschnitt(inhalt);
};

// ---------- Meine Angaben (CRM, Zentrale 1.4.0): sieht und ändert nur die Person selbst (und der Admin) ----------
async function angabenAbschnitt(c) {
	const k = await Bridge.json("GET", "/api/mein/konto").catch(() => null);
	if (!k || k.simuliert) return c.append(UI.text("In der Ansicht als Spieler/Entwickler gibt es keine eigenen Angaben.", { art: "leise" }));
	const f = {
		anzeigename: UI.feld({ label: "Anzeigename", wert: k.anzeigename || "", max: 40, hinweis: "Sehen alle in der Bibliothek." }),
		vorname: UI.feld({ label: "Vorname", wert: k.vorname || "", max: 60 }),
		nachname: UI.feld({ label: "Nachname", wert: k.nachname || "", max: 60 }),
		geburtstag: UI.feld({ label: "Geburtstag", typ: "date", wert: k.geburtstag || "", min: "1900-01-01" }),
	};
	f.geburtstag.eingabe.max = new Date().toISOString().slice(0, 10);
	const ds = UI.haken({ label: "Ich habe gelesen, welche Daten die Bibliothek speichert (Hilfe → Deine Daten).", an: !!k.datenschutz_bestaetigt, deaktiviert: !!k.datenschutz_bestaetigt });
	c.append(UI.karte({ inhalt: UI.formular({ inhalt: [
		UI.raster([f.anzeigename, f.vorname, f.nachname, f.geburtstag], { art: "karten" }),
		UI.angaben([["Login-E-Mail", k.emails.join(", ")], ["Rollen", k.rollen.map((r) => ROLLEN_NAMEN[r] || r).join(", ")], ["Dabei seit", datumZeit(k.angelegt)]]),
		ds, UI.knopfleiste([UI.knopf({ art: "leise", groesse: "s", text: "Hilfe → Deine Daten", ikonRechts: "extern", href: "/hilfe/#daten", neuesFenster: true })], { ausrichtung: "links" }),
	], onabsenden: async () => {
		try {
			await Bridge.json("PATCH", "/api/mein/konto", { anzeigename: f.anzeigename.wert, vorname: f.vorname.wert, nachname: f.nachname.wert,
				geburtstag: f.geburtstag.wert || null, datenschutz: ds.wert });
			meldung("Gespeichert.", "erfolg");
		} catch (x) { fehlerZeigen(x); }
	} }) }), handleAbschnitt(k));
}

// ---------- Handle (@name, Zentrale 1.5.0, E82): alle 30 Tage änderbar ----------
function handleAbschnitt(k) {
	const gesperrt = !!k.handleAb;
	const feld = UI.feld({ label: "Neues Handle", wert: k.handle, max: 20, autocomplete: "off", deaktiviert: gesperrt,
		hinweis: gesperrt ? `Wieder änderbar ab ${new Date(k.handleAb).toLocaleDateString("de-DE")}.` : "3–20 Zeichen: a–z, 0–9, _ und -." });
	feld.eingabe.spellcheck = false;
	const form = UI.formular({ absenden: "Handle ändern", inhalt: [
		UI.text("Dein eindeutiger Name in der Bibliothek, z. B. in Adressen und neben deinem Anzeigenamen. Ändern geht alle 30 Tage. Dein altes Handle bleibt für dich reserviert, alte Links auf dein Profil funktionieren weiter. Spielstände, Spiele und Erfolge bleiben.", { art: "leise" }),
		feld,
	], onabsenden: async () => {
		const neu = String(feld.wert).trim().replace(/^@/, "").toLowerCase();
		if (neu === k.handle) return meldung("Das ist schon dein Handle.", "fehler");
		if (!await UI.bestaetigen({ titel: `Handle zu @${neu} ändern?`, text: "Danach kannst du es 30 Tage lang nicht wieder ändern.", ja: "Ändern" })) return;
		try {
			await Bridge.json("PUT", "/api/mein/handle", { handle: neu });
			meldung(`Dein Handle ist jetzt @${neu}. Die Seite lädt neu.`, "erfolg");
			setTimeout(() => location.reload(), 1200);
		} catch (x) { fehlerZeigen(x); }
	} });
	if (gesperrt && form.absendenKnopf) form.absendenKnopf.aus(true);
	// h3 „Handle“ im Formular: daran erkennt der Ende-zu-Ende-Test das Formular
	form.prepend(h("h3", { class: "b-karte__titel", text: "Handle" }));
	return UI.karte({ inhalt: form });
}

// ---------- Anmeldungen (E55) mit „Trennen“ (Zentrale 1.2.1) ----------
async function anmeldungenAbschnitt(c) {
	const liste = await Bridge.json("GET", "/api/meine/anmeldungen");
	if (!liste.length) return c.append(UI.leer({ klein: true, ikon: "schloss", titel: "Noch keine Anmeldungen aufgezeichnet" }));
	const neu = async () => { c.replaceChildren(); await anmeldungenAbschnitt(c); };
	const andere = liste.filter((a) => !a.aktuell && !a.getrennt && a.sitzung);
	if (andere.length) c.append(UI.knopfleiste([UI.knopf({ art: "gefahr-leise", text: `Alle anderen Geräte trennen (${andere.length})`, ikon: "abmelden",
		onclick: async () => {
			if (!await UI.bestaetigen({ titel: "Alle anderen Geräte trennen?", text: "Nur dieses Gerät bleibt angemeldet.", ja: "Trennen", gefahr: true })) return;
			try { await Bridge.json("POST", "/api/meine/anmeldungen/trennen", { alleAnderen: true }); meldung("Alle anderen Geräte getrennt.", "erfolg"); neu(); } catch (f) { fehlerZeigen(f); }
		} })], { ausrichtung: "links" }));
	c.append(anmeldeTabelle(liste, false, async (a) => {
		if (!await UI.bestaetigen({ titel: "Anmeldung beenden?", text: `„${a.geraet}“ wird abgemeldet und braucht einen neuen Code.`, ja: "Trennen", gefahr: true })) return;
		try { await Bridge.json("POST", "/api/meine/anmeldungen/trennen", { sitzung: a.sitzung }); meldung(`${a.geraet} getrennt.`, "erfolg"); neu(); } catch (f) { fehlerZeigen(f); }
	}));
}

// Tabelle der Anmeldungen – auch im Admin-Panel (mitSpieler)
function anmeldeTabelle(liste, mitSpieler, trennen) {
	return UI.tabelle({ titel: "Anmeldungen", zeilen: liste, spalten: [
		// anzeige() gibt es nur in der Bibliothek (Anzeigename); im Admin-Panel steht das Handle (1.5.0)
		...(mitSpieler ? [{ titel: "Spieler", wert: (a) => typeof anzeige === "function" ? anzeige(a.player) : a.player }] : []),
		{ titel: "Gerät", wert: (a) => h("div", {}, a.geraet, a.aktuell ? h("div", {}, UI.marke({ text: "dieses Gerät", art: "erfolg", punkt: true })) : null) },
		{ titel: "Ort", wert: (a) => a.ort || "–" },
		{ titel: "IP", mono: true, wert: (a) => a.ip || "–" },
		{ titel: "Angemeldet", wert: (a) => a.sitzung ? datumZeit(new Date(a.sitzung * 1000).toISOString()) : "–" },
		{ titel: "Zuletzt aktiv", wert: (a) => datumZeit(a.letzte) },
		{ titel: "", rechts: true, wert: (a) => a.getrennt ? UI.marke({ text: "getrennt", art: "gefahr", punkt: true })
			: trennen && !a.aktuell && a.sitzung ? UI.knopf({ art: "gefahr-leise", groesse: "s", text: "Trennen", onclick: () => trennen(a) }) : "" },
	] });
}
