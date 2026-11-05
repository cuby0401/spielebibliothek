// Seiten aus dem Benutzermenü (Phase 10): Einstellungen, Meine Spielstände, Meine Spiele, Anträge.
// Nutzt aus app.js: seiten, einstellungen, einstellungenSpeichern, spiele, ich, meldung, Bridge.
// Sicherheit: Inhalte nur per textContent (Titel, Antragstexte usw. sind fremde Eingaben).
"use strict";

// Auf der Admin-Seite gibt es kein app.js – dann werden die Seiten einfach nicht registriert
const SEITEN_REG = typeof seiten !== "undefined" ? seiten : {};

// kleiner Baukasten für DOM-Elemente
function h(tag, eigenschaften, ...kinder) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(eigenschaften || {})) {
		if (k === "text") e.textContent = v;
		else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
		else if (v === true) e.setAttribute(k, "");
		else if (v !== false && v !== undefined && v !== null) e.setAttribute(k, v);
	}
	for (const kind of kinder.flat()) if (kind !== null && kind !== undefined && kind !== false) e.append(kind);
	return e;
}
const datumZeit = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–";
const groesse = (b) => b > 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.ceil(b / 1024)) + " KB";
const titelVon = (id) => (spiele.find((s) => s.id === id) || {}).title || id;

// ---------- Einstellungen ----------
SEITEN_REG["einstellungen"] = async (c) => {
	const umschalter = (key, text, hinweis) => h("label", { class: "haken" },
		h("input", { type: "checkbox", checked: !!einstellungen[key], onchange: (e) => einstellungenSpeichern({ [key]: e.target.checked }) }),
		h("span", {}, text, hinweis ? h("span", { class: "leise", text: " – " + hinweis }) : null));
	const sort = h("select", { onchange: (e) => einstellungenSpeichern({ sortierung: e.target.value }) },
		...[["alphabetisch", "alphabetisch"], ["zuletzt", "zuletzt gespielt"], ["neu", "neueste zuerst"]]
			.map(([w, t]) => h("option", { value: w, selected: einstellungen.sortierung === w, text: t })));
	c.append(
		h("h1", { text: "Einstellungen" }),
		h("div", { class: "karte" },
			h("label", {}, "Spiele in der Übersicht sortieren", sort),
			h("p", { class: "leise", text: "Favoriten (★ auf der Kachel) stehen immer oben, danach von Seb empfohlene Spiele." }),
			umschalter("grossansicht", "Großansicht", "Spiele füllen das ganze Fenster (echtes Vollbild weiter über den Knopf „Vollbild“)"),
			umschalter("bestenliste", "Bestenliste neben dem Spiel anzeigen")),
		h("p", { class: "leise", text: "Die Einstellungen gelten auf allen deinen Geräten." }),
		h("h2", { text: "Konto" }),
		h("div", { class: "karte" },
			h("div", {}, "Angemeldet als ", h("strong", { text: ich.player }),
				ich.admin ? " (Admin)" : ich.uploader ? " (Entwickler)" : ""),
			h("div", {}, h("a", { class: "knopf leise", href: "/cdn-cgi/access/logout", text: "Abmelden" }),
				h("span", { class: "leise", text: "  – z. B. an einem fremden Rechner. Beim nächsten Besuch ist ein neuer E-Mail-Code nötig." }))));
};

// ---------- Meine Spielstände ----------
SEITEN_REG["spielstaende"] = async (c) => {
	c.append(h("h1", { text: "Meine Spielstände" }),
		h("p", { class: "leise", text: "Spielstände liegen auf dem Server und gelten auf allen deinen Geräten. „Neu anfangen“ löscht deine Spielstände für ein Spiel – die letzten 5 Stände bleiben im Verlauf, Seb kann sie wiederherstellen. Deine Bestenlisten-Einträge bleiben." }));
	const liste = await Bridge.json("GET", "/api/meine/spielstaende");
	if (!liste.length) return c.append(h("p", { text: "Du hast noch keine Spielstände." }));
	const zeilen = liste.map((s) => h("tr", {},
		h("td", {}, h("strong", { text: s.title }), h("div", { class: "leise", text: s.spiel })),
		h("td", { text: s.keys.length + (s.keys.length === 1 ? " Eintrag" : " Einträge") + " · " + groesse(s.keys.reduce((n, k) => n + k.bytes, 0)) }),
		h("td", { text: datumZeit(s.zuletzt) }),
		h("td", {}, h("button", { type: "button", class: "knopf klein gefahr", text: "Neu anfangen",
			onclick: async () => {
				if (!confirm(`Deine Spielstände für „${s.title}“ löschen und neu anfangen?`)) return;
				await Bridge.json("DELETE", "/api/meine/spielstaende/" + s.spiel.split("/").map(encodeURIComponent).join("/"));
				meldung(`Spielstände für „${s.title}“ gelöscht.`);
				c.replaceChildren(); SEITEN_REG["spielstaende"](c);
			} }))));
	c.append(h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
		h("thead", {}, h("tr", {}, ...["Spiel", "Umfang", "Zuletzt", ""].map((t) => h("th", { text: t })))), h("tbody", {}, zeilen))));
};

