// Spielebibliothek – Bibliotheksseite
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Bibliotheksseite
//
// Spielliste kommt aus GET /api/games, Spiele laufen auf play.cuby0401.uk (E14),
// Speichern läuft über lib/bridge.js.
//
// Oberfläche (11.11.2026, E85): ausschließlich aus den UI-Bausteinen (site/ui/, docs/ui-bausteine.md).
// Keine eigenen Knöpfe, Felder, Dialoge oder Klassen – fehlt etwas, kommt zuerst ein neuer Baustein dazu.
//
// Sicherheit: Alles aus game.json ist fremder Inhalt → nur per textContent einsetzen (UI.* macht das).
"use strict";

const ID_MUSTER = /^[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const el = (id) => document.getElementById(id);
let spiele = [];
let aktuellesSpiel = null;
let ichSelbst = null;
let ich = { player: null, uploader: false, admin: false };
let einstellungen = { sortierung: "alphabetisch", favoriten: [], grossansicht: false, bestenliste: true };
const seiten = {};   // Unterseiten (konto.js): name → async (container) => {}
let letzteRoute = "#/";   // wohin „Zurück“ einer Unterseite führt
let suche = "", tagFilter = null;   // Suche und Kategorien in der Übersicht (Zentrale 1.2.0)
let profilName = null;              // für #/profil/<name>
let antragNr = null;                // für #/antrag/<id> (Zentrale 1.3.1)
let antragZurueck = "#/";           // Zurück in der Anfrage: dorthin, wo man herkam
let bisherigeRoute = "";
const idPfad = (id) => id.split("/").map(encodeURIComponent).join("/");
// 1.4.1: In der Bibliothek steht der Anzeigename (falls gesetzt), Links und Admin-Panel bleiben beim Benutzernamen
const anzeige = (name) => (ich.namen && ich.namen[name]) || name;
// 1.5.0: wo es darauf ankommt, wer wirklich dahinter steckt (Anfragen), steht das Handle dabei
const anzeigeMitHandle = (name) => anzeige(name) === name ? "@" + name : `${anzeige(name)} (@${name})`;

async function einstellungenSpeichern(aenderung) {
	Object.assign(einstellungen, aenderung);
	try { einstellungen = await Bridge.json("PUT", "/api/einstellungen", aenderung); }
	catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung("Einstellung nicht gespeichert: " + e.message, "fehler"); }
}

const zahl = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const dezimal = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Formate für Bestenlisten-Werte (game.json: format "zahl" | "dezimal" | "zeit" | "text")
function formatieren(wert, format) {
	if (wert === undefined || wert === null) return "–";
	if (format === "text") return String(wert);
	if (typeof wert !== "number") return String(wert);
	if (format === "dezimal") return dezimal.format(wert);
	if (format === "zeit") { // Millisekunden → m:ss,z bzw. h:mm:ss
		const ms = Math.max(0, Math.round(wert));
		const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
		const zw = (n) => String(n).padStart(2, "0");
		return h ? `${h}:${zw(m)}:${zw(s)}` : `${m}:${zw(s)},${Math.floor(ms / 100) % 10}`;
	}
	return zahl.format(wert);
}

// Meldungen: eine Art für alles (UI.meldung, unten in der Mitte). art "fehler" bleibt bis zum Schließen, "bleibt" ebenso.
function meldung(text, art = "") {
	if (!text) return;
	UI.meldung(text, { art: art === "fehler" ? "fehler" : art === "erfolg" ? "erfolg" : "info", dauer: art === "bleibt" ? 0 : undefined });
}

// ---------- Gerüst: Kopfleiste, Bänder, Fußzeile ----------
const TESTSERVER = "https://test.cuby0401.uk";   // Probe = Testserver (1.4.0, E76)
// Konto-Bereich (Zentrale 1.4.0): diese Seiten bekommen die Seitenleiste (Handy: oben zum Wischen)
const KONTO_SEITEN = [
	{ name: "profil", text: "Profil", ikon: "benutzer" },
	{ name: "meine-spiele", text: "Meine Spiele", ikon: "spiel", rolle: "entwickler" },
	{ name: "spielstaende", text: "Meine Spielstände", ikon: "ordner" },
	{ name: "antraege", text: "Anfragen", ikon: "nachricht" },
	{ name: "einstellungen", text: "Einstellungen", ikon: "einstellungen" },
	{ name: "sicherheit", text: "Sicherheit", ikon: "schild" },
];
const darfSeite = (s) => !s.rolle || (s.rolle === "entwickler" && (ich.uploader || ich.admin));
// Weitere Ziele (Admin-Panel, Tester-Panel), passend zur Rolle
function weitereZiele() {
	const z = [];
	if (ich.admin) z.push({ text: "Admin-Panel", ikon: "schild", href: "/admin/" });
	// Tester-Panel (1.4.0, E76): auf dem Testserver für alle, live für die Rolle Tester (dann auf dem Testserver)
	if (ich.probe || ich.design) z.push({ text: "Tester-Panel", ikon: "test", href: "/tester/" });
	else if (ich.tester) z.push({ text: "Tester-Panel", ikon: "test", href: TESTSERVER + "/tester/", extern: true });
	return z;
}

