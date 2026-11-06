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
// Spielzeit lesbar: 45 s → „< 1 min“, 3900 → „1 h 5 min“
function dauer(sek) {
	if (!sek || sek < 60) return "< 1 min";
	const h = Math.floor(sek / 3600), m = Math.floor(sek / 60) % 60;
	return h ? `${h} h ${m} min` : `${m} min`;
}
const datumZeit = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–";
// Größe lesbar, Einheit passend zur Größe: B, KB, MB, GB, TB, PB (Zentrale 1.2.1)
function groesse(b) {
	const einheiten = ["B", "KB", "MB", "GB", "TB", "PB"];
	let i = 0, n = Math.max(0, Number(b) || 0);
	while (n >= 1024 && i < einheiten.length - 1) { n /= 1024; i++; }
	const stellen = i === 0 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
	return n.toLocaleString("de-DE", { maximumFractionDigits: stellen }) + " " + einheiten[i];
}

// Icons als SVG statt Emojis (Glocke, Daumen) – feste Zeichenwege, keine fremden Inhalte
const IKONEN = {
	glocke: '<path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>',
	daumen: '<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Z"/><path d="M7 11l4-7a2 2 0 0 1 3.2 2.3L13 10h5.3a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17 20H7"/>',
};
function ikon(name) {
	const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ikon"); s.setAttribute("aria-hidden", "true");
	s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
	s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
	s.innerHTML = IKONEN[name];
	return s;
}
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
async function spielstaendeAbschnitt(c) {
	c.append(
		h("p", { class: "leise", text: "Spielstände liegen auf dem Server und gelten auf allen deinen Geräten. „Neu anfangen“ löscht deine Spielstände für ein Spiel – die letzten 5 Stände bleiben im Verlauf, Seb kann sie wiederherstellen. Deine Bestenlisten-Einträge bleiben." }));
	const liste = await Bridge.json("GET", "/api/meine/spielstaende");
	if (!liste.length) return c.append(h("p", { text: "Du hast noch keine Spielstände." }));
	const zeilen = liste.map((s) => h("tr", {},
		h("td", {}, h("strong", { text: s.title }), h("div", { class: "leise", text: s.spiel })),
		h("td", { text: s.keys.length + (s.keys.length === 1 ? " Eintrag" : " Einträge") + " · " + groesse(s.keys.reduce((n, k) => n + k.bytes, 0)) }),
		h("td", { text: datumZeit(s.zuletzt) }),
		h("td", { text: dauer((spiele.find((x) => x.id === s.spiel) || {}).meineSpielzeit) }),
		h("td", {}, h("button", { type: "button", class: "knopf klein gefahr", text: "Neu anfangen",
			onclick: async () => {
				if (!confirm(`Deine Spielstände für „${s.title}“ löschen und neu anfangen?`)) return;
				await Bridge.json("DELETE", "/api/meine/spielstaende/" + s.spiel.split("/").map(encodeURIComponent).join("/"));
				meldung(`Spielstände für „${s.title}“ gelöscht.`);
				c.replaceChildren(); spielstaendeAbschnitt(c);
			} }))));
	c.append(h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
		h("thead", {}, h("tr", {}, ...["Spiel", "Umfang", "Zuletzt", "Deine Spielzeit", ""].map((t) => h("th", { text: t })))), h("tbody", {}, zeilen))));
}

