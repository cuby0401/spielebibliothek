// Spielebibliothek – Bibliotheksseite
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Bibliotheksseite
//
// Spielliste kommt aus GET /api/games, Spiele laufen auf play.cuby0401.uk (E14),
// Speichern läuft über lib/bridge.js.
//
// Sicherheit: Alles aus game.json ist fremder Inhalt → nur per textContent einsetzen.
"use strict";

const ID_MUSTER = /^[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const el = (id) => document.getElementById(id);
let spiele = [];
let aktuellesSpiel = null;
let ichSelbst = null;
let ich = { player: null, uploader: false, admin: false };
let einstellungen = { sortierung: "alphabetisch", favoriten: [], grossansicht: false, bestenliste: true };
const seiten = {};   // Unterseiten aus dem Benutzermenü (konto.js): name → async (container) => {}
let letzteRoute = "#/";   // wohin der Zurück-Pfeil einer Unterseite führt
let suche = "", tagFilter = null;   // Suche und Kategorien in der Übersicht (Zentrale 1.2.0)
let profilName = null;              // für #/profil/<name>
let antragNr = null;                // für #/antrag/<id> (Zentrale 1.3.1)
let antragZurueck = "#/";           // Zurück-Pfeil in der Anfrage: dorthin, wo man herkam (Anfragen, Meine Spiele, Spiel)
let bisherigeRoute = "";
const idPfad = (id) => id.split("/").map(encodeURIComponent).join("/");

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

	el("bl-titel").textContent = (d.woche ? "⭐ Diese Woche" : "Bestenliste") + (d.rangiertNach === "score" ? " · " + d.label : "");
	if (d.seasons.length > 1 || d.spielDerWoche || d.woche) {
		const wahl = el("bl-season");
		const optionen = d.seasons.slice().reverse().map((s) => {
			const o = document.createElement("option");
			o.value = String(s);
			o.textContent = s === d.currentSeason ? s + " (aktuell)" : String(s);
			o.selected = !d.woche && s === d.season;
			return o;
		});
		if (d.spielDerWoche || d.woche) {
			const o = document.createElement("option");
			o.value = "woche"; o.textContent = "⭐ Diese Woche"; o.selected = !!d.woche;
			optionen.unshift(o);
		}
		wahl.replaceChildren(...optionen);
		el("bl-season-wahl").hidden = false;
	}
	// Spalten: eigener Rangwert/Zusatzwerte aus der game.json, sonst nur der Score
	const spalten = d.rangiertNach === "score"
		? [{ key: "score", label: d.label, format: d.format }, ...d.spalten]
		: d.spalten;
	liste.classList.toggle("mehrspaltig", spalten.length > 1);
	liste.replaceChildren(...d.entries.map((e) => {
		const li = document.createElement("li");
		if (e.player === ichSelbst) li.className = "ich";
		const platz = document.createElement("span"); platz.className = "platz"; platz.textContent = e.rank + ".";
		const name = document.createElement(e.player.includes("~") ? "span" : "a"); name.className = "name"; name.textContent = e.player;
		if (!e.player.includes("~")) { name.href = "#/profil/" + encodeURIComponent(e.player); name.title = "Profil von " + e.player; }
		li.append(platz, name);
		const werte = document.createElement("span"); werte.className = "werte";
		for (const s of spalten) {
			const w = document.createElement("span");
			w.className = s.key === (d.rangiertNach === "score" ? "score" : d.rangiertNach) ? "wert rang" : "wert";
			w.title = s.label;
			w.textContent = formatieren(s.key === "score" ? e.score : e.werte?.[s.key], s.format);
			werte.append(w);
		}
		li.append(werte);
		return li;
	}));
	if (spalten.length > 1) {
		const kopf = document.createElement("li"); kopf.className = "kopfzeile";
		const leer1 = document.createElement("span"); leer1.className = "platz";
		const leer2 = document.createElement("span"); leer2.className = "name";
		const titel = document.createElement("span"); titel.className = "werte";
		for (const s of spalten) { const t = document.createElement("span"); t.className = "wert"; t.textContent = s.label; titel.append(t); }
		kopf.append(leer1, leer2, titel);
		liste.prepend(kopf);
	}
	hinweis.textContent = d.entries.length ? "" : d.woche ? "Diese Woche noch keine Einträge – sei die oder der Erste!"
		: (d.season === d.currentSeason ? "Noch keine Einträge – sei die oder der Erste!" : "In dieser Season gab es keine Einträge.");
}