function geruestBauen() {
	const upload = UI.knopf({ art: "leise", text: "Hochladen", ikon: "hochladen", href: "https://upload.cuby0401.uk", id: "upload-link" });
	upload.target = "_blank"; upload.rel = "noopener"; upload.hidden = true;
	const glockeKnopf = UI.knopf({ art: "leise", nurIkon: true, ikon: "glocke", label: "Meldungen", id: "glocke-knopf" });
	glockeKnopf.append(UI.h("span", { class: "b-zahl", id: "glocke-zahl", hidden: true }));
	const glocke = UI.menue({ ausloeser: glockeKnopf, id: "glocke-liste", label: "Meldungen", breit: true, inhalt: UI.h("div", { id: "glocke-inhalt" }),
		onoeffnen: glockeGeoeffnet });
	glocke.id = "glocke"; glocke.hidden = true;
	const hilfe = UI.knopf({ art: "leise", nurIkon: true, ikon: "hilfe", label: "Hilfe", href: "/hilfe/", id: "hilfe-link" });
	const admin = UI.knopf({ art: "leise", text: "Admin", ikon: "schild", href: "/admin/", id: "admin-link" });
	admin.hidden = true;
	const ort = el("kopf-ort");
	ort.replaceWith(UI.kopfleiste({ id: "kopf", marke: { text: "Spielebibliothek", href: "#/" }, rechts: [upload, glocke, hilfe, admin, UI.h("span", { id: "konto-ort" })] }));

	el("baender").append(
		UI.band({ id: "probe-band", art: "warnung", versteckt: true, text: "Probe-Zentrale – eine Kopie zum Testen. Nichts hier ist live, alle Änderungen bleiben hier." }),
		UI.band({ id: "ansicht-band", art: "akzent", versteckt: true, ikon: "auge",
			aktion: UI.knopf({ art: "standard", groesse: "s", text: "Ansicht beenden", id: "ansicht-ende" }) }),
		UI.band({ id: "abgelaufen", art: "warnung", versteckt: true, text: "Deine Anmeldung ist abgelaufen. Du kannst weiterspielen – dein Fortschritt wird auf diesem Gerät gesichert und nach der nächsten Anmeldung automatisch übertragen.",
			aktion: UI.knopf({ art: "primaer", groesse: "s", text: "Jetzt neu anmelden", onclick: () => location.reload() }) }));
	el("ansicht-band-text").id = "ansicht-text";

	el("fuss-ort").replaceWith(UI.fusszeile({ rechtsId: "zentrale-version",
		links: [{ text: "Hilfe", href: "/hilfe/" }, { text: "Entwickler-Handbuch", href: "/handbuch/" }, { text: "Fehler melden / Idee", href: "#/antraege" }] }));

	spielansichtBauen();
}

// Konto-Menü oben rechts (Bild + Name): alle Konto-Seiten, Admin/Tester, Hilfe, Abmelden – gleich wie im Admin-Panel
function kontoMenueEinrichten() {
	const knopf = UI.knopf({ art: "leise", text: anzeige(ich.player), id: "menue-knopf", titel: "Mein Konto (@" + ich.player + ")" });
	const avatar = UI.avatar({ name: ich.anzeigename || ich.player, groesse: "s" });
	avatar.id = "avatar";
	knopf.prepend(avatar);
	const name = knopf.querySelector(".b-knopf__text"); name.id = "benutzer"; name.title = "@" + ich.player;
	const eintraege = [{ titel: ich.anzeigename ? `${ich.anzeigename} (@${ich.player})` : "@" + ich.player }];
	for (const s of KONTO_SEITEN) if (darfSeite(s)) eintraege.push({ text: s.text, ikon: s.ikon, href: "#/" + s.name });
	const weitere = weitereZiele();
	if (weitere.length) eintraege.push("trenner", ...weitere.map((z) => ({ ...z, rechts: z.extern ? "↗" : undefined })));
	eintraege.push("trenner", { text: "Hilfe", ikon: "hilfe", href: "/hilfe/" }, { text: "Abmelden", ikon: "abmelden", href: "/cdn-cgi/access/logout", gefahr: true });
	el("konto-ort").replaceWith(UI.menue({ ausloeser: knopf, id: "konto-menue", label: "Konto", eintraege }));
	el("admin-link").hidden = !ich.admin;
	// Band oben, solange eine Rolle simuliert wird (gestartet im Admin-Panel → Übersicht)
	if (ich.ansicht) {
		el("ansicht-text").textContent = `Du siehst die Bibliothek als ${ich.ansicht === "spieler" ? "Spieler" : "Entwickler"} – so wie Kollegen mit dieser Rolle. Spielstände und Favoriten bleiben deine.`;
		el("ansicht-band").hidden = false;
		el("ansicht-ende").onclick = () => ansichtWechseln(null);
	}
}

function ansichtWechseln(rolle) {
	Bridge.ansicht = rolle;
	// Beenden: zurück an die Stelle im Admin-Panel, an der die Ansicht gestartet wurde (1.3.0)
	let zurueck = null;
	try { zurueck = JSON.parse(sessionStorage.getItem("ansicht-zurueck") || "null"); sessionStorage.removeItem("ansicht-zurueck"); } catch { /* egal */ }
	if (!rolle && zurueck && typeof zurueck.url === "string" && zurueck.url.startsWith("/admin/")) {
		try { sessionStorage.setItem("admin-scroll", String(zurueck.y || 0)); } catch { /* egal */ }
		location.href = zurueck.url;
		return;
	}
	location.hash = "#/";
	location.reload();
}

// ---------- Übersicht / Startseite in Reihen (Phase 2, Seb 10.11.2026: Startseite selbst anordnen) ----------
// Reihenfolge: Favoriten, dann empfohlene Spiele, dann nach gewählter Sortierung
function sortiert(liste) {
	const fav = new Set(einstellungen.favoriten);
	const nach = {
		alphabetisch: (a, b) => a.title.localeCompare(b.title, "de"),
		zuletzt: (a, b) => (b.zuletztGespielt || "").localeCompare(a.zuletztGespielt || "") || a.title.localeCompare(b.title, "de"),
		neu: (a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""),
		meistgespielt: (a, b) => (b.spielzeit || 0) - (a.spielzeit || 0) || a.title.localeCompare(b.title, "de"),
	}[einstellungen.sortierung] || ((a, b) => a.title.localeCompare(b.title, "de"));
	return liste.slice().sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || (b.hervorgehoben - a.hervorgehoben) || nach(a, b));
}

// Daumen hoch – im Spiel und auf der Kachel. Eigene Spiele und „Ansicht als …“: nur Anzeige.
function daumenEigenschaften(spiel) {
	const eigen = spiel.author === ich.player;
	return {
		gesperrt: eigen || !!ich.ansicht,
		text: (spiel.daumen ? String(spiel.daumen) : "") + (eigen ? (spiel.daumen ? " · " : "") + "eigenes Spiel" : ""),
		titel: eigen ? "Eigene Spiele kann man nicht bewerten – die Zahl zeigt die Daumen der anderen"
			: ich.ansicht ? "In der Ansicht als … wird nicht bewertet"
			: spiel.meinDaumen ? "Daumen zurücknehmen" : "Daumen hoch – zeigt dem Entwickler, dass dir das Spiel gefällt",
	};
}
async function daumenUmschalten(spiel) {
	try {
		const d = await Bridge.json("PUT", "/api/daumen/" + idPfad(spiel.id), { an: !spiel.meinDaumen });
		spiel.meinDaumen = d.an;
		spiel.daumen = d.daumen;
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung("Daumen nicht gespeichert: " + e.message, "fehler");
	}
}
function daumenKnopf(spiel, { klein, beiWechsel }) {
	const d = daumenEigenschaften(spiel);
	const k = UI.knopf({ art: "leise", groesse: klein ? "s" : undefined, ikon: "daumen", text: klein ? (spiel.daumen ? String(spiel.daumen) : "") : d.text,
		deaktiviert: d.gesperrt, titel: d.titel, onclick: async (ev) => { ev.stopPropagation(); await daumenUmschalten(spiel); beiWechsel(); } });
	k.title = d.titel;
	if (!k.textContent) k.setAttribute("aria-label", d.titel);
	k.dataset.daumen = "";
	k.setAttribute("aria-pressed", String(!!spiel.meinDaumen));
	return k;
}