// ---------- Meine Spiele (Entwickler) ----------
SEITEN_REG["meine-spiele"] = async (c) => {
	c.append(h("h1", { text: "Meine Spiele" }),
		h("p", {}, "Hochladen, Entwürfe veröffentlichen, alte Versionen zurückholen: ",
			h("a", { href: "https://upload.cuby0401.uk", target: "_blank", rel: "noopener", text: "upload.cuby0401.uk" }),
			" · Anleitung: ", h("a", { href: "/handbuch/", text: "Entwickler-Handbuch" })));
	const [liste, fehler, antraege] = await Promise.all([Bridge.json("GET", "/api/entwickler/spiele"), Bridge.json("GET", "/api/entwickler/fehler"),
		Bridge.json("GET", "/api/entwickler/antraege").catch(() => [])]);
	if (!liste.length) return c.append(h("p", { text: "Du hast noch keine Spiele hochgeladen." }));
	// 1.3.1: offene Anträge gleich oben sichtbar – ein Klick springt zu den Anträgen des Spiels
	const offeneAntraege = antraege.filter((a) => a.status === "offen" && a.player !== ich.player);
	const zuAntraegen = (spiel) => (e) => { e.preventDefault(); (document.getElementById("antraege-" + spiel) || document.getElementById("antraege"))?.scrollIntoView({ behavior: "smooth" }); };
	if (offeneAntraege.length) c.append(h("p", { class: "karte hinweis-antraege" }, `📬 ${offeneAntraege.length} ${offeneAntraege.length === 1 ? "offener Antrag" : "offene Anträge"} zu deinen Spielen – `,
		h("a", { href: "#/meine-spiele", text: "ansehen", onclick: zuAntraegen("") })));
	const fehlerText = (f) => !f || !f.arten ? "–" : `${f.arten24h ? f.arten24h + " neu (24 h) · " : ""}${f.anzahl}× gesamt`;
	c.append(h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
		h("thead", {}, h("tr", {}, ...["Spiel", "Spieler", "Daumen", "Spielzeit", "Zuletzt gespielt", "Bestenliste", "Fehler", "Anträge", ""].map((t) => h("th", { text: t })))),
		h("tbody", {}, liste.map((s) => {
			const [user, ordner] = s.id.split("/");
			return h("tr", {},
				h("td", {}, h("strong", { text: s.title }),
					h("div", { class: "leise", text: "Ordner " + ordner + (s.live ? "" : " · noch nicht veröffentlicht") + (s.versteckt ? " · von Seb ausgeblendet" : "") }),
					s.offline ? h("div", {}, h("span", { class: "status abgelehnt", text: "offline" }), s.offlineGrund ? " " + s.offlineGrund : "") : null,
					s.entwurf ? h("div", {}, h("span", { class: "status offen", text: "Entwurf" }), " vom " + datumZeit(s.entwurf.geaendert) + " · ",
						h("a", { href: `#/entwurf/${user}/${ordner}`, text: "Entwurf testen" })) : null,
					s.warning ? h("div", { class: "warnung", text: "⚠ " + s.warning }) : null),
				h("td", { text: String(s.spieler) }),
				h("td", { text: String(s.daumen || 0), title: "Daumen hoch von Spielern" }),
				h("td", { text: dauer(s.spielzeit), title: `${s.sitzungen || 0} Sitzungen – Spielzeit aller Spieler zusammen` }),
				h("td", { text: datumZeit(s.zuletzt) }),
				h("td", { text: s.leaderboard.enabled ? `Season ${s.leaderboardSeason} · ${s.scores} Einträge` : "aus" }),
				h("td", {}, fehlerText(s.fehler), s.fehlerEntwurf && s.fehlerEntwurf.arten ? h("div", { class: "leise", text: "Entwurf: " + fehlerText(s.fehlerEntwurf) }) : null),
				h("td", {}, (() => {
					const zuSpiel = antraege.filter((a) => a.spiel === s.id), offen = zuSpiel.filter((a) => a.status === "offen").length;
					return zuSpiel.length ? h("a", { href: "#/meine-spiele", class: offen ? "status offen" : "", text: offen ? `${offen} offen` : `${zuSpiel.length} erledigt`,
						onclick: zuAntraegen(s.id) }) : "–";
				})()),
				h("td", {}, s.live ? h("button", { type: "button", class: "knopf klein " + (s.offline ? "" : "leise"),
					text: s.offline ? "Wieder online stellen" : "Offline nehmen",
					title: s.offline ? "Spiel wieder für alle sichtbar machen" : "Spiel vorübergehend für alle anderen ausblenden – z. B. bei vielen Fehlern",
					onclick: async () => {
						let grund = null;
						if (!s.offline) {
							grund = prompt(`„${s.title}“ offline nehmen? Andere sehen es dann nicht mehr in der Übersicht, bis du es wieder online stellst.\nSpielstände und Bestenliste bleiben.\n\nGrund (optional, nur für dich und Seb):`, "");
							if (grund === null) return;
						}
						await Bridge.json("PUT", "/api/entwickler/offline/" + s.id.split("/").map(encodeURIComponent).join("/"), { offline: !s.offline, grund });
						meldung(s.offline ? `„${s.title}“ ist wieder online.` : `„${s.title}“ ist offline – nur du und Seb sehen es.`);
						c.replaceChildren(); SEITEN_REG["meine-spiele"](c);
					} }) : null,
					s.live && s.leaderboard.enabled ? h("button", { type: "button", class: "knopf klein leise", text: "Neue Season",
					title: "Neue, leere Bestenliste beginnen – die alte bleibt abrufbar",
					onclick: async () => {
						if (!confirm(`Neue Season für „${s.title}“ beginnen? Die Bestenliste startet leer, die alte bleibt über die Season-Auswahl abrufbar.`)) return;
						const r = await Bridge.json("POST", "/api/entwickler/season/" + s.id.split("/").map(encodeURIComponent).join("/"));
						meldung(`„${s.title}“: Season ${r.season} hat begonnen.`);
						c.replaceChildren(); SEITEN_REG["meine-spiele"](c);
					} }) : null));
		})))));

	antraegeProSpiel(c, antraege);

	c.append(h("h2", { text: "Fehlerberichte" }),
		h("p", { class: "leise", text: "JavaScript-Fehler, die beim Spielen in deinen Spielen auftreten – automatisch gemeldet, gleiche Fehler zusammengefasst, ohne Spielernamen. „Erledigt“ entfernt einen Eintrag; tritt der Fehler wieder auf, erscheint er neu." }));
	if (!fehler.length) return c.append(h("p", { class: "leise", text: "Keine Fehler gemeldet. 🎉" }));
	c.append(...fehler.map((f) => h("div", { class: "karte fehler-zeile" },
		h("div", {}, h("strong", { text: f.title }), f.entwurf ? h("span", { class: "status offen", text: " Entwurf " }) : null,
			h("span", { class: "leise", text: ` · ${f.anzahl}× · zuletzt ${datumZeit(f.letztes)} · ${f.browser || ""}` })),
		h("div", {}, h("code", { text: f.meldung })),
		f.quelle || f.zeile ? h("div", { class: "leise" }, "in ", h("code", { text: (f.quelle || "(Inline-Script)") + (f.zeile ? `:${f.zeile}` + (f.spalte ? `:${f.spalte}` : "") : "") })) : null,
		f.stack ? h("details", {}, h("summary", { text: "Stacktrace" }), h("pre", { text: f.stack })) : null,
		h("div", {}, h("button", { type: "button", class: "knopf klein leise", text: "Erledigt", onclick: async () => {
			await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id);
			c.replaceChildren(); SEITEN_REG["meine-spiele"](c);
		} })))));
};

