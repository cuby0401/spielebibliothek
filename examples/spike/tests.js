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
	const A = "A Abschottung";
	const shim = window.__lsShim || {};
	const opak = self.origin === "null";
	if (opak) {
		mit(A, "Origin ist opak (null) – Modus A", true, self.origin);
		try { void document.cookie; mit(A, "document.cookie gesperrt", false, "lesbar"); }
		catch (e) { mit(A, "document.cookie gesperrt", true, e.name); }
		mit(A, "echtes localStorage gesperrt", !!shim.originalBlocked, shim.originalBlocked);
	} else {
		mit(A, "eigener Origin, nicht die Bibliothek – Modus B", self.origin !== "https://games.cuby0401.uk", self.origin);
		let keks = "";
		try { keks = document.cookie; } catch (e) { keks = e.name; }
		mit(A, "Login-Cookie nicht lesbar (HttpOnly)", !/CF_Authorization/.test(keks), keks ? "sichtbar: " + keks.replace(/=[^;]*/g, "=…") : "keine Cookies sichtbar");
		mit(A, "echtes localStorage (nur Info)", null, shim.originalBlocked ? "gesperrt: " + shim.originalBlocked : "vorhanden, wird ersetzt");
	}
	try { void parent.document.title; mit(A, "parent.document gesperrt", false, "lesbar"); }
	catch (e) { mit(A, "parent.document gesperrt", true, e.name); }
	try { void parent.localStorage.length; mit(A, "localStorage der Bibliothek gesperrt", false, "lesbar"); }
	catch (e) { mit(A, "localStorage der Bibliothek gesperrt", true, e.name); }
	try {
		const r = await zeitlimit(fetch("https://games.cuby0401.uk/games.json", { credentials: "include" }));
		mit(A, "Bibliothek per fetch gesperrt", false, "lesbar: " + r.status);
	} catch (e) { mit(A, "Bibliothek per fetch gesperrt", true, fehler(e)); }
	try {
		window.open("about:blank", "_top");
		await warte(300);
		mit(A, "Seite umleiten (_top) gesperrt", true, "kein Wechsel");
	} catch (e) { mit(A, "Seite umleiten (_top) gesperrt", true, fehler(e)); }

	// --- B: Dateien des Spiels laden (Frage 1) ---
	// B1: Laden ohne Netzwerk-API – der Browser schickt keinen Origin-Check
	const B1 = "B1 Laden ohne CORS-Prüfung";
	mit(B1, "klassisches <script src>", window.__classic === true, "");
	const css = getComputedStyle(document.getElementById("css-probe")).outlineStyle;
	mit(B1, "Stylesheet <link>", css === "dotted", css);
	const bild = await new Promise((r) => {
		const img = new Image();
		img.onload = () => r([true, img.naturalWidth + "×" + img.naturalHeight]);
		img.onerror = () => r([false, "onerror"]);
		img.src = "./pixel.png";
		setTimeout(() => r([false, "Zeitlimit"]), 6000);
	});
	mit(B1, "Bild <img>", ...bild);

	async function abruf(gruppe, name, url, opt) {
		try {
			const r = await zeitlimit(fetch(url, opt));
			const j = r.ok ? await r.json() : null;
			mit(gruppe, name, !!(j && j.ok), r.status + " " + r.type);
		} catch (e) { mit(gruppe, name, false, fehler(e)); }
	}
	function xhr(gruppe, name, url, mitCookie) {
		return new Promise((r) => {
			try {
				const x = new XMLHttpRequest();
				x.open("GET", url);
				x.withCredentials = !!mitCookie;
				x.onload = () => r([x.status === 200, "Status " + x.status]);
				x.onerror = () => r([false, "onerror"]);
				x.send();
				setTimeout(() => r([false, "Zeitlimit"]), 6000);
			} catch (e) { r([false, fehler(e)]); }
		}).then((e) => mit(gruppe, name, ...e));
	}
	await warte(1500); // Module laden asynchron
	const modul = (gruppe, name, art) => mit(gruppe, name, !!window.__mods["?art=" + art], "");
	const absolut = (pfad) => new URL(pfad, location.href).href;

	// B2: so wie heute – Caddy schickt keine CORS-Header
	const B2 = "B2 ohne CORS-Header (Stand heute)";
	await abruf(B2, "fetch()", "./data.json");
	await xhr(B2, "XMLHttpRequest (Phaser-Loader)", "./data.json");
	modul(B2, "<script type=module>", "modul");
	modul(B2, "<script type=module crossorigin> (Vite)", "modul-crossorigin");

	// B3: Caddy schickt CORS-Header, das Spiel bleibt unverändert (Browser schickt dann KEIN Cookie)
	const B3 = "B3 mit CORS-Header, ohne Cookie (Spiel unverändert)";
	await abruf(B3, "fetch()", "./data.json?cors=1");
	await xhr(B3, "XMLHttpRequest (Phaser-Loader)", "./data.json?cors=1");
	modul(B3, "<script type=module>", "modul-cors&cors=1");
	modul(B3, "<script type=module crossorigin> (Vite)", "modul-crossorigin-cors&cors=1");
	try { await zeitlimit(import(absolut("./mod.js?art=dynamisch&cors=1"))); modul(B3, "dynamisches import()", "dynamisch&cors=1"); }
	catch (e) { mit(B3, "dynamisches import()", false, fehler(e)); }

	// B4: CORS-Header UND Cookie ausdrücklich mitschicken (müsste das Spiel selbst so machen)
	const B4 = "B4 mit CORS-Header und Cookie";
	await abruf(B4, "fetch(…, {credentials:'include'})", "./data.json?cors=1&c=1", { credentials: "include" });
	await xhr(B4, "XMLHttpRequest withCredentials", "./data.json?cors=1&c=1", true);
	modul(B4, "<script type=module crossorigin=use-credentials>", "modul-credentials&cors=1");
	try {
		const r = await zeitlimit(fetch("./tiny.wasm?cors=1", { credentials: "include" }));
		await WebAssembly.compile(await r.arrayBuffer());
		mit(B4, "WebAssembly über fetch", true, "");
	} catch (e) { mit(B4, "WebAssembly über fetch", false, fehler(e)); }

	// B5: Worker brauchen einen echten Origin
	const worker = await new Promise((r) => {
		try {
			const w = new Worker("./worker.js");
			w.onmessage = (e) => r([e.data === "pong", String(e.data)]);
			w.onerror = (e) => r([false, "onerror " + (e.message || "")]);
			w.postMessage("ping");
			setTimeout(() => r([false, "Zeitlimit"]), 6000);
		} catch (e) { r([false, fehler(e)]); }
	});
	mit("B5 Sonstiges", "Web Worker", ...worker);

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
