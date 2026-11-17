// Freigabe für die Claude-App (Zentrale 1.6.0, E88): Die App schickt den Entwickler hierher (OAuth-Anmeldeseite des MCP-Servers).
// Hier gelten Cloudflare Access (Anwendung „upload“) UND das Upload-Passwort. „Erlauben“ gibt der App einen Zugang nur zu den
// eigenen Spielen, alles landet als Entwurf, veröffentlichen kann die App nicht. Kennungen für Tests: #mcp-erlauben, #mcp-ablehnen.
"use strict";

const API = "/api/upload";
const GAMES = "https://games.cuby0401.uk";
const q = new URLSearchParams(location.search);
const anfrage = {
	client_id: q.get("client_id") || "", redirect_uri: q.get("redirect_uri") || "", state: q.get("state") || "",
	code_challenge: q.get("code_challenge") || "", code_challenge_method: q.get("code_challenge_method") || "",
};

async function api(methode, pfad, body) {
	const r = await fetch(API + pfad, {
		method: methode, credentials: "same-origin", redirect: "manual", cache: "no-store",
		headers: { "X-Upload": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (r.type === "opaqueredirect") { location.reload(); throw new Error("Sitzung abgelaufen"); }
	const d = r.status === 204 ? null : await r.json().catch(() => ({}));
	if (!r.ok) { const e = new Error(d && typeof d.detail === "string" ? d.detail : "Fehler " + r.status); e.status = r.status; throw e; }
	return d;
}

document.body.prepend(UI.kopfleiste({ marke: { text: "Spielebibliothek · Claude verbinden", href: GAMES },
	rechts: [UI.knopf({ art: "leise", ikon: "buch", text: "Handbuch", href: GAMES + "/handbuch/#claude", neuesFenster: true })] }));
const app = document.getElementById("app");
const seite = (inhalt) => app.replaceChildren(UI.seite({ schmal: true, titel: "Claude verbinden", inhalt }));

function passwortZeigen() {
	const passwort = UI.feld({ id: "passwort", typ: "password", label: "Upload-Passwort", pflicht: true, autocomplete: "off" });
	seite(UI.karte({ inhalt: UI.formular({ id: "anmeldeform", absenden: "Anmelden", inhalt: [
		UI.text("Melde dich mit deinem Upload-Passwort an, um die Verbindung zu erlauben."), passwort],
	onabsenden: async () => {
		try { await api("POST", "/anmelden", { passwort: passwort.wert }); start(); }
		catch (e) { passwort.fehlerSetzen(e.message); }
	} }) }));
	passwort.eingabe.focus();
}

async function entscheiden(erlauben, knopf) {
	knopf.laden(true);
	try {
		const d = await api("POST", "/mcp/freigeben", { ...anfrage, erlauben });
		location.href = d.weiter;
	} catch (e) {
		knopf.laden(false);
		if (e.status === 401) return passwortZeigen();
		UI.meldung(e.message, { art: "fehler" });
	}
}

async function start() {
	let status, info;
	try {
		status = await api("GET", "/status");
		if (!status.entwickler) return seite(UI.leer({ ikon: "schloss", titel: "Kein Upload-Konto", text: "Nur Entwickler können Claude verbinden. Bitte bei Seb melden." }));
		if (!status.angemeldet) return passwortZeigen();
		info = await api("GET", "/mcp/anfrage?" + new URLSearchParams({ client_id: anfrage.client_id, redirect_uri: anfrage.redirect_uri }));
	} catch (e) {
		return seite(UI.leer({ ikon: "fehler", titel: "Verbindung nicht möglich", text: e.message }));
	}
	const istClaude = /claude/i.test(info.name);
	const erlauben = UI.knopf({ id: "mcp-erlauben", art: "primaer", text: "Erlauben", onclick: () => entscheiden(true, erlauben) });
	const ablehnen = UI.knopf({ id: "mcp-ablehnen", art: "standard", text: "Ablehnen", onclick: () => entscheiden(false, ablehnen) });
	seite(UI.stapel([
		istClaude ? null : UI.hinweis({ art: "warnung", titel: "Keine Claude-Anwendung",
			text: "Die Spielebibliothek ist für Claude gebaut und nur damit getestet. Mit einer anderen KI kann manches anders laufen." }),
		UI.karte({ titel: `„${info.name}“ möchte auf deine Spiele zugreifen`, untertitel: `Danach geht es weiter bei ${info.ziel}.`, inhalt: UI.stapel([
			UI.angaben([["Darf", "Handbuch und Vorlagen lesen, deine Spiele und Fehlerberichte ansehen, Entwürfe hochladen"],
				["Darf nicht", "Veröffentlichen, löschen, fremde Spiele ansehen – veröffentlichen machst du selbst"],
				["Konto", status.handle && status.handle !== status.player ? "@" + status.handle : status.player]]),
			UI.text("Du kannst den Zugang jederzeit auf der Upload-Seite unter „KI-Zugang (Claude)“ widerrufen.", { art: "klein" }),
			UI.knopfleiste([ablehnen, erlauben]),
		]) }),
	].filter(Boolean)));
}

if (!anfrage.client_id || !anfrage.redirect_uri) seite(UI.leer({ ikon: "info", titel: "Diese Seite öffnet die Claude-App", text: "Verbinde die Spielebibliothek in der Claude-App unter Einstellungen → Konnektoren. Anleitung im Handbuch, Kapitel „Claude direkt verbinden“." }));
else start();
