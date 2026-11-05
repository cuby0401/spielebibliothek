// Admin-Panel (Phase 10). Ob jemand Admin ist, entscheidet allein der Server (ADMINS im Speicher-Dienst).
// Nutzt h(), datumZeit(), groesse() aus konto.js und Bridge.json() aus bridge.js.
"use strict";

const $ = (id) => document.getElementById(id);
const api = (methode, pfad, body) => Bridge.json(methode, "/api/admin" + pfad, body);
const idPfad = (id) => id.split("/").map(encodeURIComponent).join("/");
let spieleCache = [];
const titel = (id) => (spieleCache.find((s) => s.id === id) || {}).title || id;

function meldung(text, fehler) {
	$("meldung").textContent = text || "";
	$("meldung").hidden = !text;
	$("meldung").style.borderColor = fehler ? "var(--warn)" : "";
}
async function sicher(fn) {
	try { await fn(); } catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message, true); }
}
const tabelle = (koepfe, zeilen) => h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
	h("thead", {}, h("tr", {}, ...koepfe.map((k) => h("th", { text: k })))), h("tbody", {}, zeilen)));
const knopf = (text, onclick, art = "leise") => h("button", { type: "button", class: "knopf klein " + art, text, onclick: () => sicher(onclick) });

// ---------- Übersicht ----------
async function uebersicht(c) {
	const d = await api("GET", "/uebersicht");
	const kz = (wert, text) => h("div", { class: "kennzahl" }, h("div", { class: "wert", text: String(wert) }), h("div", { class: "text", text }));
	c.append(h("div", { class: "kacheln-klein" },
		kz(d.spieler, "Spieler (users.yaml)"),
		kz(d.spiele, "Spiele" + (d.testspiele ? ` (+${d.testspiele} Testspiele)` : "") + (d.offline ? ` · ${d.offline} offline` : "")),
		kz(d.zaehler.saves, "Spielstände"),
		kz(d.zaehler.scores, "Bestenlisten-Einträge"), kz(d.offeneAntraege, "offene Anträge"),
		kz(groesse(d.datenbank), "Datenbank"), kz(d.sicherung ? datumZeit(d.sicherung) : "–", "letzte DB-Kopie fürs Backup")));
	c.append(h("p", { class: "leise", text: "Backup: borgmatic sichert jede Nacht um 02:00 – den Erfolg zeigt das borgmatic-Log auf der NAS (docker logs borgmatic)." }));
	await zentraleZeigen(c);
	// „Ansicht als …“ (E26/E27): gilt für diesen Tab, beendet wird über das lila Band in der Bibliothek
	const ansichtStarten = (rolle) => { Bridge.ansicht = rolle; location.href = "/#/"; };
	c.append(h("h2", { text: "Bibliothek als Rolle ansehen" }),
		h("p", { class: "leise", text: "Zeigt die Bibliothek in diesem Tab so, wie Kollegen mit dieser Rolle sie sehen – mit einem eigenen, anfangs leeren Konto. Bestenliste und Anträge sind dabei gesperrt. Beenden über das lila Band oben in der Bibliothek." }),
		h("div", { class: "zeile" }, knopf("Ansicht als Spieler", () => ansichtStarten("spieler")), knopf("Ansicht als Entwickler", () => ansichtStarten("entwickler"))));
	c.append(h("h2", { text: "Letzte Aktivität" }), tabelle(["Spieler", "Spiel", "Zeit"],
		d.aktivitaet.map((a) => h("tr", {}, h("td", { text: a.player }), h("td", { text: a.title }), h("td", { text: datumZeit(a.zeit) })))));
	c.append(h("h2", { text: "Letzte Uploads und Konto-Änderungen" }), tabelle(["Zeit", "Wer", "Was", "Ordner"],
		d.uploads.map((u) => u.fehler ? h("tr", {}, h("td", { colspan: "4", text: u.fehler }))
			: h("tr", {}, h("td", { text: datumZeit(u.zeit) }), h("td", { text: u.player }), h("td", { text: u.aktion + (u.dateien ? ` (${u.dateien} Dateien)` : "") }), h("td", { text: u.ordner || "" })))));
	c.append(h("h2", { text: "Speicher je Entwickler" }), tabelle(["Entwickler", "Spieldateien"],
		Object.entries(d.speicher).map(([n, b]) => h("tr", {}, h("td", { text: n }), h("td", { text: groesse(b) })))));
}