// Meldungen als Pop-up oben im Fenster (1.4.0, Sebs Nachtest 08.11.2026): Vorher standen sie oben auf der Seite und fielen nicht auf.
// Hinweise und Erfolge verschwinden nach 8 s, Fehler ("fehler") und Dauerhinweise ("bleibt") bleiben bis zum Klick.
let meldungWeg;
function meldung(text, art = "") {
	const m = document.getElementById("meldung");
	clearTimeout(meldungWeg);
	m.textContent = text || "";
	m.className = "meldung " + art;
	m.hidden = !text;
	m.title = text ? "Klicken zum Schließen" : "";
	if (text && art !== "fehler" && art !== "bleibt") meldungWeg = setTimeout(() => { m.hidden = true; }, 8000);
}
document.addEventListener("click", (e) => { if (e.target.id === "meldung") e.target.hidden = true; });

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

// Kategorien als Filter-Chips (aus "tags" der game.json)
function tagFilterZeigen(liste) {
	const alle = [...new Set(liste.flatMap((s) => s.tags || []))].sort((a, b) => a.localeCompare(b, "de"));
	if (tagFilter && !alle.includes(tagFilter)) tagFilter = null;
	el("tag-filter").replaceChildren(...alle.map((t) => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "tag" + (t === tagFilter ? " an" : "");
		b.textContent = t;
		b.onclick = () => { tagFilter = tagFilter === t ? null : t; kachelnZeigen(); };
		return b;
	}));
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

// Versionsnummer neben dem Titel, Klick zeigt den Versionsverlauf (E35)
const ART_TEXT = { major: "Großes Update", minor: "Kleines Update", patch: "Patch / Hotfix", rollback: "Zurückgesetzt" };
function versionZeigen(spiel, entwurf) {
	const k = el("version-knopf"), panel = el("versionen-panel");
	panel.hidden = true;
	k.hidden = !!entwurf || !spiel.version;
	if (k.hidden) return;
	k.textContent = "v" + spiel.version;
	k.onclick = async () => {
		if (!panel.hidden) { panel.hidden = true; return; }
		panel.replaceChildren(Object.assign(document.createElement("span"), { className: "leise", textContent: "Lade …" }));
		panel.hidden = false;
		try {
			const d = await Bridge.json("GET", "/api/versionen/" + spiel.id.split("/").map(encodeURIComponent).join("/"));
			const titel = document.createElement("h3"); titel.textContent = "Versionsverlauf";
			const ul = document.createElement("ul");
			for (const r of d.releases) {
				const li = document.createElement("li");
				const kopf = document.createElement("strong"); kopf.textContent = r.version;
				const info = document.createElement("span"); info.className = "leise";
				info.textContent = ` · ${ART_TEXT[r.art] || ""} · ${new Date(r.zeit).toLocaleDateString("de-DE")} – `;
				li.append(kopf, info, document.createTextNode(r.aenderungen.join(" · ")));
				ul.append(li);
			}
			panel.replaceChildren(titel, d.releases.length ? ul : Object.assign(document.createElement("span"), { className: "leise", textContent: "Noch kein Verlauf." }));
		} catch (e) {
			if (!(e instanceof Bridge.SitzungAbgelaufen)) panel.textContent = "Versionsverlauf nicht verfügbar.";
		}
	};
}

function daumenZeigen(spiel, entwurf) {
	const k = el("daumen");
	k.hidden = !!entwurf;
	if (entwurf) return;
	const d = daumenEigenschaften(spiel);
	k.replaceChildren(ikon("daumen"), d.text ? Object.assign(document.createElement("span"), { textContent: d.text }) : "");
	k.title = d.titel;
	k.disabled = d.gesperrt;
	k.classList.toggle("an", !!spiel.meinDaumen);
	k.onclick = async () => { await daumenUmschalten(spiel); daumenZeigen(spiel, false); };
}

