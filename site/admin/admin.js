// Admin-Panel (Phase 10). Ob jemand Admin ist, entscheidet allein der Server (ADMINS im Speicher-Dienst).
// Nutzt h(), datumZeit(), groesse() aus konto.js und Bridge.json() aus bridge.js.
"use strict";

const $ = (id) => document.getElementById(id);
const api = (methode, pfad, body) => Bridge.json(methode, "/api/admin" + pfad, body);
const idPfad = (id) => id.split("/").map(encodeURIComponent).join("/");
let spieleCache = [];
const titel = (id) => (spieleCache.find((s) => s.id === id) || {}).title || id;

// Die Meldung klebt oben im Fenster (1.4.0, Nachtest 08.11.): Knöpfe wie „Einladung senden“ stehen weit unten – vorher kam die Antwort
// oben außer Sicht an und es sah aus, als wäre nichts passiert. Erfolge verschwinden nach 8 s, Fehler bleiben bis zum Klick.
let meldungWeg;
function meldung(text, fehler) {
	const m = $("meldung");
	clearTimeout(meldungWeg);
	m.textContent = text || "";
	m.hidden = !text;
	m.classList.toggle("fehler", !!fehler);
	m.title = text ? "Klicken zum Schließen" : "";
	if (text && !fehler) meldungWeg = setTimeout(() => { m.hidden = true; }, 8000);
}
document.addEventListener("click", (e) => { if (e.target.id === "meldung") e.target.hidden = true; });
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
	notausZeigen(c);
	await zentraleFehlerZeigen(c);
	c.append(h("div", { class: "kacheln-klein" },
		kz(d.spieler, "Personen mit Zugang"),
		kz(d.spiele, "Spiele" + (d.testspiele ? ` (+${d.testspiele} Testspiele)` : "") + (d.offline ? ` · ${d.offline} offline` : "")),
		kz(d.zaehler.saves, "Spielstände"),
		kz(d.zaehler.scores, "Bestenlisten-Einträge"), kz(d.offeneAntraege, "offene Anfragen"),
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
		h("p", { class: "leise", text: w.homeAssistant ? "Home Assistant bekommt Lebenszeichen, Probleme und neue Anfragen (HA_WEBHOOK_URL gesetzt)."
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
		h("p", { class: "leise", text: "Zeigt die Bibliothek in diesem Tab so, wie Kollegen mit dieser Rolle sie sehen – mit einem eigenen Konto, das bei jedem Start geleert wird. Bestenliste und Anfragen sind dabei gesperrt. Beenden über das lila Band oben in der Bibliothek." }),
		h("div", { class: "zeile" }, knopf("Ansicht als Spieler", () => ansichtStarten("spieler")), knopf("Ansicht als Entwickler", () => ansichtStarten("entwickler"))));
	c.append(h("h2", { text: "Letzte Aktivität" }), tabelle(["Spieler", "Spiel", "Zeit"],
		d.aktivitaet.map((a) => h("tr", {}, h("td", { text: a.player }), h("td", { text: a.title }), h("td", { text: datumZeit(a.zeit) })))));
	c.append(h("h2", { text: "Letzte Uploads und Konto-Änderungen" }), tabelle(["Zeit", "Wer", "Was", "Ordner"],
		d.uploads.map((u) => u.fehler ? h("tr", {}, h("td", { colspan: "4", text: u.fehler }))
			: h("tr", {}, h("td", { text: datumZeit(u.zeit) }), h("td", { text: u.player }), h("td", { text: u.aktion + (u.dateien ? ` (${u.dateien} Dateien)` : "") }), h("td", { text: u.ordner || "" })))));
	c.append(h("h2", { text: "Speicher je Entwickler" }), tabelle(["Entwickler", "Live-Spiele", "Kontingent (inkl. Entwürfe und Versionen)"],
		Object.entries(d.speicher).map(([n, b]) => h("tr", {}, h("td", { text: n }), h("td", { text: groesse(b) }), h("td", { text: groesse(d.kontingent) })))));
}

// Not-Aus (Zentrale 1.4.0, E72): trennt die Bibliothek vom Internet. Aufheben geht nur am Mac (scripts/deploy.sh --notaus-aus).
function notausZeigen(c) {
	const ausloesen = async () => {
		const grund = prompt("NOT-AUS: Die Bibliothek wird sofort gesperrt (keine Daten mehr), der Tunnel geht innerhalb einer Minute aus.\n" +
			"Wieder einschalten geht NUR am Mac mit scripts/deploy.sh --notaus-aus.\n\nGrund (optional, steht im Sicherheitsprotokoll):", "");
		if (grund === null) return;
		const best = prompt("Zur Bestätigung NOT-AUS eintippen:");
		if (best !== "NOT-AUS") return meldung("Nicht ausgelöst.");
		const d = await api("POST", "/notaus", { bestaetigung: "NOT-AUS", grund });
		c.replaceChildren(h("div", { class: "notaus-an" },
			h("strong", { text: "Not-Aus ist AN" }), h("p", { text: d.hinweis }),
			h("p", { class: "leise", text: `Ausgelöst ${datumZeit(d.zeit)} von ${d.von}${d.grund ? " – " + d.grund : ""}. Diese Seite funktioniert jetzt nicht mehr.` })));
		meldung("");
	};
	const box = h("details", { class: "notaus" },
		h("summary", { text: "Not-Aus" }),
		h("p", { class: "leise", text: "Bei Verdacht auf ein Datenleck oder einen Angriff: sperrt sofort alle Daten (Bibliothek und Upload) und trennt die Webseite innerhalb einer Minute vom Internet. Andere Dienste auf der NAS laufen weiter. Wieder einschalten nur am Mac: scripts/deploy.sh --notaus-aus." }),
		h("div", { class: "zeile" }, knopf("Not-Aus auslösen …", ausloesen, "gefahr"), knopf("Sicherheitsprotokoll", async () => {
			const liste = await api("GET", "/sicherheit");
			box.append(liste.length ? tabelle(["Zeit", "Ereignis", "Wer", "Text"], liste.map((x) => h("tr", {},
				h("td", { text: datumZeit(x.zeit) }), h("td", { text: x.art }), h("td", { text: x.wer || "" }), h("td", { text: x.text || "" }))))
				: h("p", { class: "leise", text: "Noch keine Einträge (aufbewahrt wird ein Jahr)." }));
		})));
	c.append(box);
}

// Fehler der Bibliothek selbst (Zentrale 1.4.0). Seit 1.5.0 (Seb, 10.11.2026) nur noch eine rote Zeile in der Übersicht,
// die Liste mit Fundort und Stacktrace öffnet sich in einem eigenen Fenster. Leer: nur eine grüne Zeile.
async function zentraleFehlerZeigen(c) {
	let liste = [];
	try { liste = (await Bridge.json("GET", "/api/entwickler/fehler?alle=true")).filter((f) => f.zentrale); } catch { return; }
	if (!liste.length) return c.append(h("p", { class: "leise", text: "✓ Keine Fehler in der Bibliothek selbst gemeldet." }));
	const zuletzt = liste.map((f) => f.letztes).sort().pop();
	const fenster = h("dialog", { class: "fenster breit-fenster", "aria-label": "Fehler in der Bibliothek" });
	const fuellen = (l) => fenster.replaceChildren(
		h("div", { class: "fenster-kopf" }, h("h2", { text: `⚠ Fehler in der Bibliothek (${l.length})` }),
			h("button", { type: "button", class: "knopf leise klein", text: "Schließen", onclick: () => fenster.close() })),
		h("p", { class: "leise", text: "Abstürze der Bibliotheksseite bei Spielern – der Spieler sah dazu „Fehler-Nr. …“. Gleiche Fehler sind zusammengefasst. „Erledigt“ entfernt den Eintrag, tritt er wieder auf, erscheint er neu." }),
		l.length ? tabelle(["Nr.", "Fehler", "Fundort", "Anzahl", "Zuletzt", "Browser", ""], l.map((f) => h("tr", {},
			h("td", { text: String(f.id) }),
			h("td", {}, h("code", { text: f.meldung }), f.stack ? h("details", {}, h("summary", { text: "Seite, Version, Stacktrace" }), h("pre", { class: "changelog", text: f.stack })) : null),
			h("td", {}, h("code", { text: (f.quelle || "inline") + (f.zeile ? `:${f.zeile}` + (f.spalte ? `:${f.spalte}` : "") : "") })),
			h("td", { text: String(f.anzahl) }), h("td", { text: datumZeit(f.letztes) }), h("td", { text: f.browser || "" }),
			h("td", {}, knopf("Erledigt", async () => {
				await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id);
				liste = liste.filter((x) => x.id !== f.id);
				fuellen(liste);
			})))))
			: h("p", { text: "✓ Alle erledigt." }));
	fuellen(liste);
	fenster.addEventListener("close", () => zeigen());     // Übersicht danach mit dem neuen Stand
	c.append(fenster, h("button", { type: "button", class: "fehler-zeile", onclick: () => fenster.showModal() },
		h("strong", { text: `⚠ ${liste.length === 1 ? "1 Fehler" : liste.length + " Fehler"} in der Bibliothek` }),
		h("span", { class: "leise", text: ` · zuletzt ${datumZeit(zuletzt)} · ${liste.reduce((n, f) => n + (f.anzahl || 1), 0)}× aufgetreten` }),
		h("span", { class: "fehler-zeile-los", text: "Ansehen →" })));
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
const PROBE_URL = "https://test.cuby0401.uk";   // seit 1.4.0 zugleich der Testserver für die Tester (E76)
async function probeZeigen(c) {
	const p = await api("GET", "/probe").catch(() => null);
	if (!p) return;
	c.append(h("h2", { text: p.probe ? "🧪 Diese Seite ist die Probe-Zentrale" : "Probe-Zentrale" }));
	if (!p.probe) {
		return c.append(h("p", {}, "Neue Versionen der Zentrale laufen zuerst in der Probe – einer Kopie mit den echten Spielen und Daten. Sie ist zugleich der Testserver für die Tester (Anmeldung über die Access-Anwendung „Spielebibliothek Test“): ",
			h("a", { href: PROBE_URL, target: "_blank", rel: "noopener", text: PROBE_URL.replace("https://", "") }),
			" · ", h("a", { href: PROBE_URL + "/tester/", target: "_blank", rel: "noopener", text: "Tester-Panel" }),
			". Aufsetzen: scripts/deploy.sh --probe. Live geht eine Version erst, wenn du sie dort freigegeben hast."));
	}
	const f = p.freigabe;
	// Tester-Ergebnisse (1.4.0, E76) – stehen direkt bei der Freigabe
	const tp = await Bridge.json("GET", "/api/tester/plan").catch(() => null);
	const z = tp && tp.zusammenfassung;
	const fehlschlaege = tp ? tp.ergebnisse.filter((x) => !x.ok) : [];
	const testBox = !tp ? h("p", { class: "leise", text: "Für diese Version gibt es keinen Testplan (tests/manuell/<Version>.json im Repo)." })
		: h("div", { class: z.fehlgeschlagen ? "hinweis-box" : "karte" },
			h("strong", { text: `Tests der Tester: ${z.bestanden} von ${z.gesamt} bestanden` + (z.fehlgeschlagen ? `, ${z.fehlgeschlagen} fehlgeschlagen` : "") + (z.offen ? `, ${z.offen} offen` : "") }),
			fehlschlaege.length ? h("ul", {}, fehlschlaege.map((x) => h("li", {},
				h("a", { href: "/tester/#test-" + x.test, text: (tp.tests.find((t) => t.id === x.test) || {}).titel || x.test }),
				` – ${x.player}, ${datumZeit(x.zeit)}: ${x.text}`))) : null,
			h("a", { href: "/tester/", text: "Zum Tester-Panel →" }));
	c.append(h("p", {}, `Version ${p.version || "?"} · Commit ${p.commit || "?"}` + (p.kopieVon ? ` · Daten kopiert ${datumZeit(p.kopieVon)}` : "")), testBox,
		h("p", { class: f && f.commit === p.commit ? "hinweis-box" : "leise" },
			f && f.commit === p.commit ? `✓ Freigegeben am ${datumZeit(f.zeit)}${f.notiz ? " – " + f.notiz : ""}.` : "Noch nicht freigegeben."),
		// Live-Deploy nach der Freigabe (1.3.0): meldet der Auftragsdienst
		f && f.commit === p.commit ? liveStatus(p) : null,
		h("div", { class: "zeile" },
			f && f.commit === p.commit
				? knopf("Freigabe zurücknehmen", async () => { await api("DELETE", "/probe/freigeben"); meldung("Freigabe zurückgenommen."); zeigen(); }, "gefahr")
				: knopf("Getestet – für Live freigeben", async () => {
					// Fehlgeschlagene oder offene Tests: nur deutlich warnen, nicht sperren (manchmal ist ein Fehler bekannt und unwichtig)
					if (z && (z.fehlgeschlagen || z.offen) && !confirm(`Achtung: ${z.fehlgeschlagen} Test(s) fehlgeschlagen, ${z.offen} noch offen.\nTrotzdem für Live freigeben?`)) return;
					const notiz = prompt("Für Live freigeben? Was hast du getestet? (optional, steht in der Freigabe)", z ? `Tester: ${z.bestanden}/${z.gesamt} bestanden` : "");
					if (notiz === null) return;
					await api("POST", "/probe/freigeben", { notiz });
					meldung("Freigegeben – der Auftragsdienst spielt diese Version innerhalb einer Minute live ein.");
					zeigen();
				}, "")));
}

function liveStatus(p) {
	const l = p.live && p.live.commit === p.commit ? p.live : null;
	if (!l) {
		stillNeuLaden(["", "#uebersicht"], 10000);
		return h("p", { class: "leise", text: "Wartet auf den Auftragsdienst (spätestens nach einer Minute) … Ohne eingerichteten Auftragsdienst: auf dem Mac scripts/deploy.sh" });
	}
	if (l.status === "laeuft") stillNeuLaden(["", "#uebersicht"], 10000);
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
const STATUS_TEXTE = { eingeladen: "eingeladen", aktiv: "aktiv", verwarnt: "verwarnt", gesperrt: "gesperrt", archiviert: "archiviert", geloescht: "gelöscht" };
const STATUS_KLASSE = { eingeladen: "offen", aktiv: "erledigt", verwarnt: "offen", gesperrt: "abgelehnt", archiviert: "", geloescht: "" };
// Archiviert (zurückholbar) und gelöscht (anonymisiert) stehen nicht in der normalen Liste und lassen sich nicht bearbeiten
const RAUS = (status) => status === "archiviert" || status === "geloescht";
const ROLLEN_TEXT = { spieler: "Spieler", entwickler: "Entwickler", admin: "Admin", tester: "Tester" };
const anzeigePerson = (p) => p.anzeigename || [p.vorname, p.nachname].filter(Boolean).join(" ") || "";
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

// ---------- CRM (Zentrale 1.5.0, Klick-Muster vom 09.11.2026) ----------
// Nummer, Name, @handle oder E-Mail eingeben → alles zu einer Person auf einen Blick, alles verlinkt. Leere Blöcke fehlen
// ganz (Seb, 07.11.). Personen werden mit ihrem Handle angesprochen (#person/<handle>), gelöschte über die Nummer (P-0007).
const pnr = (nr) => nr ? "P-" + String(nr).padStart(4, "0") : "";
const personLink = (p) => "#person/" + (p.status === "geloescht" || !p.handle ? pnr(p.nr) : p.handle);
const tageHer = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : Infinity;
function initialen(ziel, text, schluessel) {
	const teile = String(text || "?").trim().split(/[\s._-]+/).filter(Boolean);
	ziel.textContent = ((teile[0] || "?")[0] + (teile.length > 1 ? teile[1][0] : (teile[0] || "")[1] || "")).toUpperCase();
	let n = 0;
	for (const z of String(schluessel || text)) n = (n * 31 + z.charCodeAt(0)) >>> 0;
	ziel.style.setProperty("--avatar-farbe", `hsl(${n % 360} 55% 42%)`);
	return ziel;
}
const crmFilter = { q: "", rolle: "", status: "", inaktiv: false, aktiv: false };   // bleibt beim Hin und Her zur Personenkarte erhalten

async function personenSeite(c) {
	const [d, cf] = await Promise.all([api("GET", "/personen"), api("GET", "/cloudflare").catch(() => ({ eingerichtet: false }))]);
	// Einladen
	const mail = h("input", { type: "email", required: true, placeholder: "name@beispiel.de" });
	const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]{2,19}", placeholder: "z. B. paul" });
	const vorname = h("input", { placeholder: "optional" });
	const wahl = rollenWahl(["spieler"]);
	const einladen = h("details", { class: "karte" }, h("summary", { text: "➕ Person einladen" }),
		h("form", { onsubmit: (e) => { e.preventDefault(); sicher(async () => {
			const r = await api("POST", "/personen", { email: mail.value, name: name.value, vorname: vorname.value || null, rollen: wahl.werte() });
			location.hash = "#person/" + r.person.handle;
			meldung(`${r.person.handle} eingeladen. Nächster Schritt: am Mac „python3 scripts/cloudflare.py abgleichen“, dann hier „Einladung senden“.`);
			if (r.passwort) setTimeout(() => $("inhalt").prepend(passwortKarte(r.person.handle, r.passwort)), 300);
		}); } },
			h("div", { class: "zeile" }, h("label", {}, "E-Mail (Cloudflare-Login) ", mail), h("label", {}, "Handle ", name), h("label", {}, "Vorname ", vorname)),
			h("p", {}, "Rollen: ", wahl.el),
			h("p", { class: "leise", text: "Das Handle (3–20 Zeichen) kann die Person später alle 30 Tage selbst ändern; ihr Spieleordner behält diesen ersten Namen. Eingeladene kommen erst rein, wenn ihre E-Mail in Cloudflare steht (scripts/cloudflare.py abgleichen am Mac)." }),
			h("div", {}, h("button", { type: "submit", class: "knopf", text: "Einladen" }))));

	const sichtbar = d.personen.filter((p) => !RAUS(p.status));
	const inaktiv = (p) => p.status !== "eingeladen" && !p.nieAngemeldet && tageHer(p.zuletzt) > 30;
	// Kachel „aktiv in 30 Tagen“ filtert seit 1.5.0 wirklich (vorher zeigte sie alle, Seb 10.11.)
	const aktiv = (p) => !p.nieAngemeldet && !!p.zuletzt && tageHer(p.zuletzt) <= 30;
	// Klein oben rechts, ohne Autofokus (Seb, 10.11.): sonst sprang der Cursor hinein und Safari bot sofort E-Mail-Adressen an
	const suche = h("input", { type: "search", class: "crm-suche", placeholder: "Suchen: Nr., Name, @handle …", value: crmFilter.q, "aria-label": "Person suchen",
		title: "Nummer (P-0003), Name, @handle (auch frühere) oder Login-Adresse – Enter öffnet die Karte, wenn es genau einen Treffer gibt", autocomplete: "off", name: "crm-suche", spellcheck: "false" });
	const treffer = () => {
		const q = crmFilter.q.trim().toLowerCase().replace(/^@/, "");
		const nur = crmFilter.status === "auffaellig" ? null : crmFilter.status;
		return d.personen.filter((p) => (nur ? p.status === nur : crmFilter.status === "auffaellig" ? ["verwarnt", "gesperrt"].includes(p.status) : !RAUS(p.status))
			&& (!crmFilter.rolle || p.rollen.includes(crmFilter.rolle))
			&& (!crmFilter.inaktiv || inaktiv(p))
			&& (!crmFilter.aktiv || aktiv(p))
			&& (!q || [pnr(p.nr), String(p.nr || ""), p.handle, ...(p.alteHandles || []), p.anzeigename, p.vorname, p.nachname, ...p.emails]
				.filter(Boolean).some((x) => String(x).toLowerCase().includes(q))));
	};
	const tbody = h("tbody", {});
	const mitCf = d.cloudflare.geprueft;
	const fuellen = () => tbody.replaceChildren(...treffer().map((p) => h("tr", { class: "klickbar", "data-handle": p.handle || "", onclick: (e) => { if (!e.target.closest("a")) location.hash = personLink(p); } },
		h("td", { class: "nr", text: pnr(p.nr) }),
		h("td", {}, h("div", { class: "wer" }, initialen(h("span", { class: "avatar", "aria-hidden": "true" }), p.anzeigename || p.handle, p.handle),
			h("div", {}, h("a", { href: personLink(p) }, h("strong", { text: p.status === "geloescht" ? "gelöschte Person" : (anzeigePerson(p) || "@" + p.handle) })),
				p.status !== "geloescht" && anzeigePerson(p) ? h("div", { class: "leise", text: "@" + p.handle }) : null,
				p.alteHandles && p.alteHandles.length ? h("div", { class: "leise", text: "früher @" + p.alteHandles.join(", @") }) : null))),
		h("td", { text: p.emails.join(", ") || "–" }),
		h("td", {}, ...p.rollen.filter((r) => r !== "spieler").map((r) => h("span", { class: "rolle " + r, text: ROLLEN_TEXT[r] })), p.rollen.length <= 1 ? "Spieler" : null),
		h("td", {}, h("span", { class: "status " + STATUS_KLASSE[p.status], text: STATUS_TEXTE[p.status] }),
			p.status === "eingeladen" ? h("div", { class: "leise", text: p.einladungGesendet ? "Mail " + datumZeit(p.einladungGesendet) : "noch keine Mail" }) : null),
		p.nieAngemeldet && !RAUS(p.status)
			? h("td", { class: "warn", title: "Noch keine Anmeldung, kein Spielstand, kein Upload. Kommt der E-Mail-Code nicht an? Dann fehlt die Adresse meist in der Cloudflare-Richtlinie „Kollegen“.", text: "noch nie angemeldet" })
			: h("td", {}, datumZeit(p.zuletzt), tageHer(p.zuletzt) > 30 && p.zuletzt ? h("div", { class: "leise", text: `vor ${tageHer(p.zuletzt)} Tagen` }) : null),
		...(mitCf ? [p.cloudflare ? h("td", { class: p.cloudflare.kollegen && p.cloudflare.entwickler !== false ? "" : "warn",
			text: !p.cloudflare.kollegen ? "fehlt in Kollegen" : p.cloudflare.entwickler === false ? "fehlt in Entwickler" : "✓" }) : h("td", {})] : []))));
	suche.addEventListener("input", () => { crmFilter.q = suche.value; fuellen(); });
	suche.addEventListener("keydown", (e) => { if (e.key === "Enter") { const t = treffer(); if (t.length === 1) location.hash = personLink(t[0]); } });
	const neuZeigen = () => { c.replaceChildren(); personenSeite(c); };
	const kachel = (wert, text, f) => h("button", { type: "button", class: "kennzahl", onclick: () => { Object.assign(crmFilter, { rolle: "", status: "", inaktiv: false, aktiv: false }, f); neuZeigen(); } },
		h("div", { class: "wert", text: String(wert) }), h("div", { class: "text", text }));
	const chip = (text, an, setzen) => h("button", { type: "button", class: "chip" + (an ? " an" : ""), text, onclick: () => { setzen(); neuZeigen(); } });
	c.append(h("div", { class: "crm-titel" }, h("h2", { text: `CRM (${sichtbar.length})` }), suche),
		h("div", { class: "kacheln-klein" },
			kachel(sichtbar.length, "Personen", {}),
			kachel(sichtbar.filter(aktiv).length, "aktiv in 30 Tagen", { aktiv: true }),
			kachel(sichtbar.filter((p) => p.status === "eingeladen").length, "eingeladen", { status: "eingeladen" }),
			kachel(sichtbar.filter((p) => ["verwarnt", "gesperrt"].includes(p.status)).length, "verwarnt oder gesperrt", { status: "auffaellig" }),
			kachel(sichtbar.filter(inaktiv).length, "seit 30 Tagen nicht da", { inaktiv: true })),
		h("div", { class: "chips" }, h("span", { class: "leise", text: "Rolle:" }),
			...d.rollen.map((r) => chip(ROLLEN_TEXT[r], crmFilter.rolle === r, () => { crmFilter.rolle = crmFilter.rolle === r ? "" : r; })),
			h("span", { class: "leise", text: "Status:" }),
			...d.status.map((s) => chip(STATUS_TEXTE[s], crmFilter.status === s, () => { crmFilter.status = crmFilter.status === s ? "" : s; })),
			chip("aktiv in 30 Tagen", crmFilter.aktiv, () => { crmFilter.aktiv = !crmFilter.aktiv; if (crmFilter.aktiv) crmFilter.inaktiv = false; }),
			chip("seit 30 Tagen nicht da", crmFilter.inaktiv, () => { crmFilter.inaktiv = !crmFilter.inaktiv; if (crmFilter.inaktiv) crmFilter.aktiv = false; }),
			crmFilter.rolle || crmFilter.status || crmFilter.inaktiv || crmFilter.aktiv ? chip("✕ Filter löschen", false, () => Object.assign(crmFilter, { rolle: "", status: "", inaktiv: false, aktiv: false })) : null),
		h("div", { class: "tabelle-rahmen" }, h("table", { class: "tabelle" },
			h("thead", {}, h("tr", {}, ...["Nr.", "Person", "E-Mail", "Rollen", "Status", "Zuletzt aktiv", ...(mitCf ? ["Cloudflare"] : [])].map((t) => h("th", { text: t })))), tbody)),
		einladen, cloudflareBox(cf),
		d.mail ? null : h("p", { class: "leise", text: "E-Mail-Versand nicht eingerichtet (SMTP_* in der .env) – Einladungen dann selbst verschicken." }),
		h("p", {}, h("a", { href: "#protokoll", text: "Prüfprotokoll aller Änderungen →" })));
	fuellen();
	const liste = await api("GET", "/anmeldungen");
	c.append(h("h2", { text: "Letzte Anmeldungen" }),
		h("p", { class: "leise", text: "Je Cloudflare-Sitzung und Gerät. Unbekanntes Gerät? „Trennen“ meldet es bei der nächsten Anfrage ab (neuer E-Mail-Code nötig)." }),
		liste.length ? anmeldeTabelle(liste, true, async (a) => {
			if (!confirm(`Anmeldung von ${a.player} („${a.geraet}“) beenden? Das Gerät wird beim nächsten Klick abgemeldet.`)) return;
			await api("POST", "/anmeldungen/trennen", { player: a.player, sitzung: a.sitzung }); meldung(`${a.player}: ${a.geraet} getrennt.`); zeigen();
		}) : h("p", { class: "leise", text: "Noch keine Anmeldungen aufgezeichnet." }));
}

// Mauerwerk (Seb, 10.11.2026): Die Blöcke kommen der Reihe nach in die jeweils kürzeste Spalte. So entstehen keine Lücken unter
// kurzen Blöcken (wie im Raster, wo jede Zeile so hoch ist wie ihr längster Block), und die wichtigsten bleiben oben.
// Spaltenzahl nach Fensterbreite; Blöcke mit „breit“ gehen über die ganze Breite darunter. Eingaben und Klicks bleiben beim Umlegen erhalten.
function mauerwerk(raster, bloecke, spaltenBreite = 360) {
	const breit = bloecke.filter((b) => b.classList.contains("breit"));
	const schmal = bloecke.filter((b) => !b.classList.contains("breit"));
	let n = 0;
	const legen = () => {
		if (!raster.isConnected) return beobachter.disconnect();
		const neu = Math.max(1, Math.floor((raster.clientWidth + 16) / (spaltenBreite + 16)));
		if (neu === n) return;
		n = neu;
		const spalten = Array.from({ length: n }, () => h("div", { class: "mauer-spalte" }));
		raster.replaceChildren(h("div", { class: "mauer" }, ...spalten), ...breit);
		for (const b of schmal) spalten.reduce((k, s) => (s.offsetHeight < k.offsetHeight ? s : k)).append(b);
	};
	const beobachter = new ResizeObserver(legen);
	legen();
	beobachter.observe(raster);
}

async function personSeite(c, name) {
	const p = await api("GET", "/personen/" + encodeURIComponent(name));
	// Für alle weiteren Aufrufe die Nummer: gilt auch für gelöschte Personen und nach einem Handle-Wechsel
	const pfad = "/personen/" + encodeURIComponent(pnr(p.nr) || p.name);
	const wer = p.status === "geloescht" ? "gelöschte Person" : "@" + p.handle;
	const neu = () => zeigen();
	const tun = (fn, text) => sicher(async () => { const r = await fn(); if (text) meldung(text); await neu(); return r; });
	// Zusatzdaten (Profil, Spiele, Anfragen) parallel – fehlt eins, fehlt nur der Block
	const [profil, spiele, anfragen] = await Promise.all([
		p.status === "geloescht" ? null : Bridge.json("GET", "/api/profil/" + encodeURIComponent(p.handle)).catch(() => null),
		api("GET", "/spiele").catch(() => []), api("GET", "/antraege").catch(() => [])]);
	// Gelöschte heißen alle „gelöschte Person“ – Spiele und Anfragen lassen sich ihnen nicht mehr zuordnen (auch für den Admin anonym)
	const meins = (wer) => p.status !== "geloescht" && wer === p.handle;
	const eigeneSpiele = spiele.filter((s) => meins(s.author));
	const gestellt = anfragen.filter((a) => meins(a.player));
	const bekommen = anfragen.filter((a) => meins(a.zustaendig) && a.player !== p.handle);
	const gespielt = profil ? profil.spiele : [];

	// Kopf
	const zahlen = [[profil && profil.sekunden ? dauer(profil.sekunden) : 0, "Spielzeit"], [gespielt.length, "gespielt"], [eigeneSpiele.length, "eigene Spiele"],
		[gestellt.length + bekommen.length, "Anfragen"]].filter((z) => z[0]);
	c.append(h("p", {}, h("a", { href: "#personen", text: "← CRM" }), h("span", { class: "leise", text: " · Suche bleibt erhalten" })),
		h("section", { class: "karte profil-kopf crm-kopf" },
			initialen(h("span", { class: "avatar gross", "aria-hidden": "true" }), p.anzeigename || p.handle, p.handle),
			h("div", { class: "profil-name" },
				h("h2", {}, p.status === "geloescht" ? "gelöschte Person" : (anzeigePerson(p) || "@" + p.handle), " ",
					h("span", { class: "status " + STATUS_KLASSE[p.status], text: STATUS_TEXTE[p.status] }),
					p.notfallAdmin ? h("span", { class: "leise", text: " · Notfall-Admin (ADMINS)" }) : null),
				h("div", { class: "leise", text: [p.status !== "geloescht" && anzeigePerson(p) ? "@" + p.handle : null, pnr(p.nr), "dabei seit " + datumZeit(p.angelegt).split(",")[0],
					p.erste_anmeldung ? null : "noch nie angemeldet"].filter(Boolean).join(" · ") }),
				p.alteHandles && p.alteHandles.length ? h("div", { class: "leise", text: "früher @" + p.alteHandles.join(", @") + " (reserviert, leitet weiter)" }) : null,
				h("div", { class: "rollen" }, ...p.rollen.map((r) => h("span", { class: "rolle " + r, text: ROLLEN_TEXT[r] })))),
			zahlen.length ? h("div", { class: "profil-zahlen zeile" }, ...zahlen.map(([w, t]) => h("div", {}, h("b", { text: String(w) }), h("div", { text: t })))) : null),
		p.status === "gesperrt" ? h("p", { class: "hinweis-box", text: `Gesperrt: ${p.sperrgrund || "–"}${p.gesperrt_bis ? " · bis " + datumZeit(p.gesperrt_bis) : " · unbefristet"}. Aus Cloudflare entfernt das erst „python3 scripts/cloudflare.py abgleichen --entfernen“ am Mac – hinein kommt die Person aber schon jetzt nicht mehr.` }) : null,
		p.status === "eingeladen" && !p.erste_anmeldung ? h("p", { class: "hinweis-box", text: `Eingeladen${p.einladung_gesendet ? " (Mail " + datumZeit(p.einladung_gesendet) + ")" : ""}, hat sich noch nie angemeldet. Häufigster Grund: Der E-Mail-Code kommt nicht an – dann fehlt die Adresse in der Cloudflare-Richtlinie „Kollegen“.` }) : null,
		p.status === "geloescht" ? h("p", { class: "hinweis-box", text: "Endgültig gelöscht (anonymisiert). Überall – auch hier im Admin-Bereich – steht „gelöschte Person“, das frühere Handle ist für niemanden mehr frei. Erreichbar nur noch über die Nummer " + pnr(p.nr) + "." }) : null);

	// Schnellaktionen
	const schnell = [];
	if (!RAUS(p.status)) schnell.push(knopf("Handle ändern …", async () => {
		const neuesHandle = prompt(`Neues Handle für @${p.handle} (3–20 Zeichen: a–z, 0–9, _ und -). Als Admin ohne 30-Tage-Frist. Das alte bleibt für die Person reserviert, alte Links leiten weiter.`, p.handle);
		if (!neuesHandle || neuesHandle === p.handle) return;
		const r = await api("POST", pfad + "/handle", { handle: neuesHandle });
		location.hash = "#person/" + r.handle; meldung(`Handle geändert: @${p.handle} → @${r.handle}.`);
	}));
	schnell.push(knopf("Auskunft (Export)", async () => {
		const daten = await api("GET", pfad + "/export");
		const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(daten, null, 2)], { type: "application/json" })), download: `auskunft-${pnr(p.nr) || p.handle}.json` });
		document.body.append(a); a.click(); a.remove();
	}));
	if (p.uploadKonto) schnell.push(knopf("Neues Upload-Passwort", async () => {
		if (!confirm(`Neues Upload-Passwort für ${wer}? Das alte gilt sofort nicht mehr.`)) return;
		const r = await api("POST", `/entwickler/${encodeURIComponent(p.handle)}/passwort`); $("inhalt").prepend(passwortKarte(p.handle, r.passwort)); scrollTo(0, 0);
	}));
	c.append(h("div", { class: "zeile crm-aktionen" }, ...schnell));

	const bloecke = [];
	const block = (titel, ...inhalt) => h("section", { class: "karte crm-block" }, h("h3", { text: titel }), ...inhalt);

	// Stammdaten (immer – hier wird auch korrigiert)
	if (p.status !== "geloescht") {
		const f = {};
		for (const k of ["anzeigename", "vorname", "nachname"]) f[k] = h("input", { value: p[k] || "", maxlength: k === "anzeigename" ? "40" : "60" });
		f.geburtstag = h("input", { type: "date", value: p.geburtstag || "", min: "1900-01-01", max: new Date().toISOString().slice(0, 10) });
		const tag = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
		const leerMarken = () => f.geburtstag.classList.toggle("leer", !f.geburtstag.value);
		f.geburtstag.addEventListener("input", leerMarken); leerMarken();
		f.angelegt = h("input", { type: "date", value: p.angelegt ? tag(p.angelegt) : "", min: "2020-01-01", max: tag(new Date().toISOString()) });
		bloecke.push(h("form", { class: "karte crm-block", onsubmit: (e) => { e.preventDefault();
			const daten = { anzeigename: f.anzeigename.value, vorname: f.vorname.value, nachname: f.nachname.value, geburtstag: f.geburtstag.value || null };
			if (f.angelegt.value && f.angelegt.value !== tag(p.angelegt)) daten.angelegt = f.angelegt.value;
			tun(() => api("PATCH", pfad, daten), "Gespeichert."); } },
			h("h3", { text: "Stammdaten" }),
			h("div", { class: "felder" }, h("label", {}, "Anzeigename ", f.anzeigename), h("label", {}, "Vorname ", f.vorname), h("label", {}, "Nachname ", f.nachname), h("label", {}, "Geburtstag ", f.geburtstag),
				h("label", { title: "Wann das Konto angelegt wurde – „dabei seit“ im Profil. Korrigieren, wenn du es besser weißt." }, "Angelegt am ", f.angelegt)),
			h("p", { class: "leise", text: `Nummer ${pnr(p.nr)} · Handle @${p.handle}${p.handle_seit ? " (geändert " + datumZeit(p.handle_seit) + ")" : ""} · Spieleordner ${p.alt_name || p.handle} · angelegt ${datumZeit(p.angelegt)}${p.eingeladen_von ? " von " + p.eingeladen_von : ""} · erste Anmeldung ${datumZeit(p.erste_anmeldung)} · Datenschutzhinweis ${p.datenschutz_bestaetigt ? "bestätigt " + datumZeit(p.datenschutz_bestaetigt) : "noch nicht bestätigt"}` }),
			h("div", {}, h("button", { type: "submit", class: "knopf klein", text: "Speichern" }))));
	}

	// Notizen (nur Admin) – Eingabe immer, Liste nur wenn vorhanden
	const notiz = h("textarea", { rows: "2", maxlength: "4000", placeholder: "Interne Notiz – sieht nur der Admin" });
	bloecke.push(block("Notizen (nur für Admins)",
		h("div", { class: "zeile" }, notiz, knopf("Notiz speichern", async () => { await api("POST", pfad + "/notizen", { text: notiz.value }); meldung("Notiz gespeichert."); neu(); })),
		p.notizen.length ? h("ul", { class: "einfach" }, p.notizen.map((n) => h("li", {}, h("span", { class: "leise", text: `${datumZeit(n.zeit)} · ${n.von}: ` }), h("span", { class: "antrag-text", text: n.text })))) : null));

	// Login-E-Mails
	const neueMail = h("input", { type: "email", placeholder: "weitere Login-E-Mail" });
	if (p.emails.length || !RAUS(p.status)) bloecke.push(block("Login-E-Mails",
		h("ul", { class: "einfach" }, p.emails.map((m) => h("li", {}, m, " ", p.emails.length > 1 ? knopf("Entfernen", async () => {
			if (!confirm(`${m} entfernen? Mit dieser Adresse kommt ${wer} dann nicht mehr hinein.`)) return;
			await api("DELETE", `${pfad}/emails/${encodeURIComponent(m)}`); meldung("E-Mail entfernt."); neu();
		}, "gefahr") : null))),
		!RAUS(p.status) ? h("div", { class: "zeile" }, neueMail, knopf("Hinzufügen", async () => {
			await api("POST", pfad + "/emails", { email: neueMail.value }); meldung("E-Mail hinzugefügt – danach Cloudflare-Abgleich am Mac."); neu();
		})) : null));

	// Rollen
	if (!RAUS(p.status)) {
		const wahl = rollenWahl(p.rollen, p.notfallAdmin ? ["admin"] : []);
		bloecke.push(block("Rollen", wahl.el,
			h("p", { class: "leise", text: (p.ordner && !p.rollen.includes("entwickler") ? "Hat noch einen Spieleordner (die Spiele bleiben), aber keine Entwickler-Rechte. " : "") + "Entwickler bekommt ein Upload-Konto (Passwort wird einmal angezeigt), ohne Entwickler wird es entfernt – die Spiele bleiben. Tester: sieht auf dem Testserver das Tester-Panel und bekommt eine Glocke, wenn neue Tests anstehen." }),
			h("div", { class: "zeile" }, knopf("Rollen speichern", async () => {
				const r = await api("PUT", pfad + "/rollen", { rollen: wahl.werte() });
				await neu();
				meldung(r.dazu.length || r.weg.length ? `Rollen geändert: ${[...r.dazu.map((x) => "+" + ROLLEN_TEXT[x]), ...r.weg.map((x) => "−" + ROLLEN_TEXT[x])].join(", ")}.` + (r.hinweis ? " " + r.hinweis : "") : "Keine Änderung.");
				if (r.passwort) $("inhalt").prepend(passwortKarte(p.handle, r.passwort));
			}, ""))));
	}

	// Status und Maßnahmen
	const grund = h("input", { placeholder: "Grund (sieht die Person)", maxlength: "500", size: "34" });
	const bis = h("input", { type: "datetime-local", title: "leer = unbefristet" });
	const aktionen = [];
	if (p.status === "eingeladen" || (p.status !== "gesperrt" && !RAUS(p.status) && !p.erste_anmeldung)) {
		const senden = async (ohnePruefung) => { await api("POST", pfad + "/einladung", { ohnePruefung }); meldung(`Einladung an ${p.emails[0]} verschickt.`); neu(); };
		aktionen.push(knopf(p.einladung_gesendet ? "Einladung erneut senden" : "Einladung senden", async () => {
			try { await senden(false); } catch (e) {
				if (e.status === 409 && e.message.includes("trotzdem senden") && confirm(e.message + "\n\nSteht die E-Mail sicher in Cloudflare? Dann trotzdem senden.")) return senden(true);
				throw e;
			}
		}, ""));
	}
	if (["aktiv", "eingeladen", "verwarnt"].includes(p.status)) aktionen.push(knopf("Verwarnen", async () => {
		if (!grund.value.trim()) return meldung("Erst einen Grund eintragen.", true);
		await api("POST", pfad + "/verwarnen", { grund: grund.value }); meldung(`${wer} verwarnt – die Meldung steht in der Glocke.`); neu();
	}));
	if (p.status === "verwarnt") aktionen.push(knopf("Verwarnung aufheben", async () => { await api("POST", pfad + "/verwarnung-aufheben"); meldung("Verwarnung aufgehoben."); neu(); }));
	if (!p.notfallAdmin && !RAUS(p.status) && p.status !== "gesperrt") aktionen.push(knopf("Sperren", async () => {
		if (!grund.value.trim()) return meldung("Erst einen Grund eintragen.", true);
		if (!confirm(`${wer} sperren? Gilt sofort für Bibliothek und Upload.`)) return;
		await api("POST", pfad + "/sperren", { grund: grund.value, bis: bis.value ? new Date(bis.value).toISOString() : null }); meldung(`${wer} gesperrt.`); neu();
	}, "gefahr"));
	if (p.status === "gesperrt") aktionen.push(knopf("Entsperren", async () => { await api("POST", pfad + "/entsperren"); meldung("Entsperrt."); neu(); }));
	if (!p.notfallAdmin && !RAUS(p.status)) aktionen.push(knopf("Archivieren …", async () => {
		if (!confirm(`${wer} archivieren? Kein Zugang mehr (auch kein Upload), die Person verschwindet aus der Liste. Alle Daten bleiben – „Wiederherstellen“ holt sie jederzeit zurück.`)) return;
		await api("POST", pfad + "/archivieren"); meldung(`${wer} archiviert – rückgängig mit „Wiederherstellen“.`); neu();
	}, "gefahr"));
	if (p.status === "archiviert") {
		aktionen.push(knopf("Wiederherstellen", async () => {
			const r = await api("POST", pfad + "/wiederherstellen");
			await neu();
			meldung(`${wer} wiederhergestellt – Status ${STATUS_TEXTE[r.person.status]}.` + (r.passwort ? " Neues Upload-Passwort siehe oben." : ""));
			if (r.passwort) { $("inhalt").prepend(passwortKarte(p.handle, r.passwort)); scrollTo(0, 0); }
		}, ""));
		aktionen.push(knopf("Endgültig löschen (anonymisieren) …", async () => {
			const b = prompt(`${wer} ENDGÜLTIG löschen? Name, Geburtstag, E-Mails, Notizen und Rollen werden gelöscht – an Spielständen und in Bestenlisten steht danach „gelöschte Person“. Das lässt sich NICHT rückgängig machen. Gedacht z. B., wenn die Person die Löschung ihrer Daten verlangt.\n\nZur Bestätigung das Handle eingeben (${p.handle}):`);
			if (b === null) return;
			await api("POST", pfad + "/loeschen", { bestaetigung: b.trim().replace(/^@/, "") }); meldung(`${wer} endgültig gelöscht.`); neu();
		}, "gefahr"));
	}
	if (aktionen.length) bloecke.push(block("Status und Maßnahmen",
		h("div", { class: "zeile" }, h("label", {}, "Grund ", grund), h("label", { title: "nur fürs Sperren, leer = unbefristet" }, "gesperrt bis ", bis)),
		h("div", { class: "zeile" }, ...aktionen)));

	// Spiele, gespielt, Anfragen – nur wenn es etwas gibt
	const spielLink = (id, titel) => h("a", { href: "#spiele", title: id, text: titel || id });
	if (eigeneSpiele.length) bloecke.push(block(`Eigene Spiele (${eigeneSpiele.length})`, h("ul", { class: "einfach" }, eigeneSpiele.map((s) => h("li", {},
		spielLink(s.id, s.title), h("span", { class: "leise", text: ` · ${s.version || "Entwurf"} · ${s.spieler || 0} Spieler · ${dauer(s.spielzeit || 0)} gespielt` + (s.testspiel ? " · Testspiel" : "") + (s.offline ? " · offline" : "") }))))));
	if (gespielt.length) bloecke.push(block(`Gespielt (${gespielt.length})`, tabelle(["Spiel", "von", "Spielzeit", "Platz", "Erfolge"], gespielt.map((s) => h("tr", {},
		h("td", { text: s.title }), h("td", {}, s.author ? h("a", { href: "#person/" + s.author, text: "@" + s.author }) : "–"), h("td", { text: dauer(s.sekunden) }),
		h("td", { text: s.platz ? s.platz + "." : "–" }), h("td", { text: s.erfolgeGesamt ? `${s.erfolge.length}/${s.erfolgeGesamt}` : "–" }))))));
	const anfrageZeile = (a, gegenueber) => h("li", {}, h("a", { href: "/#/antrag/" + a.id, target: "_blank", rel: "noopener", text: "#" + a.id }), " ",
		h("span", { class: "status " + (a.status === "offen" ? "offen" : a.status === "erledigt" ? "erledigt" : ""), text: a.status }), " ", a.artText,
		a.title ? " zu " + a.title : "", " ", gegenueber, h("div", { class: "leise", text: `${datumZeit(a.erstellt)} · ${a.text.length > 120 ? a.text.slice(0, 120) + " …" : a.text}` }));
	if (gestellt.length || bekommen.length) bloecke.push(block("Anfragen",
		gestellt.length ? h("div", {}, h("strong", { text: `Gestellt (${gestellt.length})` }), h("ul", { class: "einfach" }, gestellt.map((a) => anfrageZeile(a,
			a.zustaendig && a.zustaendig !== "admin" ? h("span", {}, "→ ", h("a", { href: "#person/" + a.zustaendig, text: "@" + a.zustaendig })) : "→ Seb")))) : null,
		bekommen.length ? h("div", {}, h("strong", { text: `Als Entwickler bekommen (${bekommen.length}, ${bekommen.filter((a) => a.status === "offen").length} offen)` }),
			h("ul", { class: "einfach" }, bekommen.map((a) => anfrageZeile(a, h("span", {}, "von ", h("a", { href: "#person/" + a.player, text: "@" + a.player })))))) : null,
		h("p", { class: "leise", text: "Ab 1.6.0 stehen hier die Tickets." })));

	if (p.anmeldungen.length) bloecke.push(block(`Anmeldungen (${p.anmeldungen.length})`, anmeldeTabelle(p.anmeldungen, false, async (a) => {
		if (!confirm(`Anmeldung „${a.geraet}“ beenden?`)) return;
		await api("POST", "/anmeldungen/trennen", { player: p.handle, sitzung: a.sitzung }); meldung("Getrennt."); neu();
	})));
	if (p.sicherheit.length) bloecke.push(block(`Sicherheitsprotokoll (${p.sicherheit.length})`,
		tabelle(["Zeit", "Art", ""], p.sicherheit.map((z) => h("tr", {}, h("td", { text: datumZeit(z.zeit) }), h("td", { text: z.art }), h("td", { text: z.text }))))));
	if (p.zeitleiste.length) bloecke.push(h("section", { class: "karte crm-block breit" }, h("h3", { text: "Zeitleiste" }),
		tabelle(["Zeit", "Was", ""], p.zeitleiste.map((z) => h("tr", {}, h("td", { text: datumZeit(z.zeit) }), h("td", { text: z.art }), h("td", { text: z.text + (z.von ? ` (${z.von})` : "") }))))));
	const raster = h("div", { class: "crm-raster" });
	c.append(raster);
	mauerwerk(raster, bloecke);
	if (p.protokoll.length) c.append(h("details", {}, h("summary", { text: `Prüfprotokoll zu ${wer} (${p.protokoll.length})` }), protokollTabelle(p.protokoll)));
}