// ---------- Bilder an Anträgen (Zentrale 1.3.1) ----------
// Screenshots werden im Browser verkleinert (längste Seite 1600 px, WebP bzw. JPEG) – so passen auch Handy-Fotos unter 2 MB.
const BILD_SEITE = 1600, BILD_MAX = 2 * 1024 * 1024;
async function bildVorbereiten(datei) {
	if (!datei || !/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(datei.type)) throw new Error(`„${datei && datei.name}“ ist kein Bild (PNG, JPG oder WebP)`);
	const bild = await createImageBitmap(datei).catch(() => { throw new Error(`„${datei.name}“ lässt sich nicht öffnen`); });
	const f = Math.min(1, BILD_SEITE / Math.max(bild.width, bild.height));
	const leinwand = document.createElement("canvas");
	leinwand.width = Math.max(1, Math.round(bild.width * f)); leinwand.height = Math.max(1, Math.round(bild.height * f));
	leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
	for (const q of [0.88, 0.75, 0.6, 0.45]) {
		let url = leinwand.toDataURL("image/webp", q);
		if (!url.startsWith("data:image/webp")) url = leinwand.toDataURL("image/jpeg", q);   // Safari ohne WebP-Export
		if (url.length * 0.75 < BILD_MAX - 1024) return url;
	}
	throw new Error(`„${datei.name}“ ist zu groß`);
}
// Bildauswahl mit Vorschau: Dateien wählen oder Screenshot einfügen (Strg/⌘+V im Textfeld). bilder() liefert die Daten-URLs.
function bildAuswahl(max, einfuegenIn) {
	const liste = [];
	const vorschau = h("div", { class: "antrag-bilder" });
	const eingabe = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true });
	const knopf = h("button", { type: "button", class: "knopf klein leise", text: "🖼 Bild anfügen", onclick: () => eingabe.click() });
	const hinweis = h("span", { class: "leise", text: ` bis zu ${max} Bilder – Screenshot auch mit Strg/⌘+V einfügen` });
	const zeigen = () => {
		vorschau.replaceChildren(...liste.map((url, i) => h("figure", {}, h("img", { src: url, alt: `Bild ${i + 1}` }),
			h("button", { type: "button", class: "knopf klein gefahr", text: "Entfernen", onclick: () => { liste.splice(i, 1); zeigen(); } }))));
		knopf.disabled = liste.length >= max;
	};
	const dazu = async (dateien) => {
		for (const d of dateien) {
			if (liste.length >= max) { meldung(`Höchstens ${max} Bilder.`); break; }
			try { liste.push(await bildVorbereiten(d)); } catch (f) { meldung(f.message); }
		}
		zeigen();
	};
	eingabe.addEventListener("change", () => { dazu([...eingabe.files]); eingabe.value = ""; });
	if (einfuegenIn) einfuegenIn.addEventListener("paste", (e) => {
		const dateien = [...(e.clipboardData?.files || [])].filter((d) => d.type.startsWith("image/"));
		if (dateien.length) { e.preventDefault(); dazu(dateien); }
	});
	return { element: h("div", { class: "bild-auswahl" }, h("div", {}, knopf, hinweis), eingabe, vorschau), bilder: () => liste.slice(), leeren: () => { liste.length = 0; zeigen(); } };
}
const bildText = (n) => n ? ` · ${n} ${n === 1 ? "Bild" : "Bilder"}` : "";
const oeffnen = (a) => h("a", { href: "#/antrag/" + a.id, class: "knopf klein leise", text: "Öffnen" + bildText(a.bilder) });

