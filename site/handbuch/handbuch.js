"use strict";
// Entwickler-Handbuch: Prompt-Block aus prompt.txt (einzige Quelle – steckt auch als KI-ANWEISUNG.txt in der Startvorlage).
// Kopfleiste und Reiter: /hilfe/hilfe-rahmen.js.
const promptText = document.getElementById("prompt-text");
(async () => {
	try {
		const r = await fetch("/handbuch/prompt.txt", { cache: "no-store" });
		promptText.textContent = r.ok ? await r.text() : "Prompt-Block nicht ladbar – steht auch in startvorlage.zip (KI-ANWEISUNG.txt).";
	} catch {
		promptText.textContent = "Prompt-Block nicht ladbar – steht auch in startvorlage.zip (KI-ANWEISUNG.txt).";
	}
})();

const kopieren = UI.knopf({ id: "kopieren", art: "primaer", ikon: "kopieren", text: "Kopieren", onclick: async () => {
	try {
		await navigator.clipboard.writeText(promptText.textContent);
		UI.meldung("Prompt-Block kopiert.", { art: "erfolg" });
	} catch {
		const r = document.createRange();
		r.selectNodeContents(promptText);
		getSelection().removeAllRanges(); getSelection().addRange(r);
		UI.meldung("Markiert – mit ⌘C bzw. Strg+C kopieren.");
	}
} });
const kopf = document.getElementById("prompt-kopf");
const leiste = UI.leiste([], { verteilt: true });
kopf.replaceWith(leiste);
leiste.append(kopf, kopieren);
