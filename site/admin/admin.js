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
	await zentraleFehlerZeigen(c);
	c.append(h("div", { class: "kacheln-klein" },
		kz(d.spieler, "Personen mit Zugang"),
		kz(d.spiele, "Spiele" + (d.testspiele ? ` (+${d.testspiele} Testspiele)` : "") + (d.offline ? ` · ${d.offline} offline` : "")),
		kz(d.zaehler.saves, "Spielstände"),
		kz(d.zaehler.scores, "Bestenlisten-Einträge"), kz(d.offeneAntraege, "offene Anträge"),
		kz(groesse(d.datenbank), "Datenbank"),
		d.platte && d.platte.gesamt ? kz(groesse(d.platte.frei), "frei auf der NAS" + (d.platte.knapp ? " ⚠" : "")) : null, kz(d.sicherung ? datumZeit(d.sicherung) : "–", "letzte DB-Kopie fürs Backup")));
	if (d.platte && d.platte.knapp) c.append(h("p", { class: "meldung fehler", text: `⚠ Speicher auf der NAS wird knapp: nur noch ${groesse(d.platte.frei)} von ${groesse(d.platte.gesamt)} frei. Alte Versionen löschen oder Kontingente (UPLOAD_KONTINGENT_MB) senken.` }));
	c.append(h("p", { class: "leise", text: "Backup: borgmatic sichert jede Nacht um 02:00 – den Erfolg zeigt das borgmatic-Log auf der NAS (docker logs borgmatic)." }));
	const w = d.waechter || {};
	c.append(h("h2", { text: "Wächter" }),
		h("p", { class: w.probleme && w.probleme.length ? "meldung fehler" : "leise",
			text: !w.aktiv ? "Wächter ist aus (WAECHTER=0)."
				: !w.letzterLauf ? "Wächter startet – erster Lauf etwa eine Minute nach dem Start."
				: (w.probleme.length ? "⚠ " + w.probleme.join(" · ") : "✓ Alles in Ordnung") + ` · zuletzt geprüft ${datumZeit(w.letzterLauf)}` }),
		h("p", { class: "leise", text: w.homeAssistant ? "Home Assistant bekommt Lebenszeichen, Probleme und neue Anträge (HA_WEBHOOK_URL gesetzt)."
			: "Home Assistant ist nicht verbunden – HA_WEBHOOK_URL in der .env setzen, Anleitung: docs/home-assistant.md im Repo." }));
	await zentraleZeigen(c);
	await probeZeigen(c);
	// „Ansicht als …“ (E26/E27): gilt für diesen Tab, beendet wird über das lila Band in der Bibliothek
	// Jeder Start beginnt mit leerem simulierten Konto – auch der Zwischenspeicher dieses Browsers dafür wird geleert
	const ansichtStarten = async (rolle) => {
		await api("POST", `/ansicht/${rolle}/zuruecksetzen`);
		try { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-puffer:") && k.endsWith(":" + rolle)) localStorage.removeItem(k); } catch { /* egal */ }
		Bridge.ansicht = rolle;
		// Beim Beenden zurück an genau diese Stelle im Admin-Panel (1.3.0)
		try { sessionStorage.setItem("ansicht-zurueck", JSON.stringify({ url: location.pathname + location.hash, y: Math.round(scrollY) })); } catch { /* egal */ }
		location.href = "/#/";
	};
	c.append(h("h2", { text: "Bibliothek als Rolle ansehen" }),
		h("p", { class: "leise", text: "Zeigt die Bibliothek in diesem Tab so, wie Kollegen mit dieser Rolle sie sehen – mit einem eigenen Konto, das bei jedem Start geleert wird. Bestenliste und Anträge sind dabei gesperrt. Beenden über das lila Band oben in der Bibliothek." }),
		h("div", { class: "zeile" }, knopf("Ansicht als Spieler", () => ansichtStarten("spieler")), knopf("Ansicht als Entwickler", () => ansichtStarten("entwickler"))));
	c.append(h("h2", { text: "Letzte Aktivität" }), tabelle(["Spieler", "Spiel", "Zeit"],
		d.aktivitaet.map((a) => h("tr", {}, h("td", { text: a.player }), h("td", { text: a.title }), h("td", { text: datumZeit(a.zeit) })))));
	c.append(h("h2", { text: "Letzte Uploads und Konto-Änderungen" }), tabelle(["Zeit", "Wer", "Was", "Ordner"],
		d.uploads.map((u) => u.fehler ? h("tr", {}, h("td", { colspan: "4", text: u.fehler }))
			: h("tr", {}, h("td", { text: datumZeit(u.zeit) }), h("td", { text: u.player }), h("td", { text: u.aktion + (u.dateien ? ` (${u.dateien} Dateien)` : "") }), h("td", { text: u.ordner || "" })))));
	c.append(h("h2", { text: "Speicher je Entwickler" }), tabelle(["Entwickler", "Live-Spiele", "Kontingent (inkl. Entwürfe und Versionen)"],
		Object.entries(d.speicher).map(([n, b]) => h("tr", {}, h("td", { text: n }), h("td", { text: groesse(b) }), h("td", { text: groesse(d.kontingent) })))));
}

