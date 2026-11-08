// Tester-Panel (Zentrale 1.4.0, E76): Tests mit genauer Anleitung, „Hat geklappt“ oder „Hat nicht geklappt“ mit Begründung.
// Den Testplan schreibt Claude ins Repo (tests/manuell/<Version>.json), die Ergebnisse sieht Seb auch im Admin-Panel der Probe.
// Nutzt h() und datumZeit() aus konto.js und Bridge.json() aus bridge.js.
"use strict";

const $ = (id) => document.getElementById(id);
function meldung(text) { $("meldung").textContent = text || ""; $("meldung").hidden = !text; }

function zusammenfassungZeigen(z) {
	return h("div", { class: "test-zusammenfassung" },
		h("span", { class: "ok", text: `✓ ${z.bestanden} bestanden` }),
		h("span", { class: "fehler", text: `✗ ${z.fehlgeschlagen} fehlgeschlagen` }),
		h("span", { text: `${z.offen} offen` }),
		h("span", { text: `${z.gesamt} insgesamt` }));
}

function testKarte(t, d) {
	const alle = d.ergebnisse.filter((x) => x.test === t.id);
	const meins = alle.find((x) => x.player === d.ich);
	const zustand = alle.some((x) => !x.ok) ? "fehler" : alle.length ? "ok" : "";
	const text = h("textarea", { placeholder: "Was ist passiert? (bei „Hat nicht geklappt“ Pflicht – z. B. was du stattdessen gesehen hast)" });
	if (meins && meins.text) text.value = meins.text;
	const senden = async (ok) => {
		try {
			await Bridge.json("POST", "/api/tester/ergebnis", { test: t.id, ok, text: text.value });
			meldung(ok ? `„${t.titel}“: als bestanden eingetragen. Danke!` : `„${t.titel}“: als fehlgeschlagen eingetragen. Danke!`);
			laden();
		} catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message); }
	};
	return h("article", { class: "karte test " + zustand, id: "test-" + t.id },
		h("div", { class: "test-kopf" },
			h("h2", { text: t.titel }),
			h("span", { class: "test-status", text: zustand === "fehler" ? "✗ fehlgeschlagen" : zustand === "ok" ? "✓ bestanden" : "offen" })),
		t.bereich ? h("div", { class: "leise", text: t.bereich }) : null,
		t.neuAb ? h("p", { class: "hinweis-box", text: `Bitte neu testen – geändert am ${datumZeit(t.neuAb)}. Ältere Ergebnisse zählen nicht mehr.` }) : null,
		t.hinweis ? h("p", { class: "leise", text: t.hinweis }) : null,
		h("strong", { text: "So testest du:" }),
		h("ol", {}, t.schritte.map((s) => h("li", { text: s }))),
		h("div", { class: "test-erwartet" }, h("strong", { text: "Erwartet: " }), t.erwartet),
		alle.length ? h("ul", { class: "test-ergebnisse" }, alle.map((x) => h("li", {},
			`${x.ok ? "✓" : "✗"} ${x.player}, ${datumZeit(x.zeit)}`, x.text ? h("span", { class: "leise", text: " – " + x.text }) : null))) : null,
		text,
		h("div", { class: "test-knoepfe" },
			h("button", { type: "button", class: "knopf ja", text: "✓ Hat geklappt", onclick: () => senden(true) }),
			h("button", { type: "button", class: "knopf nein", text: "✗ Hat nicht geklappt", onclick: () => senden(false) })));
}

async function laden() {
	const c = $("inhalt");
	let d;
	try { d = await Bridge.json("GET", "/api/tester/plan"); }
	catch (e) {
		if (e instanceof Bridge.SitzungAbgelaufen) return;
		return c.replaceChildren(h("p", { class: "meldung", text: e.status === 404 ? "Gerade gibt es nichts zu testen." : e.message }));
	}
	c.replaceChildren(
		h("h1", { text: `Tests für Version ${d.version}` }),
		h("p", { class: "leise", text: `Commit ${d.commit} · angemeldet als ${d.ich}. Der Testserver ist eine Kopie der echten Bibliothek – was du hier tust, landet nicht im Live-System.` }),
		d.hinweis ? h("p", { class: "hinweis-box", text: d.hinweis }) : null,
		zusammenfassungZeigen(d.zusammenfassung),
		h("p", { class: "leise", text: "Öffne den Testserver in einem zweiten Tab („Testserver öffnen ↗“ oben rechts), geh die Schritte durch und trag hier ein, ob es geklappt hat. Du kannst einen Test jederzeit erneut eintragen – es zählt dein neuester Eintrag." }),
		...d.tests.map((t) => testKarte(t, d)));
}

laden();