function protokollTabelle(liste) {
	const kurz = (x) => x === null || x === undefined ? "" : String(x).length > 120 ? String(x).slice(0, 120) + " …" : String(x);
	return tabelle(["Zeit", "Wer", "Aktion", "Person", "Vorher", "Nachher"], liste.map((z) => h("tr", {},
		h("td", { text: datumZeit(z.zeit) }), h("td", { text: z.von }), h("td", { text: z.aktion }), h("td", {}, z.ziel ? h("a", { href: "#person/" + z.ziel, text: "@" + z.ziel }) : ""),
		h("td", { class: "leise", text: kurz(z.vorher) }), h("td", { text: kurz(z.nachher) }))));
}
async function protokollSeite(c) {
	c.append(h("p", {}, h("a", { href: "#personen", text: "← CRM" })), h("h2", { text: "Prüfprotokoll" }),
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

// ---------- Anfragen ----------
async function antraegeSeite(c) {
	const alle = await api("GET", "/antraege");
	// 1.3.0: Hier nur, was der Admin erledigt (Bibliothek). Anfragen zu Spielen bearbeitet deren Entwickler – nur zur Info, ohne Zahl.
	const liste = alle.filter((a) => a.zustaendig === "admin"), spielAntraege = alle.filter((a) => a.zustaendig !== "admin");
	c.append(h("h2", { text: "Anfragen an die Bibliothek" }));
	if (!liste.length) c.append(h("p", { class: "leise", text: "Keine Anfragen." }));
	c.append(...liste.map((a) => {
		const antwort = h("textarea", { rows: "2", maxlength: "4000", placeholder: "Antwort an " + a.player });
		antwort.value = a.antwort || "";
		const setzen = (status) => sicher(async () => { await api("PATCH", "/antraege/" + a.id, { status, antwort: antwort.value || null }); meldung(`Anfrage ${a.id}: ${status}.`); zeigen(); });
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
		c.append(h("details", { class: "karte" }, h("summary", { text: `Anfragen zu Spielen – bearbeitet der jeweilige Entwickler (${offen} offen, ${spielAntraege.length - offen} geschlossen, nur zur Info)` }),
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
		d.probe ? h("p", { class: "leise", text: "Testserver: Der Auftragsdienst der NAS bedient nur die Live-Bibliothek – hier führt der Mac die Aufgaben aus." })
		: h("p", { class: dienst.aktiv ? "leise" : "hinweis-box", text: !dienst.eingerichtet
			? "Noch nicht eingerichtet – Aufträge bleiben liegen. Einmalig am Mac: sh scripts/auftragsdienst-einrichten.sh (Cron-Job auf der NAS, jede Minute)."
			: dienst.aktiv ? `✓ läuft – zuletzt gemeldet ${datumZeit(dienst.zuletzt)} (Live-Stand ${dienst.version})`
				: `✗ meldet sich nicht mehr seit ${datumZeit(dienst.zuletzt)} – Cron-Job auf der NAS prüfen (crontab -l), Log: /tmp/sb-auftragsdienst.log` }),
		// 1.4.1: Tests laufen auf dem Mac, wenn er bereit ist (Docker Desktop, scripts/auftraege-mac.py) – im Testserver nur dort
		h("p", { class: d.mac.aktiv ? "leise" : d.probe ? "hinweis-box" : "leise", text: d.mac.aktiv
			? `✓ Mac bereit (${d.mac.text || "Docker Desktop läuft"}, zuletzt ${datumZeit(d.mac.zuletzt)}) – Unit- und Ende-zu-Ende-Tests laufen dort, die NAS rechnet nichts.`
			: d.probe ? "✗ Der Mac meldet sich gerade nicht (Docker Desktop aus oder Mac im Ruhezustand). Im Testserver laufen Aufgaben nur auf dem Mac – sie warten, bis er wieder da ist."
				: `Mac nicht bereit${d.mac.zuletzt ? " (zuletzt " + datumZeit(d.mac.zuletzt) + ")" : ""} – Tests laufen auf der NAS. Auf den Mac: Docker Desktop starten (einmalig: sh scripts/auftraege-mac-einrichten.sh).` }),
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
		h("p", { class: "leise", text: "Auf dem Mac: Unit-Tests ca. 15 Sekunden, Ende-zu-Ende-Tests ca. 3 Minuten. Auf der NAS: ca. 8 bzw. 10 Minuten. Ende-zu-Ende läuft im Teststand, die echte Bibliothek wird nicht angefasst. „Live-Stand“ = was gerade live läuft, „Probe“ = was in der Probe zum Testen liegt. Bei Fehlern: rote Glocke und Home Assistant." }),
		tabelle(["Aufgabe", "Ziel", "", "Zeitplan (täglich)"], zeilen));

	// Verlauf – aktualisiert sich selbst, solange etwas läuft: nur diese Tabelle und nur bei Änderungen (1.4.1, Nachtest
	// 09.11.: vorher wurde die ganze Seite alle 15 s neu aufgebaut, sie sprang nach oben und flackerte)
	c.append(h("h2", { text: "Letzte Läufe" }), h("div", { id: "laeufe" }, laeufeTabelle(d)));
	if (laufend(d)) laeufeBeobachten(JSON.stringify(d.laeufe));
}

const laufend = (d) => d.laeufe.some((l) => l.status === "wartet" || l.status === "laeuft");
let neuLadenZeit;
function laeufeBeobachten(alt) {
	clearTimeout(neuLadenZeit);
	neuLadenZeit = setTimeout(async () => {
		const box = $("laeufe");
		if (location.hash !== "#aufgaben" || !box) return;
		if (box.querySelector("pre.log")) return laeufeBeobachten(alt);       // offenes Log nicht zuklappen
		let d;
		try { d = await api("GET", "/auftraege"); } catch { return laeufeBeobachten(alt); }
		const neu = JSON.stringify(d.laeufe);
		if (neu !== alt && $("laeufe") === box && !box.querySelector("pre.log")) box.replaceChildren(laeufeTabelle(d));
		if (laufend(d)) laeufeBeobachten(neu);
	}, 10000);
}

function laeufeTabelle(d) {
	if (!d.laeufe.length) return h("p", { class: "leise", text: "Noch keine." });
	return tabelle(["Aufgabe", "Ziel", "Auslöser", "Gestartet", "Dauer", "Status", "Ergebnis", ""], d.laeufe.map((l) => {
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
	}));
}

// Selbst aktualisieren, solange etwas läuft (1.4.1): nur EIN Zeitgeber (vorher stapelten sich bei jedem Klick weitere),
// Scrollposition bleibt, und nicht, solange ein Log offen ist oder gerade etwas eingegeben wird – sonst sprang die Seite
// „einfach so“ nach oben.
let uebersichtZeit;
function stillNeuLaden(hashes, ms) {
	clearTimeout(uebersichtZeit);
	uebersichtZeit = setTimeout(async () => {
		if (!hashes.includes(location.hash)) return;
		const c = $("inhalt");
		if (c.querySelector("pre.log") || (document.activeElement && c.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)))
			return stillNeuLaden(hashes, ms);
		const y = scrollY;
		c.style.minHeight = c.offsetHeight + "px";   // beim Neuaufbau nicht kurz schrumpfen
		await zeigen();
		c.style.minHeight = "";
		scrollTo(0, y);
	}, ms);
}

// Leere Teile (null/false) nie als Text „null“ einfügen – viele Seiten hängen bedingte Teile direkt an #inhalt an
// (1.4.1, Nachtest 09.11.: „null“ unter dem Namen einer Person und in der Personen-Liste)
for (const m of ["append", "prepend", "replaceChildren"]) {
	const el = $("inhalt"), orig = el[m].bind(el);
	el[m] = (...kinder) => orig(...kinder.filter((k) => k !== null && k !== undefined && k !== false));
}

const SEITEN = { uebersicht, spiele: spieleSeite, personen: personenSeite, protokoll: protokollSeite, spielstaende: spielstaendeSeite, antraege: antraegeSeite, aufgaben: aufgabenSeite };

async function zeigen() {
	if (location.hash === "#benutzer" || location.hash === "#crm") return location.replace("#personen");   // alte Adresse (vor 1.4.0) / Kurzform
	const person = location.hash.match(/^#person\/([a-z0-9][a-z0-9_-]{0,31}|P-\d{1,6})$/);
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
		const rot = [...neueste.values()].filter((l) => l.status === "fehler").length + (auf.dienst.eingerichtet && !auf.dienst.aktiv && !auf.probe ? 1 : 0);
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