// Fehler der Bibliothek selbst (Zentrale 1.4.0) – ganz oben, mit Fundort und Stacktrace. Leer: nur eine grüne Zeile.
async function zentraleFehlerZeigen(c) {
	let liste = [];
	try { liste = (await Bridge.json("GET", "/api/entwickler/fehler?alle=true")).filter((f) => f.zentrale); } catch { return; }
	if (!liste.length) return c.append(h("p", { class: "leise", text: "✓ Keine Fehler in der Bibliothek selbst gemeldet." }));
	c.append(h("h2", { text: `⚠ Fehler in der Bibliothek (${liste.length})` }),
		h("p", { class: "leise", text: "Abstürze der Bibliotheksseite bei Spielern – der Spieler sah dazu „Fehler-Nr. …“. Gleiche Fehler sind zusammengefasst. „Erledigt“ entfernt den Eintrag, tritt er wieder auf, erscheint er neu." }),
		tabelle(["Nr.", "Fehler", "Fundort", "Anzahl", "Zuletzt", "Browser", ""], liste.map((f) => h("tr", {},
			h("td", { text: String(f.id) }),
			h("td", {}, h("code", { text: f.meldung }), f.stack ? h("details", {}, h("summary", { text: "Seite, Version, Stacktrace" }), h("pre", { class: "changelog", text: f.stack })) : null),
			h("td", {}, h("code", { text: (f.quelle || "inline") + (f.zeile ? `:${f.zeile}` + (f.spalte ? `:${f.spalte}` : "") : "") })),
			h("td", { text: String(f.anzahl) }), h("td", { text: datumZeit(f.letztes) }), h("td", { text: f.browser || "" }),
			h("td", {}, knopf("Erledigt", async () => { await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id); zeigen(); }))))));
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

// Probe-Zentrale (E56): Kopie zum Testen; „Für Live freigeben“ erlaubt scripts/deploy.sh genau diesen Commit
const PROBE_URL = "http://<NAS_GH>:18188";
async function probeZeigen(c) {
	const p = await api("GET", "/probe").catch(() => null);
	if (!p) return;
	c.append(h("h2", { text: p.probe ? "🧪 Diese Seite ist die Probe-Zentrale" : "Probe-Zentrale" }));
	if (!p.probe) {
		return c.append(h("p", {}, "Neue Versionen der Zentrale laufen zuerst in der Probe – einer Kopie mit den echten Spielen und Daten, nur für dich über Tailscale: ",
			h("a", { href: PROBE_URL, target: "_blank", rel: "noopener", text: PROBE_URL.replace("http://", "") }),
			". Aufsetzen: scripts/deploy.sh --probe. Live geht eine Version erst, wenn du sie dort freigegeben hast."));
	}
	const f = p.freigabe;
	c.append(h("p", {}, `Version ${p.version || "?"} · Commit ${p.commit || "?"}` + (p.kopieVon ? ` · Daten kopiert ${datumZeit(p.kopieVon)}` : "")),
		h("p", { class: f && f.commit === p.commit ? "hinweis-box" : "leise" },
			f && f.commit === p.commit ? `✓ Freigegeben am ${datumZeit(f.zeit)}${f.notiz ? " – " + f.notiz : ""}.` : "Noch nicht freigegeben."),
		// Live-Deploy nach der Freigabe (1.3.0): meldet der Auftragsdienst
		f && f.commit === p.commit ? liveStatus(p) : null,
		h("div", { class: "zeile" },
			f && f.commit === p.commit
				? knopf("Freigabe zurücknehmen", async () => { await api("DELETE", "/probe/freigeben"); meldung("Freigabe zurückgenommen."); zeigen(); }, "gefahr")
				: knopf("Getestet – für Live freigeben", async () => {
					const notiz = prompt("Für Live freigeben? Was hast du getestet? (optional, steht in der Freigabe)", "");
					if (notiz === null) return;
					await api("POST", "/probe/freigeben", { notiz });
					meldung("Freigegeben – der Auftragsdienst spielt diese Version innerhalb einer Minute live ein.");
					zeigen();
				}, "")));
}

function liveStatus(p) {
	const l = p.live && p.live.commit === p.commit ? p.live : null;
	if (!l) {
		setTimeout(() => { if (!location.hash || location.hash === "#uebersicht") zeigen(); }, 10000);
		return h("p", { class: "leise", text: "Wartet auf den Auftragsdienst (spätestens nach einer Minute) … Ohne eingerichteten Auftragsdienst: auf dem Mac scripts/deploy.sh" });
	}
	if (l.status === "laeuft") setTimeout(() => { if (!location.hash || location.hash === "#uebersicht") zeigen(); }, 10000);
	return h("div", { class: l.status === "fehler" ? "hinweis-box" : "karte" },
		h("strong", { text: l.status === "ok" ? `✓ Live eingespielt (${datumZeit(l.zeit)})` : l.status === "fehler" ? "✗ Live-Deploy fehlgeschlagen – die bisherige Version läuft weiter" : "Wird gerade live eingespielt …" }),
		l.status === "fehler" ? h("p", { class: "leise", text: "Neuer Versuch: „Freigabe zurücknehmen“ und erneut freigeben." }) : null,
		l.text ? h("details", {}, h("summary", { text: "Ausgabe" }), h("pre", { class: "log", text: l.text })) : null);
}