function kachelnZeigen() {
	el("sortierung").value = einstellungen.sortierung;
	// Testspiele (Admin-Panel) erscheinen nie in der Übersicht – Admins öffnen sie über das Admin-Panel
	const sichtbar = spiele.filter((s) => !s.testspiel);
	tagFilterZeigen(sichtbar);
	const q = suche.trim().toLowerCase();
	const treffer = sichtbar.filter((s) => (!tagFilter || (s.tags || []).includes(tagFilter)) &&
		(!q || [s.title, s.description, s.author, ...(s.tags || [])].join(" ").toLowerCase().includes(q)));
	el("kacheln").replaceChildren(...sortiert(treffer).map(kachel));
	if (sichtbar.length && !treffer.length) {
		const leer = document.createElement("p");
		leer.className = "leise";
		leer.textContent = "Keine Spiele gefunden.";
		el("kacheln").append(leer);
	}
}

function spielPfad(id) {
	return Bridge.PLAY + "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/";
}

function kachel(spiel) {
	const k = document.createElement("article");
	k.className = "kachel";

	const bild = document.createElement("div");
	bild.className = "bild";
	if (spiel.vorschau || spiel.thumbnail) {
		const img = document.createElement("img");
		// Vorschaubild von der Upload-Seite (Steckbrief) gilt vor dem thumbnail aus der game.json
		img.src = spiel.vorschau || spielPfad(spiel.id) + spiel.thumbnail.split("/").map(encodeURIComponent).join("/");
		img.alt = "";
		img.loading = "lazy";
		img.onerror = () => { img.remove(); bild.textContent = "🎮"; };
		bild.append(img);
	} else {
		bild.textContent = "🎮";
	}

	const stern = document.createElement("button");
	const istFav = einstellungen.favoriten.includes(spiel.id);
	stern.type = "button";
	stern.className = "stern" + (istFav ? " an" : "");
	stern.textContent = istFav ? "★" : "☆";
	stern.title = istFav ? "Aus den Favoriten entfernen" : "Als Favorit oben anheften";
	stern.onclick = async () => {
		const fav = new Set(einstellungen.favoriten);
		fav.has(spiel.id) ? fav.delete(spiel.id) : fav.add(spiel.id);
		await einstellungenSpeichern({ favoriten: [...fav] });
		kachelnZeigen();
	};
	bild.append(stern);
	const marken = document.createElement("div");
	marken.className = "marken";
	const marke = (text, klasse, titel) => {
		const m = document.createElement("span");
		m.className = "marke-klein" + (klasse ? " " + klasse : "");
		m.textContent = text;
		if (titel) m.title = titel;
		marken.append(m);
	};
	if (spiel.spielDerWoche) marke("⭐ Spiel der Woche", "sdw");
	if (spiel.offline) marke("offline", "versteckt", spiel.offlineGrund ? "Offline: " + spiel.offlineGrund : "vom Entwickler offline genommen");
	if (spiel.versteckt) marke("ausgeblendet", "versteckt");
	else if (spiel.hervorgehoben) marke("Empfohlen");
	if (aktualisiert(spiel)) marke("Aktualisiert", "aktualisiert", spiel.neu ? "Neu: " + spiel.neu.text : "");
	if (marken.childElementCount) bild.append(marken);

	const inhalt = document.createElement("div");
	inhalt.className = "inhalt";
	const h = document.createElement("h2");
	h.textContent = spiel.title;
	const autor = document.createElement("span");
	autor.className = "autor";
	autor.textContent = "von " + spiel.author + (spiel.meineSpielzeit >= 60 ? " · du: " + dauer(spiel.meineSpielzeit) : "");
	const text = document.createElement("p");
	text.className = "beschreibung";
	text.textContent = spiel.description;
	inhalt.append(h, autor, text);
	if (spiel.tags && spiel.tags.length) {
		const t = document.createElement("div");
		t.className = "tags";
		for (const tag of spiel.tags) {
			const b = document.createElement("button");
			b.type = "button"; b.className = "tag klein"; b.textContent = tag;
			b.onclick = () => { tagFilter = tag; kachelnZeigen(); };
			t.append(b);
		}
		inhalt.append(t);
	}

	if (spiel.warning) {
		const w = document.createElement("p");
		w.className = "warnung";
		w.textContent = "⚠ " + spiel.warning;
		inhalt.append(w);
	}

	const a = document.createElement("a");
	a.className = "knopf";
	if (spiel.complete) {
		a.href = "#/spiel/" + spiel.id;
		a.textContent = "Spielen";
	} else {
		a.textContent = "unvollständig";
		a.setAttribute("aria-disabled", "true");
		a.title = "index.html fehlt";
	}
	const fuss = document.createElement("div");
	fuss.className = "kachel-fuss";
	const daumen = document.createElement("button");
	const dd = daumenEigenschaften(spiel);
	daumen.type = "button";
	daumen.className = "knopf leise daumen klein" + (spiel.meinDaumen ? " an" : "");
	daumen.replaceChildren(ikon("daumen"), spiel.daumen ? Object.assign(document.createElement("span"), { textContent: String(spiel.daumen) }) : "");
	daumen.title = dd.titel;
	daumen.disabled = dd.gesperrt;
	daumen.onclick = async () => { await daumenUmschalten(spiel); kachelnZeigen(); };
	fuss.append(a, daumen);
	inhalt.append(fuss);

	k.append(bild, inhalt);
	return k;
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
		const titel = document.createElement("h3");
		titel.textContent = `Erfolge ${frei}/${liste.length}`;
		const ul = document.createElement("ul");
		for (const e of liste) {
			const li = document.createElement("li");
			li.className = e.freigeschaltet ? "frei" : "";
			li.textContent = (e.freigeschaltet ? "🏆 " : "🔒 ") + e.titel;
			li.title = e.beschreibung || "";
			ul.append(li);
		}
		box.replaceChildren(titel, ul);
		box.hidden = false;
	} catch { box.hidden = true; }
}

