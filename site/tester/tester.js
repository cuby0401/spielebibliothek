// Tester-Panel (Zentrale 1.4.0, E76): Tests mit genauer Anleitung, „Hat geklappt“ oder „Hat nicht geklappt“ mit Begründung.
// Den Testplan schreibt Claude ins Repo (tests/manuell/<Version>.json), die Ergebnisse sieht Seb auch im Admin-Panel.
// 1.4.1 (Seb): Reiter „Offen“ (Startseite), „Abgelehnt“ und „Bestanden“ als Archiv mit Verlauf; Fotos an Ergebnissen.
// 11.11.2026: komplett aus den UI-Bausteinen (window.UI). Nutzt datumZeit() und bildAuswahl() aus konto.js und Bridge.json() aus bridge.js.
// Kennungen für die Tests: data-test (Test-ID), data-zustand, data-ergebnis (ja/nein), data-zahl (Zusammenfassung).
"use strict";

// Meldungen: nur über den Baustein (auch für bildAuswahl() aus konto.js, das meldung(text, "fehler") ruft)
function meldung(text, art = "") {
	if (text) UI.meldung(text, { art: art === "fehler" ? "fehler" : art === "ok" ? "erfolg" : "info" });
}

const REITER = [["offen", "Offen"], ["abgelehnt", "Abgelehnt"], ["bestanden", "Bestanden"]];
const reiter = () => (REITER.find(([k]) => "#" + k === location.hash) || REITER[0])[0];
window.addEventListener("hashchange", () => laden());

// Kopfleiste und Band für eine abgelaufene Anmeldung
const abgelaufen = UI.band({ id: "abgelaufen", art: "warnung", versteckt: true, text: "Deine Anmeldung ist abgelaufen.",
	aktion: { text: "Seite neu laden", onclick: () => location.reload() } });
document.body.prepend(UI.kopfleiste({ marke: { text: "Tester-Panel", href: "/tester/" },
	rechts: [UI.knopf({ art: "leise", text: "Testserver öffnen", ikonRechts: "extern", href: "/", neuesFenster: true })] }), abgelaufen);
if (window.Bridge) {
	Bridge.beiAblauf = () => { abgelaufen.hidden = false; };
	Bridge.beiWieder = () => { abgelaufen.hidden = true; };
}

function zustandVon(t, d) {
	const alle = d.ergebnisse.filter((x) => x.test === t.id);
	return alle.some((x) => !x.ok) ? "abgelehnt" : alle.length ? "bestanden" : "offen";
}

function zusammenfassung(z) {
	const zahl = (wert, label, art, kennung) => { const k = UI.kennzahl({ wert, label, art }); k.dataset.zahl = kennung; return k; };
	return UI.raster([zahl(z.bestanden, "bestanden", "erfolg", "bestanden"), zahl(z.fehlgeschlagen, "fehlgeschlagen", z.fehlgeschlagen ? "gefahr" : null, "fehlgeschlagen"),
		zahl(z.offen, "offen", null, "offen"), zahl(z.gesamt, "insgesamt", null, "gesamt")], { art: "kennzahlen" });
}

const fotos = (ids) => ids && ids.length ? UI.bilder(ids.map((id) => ({ src: `/api/tester/bild/${id}`, href: `/api/tester/bild/${id}`, alt: "Foto" }))) : null;

// Verlauf: alle Einträge zu einem Test (auch ältere und vor einem Nachtest), neueste zuerst – wer hat wann was geprüft
function verlauf(t, d) {
	const alle = d.verlauf.filter((x) => x.test === t.id).reverse();
	if (!alle.length) return null;
	const gueltig = new Set(d.ergebnisse.filter((x) => x.test === t.id).map((x) => x.id));
	return UI.liste(alle.map((x) => {
		const z = UI.zeile({ ikon: x.ok ? "erfolg" : "fehler", titel: `${x.ok ? "Hat geklappt" : "Hat nicht geklappt"} – ${x.player}, ${datumZeit(x.zeit)}`,
			text: [x.text, gueltig.has(x.id) ? "" : "älter, zählt nicht mehr"].filter(Boolean).join(" · ") || null });
		const f = fotos(x.bilder);
		return f ? UI.stapel([z, f], { abstand: "s" }) : z;
	}), { label: "Verlauf" });
}