// ---------- Spiele ----------
async function spieleSeite(c) {
	spieleCache = await api("GET", "/spiele");
	const sdw = await Bridge.json("GET", "/api/spiel-der-woche").catch(() => null);
	if (sdw) c.append(h("p", { class: "hinweis-box" }, `⭐ Spiel der Woche: „${sdw.title}“ bis ${datumZeit(sdw.ende)} `,
		knopf("Beenden", async () => { await Bridge.json("DELETE", "/api/admin/spiel-der-woche"); meldung("Spiel der Woche beendet."); zeigen(); })));
	const zeilen = spieleCache.map((s) => {
		const schalter = (feld, text) => h("label", { class: "haken" }, h("input", { type: "checkbox", checked: !!s[feld],
			onchange: (e) => sicher(async () => { await api("PATCH", "/spiele/" + idPfad(s.id), { [feld]: e.target.checked }); meldung(`${s.title}: ${text} ${e.target.checked ? "an" : "aus"}`); }) }), text);
		return h("tr", {},
			h("td", {}, h("strong", { text: s.title }),
				h("div", { class: "leise", text: s.id + (s.version ? " · v" + s.version : "") + (s.complete ? "" : " · unvollständig") }),
				s.complete ? h("a", { href: "/#/spiel/" + s.id, text: "Öffnen" }) : null),
			h("td", { text: String(s.spieler) }), h("td", { text: String(s.daumen || 0) }), h("td", { text: dauer(s.spielzeit) }), h("td", { text: datumZeit(s.zuletzt) }),
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
				s.leaderboard.enabled && !s.testspiel ? knopf(sdw && sdw.id === s.id ? "⭐ Spiel der Woche" : "Spiel der Woche", async () => {
					if (sdw && sdw.id === s.id) return;
					if (!confirm(`„${s.title}“ für 7 Tage zum Spiel der Woche machen? Alle bekommen eine Meldung, es gibt eine eigene Wochen-Bestenliste.` + (sdw ? `\nDas laufende („${sdw.title}“) endet dann.` : ""))) return;
					await Bridge.json("PUT", "/api/admin/spiel-der-woche/" + idPfad(s.id)); meldung(`„${s.title}“ ist Spiel der Woche.`); zeigen();
				}, sdw && sdw.id === s.id ? "" : "leise") : null,
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
		tabelle(["Spiel", "Spieler", "Daumen", "Spielzeit", "Zuletzt", "Bestenliste", "Fehler", "Sichtbarkeit", ""], zeilen));
	const fehler = (await Bridge.json("GET", "/api/entwickler/fehler?alle=true")).filter((f) => !f.zentrale);   // Bibliothek: siehe Übersicht
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

// ---------- Personen (CRM, Zentrale 1.4.0) ----------
const STATUS_TEXTE = { eingeladen: "eingeladen", aktiv: "aktiv", verwarnt: "verwarnt", gesperrt: "gesperrt", archiviert: "archiviert" };
const STATUS_KLASSE = { eingeladen: "offen", aktiv: "erledigt", verwarnt: "offen", gesperrt: "abgelehnt", archiviert: "" };
const ROLLEN_TEXT = { spieler: "Spieler", entwickler: "Entwickler", admin: "Admin", tester: "Tester" };
const anzeige = (p) => p.anzeigename || [p.vorname, p.nachname].filter(Boolean).join(" ") || "";
function passwortKarte(name, pw) {
	return h("div", { class: "karte" }, h("strong", { text: `Upload-Passwort für ${name} (wird nur jetzt angezeigt):` }),
		h("div", { class: "passwort-box", text: pw }), h("span", { class: "leise", text: "Persönlich weitergeben, nicht per Mail." }));
}
const rollenWahl = (aktuell, gesperrt = []) => {
	const boxen = {};
	const el = h("div", { class: "zeile" }, ...Object.entries(ROLLEN_TEXT).map(([r, t]) => {
		boxen[r] = h("input", { type: "checkbox", checked: aktuell.includes(r) || r === "spieler", disabled: r === "spieler" || gesperrt.includes(r) });
		return h("label", { class: "haken" }, boxen[r], t);
	}));
	return { el, werte: () => Object.keys(boxen).filter((r) => boxen[r].checked) };
};

async function personenSeite(c) {
	const [d, cf] = await Promise.all([api("GET", "/personen"), api("GET", "/cloudflare").catch(() => ({ eingerichtet: false }))]);
	// Einladen
	const mail = h("input", { type: "email", required: true, placeholder: "name@beispiel.de" });
	const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]{0,31}", placeholder: "z. B. paul" });
	const vorname = h("input", { placeholder: "optional" });
	const wahl = rollenWahl(["spieler"]);
	c.append(h("details", { class: "karte" }, h("summary", { text: "➕ Person einladen" }),
		h("form", { onsubmit: (e) => { e.preventDefault(); sicher(async () => {
			const r = await api("POST", "/personen", { email: mail.value, name: name.value, vorname: vorname.value || null, rollen: wahl.werte() });
			location.hash = "#person/" + r.person.name;
			meldung(`${r.person.name} eingeladen. Nächster Schritt: am Mac „python3 scripts/cloudflare.py abgleichen“, dann hier „Einladung senden“.`);
			if (r.passwort) setTimeout(() => $("inhalt").prepend(passwortKarte(r.person.name, r.passwort)), 300);
		}); } },
			h("div", { class: "zeile" }, h("label", {}, "E-Mail (Cloudflare-Login) ", mail), h("label", {}, "Benutzername ", name), h("label", {}, "Vorname ", vorname)),
			h("p", {}, "Rollen: ", wahl.el),
			h("p", { class: "leise", text: "Der Benutzername lässt sich danach nicht mehr ändern. Eingeladene kommen erst rein, wenn ihre E-Mail in Cloudflare steht (scripts/cloudflare.py abgleichen am Mac)." }),
			h("div", {}, h("button", { type: "submit", class: "knopf", text: "Einladen" })))));
	// Filter
	const suche = h("input", { type: "search", placeholder: "Name oder E-Mail" });
	const status = h("select", {}, h("option", { value: "", text: "alle außer archiviert" }), ...d.status.map((s) => h("option", { value: s, text: STATUS_TEXTE[s] })));
	const rolle = h("select", {}, h("option", { value: "", text: "alle Rollen" }), ...d.rollen.map((r) => h("option", { value: r, text: ROLLEN_TEXT[r] })));
	const tbody = h("tbody", {});
	const mitCf = d.cloudflare.geprueft;
	const fuellen = () => {
		const q = suche.value.trim().toLowerCase();
		tbody.replaceChildren(...d.personen.filter((p) => (status.value ? p.status === status.value : p.status !== "archiviert")
			&& (!rolle.value || p.rollen.includes(rolle.value))
			&& (!q || [p.name, anzeige(p), ...p.emails].some((x) => x.toLowerCase().includes(q)))).map((p) => h("tr", {},
			h("td", {}, h("a", { href: "#person/" + p.name }, h("strong", { text: p.name })), anzeige(p) ? h("div", { class: "leise", text: anzeige(p) }) : null),
			h("td", { text: p.emails.join(", ") || "–" }),
			h("td", { text: p.rollen.filter((r) => r !== "spieler").map((r) => ROLLEN_TEXT[r]).join(", ") || "Spieler" }),
			h("td", {}, h("span", { class: "status " + STATUS_KLASSE[p.status], text: STATUS_TEXTE[p.status] }),
				p.status === "eingeladen" ? h("div", { class: "leise", text: p.einladungGesendet ? "Mail " + datumZeit(p.einladungGesendet) : "noch keine Mail" }) : null),
			p.nieAngemeldet && p.status !== "archiviert"
				? h("td", { class: "warn", title: "Noch keine Anmeldung, kein Spielstand, kein Upload. Kommt der E-Mail-Code nicht an? Dann fehlt die Adresse meist in der Cloudflare-Richtlinie „Kollegen“.", text: "noch nie angemeldet" })
				: h("td", { text: datumZeit(p.zuletzt) }),
			...(mitCf ? [p.cloudflare ? h("td", { class: p.cloudflare.kollegen && p.cloudflare.entwickler !== false ? "" : "warn",
				text: !p.cloudflare.kollegen ? "fehlt in Kollegen" : p.cloudflare.entwickler === false ? "fehlt in Entwickler" : "✓" }) : h("td", {})] : []))));
	};
	for (const x of [suche, status, rolle]) x.addEventListener("input", fuellen);
	fuellen();
	c.append(h("h2", { text: `Personen (${d.personen.filter((p) => p.status !== "archiviert").length})` }), cloudflareBox(cf),
		d.mail ? null : h("p", { class: "leise", text: "E-Mail-Versand nicht eingerichtet (SMTP_* in der .env) – Einladungen dann selbst verschicken." }),
		h("div", { class: "filter" }, h("label", {}, "Suche", suche), h("label", {}, "Status", status), h("label", {}, "Rolle", rolle)),
		h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
			h("thead", {}, h("tr", {}, ...["Person", "E-Mail", "Rollen", "Status", "Zuletzt aktiv", ...(mitCf ? ["Cloudflare"] : [])].map((t) => h("th", { text: t })))), tbody)),
		h("p", {}, h("a", { href: "#protokoll", text: "Prüfprotokoll aller Änderungen →" })));
	const liste = await api("GET", "/anmeldungen");
	c.append(h("h2", { text: "Letzte Anmeldungen" }),
		h("p", { class: "leise", text: "Je Cloudflare-Sitzung und Gerät. Unbekanntes Gerät? „Trennen“ meldet es bei der nächsten Anfrage ab (neuer E-Mail-Code nötig)." }),
		liste.length ? anmeldeTabelle(liste, true, async (a) => {
			if (!confirm(`Anmeldung von ${a.player} („${a.geraet}“) beenden? Das Gerät wird beim nächsten Klick abgemeldet.`)) return;
			await api("POST", "/anmeldungen/trennen", { player: a.player, sitzung: a.sitzung }); meldung(`${a.player}: ${a.geraet} getrennt.`); zeigen();
		}) : h("p", { class: "leise", text: "Noch keine Anmeldungen aufgezeichnet." }));
}

