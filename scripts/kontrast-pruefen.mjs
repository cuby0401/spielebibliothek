// Prüft die Farb-Tokens in site/ui/tokens.css gegen WCAG 2 (AA): Text 4,5:1, Ränder/Icons/Fokus 3:1.
// Hell und dunkel, jeder Akzent. Ohne Abhängigkeiten. Aufruf: node scripts/kontrast-pruefen.mjs   (rot = Ausgang 1)
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../site/ui/tokens.css", import.meta.url), "utf8");

const block = (anfang) => { const i = css.indexOf(anfang); if (i < 0) throw new Error("Block fehlt: " + anfang); return css.slice(i, css.indexOf("}", i)); };
const werte = (text) => Object.fromEntries([...text.matchAll(/--b-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const hell = werte(block(':root, [data-thema="hell"] {'));
const dunkel = werte(block('[data-thema="dunkel"] {'));
const akzente = { blau: werte(block('[data-akzent="blau"]')) };
for (const name of ["gruen", "tuerkis", "violett", "rosa", "orange"]) akzente[name] = werte(block(`[data-akzent="${name}"]`));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const hellig = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const kontrast = (a, b) => { const [x, y] = [hellig(a), hellig(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [Vordergrund, Hintergründe, Mindestwert, wofür]
const PAARE = [
	["text", ["grund", "flaeche", "flaeche-2", "flaeche-3"], 4.5, "Text"],
	["text-leise", ["grund", "flaeche"], 4.5, "Nebentext"],
	["text-leise", ["flaeche-2"], 4.0, "Nebentext auf leiser Füllung (Platzhalter, Segment) – bewusst 4:1"],
	["linie-feld", ["flaeche", "grund"], 3, "Rand von Feldern, Haken, Radio"],
	["gefahr", ["flaeche", "grund"], 4.5, "Fehlertext, Gefahr-Knopf leise"],
	["gefahr-text", ["gefahr"], 4.5, "Text auf Gefahr-Knopf und Fehlermeldung"],
	["erfolg", ["flaeche"], 3, "Erfolgs-Icon, Kennzahl"],
	["warnung", ["flaeche"], 3, "Warn-Icon, Stern"],
	["info", ["flaeche"], 3, "Info-Icon"],
	["meldung-text", ["meldung"], 4.5, "Meldung (Snackbar)"],
	["text", ["erfolg-zart", "warnung-zart", "gefahr-zart", "info-zart"], 4.5, "Text in Marken und Hinweisen"],
	["flaeche", ["avatar-1", "avatar-2", "avatar-3", "avatar-4", "avatar-5", "avatar-6"], 4.5, "Initialen im Avatar"],
	["text", ["bild-1", "bild-2", "bild-3", "bild-4"], 3, "Icon auf Kachelfläche ohne Bild"],
];
let rot = 0, geprueft = 0;
const pruefe = (thema, t, vg, hg, min, wofuer) => {
	if (!t[vg] || !t[hg]) { console.log(`✗ ${thema}: Token fehlt (${vg} oder ${hg})`); rot++; return; }
	const k = kontrast(t[vg], t[hg]); geprueft++;
	if (k < min) { rot++; console.log(`✗ ${thema}: ${vg} auf ${hg} = ${k.toFixed(2)}:1, nötig ${min}:1 (${wofuer})`); }
};
for (const [thema, t] of [["hell", hell], ["dunkel", dunkel]]) {
	for (const [vg, hgs, min, wofuer] of PAARE) for (const hg of hgs) pruefe(thema, t, vg, hg, min, wofuer);
	for (const [name, a] of Object.entries(akzente)) {
		const s = thema === "hell" ? "h" : "d";
		const mit = { ...t, akzent: a[`akzent-${s}`], "akzent-text": a[`akzent-text-${s}`], "akzent-zart": a[`akzent-zart-${s}`] };
		pruefe(`${thema}/${name}`, mit, "akzent-text", "akzent", 4.5, "Text auf Hauptknopf");
		pruefe(`${thema}/${name}`, mit, "akzent", "flaeche", 4.5, "Links und Akzent-Text");
		pruefe(`${thema}/${name}`, mit, "akzent", "grund", 4.5, "Links auf dem Seitenhintergrund");
		pruefe(`${thema}/${name}`, mit, "akzent", "flaeche-2", 3, "Fokusring auf leiser Füllung");
		pruefe(`${thema}/${name}`, mit, "text", "akzent-zart", 4.5, "Text auf gewähltem Eintrag");
	}
}
console.log(rot ? `\n${rot} von ${geprueft} Farbpaaren unter WCAG AA` : `✓ Alle ${geprueft} Farbpaare erfüllen WCAG AA`);
process.exit(rot ? 1 : 0);
