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

async function einstellungenSpeichern(aenderung) {
	Object.assign(einstellungen, aenderung);
	try { einstellungen = await Bridge.json("PUT", "/api/einstellungen", aenderung); }
	catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung("Einstellung nicht gespeichert: " + e.message); }
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

	el("bl-titel").textContent = "Bestenliste" + (d.rangiertNach === "score" ? " · " + d.label : "");
	if (d.seasons.length > 1) {
		const wahl = el("bl-season");
		wahl.replaceChildren(...d.seasons.slice().reverse().map((s) => {
			const o = document.createElement("option");
			o.value = String(s);
			o.textContent = s === d.currentSeason ? s + " (aktuell)" : String(s);
			o.selected = s === d.season;
			return o;
		}));
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
		const name = document.createElement("span"); name.className = "name"; name.textContent = e.player;
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
	hinweis.textContent = d.entries.length ? "" : (d.season === d.currentSeason ? "Noch keine Einträge – sei die oder der Erste!" : "In dieser Season gab es keine Einträge.");
}

function meldung(text) {
	el("meldung").textContent = text;
	el("meldung").hidden = !text;
}

// Reihenfolge: Favoriten, dann empfohlene Spiele, dann nach gewählter Sortierung
function sortiert(liste) {
	const fav = new Set(einstellungen.favoriten);
	const nach = {
		alphabetisch: (a, b) => a.title.localeCompare(b.title, "de"),
		zuletzt: (a, b) => (b.zuletztGespielt || "").localeCompare(a.zuletztGespielt || "") || a.title.localeCompare(b.title, "de"),
		neu: (a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""),
	}[einstellungen.sortierung] || ((a, b) => a.title.localeCompare(b.title, "de"));
	return liste.slice().sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || (b.hervorgehoben - a.hervorgehoben) || nach(a, b));
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

function daumenZeigen(spiel, entwurf) {
	const k = el("daumen");
	k.hidden = !!entwurf;
	if (entwurf) return;
	el("daumen-zahl").textContent = spiel.daumen ? String(spiel.daumen) : "";
	k.classList.toggle("an", !!spiel.meinDaumen);
	const eigen = spiel.author === ich.player;
	k.disabled = eigen || !!ich.ansicht;
	k.title = eigen ? "Eigene Spiele kann man nicht bewerten"
		: ich.ansicht ? "In der Ansicht als … wird nicht bewertet"
		: spiel.meinDaumen ? "Daumen zurücknehmen" : "Daumen hoch – zeigt dem Entwickler, dass dir das Spiel gefällt";
	k.onclick = async () => {
		try {
			const d = await Bridge.json("PUT", "/api/daumen/" + spiel.id.split("/").map(encodeURIComponent).join("/"), { an: !spiel.meinDaumen });
			spiel.meinDaumen = d.an;
			spiel.daumen = d.daumen;
			daumenZeigen(spiel, false);
		} catch (e) {
			if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung("Daumen nicht gespeichert: " + e.message);
		}
	};
}

function kachelnZeigen() {
	el("sortierung").value = einstellungen.sortierung;
	el("kacheln").replaceChildren(...sortiert(spiele).map(kachel));
}

function spielPfad(id) {
	return Bridge.PLAY + "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/";
}

function kachel(spiel) {
	const k = document.createElement("article");
	k.className = "kachel";

	const bild = document.createElement("div");
	bild.className = "bild";
	if (spiel.thumbnail) {
		const img = document.createElement("img");
		img.src = spielPfad(spiel.id) + spiel.thumbnail.split("/").map(encodeURIComponent).join("/");
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
	autor.textContent = "von " + spiel.author;
	if (spiel.daumen) {
		const d = document.createElement("span");
		d.className = "daumen-zahl";
		d.textContent = " · 👍 " + spiel.daumen;
		d.title = spiel.daumen === 1 ? "1 Daumen hoch" : spiel.daumen + "-mal Daumen hoch";
		autor.append(d);
	}
	const text = document.createElement("p");
	text.className = "beschreibung";
	text.textContent = spiel.description;
	inhalt.append(h, autor, text);

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
	inhalt.append(a);

	k.append(bild, inhalt);
	return k;
}

function spielBeenden() {
	if (aktuellesSpiel === null) return;
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
	zurueck.href = letzteRoute;
	zurueck.textContent = "←";
	zurueck.title = letzteRoute.startsWith("#/spiel/") ? "Zurück zum Spiel" : "Zurück zur Übersicht";
	zurueck.setAttribute("aria-label", zurueck.title);
	el("seite").replaceChildren();
	meldung("");
	try { await seiten[name](el("seite")); }
	catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message); }
	// Pfeil unauffällig links neben die Überschrift der Unterseite
	const titel = el("seite").querySelector("h1");
	const kopf = document.createElement("div");
	kopf.className = "seitenkopf";
	if (titel) { titel.replaceWith(kopf); kopf.append(zurueck, titel); }
	else { kopf.append(zurueck); el("seite").prepend(kopf); }
}