// „Aktualisiert“: neue Version seit dem letzten Öffnen bzw. Spielen – nur bei Spielen, die man kennt, höchstens 30 Tage
const versionsZeit = (spiel) => (spiel.neu && spiel.neu.zeit) || spiel.geaendert;
function aktualisiert(spiel) {
	const neu = Date.parse(versionsZeit(spiel) || "");
	const basis = Date.parse((einstellungen.gesehen || {})[spiel.id] || spiel.zuletztGespielt || "");
	if (!neu || !basis) return false;
	return neu > basis && Date.now() - neu < 30 * 864e5;
}
function alsGesehenMerken(spiel) {
	const zeit = versionsZeit(spiel);
	if (!zeit) return;
	einstellungen.gesehen = { ...(einstellungen.gesehen || {}), [spiel.id]: zeit };
	Bridge.json("PUT", "/api/einstellungen", { gesehen: { [spiel.id]: zeit } })
		.then((d) => { einstellungen.gesehen = d.gesehen; })
		.catch(() => { /* nur eine Marke – nicht schlimm */ });
}

function spielPfad(id) {
	return Bridge.PLAY + "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/";
}

function kachel(spiel) {
	const marken = [];
	if (spiel.spielDerWoche) marken.push({ text: "Spiel der Woche", art: "warnung", ikon: "stern" });
	if (spiel.offline) marken.push({ text: "offline", art: "gefahr" });
	if (spiel.versteckt) marken.push({ text: "ausgeblendet", art: "gefahr" });
	else if (spiel.hervorgehoben) marken.push({ text: "Empfohlen", art: "akzent" });
	if (aktualisiert(spiel)) marken.push({ text: "Aktualisiert", art: "info" });
	const bild = spiel.vorschau || (spiel.thumbnail ? spielPfad(spiel.id) + spiel.thumbnail.split("/").map(encodeURIComponent).join("/") : null);
	const untertitel = "von " + anzeige(spiel.author) + (spiel.meineSpielzeit >= 60 ? " · du: " + dauer(spiel.meineSpielzeit) : "");
	const k = UI.spielkachel({
		titel: spiel.title, untertitel, beschreibung: spiel.warning ? "⚠ " + spiel.warning : spiel.description, bild, marken, spielId: spiel.id,
		href: spiel.complete ? "#/spiel/" + spiel.id : null, deaktiviert: spiel.complete ? false : "Unvollständig – index.html fehlt",
		favorit: einstellungen.favoriten.includes(spiel.id),
		onfavorit: async (an) => {
			const fav = new Set(einstellungen.favoriten);
			an ? fav.add(spiel.id) : fav.delete(spiel.id);
			await einstellungenSpeichern({ favoriten: [...fav] });
			uebersichtZeigen();
		},
		fuss: [daumenKnopf(spiel, { klein: true, beiWechsel: uebersichtZeigen })],
	});
	const img = k.querySelector(".b-kachel__bild img");
	if (img) img.addEventListener("error", () => { img.replaceWith(UI.ikon("spiel", { groesse: "xl" })); });
	return k;
}

// Die Bereiche der Startseite; Reihenfolge und Sichtbarkeit aus Einstellungen → Startseite
const ABSCHNITT_NAMEN = { weiterspielen: "Weiterspielen", favoriten: "Favoriten", neu: "Neu in der Bibliothek", "spiel-der-woche": "Spiel der Woche", alle: "Alle Spiele" };
let sdwDaten = null;

function werkzeugleiste(sichtbar) {
	const alleTags = [...new Set(sichtbar.flatMap((s) => s.tags || []))].sort((a, b) => a.localeCompare(b, "de"));
	if (tagFilter && !alleTags.includes(tagFilter)) tagFilter = null;
	const such = UI.suche({ id: "suche", platzhalter: "Spiele suchen …", label: "Spiele suchen", wert: suche,
		verzoegerung: 120, oninput: (w) => { suche = w; inhaltZeigen(); } });
	const tags = UI.leiste(alleTags.map((t) => UI.marke({ text: t, an: t === tagFilter, onclick: (ev) => {
		tagFilter = tagFilter === t ? null : t;
		for (const m of ev.currentTarget.parentElement.children) m.setAttribute("aria-pressed", String(m.textContent === tagFilter));
		inhaltZeigen();
	} })), { id: "tag-filter" });
	const sort = UI.auswahl({ id: "sortierung", wert: einstellungen.sortierung,
		optionen: [["alphabetisch", "Alphabetisch"], ["zuletzt", "Zuletzt gespielt"], ["neu", "Neueste zuerst"], ["meistgespielt", "Meistgespielt"]],
		onchange: async (w) => { await einstellungenSpeichern({ sortierung: w }); inhaltZeigen(); } });
	sort.eingabe.setAttribute("aria-label", "Spiele sortieren");
	return UI.stapel([UI.leiste([such, sort], { verteilt: true }), alleTags.length ? tags : null], { abstand: "s" });
}