// Anträge zu den eigenen Spielen (1.3.0): pro Spiel, offen zuerst, geschlossene eingeklappt. Nur der Entwickler (und der Antragsteller) sieht sie.
function antraegeProSpiel(c, antraege) {
	c.append(h("h2", { id: "antraege", text: "Anträge zu deinen Spielen" }));
	if (!antraege.length) return c.append(h("p", { class: "leise", text: "Keine Anträge – Spieler können unter Menü → Anträge Fehler und Wünsche zu deinen Spielen schicken." }));
	const proSpiel = new Map();
	for (const a of antraege) { if (!proSpiel.has(a.spiel)) proSpiel.set(a.spiel, []); proSpiel.get(a.spiel).push(a); }
	const karte = (a) => {
		const antwort = h("textarea", { rows: "2", maxlength: "4000", placeholder: "Antwort an " + a.player });
		antwort.value = a.antwort || "";
		const setzen = async (status) => {
			try {
				await Bridge.json("PATCH", "/api/entwickler/antraege/" + a.id, { status, antwort: antwort.value || null });
				meldung(`Antrag von ${a.player}: ${status}.`);
				c.replaceChildren(); SEITEN_REG["meine-spiele"](c);
			} catch (f) { if (!(f instanceof Bridge.SitzungAbgelaufen)) meldung(f.message); }
		};
		const k = (text, fn, art = "leise") => h("button", { type: "button", class: "knopf klein " + art, text, onclick: fn });
		return h("div", { class: "karte" },
			h("div", {}, h("span", { class: "status " + a.status, text: a.status }), " ", h("strong", { text: a.artText }),
				h("span", { class: "leise", text: ` · von ${a.player} · ${datumZeit(a.erstellt)}` }), " ", oeffnen(a)),
			h("div", { class: "antrag-text", text: a.text }), antwort,
			h("div", { class: "zeile" }, k("Erledigt", () => setzen("erledigt"), ""), k("Ablehnen", () => setzen("abgelehnt"), "gefahr"),
				a.status !== "offen" ? k("Wieder öffnen", () => setzen("offen")) : null));
	};
	for (const [spiel, liste] of proSpiel) {
		const offen = liste.filter((a) => a.status === "offen"), zu = liste.filter((a) => a.status !== "offen");
		c.append(h("h3", { id: "antraege-" + spiel, text: `${liste[0].title || spiel} – ${offen.length} offen, ${zu.length} geschlossen` }), ...offen.map(karte));
		if (zu.length) c.append(h("details", {}, h("summary", { text: `Geschlossen (${zu.length})` }), ...zu.map(karte)));
	}
}