// Version der Zentrale (E39): site/zentrale.json und CHANGELOG.md schreibt scripts/deploy.sh
async function zentraleZeigen(c) {
	let z = null, log = "";
	try { z = await (await fetch("/zentrale.json", { cache: "no-store" })).json(); } catch { /* vor E39 deployt */ }
	try { const r = await fetch("/admin/CHANGELOG.md", { cache: "no-store" }); if (r.ok) log = await r.text(); } catch { /* egal */ }
	c.append(h("h2", { text: "Zentrale" }),
		h("p", {}, z ? `Version ${z.version} · Commit ${z.commit} · deployt ${datumZeit(z.zeit)}` : "Version unbekannt (noch nicht mit Versionierung deployt)."),
		h("p", { class: "leise", text: "Zurück auf eine frühere Version: auf dem Mac scripts/deploy.sh --zurueck <version>. Vor jedem Deploy wird die Datenbank gesichert (data/backup/vor-deploy/)." }),
		log ? h("details", {}, h("summary", { text: "Änderungsprotokoll der Zentrale" }), h("pre", { class: "changelog", text: log })) : null);
}

// ---------- Spiele ----------
async function spieleSeite(c) {
	spieleCache = await api("GET", "/spiele");
	const zeilen = spieleCache.map((s) => {
		const schalter = (feld, text) => h("label", { class: "haken" }, h("input", { type: "checkbox", checked: !!s[feld],
			onchange: (e) => sicher(async () => { await api("PATCH", "/spiele/" + idPfad(s.id), { [feld]: e.target.checked }); meldung(`${s.title}: ${text} ${e.target.checked ? "an" : "aus"}`); }) }), text);
		return h("tr", {},
			h("td", {}, h("strong", { text: s.title }),
				h("div", { class: "leise", text: s.id + (s.version ? " · v" + s.version : "") + (s.complete ? "" : " · unvollständig") }),
				s.complete ? h("a", { href: "/#/spiel/" + s.id, text: "Öffnen" }) : null),
			h("td", { text: String(s.spieler) }), h("td", { text: String(s.daumen || 0) }), h("td", { text: datumZeit(s.zuletzt) }),
			h("td", { text: s.leaderboard.enabled ? `S${s.leaderboardSeason} · ${s.scores}` : "aus" }),
			h("td", { text: s.fehler && s.fehler.arten ? `${s.fehler.arten24h || 0} neu · ${s.fehler.anzahl}×` : "–" }),
			h("td", {}, h("div", { class: "zeile" }, schalter("versteckt", "ausblenden"), schalter("hervorgehoben", "empfehlen"), schalter("testspiel", "Testspiel"),
				h("label", { class: "haken", title: s.offlineGrund || "" }, h("input", { type: "checkbox", checked: !!s.offline,
					onchange: (e) => sicher(async () => {
						await Bridge.json("PUT", "/api/entwickler/offline/" + idPfad(s.id), { offline: e.target.checked });
						meldung(`${s.title}: ${e.target.checked ? "offline" : "wieder online"}`);
					}) }), "offline" + (s.offline && s.offlineGrund ? ` (${s.offlineGrund})` : "")))),
			h("td", {}, h("div", { class: "zeile" },
				s.leaderboard.enabled ? knopf("Bestenliste", () => bestenlisteDetail(c, s)) : null,
				s.leaderboard.enabled ? knopf("Neue Season", async () => {
					if (!confirm(`Neue Season für „${s.title}“?`)) return;
					const r = await Bridge.json("POST", "/api/entwickler/season/" + idPfad(s.id)); meldung(`Season ${r.season} begonnen.`); zeigen();
				}) : null,
				knopf("Löschen", async () => {
					const eingabe = prompt(`Spiel „${s.title}“ (${s.id}) mit allen Dateien löschen?\nSpielstände und Bestenliste bleiben in der Datenbank.\n\nZum Bestätigen den Ordnernamen eingeben:`);
					if (eingabe !== s.id.split("/")[1]) return meldung("Nicht gelöscht.");
					await api("DELETE", "/spiele/" + idPfad(s.id)); meldung(`${s.title} gelöscht.`); zeigen();
				}, "gefahr"))));
	});
	c.append(h("p", { class: "leise", text: "„Ausblenden“ versteckt ein Spiel in der Übersicht für alle außer dir (die Dateien bleiben unter play erreichbar). „Empfehlen“ heftet es mit Marke nach den Favoriten oben an. „Testspiel“ nimmt es für alle aus der Übersicht – auch für dich; öffnen über „Öffnen“ hier. Für Tutorials und Testwerkzeuge wie Spike, Böse oder die Bestenlisten-Vorlage." }),
		tabelle(["Spiel", "Spieler", "👍", "Zuletzt", "Bestenliste", "Fehler", "Sichtbarkeit", ""], zeilen));
	const fehler = await Bridge.json("GET", "/api/entwickler/fehler?alle=true");
	c.append(h("h2", { text: "Fehlerberichte aller Spiele" }),
		fehler.length ? tabelle(["Spiel", "Fehler", "Ort", "Anzahl", "Zuletzt", "Browser", ""], fehler.map((f) => h("tr", {},
			h("td", {}, f.title, f.entwurf ? h("span", { class: "leise", text: " (Entwurf)" }) : null),
			h("td", {}, h("code", { text: f.meldung })),
			h("td", { text: (f.quelle || "inline") + (f.zeile ? ":" + f.zeile : "") }),
			h("td", { text: String(f.anzahl) }), h("td", { text: datumZeit(f.letztes) }), h("td", { text: f.browser || "" }),
			h("td", {}, knopf("Erledigt", async () => { await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id); zeigen(); })))))
			: h("p", { class: "leise", text: "Keine Fehler gemeldet." }));
}