function uebersichtZeigen() {
	const ue = el("uebersicht");
	const fokus = document.activeElement && document.activeElement.id === "suche";
	const sichtbar = spiele.filter((s) => !s.testspiel);   // Testspiele (Admin-Panel) erscheinen nie in der Übersicht
	if (!sichtbar.length) {
		ue.replaceChildren(UI.leer({ ikon: "spiel", titel: "Noch keine Spiele", text: ich.uploader ? "Lade das erste Spiel hoch – es erscheint dann hier." : "Sobald jemand ein Spiel hochlädt, erscheint es hier." }));
		return;
	}
	ue.replaceChildren(werkzeugleiste(sichtbar), UI.h("div", { id: "startseite", class: "b-stapel b-stapel--l" }));
	inhaltZeigen();
	if (fokus) { const s = el("suche"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

function inhaltZeigen() {
	const ziel = el("startseite");
	if (!ziel) return;
	const sichtbar = spiele.filter((s) => !s.testspiel);
	const q = suche.trim().toLowerCase();
	// Suche oder Kategorie aktiv: nur die Treffer, ohne Reihen
	if (q || tagFilter) {
		const treffer = sichtbar.filter((s) => (!tagFilter || (s.tags || []).includes(tagFilter)) &&
			(!q || [s.title, s.description, s.author, anzeige(s.author), ...(s.tags || [])].join(" ").toLowerCase().includes(q)));
		ziel.replaceChildren(UI.abschnitt({ titel: treffer.length === 1 ? "1 Spiel gefunden" : `${treffer.length} Spiele gefunden`,
			inhalt: treffer.length ? UI.raster(sortiert(treffer).map(kachel), { id: "kacheln" })
				: UI.leer({ klein: true, ikon: "suche", titel: "Keine Spiele gefunden", text: "Anderer Suchbegriff oder Kategorie abwählen." }) }));
		return;
	}
	const abschnitte = ((einstellungen.startseite || {}).abschnitte || Object.keys(ABSCHNITT_NAMEN).map((id) => ({ id, sichtbar: true })));
	const teile = [];
	// „Alle Spiele“ steht immer ganz unten und ist nicht einstellbar (Sebs Test 13.11.2026) – auch wenn ältere Einstellungen es verschoben oder ausgeblendet haben
	for (const a of abschnitte) {
		if (a.sichtbar === false || a.id === "alle") continue;
		const t = abschnittBauen(a.id, sichtbar);
		if (t) teile.push(t);
	}
	teile.push(abschnittBauen("alle", sichtbar));
	ziel.replaceChildren(...teile);
}

function abschnittBauen(id, sichtbar) {
	const titel = ABSCHNITT_NAMEN[id];
	const spielbar = sichtbar.filter((s) => s.complete);
	if (id === "weiterspielen") {
		const l = spielbar.filter((s) => s.zuletztGespielt).sort((a, b) => b.zuletztGespielt.localeCompare(a.zuletztGespielt)).slice(0, 12);
		return l.length ? UI.abschnitt({ id: "reihe-weiterspielen", titel, inhalt: UI.reihe(l.map(kachel)) }) : null;
	}
	if (id === "favoriten") {
		const fav = new Set(einstellungen.favoriten);
		const l = sortiert(sichtbar.filter((s) => fav.has(s.id)));
		return l.length ? UI.abschnitt({ id: "reihe-favoriten", titel, inhalt: UI.reihe(l.map(kachel)) }) : null;
	}
	if (id === "neu") {
		const l = sichtbar.filter((s) => s.geaendert && Date.now() - Date.parse(s.geaendert) < 60 * 864e5)
			.sort((a, b) => b.geaendert.localeCompare(a.geaendert)).slice(0, 12);
		return l.length ? UI.abschnitt({ id: "reihe-neu", titel, untertitel: "Neue Spiele und Updates der letzten zwei Monate", inhalt: UI.reihe(l.map(kachel)) }) : null;
	}
	if (id === "spiel-der-woche") return sdwDaten ? sdwKarte(sdwDaten) : null;
	if (id === "alle") {
		return UI.abschnitt({ id: "reihe-alle", titel, untertitel: sichtbar.length === 1 ? "1 Spiel" : `${sichtbar.length} Spiele`,
			inhalt: UI.raster(sortiert(sichtbar).map(kachel), { id: "kacheln" }) });
	}
	return null;
}

// ---------- Spiel der Woche (Zentrale 1.2.0) ----------
async function sdwLaden() {
	try { sdwDaten = await Bridge.json("GET", "/api/spiel-der-woche"); } catch { sdwDaten = null; }
	if (!el("uebersicht").hidden) inhaltZeigen();
}
function sdwKarte(d) {
	const tage = Math.max(0, Math.ceil((Date.parse(d.ende) - Date.now()) / 864e5));
	const top = d.bestenliste.slice(0, 3).map((e, i) => ({ platz: i + 1, name: anzeige(e.player), werte: [formatieren(e.score, d.format)] }));
	return UI.karte({ id: "sdw", titel: "Spiel der Woche: " + d.title, untertitel: `Noch ${tage} ${tage === 1 ? "Tag" : "Tage"} · eigene Bestenliste nur für diese Woche`,
		aktionen: [UI.knopf({ art: "primaer", text: "Jetzt spielen", ikon: "spielen", href: "#/spiel/" + d.id })],
		inhalt: top.length ? UI.rangliste({ eintraege: top, label: "Bestenliste dieser Woche" }) : UI.text("Noch keine Einträge diese Woche.", { art: "leise" }) });
}

// ---------- Spielansicht ----------
function spielansichtBauen() {
	const zurueck = UI.h("a", { class: "b-seite__zurueck", id: "spiel-zurueck", href: "#/" }, UI.ikon("winkel-links"), UI.h("span", { id: "spiel-zurueck-text", text: "Übersicht" }));
	const version = UI.marke({ text: "v", onclick: () => {} });
	version.id = "version-knopf"; version.hidden = true; version.title = "Versionsverlauf anzeigen";
	const vollbild = UI.knopf({ art: "standard", text: "Vollbild", ikon: "vollbild", id: "vollbild", onclick: () => {
		const r = el("rahmen"); if (r.requestFullscreen) r.requestFullscreen().catch(() => {});
	} });
	const season = UI.auswahl({ id: "bl-season", label: "Season", optionen: [], onchange: (w) => {
		const spiel = spiele.find((s) => s.id === aktuellesSpiel);
		if (spiel) bestenlisteZeigen(spiel, w === "woche" ? "woche" : +w);
	} });
	season.id = "bl-season-wahl"; season.hidden = true;
	const bestenliste = UI.karte({ id: "bestenliste", titel: "Bestenliste", inhalt: [season, UI.h("div", { id: "bl-liste" }), UI.text("", { id: "bl-hinweis", art: "leise" })] });
	bestenliste.querySelector(".b-karte__titel").id = "bl-titel";
	const erfolge = UI.karte({ id: "erfolge", titel: "Erfolge", inhalt: UI.h("div", { id: "erfolge-liste" }) });
	erfolge.querySelector(".b-karte__titel").id = "erfolge-titel";
	erfolge.hidden = true;
	const buehne = UI.buehne({ id: "buehne", rahmenId: "rahmen", seiteLabel: "Bestenliste und Erfolge", seite: [bestenliste, erfolge] });
	el("spielansicht").append(
		UI.h("div", { class: "b-seite__kopf" }, zurueck,
			UI.h("div", { class: "b-seite__titelzeile" },
				UI.h("div", { class: "b-leiste" }, UI.h("h1", { class: "b-seite__titel", id: "spieltitel" }), version),
				UI.h("div", { class: "b-seite__aktionen", id: "spiel-aktionen" }, UI.h("span", { id: "daumen-ort" }), vollbild))),
		UI.h("div", { id: "entwurf-hinweis", hidden: true }),
		UI.h("div", { id: "neu-hinweis", hidden: true }),
		UI.h("div", { id: "versionen-panel", hidden: true }),
		buehne);
}

async function bestenlisteZeigen(spiel, season) {
	if (season === undefined && spiel.spielDerWoche) season = "woche";   // Spiel der Woche: Wochen-Bestenliste zuerst
	const liste = el("bl-liste");
	const hinweis = el("bl-hinweis");
	el("bl-titel").textContent = "Bestenliste";
	el("bl-season-wahl").hidden = true;
	if (!spiel.leaderboard || !spiel.leaderboard.enabled) {
		liste.replaceChildren();
		hinweis.textContent = "Dieses Spiel hat keine Bestenliste.";
		return;
	}
	let d;
	try {
		d = await Bridge.bestenliste(spiel.id, season);
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) hinweis.textContent = "Bestenliste nicht verfügbar.";
		return;
	}
	if (aktuellesSpiel !== spiel.id) return; // inzwischen anderes Spiel offen

	el("bl-titel").textContent = (d.woche ? "Diese Woche" : "Bestenliste") + (d.rangiertNach === "score" ? " · " + d.label : "");
	if (d.seasons.length > 1 || d.spielDerWoche || d.woche) {
		const optionen = d.seasons.slice().reverse().map((s) => [String(s), s === d.currentSeason ? s + " (aktuell)" : String(s)]);
		if (d.spielDerWoche || d.woche) optionen.unshift(["woche", "Diese Woche"]);
		const wahl = el("bl-season");
		wahl.replaceChildren(...optionen.map(([w, t]) => UI.h("option", { value: w, text: t })));
		wahl.value = d.woche ? "woche" : String(d.season);
		el("bl-season-wahl").hidden = false;
	}
	// Spalten: eigener Rangwert/Zusatzwerte aus der game.json, sonst nur der Score
	const spalten = d.rangiertNach === "score"
		? [{ key: "score", label: d.label, format: d.format }, ...d.spalten]
		: d.spalten;
	const rangKey = d.rangiertNach === "score" ? "score" : d.rangiertNach;
	liste.replaceChildren(UI.rangliste({
		label: "Bestenliste", spalten: spalten.map((s) => ({ titel: s.label })), rang: Math.max(0, spalten.findIndex((s) => s.key === rangKey)),
		eintraege: d.entries.map((e) => ({
			platz: e.rank, name: anzeige(e.player), ich: e.player === ichSelbst,
			href: e.player.includes("~") ? null : "#/profil/" + encodeURIComponent(e.player), titel: "Profil von " + anzeigeMitHandle(e.player),
			werte: spalten.map((s) => formatieren(s.key === "score" ? e.score : e.werte?.[s.key], s.format)),
		})),
	}));
	hinweis.textContent = d.entries.length ? "" : d.woche ? "Diese Woche noch keine Einträge – sei die oder der Erste!"
		: (d.season === d.currentSeason ? "Noch keine Einträge – sei die oder der Erste!" : "In dieser Season gab es keine Einträge.");
}

// Versionsnummer neben dem Titel, Klick zeigt den Versionsverlauf (E35)
const ART_TEXT = { major: "Großes Update", minor: "Kleines Update", patch: "Patch / Hotfix", rollback: "Zurückgesetzt" };
function versionZeigen(spiel, entwurf) {
	const k = el("version-knopf"), panel = el("versionen-panel");
	panel.hidden = true;
	k.hidden = !!entwurf || !spiel.version;
	if (k.hidden) return;
	k.querySelector("span").textContent = "v" + spiel.version;
	k.onclick = async () => {
		if (!panel.hidden) { panel.hidden = true; k.setAttribute("aria-pressed", "false"); return; }
		panel.replaceChildren(UI.laden({ klein: true }));
		panel.hidden = false; k.setAttribute("aria-pressed", "true");
		try {
			const d = await Bridge.json("GET", "/api/versionen/" + idPfad(spiel.id));
			panel.replaceChildren(UI.karte({ titel: "Versionsverlauf", flach: true, inhalt: d.releases.length
				? UI.liste(d.releases.map((r) => ({ titel: `${r.version} · ${ART_TEXT[r.art] || ""}`, text: r.aenderungen.join(" · "),
					rechts: new Date(r.zeit).toLocaleDateString("de-DE") })), { ohneRahmen: true })
				: UI.text("Noch kein Verlauf.", { art: "leise" }) }));
		} catch (e) {
			if (!(e instanceof Bridge.SitzungAbgelaufen)) panel.replaceChildren(UI.hinweis({ art: "warnung", text: "Versionsverlauf nicht verfügbar." }));
		}
	};
}

function daumenZeigen(spiel, entwurf) {
	const ort = el("daumen-ort");
	if (entwurf) { ort.replaceChildren(); return; }
	const k = daumenKnopf(spiel, { beiWechsel: () => daumenZeigen(spiel, false) });
	k.id = "daumen";
	ort.replaceChildren(k);
}

// ---------- Spielzeit (Zentrale 1.2.0): nur solange der Tab sichtbar ist ----------
let zeit = null;   // { id, summe (ms), seit (ms oder null), neu }
function zeitStart(id) { zeitStop(); zeit = { id, summe: 0, seit: document.visibilityState === "visible" ? Date.now() : null, neu: true }; }
function zeitSenden(mindestens) {
	if (!zeit) return;
	const ms = zeit.summe + (zeit.seit ? Date.now() - zeit.seit : 0);
	if (ms < mindestens) return;
	const daten = { sekunden: Math.max(1, Math.min(120, Math.round(ms / 1000))), neu: zeit.neu };
	const id = zeit.id;
	zeit.summe = 0; zeit.neu = false; if (zeit.seit) zeit.seit = Date.now();
	Bridge.json("POST", "/api/spielzeit/" + idPfad(id), daten).catch(() => {});
}
function zeitStop() { zeitSenden(5000); zeit = null; }
document.addEventListener("visibilitychange", () => {
	if (!zeit) return;
	if (document.visibilityState === "hidden") { zeit.summe += zeit.seit ? Date.now() - zeit.seit : 0; zeit.seit = null; }
	else zeit.seit = Date.now();
});
setInterval(() => zeitSenden(30000), 60000);

// ---------- Erfolge im Spiel (Zentrale 1.2.0) ----------
async function erfolgeZeigen(spiel) {
	const box = el("erfolge");
	if (!spiel.erfolgeAnzahl) { box.hidden = true; return; }
	try {
		const liste = await Bridge.json("GET", "/api/erfolge/" + idPfad(spiel.id));
		if (aktuellesSpiel !== spiel.id) return;
		const frei = liste.filter((e) => e.freigeschaltet).length;
		el("erfolge-titel").textContent = `Erfolge ${frei}/${liste.length}`;
		el("erfolge-liste").replaceChildren(UI.liste(liste.map((e) => ({ ikon: e.freigeschaltet ? "pokal" : "schloss", titel: e.titel, text: e.beschreibung || "",
			klasse: e.freigeschaltet ? "" : "b-zeile--aus" })), { ohneRahmen: true, label: "Erfolge" }));
		box.hidden = false;
	} catch { box.hidden = true; }
}

function spielBeenden() {
	if (aktuellesSpiel === null) return;
	zeitStop();
	aktuellesSpiel = null;
	Bridge.beenden();
	el("rahmen").replaceChildren(); // laufendes Spiel beenden
}

function zeigeUebersicht() {
	spielBeenden();
	el("spielansicht").hidden = true;
	el("seite").hidden = true;
	el("uebersicht").hidden = false;
	document.title = titelVorsilbe() + "Spielebibliothek";
	uebersichtZeigen();
}

const titelVorsilbe = () => ich.design ? "🎨 " : ich.probe ? "🧪 " : "";

async function zeigeSeite(name) {
	spielBeenden();
	el("uebersicht").hidden = true;
	el("spielansicht").hidden = true;
	const seite = el("seite");
	seite.hidden = false;
	seite.replaceChildren();
	seite.classList.remove("b-seite--schmal");   // auch eine Anfrage nutzt die volle Breite (Seb, 13.11.2026)
	window.scrollTo(0, 0);
	// Konto-Seiten mit Seitenleiste – fremde Profile nicht (die gehören nicht zum eigenen Konto)
	const eigenesProfil = profilName === ich.player || profilName === `${ich.player}~${ich.ansicht}`;
	const konto = KONTO_SEITEN.some((s) => s.name === name) && (name !== "profil" || eigenesProfil);
	let ziel = seite;
	if (konto) {
		const leiste = UI.seitenleiste({ label: "Konto", aktiv: name, gruppen: [
			{ titel: "Konto", eintraege: KONTO_SEITEN.filter(darfSeite).map((s) => ({ id: s.name, text: s.text, ikon: s.ikon, href: "#/" + s.name })) },
			{ titel: "Weitere", eintraege: [...weitereZiele().map((z, i) => ({ id: "w" + i, text: z.text, ikon: z.ikon, href: z.href })),
				{ id: "abmelden", text: "Abmelden", ikon: "abmelden", href: "/cdn-cgi/access/logout" }] },
		] });
		leiste.id = "konto-leiste";
		ziel = UI.h("div", { class: "b-bereich__inhalt", id: "konto-inhalt" });
		seite.append(UI.h("div", { class: "b-bereich" }, leiste, ziel));
	}
	try { await seiten[name](ziel); }
	catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message, "fehler"); }
	// „Zurück“ über die Überschrift der Unterseite – außer im Konto-Bereich (dort gibt es die Seitenleiste)
	const titel = ziel.querySelector("h1");
	if (titel && !titel.classList.contains("b-seite__titel")) titel.classList.add("b-seite__titel");
	if (!konto || name === "antrag") {
		const zurueck = UI.h("a", { class: "b-seite__zurueck", id: "seite-zurueck", href: name === "antrag" ? antragZurueck : letzteRoute },
			UI.ikon("winkel-links"), UI.h("span", { text: name === "antrag" ? "Zurück" : letzteRoute.startsWith("#/spiel/") ? "Zurück zum Spiel" : "Übersicht" }));
		if (titel) titel.before(zurueck); else ziel.prepend(zurueck);
	}
	document.title = titelVorsilbe() + (titel ? titel.textContent + " – " : "") + "Spielebibliothek";
}

