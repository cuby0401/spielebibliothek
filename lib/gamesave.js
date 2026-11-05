// GameSave – Speichern für Spiele der Spielebibliothek
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/GameSave-Bibliothek, Entscheidungen E14/E15
//
// Einbinden als ERSTES Script:  <script src="/lib/gamesave.js"></script>
//
//   await GameSave.save("spielstand", { level: 3 });
//   const { data, version } = await GameSave.load("spielstand");   // data = null, wenn nichts da
//   // Updates absichern: fehlende Felder ergänzen, alte Stände Schritt für Schritt umwandeln
//   const { data } = await GameSave.load("spielstand", {
//     standard: { level: 1, inventar: [] },
//     migration: { 2: (alt) => ({ ...alt, inventar: alt.items || [] }) },   // Schlüssel = saveVersion
//   });
//   await GameSave.submitScore(1250);                        // einfacher Score
//   await GameSave.submitScore({ level: 12, items: 48 });    // Werte für eigene Spalten (game.json)
//   await GameSave.remove("spielstand");
//   const ich = await GameSave.player();
//   GameSave.available   // false außerhalb der Bibliothek (lokales Testen)
//
// Zusätzlich wird localStorage ersetzt: Alte Spiele speichern damit automatisch auf dem Server.
//
// In der Bibliothek: Das Spiel läuft auf play.cuby0401.uk im iframe, die Bibliothek auf
// games.cuby0401.uk. Gespeicherte Werte kommen vorab über das iframe-name ("gamesave:" + JSON),
// alles andere geht per postMessage an die Bibliothek (lib/bridge.js), die die Spiel-ID selbst
// bestimmt und mit dem Speicher-Dienst spricht.
// Außerhalb der Bibliothek bleibt alles im Arbeitsspeicher (available = false).

