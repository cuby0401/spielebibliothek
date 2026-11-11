// Testseite für den Sandbox-Spike (Phase 3). Spielt die Rolle der späteren Bridge:
// - lädt gespeicherte Werte VOR dem Spielstart und gibt sie per iframe-Name mit
// - nimmt Schreibwünsche (lsWrite) nur aus dem eigenen iframe an
// - speichert sie stellvertretend im eigenen localStorage (später: savesvc)
"use strict";

const SPIELE = { spike: "seb/spike", "legacy-localstorage": "seb/legacy-localstorage" };
const PLAY = "https://play.cuby0401.uk";
const params = new URLSearchParams(location.search);
const param = params.get("spiel");
const spielName = SPIELE[param] ? param : "spike";
// Modus A: abgeschottetes iframe ohne Origin, Spiel unter games.cuby0401.uk/play (Stand Phase 1)
// Modus B: Spiel unter play.cuby0401.uk, iframe MIT allow-same-origin (eigener, fremder Origin)
const modus = "b"; // Modus A ist seit E14 entschieden und unter games nicht mehr erreichbar
const spielId = SPIELE[spielName];
const ablage = "spike-saves:" + spielId;
const $ = (id) => document.getElementById(id);

// Gerüst aus den Bausteinen
(function geruest() {
	const knopfLink = (id, text, aktiv) => { const k = UI.knopf({ art: "standard", text, id, href: "?" }); k.setAttribute("aria-pressed", String(aktiv)); return k; };
	const buehne = UI.buehne({ id: "buehne", rahmenId: "rahmen" });
	buehne.ohneSeite(true);
	$("app").replaceWith(UI.kopfleiste({ marke: { text: "Spielebibliothek", href: "/" }, rechts: [UI.marke({ text: "Sandbox-Spike (Phase 3)" })] }),
		UI.h("main", { class: "b-seite" },
			UI.h("div", { class: "b-seite__kopf" }, UI.h("h1", { class: "b-seite__titel", text: "Sandbox-Spike" }), UI.text("", { id: "ua", art: "klein" })),
			UI.leiste([knopfLink("k-test", "Technik-Test", spielName === "spike"), knopfLink("k-keks", "Keks-Klicker (localStorage)", spielName !== "spike"),
				UI.knopf({ art: "primaer", text: "Neu laden", ikon: "aktualisieren", id: "neu" }), UI.knopf({ art: "gefahr-leise", text: "Gespeichertes löschen", ikon: "loeschen", id: "loeschen" })]),
			UI.hinweis({ id: "summe-hinweis", art: "info", inhalt: UI.h("strong", { id: "summe", text: "Test läuft …" }) }),
			buehne,
			UI.h("div", { id: "tabelle", class: "b-stapel" }),
			UI.abschnitt({ titel: "Gespeichert (in dieser Testseite)", untertitel: "Stellvertretend für den späteren Speicher-Dienst: Die Testseite bewahrt die Werte in ihrem eigenen localStorage auf.",
				inhalt: UI.text("", { id: "gespeichert", tag: "pre", art: "vorformatiert" }) })));
})();

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
	iframe.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox" + (modus === "b" ? " allow-same-origin" : ""));
	iframe.setAttribute("allow", "fullscreen; gamepad; autoplay");
	iframe.name = "gamesave:" + JSON.stringify(lesen()); // Vorladen ohne Warten
	iframe.src = (modus === "b" ? PLAY : "") + "/play/" + spielId + "/index.html";
	$("buehne").toggleAttribute("data-flach", spielName === "spike");
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

// Ist der Browser auch für play.cuby0401.uk angemeldet? (true / false)
async function playAngemeldet() {
	try {
		const r = await fetch(PLAY + "/__status", { credentials: "include", redirect: "manual", cache: "no-store" });
		return r.type !== "opaqueredirect" && r.status === 204;
	} catch { return false; }
}

