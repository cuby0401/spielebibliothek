// Sandbox-Spike (Phase 3): läuft IM abgeschotteten iframe und meldet die Ergebnisse
// per postMessage an die Testseite /spike/.
"use strict";

(async function () {
	const ergebnisse = [];
	const mit = (gruppe, name, ok, detail) => ergebnisse.push({ gruppe, name, ok, detail: String(detail ?? "") });
	const zeitlimit = (p, ms = 6000) =>
		Promise.race([p, new Promise((_, nein) => setTimeout(() => nein(new Error("Zeitlimit")), ms))]);
	const fehler = (e) => (e && e.name ? e.name + (e.message ? ": " + e.message : "") : String(e));
	const warte = (ms) => new Promise((r) => setTimeout(r, ms));

	// --- A: Abschottung ---
	mit("A Abschottung", "Origin ist opak (null)", self.origin === "null", self.origin);
	try { void document.cookie; mit("A Abschottung", "document.cookie gesperrt", false, "lesbar"); }
	catch (e) { mit("A Abschottung", "document.cookie gesperrt", true, e.name); }
	try { void parent.document.title; mit("A Abschottung", "parent.document gesperrt", false, "lesbar"); }
	catch (e) { mit("A Abschottung", "parent.document gesperrt", true, e.name); }
	const shim = window.__lsShim || {};
	mit("A Abschottung", "echtes localStorage gesperrt", !!shim.originalBlocked, shim.originalBlocked);

	// --- B: Dateien des Spiels laden (Frage 1) ---
	const B = "B Laden";
	mit(B, "klassisches <script src>", window.__classic === true, "");
	const css = getComputedStyle(document.getElementById("css-probe")).outlineStyle;
	mit(B, "Stylesheet <link>", css === "dotted", css);

	const bild = await new Promise((r) => {
		const img = new Image();
		img.onload = () => r([true, img.naturalWidth + "×" + img.naturalHeight]);
		img.onerror = () => r([false, "onerror"]);
		img.src = "./pixel.png";
		setTimeout(() => r([false, "Zeitlimit"]), 6000);
	});
	mit(B, "Bild <img>", ...bild);

	async function abruf(name, url, opt) {
		try {
			const r = await zeitlimit(fetch(url, opt));
			const j = r.ok ? await r.json() : null;
			mit(B, name, !!(j && j.ok), r.status + " " + r.type);
		} catch (e) { mit(B, name, false, fehler(e)); }
	}
	await abruf("fetch() ohne Optionen", "./data.json");
	await abruf("fetch() mit CORS-Header + Cookie", "./data.json?cors=1", { credentials: "include" });

	const xhr = await new Promise((r) => {
		try {
			const x = new XMLHttpRequest();
			x.open("GET", "./data.json");
			x.onload = () => r([x.status === 200, "Status " + x.status]);
			x.onerror = () => r([false, "onerror"]);
			x.send();
			setTimeout(() => r([false, "Zeitlimit"]), 6000);
		} catch (e) { r([false, fehler(e)]); }
	});
	mit(B, "XMLHttpRequest (z. B. Phaser-Loader)", ...xhr);

	await warte(1500); // Module laden asynchron
	mit(B, "<script type=module>", !!window.__mods["?art=modul"], "");
	mit(B, "<script type=module crossorigin> (Vite)", !!window.__mods["?art=modul-crossorigin"], "");
	mit(B, "Modul use-credentials + CORS-Header", !!window.__mods["?art=modul-credentials&cors=1"], "");
	try { await zeitlimit(import("./mod.js?art=dynamisch")); mit(B, "dynamisches import()", !!window.__mods["?art=dynamisch"], ""); }
	catch (e) { mit(B, "dynamisches import()", false, fehler(e)); }

	const worker = await new Promise((r) => {
		try {
			const w = new Worker("./worker.js");
			w.onmessage = (e) => r([e.data === "pong", String(e.data)]);
			w.onerror = (e) => r([false, "onerror " + (e.message || "")]);
			w.postMessage("ping");
			setTimeout(() => r([false, "Zeitlimit"]), 6000);
		} catch (e) { r([false, fehler(e)]); }
	});
	mit(B, "Web Worker", ...worker);

	try {
		const r = await zeitlimit(fetch("./tiny.wasm?cors=1", { credentials: "include" }));
		await WebAssembly.compile(await r.arrayBuffer());
		mit(B, "WebAssembly (über fetch + CORS)", true, "");
	} catch (e) { mit(B, "WebAssembly (über fetch + CORS)", false, fehler(e)); }

	// --- C: localStorage-Ersatz (Frage 2) ---
	const C = "C localStorage-Ersatz";
	mit(C, "Ersatz installiert (defineProperty)", !!shim.installed, shim.error || "");
	mit(C, "Daten von Bibliothek übernommen", !!shim.inLibrary, shim.inLibrary ? "über iframe-Name" : "kein Name gesetzt");
	try {
		localStorage.setItem("spike-test", "a");
		mit(C, "localStorage.setItem/getItem", localStorage.getItem("spike-test") === "a", "");
	} catch (e) { mit(C, "localStorage.setItem/getItem", false, fehler(e)); }
	try {
		mit(C, "window./globalThis.localStorage", window.localStorage === localStorage && globalThis.localStorage === localStorage, "");
	} catch (e) { mit(C, "window./globalThis.localStorage", false, fehler(e)); }
	try {
		localStorage.punkte = 42; localStorage["name"] = "Test";
		mit(C, "Eigenschafts-Schreibweise (localStorage.x = …)", localStorage.getItem("punkte") === "42" && localStorage.name === "Test", "");
		delete localStorage.punkte; localStorage.removeItem("name");
	} catch (e) { mit(C, "Eigenschafts-Schreibweise (localStorage.x = …)", false, fehler(e)); }
	try {
		localStorage.setItem("spike-json", JSON.stringify({ level: 3, items: ["a"] }));
		const j = JSON.parse(localStorage.getItem("spike-json"));
		mit(C, "JSON speichern/lesen", j.level === 3 && j.items[0] === "a", "");
	} catch (e) { mit(C, "JSON speichern/lesen", false, fehler(e)); }
	try { sessionStorage.setItem("x", "1"); mit(C, "sessionStorage", sessionStorage.getItem("x") === "1", "nur im Speicher"); }
	catch (e) { mit(C, "sessionStorage", false, fehler(e)); }
	try { mit(C, "localStorage instanceof Storage", localStorage instanceof Storage, "nur Info"); }
	catch (e) { mit(C, "localStorage instanceof Storage", false, fehler(e)); }

	// Bleibt ein Wert über Neuladen erhalten? Zähler hochzählen.
	let lauf = 0;
	try {
		lauf = parseInt(localStorage.getItem("spike-laeufe") || "0", 10) + 1;
		localStorage.setItem("spike-laeufe", String(lauf));
	} catch (e) { /* steht schon oben als Fehler */ }
	mit(C, "Wert übersteht Neuladen", lauf > 1 ? true : null,
		lauf > 1 ? "Lauf Nr. " + lauf : "1. Lauf – „Neu laden“ drücken");

	parent.postMessage({ spike: 1, ergebnisse }, "*");
})();