// ---------- Anträge (Entwickler) ----------
SEITEN_REG["antraege"] = async (c) => {
	const [arten, meine, anMich] = await Promise.all([Bridge.json("GET", "/api/antraege/arten"), Bridge.json("GET", "/api/antraege"),
		ich.uploader ? Bridge.json("GET", "/api/entwickler/antraege").catch(() => []) : Promise.resolve([])]);
	const eigene = spiele.slice().sort((x, y) => x.title.localeCompare(y.title, "de"));   // alle sichtbaren Spiele
	const art = h("select", { required: true }, ...Object.entries(arten).map(([k, t]) => h("option", { value: k, text: t })));
	const spiel = h("select", {}, h("option", { value: "", text: "– kein bestimmtes Spiel –" }),
		...eigene.map((s) => h("option", { value: s.id, text: s.title })));
	const text = h("textarea", { rows: "5", required: true, maxlength: "4000", placeholder: "Was soll passieren? Je genauer, desto schneller. Ein Screenshot hilft oft am meisten." });
	const auswahl = bildAuswahl(5, text);
	const formular = h("form", { class: "karte", onsubmit: async (e) => {
		e.preventDefault();
		const senden = e.submitter || formular.querySelector("[type=submit]");
		senden.disabled = true;
		try {
			const r = await Bridge.json("POST", "/api/antraege", { art: art.value, spiel: spiel.value || null, text: text.value });
			let fehlt = 0;   // Bilder einzeln hinterher (je Anfrage ein Bild)
			for (const bild of auswahl.bilder()) await Bridge.json("POST", `/api/antraege/${r.id}/bilder`, { bild }).catch((f) => { if (f instanceof Bridge.SitzungAbgelaufen) throw f; fehlt++; });
			if (fehlt) alert(`${fehlt} Bild(er) konnten nicht angefügt werden. Du kannst sie im Antrag (Öffnen) noch einmal anfügen.`);
			meldung(r.an && r.an !== "admin"
				? `Antrag verschickt – er geht an ${r.an === ich.player ? "dich als Entwickler (unter „Meine Spiele“)" : r.an + ", den Entwickler des Spiels"}. Antwort und Status erscheinen hier.`
				: "Antrag verschickt – Seb bekommt ihn. Antwort und Status erscheinen hier.");
			c.replaceChildren(); SEITEN_REG["antraege"](c);
		} catch (f) { senden.disabled = false; if (!(f instanceof Bridge.SitzungAbgelaufen)) meldung(f.message); }
	} },
		h("label", {}, "Art", art), h("label", {}, "Spiel", spiel), h("label", {}, "Beschreibung", text), auswahl.element,
		h("div", {}, h("button", { type: "submit", class: "knopf", text: "Antrag senden" })));
	c.append(h("h1", { text: "Anträge" }),
		h("p", { class: "leise", text: "Fehler, Wünsche und Sonstiges zu einem bestimmten Spiel gehen direkt an dessen Entwickler – nur er und du sehen den Antrag. "
			+ "Alles andere bekommt Seb: Fehler in der Bibliothek, Spielstand wiederherstellen" + (ich.uploader || ich.admin ? ", Bestenliste zurücksetzen, Spiel umbenennen." : ".") }),
		formular);
	// 1.3.1: Anträge zu den eigenen Spielen auch hier – offene oben, ein Klick öffnet den Antrag
	const fremde = anMich.filter((a) => a.player !== ich.player);
	if (fremde.length) {
		const offen = fremde.filter((a) => a.status === "offen");
		formular.before(h("div", { class: "karte antraege-an-mich" },
			h("h2", { text: `An dich – Anträge zu deinen Spielen (${offen.length} offen)` }),
			offen.length ? h("ul", { class: "antrag-liste" }, offen.map((a) => h("li", {},
				h("a", { href: "#/antrag/" + a.id }, h("strong", { text: a.title || a.spiel }), ` · ${a.artText} von ${a.player} · ${datumZeit(a.erstellt)}${bildText(a.bilder)}`),
				h("div", { class: "leise", text: a.text.length > 140 ? a.text.slice(0, 140) + " …" : a.text }))))
				: h("p", { class: "leise", text: "Alles erledigt. 🎉" }),
			h("p", {}, h("a", { href: "#/meine-spiele", text: `Alle ${fremde.length} Anträge pro Spiel → Meine Spiele` }))));
	}
	c.append(h("h2", { text: "Meine Anträge" }));
	if (!meine.length) return c.append(h("p", { class: "leise", text: "Noch keine Anträge." }));
	c.append(...meine.map((a) => h("div", { class: "karte" },
		h("div", {}, h("span", { class: "status " + a.status, text: a.status }), " ",
			h("strong", { text: arten[a.art] || a.art }), a.spiel ? h("span", { class: "leise", text: " · " + titelVon(a.spiel) }) : null,
			h("span", { class: "leise", text: " · " + datumZeit(a.erstellt) }), " ", oeffnen(a)),
		h("div", { class: "antrag-text", text: a.text }),
		h("div", { class: "leise", text: a.zustaendig && a.zustaendig !== "admin" ? "geht an " + a.zustaendig + " (Entwickler)" : "geht an Seb" }),
		a.antwort ? h("div", { class: "antwort" }, h("strong", { text: `Antwort von ${a.beantwortet_von || "Seb"}: ` }), a.antwort) : null)));
};

