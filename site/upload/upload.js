// Upload-Seite (Phase 6b): upload.cuby0401.uk → Upload-Dienst unter /api/upload
// 11.11.2026: komplett aus den UI-Bausteinen (window.UI) – keine eigenen Knöpfe, Felder, Dialoge oder Stylesheets mehr.
// Kennungen für die Tests: #anmeldung, #bereich, #passwort, #anmeldeform, #uploadform, #datei, #ordner, #neu, #update-fuer, #speicher,
// #spiel-<ordner> (data-ordner), [data-steckbrief], [data-vorschau], #update-fenster (#uf-…), #rollback-fenster (#rb-text, button[value]).
"use strict";

const $ = (id) => document.getElementById(id);
const API = "/api/upload";
const GAMES = "https://games.cuby0401.uk";
// Größe lesbar, Einheit passend zur Größe: B, KB, MB, GB, TB, PB (Zentrale 1.2.1)
function groesse(b) {
	const einheiten = ["B", "KB", "MB", "GB", "TB", "PB"];
	let i = 0, n = Math.max(0, Number(b) || 0);
	while (n >= 1024 && i < einheiten.length - 1) { n /= 1024; i++; }
	const stellen = i === 0 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
	return n.toLocaleString("de-DE", { maximumFractionDigits: stellen }) + " " + einheiten[i];
}
const datum = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const meldung = (text, art) => UI.meldung(text, { art: art || "info" });

