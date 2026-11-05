"use strict";
document.getElementById("kopieren").addEventListener("click", async (e) => {
	const knopf = e.currentTarget;
	try {
		await navigator.clipboard.writeText(document.getElementById("prompt-text").textContent);
		knopf.textContent = "Kopiert ✓";
	} catch {
		const r = document.createRange();
		r.selectNodeContents(document.getElementById("prompt-text"));
		getSelection().removeAllRanges(); getSelection().addRange(r);
		knopf.textContent = "Markiert – mit ⌘C/Strg+C kopieren";
	}
	setTimeout(() => { knopf.textContent = "Kopieren"; }, 2500);
});

// Zurück dorthin, wo man herkam (sonst zur Übersicht)
document.getElementById("zurueck").addEventListener("click", () => {
	try {
		if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) return history.back();
	} catch { /* egal */ }
	location.href = "/";
});

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
		if (ich.ansicht) {
			const h = document.getElementById("ansicht-hinweis");
			h.textContent = `Ansicht als ${ich.ansicht === "spieler" ? "Spieler" : "Entwickler"}: Du siehst die Hilfe so, wie Kollegen mit dieser Rolle sie sehen.`;
			h.hidden = false;
		}
	} catch { /* Hilfe bleibt vollständig */ }
})();