async function bestenlisteDetail(c, s) {
	const liste = await api("GET", "/scores/" + idPfad(s.id));
	c.replaceChildren(h("p", {}, knopf("← Spiele", () => zeigen())), h("h2", { text: "Bestenliste „" + s.title + "“ – alle Einträge (neueste zuerst)" }),
		h("div", { class: "zeile" },
			knopf(`Season ${s.leaderboardSeason} leeren`, async () => {
				if (!confirm(`Alle Einträge der Season ${s.leaderboardSeason} löschen?`)) return;
				const r = await api("DELETE", `/bestenliste/${idPfad(s.id)}?season=${s.leaderboardSeason}`); meldung(`${r.geloescht} Einträge gelöscht.`); bestenlisteDetail(c, s);
			}, "gefahr")),
		tabelle(["Zeit", "Spieler", "Season", "Score", "Werte", ""], liste.map((e) => h("tr", {},
			h("td", { text: datumZeit(e.zeit) }), h("td", { text: e.player }), h("td", { text: String(e.season) }), h("td", { text: String(e.score) }),
			h("td", { text: Object.keys(e.werte).length ? JSON.stringify(e.werte) : "" }),
			h("td", {}, knopf("Löschen", async () => { await api("DELETE", "/scores/" + e.id); bestenlisteDetail(c, s); }, "gefahr"))))));
}