(function () {
	"use strict";

	var BIBLIOTHEK = "https://games.cuby0401.uk";
	var PREFIX = "gamesave:";
	var ZEITLIMIT = 15000;

	// --- Start: Daten der Bibliothek übernehmen ---
	var inBibliothek = false;
	var vorab = { ls: {}, player: null, saveVersion: 1 };
	try {
		if (window.parent !== window && typeof window.name === "string" && window.name.indexOf(PREFIX) === 0) {
			var roh = JSON.parse(window.name.slice(PREFIX.length));
			if (roh && typeof roh === "object") {
				if (roh.ls && typeof roh.ls === "object") vorab.ls = roh.ls;
				if (typeof roh.player === "string") vorab.player = roh.player;
				if (typeof roh.saveVersion === "number" && roh.saveVersion >= 1) vorab.saveVersion = roh.saveVersion;
			}
			inBibliothek = true;
		}
	} catch (e) { /* kein gültiger Name → lokal */ }
	try { window.name = ""; } catch (e) { /* egal */ }

	function senden(nachricht) {
		try { window.parent.postMessage(nachricht, BIBLIOTHEK); } catch (e) { /* Bibliothek weg */ }
	}

	// --- Anfragen an die Bibliothek ---
	var naechsteId = 1;
	var offen = {};
	window.addEventListener("message", function (e) {
		if (e.origin !== BIBLIOTHEK || e.source !== window.parent) return;
		var m = e.data;
		if (!m || m.gs !== 1 || !offen[m.id]) return;
		var o = offen[m.id];
		delete offen[m.id];
		clearTimeout(o.timer);
		if (m.ok) o.ja(m.result);
		else o.nein(new Error("GameSave: " + (m.error || "Fehler")));
	});
	function anfrage(op, felder) {
		return new Promise(function (ja, nein) {
			var id = naechsteId++;
			var timer = setTimeout(function () {
				delete offen[id];
				nein(new Error("GameSave: keine Antwort von der Bibliothek"));
			}, ZEITLIMIT);
			offen[id] = { ja: ja, nein: nein, timer: timer };
			var m = { gs: 1, id: id, op: op };
			for (var k in felder) m[k] = felder[k];
			senden(m);
		});
	}

	function pruefeKey(key) {
		if (typeof key !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9._:-]{0,99}$/.test(key) || key.indexOf("__") === 0) {
			throw new Error("GameSave: key nur aus Buchstaben, Ziffern, . _ : - (max. 100 Zeichen, nicht mit __ beginnend)");
		}
	}
	function kopie(wert) {
		return wert === undefined ? null : JSON.parse(JSON.stringify(wert));
	}
	function istObjekt(x) {
		return x !== null && typeof x === "object" && !Array.isArray(x);
	}
	// Fehlende Felder aus den Standardwerten ergänzen (rekursiv nur für Objekte; Arrays und
	// vorhandene Werte bleiben, wie sie sind – Längenänderungen gehören in eine Migration)
	function ergaenzen(daten, standard) {
		if (daten === undefined || daten === null) return kopie(standard);
		if (istObjekt(daten) && istObjekt(standard)) {
			Object.keys(standard).forEach(function (k) { daten[k] = ergaenzen(daten[k], standard[k]); });
		}
		return daten;
	}
	// optionen: { standard, migration: { 2: fn, 3: fn } } – Schlüssel = saveVersion aus game.json
	function aufbereiten(ergebnis, optionen, aktuell) {
		if (!optionen) return ergebnis;
		var daten = ergebnis.data, version = ergebnis.version || 1;
		if (daten === null || daten === undefined) {
			return { data: kopie(optionen.standard === undefined ? null : optionen.standard), version: aktuell, neu: true };
		}
		var schritte = Object.keys(optionen.migration || {}).map(Number)
			.filter(function (v) { return v > version && v <= aktuell; })
			.sort(function (a, b) { return a - b; });
		schritte.forEach(function (v) {
			try { daten = optionen.migration[v](daten); }
			catch (e) { throw new Error("GameSave: Migration auf saveVersion " + v + " fehlgeschlagen: " + (e && e.message)); }
		});
		if (optionen.standard !== undefined) daten = ergaenzen(daten, optionen.standard);
		return { data: daten, version: aktuell, migriert: schritte.length > 0 };
	}

	// --- GameSave-API ---
	var lokal = {}; // nur außerhalb der Bibliothek
	var GameSave = {
		available: inBibliothek,

		save: function (key, data) {
			return Promise.resolve().then(function () {
				pruefeKey(key);
				var d = kopie(data);
				if (!inBibliothek) { lokal[key] = { data: d, version: 1 }; return; }
				return anfrage("save", { key: key, data: d }).then(function () {});
			});
		},
		load: function (key, optionen) {
			return Promise.resolve().then(function () {
				pruefeKey(key);
				if (!inBibliothek) {
					var e = lokal[key];
					return e ? { data: kopie(e.data), version: e.version } : { data: null, version: null };
				}
				return anfrage("load", { key: key });
			}).then(function (ergebnis) {
				return aufbereiten(ergebnis, optionen, vorab.saveVersion);
			});
		},
		remove: function (key) {
			return Promise.resolve().then(function () {
				pruefeKey(key);
				if (!inBibliothek) { delete lokal[key]; return; }
				return anfrage("remove", { key: key }).then(function () {});
			});
		},
		player: function () {
			return Promise.resolve(inBibliothek ? vorab.player : "lokal");
		},
		// submitScore(1250) oder submitScore({ level: 12, items: 48 }) – Spalten stehen in der game.json
		submitScore: function (score) {
			return Promise.resolve().then(function () {
				var ok = (typeof score === "number" && isFinite(score)) || istObjekt(score);
				if (!ok) throw new Error("GameSave: submitScore erwartet eine Zahl oder ein Objekt mit Werten");
				if (!inBibliothek) return;
				return anfrage("score", { score: kopie(score) }).then(function () {});
			});
		},
		leaderboard: function () {
			return inBibliothek ? anfrage("leaderboard", {}) : Promise.resolve([]);
		},
	};
	Object.freeze(GameSave);
	window.GameSave = GameSave;

	// --- Fehlerberichte: JavaScript-Fehler des Spiels an die Bibliothek melden ---
	// Gebündelt, ohne Spielerdaten, höchstens 10 verschiedene pro Seitenaufruf. Der Entwickler sieht sie unter „Meine Spiele“.
	if (inBibliothek) {
		var gemeldet = {}, anzahlGemeldet = 0;
		var spielPfad = location.pathname.replace(/[^/]*$/, "");
		var melden = function (meldung, quelle, zeile, spalte, stack) {
			var schluessel = meldung + "|" + quelle + "|" + zeile;
			if (gemeldet[schluessel] || anzahlGemeldet >= 10) return;
			gemeldet[schluessel] = true; anzahlGemeldet++;
			quelle = String(quelle || "").replace(location.origin, "").replace(spielPfad, "");
			senden({ gs: 1, op: "fehler", meldung: String(meldung || "").slice(0, 300), quelle: quelle.slice(0, 200),
				zeile: zeile || 0, spalte: spalte || 0, stack: String(stack || "").slice(0, 1500) });
		};
		window.addEventListener("error", function (e) {
			if (!e || !e.message) return;   // z. B. Bild nicht geladen – kein Skriptfehler
			melden(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
		});
		window.addEventListener("unhandledrejection", function (e) {
			var r = e && e.reason;
			melden("Unbehandelter Promise-Fehler: " + (r && r.message ? r.message : String(r)), "", 0, 0, r && r.stack);
		});
	}

	// --- localStorage-Ersatz (E15) ---
	// Schreiben geht SOFORT (am Ende des aktuellen Durchlaufs) an die Bibliothek: Ein iframe, das
	// entfernt wird, erreicht parent nicht mehr – gebündelt wird deshalb erst in der Bibliothek.
	var daten = Object.create(null);
	Object.keys(vorab.ls).forEach(function (k) {
		if (typeof vorab.ls[k] === "string") daten[k] = vorab.ls[k];
	});
	var aenderungen = Object.create(null), hatAenderungen = false, geplant = false;
	function abschicken() {
		geplant = false;
		if (!hatAenderungen) return;
		var c = aenderungen;
		aenderungen = Object.create(null);
		hatAenderungen = false;
		if (inBibliothek) senden({ gs: 1, op: "lsWrite", changes: c });
	}
	function merken(k, v) {
		aenderungen[k] = v;
		hatAenderungen = true;
		if (!geplant) { geplant = true; queueMicrotask(abschicken); }
	}

	function speicher(persistent) {
		var d = persistent ? daten : Object.create(null);
		var merk = persistent ? merken : function () {};
		var api = {
			getItem: function (k) { k = String(k); return k in d ? d[k] : null; },
			setItem: function (k, v) { k = String(k); v = String(v); d[k] = v; merk(k, v); },
			removeItem: function (k) { k = String(k); if (k in d) { delete d[k]; merk(k, null); } },
			clear: function () { Object.keys(d).forEach(function (k) { delete d[k]; merk(k, null); }); },
			key: function (i) { var ks = Object.keys(d); return i >= 0 && i < ks.length ? ks[i] : null; },
		};
		var ziel = typeof Storage === "function" ? Object.create(Storage.prototype) : {};
		return new Proxy(ziel, {
			get: function (t, p) {
				if (p === "length") return Object.keys(d).length;
				if (typeof p === "string" && Object.prototype.hasOwnProperty.call(api, p)) return api[p];
				if (typeof p === "string") return p in d ? d[p] : undefined;
				return Reflect.get(t, p);
			},
			set: function (t, p, v) { if (typeof p === "string") api.setItem(p, v); return true; },
			deleteProperty: function (t, p) { if (typeof p === "string") api.removeItem(p); return true; },
			has: function (t, p) { return typeof p === "string" && (p in d || p in api || p === "length"); },
			ownKeys: function () { return Object.keys(d); },
			getOwnPropertyDescriptor: function (t, p) {
				return typeof p === "string" && p in d
					? { value: d[p], writable: true, enumerable: true, configurable: true }
					: undefined;
			},
		});
	}

	try {
		var ls = speicher(true), ss = speicher(false);
		Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: function () { return ls; } });
		Object.defineProperty(window, "sessionStorage", { configurable: true, enumerable: true, get: function () { return ss; } });
	} catch (e) {
		if (window.console) console.warn("GameSave: localStorage konnte nicht ersetzt werden", e);
	}
})();