async function personSeite(c, name) {
	const p = await api("GET", "/personen/" + encodeURIComponent(name));
	const pfad = "/personen/" + encodeURIComponent(name);
	const neu = () => zeigen();
	const tun = (fn, text) => sicher(async () => { const r = await fn(); if (text) meldung(text); await neu(); return r; });
	c.append(h("p", {}, h("a", { href: "#personen", text: "← alle Personen" })),
		h("h2", {}, p.name, " ", h("span", { class: "status " + STATUS_KLASSE[p.status], text: STATUS_TEXTE[p.status] }),
			p.notfallAdmin ? h("span", { class: "leise", text: " · Notfall-Admin (ADMINS)" }) : null),
		p.status === "gesperrt" ? h("p", { class: "hinweis-box", text: `Gesperrt: ${p.sperrgrund || "–"}${p.gesperrt_bis ? " · bis " + datumZeit(p.gesperrt_bis) : " · unbefristet"}. Aus Cloudflare entfernt das erst „python3 scripts/cloudflare.py abgleichen --entfernen“ am Mac – hinein kommt die Person aber schon jetzt nicht mehr.` }) : null);

	// Stammdaten
	const f = {};
	for (const k of ["anzeigename", "vorname", "nachname"]) f[k] = h("input", { value: p[k] || "", maxlength: k === "anzeigename" ? "40" : "60" });
	f.geburtstag = h("input", { type: "date", value: p.geburtstag || "" });
	c.append(h("h3", { text: "Stammdaten" }), h("form", { class: "karte", onsubmit: (e) => { e.preventDefault();
		tun(() => api("PATCH", pfad, { anzeigename: f.anzeigename.value, vorname: f.vorname.value, nachname: f.nachname.value, geburtstag: f.geburtstag.value || null }), "Gespeichert."); } },
		h("div", { class: "zeile" }, h("label", {}, "Anzeigename ", f.anzeigename), h("label", {}, "Vorname ", f.vorname), h("label", {}, "Nachname ", f.nachname), h("label", {}, "Geburtstag ", f.geburtstag)),
		h("p", { class: "leise", text: `Angelegt ${datumZeit(p.angelegt)}${p.eingeladen_von ? " von " + p.eingeladen_von : ""} · erste Anmeldung ${datumZeit(p.erste_anmeldung)} · Datenschutzhinweis ${p.datenschutz_bestaetigt ? "bestätigt " + datumZeit(p.datenschutz_bestaetigt) : "noch nicht bestätigt"} · 2FA: kommt in einer späteren Version` }),
		h("div", {}, h("button", { type: "submit", class: "knopf klein", text: "Speichern" }))));

	// E-Mails
	const neueMail = h("input", { type: "email", placeholder: "weitere Login-E-Mail" });
	c.append(h("h3", { text: "Login-E-Mails" }), h("div", { class: "karte" },
		h("ul", {}, p.emails.map((m) => h("li", {}, m, " ", p.emails.length > 1 ? knopf("Entfernen", async () => {
			if (!confirm(`${m} entfernen? Mit dieser Adresse kommt ${p.name} dann nicht mehr hinein.`)) return;
			await api("DELETE", `${pfad}/emails/${encodeURIComponent(m)}`); meldung("E-Mail entfernt."); neu();
		}, "gefahr") : null))),
		p.status !== "archiviert" ? h("div", { class: "zeile" }, neueMail, knopf("Hinzufügen", async () => {
			await api("POST", pfad + "/emails", { email: neueMail.value }); meldung("E-Mail hinzugefügt – danach Cloudflare-Abgleich am Mac."); neu();
		})) : null));

	// Rollen
	if (p.status !== "archiviert") {
		const wahl = rollenWahl(p.rollen, p.notfallAdmin ? ["admin"] : []);
		c.append(h("h3", { text: "Rollen" }), h("div", { class: "karte" }, wahl.el,
			h("p", { class: "leise", text: "Entwickler bekommt ein Upload-Konto (Passwort wird einmal angezeigt), ohne Entwickler wird es entfernt – die Spiele bleiben. Tester: für Testkonten." }),
			h("div", { class: "zeile" }, knopf("Rollen speichern", async () => {
				const r = await api("PUT", pfad + "/rollen", { rollen: wahl.werte() });
				await neu();
				meldung(r.dazu.length || r.weg.length ? `Rollen geändert: ${[...r.dazu.map((x) => "+" + ROLLEN_TEXT[x]), ...r.weg.map((x) => "−" + ROLLEN_TEXT[x])].join(", ")}.` + (r.hinweis ? " " + r.hinweis : "") : "Keine Änderung.");
				if (r.passwort) $("inhalt").prepend(passwortKarte(p.name, r.passwort));
			}, ""),
			p.uploadKonto ? knopf("Neues Upload-Passwort", async () => {
				if (!confirm(`Neues Upload-Passwort für ${p.name}? Das alte gilt sofort nicht mehr.`)) return;
				const r = await api("POST", `/entwickler/${encodeURIComponent(p.name)}/passwort`); $("inhalt").prepend(passwortKarte(p.name, r.passwort)); scrollTo(0, 0);
			}) : null)));
	}

	// Status: einladen, verwarnen, sperren, archivieren
	const grund = h("input", { placeholder: "Grund (sieht die Person)", maxlength: "500", size: "40" });
	const bis = h("input", { type: "datetime-local", title: "leer = unbefristet" });
	const aktionen = [];
	if (p.status === "eingeladen" || (p.status !== "gesperrt" && p.status !== "archiviert" && !p.erste_anmeldung)) {
		const senden = async (ohnePruefung) => {
			await api("POST", pfad + "/einladung", { ohnePruefung }); meldung(`Einladung an ${p.emails[0]} verschickt.`); neu();
		};
		aktionen.push(knopf(p.einladung_gesendet ? "Einladung erneut senden" : "Einladung senden", async () => {
			try { await senden(false); } catch (e) {
				if (e.status === 409 && e.message.includes("trotzdem senden") && confirm(e.message + "\n\nSteht die E-Mail sicher in Cloudflare? Dann trotzdem senden.")) return senden(true);
				throw e;
			}
		}, ""));
	}
	if (["aktiv", "eingeladen", "verwarnt"].includes(p.status)) aktionen.push(knopf("Verwarnen", async () => {
		if (!grund.value.trim()) return meldung("Erst einen Grund eintragen.", true);
		await api("POST", pfad + "/verwarnen", { grund: grund.value }); meldung(`${p.name} verwarnt – die Meldung steht in der Glocke.`); neu();
	}));
	if (p.status === "verwarnt") aktionen.push(knopf("Verwarnung aufheben", async () => { await api("POST", pfad + "/verwarnung-aufheben"); meldung("Verwarnung aufgehoben."); neu(); }));
	if (!p.notfallAdmin && p.status !== "archiviert" && p.status !== "gesperrt") aktionen.push(knopf("Sperren", async () => {
		if (!grund.value.trim()) return meldung("Erst einen Grund eintragen.", true);
		if (!confirm(`${p.name} sperren? Gilt sofort für Bibliothek und Upload.`)) return;
		await api("POST", pfad + "/sperren", { grund: grund.value, bis: bis.value ? new Date(bis.value).toISOString() : null }); meldung(`${p.name} gesperrt.`); neu();
	}, "gefahr"));
	if (p.status === "gesperrt") aktionen.push(knopf("Entsperren", async () => { await api("POST", pfad + "/entsperren"); meldung("Entsperrt."); neu(); }));
	if (!p.notfallAdmin && p.status !== "archiviert") aktionen.push(knopf("Archivieren (anonymisieren) …", async () => {
		const b = prompt(`${p.name} archivieren? Kein Zugang mehr, Name, Geburtstag, E-Mails, Notizen und Rollen werden gelöscht – nur der Benutzername bleibt (an Spielständen und Spielen). Nicht rückgängig zu machen.\n\nZur Bestätigung den Benutzernamen eingeben:`);
		if (b === null) return;
		await api("POST", pfad + "/archivieren", { bestaetigung: b }); meldung(`${p.name} archiviert.`); neu();
	}, "gefahr"));
	aktionen.push(knopf("Auskunft (Export)", async () => {
		const daten = await api("GET", pfad + "/export");
		const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(daten, null, 2)], { type: "application/json" })), download: `auskunft-${p.name}.json` });
		document.body.append(a); a.click(); a.remove();
	}));
	c.append(h("h3", { text: "Status und Maßnahmen" }), h("div", { class: "karte" },
		h("div", { class: "zeile" }, h("label", {}, "Grund ", grund), h("label", { title: "nur fürs Sperren, leer = unbefristet" }, "gesperrt bis ", bis)),
		h("div", { class: "zeile" }, ...aktionen)));

	// Notizen (nur Admin)
	const notiz = h("textarea", { rows: "2", maxlength: "4000", placeholder: "Interne Notiz – sieht nur der Admin" });
	c.append(h("h3", { text: "Notizen (nur für Admins)" }), h("div", { class: "karte" },
		h("div", { class: "zeile" }, notiz, knopf("Notiz speichern", async () => { await api("POST", pfad + "/notizen", { text: notiz.value }); meldung("Notiz gespeichert."); neu(); })),
		p.notizen.length ? h("ul", {}, p.notizen.map((n) => h("li", {}, h("span", { class: "leise", text: `${datumZeit(n.zeit)} · ${n.von}: ` }), h("span", { class: "antrag-text", text: n.text }))))
			: h("p", { class: "leise", text: "Noch keine Notizen." })));

	// Zeitleiste, Anmeldungen, Protokoll
	c.append(h("h3", { text: "Zeitleiste" }), p.zeitleiste.length ? tabelle(["Zeit", "Was", ""], p.zeitleiste.map((z) => h("tr", {},
		h("td", { text: datumZeit(z.zeit) }), h("td", { text: z.art }), h("td", { text: z.text + (z.von ? ` (${z.von})` : "") })))) : h("p", { class: "leise", text: "Noch nichts." }));
	c.append(h("h3", { text: "Anmeldungen" }), p.anmeldungen.length ? anmeldeTabelle(p.anmeldungen, false, async (a) => {
		if (!confirm(`Anmeldung „${a.geraet}“ beenden?`)) return;
		await api("POST", "/anmeldungen/trennen", { player: p.name, sitzung: a.sitzung }); meldung("Getrennt."); neu();
	}) : h("p", { class: "leise", text: "Keine." }));
	c.append(h("details", {}, h("summary", { text: `Prüfprotokoll zu ${p.name} (${p.protokoll.length})` }), protokollTabelle(p.protokoll)));
}