let toastTimer;
function toast(text) {
	el("toast").textContent = text;
	el("toast").hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { el("toast").hidden = true; }, 5000);
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
	document.title = "Spielebibliothek";
	kachelnZeigen();
}

async function zeigeSeite(name) {
	spielBeenden();
	el("uebersicht").hidden = true;
	el("spielansicht").hidden = true;
	el("seite").hidden = false;
	const zurueck = document.createElement("a");
	zurueck.className = "zurueck-pfeil";
	zurueck.href = name === "antrag" ? antragZurueck : letzteRoute;
	zurueck.textContent = "←";
	zurueck.title = name === "antrag" ? "Zurück" : letzteRoute.startsWith("#/spiel/") ? "Zurück zum Spiel" : "Zurück zur Übersicht";
	zurueck.setAttribute("aria-label", zurueck.title);
	el("seite").replaceChildren();
	meldung("");
	// Konto-Seiten mit Leiste – fremde Profile nicht (die gehören nicht zum eigenen Konto)
	const eigenesProfil = profilName === ich.player || profilName === `${ich.player}~${ich.ansicht}`;
	const konto = KONTO_SEITEN.some((s) => s.name === name) && (name !== "profil" || eigenesProfil);
	const ziel = konto ? kontoRahmen(name) : el("seite");
	try { await seiten[name](ziel); }
	catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message, "fehler"); }
	// Pfeil unauffällig links neben die Überschrift der Unterseite
	const titel = ziel.querySelector("h1");
	const kopf = document.createElement("div");
	kopf.className = "seitenkopf";
	if (titel) { titel.replaceWith(kopf); kopf.append(zurueck, titel); }
	else { kopf.append(zurueck); ziel.prepend(kopf); }
}

// Upload-Seite (für „Zurück zum Hochladen“ im Entwurf, 1.3.1) – Adresse aus dem Link in der Taskleiste
const uploadAdresse = () => (el("upload-link").getAttribute("href") || "").replace(/\/+$/, "");

