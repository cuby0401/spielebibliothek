// Tester-Panel (Zentrale 1.4.0, E76): Tests mit genauer Anleitung, „Hat geklappt“ oder „Hat nicht geklappt“ mit Begründung.
// Den Testplan schreibt Claude ins Repo (tests/manuell/<Version>.json), die Ergebnisse sieht Seb auch im Admin-Panel der Probe.
// 1.4.1 (Seb): Reiter „Offen“ (Startseite), „Abgelehnt“ und „Bestanden“ als Archiv mit Verlauf; Fotos an Ergebnissen.
// Nutzt h(), datumZeit() und bildAuswahl() aus konto.js und Bridge.json() aus bridge.js.
"use strict";

const $ = (id) => document.getElementById(id);
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

const REITER = [["offen", "Offen"], ["abgelehnt", "Abgelehnt"], ["bestanden", "Bestanden"]];
const reiter = () => (REITER.find(([k]) => "#" + k === location.hash) || REITER[0])[0];
window.addEventListener("hashchange", () => laden());

function zustandVon(t, d) {
	const alle = d.ergebnisse.filter((x) => x.test === t.id);
	return alle.some((x) => !x.ok) ? "abgelehnt" : alle.length ? "bestanden" : "offen";
}

function zusammenfassungZeigen(z) {
	return h("div", { class: "test-zusammenfassung" },
		h("span", { class: "ok", text: `✓ ${z.bestanden} bestanden` }),
		h("span", { class: "fehler", text: `✗ ${z.fehlgeschlagen} fehlgeschlagen` }),
		h("span", { text: `${z.offen} offen` }),
		h("span", { text: `${z.gesamt} insgesamt` }));
}

const fotos = (ids) => ids && ids.length ? h("div", { class: "antrag-bilder" }, ids.map((id) =>
	h("a", { href: `/api/tester/bild/${id}`, target: "_blank", rel: "noopener" }, h("img", { src: `/api/tester/bild/${id}`, alt: "Foto", loading: "lazy" })))) : null;

// Verlauf: alle Einträge zu einem Test (auch ältere und vor einem Nachtest), neueste zuerst – wer hat wann was geprüft
function verlauf(t, d) {
	const alle = d.verlauf.filter((x) => x.test === t.id).reverse();
	if (!alle.length) return null;
	const gueltig = new Set(d.ergebnisse.filter((x) => x.test === t.id).map((x) => x.id));
	return h("ul", { class: "test-ergebnisse" }, alle.map((x) => h("li", { class: gueltig.has(x.id) ? "" : "veraltet" },
		h("div", {}, `${x.ok ? "✓" : "✗"} ${x.player}, ${datumZeit(x.zeit)}`,
			gueltig.has(x.id) ? null : h("span", { class: "leise", text: " (älter, zählt nicht mehr)" }),
			x.text ? h("span", { class: "leise", text: " – " + x.text }) : null),
		fotos(x.bilder))));
}

function formular(t, d) {
	const meins = d.ergebnisse.find((x) => x.test === t.id && x.player === d.ich);
	const text = h("textarea", { placeholder: "Was ist passiert? (bei „Hat nicht geklappt“ Pflicht – z. B. was du stattdessen gesehen hast)" });
	if (meins && meins.text) text.value = meins.text;
	const auswahl = bildAuswahl(5, text);
	const knoepfe = [];
	const senden = async (ok) => {
		knoepfe.forEach((k) => { k.disabled = true; });
		try {
			const { id } = await Bridge.json("POST", "/api/tester/ergebnis", { test: t.id, ok, text: text.value });
			const bilder = auswahl.bilder();
			for (const bild of bilder) await Bridge.json("POST", `/api/tester/ergebnis/${id}/bilder`, { bild });
			meldung(`„${t.titel}“: als ${ok ? "bestanden" : "fehlgeschlagen"} eingetragen` + (bilder.length ? ` (mit ${bilder.length} ${bilder.length === 1 ? "Foto" : "Fotos"})` : "") + ". Danke!");
			laden();
		} catch (e) {
			knoepfe.forEach((k) => { k.disabled = false; });
			if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message, "fehler");
		}
	};
	knoepfe.push(h("button", { type: "button", class: "knopf ja", text: "✓ Hat geklappt", onclick: () => senden(true) }),
		h("button", { type: "button", class: "knopf nein", text: "✗ Hat nicht geklappt", onclick: () => senden(false) }));
	return [text, auswahl.element, h("div", { class: "test-knoepfe" }, ...knoepfe)];
}

