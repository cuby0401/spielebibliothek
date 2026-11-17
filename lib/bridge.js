// Bridge der Bibliotheksseite: verbindet das Spiel-iframe (play.cuby0401.uk) mit dem Speicher-Dienst.
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/GameSave-Bibliothek, Entscheidungen E10/E14/E15
//
// Sicherheitsregeln:
// - Nachrichten nur von Origin play.cuby0401.uk UND nur aus iframes, die diese Seite selbst erzeugt hat.
// - Die Spiel-ID hängt am iframe-Fenster (bei der Erzeugung festgelegt), nie an der Nachricht.
// - Antworten gehen nur an das anfragende Fenster, mit targetOrigin play.cuby0401.uk.
"use strict";

const Bridge = (() => {
	const PLAY = "https://play.cuby0401.uk";
	const LS_KEY = "__ls";          // localStorage-Ersatz: ein Spielstand je Spiel
	const LS_VERZOEGERUNG = 1000;   // ms bündeln, bevor zum Server geschrieben wird
	const KEY_MUSTER = /^[A-Za-z0-9_][A-Za-z0-9._:-]{0,99}$/;

	const fenster = new WeakMap(); // iframe.contentWindow → Spiel-ID

	// „Ansicht als …“ (nur für Admins wirksam, der Server prüft): gilt für diesen Tab
	const ANSICHT_KEY = "ansicht-als";
	function ansicht() { try { return sessionStorage.getItem(ANSICHT_KEY); } catch { return null; } }
	const lsStand = new Map();     // Spiel-ID → { daten, timer, geaendert }
	let spieler = null;
	let beiAblauf = () => {};
	let beiWieder = () => {};
	let beiScore = () => {};
	let beiErfolg = () => {};

	const pfad = (id) => "/api/save/" + id.split("/").map(encodeURIComponent).join("/");

	class SitzungAbgelaufen extends Error {}

	// --- Zwischenspeicher bei abgelaufener Anmeldung oder fehlender Verbindung (05.11.2026) ---
	// Läuft die Cloudflare-Sitzung (1 Woche) mitten im Spiel ab, spielt der Spieler einfach weiter.
	// Alles, was das Spiel speichert (Spielstände, localStorage-Ersatz, Scores), landet dann im
	// localStorage dieser Seite (games.cuby0401.uk, nicht das Spiel) und wird nach der nächsten
	// Anmeldung nachgereicht – auch nach Schließen des Tabs oder Neustart des Browsers.
	// Ein später nachgereichter Stand überschreibt den Server-Stand; der alte landet im Verlauf.
	const PUFFER_PREFIX = "sb-puffer:";
	const NACHREICHEN_ALLE = 60000;          // ms: so oft wird bei vollem Puffer ein neuer Versuch gemacht
	const INAKTIV_NEU_LADEN = 30 * 60000;    // ms im Hintergrund bei abgelaufener Sitzung → neu anmelden
	const SCORES_MAX = 100;
	let abgelaufen = false;
	let sitzungBis = 0;                      // ms; aus /api/me. Eine Minute vorher wird schon zwischengespeichert.
	function ablaufPruefen() {
		if (!abgelaufen && sitzungBis && Date.now() > sitzungBis - 60000) ablaufMelden();
		return abgelaufen;
	}
	function ablaufMelden() {
		if (abgelaufen) return;
		abgelaufen = true;
		beiAblauf();
		clearTimeout(nachreichenTimer); nachreichenTimer = null;
		nachreichenPlanen();
	}
	let nachreichenTimer = null;
	let nachreichenLaeuft = false;
	let versteckt = 0;
	const geladen = new Map();   // URL → zuletzt geladene Daten (für load während der Sitzung abgelaufen ist)
	const saveVersionen = new Map();   // Spiel-ID → saveVersion

	// Schlüssel ist das Konto (Spieleordner, 1.5.0) – ändert sich nie, auch nicht mit dem Handle. Bis 1.4.1 war es der
	// Benutzername, der für alle bisherigen Konten gleich dem Ordnernamen ist: vorhandene Zwischenspeicher bleiben gültig.
	let konto = null;
	const pufferKey = () => PUFFER_PREFIX + (konto || spieler || "?") + ":" + (ansicht() || "");
	function pufferLesen(key = pufferKey()) {
		try {
			const p = JSON.parse(localStorage.getItem(key) || "null");
			if (p && typeof p === "object" && p.saves && Array.isArray(p.scores)) return p;
		} catch { /* kaputt → neu */ }
		return { saves: {}, scores: [] };
	}
	function pufferSchreiben(p, key = pufferKey()) {
		try {
			if (!Object.keys(p.saves).length && !p.scores.length) localStorage.removeItem(key);
			else localStorage.setItem(key, JSON.stringify(p));
			return true;
		} catch (e) {
			console.warn("Spielebibliothek: Zwischenspeicher voll", e);
			return false;
		}
	}
	// Spielstand (PUT) oder Löschen (DELETE) merken – je URL zählt nur das Letzte
	function puffern(methode, url, body) {
		const p = pufferLesen();
		p.saves[url] = { methode, body: body ?? null, zeit: Date.now() };
		const ok = pufferSchreiben(p);
		nachreichenPlanen();
		return ok;
	}
	function scorePuffern(url, body) {
		const p = pufferLesen();
		p.scores.push({ url, body, zeit: Date.now() });
		p.scores = p.scores.slice(-SCORES_MAX);
		const ok = pufferSchreiben(p);
		nachreichenPlanen();
		return ok;
	}
	function gepuffert(url) {
		const e = pufferLesen().saves[url];
		return e ? { data: e.methode === "PUT" ? e.body.data : null } : null;
	}
	const nichtErreichbar = (e) => e instanceof SitzungAbgelaufen || e instanceof TypeError;   // TypeError = keine Verbindung

	function nachreichenPlanen() {
		if (!nachreichenTimer) nachreichenTimer = setTimeout(() => { nachreichenTimer = null; nachreichen(); }, NACHREICHEN_ALLE);
	}

	// Alles Gepufferte dieses Spielers zum Server schicken. Liefert die Zahl der übertragenen Einträge.
	// Bei abgelaufener Sitzung wird zuerst geprüft, ob sie wieder gilt (z. B. in einem anderen Tab neu angemeldet).
	async function nachreichen() {
		if (nachreichenLaeuft || !spieler) return 0;
		nachreichenLaeuft = true;
		let anzahl = 0, offen = false;
		const warten = (ms) => new Promise((w) => setTimeout(w, ms));
		try {
			if (abgelaufen) {
				try {
					const me = await json("GET", "/api/me");
					sitzungBis = me.sitzungBis ? me.sitzungBis * 1000 : 0;
					abgelaufen = false;
					if (!ablaufPruefen()) beiWieder();
				} catch (e) {
					if (!nichtErreichbar(e)) throw e;
					offen = true;
				}
			}
			const prefix = PUFFER_PREFIX + (konto || spieler) + ":";
			const keys = [];
			if (!offen) {
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.startsWith(prefix)) keys.push(k);
				}
			}
			for (const key of keys) {
				if (offen) break;
				const sicht = key.slice(prefix.length) || null;
				const kopf = sicht ? { "X-Ansicht": sicht } : {};
				for (const [url, eintrag] of Object.entries(pufferLesen(key).saves)) {
					let r;
					try {
						r = await api(eintrag.methode, url, eintrag.methode === "PUT" ? eintrag.body : undefined, {}, kopf);
					} catch (e) {
						if (!nichtErreichbar(e)) throw e;
						offen = true; break;
					}
					if (!r.ok && r.status !== 404) console.warn("Spielebibliothek: nachgereichter Spielstand abgelehnt", url, r.status);
					// nur entfernen, wenn inzwischen nichts Neueres gepuffert wurde
					const p = pufferLesen(key);
					if (p.saves[url] && p.saves[url].zeit === eintrag.zeit) { delete p.saves[url]; pufferSchreiben(p, key); }
					anzahl++;
				}
				while (!offen) {
					const eintrag = pufferLesen(key).scores[0];
					if (!eintrag) break;
					let r;
					try {
						r = await api("POST", eintrag.url, eintrag.body, {}, kopf);
					} catch (e) {
						if (!nichtErreichbar(e)) throw e;
						offen = true; break;
					}
					if (r.status === 429) { await warten(1100); continue; }
					if (!r.ok) console.warn("Spielebibliothek: nachgereichter Score abgelehnt", eintrag.url, r.status);
					const p = pufferLesen(key);
					if (p.scores[0] && p.scores[0].zeit === eintrag.zeit) { p.scores.shift(); pufferSchreiben(p, key); }
					anzahl++;
					await warten(1100);   // höchstens ein Score pro Sekunde
				}
			}
		} catch (e) {
			console.warn("Spielebibliothek: Nachreichen fehlgeschlagen", e);
			offen = true;
		} finally {
			nachreichenLaeuft = false;
		}
		if (offen || abgelaufen) nachreichenPlanen();
		return anzahl;
	}

	// Inaktiv: Wer bei abgelaufener Sitzung lange im Hintergrund war, wird beim Zurückkommen neu angemeldet.
	// Der Fortschritt ist dann schon im Zwischenspeicher.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") { versteckt = Date.now(); return; }
		ablaufPruefen();
		if (abgelaufen && versteckt && Date.now() - versteckt >= INAKTIV_NEU_LADEN) location.reload();
		versteckt = 0;
	});

	async function api(methode, url, body, extra = {}, kopf = null) {
		const r = await fetch(url, {
			method: methode,
			credentials: "same-origin",
			redirect: "manual",            // Access-Umleitung zum Login = Sitzung abgelaufen
			cache: "no-store",
			headers: { "X-Bibliothek": "1", ...(kopf || (ansicht() ? { "X-Ansicht": ansicht() } : {})),
				...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
			body: body !== undefined ? JSON.stringify(body) : undefined,
			...extra,
		});
		if (r.status === 401) {
			// „Verbindung trennen“ (Zentrale 1.2.1): dieses Gerät abmelden – Fortschritt landet vorher im Zwischenspeicher
			const d = await r.clone().json().catch(() => ({}));
			if (d.detail === "Sitzung getrennt") { ablaufMelden(); setTimeout(() => { location.href = "/cdn-cgi/access/logout"; }, 300); }
		}
		if (r.type === "opaqueredirect" || r.status === 401) {
			ablaufMelden();
			throw new SitzungAbgelaufen("Sitzung abgelaufen – bitte Seite neu laden");
		}
		return r;
	}

	async function json(methode, url, body) {
		const r = await api(methode, url, body);
		if (r.status === 204) return null;
		const d = await r.json().catch(() => ({}));
		if (!r.ok) {
			const e = new Error(typeof d.detail === "string" ? d.detail : "Fehler " + r.status);
			e.status = r.status;
			throw e;
		}
		return d;
	}

	// --- Anmeldung für play.cuby0401.uk (eigene Access-Anwendung) ---

	async function playAngemeldet() {
		try {
			const r = await fetch(PLAY + "/__status", { credentials: "include", redirect: "manual", cache: "no-store" });
			return r.type !== "opaqueredirect" && r.status === 204;
		} catch {
			return false;
		}
	}

	// Liefert true, wenn angemeldet. Sonst einmal über play springen (Access meldet dort ohne neuen
	// Code an, solange die Team-Sitzung gilt) – höchstens alle 60 s, gegen Endlosschleifen.
	async function sicherstellenPlay() {
		if (await playAngemeldet()) return true;
		let letzter = 0;
		try { letzter = +sessionStorage.getItem("play-sprung") || 0; } catch { /* egal */ }
		if (Date.now() - letzter < 60000) return false;
		try { sessionStorage.setItem("play-sprung", String(Date.now())); } catch { /* egal */ }
		const ziel = location.pathname.replace(/^\//, "") + location.search + location.hash;
		location.href = PLAY + "/__anmelden?ziel=" + encodeURIComponent(ziel);
		return new Promise(() => {}); // Seite wechselt
	}

	// --- localStorage-Ersatz ---

	function lsSchreiben(id, sofort = false) {
		const s = lsStand.get(id);
		if (!s || !s.geaendert) return;
		clearTimeout(s.timer);
		const senden = () => {
			s.geaendert = false;
			const url = pfad(id) + "/" + LS_KEY;
			const inhalt = { data: { ...s.daten } };
			if (ablaufPruefen()) { puffern("PUT", url, inhalt); return; }   // sofort und synchron sichern
			// keepalive (übersteht das Schließen der Seite) erlaubt nur ~64 KB
			const extra = sofort && JSON.stringify(inhalt).length < 60000 ? { keepalive: true } : {};
			api("PUT", url, inhalt, extra).catch((e) => {
				if (nichtErreichbar(e)) puffern("PUT", url, inhalt);
				else console.warn("Spielebibliothek: localStorage nicht gespeichert", e);
			});
		};
		if (sofort) senden();
		else s.timer = setTimeout(senden, LS_VERZOEGERUNG);
	}

	function alleSofortSchreiben() {
		for (const id of lsStand.keys()) lsSchreiben(id, true);
	}
	window.addEventListener("pagehide", alleSofortSchreiben);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") alleSofortSchreiben();
	});

	function bestenliste(id, season) {
		const q = season === "woche" ? "?woche=true" : season ? "?season=" + encodeURIComponent(season) : "";
		return json("GET", "/api/leaderboard/" + id.split("/").map(encodeURIComponent).join("/") + q);
	}

	// --- Multiplayer (Zentrale 1.6.0, E88) ---
	// Die Bibliotheksseite hält die Verbindung zum Raum (WebSocket an /api/mp/…, gleiche Herkunft, Anmeldung über Cloudflare),
	// nicht das Spiel. Das Spiel bekommt Raum, Nachrichten und Spielstand per postMessage, wie beim Speichern.
	const MP_ENDGUELTIG = { 4000: "Du spielst in diesem Raum jetzt in einem anderen Tab.", 4001: "Du wurdest aus dem Raum geworfen.",
		4003: "Verbindung abgelehnt.", 4004: "Dieses Spiel ist kein Multiplayer-Spiel.", 4008: "Das Spiel hat zu viele Nachrichten geschickt.",
		4009: "Das Spiel hat eine zu große Nachricht geschickt.", 4403: "Kein Zugang.", 4404: "Diesen Raum gibt es nicht (mehr).",
		4409: "Der Raum ist voll.", 4429: "Zu viele neue Räume – bitte kurz warten.", 4503: "Die Bibliothek ist gerade abgeschaltet." };
	const mp = { ws: null, spiel: null, code: null, raum: null, stand: undefined, fenster: null, ping: null, versuch: 0, timer: null,
		beiRaum: () => {}, beiVerbindung: () => {}, beiEnde: () => {}, beiFehler: () => {} };
	function mpTab() {
		try {
			let t = sessionStorage.getItem("mp-tab");
			if (!t) { t = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); sessionStorage.setItem("mp-tab", t); }
			return t;
		} catch { return null; }
	}
	function anSpiel(nachricht) {
		if (!mp.fenster) return;
		try { mp.fenster.postMessage({ gs: 1, ...nachricht }, PLAY); } catch { /* Spiel weg */ }
	}
	function mpSchliessen() {
		clearInterval(mp.ping); clearTimeout(mp.timer);
		mp.ping = mp.timer = null;
		const ws = mp.ws;
		mp.ws = null;
		if (ws) { ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(1000); } catch { /* egal */ } }
	}
	// Verbinden: { neu: true } oder { code }. Liefert den Raum, sobald der Dienst ihn bestätigt hat.
	function mpVerbinden(spielId, { neu = false, code = null, zuschauer = false, wieder = false } = {}) {
		mpSchliessen();
		if (!wieder) { mp.raum = null; mp.stand = undefined; mp.versuch = 0; }
		mp.spiel = spielId;
		const q = new URLSearchParams();
		if (neu) q.set("neu", "1"); else q.set("raum", code);
		if (zuschauer) q.set("zuschauer", "1");
		const tab = mpTab();
		if (tab) q.set("tab", tab);
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${location.host}/api/mp/${spielId.split("/").map(encodeURIComponent).join("/")}?${q}`);
		mp.ws = ws;
		return new Promise((ja, nein) => {
			let bestaetigt = false;
			ws.onopen = () => { mp.ping = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 25000); };
			ws.onmessage = (e) => {
				if (e.data === "pong") return;
				let n;
				try { n = JSON.parse(e.data); } catch { return; }
				if (n.t === "raum") {
					mp.raum = n.raum; mp.code = n.raum.code;
					if (!bestaetigt) { bestaetigt = true; mp.versuch = 0; ja(n.raum); if (wieder) mp.beiVerbindung(true); }
					mp.beiRaum(n.raum);
					anSpiel({ mp: "raum", raum: n.raum });
				} else if (n.t === "nachricht") {
					anSpiel({ mp: "nachricht", von: n.von, daten: n.daten });
				} else if (n.t === "stand") {
					mp.stand = n.daten;
					anSpiel({ mp: "stand", daten: n.daten });
				} else if (n.t === "fehler") {
					mp.beiFehler(String(n.text || ""));
				}
			};
			ws.onclose = (e) => {
				if (mp.ws !== ws) return;
				clearInterval(mp.ping); mp.ping = null; mp.ws = null;
				if (e.code === 4401) { ablaufMelden(); }
				const endgueltig = MP_ENDGUELTIG[e.code] || (e.code === 4401 ? "Anmeldung abgelaufen – Seite neu laden." : null);
				if (!bestaetigt && !wieder) { nein(Object.assign(new Error(endgueltig || e.reason || "Keine Verbindung zum Raum."), { code: e.code })); return; }
				if (endgueltig || e.code === 1000) { mp.raum = null; mp.beiEnde(e.code, endgueltig || e.reason || ""); return; }
				// Verbindung unterwegs verloren: neu verbinden, der Platz (und als Host 10 s lang auch die Host-Rolle) bleibt
				mp.beiVerbindung(false);
				const warte = Math.min(8000, 500 * 2 ** mp.versuch++);
				mp.timer = setTimeout(() => {
					mpVerbinden(spielId, { code: mp.code, wieder: true }).catch(() => {});
				}, warte);
				if (!bestaetigt) nein(new Error("Verbindung verloren"));
			};
		});
	}
	function mpSenden(n) {
		if (mp.ws && mp.ws.readyState === 1) mp.ws.send(JSON.stringify(n));
	}

	// --- Nachrichten aus dem Spiel ---

	async function bearbeiten(id, m) {
		const key = m.key;
		const keyOk = typeof key === "string" && KEY_MUSTER.test(key) && !key.startsWith("__");
		switch (m.op) {
			case "save": {
				if (!keyOk) throw new Error("ungültiger key");
				const url = pfad(id) + "/" + encodeURIComponent(key);
				const body = { data: m.data ?? null };
				geladen.set(url, { data: body.data, version: saveVersionen.get(id) || 1 });
				if (ablaufPruefen()) { if (!puffern("PUT", url, body)) throw new Error("Zwischenspeicher voll"); return null; }
				try {
					await json("PUT", url, body);
				} catch (e) {
					if (!nichtErreichbar(e)) throw e;
					if (!puffern("PUT", url, body)) throw new Error("Zwischenspeicher voll");
				}
				return null;
			}
			case "load": {
				if (!keyOk) throw new Error("ungültiger key");
				const url = pfad(id) + "/" + encodeURIComponent(key);
				const zwischen = gepuffert(url);   // noch nicht übertragen → das ist der neueste Stand
				if (zwischen) return { data: zwischen.data, version: zwischen.data === null ? null : (saveVersionen.get(id) || 1) };
				try {
					const d = await json("GET", url);
					geladen.set(url, { data: d.data, version: d.version });
					return { data: d.data, version: d.version };
				} catch (e) {
					if (e.status === 404) return { data: null, version: null };
					if (nichtErreichbar(e) && geladen.has(url)) return geladen.get(url);
					throw e;
				}
			}
			case "remove": {
				if (!keyOk) throw new Error("ungültiger key");
				const url = pfad(id) + "/" + encodeURIComponent(key);
				geladen.set(url, { data: null, version: null });
				if (ablaufPruefen()) { puffern("DELETE", url); return null; }
				try {
					await json("DELETE", url);
				} catch (e) {
					if (!nichtErreichbar(e)) throw e;
					puffern("DELETE", url);
				}
				return null;
			}
			case "player":
				return spieler;
			case "score": {
				let body;
				if (typeof m.score === "number" && Number.isFinite(m.score)) body = { score: m.score };
				else if (m.score && typeof m.score === "object" && !Array.isArray(m.score) && JSON.stringify(m.score).length <= 2000) {
					const { score, ...werte } = m.score;
					body = { werte, ...(typeof score === "number" ? { score } : {}) };
				} else throw new Error("submitScore erwartet eine Zahl oder ein Objekt mit Werten");
				const url = "/api/score/" + id.split("/").map(encodeURIComponent).join("/");
				if (ablaufPruefen()) { scorePuffern(url, body); return null; }
				try {
					await json("POST", url, body);
				} catch (e) {
					if (e.status === 429) throw new Error("zu schnell – höchstens ein Score pro Sekunde");
					if (nichtErreichbar(e)) { scorePuffern(url, body); return null; }
					throw e;
				}
				beiScore(id);
				return null;
			}
			case "erfolg": {
				const d = await json("POST", "/api/erfolg/" + id.split("/").map(encodeURIComponent).join("/"), { id: m.erfolgId });
				if (d.neu) beiErfolg(id, d.erfolg);
				return { neu: d.neu };
			}
			case "erfolge":
				return json("GET", "/api/erfolge/" + id.split("/").map(encodeURIComponent).join("/"));
			case "leaderboard": {
				const d = await bestenliste(id);
				return d.entries.map((e) => ({ rank: e.rank, player: e.player, score: e.score, werte: e.werte || {} }));
			}
			default:
				throw new Error("unbekannte Anfrage");
		}
	}

	window.addEventListener("message", (e) => {
		if (e.origin !== PLAY || !e.source) return;
		const id = fenster.get(e.source);
		if (!id) return; // nicht unser iframe
		const m = e.data;
		if (!m || m.gs !== 1) return;

		if (m.op === "fehler") {   // Fehlerbericht des Spiels – ohne Antwort, Fehler beim Melden egal
			json("POST", pfad(id).replace("/api/save/", "/api/fehler/"), {
				meldung: m.meldung, quelle: m.quelle, zeile: m.zeile, spalte: m.spalte, stack: m.stack,
			}).catch(() => {});
			return;
		}

		if (m.op === "migration") {   // Testergebnis der Umwandlung – zählt nur bei Entwürfen (Prüfung vor dem Veröffentlichen)
			if (!id.endsWith("~entwurf")) return;
			json("POST", pfad(id).replace("/api/save/", "/api/entwickler/migration/"), {
				key: String(m.key).slice(0, 100), von: m.von, nach: m.nach, ok: m.ok === true, fehler: m.fehler,
			}).catch(() => {});
			return;
		}

		if (m.op === "mp") {   // Multiplayer: nur das Spiel, für das der Raum offen ist
			if (id !== mp.spiel || !mp.ws) return;
			if (m.art === "an") mpSenden({ t: "an", an: m.an, daten: m.daten });
			else if (m.art === "stand") mpSenden({ t: "stand", daten: m.daten });
			else if (m.art === "verlassen") { mpSenden({ t: "verlassen" }); }
			return;
		}

		if (m.op === "lsWrite") {
			if (!m.changes || typeof m.changes !== "object") return;
			const s = lsStand.get(id) || { daten: {}, timer: null, geaendert: false };
			lsStand.set(id, s);
			for (const [k, v] of Object.entries(m.changes)) {
				if (v === null) delete s.daten[k];
				else if (typeof v === "string") s.daten[k] = v;
			}
			s.geaendert = true;
			lsSchreiben(id);
			return;
		}

		if (typeof m.id !== "number") return;
		const antwort = (inhalt) => {
			try { e.source.postMessage({ gs: 1, id: m.id, ...inhalt }, PLAY); } catch { /* Spiel weg */ }
		};
		bearbeiten(id, m).then(
			(result) => antwort({ ok: true, result }),
			(fehler) => antwort({ ok: false, error: fehler.message || String(fehler) }),
		);
	});

	// --- Öffentlich ---

	return {
		PLAY,
		SitzungAbgelaufen,
		json,
		sicherstellenPlay,
		bestenliste,
		get ansicht() { return ansicht(); },
		set ansicht(wert) {
			try { wert ? sessionStorage.setItem(ANSICHT_KEY, wert) : sessionStorage.removeItem(ANSICHT_KEY); } catch { /* egal */ }
		},
		set beiAblauf(f) { beiAblauf = f; },
		set beiWieder(f) { beiWieder = f; },
		set sitzungBis(sekunden) { sitzungBis = sekunden ? sekunden * 1000 : 0; ablaufPruefen(); },
		nachreichen,
		set beiScore(f) { beiScore = f; },
		set beiErfolg(f) { beiErfolg = f; },
		set spieler(name) { spieler = name; },
		set konto(name) { konto = name || null; },

		// Spiel in den Rahmen laden. Gespeicherte localStorage-Werte kommen vorab mit.
		async starten(spiel, rahmen) {
			const id = spiel.id;
			saveVersionen.set(id, spiel.saveVersion || 1);
			// Frisch vom Server (anderes Gerät könnte weitergespielt haben) – außer es sind noch
			// eigene Änderungen unterwegs, dann gilt der Stand hier.
			const bisher = lsStand.get(id);
			let ls = bisher && bisher.geaendert ? bisher.daten : null;
			const zwischen = !ls && gepuffert(pfad(id) + "/" + LS_KEY);   // noch nicht übertragen → neuester Stand
			if (zwischen) {
				ls = (zwischen.data && typeof zwischen.data === "object") ? zwischen.data : {};
				lsStand.set(id, { daten: ls, timer: null, geaendert: false });
			}
			if (!ls) {
				try {
					ls = (await json("GET", pfad(id) + "/" + LS_KEY)).data || {};
				} catch (e) {
					if (e.status !== 404) throw e;
					ls = {};
				}
				lsStand.set(id, { daten: ls, timer: null, geaendert: false });
			}

			const iframe = document.createElement("iframe");
			// eigener Origin play.cuby0401.uk (E14): kein Zugriff auf diese Seite, kein Umleiten
			iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock allow-popups-to-escape-sandbox");
			iframe.setAttribute("allow", "fullscreen; gamepad; autoplay");
			iframe.setAttribute("title", spiel.title);
			// Multiplayer: Raum (und als Host den abgelegten Spielstand) gleich mitgeben
			const imRaum = spiel.multiplayer && mp.raum && mp.spiel === id;
			const mpVorab = imRaum ? { raum: mp.raum, hatStand: mp.raum.host === mp.raum.ich, stand: mp.stand === undefined ? null : mp.stand } : null;
			iframe.name = "gamesave:" + JSON.stringify({ ls, player: spieler, saveVersion: spiel.saveVersion || 1, version: spiel.version || null, mp: mpVorab });
			rahmen.replaceChildren(iframe);
			fenster.set(iframe.contentWindow, id);
			mp.fenster = imRaum ? iframe.contentWindow : null;
			iframe.src = PLAY + "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/index.html";
			return iframe;
		},

		// Vor dem Verlassen eines Spiels: noch offene localStorage-Änderungen sofort schreiben, Raum verlassen
		beenden() {
			alleSofortSchreiben();
			this.mp.trennen();
		},

		// Multiplayer (Zentrale 1.6.0): Lobby und Raum-Karte in app.js
		mp: {
			verbinden: mpVerbinden,
			senden: mpSenden,
			trennen() { mpSchliessen(); mp.raum = null; mp.stand = undefined; mp.fenster = null; mp.spiel = null; },
			get raum() { return mp.raum; },
			set beiRaum(f) { mp.beiRaum = f; },
			set beiVerbindung(f) { mp.beiVerbindung = f; },
			set beiEnde(f) { mp.beiEnde = f; },
			set beiFehler(f) { mp.beiFehler = f; },
		},
	};
})();

// ---------- Zentrale 1.4.0: Fehler der Bibliothek melden (A) und veraltete Seite erkennen (B) ----------
// Anlass 07.11.2026: Bei einem Tester tat „Spielen“ nichts. Sein Browser hielt eine index.html von 1.3.0, das app.js war schon
// 1.3.1 – der Absturz in zeigeSpiel blieb unsichtbar, weil nur Fehler in Spielen gemeldet wurden.
// Diese Datei laden Bibliothek und Admin-Panel als erste, darum steht beides hier.
(() => {
	// Kennung dieser Seite: ?v=<commit>-<zeit> am eigenen <script>-Tag (setzt scripts/nas-deploy.sh in die HTML-Dateien)
	const eigenesSkript = document.currentScript;
	const seitenStand = (() => {
		try { return new URL(eigenesSkript.src).searchParams.get("v") || ""; } catch { return ""; }
	})();
	const seitenCommit = /^[0-9a-f]{7,40}-\d+$/.test(seitenStand) ? seitenStand.split("-")[0] : null;   // Probe/Teststand: kein Commit

	// --- A: Fehler melden, Spieler bekommt eine Nummer ---
	let gezeigt = false;
	function hinweisZeigen(nr) {
		if (gezeigt) return;
		gezeigt = true;
		const box = document.createElement("div");
		box.className = "zentrale-fehler";
		box.setAttribute("role", "alert");
		const text = document.createElement("p");
		text.textContent = "Da ist leider etwas schiefgelaufen. Lade die Seite bitte neu (F5). Passiert es wieder, melde dich bei Seb"
			+ (nr ? ` und nenne die Fehler-Nr. ${nr}.` : ".");
		const neu = document.createElement("button");
		neu.type = "button"; neu.className = "knopf klein"; neu.textContent = "Neu laden";
		neu.onclick = () => location.reload();
		const zu = document.createElement("button");
		zu.type = "button"; zu.className = "knopf klein leise"; zu.textContent = "Schließen";
		zu.onclick = () => box.remove();
		box.append(text, neu, zu);
		(document.body || document.documentElement).append(box);
	}
	// Kein Programmfehler: abgelaufene Anmeldung, fehlende Verbindung, fremde Skripte ohne Angaben
	const harmlos = (fehler, meldung) =>
		(typeof Bridge !== "undefined" && fehler instanceof Bridge.SitzungAbgelaufen)
		|| /^Script error\.?$/.test(meldung)
		|| /^ResizeObserver loop/.test(meldung)
		|| (fehler instanceof TypeError && /Failed to fetch|NetworkError|Load failed|network connection/i.test(meldung))
		|| (fehler && fehler.name === "AbortError");
	let gemeldet = 0;
	function melden(fehler, meldung, quelle, zeile, spalte) {
		meldung = String(meldung || (fehler && fehler.message) || fehler || "").slice(0, 300);
		if (harmlos(fehler, meldung) || gemeldet >= 5) return;   // je Seitenaufruf höchstens 5 Berichte
		gemeldet++;
		let pfad = "";
		try { const u = new URL(quelle || "", location.href); pfad = u.origin === location.origin ? u.pathname : u.href.split("?")[0]; } catch { /* inline */ }
		const bericht = {
			meldung, quelle: pfad.slice(0, 200), zeile: zeile || 0, spalte: spalte || 0,
			stack: String((fehler && fehler.stack) || "").slice(0, 1500),
			seite: (location.pathname + location.hash).slice(0, 200),
			version: seitenStand.slice(0, 60),
		};
		fetch("/api/fehler-zentrale", {
			method: "POST", credentials: "same-origin", redirect: "manual", cache: "no-store",
			headers: { "X-Bibliothek": "1", "Content-Type": "application/json" }, body: JSON.stringify(bericht),
		}).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((d) => hinweisZeigen(d && d.nr));
	}
	window.addEventListener("error", (e) => {
		if (!e.error && !e.message) return;   // z. B. Bild nicht geladen – kein Skriptfehler
		melden(e.error, e.message, e.filename, e.lineno, e.colno);
	});
	window.addEventListener("unhandledrejection", (e) => {
		const f = e.reason;
		// Zeile und Datei stehen bei Promise-Fehlern nur im Stack – die erste eigene Zeile herausziehen
		const m = String((f && f.stack) || "").match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
		melden(f, f && f.message ? (f.name ? f.name + ": " : "") + f.message : f, m ? m[1] : "", m ? +m[2] : 0, m ? +m[3] : 0);
	});

	// --- B: Seite und Code aus verschiedenen Versionen? Dann einmal frisch laden ---
	// Hilft gegen jede Art veralteter HTML-Datei im Browser-Cache: Die Seite holt sich selbst mit cache: "reload"
	// (überschreibt den Cache-Eintrag ohne Nachfrage per If-Modified-Since) und lädt dann neu. Höchstens einmal je Live-Stand.
	async function standPruefen() {
		if (!seitenCommit) return;
		let live = null;
		try { live = await (await fetch("/zentrale.json", { cache: "no-store" })).json(); } catch { return; }
		if (!live || !live.commit || String(live.commit).startsWith(seitenCommit) || seitenCommit.startsWith(String(live.commit))) return;
		const merker = "zentrale-neu-geladen-" + live.commit;
		try { if (sessionStorage.getItem(merker)) return; sessionStorage.setItem(merker, "1"); } catch { return; }   // nie in Schleife
		try { await fetch(location.pathname, { cache: "reload", credentials: "same-origin" }); } catch { /* trotzdem neu laden */ }
		location.reload();
	}
	standPruefen();
	// Auch wer den Tab lange offen hat, bekommt nach einem Live-Gang beim Zurückkommen den neuen Stand
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") standPruefen(); });
})();