function protokollTabelle(liste) {
	const kurz = (x) => x === null || x === undefined ? "" : String(x).length > 120 ? String(x).slice(0, 120) + " …" : String(x);
	return tabelle(["Zeit", "Wer", "Aktion", "Person", "Vorher", "Nachher"], liste.map((z) => h("tr", {},
		h("td", { text: datumZeit(z.zeit) }), h("td", { text: z.von }), h("td", { text: z.aktion }), h("td", {}, z.ziel ? h("a", { href: "#person/" + z.ziel, text: z.ziel }) : ""),
		h("td", { class: "leise", text: kurz(z.vorher) }), h("td", { text: kurz(z.nachher) }))));
}
async function protokollSeite(c) {
	c.append(h("p", {}, h("a", { href: "#personen", text: "← Personen" })), h("h2", { text: "Prüfprotokoll" }),
		h("p", { class: "leise", text: "Jede Änderung an Personen – wer, was, wann, vorher und nachher. Wird nie gelöscht." }),
		protokollTabelle(await api("GET", "/protokoll")));
}

// Cloudflare-Abgleich (1.3.0): nur anzeigen – geschrieben wird am Mac mit scripts/cloudflare.py (Schreib-Schlüssel nie auf der NAS)
function cloudflareBox(cf) {
	if (!cf.eingerichtet) return h("p", { class: "leise", text: "Cloudflare-Abgleich nicht eingerichtet (docs/cloudflare-abgleich.md) – ob die E-Mails in den Cloudflare-Richtlinien stehen, wird nicht geprüft." });
	if (cf.fehler) return h("div", { class: "hinweis-box", text: "Cloudflare-Abgleich: " + cf.fehler });
	const zeilen = [];
	for (const r of cf.richtlinien) {
		for (const x of r.bedenken) zeilen.push(`${r.name}: ${x}`);
		for (const m of r.fehlt) zeilen.push(`${r.name}: fehlt ${m} – bekommt keinen Code`);
		for (const m of r.zuviel) zeilen.push(`${r.name}: ${m} steht nur in Cloudflare, nicht in der Bibliothek`);
	}
	if (!zeilen.length) return h("p", { class: "leise", text: "✓ Cloudflare-Richtlinien passen zur Benutzerliste." });
	return h("div", { class: "hinweis-box" }, h("strong", { text: "Cloudflare passt nicht zur Benutzerliste:" }),
		h("ul", {}, ...zeilen.map((z) => h("li", { text: z }))),
		h("span", { class: "leise", text: "Beheben am Mac: python3 scripts/cloudflare.py abgleichen (Entfernen nur mit --entfernen). Stand: alle 5 Minuten neu gelesen." }));
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
	const alle = await api("GET", "/antraege");
	// 1.3.0: Hier nur, was der Admin erledigt (Bibliothek). Anträge zu Spielen bearbeitet deren Entwickler – nur zur Info, ohne Zahl.
	const liste = alle.filter((a) => a.zustaendig === "admin"), spielAntraege = alle.filter((a) => a.zustaendig !== "admin");
	c.append(h("h2", { text: "Anträge an die Bibliothek" }));
	if (!liste.length) c.append(h("p", { class: "leise", text: "Keine Anträge." }));
	c.append(...liste.map((a) => {
		const antwort = h("textarea", { rows: "2", maxlength: "4000", placeholder: "Antwort an " + a.player });
		antwort.value = a.antwort || "";
		const setzen = (status) => sicher(async () => { await api("PATCH", "/antraege/" + a.id, { status, antwort: antwort.value || null }); meldung(`Antrag ${a.id}: ${status}.`); zeigen(); });
		return h("div", { class: "karte" },
			h("div", {}, h("span", { class: "status " + a.status, text: a.status }), " ", h("strong", { text: a.artText }),
				h("span", { class: "leise", text: ` · von ${a.player}` + (a.spiel ? ` · ${a.title || a.spiel}` : "") + ` · ${datumZeit(a.erstellt)}` }),
				" · ", h("a", { href: "/#/antrag/" + a.id, text: a.bilder ? `Öffnen (${a.bilder} ${a.bilder === 1 ? "Bild" : "Bilder"})` : "Öffnen" })),
			h("div", { text: a.text }),
			antwort,
			h("div", { class: "zeile" }, knopf("Erledigt", () => setzen("erledigt"), ""), knopf("Ablehnen", () => setzen("abgelehnt"), "gefahr"),
				a.status !== "offen" ? knopf("Wieder öffnen", () => setzen("offen")) : null));
	}));
	if (spielAntraege.length) {
		const offen = spielAntraege.filter((a) => a.status === "offen").length;
		c.append(h("details", { class: "karte" }, h("summary", { text: `Anträge zu Spielen – bearbeitet der jeweilige Entwickler (${offen} offen, ${spielAntraege.length - offen} geschlossen, nur zur Info)` }),
			tabelle(["Spiel", "Entwickler", "Art", "Von", "Status", "Erstellt", "Text"], spielAntraege.map((a) => h("tr", {},
				h("td", { text: a.title || a.spiel }), h("td", { text: a.zustaendig }), h("td", { text: a.artText }), h("td", { text: a.player }),
				h("td", {}, h("span", { class: "status " + a.status, text: a.status })), h("td", { text: datumZeit(a.erstellt) }),
				h("td", {}, h("a", { href: "/#/antrag/" + a.id, text: a.text.length > 120 ? a.text.slice(0, 120) + " …" : a.text }),
					a.bilder ? h("span", { class: "leise", text: ` · ${a.bilder} 🖼` }) : null))))));
	}
}