function anleitung(t) {
	return [
		t.bereich ? h("div", { class: "leise", text: t.bereich }) : null,
		t.neuAb ? h("p", { class: "hinweis-box", text: `Bitte neu testen – geändert am ${datumZeit(t.neuAb)}. Ältere Ergebnisse zählen nicht mehr.` }) : null,
		t.hinweis ? h("p", { class: "leise", text: t.hinweis }) : null,
		h("strong", { text: "So testest du:" }),
		h("ol", {}, t.schritte.map((s) => h("li", { text: s }))),
		h("div", { class: "test-erwartet" }, h("strong", { text: "Erwartet: " }), t.erwartet)];
}

const STATUS_TEXT = { offen: "offen", abgelehnt: "✗ fehlgeschlagen", bestanden: "✓ bestanden" };

// Offene Tests: ganz aufgeklappt. Abgelehnte und bestandene (Archiv): eingeklappt, mit Verlauf und der Möglichkeit, neu einzutragen.
function testKarte(t, d) {
	const zustand = zustandVon(t, d);
	const klasse = "karte test " + (zustand === "abgelehnt" ? "fehler" : zustand === "bestanden" ? "ok" : "");
	const kopf = h("div", { class: "test-kopf" }, h("h2", { text: t.titel }), h("span", { class: "test-status", text: STATUS_TEXT[zustand] }));
	if (zustand === "offen")
		return h("article", { class: klasse, id: "test-" + t.id }, kopf, ...anleitung(t), verlauf(t, d), ...formular(t, d));
	const letzte = d.ergebnisse.filter((x) => x.test === t.id).slice(-1)[0];
	return h("details", { class: klasse, id: "test-" + t.id },
		h("summary", {}, kopf, letzte ? h("div", { class: "leise", text: `${letzte.player}, ${datumZeit(letzte.zeit)}` + (letzte.text ? ` – ${letzte.text}` : "") }) : null),
		h("strong", { text: "Verlauf" }), verlauf(t, d), ...anleitung(t), h("strong", { text: "Neu eintragen" }), ...formular(t, d));
}

// Admin-Tests (nur der Admin sieht sie, Seb ist der einzige) oben unter eigener Überschrift, darunter die für alle Tester.
function gruppen(tests, d) {
	const admin = tests.filter((t) => t.nurAdmin), alle = tests.filter((t) => !t.nurAdmin);
	if (!admin.length) return alle.map((t) => testKarte(t, d));
	return [h("h2", { class: "test-gruppe", text: `Nur für dich als Admin (${admin.length})` }), ...admin.map((t) => testKarte(t, d)),
		alle.length ? h("h2", { class: "test-gruppe", text: `Für alle Tester (${alle.length})` }) : null, ...alle.map((t) => testKarte(t, d))];
}

const LEER = { offen: "Alles getestet – danke! Abgelehnte und bestandene Tests findest du in den anderen Reitern.",
	abgelehnt: "Keine abgelehnten Tests.", bestanden: "Noch keine bestandenen Tests." };

async function laden() {
	const c = $("inhalt");
	let d;
	try { d = await Bridge.json("GET", "/api/tester/plan"); }
	catch (e) {
		if (e instanceof Bridge.SitzungAbgelaufen) return;
		return c.replaceChildren(h("p", { class: "meldung", text: e.status === 404 ? "Gerade gibt es nichts zu testen." : e.message }));
	}
	const jetzt = reiter();
	const je = { offen: [], abgelehnt: [], bestanden: [] };
	for (const t of d.tests) je[zustandVon(t, d)].push(t);
	c.replaceChildren(
		h("h1", { text: `Tests für Version ${d.version}` }),
		h("p", { class: "leise", text: `Commit ${d.commit} · angemeldet als ${d.ich}. Der Testserver ist eine Kopie der echten Bibliothek – was du hier tust, landet nicht im Live-System.` }),
		d.hinweis ? h("p", { class: "hinweis-box", text: d.hinweis }) : null,
		zusammenfassungZeigen(d.zusammenfassung),
		h("nav", { class: "test-reiter" }, REITER.map(([k, name]) =>
			h("a", { href: "#" + k, class: k === jetzt ? "aktiv" : "", text: `${name} (${je[k].length})` }))),
		jetzt === "offen" ? h("p", { class: "leise", text: "Öffne den Testserver in einem zweiten Tab („Testserver öffnen ↗“ oben rechts), geh die Schritte durch und trag hier ein, ob es geklappt hat. Bei „Hat nicht geklappt“ kannst du Fotos oder Screenshots anhängen (auch mit Strg/⌘+V). Eingetragene Tests wandern in „Abgelehnt“ bzw. „Bestanden“." })
			: h("p", { class: "leise", text: "Archiv: Klick auf einen Test zeigt, wer ihn wann geprüft hat, mit Begründung und Fotos. Du kannst dort auch neu eintragen." }),
		...(je[jetzt].length ? gruppen(je[jetzt], d) : [h("p", { class: "meldung", text: LEER[jetzt] })]));
}

laden();