// ---------- Ein Antrag (Zentrale 1.3.1): #/antrag/<id> – aus der Glocke, „Anträge“ und „Meine Spiele“ ----------
SEITEN_REG["antrag"] = async (c) => {
	const id = antragNr;
	const a = await Bridge.json("GET", "/api/antraege/" + id);
	const neu = () => zeigeSeite("antrag");   // ganz neu aufbauen – mit Zurück-Pfeil
	const an = a.zustaendig === "admin" ? "Seb (Bibliothek)" : a.zustaendig === ich.player ? "dich (Entwickler)" : a.zustaendig + " (Entwickler)";
	c.append(h("h1", { text: `Antrag #${a.id}` }),
		h("div", { class: "karte antrag-ticket" },
			h("div", {}, h("span", { class: "status " + a.status, text: a.status }), " ", h("strong", { text: a.artText }),
				a.spiel ? h("span", {}, " · ", h("a", { href: "#/spiel/" + a.spiel, text: a.title || a.spiel })) : null),
			h("div", { class: "leise", text: `von ${a.eigener ? "dir" : a.player} · ${datumZeit(a.erstellt)} · geht an ${an}` +
				(a.geaendert !== a.erstellt ? ` · zuletzt geändert ${datumZeit(a.geaendert)}` : "") }),
			h("div", { class: "antrag-text", text: a.text })));
	// Bilder: Klick öffnet groß in neuem Tab
	const galerie = h("div", { class: "antrag-bilder" }, a.bilder.map((b) => h("figure", {},
		h("a", { href: `/api/antraege/${a.id}/bilder/${b.id}`, target: "_blank", rel: "noopener" },
			h("img", { src: `/api/antraege/${a.id}/bilder/${b.id}`, alt: "Bild von " + b.von, loading: "lazy" })),
		h("figcaption", { class: "leise", text: `${b.von === ich.player ? "von dir" : "von " + b.von} · ${groesse(b.bytes)}` },
			b.von === ich.player || ich.admin ? h("button", { type: "button", class: "knopf klein leise", text: "Entfernen", onclick: async () => {
				if (!confirm("Bild entfernen?")) return;
				await Bridge.json("DELETE", `/api/antraege/${a.id}/bilder/${b.id}`); neu();
			} }) : null))));
	if (a.bilder.length || a.darfBilder) c.append(h("h2", { text: "Bilder" }), a.bilder.length ? galerie : h("p", { class: "leise", text: "Noch keine Bilder." }));
	if (a.darfBilder && a.bilder.length < a.bilderMax) {
		const auswahl = bildAuswahl(a.bilderMax - a.bilder.length);
		c.append(auswahl.element, h("button", { type: "button", class: "knopf klein", text: "Bilder hochladen", onclick: async (e) => {
			const bilder = auswahl.bilder();
			if (!bilder.length) return meldung("Erst ein Bild auswählen.");
			e.target.disabled = true;
			try { for (const bild of bilder) await Bridge.json("POST", `/api/antraege/${a.id}/bilder`, { bild }); meldung("Bilder angefügt."); neu(); }
			catch (f) { e.target.disabled = false; if (!(f instanceof Bridge.SitzungAbgelaufen)) meldung(f.message); }
		} }));
	}
	c.append(h("h2", { text: "Antwort" }));
	if (a.antwort) c.append(h("div", { class: "antwort antrag-text" }, h("strong", { text: `${a.beantwortet_von || "Seb"}: ` }), a.antwort));
	else if (!a.darfAntworten) c.append(h("p", { class: "leise", text: "Noch keine Antwort." }));
	if (a.darfAntworten) {
		const antwort = h("textarea", { rows: "4", maxlength: "4000", placeholder: "Antwort an " + a.player });
		antwort.value = a.antwort || "";
		const setzen = async (status) => {
			try {
				await Bridge.json("PATCH", "/api/antraege/" + a.id, { status, antwort: antwort.value || null });
				meldung(`Antrag #${a.id}: ${status}.` + (a.player !== ich.player && status !== "offen" ? ` ${a.player} bekommt eine Nachricht.` : ""));
				neu();
			} catch (f) { if (!(f instanceof Bridge.SitzungAbgelaufen)) meldung(f.message); }
		};
		const k = (text, fn, art = "leise") => h("button", { type: "button", class: "knopf klein " + art, text, onclick: fn });
		c.append(h("div", { class: "karte" }, antwort,
			h("div", { class: "zeile" }, k("Erledigt", () => setzen("erledigt"), ""), k("Ablehnen", () => setzen("abgelehnt"), "gefahr"),
				a.status !== "offen" ? k("Wieder öffnen", () => setzen("offen")) : k("Nur Antwort speichern", () => setzen("offen")))));
	}
};