// Upload-Seite (für „Zurück zum Hochladen“ im Entwurf, 1.3.1) – Adresse aus dem Link in der Kopfleiste
const uploadAdresse = () => (el("upload-link").getAttribute("href") || "").replace(/\/+$/, "");

async function zeigeSpiel(id, entwurfSpiel, eigenerOrdner = null) {
	const spiel = entwurfSpiel || spiele.find((s) => s.id === id && s.complete);
	if (!spiel) {
		location.hash = "#/";
		return;
	}
	const eh = el("entwurf-hinweis");
	eh.hidden = !entwurfSpiel && !spiel.offline;
	if (!entwurfSpiel && spiel.offline) {
		eh.replaceChildren(UI.hinweis({ art: "warnung", titel: "Offline", text: "Andere Spieler sehen dieses Spiel gerade nicht." + (spiel.offlineGrund ? " Grund: " + spiel.offlineGrund : "") +
			" Wieder online stellen: Konto → Meine Spiele." }));
	}
	if (entwurfSpiel) {
		const text = (spiel.spielstaendeKopiert ? "Dein Spielstand wurde als Kopie übernommen. " : "Dein Spielstand im Entwurf ist getrennt vom echten. ") +
			"Bestenlisten-Einträge werden erst nach dem Veröffentlichen gespeichert.";
		eh.replaceChildren(UI.hinweis({ art: "warnung", titel: "Entwurf – nur du siehst ihn", text,
			aktion: eigenerOrdner ? UI.knopf({ art: "primaer", groesse: "s", text: "Zurück zum Hochladen und veröffentlichen", href: `${uploadAdresse()}/#spiel-${encodeURIComponent(eigenerOrdner)}` })
				: UI.text("Veröffentlichen auf der Upload-Seite.", { art: "klein" }) }));
	}
	// Zurück: im eigenen Entwurf zurück zur Upload-Seite (dort wird veröffentlicht), sonst zur Übersicht
	el("spiel-zurueck").href = eigenerOrdner ? `${uploadAdresse()}/#spiel-${encodeURIComponent(eigenerOrdner)}` : entwurfSpiel ? "#/meine-spiele" : "#/";
	el("spiel-zurueck-text").textContent = eigenerOrdner ? "Zurück zum Hochladen" : entwurfSpiel ? "Meine Spiele" : "Übersicht";
	const zeigeNeu = !entwurfSpiel && aktualisiert(spiel) && spiel.neu;
	const nh = el("neu-hinweis");
	nh.hidden = !zeigeNeu;
	if (zeigeNeu) nh.replaceChildren(UI.hinweis({ art: "akzent", schliessbar: true, onschliessen: () => { nh.hidden = true; },
		titel: spiel.version ? `Neu in Version ${spiel.version}` : "Neu in dieser Version", text: spiel.neu.text }));
	if (!entwurfSpiel) alsGesehenMerken(spiel);
	daumenZeigen(spiel, entwurfSpiel);
	versionZeigen(spiel, entwurfSpiel);
	el("erfolge").hidden = true;
	aktuellesSpiel = spiel.id;
	bestenlisteZeigen(spiel);
	el("spieltitel").textContent = spiel.title + (entwurfSpiel ? " (Entwurf)" : "");
	el("uebersicht").hidden = true;
	el("seite").hidden = true;
	el("spielansicht").hidden = false;
	el("buehne").gross(einstellungen.grossansicht);
	el("buehne").ohneSeite(einstellungen.bestenliste === false);
	document.title = titelVorsilbe() + spiel.title + (entwurfSpiel ? " (Entwurf)" : "") + " – Spielebibliothek";
	erfolgeZeigen(spiel);
	if (!entwurfSpiel) zeitStart(spiel.id);
	try {
		const iframe = await Bridge.starten(spiel, el("rahmen"));
		iframe.focus();
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			el("rahmen").replaceChildren();
			meldung("Das Spiel konnte nicht gestartet werden: " + e.message, "fehler");
			location.hash = "#/";
		}
	}
}