async function api(methode, pfad, body) {
	const r = await fetch(API + pfad, {
		method: methode,
		credentials: "same-origin",
		redirect: "manual",
		cache: "no-store",
		headers: { "X-Upload": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (r.type === "opaqueredirect") {
		location.reload(); // Cloudflare-Sitzung (15 min) abgelaufen → neuer Code
		throw new Error("Sitzung abgelaufen");
	}
	const d = r.status === 204 ? null : await r.json().catch(() => ({}));
	if (!r.ok) {
		const e = new Error(d && typeof d.detail === "string" ? d.detail : d && d.detail && d.detail.text ? d.detail.text : "Fehler " + r.status);
		e.status = r.status;
		e.detail = d && d.detail;
		throw e;
	}
	return d;
}
// Fehler einheitlich: 401 → neu anmelden, sonst Meldung
const fehler = (e) => { if (e.status === 401) return start(); meldung(e.message, "fehler"); };

async function aktion(fn, erfolg) {
	try { await fn(); if (erfolg) meldung(erfolg, "erfolg"); }
	catch (e) { if (e.status === 401) return start(); meldung(e.message, "fehler"); }
	liste();
}

// ---------- Gerüst: Kopfleiste, Anmeldung, Bereich ----------
let ich = "";   // Spieleordner (erster Name, ändert sich nie) – für den Link „Testen“
const benutzer = UI.marke({ text: "", ikon: "benutzer" });
benutzer.hidden = true;
const abmelden = UI.knopf({ id: "abmelden", art: "leise", ikon: "abmelden", text: "Abmelden", onclick: async () => {
	try { await api("POST", "/abmelden"); } catch { /* egal */ }
	meldung("Abgemeldet.");
	start();
} });
abmelden.hidden = true;
document.body.prepend(UI.kopfleiste({ marke: { text: "Spielebibliothek · Upload", href: GAMES }, rechts: [benutzer,
	UI.knopf({ art: "leise", ikon: "buch", text: "Handbuch", href: GAMES + "/handbuch/", neuesFenster: true }), abmelden] }));

const passwort = UI.feld({ id: "passwort", typ: "password", label: "Upload-Passwort", pflicht: true, autocomplete: "off",
	hinweis: "Bitte nicht im Browser speichern." });
const anmeldung = UI.seite({ id: "anmeldung", schmal: true, titel: "Upload-Passwort",
	untertitel: "Zusätzlich zum E-Mail-Code brauchst du dein persönliches Upload-Passwort.",
	inhalt: UI.karte({ inhalt: UI.formular({ id: "anmeldeform", absenden: "Anmelden", inhalt: passwort, onabsenden: async () => {
		try {
			await api("POST", "/anmelden", { passwort: passwort.wert });
			passwort.wert = "";
			start();
		} catch (e) {
			passwort.fehlerSetzen(e.message);
			passwort.eingabe.select();
		}
	} }) }) });

// Upload-Formular
const ordner = UI.feld({ id: "ordner", label: "Ordnername", pflicht: true, platzhalter: "z. B. snake", max: 64,
	hinweis: "Bleibt immer gleich – Updates gehen in denselben Ordner. Ein neuer Name ist ein neues Spiel." });
ordner.eingabe.pattern = "[A-Za-z0-9][A-Za-z0-9._\\-]{0,63}";
const datei = UI.datei({ id: "datei", label: "ZIP-Datei mit deinem Spiel", accept: ".zip,application/zip", text: "ZIP hierher ziehen oder auswählen",
	hinweis: "Im ZIP muss index.html ganz oben liegen (oder in genau einem Ordner). Mac: Ordner rechtsklicken → „Komprimieren“. Windows: Rechtsklick → „Senden an“ → „ZIP-komprimierter Ordner“. Max. 100 MB – .exe, Skripte und versteckte Dateien werden übersprungen.",
	ondatei: ([d]) => {
		if (d && !ordner.wert) ordner.wert = d.name.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64);
	} });
datei.eingabe.required = true;
const neu = UI.feld({ id: "neu", label: "Was hast du geändert?", optional: true, max: 200, platzhalter: "z. B. Neues Level 4 · Sprung-Fehler behoben",
	hinweis: "Eine Zeile – wird bis zum nächsten Update gesammelt." });
let updateHinweis = UI.hinweis({ id: "update-fuer", art: "akzent", text: "" });
updateHinweis.hidden = true;
const fortschrittPlatz = UI.stapel([], { abstand: "s" });
fortschrittPlatz.hidden = true;
const uploadForm = UI.formular({ id: "uploadform", absenden: "Hochladen", onabsenden: () => hochladenAbsenden(), inhalt: [
	datei, updateHinweis, ordner, neu, fortschrittPlatz,
	UI.hinweis({ art: "info", inhalt: UI.h("p", {}, "Jeder Upload landet zuerst als ", UI.h("strong", { text: "Entwurf" }),
		" – nur du siehst ihn. Testen, dann über „Veröffentlichen …“ das Update-Fenster öffnen: Dort wird geprüft, ob alles passt, und dein Spiel bekommt seine Versionsnummer. ",
		UI.h("a", { href: GAMES + "/handbuch/#updates", target: "_blank", rel: "noopener", text: "So funktionieren Updates" })) })] });

const speicher = UI.stapel([], { id: "speicher", abstand: "s" });
speicher.hidden = true;
const spieleListe = UI.stapel([], { id: "liste" });
const bereich = UI.seite({ id: "bereich", titel: "Spiel hochladen oder aktualisieren", inhalt: [
	speicher,
	UI.karte({ titel: "Neues Spiel oder Update", inhalt: uploadForm }),
	UI.abschnitt({ titel: "Deine Spiele", inhalt: spieleListe })] });
anmeldung.hidden = true; bereich.hidden = true;
$("app").replaceChildren(anmeldung, bereich);

function zeige(was) {
	anmeldung.hidden = was !== "anmeldung";
	bereich.hidden = was !== "bereich";
	abmelden.hidden = was !== "bereich";
}

let bekannteOrdner = new Set();
let kontingent = 0;   // aus /status, für „% deines Kontingents“

// „Update hochladen“ an einem Spiel: Ordnername festlegen, damit kein zweites Spiel entsteht
function updateFuer(s) {
	ordner.wert = s.ordner;
	ordner.eingabe.readOnly = true;
	const n = UI.hinweis({ id: "update-fuer", art: "akzent", titel: `Update für „${s.title}“`,
		text: `${s.version ? "Aktuell Version " + s.version + ". " : ""}Ordner ${s.ordner} ist festgelegt.`,
		aktion: { text: "Stattdessen neues Spiel", onclick: () => updateFuerAufheben() } });
	updateHinweis.replaceWith(n); updateHinweis = n;
	uploadForm.scrollIntoView({ behavior: "smooth", block: "start" });
	datei.eingabe.focus();
}
function updateFuerAufheben() {
	ordner.eingabe.readOnly = false;
	updateHinweis.hidden = true;
}

// ---------- Deine Spiele ----------
async function liste() {
	let spiele;
	try { spiele = await api("GET", "/spiele"); }
	catch (e) { return fehler(e); }
	bekannteOrdner = new Set(spiele.map((x) => x.ordner));
	if (!spiele.length) return spieleListe.replaceChildren(UI.leer({ ikon: "hochladen", titel: "Noch keine Spiele hochgeladen",
		text: "Wähl oben dein erstes ZIP aus. Es landet als Entwurf, den nur du siehst." }));
	spieleListe.replaceChildren(...spiele.map(spielKarte));
	// Zurück vom Entwurf-Testen (1.3.1): zum Spiel springen und kurz hervorheben
	const sprung = decodeURIComponent(location.hash.replace(/^#spiel-/, ""));
	if (location.hash.startsWith("#spiel-") && $("spiel-" + sprung)) {
		const ziel = $("spiel-" + sprung);
		history.replaceState(null, "", location.pathname + location.search);
		ziel.dataset.hervorgehoben = "";
		ziel.scrollIntoView({ behavior: "smooth", block: "start" });
		setTimeout(() => { delete ziel.dataset.hervorgehoben; }, 4000);
	}
}

function spielKarte(s) {
	const pfad = "/spiele/" + encodeURIComponent(s.ordner);
	const inhalt = [];
	if (s.speicher) {   // Speicher dieses Spiels – zählt alles zu deinem Kontingent (Zentrale 1.2.0)
		const sp = s.speicher, gesamt = sp.live + sp.entwurf + sp.versionen;
		inhalt.push(UI.text(`Speicher: ${groesse(gesamt)}` + (kontingent ? ` (${Math.max(1, Math.round(gesamt / kontingent * 100))} % deines Kontingents)` : "") +
			` – live ${groesse(sp.live)}` + (sp.entwurf ? `, Entwurf ${groesse(sp.entwurf)}` : "") + (sp.versionen ? `, ältere Versionen ${groesse(sp.versionen)}` : ""), { art: "klein" }));
	}
	if (s.warning || (s.live && !s.complete)) inhalt.push(UI.hinweis({ art: "warnung", text: s.warning || "index.html fehlt" }));

	if (s.entwurf) {
		const testen = UI.knopf({ art: "standard", groesse: "s", ikon: "spielen", text: "Testen",
			// 1.3.1: im selben Tab – „Zurück zum Hochladen“ im Entwurf führt genau hierher zurück (#spiel-<ordner>)
			href: `${GAMES}/#/entwurf/${encodeURIComponent(ich)}/${encodeURIComponent(s.ordner)}` });
		const aenderungen = s.aenderungen.length ? UI.lesetext([UI.text("Gesammelte Änderungen fürs nächste Update:", { art: "klein" }),
			UI.h("ul", {}, s.aenderungen.map((a) => UI.h("li", { text: a.text })))]) : null;
		inhalt.push(UI.hinweis({ art: "akzent", ikon: "bearbeiten", titel: `Entwurf vom ${datum(s.entwurf.geaendert)}`, text: `${s.entwurf.dateien} Dateien – nur du siehst ihn.`,
			inhalt: [aenderungen, UI.knopfleiste([
				UI.knopf({ art: "gefahr-leise", groesse: "s", text: "Verwerfen", onclick: async () => {
					if (!await UI.bestaetigen({ titel: "Entwurf verwerfen?", text: "Die gesammelten Änderungen werden ebenfalls verworfen.", ja: "Verwerfen", gefahr: true })) return;
					aktion(() => api("DELETE", pfad + "/entwurf"), `${s.ordner}: Entwurf verworfen.`);
				} }),
				testen,
				UI.knopf({ art: "primaer", groesse: "s", text: "Veröffentlichen …", onclick: () => updateFenster(s) })], { ausrichtung: "links" })].filter(Boolean) }));
	}
	if (s.versionen.length) {
		const wahl = UI.auswahl({ label: "Version", optionen: s.versionen.map((v) =>
			[v.id, (v.version ? `Version ${v.version} – ` : "") + `bis ${datum(v.archiviert)} (${v.dateien} Dateien)`]), wert: s.versionen[0].id });
		inhalt.push(UI.aufklappen({ titel: "Ältere Versionen", rechts: String(s.versionen.length), inhalt: [wahl,
			UI.knopfleiste([UI.knopf({ art: "standard", ikon: "verlauf", text: "Zurücksetzen",
				onclick: () => zuruecksetzen(s, wahl.wert, wahl.eingabe.selectedOptions[0].textContent) })], { ausrichtung: "links" })] }));
	}
	if (s.releases.length) inhalt.push(UI.aufklappen({ titel: "Versionsverlauf", rechts: String(s.releases.length), inhalt:
		UI.liste(s.releases.map((r) => ({ ikon: r.art === "rollback" ? "verlauf" : "haken", titel: `${r.version}${r.art === "rollback" ? " – zurückgesetzt" : ""} · ${datum(r.zeit)}`,
			text: r.aenderungen.join(" · ") || null })), { ohneRahmen: true }) }));
	inhalt.push(steckbriefBereich(s));

	const karte = UI.karte({
		id: "spiel-" + s.ordner, titel: s.title, ebene: "h3",
		untertitel: s.live ? `${s.version ? "Version " + s.version + " · " : ""}Ordner ${s.ordner} · ${s.live.dateien} Dateien · ${groesse(s.live.bytes)} · geändert ${datum(s.live.geaendert)}`
			: `Ordner ${s.ordner} · noch nicht veröffentlicht`,
		aktionen: UI.marke(s.live ? { text: "Live", art: "erfolg", punkt: true } : { text: "Nicht veröffentlicht", punkt: true }),
		inhalt,
		fuss: UI.knopfleiste([
			UI.knopf({ art: "gefahr-leise", ikon: "loeschen", text: "Löschen", onclick: async () => {
				if (!await UI.bestaetigen({ titel: `„${s.title}“ löschen?`, gefahr: true, ja: "Komplett löschen",
					text: `Ordner ${s.ordner} wird komplett gelöscht – inklusive Entwurf, älterer Versionen und Versionsverlauf. Spielstände und Bestenliste bleiben erhalten.` })) return;
				aktion(() => api("DELETE", pfad), `${s.ordner} gelöscht.`);
			} }),
			UI.knopf({ art: "standard", ikon: "hochladen", text: "Update hochladen", onclick: () => updateFuer(s) })], { ausrichtung: "verteilt" }),
	});
	karte.dataset.ordner = s.ordner;
	return karte;
}

// ---------- Steckbrief: Titel, Beschreibung, Vorschaubild (Zentrale 1.2.1) ----------
// Gilt sofort, ohne neue Version, und übersteht Updates. Vorrang vor der game.json.
function steckbriefBereich(s) {
	const pfad = "/spiele/" + encodeURIComponent(s.ordner);
	let geladen = false;
	const d = UI.aufklappen({ titel: "Beschreibung und Vorschaubild", inhalt: [], onoeffnen: async () => {
		if (geladen) return;
		geladen = true;
		d.inhalt.replaceChildren(UI.laden({ klein: true }));
		let sb;
		try { sb = await api("GET", pfad + "/steckbrief"); }
		catch (e) { if (e.status === 401) return start(); return d.inhalt.replaceChildren(UI.hinweis({ art: "gefahr", text: e.message })); }
		const titel = UI.feld({ label: "Titel", wert: sb.title, platzhalter: sb.gameJson.title || s.ordner, max: 80, hinweis: "Höchstens 80 Zeichen." });
		const text = UI.textbereich({ label: "Beschreibung", wert: sb.description, zeilen: 3, max: 300,
			platzhalter: sb.gameJson.description || "z. B. Weiche Hindernissen aus und sammle Sterne.", hinweis: " ",
			oninput: () => zaehlen() });
		const zaehler = text.querySelector(".b-feld__hinweis");
		const zaehlen = () => { zaehler.textContent = `Steht in der Bibliothek unter dem Spiel · ${String(text.wert).length} / 300`; };
		zaehlen();
		const form = UI.formular({ inhalt: [titel, text], onabsenden: () => aktion(() => api("PUT", pfad + "/steckbrief",
			{ title: titel.wert, description: text.wert }), `„${titel.wert || s.title}“: Beschreibung gespeichert – gilt sofort.`) });

		const vorschau = UI.stapel([], { abstand: "s" });
		vorschau.dataset.vorschau = "";
		const bildWeg = UI.knopf({ art: "gefahr-leise", groesse: "s", text: "Bild entfernen", onclick: async () => {
			if (!await UI.bestaetigen({ titel: "Vorschaubild entfernen?", text: "Danach gilt wieder das Bild aus der game.json (falls es eins gibt).", ja: "Entfernen", gefahr: true })) return;
			try { await api("DELETE", pfad + "/vorschaubild"); sb.vorschaubild = null; bildZeigen(null); meldung("Vorschaubild entfernt.", "erfolg"); }
			catch (e) { fehler(e); }
		} });
		const bildZeigen = (info) => {
			vorschau.replaceChildren(info ? UI.bilder([{ src: API + pfad + "/vorschaubild?v=" + info.stand, alt: "Vorschaubild", unter: groesse(info.bytes) }], { format: "breit", sofort: true })
				: UI.text(sb.gameJson.thumbnail ? "Kein eigenes Bild – es gilt das thumbnail aus der game.json." : "Noch kein Vorschaubild.", { art: "leise" }));
			bildWeg.hidden = !info;
		};
		const wahl = UI.datei({ label: "Neues Vorschaubild", accept: "image/png,image/jpeg,image/webp", text: "Bild hierher ziehen oder auswählen",
			hinweis: "Am besten 16:9, z. B. 640 × 360 Pixel. PNG, JPG oder WebP, max. 2 MB.",
			ondatei: async ([bild]) => {
				if (!bild) return;
				if (bild.size > 2 * 1024 * 1024) { wahl.leeren(); return meldung("Das Vorschaubild ist größer als 2 MB.", "fehler"); }
				const f = new FormData();
				f.append("datei", bild);
				const r = await fetch(API + pfad + "/vorschaubild", { method: "PUT", body: f, credentials: "same-origin", headers: { "X-Upload": "1" } });
				const antwort = await r.json().catch(() => ({}));
				wahl.leeren();
				if (r.status === 401) return start();
				if (!r.ok) return meldung(typeof antwort.detail === "string" ? antwort.detail : "Fehler " + r.status, "fehler");
				sb = antwort;
				bildZeigen(sb.vorschaubild);
				meldung("Vorschaubild gespeichert – gilt sofort.", "erfolg");
			} });
		bildZeigen(sb.vorschaubild);
		d.inhalt.replaceChildren(form, UI.abschnitt({ titel: "Vorschaubild", ebene: "h4", aktionen: bildWeg, inhalt: UI.stapel([vorschau, wahl]) }));
	} });
	d.dataset.steckbrief = "";
	return d;
}

// ---------- Update-Fenster (E35/E36) ----------
const STUFE = { ok: "erfolg", hinweis: "info", warnung: "warnung", fehler: "gefahr" };
async function updateFenster(s) {
	let pr;
	try { pr = await api("GET", "/spiele/" + encodeURIComponent(s.ordner) + "/pruefung"); }
	catch (e) { return fehler(e); }
	const erst = pr.erstveroeffentlichung;
	const v = (art) => (erst ? "" : ` → ${pr.vorschlaege[art]}`);
	const art = UI.radio({ name: "uf-art", label: "Art des Updates", wert: "minor", optionen: [
		["patch", "Patch / Hotfix" + v("patch"), "Fehler behoben, sonst nichts Neues"],
		["minor", "Kleines Update" + v("minor"), "Neue Inhalte, Verbesserungen"],
		["major", "Großes Update" + v("major"), "Vieles neu oder grundlegend anders"]] });
	if (erst) for (const r of art.querySelectorAll("input")) r.disabled = true;
	const aenderungen = UI.textbereich({ id: "uf-aenderungen", label: "Was ist neu?", zeilen: 4, max: 5000,
		hinweis: "Eine Zeile pro Änderung – sehen alle Spieler.", wert: pr.aenderungen.join("\n") || (erst ? "Erste Version" : "") });
	const punkte = UI.stapel(pr.punkte.map((p) => UI.h("li", { "data-stufe": p.stufe }, UI.hinweis({ art: STUFE[p.stufe] || "info", text: p.text }))),
		{ tag: "ul", id: "uf-punkte", abstand: "s" });
	const season = UI.haken({ id: "uf-season", label: "Neue Season der Bestenliste starten (empfohlen)", an: !!pr.seasonEmpfohlen });
	season.hidden = !pr.seasonEmpfohlen;
	const gelesen = UI.haken({ id: "uf-gelesen", label: "Ich habe die Warnungen gelesen und will trotzdem veröffentlichen." });
	gelesen.hidden = !pr.warnungen || !!pr.fehler;
	const fehlerPlatz = UI.stapel([]);
	const zeigeFehler = (text) => fehlerPlatz.replaceChildren(UI.hinweis({ art: "gefahr", text }));
	let fenster;
	const los = UI.knopf({ id: "uf-los", art: "primaer", text: pr.fehler ? "Erst die Fehler beheben (neu hochladen)" : "Veröffentlichen", deaktiviert: !!pr.fehler,
		onclick: async () => {
			if (pr.warnungen && !gelesen.wert) return zeigeFehler("Bitte erst die Warnungen lesen und das Häkchen setzen.");
			const zeilen = String(aenderungen.wert).split("\n").map((z) => z.trim()).filter(Boolean);
			if (!zeilen.length) { aenderungen.fehlerSetzen("Bitte mindestens eine Zeile schreiben, was neu ist."); return aenderungen.eingabe.focus(); }
			los.laden(true);
			try {
				const d = await api("POST", "/spiele/" + encodeURIComponent(s.ordner) + "/veroeffentlichen",
					{ art: art.wert, aenderungen: zeilen, neueSeason: season.wert, warnungenGelesen: gelesen.wert });
				fenster.schliessen(true);
				meldung(`„${s.title}“ ist als Version ${d.version} veröffentlicht.` + (d.season ? ` Neue Season ${d.season} gestartet.` : ""), "erfolg");
				liste();
			} catch (e) {
				los.laden(false);
				if (e.status === 401) { fenster.schliessen(null); return start(); }
				zeigeFehler(e.message);
			}
		} });
	fenster = UI.dialog({ id: "update-fenster", breit: true, titel: `„${s.title}“ veröffentlichen`, inhalt: [
		UI.text(erst ? "Erste Veröffentlichung – das Spiel bekommt Version 1.0.0." : `Aktuell live: ${pr.version ? "Version " + pr.version : "noch ohne Versionsnummer"}`,
			{ id: "uf-version", art: "leise" }),
		art, aenderungen,
		UI.abschnitt({ titel: "Prüfung", ebene: "h3", inhalt: punkte }),
		season, gelesen, fehlerPlatz],
	aktionen: [UI.knopf({ art: "standard", text: "Abbrechen", onclick: () => fenster.schliessen(null) }), los] });
	fenster.oeffnen();
}

// ---------- Rollback mit Rückfrage (E37) ----------
async function zuruecksetzen(s, vid, beschriftung) {
	if (!await UI.bestaetigen({ titel: `„${s.title}“ zurücksetzen?`, text: `Auf: ${beschriftung}. Die aktuelle Version wird dabei aufgehoben.`, ja: "Zurücksetzen" })) return;
	const pfad = "/spiele/" + encodeURIComponent(s.ordner) + "/zuruecksetzen";
	try {
		await api("POST", pfad, { version: vid });
		meldung(`${s.ordner}: zurückgesetzt.`, "erfolg");
	} catch (e) {
		if (e.status === 401) return start();
		if (e.status !== 409 || !e.detail || e.detail.frage !== "spielstaende") { meldung(e.message, "fehler"); return liste(); }
		let fenster;
		const wahlKnopf = (wert, art, text) => { const k = UI.knopf({ art, text, onclick: () => fenster.schliessen(wert) }); k.setAttribute("value", wert); return k; };
		fenster = UI.dialog({ id: "rollback-fenster", titel: "Spielstände beim Zurücksetzen", inhalt: [
			UI.text(e.detail.text, { id: "rb-text" }),
			UI.text("Die Stände vor dem Update hat die Bibliothek aufgehoben. Was soll mit den Spielständen der Spieler passieren?", { art: "leise" }),
			UI.angaben([["Zurückholen", "auf den Stand vor dem Update – Fortschritt seitdem geht verloren (liegt im Verlauf)"],
				["Behalten", "nur, wenn die alte Version mit den neuen Ständen umgehen kann"]])],
		aktionen: [wahlKnopf("abbrechen", "leise", "Abbrechen"), wahlKnopf("behalten", "standard", "Spielstände behalten"),
			wahlKnopf("zuruecksetzen", "primaer", "Spielstände zurückholen")] });
		const wahl = await fenster.oeffnen();
		if (wahl !== "zuruecksetzen" && wahl !== "behalten") { meldung("Nicht zurückgesetzt."); return liste(); }
		try {
			const d = await api("POST", pfad, { version: vid, spielstaende: wahl });
			const sp = d.spielstaende;
			meldung(`${s.ordner}: zurückgesetzt.` + (sp ? ` ${sp.zurueckgeholt} Spielstände zurückgeholt` +
				(sp.ohneAltenStand ? `, ${sp.ohneAltenStand} ohne alten Stand unverändert.` : ".") : " Spielstände behalten."), "erfolg");
		} catch (e2) { meldung(e2.message, "fehler"); }
	}
	liste();
}

// ---------- Hochladen ----------
function hochladen(zip, zielOrdner) {
	return new Promise((ja, nein) => {
		const balken = (wert) => fortschrittPlatz.replaceChildren(UI.fortschritt({ wert, max: 100, label: "Hochladen", zeigeText: true }));
		balken(0);
		const x = new XMLHttpRequest();
		x.open("POST", API + "/spiele/" + encodeURIComponent(zielOrdner));
		x.setRequestHeader("X-Upload", "1");
		x.upload.onprogress = (e) => { if (e.lengthComputable) balken((e.loaded / e.total) * 100); };
		x.onload = () => {
			let d = {};
			try { d = JSON.parse(x.responseText); } catch { /* egal */ }
			if (x.status >= 200 && x.status < 300) ja(d);
			else { const e = new Error(typeof d.detail === "string" ? d.detail : "Fehler " + x.status); e.status = x.status; nein(e); }
		};
		x.onerror = () => nein(new Error("Verbindung abgebrochen – evtl. ist die Datei größer als 100 MB oder die Sitzung abgelaufen"));
		const f = new FormData();
		f.append("datei", zip);
		f.append("neu", String(neu.wert).trim());
		x.send(f);
	});
}

async function hochladenAbsenden() {
	const zip = datei.wert[0];
	const ziel = String(ordner.wert).trim();
	if (!zip) return;
	if (zip.size > 100 * 1024 * 1024) return datei.fehlerSetzen("Die Datei ist größer als 100 MB.");
	if (!bekannteOrdner.has(ziel) && bekannteOrdner.size && !await UI.bestaetigen({ titel: "Neues Spiel anlegen?", ja: "Neues Spiel hochladen",
		text: `„${ziel}“ ist ein neuer Ordner – das wird ein NEUES Spiel (eigene Spielstände und Bestenliste). Wolltest du ein bestehendes Spiel aktualisieren? Dann „Abbrechen“ und beim Spiel auf „Update hochladen“ klicken.` })) return;
	fortschrittPlatz.hidden = false;
	try {
		const d = await hochladen(zip, ziel);
		let text = `${d.ordner}: ${d.dateien} Dateien als Entwurf hochgeladen.`;
		if (d.uebersprungen && d.uebersprungen.length) text += ` Übersprungen (nicht erlaubt): ${d.uebersprungen.join(", ")}.`;
		meldung(text + " Unten auf „Testen“ klicken, kurz spielen, dann „Veröffentlichen …“.", "erfolg");
		uploadForm.reset();
		datei.leeren();
		updateFuerAufheben();
	} catch (e) {
		if (e.status === 401) { meldung("Sitzung abgelaufen – bitte neu anmelden.", "fehler"); return start(); }
		meldung(e.message, "fehler");
	} finally {
		fortschrittPlatz.hidden = true;
		liste();
	}
}

// ---------- Start ----------
async function start() {
	let s;
	try {
		s = await api("GET", "/status");
	} catch (e) {
		zeige("");
		return $("app").replaceChildren(anmeldung, bereich, UI.seite({ schmal: true, titel: e.status === 403 ? "Kein Konto" : "Upload nicht erreichbar",
			inhalt: UI.leer({ ikon: "schloss", titel: e.status === 403 ? "Für deine E-Mail-Adresse gibt es kein Konto in der Spielebibliothek." : e.message }) }));
	}
	// 1.5.0: oben das aktuelle Handle; der Spieleordner (erster Name, ändert sich nie) steht im Tooltip
	ich = s.player;
	benutzer.lastElementChild.textContent = s.handle && s.handle !== s.player ? "@" + s.handle : s.player;
	benutzer.title = "Spieleordner: " + s.player;
	benutzer.hidden = false;
	if (!s.entwickler) {
		zeige("");
		return $("app").replaceChildren(anmeldung, bereich, UI.seite({ schmal: true, titel: "Noch kein Upload-Konto",
			inhalt: UI.leer({ ikon: "schloss", titel: "Du hast noch kein Upload-Konto", text: "Bitte bei Seb melden – dann kannst du hier Spiele hochladen." }) }));
	}
	if (s.gesperrt) meldung("Zu viele falsche Passwörter – bitte 15 Minuten warten.", "fehler");
	if (!s.angemeldet) { zeige("anmeldung"); passwort.eingabe.focus(); return; }
	zeige("bereich");
	if (s.speicher) {   // Kontingent je Entwickler (Zentrale 1.2.0)
		kontingent = s.speicher.grenze;
		const anteil = s.speicher.belegt / s.speicher.grenze;
		speicher.replaceChildren(UI.fortschritt({ wert: s.speicher.belegt, max: s.speicher.grenze, label: "Dein Speicher", art: anteil > 0.8 ? "warnung" : null,
			zeigeText: `${groesse(s.speicher.belegt)} von ${groesse(s.speicher.grenze)}` }),
			UI.text(anteil > 0.8 ? "Dein Speicher ist fast voll. Alte Versionen oder Spiele löschen, oder Seb um mehr Platz bitten."
				: "Dein Speicher: Spiele, Entwürfe und aufgehobene Versionen.", { art: "klein" }));
		speicher.hidden = false;
	}
	liste();
}

start();
