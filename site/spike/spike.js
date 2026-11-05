// Testseite für den Sandbox-Spike (Phase 3). Spielt die Rolle der späteren Bridge:
// - lädt gespeicherte Werte VOR dem Spielstart und gibt sie per iframe-Name mit
// - nimmt Schreibwünsche (lsWrite) nur aus dem eigenen iframe an
// - speichert sie stellvertretend im eigenen localStorage (später: savesvc)
"use strict";

const SPIELE = { spike: "seb/spike", "legacy-localstorage": "seb/legacy-localstorage" };
const param = new URLSearchParams(location.search).get("spiel");
const spielName = SPIELE[param] ? param : "spike";
const spielId = SPIELE[spielName];
const ablage = "spike-saves:" + spielId;
const $ = (id) => document.getElementById(id);

function lesen() {
	try { return JSON.parse(localStorage.getItem(ablage)) || {}; } catch { return {}; }
}
function schreiben(obj) {
	try { localStorage.setItem(ablage, JSON.stringify(obj)); } catch { /* egal */ }
	zeigeGespeichert();
}
function zeigeGespeichert() {
	const d = lesen();
	$("gespeichert").textContent = Object.keys(d).length ? JSON.stringify(d, null, 1) : "(nichts)";
}

let iframe = null;
const eigeneFenster = new WeakSet(); // auch das gerade ersetzte iframe darf beim Entladen noch speichern
let zeitlimit = null;

function starten() {
	$("summe").textContent = spielName === "spike" ? "Test läuft …" : "Keks-Klicker: klicken, dann „Neu laden“ – die Kekse müssen bleiben.";
	$("tabelle").replaceChildren();
	iframe = document.createElement("iframe");
	// gleiche Sandbox wie in der Bibliothek
	iframe.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox");
	iframe.setAttribute("allow", "fullscreen; gamepad; autoplay");
	iframe.name = "gamesave:" + JSON.stringify(lesen()); // Vorladen ohne Warten
	iframe.src = "/play/" + spielId + "/index.html";
	$("rahmen").className = "rahmen " + (spielName === "spike" ? "klein" : "spiel");
	$("rahmen").replaceChildren(iframe);
	eigeneFenster.add(iframe.contentWindow);

	clearTimeout(zeitlimit);
	if (spielName === "spike") {
		zeitlimit = setTimeout(() => {
			$("summe").textContent = "✗ Keine Antwort aus dem iframe nach 15 s – Spieldateien laden vermutlich nicht (Cookie/Access?).";
		}, 15000);
	}
}

window.addEventListener("message", (e) => {
	if (!e.source || !eigeneFenster.has(e.source)) return; // nur eigene iframes
	const m = e.data;
	if (m && m.gs === 1 && m.op === "lsWrite" && m.changes && typeof m.changes === "object") {
		const d = lesen();
		for (const [k, v] of Object.entries(m.changes)) {
			if (v === null) delete d[k];
			else if (typeof v === "string") d[k] = v;
		}
		schreiben(d);
	}
	if (m && m.spike === 1 && Array.isArray(m.ergebnisse) && e.source === iframe.contentWindow) {
		clearTimeout(zeitlimit);
		zeigeErgebnisse(m.ergebnisse);
	}
});

async function sitzungPruefen() {
	try {
		const r = await fetch("/games.json", { cache: "no-store", redirect: "manual" });
		if (r.type === "opaqueredirect") return [false, "Weiterleitung zum Login → Sitzung abgelaufen"];
		return [r.ok, "Status " + r.status];
	} catch (e) { return [false, String(e)]; }
}

async function zeigeErgebnisse(liste) {
	const sitz = await sitzungPruefen();
	liste.unshift({ gruppe: "0 Bibliotheksseite", name: "Cloudflare-Sitzung gültig", ok: sitz[0], detail: sitz[1] });

	const tab = document.createElement("table");
	let gruppe = null;
	let ok = 0, nein = 0;
	for (const e of liste) {
		if (e.gruppe !== gruppe) {
			gruppe = e.gruppe;
			const tr = tab.insertRow();
			const th = document.createElement("th");
			th.colSpan = 3; th.className = "gruppe"; th.textContent = gruppe;
			tr.append(th);
		}
		const tr = tab.insertRow();
		const s = tr.insertCell(); s.className = "s";
		s.textContent = e.ok === true ? "✓" : e.ok === false ? "✗" : "…";
		tr.insertCell().textContent = e.name;
		const d = tr.insertCell(); d.className = "d"; d.textContent = e.detail;
		if (e.ok === true) ok++; else if (e.ok === false) nein++;
	}
	$("tabelle").replaceChildren(tab);
	$("summe").textContent = `${ok} ✓ · ${nein} ✗ · ${new Date().toLocaleString("de-DE")}`;
}

$("ua").textContent = navigator.userAgent;
$(spielName === "spike" ? "k-test" : "k-keks").classList.add("an");
$("neu").onclick = starten;
$("loeschen").onclick = () => { try { localStorage.removeItem(ablage); } catch { /* egal */ } zeigeGespeichert(); starten(); };
zeigeGespeichert();
starten();