// Entwurf testen (nur Entwickler selbst und Admin – der Server prüft)
async function zeigeEntwurf(user, ordner) {
	try {
		const d = await Bridge.json("POST", `/api/entwickler/entwurf/${encodeURIComponent(user)}/${encodeURIComponent(ordner)}`);
		await zeigeSpiel(d.id, d, user === ich.player ? ordner : null);
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) { meldung("Entwurf nicht verfügbar: " + e.message, "fehler"); location.hash = "#/"; }
	}
}

function route() {
	const vorher = bisherigeRoute;
	bisherigeRoute = location.hash;
	const ent = location.hash.match(/^#\/entwurf\/([a-z0-9][a-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
	if (ent) { letzteRoute = location.hash; return zeigeEntwurf(ent[1], ent[2]); }
	const m = location.hash.match(/^#\/spiel\/(.+)$/);
	if (m && ID_MUSTER.test(m[1])) { letzteRoute = location.hash; return zeigeSpiel(m[1]); }
	if (location.hash === "#/anmeldungen") { location.replace("#/sicherheit"); return; }   // alte Links (vor 1.4.0)
	const pr = location.hash.match(/^#\/profil(?:\/([a-z0-9][a-z0-9_~-]*))?$/);
	if (pr) { profilName = pr[1] ? decodeURIComponent(pr[1]) : (ich.ansicht ? `${ich.player}~${ich.ansicht}` : ich.player); return zeigeSeite("profil"); }
	const an = location.hash.match(/^#\/antrag\/(\d{1,9})$/);
	if (an) {
		antragNr = +an[1];
		if (!vorher.startsWith("#/antrag/")) antragZurueck = vorher || "#/";   // nach „Erledigt“ usw. bleibt das Ziel gleich
		return zeigeSeite("antrag");
	}
	const s = location.hash.match(/^#\/([a-z-]+)(?:\?.*)?$/);
	if (s && seiten[s[1]]) return zeigeSeite(s[1]);
	letzteRoute = "#/";
	zeigeUebersicht();
}

// ---------- Glocke (Zentrale 1.2.0) ----------
let glockeDaten = { ungelesen: 0, liste: [] };
let glockeArchiv = false;
async function glockeLaden() {
	try { glockeDaten = await Bridge.json("GET", "/api/meldungen"); } catch { return; }
	el("glocke").hidden = false;
	el("glocke-zahl").textContent = String(glockeDaten.ungelesen);
	el("glocke-zahl").hidden = !glockeDaten.ungelesen;
	// Wichtig (Fehler in deinen Spielen, Anfragen): rote, wackelnde Glocke + einmalige Einblendung
	el("glocke-knopf").toggleAttribute("data-alarm", !!glockeDaten.wichtigUngelesen);
	const wichtige = glockeDaten.liste.filter((m) => m.neu && m.wichtig);
	let gezeigt = 0;
	try { gezeigt = +sessionStorage.getItem("glocke-alarm-bis") || 0; } catch { /* egal */ }
	if (wichtige.length && wichtige[0].id > gezeigt) {
		try { sessionStorage.setItem("glocke-alarm-bis", String(wichtige[0].id)); } catch { /* egal */ }
		alarmZeigen(wichtige);
	}
}
function alarmZeigen(wichtige) {
	let api;
	api = UI.dialog({ id: "alarm", titel: wichtige.length === 1 ? "Wichtige Meldung" : `${wichtige.length} wichtige Meldungen`,
		inhalt: UI.liste(wichtige.slice(0, 5).map((m) => ({ ikon: "warnung", titel: m.text, href: m.link || "#/", onclick: () => api.schliessen(null) })), { ohneRahmen: true }),
		aktionen: [UI.knopf({ art: "standard", text: "Später", onclick: () => api.schliessen(null) })] });
	api.element.querySelectorAll("a.b-zeile").forEach((a) => a.addEventListener("click", () => api.schliessen(null)));
	api.oeffnen();
}
async function glockeGeoeffnet() {
	glockeArchiv = false;
	await glockeListeZeigen();
	if (glockeDaten.ungelesen) {
		el("glocke-zahl").hidden = true;
		el("glocke-knopf").removeAttribute("data-alarm");
		try { await Bridge.json("POST", "/api/meldungen/gelesen"); glockeDaten.ungelesen = 0; glockeDaten.wichtigUngelesen = 0; } catch { /* egal */ }
	}
}
async function glockeListeZeigen() {
	const ziel = el("glocke-inhalt");
	let daten = glockeDaten;
	if (glockeArchiv) { try { daten = await Bridge.json("GET", "/api/meldungen?archiv=true"); } catch { return; } }
	const aktion = (ikonName, label, fn) => UI.knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: ikonName, label,
		onclick: async (e) => { e.stopPropagation(); try { await fn(); } catch { /* egal */ } await glockeLaden(); glockeListeZeigen(); } });
	const zeilen = daten.liste.map((m) => UI.zeile({
		titel: m.text, text: new Date(m.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }), href: m.link || "#/", pfeil: false,
		ungelesen: m.neu, ikon: m.wichtig ? "warnung" : undefined, gefahr: m.wichtig,
		aktionen: [glockeArchiv
			? aktion("pfeil-links", "Zurück in den Eingang", () => Bridge.json("POST", `/api/meldungen/${m.id}/zurueck`))
			: aktion("archiv", "Archivieren", () => Bridge.json("POST", `/api/meldungen/${m.id}/archivieren`)),
			aktion("loeschen", "Löschen", () => Bridge.json("DELETE", `/api/meldungen/${m.id}`))],
	}));
	const fuss = UI.leiste([
		UI.knopf({ art: "leise", groesse: "s", text: glockeArchiv ? "Zurück zum Eingang" : "Archiv ansehen", ikon: glockeArchiv ? "pfeil-links" : "archiv",
			onclick: (e) => { e.stopPropagation(); glockeArchiv = !glockeArchiv; glockeListeZeigen(); } }),
		!glockeArchiv && daten.liste.length ? UI.knopf({ art: "leise", groesse: "s", text: "Alle archivieren",
			onclick: async (e) => { e.stopPropagation(); await Bridge.json("POST", "/api/meldungen/alle-archivieren").catch(() => {}); await glockeLaden(); glockeListeZeigen(); } }) : null,
	], { verteilt: true });
	ziel.replaceChildren(
		UI.h("p", { class: "b-menue__titel", text: glockeArchiv ? "Archiv" : "Meldungen" }),
		zeilen.length ? UI.liste(zeilen, { ohneRahmen: true, label: "Meldungen" }) : UI.leer({ klein: true, ikon: "glocke", titel: glockeArchiv ? "Archiv ist leer." : "Keine Meldungen." }),
		UI.h("div", { class: "b-menue__trenner", role: "separator" }), fuss);
	// Klick auf eine Meldung schließt das Menü
	ziel.querySelectorAll("a.b-zeile").forEach((a) => a.addEventListener("click", () => el("glocke").menue.schliessen(false)));
}
function glockeEinrichten() {
	setInterval(glockeLaden, 120000);
	glockeLaden();
}

// Version der Zentrale in der Fußzeile (E39) – schreibt scripts/deploy.sh nach site/zentrale.json
function zentraleVersion() {
	fetch("/zentrale.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((z) => {
		if (z && z.version) el("zentrale-version").textContent = "Spielebibliothek " + z.version;
	}).catch(() => {});
}

async function start() {
	geruestBauen();
	zentraleVersion();
	el("uebersicht").replaceChildren(UI.laden({ art: "skelett", form: "kacheln", zeilen: 8 }));
	Bridge.beiAblauf = () => { el("abgelaufen").hidden = false; };
	Bridge.beiWieder = () => { el("abgelaufen").hidden = true; };
	Bridge.beiErfolg = (id, erfolg) => {
		UI.meldung("Erfolg freigeschaltet: " + erfolg.titel, { art: "erfolg" });
		const spiel = spiele.find((s) => s.id === id);
		if (spiel && aktuellesSpiel === id) erfolgeZeigen(spiel);
		glockeLaden();
	};
	Bridge.beiScore = (id) => {
		const spiel = spiele.find((s) => s.id === id);
		if (spiel && aktuellesSpiel === id) bestenlisteZeigen(spiel);
	};

	// Für Spieldateien und Vorschaubilder muss der Browser auch bei play.cuby0401.uk angemeldet sein
	if (!(await Bridge.sicherstellenPlay())) {
		el("uebersicht").replaceChildren(UI.leer({ ikon: "fehler", titel: "Anmeldung für die Spiele fehlgeschlagen", text: "Die Anmeldung bei play.cuby0401.uk hat nicht geklappt. Bitte Seite neu laden.",
			aktion: { text: "Neu laden", onclick: () => location.reload() } }));
		return;
	}

	try {
		const [wer, liste, einst] = await Promise.all([
			Bridge.json("GET", "/api/me"), Bridge.json("GET", "/api/games"), Bridge.json("GET", "/api/einstellungen")]);
		ich = wer;
		einstellungen = einst;
		if (einst.aussehen) UI.aussehenAnwenden(einst.aussehen);   // Thema, Farbe, Abstände, Kachelgröße des Spielers
		Bridge.spieler = ich.player;
		Bridge.konto = ich.konto;           // 1.5.0: Zwischenspeicher je Konto, bleibt bei Handle-Änderungen
		Bridge.sitzungBis = ich.sitzungBis;
		ichSelbst = ich.player;
		el("upload-link").hidden = !ich.uploader;
		if (ich.probe || ich.design) {
			el("probe-band-text").textContent = ich.design ? "Design-Spielwiese – eine Kopie nur über Tailscale. Nichts hier ist live."
				: "Probe-Zentrale – eine Kopie zum Testen. Nichts hier ist live, alle Änderungen bleiben hier.";
			el("probe-band").hidden = false;
		}
		kontoMenueEinrichten();
		glockeEinrichten();
		spiele = liste.filter((s) => typeof s.id === "string" && ID_MUSTER.test(s.id));
		sdwLaden();
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			el("uebersicht").replaceChildren(UI.leer({ ikon: "fehler", titel: e.status === 403 ? "Noch kein Konto" : "Spielliste nicht geladen",
				text: e.status === 403 ? "Für deine E-Mail-Adresse gibt es noch kein Konto in der Spielebibliothek. Bitte bei Seb melden."
					: "Die Spielliste konnte nicht geladen werden (" + e.message + ")." }));
		}
		return;
	}

	window.addEventListener("hashchange", route);
	route();

	// Was bei abgelaufener Anmeldung zwischengespeichert wurde, jetzt übertragen
	Bridge.nachreichen().then((n) => {
		if (n) meldung(n === 1 ? "1 zwischengespeicherte Änderung aus deiner letzten Sitzung wurde übertragen."
			: n + " zwischengespeicherte Änderungen aus deiner letzten Sitzung wurden übertragen.", "erfolg");
	});
}

start();
