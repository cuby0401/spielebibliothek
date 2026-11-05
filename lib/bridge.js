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
	const lsStand = new Map();     // Spiel-ID → { daten, timer, geaendert }
	let spieler = null;
	let beiAblauf = () => {};
	let beiScore = () => {};

	const pfad = (id) => "/api/save/" + id.split("/").map(encodeURIComponent).join("/");

	class SitzungAbgelaufen extends Error {}

	async function api(methode, url, body, extra = {}) {
		const r = await fetch(url, {
			method: methode,
			credentials: "same-origin",
			redirect: "manual",            // Access-Umleitung zum Login = Sitzung abgelaufen
			cache: "no-store",
			headers: body !== undefined ? { "Content-Type": "application/json" } : {},
			body: body !== undefined ? JSON.stringify(body) : undefined,
			...extra,
		});
		if (r.type === "opaqueredirect" || r.status === 401) {
			beiAblauf();
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
			const inhalt = { data: { ...s.daten } };
			// keepalive (übersteht das Schließen der Seite) erlaubt nur ~64 KB
			const extra = sofort && JSON.stringify(inhalt).length < 60000 ? { keepalive: true } : {};
			api("PUT", pfad(id) + "/" + LS_KEY, inhalt, extra).catch((e) => {
				if (!(e instanceof SitzungAbgelaufen)) console.warn("Spielebibliothek: localStorage nicht gespeichert", e);
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
		const q = season ? "?season=" + encodeURIComponent(season) : "";
		return json("GET", "/api/leaderboard/" + id.split("/").map(encodeURIComponent).join("/") + q);
	}

	// --- Nachrichten aus dem Spiel ---

	async function bearbeiten(id, m) {
		const key = m.key;
		const keyOk = typeof key === "string" && KEY_MUSTER.test(key) && !key.startsWith("__");
		switch (m.op) {
			case "save":
				if (!keyOk) throw new Error("ungültiger key");
				await json("PUT", pfad(id) + "/" + encodeURIComponent(key), { data: m.data ?? null });
				return null;
			case "load": {
				if (!keyOk) throw new Error("ungültiger key");
				try {
					const d = await json("GET", pfad(id) + "/" + encodeURIComponent(key));
					return { data: d.data, version: d.version };
				} catch (e) {
					if (e.status === 404) return { data: null, version: null };
					throw e;
				}
			}
			case "remove":
				if (!keyOk) throw new Error("ungültiger key");
				await json("DELETE", pfad(id) + "/" + encodeURIComponent(key));
				return null;
			case "player":
				return spieler;
			case "score": {
				if (typeof m.score !== "number" || !Number.isFinite(m.score)) throw new Error("score muss eine Zahl sein");
				try {
					await json("POST", "/api/score/" + id.split("/").map(encodeURIComponent).join("/"), { score: m.score });
				} catch (e) {
					if (e.status === 429) throw new Error("zu schnell – höchstens ein Score pro Sekunde");
					throw e;
				}
				beiScore(id);
				return null;
			}
			case "leaderboard": {
				const d = await bestenliste(id);
				return d.entries.map((e) => ({ player: e.player, score: e.score }));
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
		set beiAblauf(f) { beiAblauf = f; },
		set beiScore(f) { beiScore = f; },
		set spieler(name) { spieler = name; },

		// Spiel in den Rahmen laden. Gespeicherte localStorage-Werte kommen vorab mit.
		async starten(spiel, rahmen) {
			const id = spiel.id;
			// Frisch vom Server (anderes Gerät könnte weitergespielt haben) – außer es sind noch
			// eigene Änderungen unterwegs, dann gilt der Stand hier.
			const bisher = lsStand.get(id);
			let ls = bisher && bisher.geaendert ? bisher.daten : null;
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
			iframe.name = "gamesave:" + JSON.stringify({ ls, player: spieler });
			rahmen.replaceChildren(iframe);
			fenster.set(iframe.contentWindow, id);
			iframe.src = PLAY + "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/index.html";
			return iframe;
		},

		// Vor dem Verlassen eines Spiels: noch offene localStorage-Änderungen sofort schreiben
		beenden() {
			alleSofortSchreiben();
		},
	};
})();