// ---------- Benutzer ----------
async function benutzerSeite(c) {
	const liste = await api("GET", "/benutzer");
	const passwortZeigen = (name, pw) => {
		c.prepend(h("div", { class: "karte" }, h("strong", { text: `Upload-Passwort für ${name} (wird nur jetzt angezeigt):` }),
			h("div", { class: "passwort-box", text: pw }), h("span", { class: "leise", text: "Persönlich weitergeben, nicht per Mail." })));
		window.scrollTo(0, 0);
	};
	const mail = h("input", { type: "email", required: true, placeholder: "name@beispiel.de" });
	const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]{0,31}", placeholder: "z. B. paul" });
	const entw = h("input", { type: "checkbox" });
	c.append(h("h2", { text: "Neuer Benutzer" }),
		h("form", { class: "karte", onsubmit: (e) => { e.preventDefault(); sicher(async () => {
			const r = await api("POST", "/benutzer", { email: mail.value, name: name.value, entwickler: entw.checked });
			await zeigen();
			meldung(`${r.name} angelegt.`);
			if (r.passwort) passwortZeigen(r.name, r.passwort);
		}); } },
			h("div", { class: "zeile" }, h("label", {}, "E-Mail (Cloudflare-Login) ", mail), h("label", {}, "Benutzername ", name),
				h("label", { class: "haken" }, entw, "Entwickler (darf hochladen)")),
			h("div", { class: "hinweis-box", text: "Danach in Cloudflare Zero Trust die E-Mail in die Richtlinie „Kollegen“ eintragen – bei Entwicklern zusätzlich in „Entwickler“. Benutzernamen danach nie mehr ändern." }),
			h("div", {}, h("button", { type: "submit", class: "knopf", text: "Anlegen" }))));
	c.append(h("h2", { text: "Alle Benutzer" }), tabelle(["Name", "E-Mail", "Rolle", "Zuletzt aktiv", ""], liste.map((b) => h("tr", {},
		h("td", {}, h("strong", { text: b.name })), h("td", { text: b.email }),
		h("td", { text: [b.admin && "Admin", b.uploadKonto && "Entwickler", !b.uploadKonto && b.ordner && "Ordner ohne Upload-Konto", !b.admin && !b.uploadKonto && !b.ordner && "Spieler"].filter(Boolean).join(", ") }),
		h("td", { text: datumZeit(b.zuletzt) }),
		h("td", {}, h("div", { class: "zeile" },
			b.uploadKonto ? knopf("Neues Passwort", async () => {
				if (!confirm(`Neues Upload-Passwort für ${b.name}? Das alte gilt sofort nicht mehr.`)) return;
				const r = await api("POST", `/entwickler/${encodeURIComponent(b.name)}/passwort`); passwortZeigen(b.name, r.passwort);
			}) : knopf("Upload-Konto anlegen", async () => {
				const r = await api("POST", `/entwickler/${encodeURIComponent(b.name)}`); await zeigen(); passwortZeigen(b.name, r.passwort);
			}),
			b.uploadKonto && !b.admin ? knopf("Upload entziehen", async () => {
				if (!confirm(`${b.name} das Upload-Konto entziehen? Die Spiele bleiben.`)) return;
				await api("DELETE", `/entwickler/${encodeURIComponent(b.name)}`); meldung("Upload-Konto entfernt."); zeigen();
			}, "gefahr") : null,
			!b.admin ? knopf("Entfernen", async () => {
				if (!confirm(`${b.name} entfernen? Danach kein Zugang mehr zur Bibliothek. Spiele, Spielstände und Scores bleiben.\nIn Cloudflare zusätzlich die E-Mail aus den Richtlinien nehmen und Sitzungen widerrufen.`)) return;
				await api("DELETE", `/benutzer/${encodeURIComponent(b.name)}`); meldung(`${b.name} entfernt.`); zeigen();
			}, "gefahr") : null))))));
}

// ---------- Spielstände ----------
async function spielstaendeSeite(c, filter = {}) {
	const spieler = h("input", { placeholder: "alle", value: filter.player || "" });
	const spiel = h("input", { placeholder: "z. B. seb/zaehler", value: filter.game || "" });
	const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
	const liste = await api("GET", "/spielstaende" + (q.toString() ? "?" + q : ""));
	c.append(h("form", { class: "filter", onsubmit: (e) => { e.preventDefault(); c.replaceChildren(); sicher(() => spielstaendeSeite(c, { player: spieler.value.trim(), game: spiel.value.trim() })); } },
		h("label", {}, "Spieler", spieler), h("label", {}, "Spiel", spiel), h("button", { type: "submit", class: "knopf klein", text: "Filtern" })),
		tabelle(["Spieler", "Spiel", "Key", "Größe", "saveVersion", "Geändert", ""], liste.map((s) => h("tr", {},
			h("td", { text: s.player }), h("td", {}, s.title, h("div", { class: "leise", text: s.game })), h("td", { text: s.key }),
			h("td", { text: groesse(s.bytes) }), h("td", { text: String(s.version) }), h("td", { text: datumZeit(s.updatedAt) }),
			h("td", {}, knopf("Ansehen", () => spielstandDetail(c, s, filter)))))));
}