async function zeigeSpiel(id, entwurfSpiel) {
	const spiel = entwurfSpiel || spiele.find((s) => s.id === id && s.complete);
	if (!spiel) {
		location.hash = "#/";
		return;
	}
	el("entwurf-hinweis").hidden = !entwurfSpiel;
	if (entwurfSpiel) {
		el("entwurf-hinweis").textContent = "Entwurf – nur du siehst ihn. " +
			(spiel.spielstaendeKopiert ? "Dein Spielstand wurde als Kopie übernommen. " : "Dein Spielstand im Entwurf ist getrennt vom echten. ") +
			"Bestenlisten-Einträge werden erst nach dem Veröffentlichen gespeichert. Veröffentlichen auf der Upload-Seite.";
	}
	const zeigeNeu = !entwurfSpiel && aktualisiert(spiel) && spiel.neu;
	el("neu-hinweis").hidden = !zeigeNeu;
	if (zeigeNeu) {
		el("neu-text").textContent = "Neu in dieser Version: " + spiel.neu.text;
		el("neu-zu").onclick = () => { el("neu-hinweis").hidden = true; };
	}
	if (!entwurfSpiel) alsGesehenMerken(spiel);
	daumenZeigen(spiel, entwurfSpiel);
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
	try {
		const iframe = await Bridge.starten(spiel, el("rahmen"));
		iframe.focus();
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			el("rahmen").replaceChildren();
			meldung("Das Spiel konnte nicht gestartet werden: " + e.message);
			location.hash = "#/";
		}
	}
}

// Entwurf testen (nur Entwickler selbst und Admin – der Server prüft)
async function zeigeEntwurf(user, ordner) {
	try {
		const d = await Bridge.json("POST", `/api/entwickler/entwurf/${encodeURIComponent(user)}/${encodeURIComponent(ordner)}`);
		await zeigeSpiel(d.id, d);
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) { meldung("Entwurf nicht verfügbar: " + e.message); location.hash = "#/"; }
	}
}

function route() {
	el("menue").hidden = true;
	const ent = location.hash.match(/^#\/entwurf\/([a-z0-9][a-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
	if (ent) { letzteRoute = location.hash; return zeigeEntwurf(ent[1], ent[2]); }
	const m = location.hash.match(/^#\/spiel\/(.+)$/);
	if (m && ID_MUSTER.test(m[1])) { letzteRoute = location.hash; return zeigeSpiel(m[1]); }
	const s = location.hash.match(/^#\/([a-z-]+)$/);
	if (s && seiten[s[1]]) return zeigeSeite(s[1]);
	letzteRoute = "#/";
	zeigeUebersicht();
}

// Kontextmenü (Menü unter dem Benutzernamen in der Taskleiste)
function menueEinrichten() {
	const knopf = el("menue-knopf"), menue = el("menue");
	knopf.hidden = false;
	knopf.onclick = (e) => { e.stopPropagation(); menue.hidden = !menue.hidden; knopf.setAttribute("aria-expanded", String(!menue.hidden)); };
	document.addEventListener("click", (e) => { if (!menue.contains(e.target)) { menue.hidden = true; knopf.setAttribute("aria-expanded", "false"); } });
	document.addEventListener("keydown", (e) => { if (e.key === "Escape") menue.hidden = true; });
	const darf = {
		admin: ich.admin,
		entwickler: ich.uploader || ich.admin,
	};
	for (const a of menue.querySelectorAll("[data-rolle]")) a.hidden = !darf[a.dataset.rolle];
	// Band oben, solange eine Rolle simuliert wird (gestartet im Admin-Panel → Übersicht)
	if (ich.ansicht) {
		el("ansicht-text").textContent = `Du siehst die Bibliothek als ${ich.ansicht === "spieler" ? "Spieler" : "Entwickler"} – so wie Kollegen mit dieser Rolle. Spielstände und Favoriten bleiben deine.`;
		el("ansicht-band").hidden = false;
		el("ansicht-ende").onclick = () => ansichtWechseln(null);
	}
}

function ansichtWechseln(rolle) {
	Bridge.ansicht = rolle;
	location.hash = "#/";
	location.reload();
}

async function start() {
	Bridge.beiAblauf = () => { el("abgelaufen").hidden = false; };
	Bridge.beiWieder = () => { el("abgelaufen").hidden = true; };
	Bridge.beiScore = (id) => {
		const spiel = spiele.find((s) => s.id === id);
		if (spiel && aktuellesSpiel === id) bestenlisteZeigen(spiel);
	};
	el("bl-season").addEventListener("change", (e) => {
		const spiel = spiele.find((s) => s.id === aktuellesSpiel);
		if (spiel) bestenlisteZeigen(spiel, +e.target.value);
	});
	el("vollbild").addEventListener("click", () => {
		const r = el("rahmen");
		if (r.requestFullscreen) r.requestFullscreen().catch(() => {});
	});

	// Für Spieldateien und Vorschaubilder muss der Browser auch bei play.cuby0401.uk angemeldet sein
	if (!(await Bridge.sicherstellenPlay())) {
		meldung("Die Anmeldung für die Spiele (play.cuby0401.uk) hat nicht geklappt. Bitte Seite neu laden.");
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
		menueEinrichten();
		spiele = liste.filter((s) => typeof s.id === "string" && ID_MUSTER.test(s.id));
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			meldung(e.status === 403
				? "Für deine E-Mail-Adresse gibt es noch kein Konto in der Spielebibliothek. Bitte bei Seb melden."
				: "Die Spielliste konnte nicht geladen werden (" + e.message + ").");
		}
		return;
	}

	el("sortierung").addEventListener("change", async (e) => {
		await einstellungenSpeichern({ sortierung: e.target.value });
		kachelnZeigen();
	});
	if (!spiele.length) meldung("Noch keine Spiele.");

	window.addEventListener("hashchange", route);
	route();

	// Was bei abgelaufener Anmeldung zwischengespeichert wurde, jetzt übertragen
	Bridge.nachreichen().then((n) => {
		if (n) meldung(n === 1 ? "1 zwischengespeicherte Änderung aus deiner letzten Sitzung wurde übertragen."
			: n + " zwischengespeicherte Änderungen aus deiner letzten Sitzung wurden übertragen.");
	});
}

start();