// ---------- Meine Spiele (Entwickler) ----------
SEITEN_REG["meine-spiele"] = async (c) => {
	c.append(h("h1", { text: "Meine Spiele" }),
		h("p", {}, "Hochladen und aktualisieren: ", h("a", { href: "https://upload.cuby0401.uk", target: "_blank", rel: "noopener", text: "upload.cuby0401.uk" }),
			" · Anleitung: ", h("a", { href: "/hilfe/", text: "Hilfe" })));
	const liste = await Bridge.json("GET", "/api/entwickler/spiele");
	if (!liste.length) return c.append(h("p", { text: "Du hast noch keine Spiele hochgeladen." }));
	c.append(h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
		h("thead", {}, h("tr", {}, ...["Spiel", "Spieler", "Zuletzt gespielt", "Bestenliste", ""].map((t) => h("th", { text: t })))),
		h("tbody", {}, liste.map((s) => h("tr", {},
			h("td", {}, h("strong", { text: s.title }), h("div", { class: "leise", text: "Ordner " + s.id.split("/")[1] + (s.versteckt ? " · von Seb ausgeblendet" : "") }),
				s.warning ? h("div", { class: "warnung", text: "⚠ " + s.warning }) : null),
			h("td", { text: String(s.spieler) }),
			h("td", { text: datumZeit(s.zuletzt) }),
			h("td", { text: s.leaderboard.enabled ? `Season ${s.leaderboardSeason} · ${s.scores} Einträge` : "aus" }),
			h("td", {}, s.leaderboard.enabled ? h("button", { type: "button", class: "knopf klein leise", text: "Neue Season",
				title: "Neue, leere Bestenliste beginnen – die alte bleibt abrufbar",
				onclick: async () => {
					if (!confirm(`Neue Season für „${s.title}“ beginnen? Die Bestenliste startet leer, die alte bleibt über die Season-Auswahl abrufbar.`)) return;
					const r = await Bridge.json("POST", "/api/entwickler/season/" + s.id.split("/").map(encodeURIComponent).join("/"));
					meldung(`„${s.title}“: Season ${r.season} hat begonnen.`);
					c.replaceChildren(); SEITEN_REG["meine-spiele"](c);
				} }) : null)))))));
};

// ---------- Anträge (Entwickler) ----------
SEITEN_REG["antraege"] = async (c) => {
	const [arten, meine] = await Promise.all([Bridge.json("GET", "/api/antraege/arten"), Bridge.json("GET", "/api/antraege")]);
	const eigene = spiele.slice().sort((x, y) => x.title.localeCompare(y.title, "de"));   // alle sichtbaren Spiele
	const art = h("select", { required: true }, ...Object.entries(arten).map(([k, t]) => h("option", { value: k, text: t })));
	const spiel = h("select", {}, h("option", { value: "", text: "– kein bestimmtes Spiel –" }),
		...eigene.map((s) => h("option", { value: s.id, text: s.title })));
	const text = h("textarea", { rows: "5", required: true, maxlength: "4000", placeholder: "Was soll passieren? Je genauer, desto schneller." });
	const formular = h("form", { class: "karte", onsubmit: async (e) => {
		e.preventDefault();
		try {
			await Bridge.json("POST", "/api/antraege", { art: art.value, spiel: spiel.value || null, text: text.value });
			meldung("Antrag verschickt – Seb sieht ihn im Admin-Panel. Antwort und Status erscheinen hier.");
			c.replaceChildren(); SEITEN_REG["antraege"](c);
		} catch (f) { if (!(f instanceof Bridge.SitzungAbgelaufen)) meldung(f.message); }
	} },
		h("label", {}, "Art", art), h("label", {}, "Spiel", spiel), h("label", {}, "Beschreibung", text),
		h("div", {}, h("button", { type: "submit", class: "knopf", text: "Antrag senden" })));
	c.append(h("h1", { text: "Anträge" }),
		h("p", { class: "leise", text: ich.uploader || ich.admin
			? "Fehler, Wünsche oder Dinge, die nur Seb erledigen kann (z. B. Bestenliste zurücksetzen, Spielstand wiederherstellen, Spiel umbenennen)."
			: "Dir ist ein Fehler aufgefallen, du hast eine Idee oder dein Spielstand ist weg? Schreib es hier – Seb bekommt es direkt." }),
		formular, h("h2", { text: "Meine Anträge" }));
	if (!meine.length) return c.append(h("p", { class: "leise", text: "Noch keine Anträge." }));
	c.append(...meine.map((a) => h("div", { class: "karte" },
		h("div", {}, h("span", { class: "status " + a.status, text: a.status }), " ",
			h("strong", { text: arten[a.art] || a.art }), a.spiel ? h("span", { class: "leise", text: " · " + titelVon(a.spiel) }) : null,
			h("span", { class: "leise", text: " · " + datumZeit(a.erstellt) })),
		h("div", { text: a.text }),
		a.antwort ? h("div", { class: "antwort" }, h("strong", { text: "Antwort von Seb: " }), a.antwort) : null)));
};