// ---------- Profil (Zentrale 1.2.0): Spielzeit, Erfolge, Bestplätze ----------
SEITEN_REG["profil"] = async (c) => {
	const d = await Bridge.json("GET", "/api/profil/" + encodeURIComponent(profilName));
	c.append(h("h1", { text: d.ich ? "Mein Profil" : "Profil von " + d.name }),
		h("div", { class: "profil-zahlen" },
			h("div", {}, h("b", { text: dauer(d.sekunden) }), "Spielzeit"),
			h("div", {}, h("b", { text: String(d.spiele.length) }), "Spiele"),
			h("div", {}, h("b", { text: String(d.erfolge) }), "Erfolge")));
	c.append(h("h2", { text: "Spiele" }));
	if (!d.spiele.length) c.append(h("p", { class: "leise", text: "Noch nichts gespielt." }));
	else c.append(h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
		h("thead", {}, h("tr", {}, ...["Spiel", "Spielzeit", "Platz (aktuelle Season)", "Erfolge"].map((t) => h("th", { text: t })))),
		h("tbody", {}, d.spiele.map((s) => h("tr", {},
			h("td", {}, h("a", { href: "#/spiel/" + s.id, text: s.title })),
			h("td", { text: dauer(s.sekunden) }),
			h("td", { text: s.platz ? s.platz + "." : "–" }),
			h("td", {}, s.erfolgeGesamt ? `${s.erfolge.length}/${s.erfolgeGesamt}` : "–",
				s.erfolge.length ? h("div", { class: "leise", text: s.erfolge.map((e) => "🏆 " + e.titel).join(" · ") }) : null)))))));
	// Nur im eigenen Profil: Spielstände und Anmeldungen (privat)
	if (!d.ich) return;
	const spielstaende = h("section", { class: "profil-abschnitt", id: "spielstaende" }, h("h2", { text: "Spielstände" }));
	const anmeldungen = h("section", { class: "profil-abschnitt", id: "anmeldungen" }, h("h2", { text: "Anmeldungen" }));
	c.append(spielstaende, anmeldungen);
	const sInhalt = h("div"), aInhalt = h("div");
	spielstaende.append(sInhalt); anmeldungen.append(aInhalt);
	await Promise.all([spielstaendeAbschnitt(sInhalt), anmeldungenAbschnitt(aInhalt)]);
};

