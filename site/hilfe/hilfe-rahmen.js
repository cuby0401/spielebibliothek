"use strict";
// Hilfe-Center (Hilfe und Entwickler-Handbuch): Kopfleiste, Reiter und Hinweise – alles aus den Bausteinen (UI-Bausteine, Phase 2).
// Die Seiten selbst sind fester Fließtext im Container .b-lesetext; Hinweise stehen dort als <p data-hinweis="info|akzent|…"> und
// werden hier zum Baustein UI.hinweis.
(function () {
	const zurueck = UI.knopf({ id: "zurueck", art: "leise", ikon: "pfeil-links", text: "Zurück", titel: "Zurück, wo du herkamst", onclick: () => {
		try {
			if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) return history.back();
		} catch { /* egal */ }
		location.href = "/";
	} });
	const aktiv = location.pathname.startsWith("/handbuch") ? "handbuch" : "hilfe";
	document.body.prepend(UI.kopfleiste({ marke: { text: "Spielebibliothek", href: "/" }, rechts: [zurueck] }));
	document.getElementById("inhalt").prepend(UI.reiter({ id: "hilfe-reiter", label: "Hilfe-Center", aktiv, eintraege: [
		{ id: "hilfe", text: "Spielen", href: "/hilfe/" },
		{ id: "handbuch", text: "Spiele entwickeln", href: "/handbuch/" },
		{ id: "antraege", text: "Fehler melden / Idee", href: "/#/antraege" }] }));
	for (const el of [...document.querySelectorAll("[data-hinweis]")]) {
		const n = UI.hinweis({ art: el.dataset.hinweis, inhalt: UI.h("p", {}, [...el.childNodes]) });
		if (el.dataset.rolle) n.dataset.rolle = el.dataset.rolle;
		el.replaceWith(n);
	}
})();
