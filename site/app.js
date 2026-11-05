// Spielebibliothek – Bibliotheksseite
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Bibliotheksseite
//
// Spielliste kommt aus GET /api/games, Spiele laufen auf play.cuby0401.uk (E14),
// Speichern läuft über lib/bridge.js.
//
// Sicherheit: Alles aus game.json ist fremder Inhalt → nur per textContent einsetzen.
"use strict";

const ID_MUSTER = /^[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const el = (id) => document.getElementById(id);
let spiele = [];

function meldung(text) {
	el("meldung").textContent = text;
	el("meldung").hidden = !text;
}

function spielPfad(id) {
	return Bridge.PLAY + "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/";
}

function kachel(spiel) {
	const k = document.createElement("article");
	k.className = "kachel";

	const bild = document.createElement("div");
	bild.className = "bild";
	if (spiel.thumbnail) {
		const img = document.createElement("img");
		img.src = spielPfad(spiel.id) + spiel.thumbnail.split("/").map(encodeURIComponent).join("/");
		img.alt = "";
		img.loading = "lazy";
		img.onerror = () => { img.remove(); bild.textContent = "🎮"; };
		bild.append(img);
	} else {
		bild.textContent = "🎮";
	}

	const inhalt = document.createElement("div");
	inhalt.className = "inhalt";
	const h = document.createElement("h2");
	h.textContent = spiel.title;
	const autor = document.createElement("span");
	autor.className = "autor";
	autor.textContent = "von " + spiel.author;
	const text = document.createElement("p");
	text.className = "beschreibung";
	text.textContent = spiel.description;
	inhalt.append(h, autor, text);

	if (spiel.warning) {
		const w = document.createElement("p");
		w.className = "warnung";
		w.textContent = "⚠ " + spiel.warning;
		inhalt.append(w);
	}

	const a = document.createElement("a");
	a.className = "knopf";
	if (spiel.complete) {
		a.href = "#/spiel/" + spiel.id;
		a.textContent = "Spielen";
	} else {
		a.textContent = "unvollständig";
		a.setAttribute("aria-disabled", "true");
		a.title = "index.html fehlt";
	}
	inhalt.append(a);

	k.append(bild, inhalt);
	return k;
}

function zeigeUebersicht() {
	Bridge.beenden();
	el("rahmen").replaceChildren(); // laufendes Spiel beenden
	el("spielansicht").hidden = true;
	el("uebersicht").hidden = false;
	document.title = "Spielebibliothek";
}

async function zeigeSpiel(id) {
	const spiel = spiele.find((s) => s.id === id && s.complete);
	if (!spiel) {
		location.hash = "#/";
		return;
	}
	el("spieltitel").textContent = spiel.title;
	el("uebersicht").hidden = true;
	el("spielansicht").hidden = false;
	document.title = spiel.title + " – Spielebibliothek";
	try {
		const iframe = await Bridge.starten(spiel, el("rahmen"));
		iframe.focus();
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			el("rahmen").replaceChildren();
			meldung("Das Spiel konnte nicht gestartet werden: " + e.message);
			location.hash = "#/";
		}
	}
}

function route() {
	const m = location.hash.match(/^#\/spiel\/(.+)$/);
	if (m && ID_MUSTER.test(m[1])) zeigeSpiel(m[1]);
	else zeigeUebersicht();
}

async function start() {
	Bridge.beiAblauf = () => { el("abgelaufen").hidden = false; };
	el("vollbild").addEventListener("click", () => {
		const r = el("rahmen");
		if (r.requestFullscreen) r.requestFullscreen().catch(() => {});
	});

	// Für Spieldateien und Vorschaubilder muss der Browser auch bei play.cuby0401.uk angemeldet sein
	if (!(await Bridge.sicherstellenPlay())) {
		meldung("Die Anmeldung für die Spiele (play.cuby0401.uk) hat nicht geklappt. Bitte Seite neu laden.");
		return;
	}

	try {
		const [ich, liste] = await Promise.all([Bridge.json("GET", "/api/me"), Bridge.json("GET", "/api/games")]);
		Bridge.spieler = ich.player;
		el("benutzer").textContent = ich.player;
		el("benutzer").hidden = false;
		spiele = liste.filter((s) => typeof s.id === "string" && ID_MUSTER.test(s.id));
	} catch (e) {
		if (!(e instanceof Bridge.SitzungAbgelaufen)) {
			meldung(e.status === 403
				? "Für deine E-Mail-Adresse gibt es noch kein Konto in der Spielebibliothek. Bitte bei Seb melden."
				: "Die Spielliste konnte nicht geladen werden (" + e.message + ").");
		}
		return;
	}

	el("kacheln").replaceChildren(...spiele.map(kachel));
	if (!spiele.length) meldung("Noch keine Spiele.");

	window.addEventListener("hashchange", route);
	route();
}

start();