let sprungInfo = "";

// Einmaliger Sprung über play.cuby0401.uk: Access meldet den Browser dort an (bei gültiger
// Team-Sitzung ohne neuen Code) und schickt ihn zurück. Gegen Endlosschleifen: höchstens alle 60 s.
async function sicherstellenPlay() {
	if (modus !== "b") return true;
	const t0 = performance.now();
	if (await playAngemeldet()) {
		let sprung = null;
		try { sprung = sessionStorage.getItem("spike-sprung"); sessionStorage.removeItem("spike-sprung"); } catch { /* egal */ }
		sprungInfo = sprung ? "ja, nach Anmelde-Sprung (" + Math.round((Date.now() - +sprung) / 1000) + " s)" : "ja, schon angemeldet (" + Math.round(performance.now() - t0) + " ms)";
		return true;
	}
	let letzter = 0;
	try { letzter = +sessionStorage.getItem("spike-sprung") || 0; } catch { /* egal */ }
	if (Date.now() - letzter < 60000) {
		$("summe").textContent = "✗ Anmeldung für play.cuby0401.uk hat nach dem Sprung nicht geklappt.";
		return false;
	}
	try { sessionStorage.setItem("spike-sprung", String(Date.now())); } catch { /* egal */ }
	$("summe").textContent = "Melde bei play.cuby0401.uk an …";
	const ziel = location.pathname.replace(/^\//, "") + location.search;
	location.href = PLAY + "/__anmelden?ziel=" + encodeURIComponent(ziel);
	return false;
}

async function zeigeErgebnisse(liste) {
	const sitz = await sitzungPruefen();
	liste.unshift({ gruppe: "0 Bibliotheksseite", name: "Cloudflare-Sitzung gültig", ok: sitz[0], detail: sitz[1] });
	if (modus === "b") {
		liste.splice(1, 0, { gruppe: "0 Bibliotheksseite", name: "angemeldet für play.cuby0401.uk", ok: true, detail: sprungInfo });
	}

	const gruppen = new Map();
	let ok = 0, nein = 0;
	for (const e of liste) {
		if (!gruppen.has(e.gruppe)) gruppen.set(e.gruppe, []);
		gruppen.get(e.gruppe).push(e);
		if (e.ok === true) ok++; else if (e.ok === false) nein++;
	}
	$("tabelle").replaceChildren(...[...gruppen].map(([gruppe, eintraege]) => UI.abschnitt({ titel: gruppe, ebene: "h3", inhalt: UI.tabelle({ titel: gruppe, zeilen: eintraege, spalten: [
		{ titel: "", breite: "6rem", wert: (e) => UI.marke({ text: e.ok === true ? "ok" : e.ok === false ? "Fehler" : "…", art: e.ok === true ? "erfolg" : e.ok === false ? "gefahr" : "neutral", punkt: true }) },
		{ titel: "Test", feld: "name" },
		{ titel: "Detail", wert: (e) => UI.text(e.detail || "", { art: "klein" }) },
	] }) })));
	$("summe").textContent = `${ok} ✓ · ${nein} ✗ · ${new Date().toLocaleString("de-DE")}`;
	$("summe-hinweis").className = "b-hinweis b-hinweis--" + (nein ? "gefahr" : "erfolg");
}

$("ua").textContent = "Modus " + modus.toUpperCase() + " · " + navigator.userAgent;
for (const [id, wert] of [["k-test", null], ["k-keks", "legacy-localstorage"]]) {
	const q = new URLSearchParams();
	if (wert) q.set("spiel", wert);
	if (modus === "a") q.set("modus", "a");
	$(id).href = "?" + q;
}
$("neu").onclick = starten;
$("loeschen").onclick = () => { try { localStorage.removeItem(ablage); } catch { /* egal */ } zeigeGespeichert(); starten(); };
zeigeGespeichert();
sicherstellenPlay().then((ok) => { if (ok) starten(); });
