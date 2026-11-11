"use strict";
// Hilfe für alle Spieler. Alles für Entwickler steht im Entwickler-Handbuch (/handbuch/). Kopfleiste und Reiter: hilfe-rahmen.js.

// Hilfe je nach Rolle: Spieler sehen nur, was sie brauchen. Bei Fehlern bleibt alles sichtbar.
(async () => {
	let ansicht = null;
	try { ansicht = sessionStorage.getItem("ansicht-als"); } catch { /* egal */ }
	try {
		const r = await fetch("/api/me", { headers: ansicht ? { "X-Ansicht": ansicht } : {}, cache: "no-store", redirect: "manual" });
		if (!r.ok) return;
		const ich = await r.json();
		const entwickler = ich.uploader || ich.admin;
		for (const e of document.querySelectorAll('[data-rolle="entwickler"]')) e.hidden = !entwickler;
		if (ich.ansicht) document.getElementById("hilfe-reiter").after(UI.hinweis({ id: "ansicht-hinweis", art: "akzent",
			text: `Ansicht als ${ich.ansicht === "spieler" ? "Spieler" : "Entwickler"}: Du siehst die Hilfe so, wie Kollegen mit dieser Rolle sie sehen.` }));
	} catch { /* Hilfe bleibt vollständig */ }
})();