function formular(t, d) {
	const meins = d.ergebnisse.find((x) => x.test === t.id && x.player === d.ich);
	const text = UI.textbereich({ label: "Was ist passiert?", zeilen: 3, wert: meins && meins.text ? meins.text : "",
		hinweis: "Bei „Hat nicht geklappt“ Pflicht – z. B. was du stattdessen gesehen hast. Fotos oder Screenshots kannst du anhängen (auch mit Strg/⌘+V)." });
	const auswahl = bildAuswahl(5, text.eingabe);
	// Ist das Ergebnis schon gespeichert und nur ein Foto schiefgegangen, beim nächsten Klick nur die restlichen Fotos
	// hochladen – sonst entstünde derselbe Eintrag mehrfach (1.4.1-Nachtest: dreimal „Hat nicht geklappt“).
	let gespeichert = null, hochgeladen = 0;
	const senden = async (ok, knopf) => {
		knoepfe.forEach((k) => k.aus(true)); knopf.laden(true);
		try {
			if (!gespeichert || gespeichert.ok !== ok) {
				gespeichert = { ok, ...(await Bridge.json("POST", "/api/tester/ergebnis", { test: t.id, ok, text: text.wert })) };
				hochgeladen = 0;
			}
			const bilder = auswahl.bilder();
			for (; hochgeladen < bilder.length; hochgeladen++) {
				try { await Bridge.json("POST", `/api/tester/ergebnis/${gespeichert.id}/bilder`, { bild: bilder[hochgeladen] }); }
				catch (e) { if (e instanceof Bridge.SitzungAbgelaufen) throw e; throw new Error(`Eintrag gespeichert, aber Foto ${hochgeladen + 1} ging nicht: ${e.message}. Nochmal klicken lädt nur die fehlenden Fotos hoch.`); }
			}
			UI.meldung(`„${t.titel}“: als ${ok ? "bestanden" : "fehlgeschlagen"} eingetragen` + (bilder.length ? ` (mit ${bilder.length} ${bilder.length === 1 ? "Foto" : "Fotos"})` : "") + ". Danke!", { art: "erfolg" });
			laden();
		} catch (e) {
			knopf.laden(false); knoepfe.forEach((k) => k.aus(false));
			if (!(e instanceof Bridge.SitzungAbgelaufen)) UI.meldung(e.message, { art: "fehler" });
		}
	};
	const ja = UI.knopf({ art: "primaer", ikon: "haken", text: "Hat geklappt", onclick: () => senden(true, ja) });
	const nein = UI.knopf({ art: "gefahr", ikon: "schliessen", text: "Hat nicht geklappt", onclick: () => senden(false, nein) });
	ja.dataset.ergebnis = "ja"; nein.dataset.ergebnis = "nein";
	const knoepfe = [ja, nein];
	return [text, auswahl.element, UI.knopfleiste([nein, ja])];
}

function anleitung(t) {
	return [
		t.neuAb ? UI.hinweis({ art: "warnung", text: `Bitte neu testen – geändert am ${datumZeit(t.neuAb)}. Ältere Ergebnisse zählen nicht mehr.` }) : null,
		t.hinweis ? UI.text(t.hinweis, { art: "leise" }) : null,
		UI.lesetext([UI.h("strong", { text: "So testest du:" }), UI.h("ol", {}, t.schritte.map((s) => UI.h("li", { text: s })))]),
		UI.hinweis({ art: "akzent", titel: "Erwartet", text: t.erwartet })];
}

const STATUS = { offen: { text: "offen", art: "neutral" }, abgelehnt: { text: "fehlgeschlagen", art: "gefahr" }, bestanden: { text: "bestanden", art: "erfolg" } };

