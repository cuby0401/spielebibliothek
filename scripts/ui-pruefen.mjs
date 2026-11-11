// Wächter für die einheitliche Oberfläche (UI-Bausteine, 10.11.2026). Läuft in scripts/deploy.sh mit, rot = kein Deploy.
// Aufruf: node scripts/ui-pruefen.mjs
//
// Geprüft wird:
//  1. site/ui/bausteine.css: keine Farbwerte (nur var(--b-…)), Klassen nur .b-…
//  2. site/ui/tokens.css: alle Tokens mit Präfix --b-
//  3. Jede UMGEBAUTE Seite (Liste unten): lädt die Bausteine, hat kein eigenes Stylesheet, kein style="…", und ihr Skript baut
//     keine eigenen Knöpfe/Felder/Dialoge, ruft kein confirm/prompt/alert, nutzt kein innerHTML und nur Klassen .b-…
// Neue Seite in Phase 2 umgebaut? Hier in UMGEBAUT eintragen – ab dann gilt die Prüfung für sie.
import { readFileSync, existsSync } from "node:fs";
const wurzel = new URL("../", import.meta.url);
const lesen = (p) => readFileSync(new URL(p, wurzel), "utf8");

// Seite: HTML-Datei und die Skripte, die nur zu ihr gehören
const UMGEBAUT = [
	{ html: "site/ui-test/index.html", js: ["site/ui-test/test.js"] },
	{ html: "site/upload/index.html", js: ["site/upload/upload.js"] },
	{ html: "site/tester/index.html", js: ["site/tester/tester.js"] },
	{ html: "site/hilfe/index.html", js: ["site/hilfe/hilfe-rahmen.js", "site/hilfe/hilfe.js"] },
	{ html: "site/handbuch/index.html", js: ["site/hilfe/hilfe-rahmen.js", "site/handbuch/handbuch.js"] },
	{ html: "site/index.html", js: ["site/app.js", "site/konto.js"] },
	{ html: "site/spike/index.html", js: ["site/spike/spike.js"] },
	{ html: "site/admin/index.html", js: ["site/admin/admin.js"] },
];
const PFLICHT = ["/ui/thema-frueh.js", "/ui/tokens.css", "/ui/bausteine.css", "/ui/ikonen.js", "/ui/bausteine.js"];

const fehler = [];
const melde = (datei, zeile, text) => fehler.push(`${datei}${zeile ? ":" + zeile : ""}  ${text}`);
const zeilen = (text, muster, datei, meldung) => text.split("\n").forEach((z, i) => {
	const ohneKommentar = z.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
	if (muster.test(ohneKommentar)) melde(datei, i + 1, meldung + ": " + z.trim().slice(0, 100));
});

// 1. bausteine.css
const bcss = lesen("site/ui/bausteine.css");
zeilen(bcss, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black)\b(?![-\w])/i, "site/ui/bausteine.css", "Farbwert statt Token");
for (const m of bcss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|[\s,{}>+~(])\.([a-zA-Z][\w-]*)/g))
	if (!m[2].startsWith("b-")) melde("site/ui/bausteine.css", 0, `Klasse ohne Präfix b-: .${m[2]}`);
// 2. tokens.css
for (const m of lesen("site/ui/tokens.css").matchAll(/^\s*--([\w-]+):/gm)) if (!m[1].startsWith("b-")) melde("site/ui/tokens.css", 0, `Token ohne Präfix b-: --${m[1]}`);

// 3. Jede Seite der Zentrale muss in UMGEBAUT stehen – keine Seite darf an den Bausteinen vorbei gebaut werden (Seb, 11.11.2026)
import { readdirSync } from "node:fs";
const alleSeiten = (dir) => readdirSync(new URL(dir, wurzel), { withFileTypes: true }).flatMap((e) =>
	e.isDirectory() ? alleSeiten(dir + e.name + "/") : e.name.endsWith(".html") ? [dir + e.name] : []);
for (const html of alleSeiten("site/")) if (!UMGEBAUT.some((u) => u.html === html)) melde(html, 0, "Seite nicht in UMGEBAUT – jede Seite wird aus den Bausteinen gebaut und hier eingetragen");

// 4. umgebaute Seiten
for (const seite of UMGEBAUT) {
	if (!existsSync(new URL(seite.html, wurzel))) { melde(seite.html, 0, "Datei fehlt"); continue; }
	const html = lesen(seite.html);
	for (const p of PFLICHT) if (!html.includes(p)) melde(seite.html, 0, `lädt ${p} nicht`);
	if (html.indexOf("/ui/thema-frueh.js") > html.indexOf("/ui/tokens.css")) melde(seite.html, 0, "thema-frueh.js muss vor tokens.css stehen (sonst blitzt es)");
	for (const m of html.matchAll(/<link[^>]+href="([^"]+\.css)[^"]*"/g)) if (!m[1].startsWith("/ui/")) melde(seite.html, 0, `eigenes Stylesheet ${m[1]} – Aussehen gehört in die Bausteine`);
	zeilen(html, /\sstyle="/, seite.html, "style-Attribut");
	zeilen(html, /<(button|input|select|textarea|dialog)\b/, seite.html, "eigenes Steuerelement im HTML – UI.knopf/feld/… benutzen");
	for (const js of seite.js) {
		const t = lesen(js);
		zeilen(t, /createElement\(\s*["'](button|input|select|textarea|dialog)["']/, js, "eigenes Steuerelement – UI.knopf/feld/auswahl/dialog benutzen");
		zeilen(t, /\bh\(\s*["'](button|input|select|textarea|dialog)["']/, js, "eigenes Steuerelement über h() – UI.knopf/feld/… benutzen");
		zeilen(t, /(^|[^.\w])(confirm|prompt|alert)\s*\(/, js, "Browser-Dialog – UI.bestaetigen/eingabe/hinweisDialog benutzen");
		zeilen(t, /\.innerHTML\s*=|insertAdjacentHTML/, js, "innerHTML – Inhalte nur über die Bausteine (textContent)");
		zeilen(t, /\.style\.(color|background|border|padding|margin|font)|style:\s*["'][^"']*(color|background|padding|margin)/i, js, "Aussehen im Skript – gehört in die Bausteine");
		zeilen(t, /#[0-9a-f]{6}\b/i, js, "Farbwert im Skript");
		for (const m of t.matchAll(/class:\s*["']([^"']+)["']/g))
			for (const k of m[1].split(/\s+/)) if (k && !k.startsWith("b-")) melde(js, 0, `eigene Klasse „${k}“ – nur Bausteine (.b-…) verwenden`);
	}
}

if (fehler.length) { console.log("✗ Einheitliche Oberfläche verletzt:\n  " + fehler.join("\n  ")); process.exit(1); }
console.log(`✓ Oberfläche einheitlich (${UMGEBAUT.length} umgebaute Seite${UMGEBAUT.length === 1 ? "" : "n"}, Bausteine sauber)`);