// ---------- Navigation ----------
// ---------- Aufgaben (1.3.0): Tests per Knopf oder Zeitplan, Live-Deploy nach Freigabe ----------
const STATUS_TEXT = { wartet: "wartet", laeuft: "läuft …", ok: "✓ ok", fehler: "✗ Fehler" };
async function aufgabenSeite(c) {
	const d = await api("GET", "/auftraege");
	const dienst = d.dienst;
	c.append(h("h2", { text: "Auftragsdienst" }),
		h("p", { class: dienst.aktiv ? "leise" : "hinweis-box", text: !dienst.eingerichtet
			? "Noch nicht eingerichtet – Aufträge bleiben liegen. Einmalig am Mac: sh scripts/auftragsdienst-einrichten.sh (Cron-Job auf der NAS, jede Minute)."
			: dienst.aktiv ? `✓ läuft – zuletzt gemeldet ${datumZeit(dienst.zuletzt)} (Live-Stand ${dienst.version})`
				: `✗ meldet sich nicht mehr seit ${datumZeit(dienst.zuletzt)} – Cron-Job auf der NAS prüfen (crontab -l), Log: /tmp/sb-auftragsdienst.log` }),
		h("p", { class: "leise", text: "Der Dienst führt nur fest eingebaute Aufgaben aus. Live-Deploy passiert ausschließlich nach „Für Live freigeben“ in der Probe – nicht von hier." }));

	// Jetzt starten + Zeitplan
	const plan = (art, ziel) => (d.zeitplan.find((z) => z.art === art && z.ziel === ziel) || {}).uhrzeit || "";
	const zeilen = [];
	for (const [art, artText] of Object.entries(d.arten)) for (const [ziel, zielText] of Object.entries(d.ziele)) {
		const uhr = h("input", { type: "time", value: plan(art, ziel) });
		zeilen.push(h("tr", {}, h("td", { text: artText }), h("td", { text: zielText }),
			h("td", {}, knopf("Jetzt starten", () => sicher(async () => { await api("POST", "/auftraege", { art, ziel }); meldung(`${artText} (${zielText}) gestartet – Ergebnis unten.`); zeigen(); }), "")),
			h("td", {}, h("div", { class: "zeile" }, uhr,
				knopf("Täglich", () => sicher(async () => { if (!uhr.value) return meldung("Erst eine Uhrzeit wählen.", true); await api("PUT", "/zeitplan", { art, ziel, uhrzeit: uhr.value }); meldung(`${artText} (${zielText}) läuft täglich um ${uhr.value}.`); zeigen(); })),
				plan(art, ziel) ? knopf("Aus", () => sicher(async () => { await api("PUT", "/zeitplan", { art, ziel, uhrzeit: null }); meldung("Zeitplan entfernt."); zeigen(); }), "gefahr") : null))));
	}
	c.append(h("h2", { text: "Aufgaben" }),
		h("p", { class: "leise", text: "Unit-Tests ca. 4 Minuten, Ende-zu-Ende-Tests ca. 10 Minuten (im Teststand, die echte Bibliothek wird nicht angefasst). „Live-Stand“ = was gerade live läuft, „Probe“ = was in der Probe zum Testen liegt. Bei Fehlern: rote Glocke und Home Assistant." }),
		tabelle(["Aufgabe", "Ziel", "", "Zeitplan (täglich)"], zeilen));

	// Verlauf
	c.append(h("h2", { text: "Letzte Läufe" }));
	if (!d.laeufe.length) return c.append(h("p", { class: "leise", text: "Noch keine." }));
	c.append(tabelle(["Aufgabe", "Ziel", "Auslöser", "Gestartet", "Dauer", "Status", "Ergebnis", ""], d.laeufe.map((l) => {
		const dauer = l.start && l.ende ? Math.max(1, Math.round((new Date(l.ende) - new Date(l.start)) / 1000)) : null;
		const zelle = h("div", {});
		return h("tr", {}, h("td", { text: d.anzeige[l.art] || l.art }), h("td", { text: d.ziele[l.ziel] || l.ziel }),
			h("td", { text: l.quelle === "plan" ? "Zeitplan" : l.quelle === "dienst" ? "Freigabe" : l.von || "Knopf" }),
			h("td", { text: datumZeit(l.start || l.angelegt) }), h("td", { text: dauer ? (dauer >= 60 ? Math.round(dauer / 60) + " min" : dauer + " s") : "" }),
			h("td", { class: l.status === "fehler" ? "warn" : "", text: STATUS_TEXT[l.status] || l.status }), h("td", { text: l.zusammenfassung || "" }),
			h("td", {}, l.ende ? knopf("Log", async () => {
				const voll = await api("GET", "/auftraege/" + l.id);
				zelle.replaceChildren(h("pre", { class: "log", text: voll.log || "(leer)" }));
			}) : null, zelle));
	})));
	if (d.laeufe.some((l) => l.status === "wartet" || l.status === "laeuft")) setTimeout(() => { if (location.hash === "#aufgaben") zeigen(); }, 15000);
}