async function spielstandDetail(c, s, filter) {
	const q = new URLSearchParams({ player: s.player, game: s.game, key: s.key });
	const d = await api("GET", "/spielstand?" + q);
	c.replaceChildren(h("p", {}, knopf("← Spielstände", () => { c.replaceChildren(); return spielstaendeSeite(c, filter); })),
		h("h2", { text: `${s.player} · ${s.title} · ${s.key}` }),
		h("div", { class: "karte" }, h("strong", { text: "Aktuell" + (d.aktuell ? ` (saveVersion ${d.aktuell.version}, ${datumZeit(d.aktuell.updatedAt)})` : " – gelöscht") }),
			d.aktuell ? h("pre", { text: JSON.stringify(d.aktuell.data, null, 1) }) : null,
			d.aktuell ? h("div", {}, knopf("Spielstand löschen", async () => {
				if (!confirm("Spielstand löschen? Er landet im Verlauf.")) return;
				await api("DELETE", "/spielstand?" + q); spielstandDetail(c, s, filter);
			}, "gefahr")) : null),
		h("h2", { text: "Verlauf (die letzten 5 alten Stände)" }),
		...(d.verlauf.length ? d.verlauf.map((v) => h("div", { class: "karte" },
			h("div", { class: "zeile" }, h("strong", { text: datumZeit(v.savedAt) + ` · saveVersion ${v.version}` }),
				knopf("Diesen Stand wiederherstellen", async () => {
					if (!confirm("Diesen Stand wiederherstellen? Der aktuelle Stand landet im Verlauf.")) return;
					await api("POST", "/spielstand/wiederherstellen", { id: v.id }); meldung("Wiederhergestellt."); spielstandDetail(c, s, filter);
				})),
			h("pre", { text: JSON.stringify(v.data, null, 1) }))) : [h("p", { class: "leise", text: "Kein Verlauf." })]));
}

// ---------- Anträge ----------
async function antraegeSeite(c) {
	const liste = await api("GET", "/antraege");
	if (!liste.length) return c.append(h("p", { class: "leise", text: "Keine Anträge." }));
	c.append(...liste.map((a) => {
		const antwort = h("textarea", { rows: "2", maxlength: "4000", placeholder: "Antwort an " + a.player });
		antwort.value = a.antwort || "";
		const setzen = (status) => sicher(async () => { await api("PATCH", "/antraege/" + a.id, { status, antwort: antwort.value || null }); meldung(`Antrag ${a.id}: ${status}.`); zeigen(); });
		return h("div", { class: "karte" },
			h("div", {}, h("span", { class: "status " + a.status, text: a.status }), " ", h("strong", { text: a.artText }),
				h("span", { class: "leise", text: ` · von ${a.player}` + (a.spiel ? ` · ${a.spiel}` : "") + ` · ${datumZeit(a.erstellt)}` })),
			h("div", { text: a.text }),
			antwort,
			h("div", { class: "zeile" }, knopf("Erledigt", () => setzen("erledigt"), ""), knopf("Ablehnen", () => setzen("abgelehnt"), "gefahr"),
				a.status !== "offen" ? knopf("Wieder öffnen", () => setzen("offen")) : null));
	}));
}

// ---------- Navigation ----------
const SEITEN = { uebersicht, spiele: spieleSeite, benutzer: benutzerSeite, spielstaende: spielstaendeSeite, antraege: antraegeSeite };

async function zeigen() {
	const name = SEITEN[location.hash.slice(1)] ? location.hash.slice(1) : "uebersicht";
	for (const a of $("reiter").querySelectorAll("a")) a.classList.toggle("aktiv", a.getAttribute("href") === "#" + name);
	const c = $("inhalt");
	c.replaceChildren();
	await sicher(() => SEITEN[name](c));
	sicher(async () => {
		const offen = (await api("GET", "/antraege")).filter((a) => a.status === "offen").length;
		$("offen-zahl").textContent = String(offen); $("offen-zahl").hidden = !offen;
	});
}

(async () => {
	Bridge.beiAblauf = () => { $("abgelaufen").hidden = false; };
	try {
		const ich = await Bridge.json("GET", "/api/me");
		if (!ich.admin) {
			$("reiter").hidden = true;
			return meldung(ich.ansicht ? `„Ansicht als ${ich.ansicht === "spieler" ? "Spieler" : "Entwickler"}“ ist aktiv – das Admin-Panel ist gesperrt. Beenden über das lila Band oben in der Bibliothek.`
				: "Kein Zugriff – das Admin-Panel ist nur für Admins.", true);
		}
	} catch (e) { return meldung(e.message, true); }
	addEventListener("hashchange", () => { meldung(""); zeigen(); });
	zeigen();
})();
