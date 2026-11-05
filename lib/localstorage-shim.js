// localStorage-Ersatz für Spiele im abgeschotteten iframe – PROTOTYP für den Sandbox-Spike (Phase 3)
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/GameSave-Bibliothek
//
// Muss als ERSTES Script im Spiel stehen:  <script src="/lib/localstorage-shim.js"></script>
//
// Idee gegen das Startreihenfolge-Problem: Die Bibliotheksseite lädt die gespeicherten Werte VOR dem
// Start des Spiels und gibt sie dem iframe über sein name-Attribut mit ("gamesave:" + JSON).
// window.name ist im iframe sofort und synchron lesbar – das Spiel muss also nicht warten.
// Schreibzugriffe gehen SOFORT per postMessage an die Bibliotheksseite (Bursts im selben Durchlauf
// zusammengefasst). Gebündelt wird erst dort – ein iframe kann beim Entfernen nichts mehr senden,
// weil parent dann schon getrennt ist (im Spike gemessen: 500-ms-Bündelung verlor die letzten Klicks).
//
// Außerhalb der Bibliothek (kein "gamesave:"-Name) bleibt alles im Arbeitsspeicher.
// In Phase 4 wandert das in gamesave.js, die Bibliotheksseite speichert dann über savesvc.

(function () {
	"use strict";

	var PREFIX = "gamesave:";
	var info = { installed: false, inLibrary: false, originalBlocked: null, error: null };
	window.__lsShim = info;

	// Ist das echte localStorage gesperrt? (im sandboxed iframe: SecurityError)
	try {
		void window.localStorage.length;
		info.originalBlocked = false;
	} catch (e) {
		info.originalBlocked = e && e.name ? e.name : String(e);
	}

	// Vorab geladene Werte aus window.name übernehmen und den Namen sofort leeren
	var data = Object.create(null);
	try {
		if (typeof window.name === "string" && window.name.indexOf(PREFIX) === 0) {
			var geladen = JSON.parse(window.name.slice(PREFIX.length));
			if (geladen && typeof geladen === "object") {
				Object.keys(geladen).forEach(function (k) {
					if (typeof geladen[k] === "string") data[k] = geladen[k];
				});
			}
			info.inLibrary = true;
		}
	} catch (e) {
		info.error = "window.name: " + e;
	}
	try { window.name = ""; } catch (e) { /* egal */ }

	// Schreiben an die Bibliotheksseite: am Ende des aktuellen Durchlaufs (Microtask)
	var offen = Object.create(null);
	var hatOffene = false;
	var geplant = false;

	function senden() {
		geplant = false;
		if (!hatOffene) return;
		var aenderungen = offen;
		offen = Object.create(null);
		hatOffene = false;
		if (!info.inLibrary) return;
		try {
			parent.postMessage({ gs: 1, op: "lsWrite", changes: aenderungen }, "*");
		} catch (e) { /* Bibliothek weg */ }
	}
	function merken(k, v) { // v === null bedeutet löschen
		offen[k] = v;
		hatOffene = true;
		if (!geplant) { geplant = true; queueMicrotask(senden); }
	}

	function speicher(persistent) {
		var d = persistent ? data : Object.create(null);
		var merk = persistent ? merken : function () {};
		var api = {
			getItem: function (k) { k = String(k); return k in d ? d[k] : null; },
			setItem: function (k, v) { k = String(k); v = String(v); d[k] = v; merk(k, v); },
			removeItem: function (k) { k = String(k); if (k in d) { delete d[k]; merk(k, null); } },
			clear: function () { Object.keys(d).forEach(function (k) { delete d[k]; merk(k, null); }); },
			key: function (i) { var ks = Object.keys(d); return i >= 0 && i < ks.length ? ks[i] : null; },
		};
		var ziel = typeof Storage === "function" ? Object.create(Storage.prototype) : {};
		// Proxy, damit auch localStorage.punkte = 5 und localStorage["punkte"] funktionieren
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
				if (typeof p === "string" && p in d) {
					return { value: d[p], writable: true, enumerable: true, configurable: true };
				}
				return undefined;
			},
		});
	}

	try {
		var ls = speicher(true);
		var ss = speicher(false);
		Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: function () { return ls; } });
		Object.defineProperty(window, "sessionStorage", { configurable: true, enumerable: true, get: function () { return ss; } });
		info.installed = true;
	} catch (e) {
		info.error = "defineProperty: " + (e && e.name ? e.name + " " + e.message : e);
	}
})();
