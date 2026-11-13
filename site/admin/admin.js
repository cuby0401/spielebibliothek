// Admin-Panel (Phase 10). Ob jemand Admin ist, entscheidet allein der Server (ADMINS im Speicher-Dienst).
// Seit Phase 2 der UI-Bausteine (E85, Seb 11.11.2026: „sieht ganz anders aus als unser Kontextmenü“) nur aus window.UI gebaut:
// keine eigenen Knöpfe/Felder, keine Browser-Dialoge, kein eigenes CSS. Geprüft von scripts/ui-pruefen.mjs.
// Nutzt datumZeit(), groesse(), dauer(), anmeldeTabelle() aus konto.js und Bridge.json() aus bridge.js.
"use strict";
(function () {
	const { h } = UI;
	const $ = (id) => document.getElementById(id);
	const api = (methode, pfad, body) => Bridge.json(methode, "/api/admin" + pfad, body);
	const idPfad = (id) => id.split("/").map(encodeURIComponent).join("/");
	let spieleCache = [];

	// Eine Meldungsart für alles (UI.meldung, unten in der Mitte): Erfolge verschwinden, Fehler bleiben bis zum Klick
	const meldung = (text, fehler) => { if (text) UI.meldung(text, { art: fehler ? "fehler" : "erfolg" }); };
	async function sicher(fn) {
		try { await fn(); } catch (e) { if (!(e instanceof Bridge.SitzungAbgelaufen)) meldung(e.message, true); }
	}
	// Knopf, der Fehler selbst meldet und während der Arbeit „lädt“
	const knopf = (text, onclick, art = "standard", mehr = {}) => {
		const k = UI.knopf({ text, art, ...mehr, onclick: () => { k.laden(true); sicher(onclick).finally(() => { if (k.isConnected) k.laden(false); }); } });
		return k;
	};
	const leise = (t) => UI.text(t, { art: "klein" });
	// Tabelle aus Köpfen und Zeilen-Arrays (Zellen: Text oder Element)
	const tabelle = (koepfe, zeilen, o = {}) => UI.tabelle({ ...o, spalten: koepfe.map((titel, i) => ({ titel, wert: (z) => z[i] })), zeilen });
	const abschnitt = (titel, inhalt, o = {}) => UI.abschnitt({ titel, inhalt: UI.stapel(inhalt), ...o });
	const link = (href, text, o = {}) => h("a", { href, text, target: o.neu ? "_blank" : null, rel: o.neu ? "noopener" : null, title: o.titel || null });
	const stark = (t) => UI.text(t, { tag: "strong" });
	const unter = (...teile) => UI.stapel(teile, { abstand: "s" });

	// ---------- Übersicht ----------
	async function uebersicht(c) {
		const d = await api("GET", "/uebersicht");
		notausZeigen(c);
		await zentraleFehlerZeigen(c);
		const kz = (wert, label, art) => UI.kennzahl({ wert, label, art });
		c.append(UI.raster([
			kz(d.spieler, "Personen mit Zugang"),
			kz(d.spiele, "Spiele" + (d.testspiele ? ` (+${d.testspiele} Testspiele)` : "") + (d.offline ? ` · ${d.offline} offline` : "")),
			kz(d.zaehler.saves, "Spielstände"),
			kz(d.zaehler.scores, "Bestenlisten-Einträge"), kz(d.offeneAntraege, "offene Anfragen", d.offeneAntraege ? "warnung" : null),
			kz(groesse(d.datenbank), "Datenbank"),
			d.platte && d.platte.gesamt ? kz(groesse(d.platte.frei), "frei auf der NAS", d.platte.knapp ? "gefahr" : null) : null,
			kz(d.sicherung ? datumZeit(d.sicherung) : "–", "letzte DB-Kopie fürs Backup")], { art: "kennzahlen" }));
		if (d.platte && d.platte.knapp) c.append(UI.hinweis({ art: "gefahr", titel: "Speicher auf der NAS wird knapp",
			text: `Nur noch ${groesse(d.platte.frei)} von ${groesse(d.platte.gesamt)} frei. Alte Versionen löschen oder Kontingente (UPLOAD_KONTINGENT_MB) senken.` }));
		c.append(leise("Backup: borgmatic sichert jede Nacht um 02:00 – den Erfolg zeigt das borgmatic-Log auf der NAS (docker logs borgmatic)."));
		const w = d.waechter || {};
		const probleme = w.probleme && w.probleme.length;
		c.append(abschnitt("Wächter", [
			UI.hinweis({ art: !w.aktiv || !w.letzterLauf ? "info" : probleme ? "gefahr" : "erfolg",
				text: !w.aktiv ? "Wächter ist aus (WAECHTER=0)."
					: !w.letzterLauf ? "Wächter startet – erster Lauf etwa eine Minute nach dem Start."
					: (probleme ? w.probleme.join(" · ") : "Alles in Ordnung") + ` · zuletzt geprüft ${datumZeit(w.letzterLauf)}` }),
			leise(w.homeAssistant ? "Home Assistant bekommt Lebenszeichen, Probleme und neue Anfragen (HA_WEBHOOK_URL gesetzt)."
				: "Home Assistant ist nicht verbunden – HA_WEBHOOK_URL in der .env setzen, Anleitung: docs/home-assistant.md im Repo.")]));
		await zentraleZeigen(c);
		await probeZeigen(c);
		// „Ansicht als …“ (E26/E27): gilt für diesen Tab, beendet wird über das Band in der Bibliothek.
		// Jeder Start beginnt mit leerem simulierten Konto – auch der Zwischenspeicher dieses Browsers dafür wird geleert
		const ansichtStarten = async (rolle) => {
			await api("POST", `/ansicht/${rolle}/zuruecksetzen`);
			try { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-puffer:") && k.endsWith(":" + rolle)) localStorage.removeItem(k); } catch { /* egal */ }
			Bridge.ansicht = rolle;
			// Beim Beenden zurück an genau diese Stelle im Admin-Panel (1.3.0)
			try { sessionStorage.setItem("ansicht-zurueck", JSON.stringify({ url: location.pathname + location.hash, y: Math.round(scrollY) })); } catch { /* egal */ }
			location.href = "/#/";
		};
		c.append(abschnitt("Bibliothek als Rolle ansehen", [
			UI.text("Zeigt die Bibliothek in diesem Tab so, wie Kollegen mit dieser Rolle sie sehen – mit einem eigenen Konto, das bei jedem Start geleert wird. Bestenliste und Anfragen sind dabei gesperrt. Beenden über das Band oben in der Bibliothek.", { art: "leise" }),
			UI.leiste([knopf("Ansicht als Spieler", () => ansichtStarten("spieler"), "standard", { ikon: "auge" }),
				knopf("Ansicht als Entwickler", () => ansichtStarten("entwickler"), "standard", { ikon: "auge" })])]));
		c.append(abschnitt("Letzte Aktivität", [tabelle(["Spieler", "Spiel", "Zeit"], d.aktivitaet.map((a) => [a.player, a.title, datumZeit(a.zeit)]))]));
		c.append(abschnitt("Letzte Uploads und Konto-Änderungen", [tabelle(["Zeit", "Wer", "Was", "Ordner"],
			d.uploads.map((u) => u.fehler ? ["", "", u.fehler, ""] : [datumZeit(u.zeit), u.player, u.aktion + (u.dateien ? ` (${u.dateien} Dateien)` : ""), u.ordner || ""]))]));
		c.append(abschnitt("Speicher je Entwickler", [tabelle(["Entwickler", "Live-Spiele", "Kontingent (inkl. Entwürfe und Versionen)"],
			Object.entries(d.speicher).map(([n, b]) => [n, groesse(b), groesse(d.kontingent)]))]));
	}

	// Not-Aus (Zentrale 1.4.0, E72): trennt die Bibliothek vom Internet. Aufheben geht nur am Mac (scripts/deploy.sh --notaus-aus).
	function notausZeigen(c) {
		const protokoll = UI.stapel([]);
		const ausloesen = async () => {
			const grund = await UI.eingabe({ titel: "Not-Aus auslösen", gefahr: true, ja: "Weiter", pflicht: false, label: "Grund (optional, steht im Sicherheitsprotokoll)",
				text: "Die Bibliothek wird sofort gesperrt (keine Daten mehr), der Tunnel geht innerhalb einer Minute aus. Wieder einschalten geht NUR am Mac mit scripts/deploy.sh --notaus-aus." });
			if (grund === null) return;
			const best = await UI.eingabe({ titel: "Wirklich Not-Aus?", gefahr: true, ja: "Not-Aus auslösen", label: "Zur Bestätigung NOT-AUS eintippen",
				pruefen: (w) => (w === "NOT-AUS" ? "" : "Bitte genau NOT-AUS eintippen.") });
			if (best !== "NOT-AUS") return meldung("Nicht ausgelöst.");
			const d = await api("POST", "/notaus", { bestaetigung: "NOT-AUS", grund });
			c.replaceChildren(UI.hinweis({ art: "gefahr", titel: "Not-Aus ist AN", text: d.hinweis,
				inhalt: leise(`Ausgelöst ${datumZeit(d.zeit)} von ${d.von}${d.grund ? " – " + d.grund : ""}. Diese Seite funktioniert jetzt nicht mehr.`) }));
		};
		c.append(UI.aufklappen({ id: "notaus", art: "gefahr", titel: "Not-Aus", inhalt: [
			UI.text("Bei Verdacht auf ein Datenleck oder einen Angriff: sperrt sofort alle Daten (Bibliothek und Upload) und trennt die Webseite innerhalb einer Minute vom Internet. Andere Dienste auf der NAS laufen weiter. Wieder einschalten nur am Mac: scripts/deploy.sh --notaus-aus.", { art: "leise" }),
			UI.leiste([knopf("Not-Aus auslösen …", ausloesen, "gefahr", { ikon: "warnung" }), knopf("Sicherheitsprotokoll", async () => {
				const liste = await api("GET", "/sicherheit");
				protokoll.replaceChildren(liste.length ? tabelle(["Zeit", "Ereignis", "Wer", "Text"], liste.map((x) => [datumZeit(x.zeit), x.art, x.wer || "", x.text || ""]))
					: leise("Noch keine Einträge (aufbewahrt wird ein Jahr)."));
			}, "standard", { ikon: "schild" })]),
			protokoll] }));
	}

	// Fehler der Bibliothek selbst (Zentrale 1.4.0). Seit 1.5.0 (Seb, 10.11.2026) nur ein roter Hinweis in der Übersicht,
	// die Liste mit Fundort und Stacktrace öffnet sich in einem eigenen Fenster. Leer: ein grüner Hinweis.
	async function zentraleFehlerZeigen(c) {
		let liste = [];
		try { liste = (await Bridge.json("GET", "/api/entwickler/fehler?alle=true")).filter((f) => f.zentrale); } catch { return; }
		if (!liste.length) return c.append(UI.hinweis({ art: "erfolg", text: "Keine Fehler in der Bibliothek selbst gemeldet." }));
		const zuletzt = liste.map((f) => f.letztes).sort().pop();
		const oeffnen = () => {
			const box = UI.stapel([]);
			const fuellen = () => box.replaceChildren(
				UI.text("Abstürze der Bibliotheksseite bei Spielern – der Spieler sah dazu „Fehler-Nr. …“. Gleiche Fehler sind zusammengefasst. „Erledigt“ entfernt den Eintrag, tritt er wieder auf, erscheint er neu.", { art: "leise" }),
				liste.length ? tabelle(["Nr.", "Fehler", "Fundort", "Anzahl", "Zuletzt", "Browser", ""], liste.map((f) => [String(f.id),
					unter(UI.code(f.meldung), f.stack ? UI.aufklappen({ titel: "Seite, Version, Stacktrace", inhalt: UI.code(f.stack, { block: true }) }) : null),
					UI.code((f.quelle || "inline") + (f.zeile ? `:${f.zeile}` + (f.spalte ? `:${f.spalte}` : "") : "")),
					String(f.anzahl), datumZeit(f.letztes), f.browser || "",
					knopf("Erledigt", async () => {
						await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id);
						liste = liste.filter((x) => x.id !== f.id);
						fuellen();
					})]))
					: UI.hinweis({ art: "erfolg", text: "Alle erledigt." }));
			fuellen();
			UI.dialog({ id: "fehler-fenster", breit: true, titel: `Fehler in der Bibliothek (${liste.length})`, inhalt: box })
				.oeffnen().then(() => zeigen());     // Übersicht danach mit dem neuen Stand
		};
		c.append(UI.hinweis({ id: "fehler-zeile", art: "gefahr", titel: `${liste.length === 1 ? "1 Fehler" : liste.length + " Fehler"} in der Bibliothek`,
			text: `zuletzt ${datumZeit(zuletzt)} · ${liste.reduce((n, f) => n + (f.anzahl || 1), 0)}× aufgetreten`,
			aktion: { text: "Ansehen", ikonRechts: "winkel-rechts", onclick: oeffnen } }));
	}

	// Version der Zentrale (E39): site/zentrale.json und CHANGELOG.md schreibt scripts/deploy.sh
	async function zentraleZeigen(c) {
		let z = null, log = "";
		try { z = await (await fetch("/zentrale.json", { cache: "no-store" })).json(); } catch { /* vor E39 deployt */ }
		try { const r = await fetch("/admin/CHANGELOG.md", { cache: "no-store" }); if (r.ok) log = await r.text(); } catch { /* egal */ }
		c.append(abschnitt("Zentrale", [
			UI.text(z ? `Version ${z.version} · Commit ${z.commit} · deployt ${datumZeit(z.zeit)}` : "Version unbekannt (noch nicht mit Versionierung deployt)."),
			leise("Zurück auf eine frühere Version: auf dem Mac scripts/deploy.sh --zurueck <version>. Vor jedem Deploy wird die Datenbank gesichert (data/backup/vor-deploy/)."),
			log ? UI.aufklappen({ titel: "Änderungsprotokoll der Zentrale", inhalt: UI.code(log, { block: true }) }) : null]));
	}

	// Probe-Zentrale (E56): Kopie zum Testen; „Für Live freigeben“ erlaubt scripts/deploy.sh genau diesen Commit
	const PROBE_URL = "https://test.cuby0401.uk";   // seit 1.4.0 zugleich der Testserver für die Tester (E76)
	async function probeZeigen(c) {
		const p = await api("GET", "/probe").catch(() => null);
		if (!p) return;
		if (!p.probe) {
			return c.append(abschnitt("Probe-Zentrale", [
				UI.text("Neue Versionen der Zentrale laufen zuerst in der Probe – einer Kopie mit den echten Spielen und Daten. Sie ist zugleich der Testserver für die Tester (Anmeldung über die Access-Anwendung „Spielebibliothek Test“). Aufsetzen: scripts/deploy.sh --probe. Live geht eine Version erst, wenn du sie dort freigegeben hast."),
				UI.leiste([UI.knopf({ art: "standard", groesse: "s", href: PROBE_URL, neuesFenster: true, text: PROBE_URL.replace("https://", ""), ikonRechts: "extern" }),
					UI.knopf({ art: "standard", groesse: "s", href: PROBE_URL + "/tester/", neuesFenster: true, text: "Tester-Panel", ikonRechts: "extern" })])]));
		}
		const f = p.freigabe, frei = f && f.commit === p.commit;
		// Tester-Ergebnisse (1.4.0, E76) – stehen direkt bei der Freigabe
		const tp = await Bridge.json("GET", "/api/tester/plan").catch(() => null);
		const z = tp && tp.zusammenfassung;
		const fehlschlaege = tp ? tp.ergebnisse.filter((x) => !x.ok) : [];
		const testBox = !tp ? leise("Für diese Version gibt es keinen Testplan (tests/manuell/<Version>.json im Repo).")
			: UI.hinweis({ art: z.fehlgeschlagen ? "warnung" : z.offen ? "info" : "erfolg",
				titel: `Tests der Tester: ${z.bestanden} von ${z.gesamt} bestanden` + (z.fehlgeschlagen ? `, ${z.fehlgeschlagen} fehlgeschlagen` : "") + (z.offen ? `, ${z.offen} offen` : ""),
				inhalt: fehlschlaege.length ? UI.liste(fehlschlaege.map((x) => ({ titel: (tp.tests.find((t) => t.id === x.test) || {}).titel || x.test,
					text: `${x.player}, ${datumZeit(x.zeit)}: ${x.text}`, href: "/tester/#test-" + x.test })), { ohneRahmen: true }) : null,
				aktion: { text: "Zum Tester-Panel", href: "/tester/", ikonRechts: "winkel-rechts" } });
		c.append(abschnitt("Diese Seite ist die Probe-Zentrale", [
			UI.text(`Version ${p.version || "?"} · Commit ${p.commit || "?"}` + (p.kopieVon ? ` · Daten kopiert ${datumZeit(p.kopieVon)}` : "")), testBox,
			frei ? UI.hinweis({ art: "erfolg", text: `Freigegeben am ${datumZeit(f.zeit)}${f.notiz ? " – " + f.notiz : ""}.` }) : leise("Noch nicht freigegeben."),
			// Live-Deploy nach der Freigabe (1.3.0): meldet der Auftragsdienst
			frei ? liveStatus(p) : null,
			UI.leiste([frei
				? knopf("Freigabe zurücknehmen", async () => { await api("DELETE", "/probe/freigeben"); meldung("Freigabe zurückgenommen."); zeigen(); }, "gefahr-leise")
				: knopf("Getestet – für Live freigeben", async () => {
					// Fehlgeschlagene oder offene Tests: nur deutlich warnen, nicht sperren (manchmal ist ein Fehler bekannt und unwichtig)
					if (z && (z.fehlgeschlagen || z.offen) && !await UI.bestaetigen({ titel: "Trotzdem freigeben?", gefahr: true, ja: "Trotzdem freigeben",
						text: `Achtung: ${z.fehlgeschlagen} Test(s) fehlgeschlagen, ${z.offen} noch offen.` })) return;
					const notiz = await UI.eingabe({ titel: "Für Live freigeben", ja: "Freigeben", pflicht: false, label: "Was hast du getestet? (optional, steht in der Freigabe)",
						wert: z ? `Tester: ${z.bestanden}/${z.gesamt} bestanden` : "" });
					if (notiz === null) return;
					await api("POST", "/probe/freigeben", { notiz });
					meldung("Freigegeben – der Auftragsdienst spielt diese Version innerhalb einer Minute live ein.");
					zeigen();
				}, "primaer")])]));
	}

	function liveStatus(p) {
		const l = p.live && p.live.commit === p.commit ? p.live : null;
		if (!l) {
			stillNeuLaden(["", "#uebersicht"], 10000);
			return UI.laden({ label: "Wartet auf den Auftragsdienst (spätestens nach einer Minute) … Ohne eingerichteten Auftragsdienst: auf dem Mac scripts/deploy.sh" });
		}
		if (l.status === "laeuft") stillNeuLaden(["", "#uebersicht"], 10000);
		return UI.hinweis({ art: l.status === "fehler" ? "gefahr" : l.status === "ok" ? "erfolg" : "info",
			titel: l.status === "ok" ? `Live eingespielt (${datumZeit(l.zeit)})` : l.status === "fehler" ? "Live-Deploy fehlgeschlagen – die bisherige Version läuft weiter" : "Wird gerade live eingespielt …",
			text: l.status === "fehler" ? "Neuer Versuch: „Freigabe zurücknehmen“ und erneut freigeben." : null,
			inhalt: l.text ? UI.aufklappen({ titel: "Ausgabe", inhalt: UI.code(l.text, { block: true }) }) : null });
	}

	// ---------- Spiele ----------
	async function spieleSeite(c) {
		spieleCache = await api("GET", "/spiele");
		const sdw = await Bridge.json("GET", "/api/spiel-der-woche").catch(() => null);
		if (sdw) c.append(UI.hinweis({ art: "akzent", ikon: "stern", titel: `Spiel der Woche: „${sdw.title}“`, text: `bis ${datumZeit(sdw.ende)}`,
			aktion: knopf("Beenden", async () => { await Bridge.json("DELETE", "/api/admin/spiel-der-woche"); meldung("Spiel der Woche beendet."); zeigen(); }) }));
		const zeilen = spieleCache.map((s) => {
			const schalter = (feld, text) => UI.haken({ label: text, an: !!s[feld],
				onwechsel: (an) => sicher(async () => { await api("PATCH", "/spiele/" + idPfad(s.id), { [feld]: an }); meldung(`${s.title}: ${text} ${an ? "an" : "aus"}`); }) });
			const offline = UI.haken({ label: "offline" + (s.offline && s.offlineGrund ? ` (${s.offlineGrund})` : ""), an: !!s.offline,
				onwechsel: (an) => sicher(async () => {
					await Bridge.json("PUT", "/api/entwickler/offline/" + idPfad(s.id), { offline: an });
					meldung(`${s.title}: ${an ? "offline" : "wieder online"}`);
				}) });
			const istSdw = sdw && sdw.id === s.id;
			const eintraege = [
				s.leaderboard.enabled ? { text: "Bestenliste", ikon: "pokal", onclick: () => sicher(() => bestenlisteDetail(c, s)) } : null,
				s.leaderboard.enabled && !s.testspiel && !istSdw ? { text: "Zum Spiel der Woche", ikon: "stern", onclick: () => sicher(async () => {
					if (!await UI.bestaetigen({ titel: "Spiel der Woche", ja: "Spiel der Woche machen",
						text: `„${s.title}“ für 7 Tage zum Spiel der Woche machen? Alle bekommen eine Meldung, es gibt eine eigene Wochen-Bestenliste.` + (sdw ? ` Das laufende („${sdw.title}“) endet dann.` : "") })) return;
					await Bridge.json("PUT", "/api/admin/spiel-der-woche/" + idPfad(s.id)); meldung(`„${s.title}“ ist Spiel der Woche.`); zeigen();
				}) } : null,
				s.leaderboard.enabled ? { text: "Neue Season", ikon: "aktualisieren", onclick: () => sicher(async () => {
					if (!await UI.bestaetigen({ titel: "Neue Season", ja: "Neue Season starten", text: `Neue Season für „${s.title}“? Die bisherige Bestenliste bleibt als alte Season erhalten.` })) return;
					const r = await Bridge.json("POST", "/api/entwickler/season/" + idPfad(s.id)); meldung(`Season ${r.season} begonnen.`); zeigen();
				}) } : null,
				s.leaderboard.enabled ? "trenner" : null,
				{ text: "Löschen …", ikon: "loeschen", gefahr: true, onclick: () => sicher(async () => {
					const ordner = s.id.split("/")[1];
					const eingabe = await UI.eingabe({ titel: `„${s.title}“ löschen?`, gefahr: true, ja: "Endgültig löschen", label: `Zum Bestätigen den Ordnernamen eingeben (${ordner})`,
						text: `Das Spiel (${s.id}) wird mit allen Dateien gelöscht. Spielstände und Bestenliste bleiben in der Datenbank.`,
						pruefen: (w) => (w === ordner ? "" : "Der Ordnername stimmt nicht.") });
					if (eingabe !== ordner) return meldung("Nicht gelöscht.");
					await api("DELETE", "/spiele/" + idPfad(s.id)); meldung(`${s.title} gelöscht.`); zeigen();
				}) },
			].filter(Boolean);
			const mehr = UI.knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "mehr", label: `Aktionen für ${s.title}` });
			return [
				unter(stark(s.title), leise(s.id + (s.version ? " · v" + s.version : "") + (s.complete ? "" : " · unvollständig")),
					s.complete ? link("/#/spiel/" + s.id, "Öffnen") : null,
					istSdw ? UI.marke({ text: "Spiel der Woche", art: "akzent", ikon: "stern", klein: true }) : null),
				String(s.spieler), String(s.daumen || 0), dauer(s.spielzeit), datumZeit(s.zuletzt),
				s.leaderboard.enabled ? `S${s.leaderboardSeason} · ${s.scores}` : "aus",
				s.fehler && s.fehler.arten ? UI.marke({ text: `${s.fehler.arten24h || 0} neu · ${s.fehler.anzahl}×`, art: s.fehler.arten24h ? "gefahr" : "neutral", klein: true }) : "–",
				unter(schalter("versteckt", "ausblenden"), schalter("hervorgehoben", "empfehlen"), schalter("testspiel", "Testspiel"), offline),
				UI.menue({ ausloeser: mehr, label: `Aktionen für ${s.title}`, eintraege }),
			];
		});
		c.append(abschnitt("Spiele", [
			UI.text("„Ausblenden“ versteckt ein Spiel in der Übersicht für alle außer dir (die Dateien bleiben unter play erreichbar). „Empfehlen“ heftet es mit Marke nach den Favoriten oben an. „Testspiel“ nimmt es für alle aus der Übersicht – auch für dich; öffnen über „Öffnen“ hier. Für Tutorials und Testwerkzeuge wie Spike, Böse oder die Bestenlisten-Vorlage.", { art: "leise" }),
			tabelle(["Spiel", "Spieler", "Daumen", "Spielzeit", "Zuletzt", "Bestenliste", "Fehler", "Sichtbarkeit", ""], zeilen, { titel: "Spiele" })]));
		const fehler = (await Bridge.json("GET", "/api/entwickler/fehler?alle=true")).filter((f) => !f.zentrale);   // Bibliothek: siehe Übersicht
		c.append(abschnitt("Fehlerberichte aller Spiele", [fehler.length
			? tabelle(["Spiel", "Fehler", "Ort", "Anzahl", "Zuletzt", "Browser", ""], fehler.map((f) => [
				f.title + (f.entwurf ? " (Entwurf)" : ""), UI.code(f.meldung), (f.quelle || "inline") + (f.zeile ? ":" + f.zeile : ""),
				String(f.anzahl), datumZeit(f.letztes), f.browser || "",
				knopf("Erledigt", async () => { await Bridge.json("DELETE", "/api/entwickler/fehler/" + f.id); zeigen(); })]))
			: UI.leer({ klein: true, ikon: "erfolg", titel: "Keine Fehler gemeldet" })]));
	}

	async function bestenlisteDetail(c, s) {
		const liste = await api("GET", "/scores/" + idPfad(s.id));
		c.replaceChildren(
			UI.leiste([UI.knopf({ art: "leise", groesse: "s", ikon: "winkel-links", text: "Spiele", onclick: () => zeigen() })]),
			abschnitt(`Bestenliste „${s.title}“`, [
				leise("Alle Einträge, neueste zuerst."),
				UI.leiste([knopf(`Season ${s.leaderboardSeason} leeren …`, async () => {
					if (!await UI.bestaetigen({ titel: "Season leeren?", gefahr: true, ja: "Alle Einträge löschen", text: `Alle Einträge der Season ${s.leaderboardSeason} löschen?` })) return;
					const r = await api("DELETE", `/bestenliste/${idPfad(s.id)}?season=${s.leaderboardSeason}`); meldung(`${r.geloescht} Einträge gelöscht.`); bestenlisteDetail(c, s);
				}, "gefahr-leise")]),
				tabelle(["Zeit", "Spieler", "Season", "Score", "Werte", ""], liste.map((e) => [datumZeit(e.zeit), e.player, String(e.season), String(e.score),
					Object.keys(e.werte).length ? UI.code(JSON.stringify(e.werte)) : "",
					knopf("Löschen", async () => { await api("DELETE", "/scores/" + e.id); bestenlisteDetail(c, s); }, "gefahr-leise")]))]));
	}

	// ---------- Personen (CRM, Zentrale 1.4.0) ----------
	const STATUS_TEXTE = { eingeladen: "eingeladen", aktiv: "aktiv", verwarnt: "verwarnt", gesperrt: "gesperrt", archiviert: "archiviert", geloescht: "gelöscht" };
	const STATUS_ART = { eingeladen: "info", aktiv: "erfolg", verwarnt: "warnung", gesperrt: "gefahr", archiviert: "neutral", geloescht: "neutral" };
	const statusMarke = (status, id) => { const m = UI.marke({ text: STATUS_TEXTE[status] || status, art: STATUS_ART[status] || "neutral", punkt: true }); if (id) m.id = id; return m; };
	// Archiviert (zurückholbar) und gelöscht (anonymisiert) stehen nicht in der normalen Liste und lassen sich nicht bearbeiten
	const RAUS = (status) => status === "archiviert" || status === "geloescht";
	const ROLLEN_TEXT = { spieler: "Spieler", entwickler: "Entwickler", admin: "Admin", tester: "Tester" };
	const ROLLEN_ART = { admin: "warnung", entwickler: "akzent", tester: "info", spieler: "neutral" };
	const rolleMarke = (r) => UI.marke({ text: ROLLEN_TEXT[r] || r, art: ROLLEN_ART[r] || "neutral", klein: true });
	const anzeigePerson = (p) => p.anzeigename || [p.vorname, p.nachname].filter(Boolean).join(" ") || "";
	function passwortKarte(name, pw) {
		return UI.hinweis({ id: "passwort-hinweis", art: "akzent", ikon: "schloss", titel: `Upload-Passwort für ${name} (wird nur jetzt angezeigt)`,
			inhalt: UI.stapel([UI.code(pw, { gross: true, kopieren: true }), leise("Persönlich weitergeben, nicht per Mail.")], { abstand: "s" }) });
	}
	const rollenWahl = (aktuell, gesperrt = []) => {
		const boxen = {};
		const el = UI.stapel(Object.entries(ROLLEN_TEXT).map(([r, t]) => {
			boxen[r] = UI.haken({ label: t, an: aktuell.includes(r) || r === "spieler", deaktiviert: r === "spieler" || gesperrt.includes(r) });
			return boxen[r];
		}), { abstand: "s" });
		return { el, werte: () => Object.keys(boxen).filter((r) => boxen[r].wert) };
	};

	// ---------- CRM (Zentrale 1.5.0, Klick-Muster vom 09.11.2026) ----------
	// Nummer, Name, @handle oder E-Mail eingeben → alles zu einer Person auf einen Blick, alles verlinkt. Leere Blöcke fehlen
	// ganz (Seb, 07.11.). Personen werden mit ihrem Handle angesprochen (#person/<handle>), gelöschte über die Nummer (P-0007).
	const pnr = (nr) => nr ? "P-" + String(nr).padStart(4, "0") : "";
	const personLink = (p) => "#person/" + (p.status === "geloescht" || !p.handle ? pnr(p.nr) : p.handle);
	const tageHer = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : Infinity;
	const crmFilter = { q: "", rolle: "", status: "", inaktiv: false, aktiv: false };   // bleibt beim Hin und Her zur Personenkarte erhalten

	async function personenSeite(c) {
		const [d, cf] = await Promise.all([api("GET", "/personen"), api("GET", "/cloudflare").catch(() => ({ eingerichtet: false }))]);
		// Einladen
		const mail = UI.feld({ id: "einladen-mail", typ: "email", label: "E-Mail (Cloudflare-Login)", pflicht: true, platzhalter: "name@beispiel.de", autocomplete: "off" });
		const name = UI.feld({ id: "einladen-handle", label: "Handle", pflicht: true, platzhalter: "z. B. paul", autocomplete: "off",
			hinweis: "3–20 Zeichen: a–z, 0–9, _ und -. Kann die Person später alle 30 Tage selbst ändern; ihr Spieleordner behält diesen ersten Namen." });
		name.eingabe.pattern = "[a-z0-9][a-z0-9_\\-]{2,19}";
		const vorname = UI.feld({ id: "einladen-vorname", label: "Vorname", optional: true, autocomplete: "off" });
		const wahl = rollenWahl(["spieler"]);
		const einladen = UI.aufklappen({ id: "einladen", titel: "Person einladen", inhalt: UI.formular({ absenden: "Einladen",
			inhalt: [mail, name, vorname, UI.stapel([UI.text("Rollen", { tag: "strong" }), wahl.el], { abstand: "s" }),
				leise("Eingeladene kommen erst rein, wenn ihre E-Mail in Cloudflare steht (scripts/cloudflare.py abgleichen am Mac).")],
			onabsenden: async () => {
				const r = await api("POST", "/personen", { email: mail.wert, name: name.wert, vorname: vorname.wert || null, rollen: wahl.werte() });
				location.hash = "#person/" + r.person.handle;
				meldung(`${r.person.handle} eingeladen. Nächster Schritt: am Mac „python3 scripts/cloudflare.py abgleichen“, dann hier „Einladung senden“.`);
				if (r.passwort) setTimeout(() => $("inhalt").prepend(passwortKarte(r.person.handle, r.passwort)), 300);
			} }) });

		const sichtbar = d.personen.filter((p) => !RAUS(p.status));
		const inaktiv = (p) => p.status !== "eingeladen" && !p.nieAngemeldet && tageHer(p.zuletzt) > 30;
		// Kachel „aktiv in 30 Tagen“ filtert seit 1.5.0 wirklich (vorher zeigte sie alle, Seb 10.11.)
		const aktiv = (p) => !p.nieAngemeldet && !!p.zuletzt && tageHer(p.zuletzt) <= 30;
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
		// Klein oben rechts, ohne Autofokus (Seb, 10.11.): sonst sprang der Cursor hinein und Safari bot sofort E-Mail-Adressen an
		const suche = UI.suche({ id: "crm-suche", platzhalter: "Nr., Name, @handle …", label: "Person suchen", wert: crmFilter.q, verzoegerung: 0,
			oninput: (w) => { crmFilter.q = w; liste.zeilenSetzen(treffer()); } });
		suche.eingabe.title = "Nummer (P-0003), Name, @handle (auch frühere) oder Login-Adresse – Enter öffnet die Karte, wenn es genau einen Treffer gibt";
		suche.eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") { const t = treffer(); if (t.length === 1) location.hash = personLink(t[0]); } });
		const mitCf = d.cloudflare.geprueft;
		const spalten = [
			{ titel: "Nr.", wert: (p) => pnr(p.nr), mono: true, sortierbar: true },
			{ titel: "Person", sortWert: (p) => anzeigePerson(p) || p.handle || "", wert: (p) => UI.leiste([UI.avatar({ name: p.anzeigename || p.handle || "?", groesse: "s" }),
				unter(link(personLink(p), p.status === "geloescht" ? "gelöschte Person" : (anzeigePerson(p) || "@" + p.handle)),
					p.status !== "geloescht" && anzeigePerson(p) ? leise("@" + p.handle) : null,
					p.alteHandles && p.alteHandles.length ? leise("früher @" + p.alteHandles.join(", @")) : null)]), sortierbar: true },
			{ titel: "E-Mail", wert: (p) => p.emails.join(", ") || "–" },
			{ titel: "Rollen", wert: (p) => UI.leiste(p.rollen.length <= 1 ? [rolleMarke("spieler")] : p.rollen.filter((r) => r !== "spieler").map(rolleMarke)) },
			{ titel: "Status", sortWert: (p) => p.status, sortierbar: true, wert: (p) => unter(statusMarke(p.status),
				p.status === "eingeladen" ? leise(p.einladungGesendet ? "Mail " + datumZeit(p.einladungGesendet) : "noch keine Mail") : null) },
			{ titel: "Zuletzt aktiv", sortierbar: true, sortWert: (p) => p.zuletzt || "", wert: (p) => p.nieAngemeldet && !RAUS(p.status)
				? h("span", { title: "Noch keine Anmeldung, kein Spielstand, kein Upload. Kommt der E-Mail-Code nicht an? Dann fehlt die Adresse meist in der Cloudflare-Richtlinie „Kollegen“." },
					UI.marke({ text: "noch nie angemeldet", art: "warnung", klein: true }))
				: unter(datumZeit(p.zuletzt), tageHer(p.zuletzt) > 30 && p.zuletzt ? leise(`vor ${tageHer(p.zuletzt)} Tagen`) : null) },
			...(mitCf ? [{ titel: "Cloudflare", wert: (p) => !p.cloudflare ? "" : !p.cloudflare.kollegen ? UI.marke({ text: "fehlt in Kollegen", art: "warnung", klein: true })
				: p.cloudflare.entwickler === false ? UI.marke({ text: "fehlt in Entwickler", art: "warnung", klein: true }) : UI.marke({ text: "ok", art: "erfolg", punkt: true, klein: true }) }] : []),
		];
		const liste = UI.tabelle({ titel: "Personen", spalten, zeilen: treffer(), schluessel: "handle", onzeile: (p) => { location.hash = personLink(p); },
			leer: "Keine Person passt zur Suche." });
		const neuZeigen = () => { c.replaceChildren(); personenSeite(c); };
		const kachel = (wert, label, f) => UI.kennzahl({ wert, label, onclick: () => { Object.assign(crmFilter, { rolle: "", status: "", inaktiv: false, aktiv: false }, f); neuZeigen(); } });
		const chip = (text, an, setzen) => UI.marke({ text, an, onclick: () => { setzen(); neuZeigen(); } });
		const filterAn = crmFilter.rolle || crmFilter.status || crmFilter.inaktiv || crmFilter.aktiv;
		c.append(UI.abschnitt({ titel: `CRM (${sichtbar.length})`, aktionen: [suche], inhalt: UI.stapel([
			UI.raster([
				kachel(sichtbar.length, "Personen", {}),
				kachel(sichtbar.filter(aktiv).length, "aktiv in 30 Tagen", { aktiv: true }),
				kachel(sichtbar.filter((p) => p.status === "eingeladen").length, "eingeladen", { status: "eingeladen" }),
				kachel(sichtbar.filter((p) => ["verwarnt", "gesperrt"].includes(p.status)).length, "verwarnt oder gesperrt", { status: "auffaellig" }),
				kachel(sichtbar.filter(inaktiv).length, "seit 30 Tagen nicht da", { inaktiv: true })], { art: "kennzahlen" }),
			UI.leiste([leise("Rolle:"),
				...d.rollen.map((r) => chip(ROLLEN_TEXT[r], crmFilter.rolle === r, () => { crmFilter.rolle = crmFilter.rolle === r ? "" : r; })),
				leise("Status:"),
				...d.status.map((s) => chip(STATUS_TEXTE[s], crmFilter.status === s, () => { crmFilter.status = crmFilter.status === s ? "" : s; })),
				chip("aktiv in 30 Tagen", crmFilter.aktiv, () => { crmFilter.aktiv = !crmFilter.aktiv; if (crmFilter.aktiv) crmFilter.inaktiv = false; }),
				chip("seit 30 Tagen nicht da", crmFilter.inaktiv, () => { crmFilter.inaktiv = !crmFilter.inaktiv; if (crmFilter.inaktiv) crmFilter.aktiv = false; }),
				filterAn ? UI.knopf({ art: "leise", groesse: "s", ikon: "schliessen", text: "Filter löschen",
					onclick: () => { Object.assign(crmFilter, { rolle: "", status: "", inaktiv: false, aktiv: false }); neuZeigen(); } }) : null]),
			liste, einladen, cloudflareBox(cf),
			d.mail ? null : leise("E-Mail-Versand nicht eingerichtet (SMTP_* in der .env) – Einladungen dann selbst verschicken."),
			UI.leiste([UI.knopf({ art: "leise", groesse: "s", href: "#protokoll", text: "Prüfprotokoll aller Änderungen", ikon: "verlauf", ikonRechts: "winkel-rechts" })])]) }));
		const anmeldungen = await api("GET", "/anmeldungen");
		c.append(UI.abschnitt({ id: "anmeldungen", titel: "Letzte Anmeldungen",
			untertitel: "Je Cloudflare-Sitzung und Gerät. Unbekanntes Gerät? „Trennen“ meldet es bei der nächsten Anfrage ab (neuer E-Mail-Code nötig).",
			inhalt: anmeldungen.length ? anmeldeTabelle(anmeldungen, true, (a) => sicher(async () => {
				if (!await UI.bestaetigen({ titel: "Anmeldung beenden?", gefahr: true, ja: "Trennen", text: `Anmeldung von ${a.player} („${a.geraet}“) beenden? Das Gerät wird beim nächsten Klick abgemeldet.` })) return;
				await api("POST", "/anmeldungen/trennen", { player: a.player, sitzung: a.sitzung }); meldung(`${a.player}: ${a.geraet} getrennt.`); zeigen();
			})) : UI.leer({ klein: true, titel: "Noch keine Anmeldungen aufgezeichnet" }) }));
	}

	async function personSeite(c, name) {
		const p = await api("GET", "/personen/" + encodeURIComponent(name));
		// Für alle weiteren Aufrufe die Nummer: gilt auch für gelöschte Personen und nach einem Handle-Wechsel
		const pfad = "/personen/" + encodeURIComponent(pnr(p.nr) || p.name);
		const wer = p.status === "geloescht" ? "gelöschte Person" : "@" + p.handle;
		const neu = () => zeigen();
		// Zusatzdaten (Profil, Spiele, Anfragen) parallel – fehlt eins, fehlt nur der Block
		const [profil, spiele, anfragen] = await Promise.all([
			p.status === "geloescht" ? null : Bridge.json("GET", "/api/profil/" + encodeURIComponent(p.handle)).catch(() => null),
			api("GET", "/spiele").catch(() => []), api("GET", "/antraege").catch(() => [])]);
		// Gelöschte heißen alle „gelöschte Person“ – Spiele und Anfragen lassen sich ihnen nicht mehr zuordnen (auch für den Admin anonym)
		const meins = (x) => p.status !== "geloescht" && x === p.handle;
		const eigeneSpiele = spiele.filter((s) => meins(s.author));
		const gestellt = anfragen.filter((a) => meins(a.player));
		const bekommen = anfragen.filter((a) => meins(a.zustaendig) && a.player !== p.handle);
		const gespielt = profil ? profil.spiele : [];

		// Kopf
		const zahlen = [[profil && profil.sekunden ? dauer(profil.sekunden) : 0, "Spielzeit"], [gespielt.length, "gespielt"], [eigeneSpiele.length, "eigene Spiele"],
			[gestellt.length + bekommen.length, "Anfragen"]].filter((z) => z[0]);
		const titel = p.status === "geloescht" ? "gelöschte Person" : (anzeigePerson(p) || "@" + p.handle);
		c.append(UI.leiste([UI.knopf({ art: "leise", groesse: "s", href: "#personen", ikon: "winkel-links", text: "CRM", titel: "Zurück zum CRM – die Suche bleibt erhalten" })]),
			UI.karte({ id: "crm-kopf", ebene: "h2", titel,
				untertitel: [p.status !== "geloescht" && anzeigePerson(p) ? "@" + p.handle : null, pnr(p.nr), "dabei seit " + datumZeit(p.angelegt).split(",")[0],
					p.erste_anmeldung ? null : "noch nie angemeldet"].filter(Boolean).join(" · "),
				aktionen: [statusMarke(p.status, "person-status")],
				inhalt: UI.leiste([UI.avatar({ name: p.anzeigename || p.handle || "?", groesse: "l" }),
					...p.rollen.map(rolleMarke),
					p.notfallAdmin ? UI.marke({ text: "Notfall-Admin (ADMINS)", art: "warnung", klein: true }) : null,
					p.alteHandles && p.alteHandles.length ? leise("früher @" + p.alteHandles.join(", @") + " (reserviert, leitet weiter)") : null,
					...zahlen.map(([w, t]) => UI.marke({ text: `${w} ${t}` }))]) }),
			p.status === "gesperrt" ? UI.hinweis({ art: "gefahr", text: `Gesperrt: ${p.sperrgrund || "–"}${p.gesperrt_bis ? " · bis " + datumZeit(p.gesperrt_bis) : " · unbefristet"}. Aus Cloudflare entfernt das erst „python3 scripts/cloudflare.py abgleichen --entfernen“ am Mac – hinein kommt die Person aber schon jetzt nicht mehr.` }) : null,
			p.status === "eingeladen" && !p.erste_anmeldung ? UI.hinweis({ art: "warnung", text: `Eingeladen${p.einladung_gesendet ? " (Mail " + datumZeit(p.einladung_gesendet) + ")" : ""}, hat sich noch nie angemeldet. Häufigster Grund: Der E-Mail-Code kommt nicht an – dann fehlt die Adresse in der Cloudflare-Richtlinie „Kollegen“.` }) : null,
			p.status === "geloescht" ? UI.hinweis({ art: "info", text: "Endgültig gelöscht (anonymisiert). Überall – auch hier im Admin-Bereich – steht „gelöschte Person“, das frühere Handle ist für niemanden mehr frei. Erreichbar nur noch über die Nummer " + pnr(p.nr) + "." }) : null);

		// Schnellaktionen
		const schnell = [];
		if (!RAUS(p.status)) schnell.push(knopf("Handle ändern …", async () => {
			const neuesHandle = await UI.eingabe({ titel: "Handle ändern", ja: "Ändern", label: "Neues Handle", wert: p.handle,
				hinweis: "3–20 Zeichen: a–z, 0–9, _ und -. Als Admin ohne 30-Tage-Frist. Das alte bleibt für die Person reserviert, alte Links leiten weiter." });
			if (!neuesHandle || neuesHandle === p.handle) return;
			const r = await api("POST", pfad + "/handle", { handle: neuesHandle });
			location.hash = "#person/" + r.handle; meldung(`Handle geändert: @${p.handle} → @${r.handle}.`);
		}, "standard", { ikon: "bearbeiten" }));
		schnell.push(knopf("Auskunft (Export)", async () => {
			const daten = await api("GET", pfad + "/export");
			const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(daten, null, 2)], { type: "application/json" })), download: `auskunft-${pnr(p.nr) || p.handle}.json` });
			document.body.append(a); a.click(); a.remove();
		}, "standard", { ikon: "herunterladen" }));
		if (p.uploadKonto) schnell.push(knopf("Neues Upload-Passwort", async () => {
			if (!await UI.bestaetigen({ titel: "Neues Upload-Passwort?", ja: "Neues Passwort", text: `Neues Upload-Passwort für ${wer}? Das alte gilt sofort nicht mehr.` })) return;
			const r = await api("POST", `/entwickler/${encodeURIComponent(p.handle)}/passwort`); $("inhalt").prepend(passwortKarte(p.handle, r.passwort)); scrollTo(0, 0);
		}, "standard", { ikon: "schloss" }));
		c.append(UI.leiste(schnell));

		const bloecke = [];
		const block = (titel, ...inhalt) => UI.karte({ titel, inhalt: UI.stapel(inhalt) });

		// Stammdaten (immer – hier wird auch korrigiert)
		if (p.status !== "geloescht") {
			const tag = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
			const f = {
				anzeigename: UI.feld({ label: "Anzeigename", wert: p.anzeigename || "", max: "40" }),
				vorname: UI.feld({ label: "Vorname", wert: p.vorname || "", max: "60" }),
				nachname: UI.feld({ label: "Nachname", wert: p.nachname || "", max: "60" }),
				geburtstag: UI.feld({ label: "Geburtstag", typ: "date", wert: p.geburtstag || "", min: "1900-01-01" }),
				angelegt: UI.feld({ label: "Angelegt am", typ: "date", wert: p.angelegt ? tag(p.angelegt) : "", min: "2020-01-01",
					hinweis: "Wann das Konto angelegt wurde – „dabei seit“ im Profil. Korrigieren, wenn du es besser weißt." }),
			};
			f.geburtstag.eingabe.max = new Date().toISOString().slice(0, 10);
			f.angelegt.eingabe.max = tag(new Date().toISOString());
			bloecke.push(UI.karte({ titel: "Stammdaten", inhalt: UI.formular({ id: "stammdaten", absenden: "Speichern",
				inhalt: [f.anzeigename, f.vorname, f.nachname, f.geburtstag, f.angelegt,
					leise(`Nummer ${pnr(p.nr)} · Handle @${p.handle}${p.handle_seit ? " (geändert " + datumZeit(p.handle_seit) + ")" : ""} · Spieleordner ${p.alt_name || p.handle} · angelegt ${datumZeit(p.angelegt)}${p.eingeladen_von ? " von " + p.eingeladen_von : ""} · erste Anmeldung ${datumZeit(p.erste_anmeldung)} · Datenschutzhinweis ${p.datenschutz_bestaetigt ? "bestätigt " + datumZeit(p.datenschutz_bestaetigt) : "noch nicht bestätigt"}`)],
				onabsenden: async () => {
					const daten = { anzeigename: f.anzeigename.wert, vorname: f.vorname.wert, nachname: f.nachname.wert, geburtstag: f.geburtstag.wert || null };
					if (f.angelegt.wert && f.angelegt.wert !== tag(p.angelegt)) daten.angelegt = f.angelegt.wert;
					await api("PATCH", pfad, daten); meldung("Gespeichert."); await neu();
				} }) }));
		}

		// Notizen (nur Admin) – Eingabe immer, Liste nur wenn vorhanden
		const notiz = UI.textbereich({ id: "notiz-text", label: "Neue Notiz", zeilen: 2, max: "4000", platzhalter: "Interne Notiz – sieht nur der Admin" });
		bloecke.push(block("Notizen (nur für Admins)", notiz,
			UI.leiste([knopf("Notiz speichern", async () => { await api("POST", pfad + "/notizen", { text: notiz.wert }); meldung("Notiz gespeichert."); neu(); })]),
			p.notizen.length ? UI.liste(p.notizen.map((n) => ({ titel: n.text, text: `${datumZeit(n.zeit)} · ${n.von}` })), { ohneRahmen: true }) : null));

		// Login-E-Mails
		const neueMail = UI.feld({ typ: "email", label: "Weitere Login-E-Mail", platzhalter: "name@beispiel.de", autocomplete: "off" });
		if (p.emails.length || !RAUS(p.status)) bloecke.push(block("Login-E-Mails",
			UI.liste(p.emails.map((m) => ({ titel: m, rechts: p.emails.length > 1 ? knopf("Entfernen", async () => {
				if (!await UI.bestaetigen({ titel: "E-Mail entfernen?", gefahr: true, ja: "Entfernen", text: `${m} entfernen? Mit dieser Adresse kommt ${wer} dann nicht mehr hinein.` })) return;
				await api("DELETE", `${pfad}/emails/${encodeURIComponent(m)}`); meldung("E-Mail entfernt."); neu();
			}, "gefahr-leise") : null })), { ohneRahmen: true }),
			!RAUS(p.status) ? UI.stapel([neueMail, UI.leiste([knopf("Hinzufügen", async () => {
				await api("POST", pfad + "/emails", { email: neueMail.wert }); meldung("E-Mail hinzugefügt – danach Cloudflare-Abgleich am Mac."); neu();
			}, "standard", { ikon: "plus" })])], { abstand: "s" }) : null));

		// Rollen
		if (!RAUS(p.status)) {
			const wahl = rollenWahl(p.rollen, p.notfallAdmin ? ["admin"] : []);
			bloecke.push(block("Rollen", wahl.el,
				leise((p.ordner && !p.rollen.includes("entwickler") ? "Hat noch einen Spieleordner (die Spiele bleiben), aber keine Entwickler-Rechte. " : "") + "Entwickler bekommt ein Upload-Konto (Passwort wird einmal angezeigt), ohne Entwickler wird es entfernt – die Spiele bleiben. Tester: sieht auf dem Testserver das Tester-Panel und bekommt eine Glocke, wenn neue Tests anstehen."),
				UI.leiste([knopf("Rollen speichern", async () => {
					const r = await api("PUT", pfad + "/rollen", { rollen: wahl.werte() });
					await neu();
					meldung(r.dazu.length || r.weg.length ? `Rollen geändert: ${[...r.dazu.map((x) => "+" + ROLLEN_TEXT[x]), ...r.weg.map((x) => "−" + ROLLEN_TEXT[x])].join(", ")}.` + (r.hinweis ? " " + r.hinweis : "") : "Keine Änderung.");
					if (r.passwort) $("inhalt").prepend(passwortKarte(p.handle, r.passwort));
				}, "primaer")])));
		}

		// Status und Maßnahmen
		const grund = UI.feld({ id: "massnahme-grund", label: "Grund", platzhalter: "Grund (sieht die Person)", max: "500", hinweis: "Pflicht fürs Verwarnen und Sperren." });
		const bis = UI.feld({ typ: "datetime-local", label: "Gesperrt bis", optional: true, hinweis: "Nur fürs Sperren, leer = unbefristet." });
		const aktionen = [];
		if (p.status === "eingeladen" || (p.status !== "gesperrt" && !RAUS(p.status) && !p.erste_anmeldung)) {
			const senden = async (ohnePruefung) => { await api("POST", pfad + "/einladung", { ohnePruefung }); meldung(`Einladung an ${p.emails[0]} verschickt.`); neu(); };
			aktionen.push(knopf(p.einladung_gesendet ? "Einladung erneut senden" : "Einladung senden", async () => {
				try { await senden(false); } catch (e) {
					if (e.status === 409 && e.message.includes("trotzdem senden") && await UI.bestaetigen({ titel: "Trotzdem senden?", ja: "Trotzdem senden",
						text: e.message + " Steht die E-Mail sicher in Cloudflare? Dann trotzdem senden." })) return senden(true);
					throw e;
				}
			}, "primaer", { ikon: "nachricht" }));
		}
		if (["aktiv", "eingeladen", "verwarnt"].includes(p.status)) aktionen.push(knopf("Verwarnen", async () => {
			if (!grund.wert.trim()) { grund.fehlerSetzen("Erst einen Grund eintragen."); return meldung("Erst einen Grund eintragen.", true); }
			await api("POST", pfad + "/verwarnen", { grund: grund.wert }); meldung(`${wer} verwarnt – die Meldung steht in der Glocke.`); neu();
		}, "standard", { ikon: "warnung" }));
		if (p.status === "verwarnt") aktionen.push(knopf("Verwarnung aufheben", async () => { await api("POST", pfad + "/verwarnung-aufheben"); meldung("Verwarnung aufgehoben."); neu(); }));
		if (!p.notfallAdmin && !RAUS(p.status) && p.status !== "gesperrt") aktionen.push(knopf("Sperren", async () => {
			if (!grund.wert.trim()) { grund.fehlerSetzen("Erst einen Grund eintragen."); return meldung("Erst einen Grund eintragen.", true); }
			if (!await UI.bestaetigen({ titel: `${wer} sperren?`, gefahr: true, ja: "Sperren", text: "Gilt sofort für Bibliothek und Upload." })) return;
			await api("POST", pfad + "/sperren", { grund: grund.wert, bis: bis.wert ? new Date(bis.wert).toISOString() : null }); meldung(`${wer} gesperrt.`); neu();
		}, "gefahr-leise", { ikon: "schloss" }));
		if (p.status === "gesperrt") aktionen.push(knopf("Entsperren", async () => { await api("POST", pfad + "/entsperren"); meldung("Entsperrt."); neu(); }));
		if (!p.notfallAdmin && !RAUS(p.status)) aktionen.push(knopf("Archivieren …", async () => {
			if (!await UI.bestaetigen({ titel: `${wer} archivieren?`, gefahr: true, ja: "Archivieren",
				text: "Kein Zugang mehr (auch kein Upload), die Person verschwindet aus der Liste. Alle Daten bleiben – „Wiederherstellen“ holt sie jederzeit zurück." })) return;
			await api("POST", pfad + "/archivieren"); meldung(`${wer} archiviert – rückgängig mit „Wiederherstellen“.`); neu();
		}, "gefahr-leise", { ikon: "ordner" }));
		if (p.status === "archiviert") {
			aktionen.push(knopf("Wiederherstellen", async () => {
				const r = await api("POST", pfad + "/wiederherstellen");
				await neu();
				meldung(`${wer} wiederhergestellt – Status ${STATUS_TEXTE[r.person.status]}.` + (r.passwort ? " Neues Upload-Passwort siehe oben." : ""));
				if (r.passwort) { $("inhalt").prepend(passwortKarte(p.handle, r.passwort)); scrollTo(0, 0); }
			}, "primaer"));
			aktionen.push(knopf("Endgültig löschen (anonymisieren) …", async () => {
				const b = await UI.eingabe({ titel: `${wer} endgültig löschen?`, gefahr: true, ja: "Endgültig löschen", label: `Zur Bestätigung das Handle eingeben (${p.handle})`,
					text: "Name, Geburtstag, E-Mails, Notizen und Rollen werden gelöscht – an Spielständen und in Bestenlisten steht danach „gelöschte Person“. Das lässt sich NICHT rückgängig machen. Gedacht z. B., wenn die Person die Löschung ihrer Daten verlangt.",
					pruefen: (w) => (w.replace(/^@/, "") === p.handle ? "" : "Das Handle stimmt nicht.") });
				if (b === null) return;
				await api("POST", pfad + "/loeschen", { bestaetigung: b.trim().replace(/^@/, "") }); meldung(`${wer} endgültig gelöscht.`); neu();
			}, "gefahr", { ikon: "loeschen" }));
		}
		if (aktionen.length) bloecke.push(block("Status und Maßnahmen", grund, bis, UI.leiste(aktionen)));

		// Spiele, gespielt, Anfragen – nur wenn es etwas gibt
		if (eigeneSpiele.length) bloecke.push(block(`Eigene Spiele (${eigeneSpiele.length})`, UI.liste(eigeneSpiele.map((s) => ({ titel: s.title, href: "#spiele", ikon: "spiel",
			text: `${s.version || "Entwurf"} · ${s.spieler || 0} Spieler · ${dauer(s.spielzeit || 0)} gespielt` + (s.testspiel ? " · Testspiel" : "") + (s.offline ? " · offline" : "") })), { ohneRahmen: true })));
		if (gespielt.length) bloecke.push(block(`Gespielt (${gespielt.length})`, tabelle(["Spiel", "von", "Spielzeit", "Platz", "Erfolge"], gespielt.map((s) => [
			s.title, s.author ? link("#person/" + s.author, "@" + s.author) : "–", dauer(s.sekunden), s.platz ? s.platz + "." : "–",
			s.erfolgeGesamt ? `${s.erfolge.length}/${s.erfolgeGesamt}` : "–"]))));
		const anfrageZeile = (a, gegenueber) => ({ titel: `#${a.id} · ${a.artText}${a.title ? " zu " + a.title : ""} ${gegenueber}`, href: "/#/antrag/" + a.id,
			text: `${datumZeit(a.erstellt)} · ${a.text.length > 120 ? a.text.slice(0, 120) + " …" : a.text}` });
		const anfrageMarke = (a) => UI.marke({ text: a.status, art: ANFRAGE_ART[a.status] || "neutral", punkt: true });
		if (gestellt.length || bekommen.length) bloecke.push(block("Anfragen",
			gestellt.length ? UI.stapel([stark(`Gestellt (${gestellt.length})`), UI.liste(gestellt.map((a) => ({ ...anfrageZeile(a,
				a.zustaendig && a.zustaendig !== "admin" ? "→ @" + a.zustaendig : "→ Seb"), rechts: anfrageMarke(a) })), { ohneRahmen: true })], { abstand: "s" }) : null,
			bekommen.length ? UI.stapel([stark(`Als Entwickler bekommen (${bekommen.length}, ${bekommen.filter((a) => a.status === "offen").length} offen)`),
				UI.liste(bekommen.map((a) => ({ ...anfrageZeile(a, "von @" + a.player), rechts: anfrageMarke(a) })), { ohneRahmen: true })], { abstand: "s" }) : null,
			leise("Ab 1.6.0 stehen hier die Tickets.")));

		if (p.anmeldungen.length) bloecke.push(block(`Anmeldungen (${p.anmeldungen.length})`, anmeldeTabelle(p.anmeldungen, false, (a) => sicher(async () => {
			if (!await UI.bestaetigen({ titel: "Anmeldung beenden?", gefahr: true, ja: "Trennen", text: `Anmeldung „${a.geraet}“ beenden?` })) return;
			await api("POST", "/anmeldungen/trennen", { player: p.handle, sitzung: a.sitzung }); meldung("Getrennt."); neu();
		}))));
		if (p.sicherheit.length) bloecke.push(block(`Sicherheitsprotokoll (${p.sicherheit.length})`,
			tabelle(["Zeit", "Art", ""], p.sicherheit.map((z) => [datumZeit(z.zeit), z.art, z.text]))));
		const breit = p.zeitleiste.length ? [block("Zeitleiste", tabelle(["Zeit", "Was", ""], p.zeitleiste.map((z) => [datumZeit(z.zeit), z.art, z.text + (z.von ? ` (${z.von})` : "")])))] : [];
		c.append(UI.mauer(bloecke, { breit, id: "crm-bloecke" }));
		if (p.protokoll.length) c.append(UI.aufklappen({ titel: `Prüfprotokoll zu ${wer} (${p.protokoll.length})`, inhalt: protokollTabelle(p.protokoll) }));
	}

	function protokollTabelle(liste) {
		const kurz = (x) => x === null || x === undefined ? "" : String(x).length > 120 ? String(x).slice(0, 120) + " …" : String(x);
		return UI.tabelle({ titel: "Prüfprotokoll", zeilen: liste, spalten: [
			{ titel: "Zeit", wert: (z) => datumZeit(z.zeit) }, { titel: "Wer", feld: "von" }, { titel: "Aktion", feld: "aktion" },
			{ titel: "Person", wert: (z) => z.ziel ? link("#person/" + z.ziel, "@" + z.ziel) : "" },
			{ titel: "Vorher", wert: (z) => kurz(z.vorher), leise: true }, { titel: "Nachher", wert: (z) => kurz(z.nachher) }] });
	}
	async function protokollSeite(c) {
		c.append(UI.leiste([UI.knopf({ art: "leise", groesse: "s", href: "#personen", ikon: "winkel-links", text: "CRM" })]),
			abschnitt("Prüfprotokoll", [leise("Jede Änderung an Personen – wer, was, wann, vorher und nachher. Wird nie gelöscht."), protokollTabelle(await api("GET", "/protokoll"))]));
	}

	// Cloudflare-Abgleich (1.3.0): nur anzeigen – geschrieben wird am Mac mit scripts/cloudflare.py (Schreib-Schlüssel nie auf der NAS)
	function cloudflareBox(cf) {
		if (!cf.eingerichtet) return leise("Cloudflare-Abgleich nicht eingerichtet (docs/cloudflare-abgleich.md) – ob die E-Mails in den Cloudflare-Richtlinien stehen, wird nicht geprüft. Nach dem Anlegen am Mac: scripts/cloudflare.py abgleichen.");
		if (cf.fehler) return UI.hinweis({ art: "warnung", text: "Cloudflare-Abgleich: " + cf.fehler });
		const zeilen = [];
		for (const r of cf.richtlinien) {
			for (const x of r.bedenken) zeilen.push(`${r.name}: ${x}`);
			for (const m of r.fehlt) zeilen.push(`${r.name}: fehlt ${m} – bekommt keinen Code`);
			for (const m of r.zuviel) zeilen.push(`${r.name}: ${m} steht nur in Cloudflare, nicht in der Bibliothek`);
		}
		if (!zeilen.length) return UI.hinweis({ art: "erfolg", text: "Cloudflare-Richtlinien passen zur Benutzerliste." });
		return UI.hinweis({ art: "warnung", titel: "Cloudflare passt nicht zur Benutzerliste",
			inhalt: UI.stapel([UI.liste(zeilen.map((z) => ({ titel: z })), { ohneRahmen: true }),
				leise("Beheben am Mac: python3 scripts/cloudflare.py abgleichen (Entfernen nur mit --entfernen). Stand: alle 5 Minuten neu gelesen.")], { abstand: "s" }) });
	}

	// ---------- Spielstände ----------
	async function spielstaendeSeite(c, filter = {}) {
		const spieler = UI.feld({ label: "Spieler", platzhalter: "alle", wert: filter.player || "" });
		const spiel = UI.feld({ label: "Spiel", platzhalter: "z. B. seb/zaehler", wert: filter.game || "" });
		const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
		const liste = await api("GET", "/spielstaende" + (q.toString() ? "?" + q : ""));
		c.append(abschnitt("Spielstände", [
			UI.formular({ absenden: "Filtern", inhalt: [UI.raster([spieler, spiel], { art: "karten" })],
				onabsenden: async () => { c.replaceChildren(); await spielstaendeSeite(c, { player: spieler.wert.trim(), game: spiel.wert.trim() }); } }),
			tabelle(["Spieler", "Spiel", "Key", "Größe", "saveVersion", "Geändert", ""], liste.map((s) => [
				s.player, unter(s.title, leise(s.game)), UI.code(s.key), groesse(s.bytes), String(s.version), datumZeit(s.updatedAt),
				knopf("Ansehen", () => spielstandDetail(c, s, filter), "standard", { ikonRechts: "winkel-rechts" })]), { titel: "Spielstände" })]));
	}

	async function spielstandDetail(c, s, filter) {
		const q = new URLSearchParams({ player: s.player, game: s.game, key: s.key });
		const d = await api("GET", "/spielstand?" + q);
		c.replaceChildren(
			UI.leiste([UI.knopf({ art: "leise", groesse: "s", ikon: "winkel-links", text: "Spielstände", onclick: () => { c.replaceChildren(); sicher(() => spielstaendeSeite(c, filter)); } })]),
			abschnitt(`${s.player} · ${s.title} · ${s.key}`, [
				UI.karte({ titel: "Aktuell", untertitel: d.aktuell ? `saveVersion ${d.aktuell.version}, ${datumZeit(d.aktuell.updatedAt)}` : "gelöscht",
					inhalt: d.aktuell ? UI.stapel([UI.code(JSON.stringify(d.aktuell.data, null, 1), { block: true }),
						UI.leiste([knopf("Spielstand löschen", async () => {
							if (!await UI.bestaetigen({ titel: "Spielstand löschen?", gefahr: true, ja: "Löschen", text: "Er landet im Verlauf und lässt sich von dort wiederherstellen." })) return;
							await api("DELETE", "/spielstand?" + q); spielstandDetail(c, s, filter);
						}, "gefahr-leise", { ikon: "loeschen" })])]) : null })]),
			abschnitt("Verlauf (die letzten 5 alten Stände)", d.verlauf.length ? d.verlauf.map((v) => UI.karte({
				titel: datumZeit(v.savedAt), untertitel: `saveVersion ${v.version}`,
				aktionen: [knopf("Wiederherstellen", async () => {
					if (!await UI.bestaetigen({ titel: "Diesen Stand wiederherstellen?", ja: "Wiederherstellen", text: "Der aktuelle Stand landet im Verlauf." })) return;
					await api("POST", "/spielstand/wiederherstellen", { id: v.id }); meldung("Wiederhergestellt."); spielstandDetail(c, s, filter);
				})],
				inhalt: UI.code(JSON.stringify(v.data, null, 1), { block: true }) })) : [UI.leer({ klein: true, titel: "Kein Verlauf" })]));
	}

	// ---------- Anfragen ----------
	const ANFRAGE_ART = { offen: "warnung", erledigt: "erfolg", abgelehnt: "gefahr" };
	async function antraegeSeite(c) {
		const alle = await api("GET", "/antraege");
		// 1.3.0: Hier nur, was der Admin erledigt (Bibliothek). Anfragen zu Spielen bearbeitet deren Entwickler – nur zur Info, ohne Zahl.
		const liste = alle.filter((a) => a.zustaendig === "admin"), spielAntraege = alle.filter((a) => a.zustaendig !== "admin");
		const status = (a) => UI.marke({ text: a.status, art: ANFRAGE_ART[a.status] || "neutral", punkt: true });
		c.append(abschnitt("Anfragen an die Bibliothek", liste.length ? liste.map((a) => {
			const antwort = UI.textbereich({ label: "Antwort an " + a.player, zeilen: 2, max: "4000", wert: a.antwort || "" });
			const setzen = (st) => api("PATCH", "/antraege/" + a.id, { status: st, antwort: antwort.wert || null }).then(() => { meldung(`Anfrage ${a.id}: ${st}.`); zeigen(); });
			return UI.karte({ titel: a.artText, untertitel: `von ${a.player}` + (a.spiel ? ` · ${a.title || a.spiel}` : "") + ` · ${datumZeit(a.erstellt)}`,
				aktionen: [status(a)],
				inhalt: UI.stapel([UI.text(a.text),
					UI.leiste([UI.knopf({ art: "leise", groesse: "s", href: "/#/antrag/" + a.id, ikon: a.bilder ? "bild" : null,
						text: a.bilder ? `Öffnen (${a.bilder} ${a.bilder === 1 ? "Bild" : "Bilder"})` : "Öffnen" })]),
					antwort,
					UI.leiste([knopf("Erledigt", () => setzen("erledigt"), "primaer", { ikon: "haken" }), knopf("Ablehnen", () => setzen("abgelehnt"), "gefahr-leise"),
						a.status !== "offen" ? knopf("Wieder öffnen", () => setzen("offen")) : null])]) });
		}) : [UI.leer({ klein: true, ikon: "nachricht", titel: "Keine Anfragen" })]));
		if (spielAntraege.length) {
			const offen = spielAntraege.filter((a) => a.status === "offen").length;
			c.append(UI.aufklappen({ titel: `Anfragen zu Spielen – bearbeitet der jeweilige Entwickler (${offen} offen, ${spielAntraege.length - offen} geschlossen, nur zur Info)`,
				inhalt: tabelle(["Spiel", "Entwickler", "Art", "Von", "Status", "Erstellt", "Text"], spielAntraege.map((a) => [
					a.title || a.spiel, a.zustaendig, a.artText, a.player, status(a), datumZeit(a.erstellt),
					unter(link("/#/antrag/" + a.id, a.text.length > 120 ? a.text.slice(0, 120) + " …" : a.text), a.bilder ? leise(`${a.bilder} ${a.bilder === 1 ? "Bild" : "Bilder"}`) : null)])) }));
		}
	}

	// ---------- Aufgaben (1.3.0): Tests per Knopf oder Zeitplan, Live-Deploy nach Freigabe ----------
	const STATUS_TEXT = { wartet: "wartet", laeuft: "läuft …", ok: "ok", fehler: "Fehler" };
	const LAUF_ART = { wartet: "neutral", laeuft: "info", ok: "erfolg", fehler: "gefahr" };
	async function aufgabenSeite(c) {
		const d = await api("GET", "/auftraege");
		const dienst = d.dienst;
		c.append(abschnitt("Auftragsdienst", [
			d.probe ? leise("Testserver: Der Auftragsdienst der NAS bedient nur die Live-Bibliothek – hier führt der Mac die Aufgaben aus.")
				: UI.hinweis({ art: !dienst.eingerichtet ? "warnung" : dienst.aktiv ? "erfolg" : "gefahr", text: !dienst.eingerichtet
					? "Noch nicht eingerichtet – Aufträge bleiben liegen. Einmalig am Mac: sh scripts/auftragsdienst-einrichten.sh (Cron-Job auf der NAS, jede Minute)."
					: dienst.aktiv ? `Läuft – zuletzt gemeldet ${datumZeit(dienst.zuletzt)} (Live-Stand ${dienst.version})`
						: `Meldet sich nicht mehr seit ${datumZeit(dienst.zuletzt)} – Cron-Job auf der NAS prüfen (crontab -l), Log: /tmp/sb-auftragsdienst.log` }),
			// 1.4.1: Tests laufen auf dem Mac, wenn er bereit ist (Docker Desktop, scripts/auftraege-mac.py) – im Testserver nur dort
			UI.hinweis({ art: d.mac.aktiv ? "erfolg" : d.probe ? "warnung" : "info", text: d.mac.aktiv
				? `Mac bereit (${d.mac.text || "Docker Desktop läuft"}, zuletzt ${datumZeit(d.mac.zuletzt)}) – Unit- und Ende-zu-Ende-Tests laufen dort, die NAS rechnet nichts.`
				: d.probe ? "Der Mac meldet sich gerade nicht (Docker Desktop aus oder Mac im Ruhezustand). Im Testserver laufen Aufgaben nur auf dem Mac – sie warten, bis er wieder da ist."
					: `Mac nicht bereit${d.mac.zuletzt ? " (zuletzt " + datumZeit(d.mac.zuletzt) + ")" : ""} – Tests laufen auf der NAS. Auf den Mac: Docker Desktop starten (einmalig: sh scripts/auftraege-mac-einrichten.sh).` }),
			leise("Der Dienst führt nur fest eingebaute Aufgaben aus. Live-Deploy passiert ausschließlich nach „Für Live freigeben“ in der Probe – nicht von hier.")]));

		// Jetzt starten + Zeitplan
		const plan = (art, ziel) => (d.zeitplan.find((z) => z.art === art && z.ziel === ziel) || {}).uhrzeit || "";
		const zeilen = [];
		for (const [art, artText] of Object.entries(d.arten)) for (const [ziel, zielText] of Object.entries(d.ziele)) {
			const uhr = UI.feld({ typ: "time", wert: plan(art, ziel), label: `Uhrzeit für ${artText} (${zielText})` });
			uhr.querySelector(".b-feld__label").classList.add("b-unsichtbar");
			zeilen.push([artText, zielText,
				knopf("Jetzt starten", async () => { await api("POST", "/auftraege", { art, ziel }); meldung(`${artText} (${zielText}) gestartet – Ergebnis unten.`); zeigen(); }, "standard", { ikon: "start" }),
				UI.leiste([knopf("Täglich", async () => {
					if (!uhr.wert) return meldung("Erst eine Uhrzeit wählen.", true);
					await api("PUT", "/zeitplan", { art, ziel, uhrzeit: uhr.wert }); meldung(`${artText} (${zielText}) läuft täglich um ${uhr.wert}.`); zeigen();
				}), plan(art, ziel) ? knopf("Aus", async () => { await api("PUT", "/zeitplan", { art, ziel, uhrzeit: null }); meldung("Zeitplan entfernt."); zeigen(); }, "gefahr-leise") : null,
				uhr])]);
		}
		c.append(abschnitt("Aufgaben", [
			leise("Auf dem Mac: Unit-Tests ca. 15 Sekunden, Ende-zu-Ende-Tests ca. 3 Minuten. Auf der NAS: ca. 8 bzw. 10 Minuten. Ende-zu-Ende läuft im Teststand, die echte Bibliothek wird nicht angefasst. „Live-Stand“ = was gerade live läuft, „Probe“ = was in der Probe zum Testen liegt. Bei Fehlern: rote Glocke und Home Assistant."),
			tabelle(["Aufgabe", "Ziel", "", "Zeitplan (täglich)"], zeilen, { titel: "Aufgaben" })]));

		// Verlauf – aktualisiert sich selbst, solange etwas läuft: nur diese Tabelle und nur bei Änderungen (1.4.1, Nachtest
		// 09.11.: vorher wurde die ganze Seite alle 15 s neu aufgebaut, sie sprang nach oben und flackerte)
		c.append(abschnitt("Letzte Läufe", [UI.stapel([laeufeTabelle(d)], { id: "laeufe" })]));
		if (laufend(d)) laeufeBeobachten(JSON.stringify(d.laeufe));
	}

	const laufend = (d) => d.laeufe.some((l) => l.status === "wartet" || l.status === "laeuft");
	const logOffen = (box) => !!box.querySelector(".b-code--block");
	let neuLadenZeit;
	function laeufeBeobachten(alt) {
		clearTimeout(neuLadenZeit);
		neuLadenZeit = setTimeout(async () => {
			const box = $("laeufe");
			if (location.hash !== "#aufgaben" || !box) return;
			if (logOffen(box)) return laeufeBeobachten(alt);       // offenes Log nicht zuklappen
			let d;
			try { d = await api("GET", "/auftraege"); } catch { return laeufeBeobachten(alt); }
			const neu = JSON.stringify(d.laeufe);
			if (neu !== alt && $("laeufe") === box && !logOffen(box)) box.replaceChildren(laeufeTabelle(d));
			if (laufend(d)) laeufeBeobachten(neu);
		}, 10000);
	}

	function laeufeTabelle(d) {
		if (!d.laeufe.length) return UI.leer({ klein: true, ikon: "verlauf", titel: "Noch keine Läufe" });
		return tabelle(["Aufgabe", "Ziel", "Auslöser", "Gestartet", "Dauer", "Status", "Ergebnis", ""], d.laeufe.map((l) => {
			const sek = l.start && l.ende ? Math.max(1, Math.round((new Date(l.ende) - new Date(l.start)) / 1000)) : null;
			const zelle = UI.stapel([], { abstand: "s" });
			return [d.anzeige[l.art] || l.art, d.ziele[l.ziel] || l.ziel,
				l.quelle === "plan" ? "Zeitplan" : l.quelle === "dienst" ? "Freigabe" : l.von || "Knopf",
				datumZeit(l.start || l.angelegt), sek ? (sek >= 60 ? Math.round(sek / 60) + " min" : sek + " s") : "",
				UI.marke({ text: STATUS_TEXT[l.status] || l.status, art: LAUF_ART[l.status] || "neutral", punkt: true }), l.zusammenfassung || "",
				l.ende ? unter(knopf("Log", async () => {
					if (logOffen(zelle)) return zelle.replaceChildren();
					const voll = await api("GET", "/auftraege/" + l.id);
					zelle.replaceChildren(UI.code(voll.log || "(leer)", { block: true }));
				}, "leise", { ikon: "datei" }), zelle) : ""];
		}), { titel: "Letzte Läufe" });
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
			if (logOffen(c) || document.querySelector("dialog[open]") || (document.activeElement && c.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)))
				return stillNeuLaden(hashes, ms);
			const y = scrollY;
			c.style.minHeight = c.offsetHeight + "px";   // beim Neuaufbau nicht kurz schrumpfen
			await zeigen();
			c.style.minHeight = "";
			scrollTo(0, y);
		}, ms);
	}

	// ---------- Gerüst und Navigation ----------
	const SEITEN = { uebersicht, spiele: spieleSeite, personen: personenSeite, protokoll: protokollSeite, spielstaende: spielstaendeSeite, antraege: antraegeSeite, aufgaben: aufgabenSeite };
	const leisteNav = UI.seitenleiste({ label: "Admin-Bereiche", gruppen: [{ eintraege: [
		{ id: "uebersicht", text: "Übersicht", ikon: "raster" },
		{ id: "spiele", text: "Spiele", ikon: "spiel" },
		{ id: "personen", text: "CRM", ikon: "personen" },
		{ id: "spielstaende", text: "Spielstände", ikon: "ordner" },
		{ id: "antraege", text: "Anfragen", ikon: "nachricht" },
		{ id: "aufgaben", text: "Aufgaben", ikon: "test" }] }] });
	leisteNav.id = "reiter";
	// Leere Teile (null/false) nie als Text „null“ einfügen – viele Seiten hängen bedingte Teile direkt an den Inhalt an
	// (1.4.1, Nachtest 09.11.: „null“ unter dem Namen einer Person und in der Personen-Liste)
	const behaelter = (o) => {
		const b = UI.stapel([], { abstand: "l", ...o });
		for (const m of ["append", "prepend", "replaceChildren"]) {
			const orig = b[m].bind(b);
			b[m] = (...kinder) => orig(...kinder.filter((k) => k !== null && k !== undefined && k !== false));
		}
		return b;
	};
	const inhalt = behaelter({ id: "inhalt" });
	const abgelaufen = UI.hinweis({ id: "abgelaufen", art: "warnung", titel: "Deine Anmeldung ist abgelaufen.", aktion: { text: "Seite neu laden", onclick: () => location.reload() } });
	abgelaufen.hidden = true;

	async function zeigen() {
		if (location.hash === "#benutzer" || location.hash === "#crm") return location.replace("#personen");   // alte Adresse (vor 1.4.0) / Kurzform
		const person = location.hash.match(/^#person\/([a-z0-9][a-z0-9_-]{0,31}|P-\d{1,6})$/);
		const name = person ? "personen" : SEITEN[location.hash.slice(1)] ? location.hash.slice(1) : "uebersicht";
		leisteNav.setzen(name === "protokoll" ? "personen" : name);
		inhalt.replaceChildren(UI.laden({ art: "skelett", zeilen: 4 }));
		const c = behaelter();
		await sicher(() => person ? personSeite(c, person[1]) : SEITEN[name](c));
		// Seiten, die sich selbst neu zeichnen (Detailansichten), schreiben in c – deshalb c selbst einhängen
		inhalt.replaceChildren(c);
		// Rückkehr aus „Ansicht als …“: an die alte Scrollposition (1.3.0)
		try {
			const y = sessionStorage.getItem("admin-scroll");
			if (y !== null) { sessionStorage.removeItem("admin-scroll"); requestAnimationFrame(() => scrollTo(0, Number(y) || 0)); }
		} catch { /* egal */ }
		sicher(async () => {
			const offen = (await api("GET", "/antraege")).filter((a) => a.status === "offen" && a.zustaendig === "admin").length;
			leisteNav.zahlSetzen("antraege", offen);
			// Aufgaben: Zahl = wie viele Aufgaben zuletzt fehlgeschlagen sind (je Aufgabe und Ziel der neueste Lauf)
			const auf = await api("GET", "/auftraege");
			const neueste = new Map();
			for (const l of auf.laeufe) if (!neueste.has(l.art + l.ziel)) neueste.set(l.art + l.ziel, l);
			leisteNav.zahlSetzen("aufgaben", [...neueste.values()].filter((l) => l.status === "fehler").length + (auf.dienst.eingerichtet && !auf.dienst.aktiv && !auf.probe ? 1 : 0));
		});
	}

	function geruest(ich) {
		const name = (ich && (ich.anzeigename || ich.player)) || "Konto";
		const konto = UI.knopf({ art: "leise", nurIkon: true, label: "Konto", id: "konto-knopf" });
		konto.append(UI.avatar({ name }));
		const kontoMenue = UI.menue({ ausloeser: konto, label: "Konto", id: "konto-menue", eintraege: [
			{ titel: ich && ich.player ? "Angemeldet als @" + ich.player : "Konto" },
			{ text: "Profil", ikon: "benutzer", href: "/#/profil" },
			{ text: "Einstellungen", ikon: "einstellungen", href: "/#/einstellungen" },
			"trenner",
			{ text: "Zur Bibliothek", ikon: "spiel", href: "/" },
			{ text: "Hilfe", ikon: "hilfe", href: "/hilfe/" }] });
		document.body.replaceChildren(
			UI.kopfleiste({ marke: { text: "Spielebibliothek · Admin", href: "/" }, rechts: [
				UI.knopf({ art: "leise", href: "/", ikon: "winkel-links", text: "Bibliothek" }), kontoMenue] }),
			UI.seite({ titel: "Admin-Panel", inhalt: [abgelaufen, UI.bereich({ leiste: leisteNav, inhalt })] }));
	}

	(async () => {
		Bridge.beiAblauf = () => { abgelaufen.hidden = false; };
		let ich = null;
		try { ich = await Bridge.json("GET", "/api/me"); } catch (e) { geruest(null); leisteNav.hidden = true; return meldung(e.message, true); }
		geruest(ich);
		// Aussehen wie in der Bibliothek (Thema, Farbe, Abstände) – gilt auf allen Geräten
		Bridge.json("GET", "/api/einstellungen").then((e) => { if (e && e.aussehen) UI.aussehenAnwenden(e.aussehen); }).catch(() => {});
		if (!ich.admin) {
			leisteNav.hidden = true;
			return inhalt.append(UI.leer({ ikon: "schloss", titel: "Kein Zugriff",
				text: ich.ansicht ? `„Ansicht als ${ich.ansicht === "spieler" ? "Spieler" : "Entwickler"}“ ist aktiv – das Admin-Panel ist gesperrt. Beenden über das Band oben in der Bibliothek.`
					: "Das Admin-Panel ist nur für Admins.", aktion: { text: "Zur Bibliothek", href: "/" } }));
		}
		addEventListener("hashchange", () => zeigen());
		zeigen();
	})();
})();
