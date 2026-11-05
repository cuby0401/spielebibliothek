"use strict";
// Entwickler-Handbuch: Prompt-Block aus prompt.txt (einzige Quelle – steckt auch als KI-ANWEISUNG.txt in der Startvorlage)
(async () => {
	const ziel = document.getElementById("prompt-text");
	try {
		const r = await fetch("/handbuch/prompt.txt", { cache: "no-store" });
		ziel.textContent = r.ok ? await r.text() : "Prompt-Block nicht ladbar – steht auch in startvorlage.zip (KI-ANWEISUNG.txt).";
	} catch {
		ziel.textContent = "Prompt-Block nicht ladbar – steht auch in startvorlage.zip (KI-ANWEISUNG.txt).";
	}
})();

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

document.getElementById("zurueck").addEventListener("click", () => {
	try {
		if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) return history.back();
	} catch { /* egal */ }
	location.href = "/";
});