async function zeigeSpiel(id, entwurfSpiel, eigenerOrdner = null) {
	const spiel = entwurfSpiel || spiele.find((s) => s.id === id && s.complete);
	if (!spiel) {
		location.hash = "#/";
		return;
	}
	el("entwurf-hinweis").hidden = !entwurfSpiel && !spiel.offline;
	if (!entwurfSpiel && spiel.offline) {
		el("entwurf-hinweis").textContent = "Offline – andere Spieler sehen dieses Spiel gerade nicht." + (spiel.offlineGrund ? " Grund: " + spiel.offlineGrund : "") +
			" Wieder online stellen: Konto → Meine Spiele.";
	}
	if (entwurfSpiel) {
		el("entwurf-hinweis").textContent = "Entwurf – nur du siehst ihn. " +
			(spiel.spielstaendeKopiert ? "Dein Spielstand wurde als Kopie übernommen. " : "Dein Spielstand im Entwurf ist getrennt vom echten. ") +
			"Bestenlisten-Einträge werden erst nach dem Veröffentlichen gespeichert. ";
		if (eigenerOrdner) {
			const los = document.createElement("a");
			los.href = `${uploadAdresse()}/#spiel-${encodeURIComponent(eigenerOrdner)}`;
			los.textContent = "Zurück zum Hochladen und veröffentlichen →";
			el("entwurf-hinweis").append(los);
		} else el("entwurf-hinweis").append("Veröffentlichen auf der Upload-Seite.");
	}
	// Zurück-Knopf: im eigenen Entwurf zurück zur Upload-Seite (dort wird veröffentlicht), sonst zur Übersicht
	const zurueckKnopf = el("spiel-zurueck");
	zurueckKnopf.href = eigenerOrdner ? `${uploadAdresse()}/#spiel-${encodeURIComponent(eigenerOrdner)}` : entwurfSpiel ? "#/meine-spiele" : "#/";
	zurueckKnopf.textContent = eigenerOrdner ? "← Zurück zum Hochladen" : entwurfSpiel ? "← Meine Spiele" : "← Übersicht";
	const zeigeNeu = !entwurfSpiel && aktualisiert(spiel) && spiel.neu;
	el("neu-hinweis").hidden = !zeigeNeu;
	if (zeigeNeu) {
		el("neu-text").textContent = (spiel.version ? `Neu in Version ${spiel.version}: ` : "Neu in dieser Version: ") + spiel.neu.text;
		el("neu-zu").onclick = () => { el("neu-hinweis").hidden = true; };
	}
	if (!entwurfSpiel) alsGesehenMerken(spiel);
	daumenZeigen(spiel, entwurfSpiel);
	versionZeigen(spiel, entwurfSpiel);
	el("erfolge").hidden = true;
	aktuellesSpiel = spiel.id;
	bestenlisteZeigen(spiel);
	el("spieltitel").textContent = spiel.title;
	el("uebersicht").hidden = true;
	el("seite").hidden = true;
	el("spielansicht").hidden = false;
	el("spielansicht").classList.toggle("gross", einstellungen.grossansicht);
	el("spielansicht").classList.toggle("ohne-bestenliste", !einstellungen.bestenliste);
	document.title = spiel.title + (entwurfSpiel ? " (Entwurf)" : "") + " – Spielebibliothek";
	if (entwurfSpiel) el("spieltitel").textContent = spiel.title + " (Entwurf)";
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

// Initialen-Bild (Zentrale 1.4.0): feste Farbe je Benutzername, bis es hochladbare Profilbilder gibt
function avatarFuellen(ziel, name, anzeigename) {
	const text = String(anzeigename || name || "?").trim();
	const teile = text.split(/[\s._-]+/).filter(Boolean);
	ziel.textContent = ((teile[0] || "?")[0] + (teile.length > 1 ? teile[1][0] : (teile[0] || "")[1] || "")).toUpperCase();
	let n = 0;
	for (const z of String(name || text)) n = (n * 31 + z.charCodeAt(0)) >>> 0;
	ziel.style.setProperty("--avatar-farbe", `hsl(${n % 360} 55% 42%)`);
	return ziel;
}

const TESTSERVER = "https://test.cuby0401.uk";   // Probe = Testserver (1.4.0, E76)

// Konto-Bereich (Zentrale 1.4.0): diese Seiten bekommen die Leiste links (Handy: oben)
const KONTO_SEITEN = [
	{ name: "profil", text: "Profil" },
	{ name: "meine-spiele", text: "Meine Spiele", rolle: "entwickler" },
	{ name: "spielstaende", text: "Meine Spielstände" },
	{ name: "antraege", text: "Anfragen" },
	{ name: "einstellungen", text: "Einstellungen" },
	{ name: "sicherheit", text: "Sicherheit" },
];
function kontoRahmen(aktiv) {
	const leiste = document.createElement("nav");
	leiste.className = "konto-leiste";
	leiste.setAttribute("aria-label", "Konto");
	const darf = { entwickler: ich.uploader || ich.admin };
	for (const s of KONTO_SEITEN) {
		if (s.rolle && !darf[s.rolle]) continue;
		const a = document.createElement("a");
		a.href = "#/" + s.name; a.textContent = s.text;
		if (s.name === aktiv) { a.className = "aktiv"; a.setAttribute("aria-current", "page"); }
		leiste.append(a);
	}
	const unten = document.createElement("div");
	unten.className = "konto-leiste-unten";
	if (ich.admin) unten.append(Object.assign(document.createElement("a"), { href: "/admin/", textContent: "Admin-Panel" }));
	// Tester-Panel (1.4.0, E76): auf dem Testserver für alle (den Zugang regelt Cloudflare Access), live für die Rolle Tester
	if (ich.probe) unten.append(Object.assign(document.createElement("a"), { href: "/tester/", textContent: "Tester-Panel" }));
	else if (ich.tester) unten.append(Object.assign(document.createElement("a"), { href: TESTSERVER + "/tester/", target: "_blank", rel: "noopener", textContent: "Tester-Panel ↗" }));
	unten.append(Object.assign(document.createElement("a"), { href: "/cdn-cgi/access/logout", textContent: "Abmelden" }));
	leiste.append(unten);
	const inhalt = document.createElement("div");
	inhalt.className = "konto-inhalt";
	const rahmen = document.createElement("div");
	rahmen.className = "konto";
	rahmen.append(leiste, inhalt);
	el("seite").append(rahmen);
	return inhalt;
}
function menueEinrichten() {
	// Zentrale 1.4.0: kein Aufklappmenü mehr – der Name führt ins Konto (Profil), Admins haben zusätzlich „Admin“ oben
	const knopf = el("menue-knopf");
	knopf.hidden = false;
	avatarFuellen(el("avatar"), ich.player);
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

// ---------- Glocke (Zentrale 1.2.0) ----------
let glockeDaten = { ungelesen: 0, liste: [] };
async function glockeLaden() {
	try { glockeDaten = await Bridge.json("GET", "/api/meldungen"); } catch { return; }
	el("glocke").hidden = false;
	el("glocke-zahl").textContent = String(glockeDaten.ungelesen);
	el("glocke-zahl").hidden = !glockeDaten.ungelesen;
	// Wichtig (Fehler in deinen Spielen, Anfragen): rote, wackelnde Glocke + einmalige Einblendung
	el("glocke-knopf").classList.toggle("alarm", !!glockeDaten.wichtigUngelesen);
	const wichtige = glockeDaten.liste.filter((m) => m.neu && m.wichtig);
	let gezeigt = 0;
	try { gezeigt = +sessionStorage.getItem("glocke-alarm-bis") || 0; } catch { /* egal */ }
	if (wichtige.length && wichtige[0].id > gezeigt) {
		try { sessionStorage.setItem("glocke-alarm-bis", String(wichtige[0].id)); } catch { /* egal */ }
		alarmZeigen(wichtige);
	}
}
function alarmZeigen(wichtige) {
	const box = el("alarm");
	const titel = document.createElement("strong");
	titel.textContent = wichtige.length === 1 ? "⚠ Wichtige Meldung" : `⚠ ${wichtige.length} wichtige Meldungen`;
	const ul = document.createElement("ul");
	for (const m of wichtige.slice(0, 5)) {
		const li = document.createElement("li");
		const a = document.createElement("a"); a.href = m.link || "#/"; a.textContent = m.text;
		a.onclick = () => { box.hidden = true; };
		li.append(a); ul.append(li);
	}
	const zu = document.createElement("button");
	zu.type = "button"; zu.className = "knopf klein"; zu.textContent = "Später";
	zu.onclick = () => { box.hidden = true; };
	box.replaceChildren(titel, ul, zu);
	box.hidden = false;
}
let glockeArchiv = false;
async function glockeListeZeigen() {
	const liste = el("glocke-liste");
	let daten = glockeDaten;
	if (glockeArchiv) { try { daten = await Bridge.json("GET", "/api/meldungen?archiv=true"); } catch { return; } }
	const knopf = (text, titel, aktion) => {
		const b = document.createElement("button");
		b.type = "button"; b.textContent = text; b.title = titel;
		b.onclick = async (e) => { e.stopPropagation(); try { await aktion(); } catch { /* egal */ } await glockeLaden(); glockeListeZeigen(); };
		return b;
	};
	const zeilen = daten.liste.map((m) => {
		const a = document.createElement("a");
		a.href = m.link || "#/";
		a.className = (m.neu ? "neu" : "") + (m.wichtig ? " wichtig" : "");
		const t = document.createElement("span"); t.textContent = m.text;
		const z = document.createElement("small"); z.className = "leise"; z.textContent = new Date(m.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
		a.append(t, z);
		const akt = document.createElement("div");
		akt.className = "aktionen";
		akt.append(glockeArchiv
			? knopf("Zurück", "Zurück in den Eingang", () => Bridge.json("POST", `/api/meldungen/${m.id}/zurueck`))
			: knopf("Archiv", "Archivieren", () => Bridge.json("POST", `/api/meldungen/${m.id}/archivieren`)),
			knopf("Löschen", "Endgültig löschen", () => Bridge.json("DELETE", `/api/meldungen/${m.id}`)));
		const zeile = document.createElement("div");
		zeile.className = "meldung-zeile";
		zeile.append(a, akt);
		return zeile;
	});
	const fuss = document.createElement("div");
	fuss.className = "glocke-fuss";
	const umschalten = document.createElement("button");
	umschalten.type = "button";
	umschalten.textContent = glockeArchiv ? "Zurück zum Eingang" : "Archiv ansehen";
	umschalten.onclick = (e) => { e.stopPropagation(); glockeArchiv = !glockeArchiv; glockeListeZeigen(); };
	fuss.append(umschalten);
	if (!glockeArchiv && daten.liste.length) {
		const alle = document.createElement("button");
		alle.type = "button"; alle.textContent = "Alle archivieren";
		alle.onclick = async (e) => { e.stopPropagation(); await Bridge.json("POST", "/api/meldungen/alle-archivieren").catch(() => {}); await glockeLaden(); glockeListeZeigen(); };
		fuss.append(alle);
	}
	liste.replaceChildren(...(zeilen.length ? zeilen : [Object.assign(document.createElement("span"), {
		className: "leise leer", textContent: glockeArchiv ? "Archiv ist leer." : "Keine Meldungen." })]), fuss);
}
function glockeEinrichten() {
	el("glocke-ikon").replaceWith(ikon("glocke"));
	const knopf = el("glocke-knopf"), liste = el("glocke-liste");
	knopf.onclick = async (e) => {
		e.stopPropagation();
		if (!liste.hidden) { liste.hidden = true; return; }
		glockeArchiv = false;
		await glockeListeZeigen();
		liste.hidden = false;
		if (glockeDaten.ungelesen) {
			el("glocke-zahl").hidden = true;
			el("glocke-knopf").classList.remove("alarm");
			try { await Bridge.json("POST", "/api/meldungen/gelesen"); glockeDaten.ungelesen = 0; glockeDaten.wichtigUngelesen = 0; } catch { /* egal */ }
		}
	};
	document.addEventListener("click", (e) => { if (!liste.contains(e.target)) liste.hidden = true; });
	setInterval(glockeLaden, 120000);
	glockeLaden();
}

// ---------- Spiel der Woche (Zentrale 1.2.0) ----------
async function sdwZeigen() {
	let d = null;
	try { d = await Bridge.json("GET", "/api/spiel-der-woche"); } catch { /* egal */ }
	const box = el("sdw");
	box.hidden = !d;
	if (!d) return;
	const tage = Math.max(0, Math.ceil((Date.parse(d.ende) - Date.now()) / 864e5));
	const kopf = document.createElement("div");
	kopf.className = "sdw-kopf";
	const titel = document.createElement("strong"); titel.textContent = "⭐ Spiel der Woche: " + d.title;
	const rest = document.createElement("span"); rest.className = "leise"; rest.textContent = ` · noch ${tage} ${tage === 1 ? "Tag" : "Tage"} · eigene Bestenliste nur für diese Woche`;
	const los = document.createElement("a"); los.className = "knopf"; los.href = "#/spiel/" + d.id; los.textContent = "Jetzt spielen";
	kopf.append(titel, rest);
	const top = document.createElement("ol");
	for (const e of d.bestenliste.slice(0, 3)) {
		const li = document.createElement("li");
		li.textContent = `${e.player} – ${formatieren(e.score, d.format)}`;
		top.append(li);
	}
	if (!d.bestenliste.length) top.append(Object.assign(document.createElement("li"), { className: "leise", textContent: "Noch keine Einträge diese Woche." }));
	box.replaceChildren(kopf, top, los);
}

// Version der Zentrale in der Fußzeile (E39) – schreibt scripts/deploy.sh nach site/zentrale.json
function zentraleVersion() {
	fetch("/zentrale.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((z) => {
		if (z && z.version) el("zentrale-version").textContent = "Spielebibliothek " + z.version;
	}).catch(() => {});
}

async function start() {
	zentraleVersion();
	Bridge.beiAblauf = () => { el("abgelaufen").hidden = false; };
	Bridge.beiWieder = () => { el("abgelaufen").hidden = true; };
	Bridge.beiErfolg = (id, erfolg) => {
		toast("🏆 Erfolg freigeschaltet: " + erfolg.titel);
		const spiel = spiele.find((s) => s.id === id);
		if (spiel && aktuellesSpiel === id) erfolgeZeigen(spiel);
		glockeLaden();
	};
	Bridge.beiScore = (id) => {
		const spiel = spiele.find((s) => s.id === id);
		if (spiel && aktuellesSpiel === id) bestenlisteZeigen(spiel);
	};
	el("bl-season").addEventListener("change", (e) => {
		const spiel = spiele.find((s) => s.id === aktuellesSpiel);
		if (spiel) bestenlisteZeigen(spiel, e.target.value === "woche" ? "woche" : +e.target.value);
	});
	el("vollbild").addEventListener("click", () => {
		const r = el("rahmen");
		if (r.requestFullscreen) r.requestFullscreen().catch(() => {});
	});

	// Für Spieldateien und Vorschaubilder muss der Browser auch bei play.cuby0401.uk angemeldet sein
	if (!(await Bridge.sicherstellenPlay())) {
		meldung("Die Anmeldung für die Spiele (play.cuby0401.uk) hat nicht geklappt. Bitte Seite neu laden.", "fehler");
		return;
	}

	try {
		const [wer, liste, einst] = await Promise.all([
			Bridge.json("GET", "/api/me"), Bridge.json("GET", "/api/games"), Bridge.json("GET", "/api/einstellungen")]);
		ich = wer;
		einstellungen = einst;
		Bridge.spieler = ich.player;
		Bridge.sitzungBis = ich.sitzungBis;
		ichSelbst = ich.player;
		el("benutzer").textContent = ich.player;
		el("upload-link").hidden = !ich.uploader;
		el("probe-band").hidden = !ich.probe;
		if (ich.probe) document.title = "🧪 " + document.title;
		menueEinrichten();
		glockeEinrichten();
		sdwZeigen();
		spiele = liste.filter((s) => typeof s.id === "string" && ID_MUSTER.test(s.id));
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			meldung(e.status === 403
				? "Für deine E-Mail-Adresse gibt es noch kein Konto in der Spielebibliothek. Bitte bei Seb melden."
				: "Die Spielliste konnte nicht geladen werden (" + e.message + ").", "fehler");
		}
		return;
	}

	el("suche").addEventListener("input", (e) => { suche = e.target.value; kachelnZeigen(); });
	el("sortierung").addEventListener("change", async (e) => {
		await einstellungenSpeichern({ sortierung: e.target.value });
		kachelnZeigen();
	});
	if (!spiele.length) meldung("Noch keine Spiele.", "bleibt");

	window.addEventListener("hashchange", route);
	route();

	// Was bei abgelaufener Anmeldung zwischengespeichert wurde, jetzt übertragen
	Bridge.nachreichen().then((n) => {
		if (n) meldung(n === 1 ? "1 zwischengespeicherte Änderung aus deiner letzten Sitzung wurde übertragen."
			: n + " zwischengespeicherte Änderungen aus deiner letzten Sitzung wurden übertragen.");
	});
}

start();
