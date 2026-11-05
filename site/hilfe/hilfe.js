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