// ---------- Anmeldungen (E55) mit „Trennen“ (Zentrale 1.2.1) ----------
async function anmeldungenAbschnitt(c) {
	c.append(h("p", { class: "leise", text: "Jede Anmeldung per E-Mail-Code gilt eine Woche auf einem Gerät. „Trennen“ beendet eine Anmeldung: Das Gerät wird beim nächsten Klick abgemeldet und braucht einen neuen Code. Unbekanntes Gerät? Trennen und Seb Bescheid geben." }));
	const liste = await Bridge.json("GET", "/api/meine/anmeldungen");
	if (!liste.length) return c.append(h("p", { text: "Noch keine Anmeldungen aufgezeichnet." }));
	const neu = async () => { c.replaceChildren(); await anmeldungenAbschnitt(c); };
	const andere = liste.filter((a) => !a.aktuell && !a.getrennt && a.sitzung);
	if (andere.length) c.append(h("p", {}, h("button", { type: "button", class: "knopf klein gefahr", text: `Alle anderen Geräte trennen (${andere.length})`,
		onclick: async () => {
			if (!confirm("Alle anderen Anmeldungen beenden? Nur dieses Gerät bleibt angemeldet.")) return;
			await Bridge.json("POST", "/api/meine/anmeldungen/trennen", { alleAnderen: true }); meldung("Alle anderen Geräte getrennt."); neu();
		} })));
	c.append(anmeldeTabelle(liste, false, async (a) => {
		if (!confirm(`Anmeldung „${a.geraet}“ beenden?`)) return;
		await Bridge.json("POST", "/api/meine/anmeldungen/trennen", { sitzung: a.sitzung }); meldung(`${a.geraet} getrennt.`); neu();
	}));
}

function anmeldeTabelle(liste, mitSpieler, trennen) {
	return h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
		h("thead", {}, h("tr", {}, ...[...(mitSpieler ? ["Spieler"] : []), "Gerät", "Ort", "IP", "Angemeldet", "Zuletzt aktiv", ""].map((t) => h("th", { text: t })))),
		h("tbody", {}, liste.map((a) => h("tr", {},
			mitSpieler ? h("td", { text: a.player }) : null,
			h("td", {}, a.geraet, a.aktuell ? h("span", { class: "status erledigt", text: " dieses Gerät " }) : null),
			h("td", { text: a.ort || "–" }),
			h("td", { text: a.ip || "–" }),
			h("td", { text: a.sitzung ? datumZeit(new Date(a.sitzung * 1000).toISOString()) : "–" }),
			h("td", { text: datumZeit(a.letzte) }),
			h("td", {}, a.getrennt ? h("span", { class: "status abgelehnt", text: "getrennt" })
				: trennen && !a.aktuell && a.sitzung ? h("button", { type: "button", class: "knopf klein gefahr", text: "Trennen", onclick: () => trennen(a) }) : null))))));
}