// Offene Tests: ganz aufgeklappt. Abgelehnte und bestandene (Archiv): eingeklappt, mit Verlauf und der Möglichkeit, neu einzutragen.
function testKarte(t, d) {
	const zustand = zustandVon(t, d);
	const status = UI.marke({ ...STATUS[zustand], punkt: true });
	let k;
	if (zustand === "offen") {
		k = UI.karte({ titel: t.titel, untertitel: t.bereich || null, ebene: "h2", aktionen: status, inhalt: [...anleitung(t), verlauf(t, d), ...formular(t, d)].filter(Boolean) });
	} else {
		const letzte = d.ergebnisse.filter((x) => x.test === t.id).slice(-1)[0];
		k = UI.aufklappen({ titel: t.titel, rechts: (letzte ? `${letzte.player}, ${datumZeit(letzte.zeit)} · ` : "") + STATUS[zustand].text, art: zustand === "abgelehnt" ? "gefahr" : null,
			inhalt: [letzte && letzte.text ? UI.hinweis({ art: zustand === "abgelehnt" ? "gefahr" : "erfolg", text: letzte.text }) : null,
				UI.abschnitt({ titel: "Verlauf", ebene: "h3", inhalt: verlauf(t, d) }),
				UI.abschnitt({ titel: "Anleitung", ebene: "h3", inhalt: UI.stapel(anleitung(t).filter(Boolean)) }),
				UI.abschnitt({ titel: "Neu eintragen", ebene: "h3", inhalt: UI.stapel(formular(t, d)) })].filter(Boolean) });
	}
	k.id = "test-" + t.id;
	k.dataset.test = t.id; k.dataset.zustand = zustand;
	return k;
}

// Admin-Tests (nur der Admin sieht sie, Seb ist der einzige) oben unter eigener Überschrift, darunter die für alle Tester.
function gruppen(tests, d) {
	const admin = tests.filter((t) => t.nurAdmin), alle = tests.filter((t) => !t.nurAdmin);
	if (!admin.length) return [UI.stapel(alle.map((t) => testKarte(t, d)))];
	return [UI.abschnitt({ titel: `Nur für dich als Admin (${admin.length})`, inhalt: UI.stapel(admin.map((t) => testKarte(t, d))) }),
		UI.abschnitt({ titel: `Für alle Tester (${alle.length})`, inhalt: alle.length ? UI.stapel(alle.map((t) => testKarte(t, d)))
			: UI.leer({ klein: true, ikon: "erfolg", titel: "Hier ist nichts mehr offen." }) })];
}

const LEER = {
	offen: { ikon: "erfolg", titel: "Alles getestet – danke!", text: "Abgelehnte und bestandene Tests findest du in den anderen Reitern." },
	abgelehnt: { ikon: "erfolg", titel: "Keine abgelehnten Tests." },
	bestanden: { ikon: "test", titel: "Noch keine bestandenen Tests." } };

async function laden() {
	const c = document.getElementById("inhalt");
	if (!c.firstChild) c.replaceChildren(UI.seite({ titel: "Tests", inhalt: UI.laden({ art: "skelett", zeilen: 6 }) }));
	let d;
	try { d = await Bridge.json("GET", "/api/tester/plan"); }
	catch (e) {
		if (e instanceof Bridge.SitzungAbgelaufen) return;
		return c.replaceChildren(UI.seite({ titel: "Tests", inhalt: UI.leer({ ikon: e.status === 404 ? "test" : "fehler",
			titel: e.status === 404 ? "Gerade gibt es nichts zu testen." : "Testplan nicht ladbar", text: e.status === 404 ? null : e.message }) }));
	}
	const jetzt = reiter();
	const je = { offen: [], abgelehnt: [], bestanden: [] };
	for (const t of d.tests) je[zustandVon(t, d)].push(t);
	c.replaceChildren(UI.seite({
		titel: `Tests für Version ${d.version}`,
		untertitel: `Commit ${d.commit} · angemeldet als ${d.ich}. Der Testserver ist eine Kopie der echten Bibliothek – was du hier tust, landet nicht im Live-System.`,
		inhalt: [
			d.hinweis ? UI.hinweis({ art: "info", text: d.hinweis }) : null,
			zusammenfassung(d.zusammenfassung),
			UI.stapel([
				UI.reiter({ id: "tester-reiter", label: "Tests", aktiv: jetzt, eintraege: REITER.map(([k, name]) => ({ id: k, text: name, zahl: je[k].length || null })),
					onwechsel: (k) => { location.hash = k; } }),
				UI.text(jetzt === "offen"
					? "Öffne den Testserver in einem zweiten Tab („Testserver öffnen“ oben rechts), geh die Schritte durch und trag hier ein, ob es geklappt hat. Eingetragene Tests wandern in „Abgelehnt“ bzw. „Bestanden“."
					: "Archiv: Klick auf einen Test zeigt, wer ihn wann geprüft hat, mit Begründung und Fotos. Du kannst dort auch neu eintragen.", { art: "leise" }),
				...(je[jetzt].length ? gruppen(je[jetzt], d) : [UI.leer(LEER[jetzt])])]),
		].filter(Boolean) }));
}

laden();