const SEITEN = { uebersicht, spiele: spieleSeite, personen: personenSeite, protokoll: protokollSeite, spielstaende: spielstaendeSeite, antraege: antraegeSeite, aufgaben: aufgabenSeite };

async function zeigen() {
	if (location.hash === "#benutzer") return location.replace("#personen");   // alte Adresse (vor 1.4.0)
	const person = location.hash.match(/^#person\/([a-z0-9][a-z0-9_-]{0,31})$/);
	const name = person ? "personen" : SEITEN[location.hash.slice(1)] ? location.hash.slice(1) : "uebersicht";
	const reiter = name === "protokoll" ? "personen" : name;
	for (const a of $("reiter").querySelectorAll("a")) a.classList.toggle("aktiv", a.getAttribute("href") === "#" + reiter);
	const c = $("inhalt");
	c.replaceChildren();
	await sicher(() => person ? personSeite(c, person[1]) : SEITEN[name](c));
	// Rückkehr aus „Ansicht als …“: an die alte Scrollposition (1.3.0)
	try {
		const y = sessionStorage.getItem("admin-scroll");
		if (y !== null) { sessionStorage.removeItem("admin-scroll"); requestAnimationFrame(() => scrollTo(0, Number(y) || 0)); }
	} catch { /* egal */ }
	sicher(async () => {
		const offen = (await api("GET", "/antraege")).filter((a) => a.status === "offen" && a.zustaendig === "admin").length;
		$("offen-zahl").textContent = String(offen); $("offen-zahl").hidden = !offen;
		// Aufgaben: Zahl = wie viele Aufgaben zuletzt fehlgeschlagen sind (je Aufgabe und Ziel der neueste Lauf)
		const auf = await api("GET", "/auftraege");
		const neueste = new Map();
		for (const l of auf.laeufe) if (!neueste.has(l.art + l.ziel)) neueste.set(l.art + l.ziel, l);
		const rot = [...neueste.values()].filter((l) => l.status === "fehler").length + (auf.dienst.eingerichtet && !auf.dienst.aktiv ? 1 : 0);
		$("aufgaben-zahl").textContent = String(rot); $("aufgaben-zahl").hidden = !rot;
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
