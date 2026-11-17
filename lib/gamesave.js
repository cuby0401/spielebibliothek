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
//   GameSave.version     // "1.2.0" – Versionsnummer aus der Bibliothek (null im Entwurf und lokal)
//   await GameSave.erfolg("erster-sieg");             // Erfolg freischalten (in game.json unter "erfolge" festgelegt)
//   const liste = await GameSave.erfolge();           // alle Erfolge mit freigeschaltet: Zeit oder null
//
// Multiplayer (Zentrale 1.6.0, in game.json "multiplayer": {"min": 2, "max": 4}) – Handbuch Kapitel „Multiplayer“:
//   const spiel = await GameSave.multiplayer.spiel({ neu, zug, sicht }, { zeigen, fehler });   // Regeln laufen beim Host
//   // optional frist(zustand) → { bis, aktion }: Zeitgeber, der Host führt bei Ablauf zug(zustand, aktion, null) aus
//   const raum = await GameSave.multiplayer.raum();   // darunter: Raum, Nachrichten, Spielstand des Hosts
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
	var vorab = { ls: {}, player: null, saveVersion: 1, version: null, mp: null };
	try {
		if (window.parent !== window && typeof window.name === "string" && window.name.indexOf(PREFIX) === 0) {
			var roh = JSON.parse(window.name.slice(PREFIX.length));
			if (roh && typeof roh === "object") {
				if (roh.ls && typeof roh.ls === "object") vorab.ls = roh.ls;
				if (typeof roh.player === "string") vorab.player = roh.player;
				if (typeof roh.saveVersion === "number" && roh.saveVersion >= 1) vorab.saveVersion = roh.saveVersion;
				if (typeof roh.version === "string") vorab.version = roh.version;
				if (roh.mp && typeof roh.mp === "object" && roh.mp.raum) vorab.mp = roh.mp;   // Multiplayer: Raum schon betreten
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
		if (m && m.gs === 1 && typeof m.mp === "string") { mpEreignis(m); return; }
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

	// --- Multiplayer (Zentrale 1.6.0, E88) ---
	// Die Bibliothek bringt die Spieler in einen Raum (Lobby, Raumcode, Einladen) und leitet die Nachrichten weiter.
	// Die Spielregeln laufen im Browser des Hosts: Er rechnet, legt den Stand im Raum ab und schickt jedem Spieler nur
	// seine eigene Sicht. Geht der Host, übernimmt ein anderer Spieler mit genau diesem Stand.
	// Außerhalb der Bibliothek (lokal testen) spielen mehrere Tabs desselben Browsers miteinander (BroadcastChannel).
	var NACHRICHT_MAX = 64 * 1024;
	var raumDaten = null;                       // { code, ich, host, spieler: [...], min, max, zuschauer, entwurf }
	var abNachricht = [], abAenderung = [], abHost = [];
	var wartenderStand;                         // undefined = nichts offen; sonst Stand für den (neuen) Host
	var raumWarten = [];
	var transport = null;

	function feuern(liste, args) {
		liste.slice().forEach(function (f) {
			try { f.apply(null, args); } catch (e) { setTimeout(function () { throw e; }); }
		});
	}
	function abmelden(liste, f) {
		return function () { var i = liste.indexOf(f); if (i >= 0) liste.splice(i, 1); };
	}
	function mpEreignis(m) {
		if (m.mp === "raum" && m.raum && typeof m.raum === "object") {
			raumDaten = m.raum;
			raumWarten.splice(0).forEach(function (f) { f(raumObjekt); });
			feuern(abAenderung, [raumObjekt]);
		} else if (m.mp === "nachricht") {
			feuern(abNachricht, [m.daten === undefined ? null : m.daten, m.von]);
		} else if (m.mp === "stand") {
			// Der Stand geht nur an den Host – und kommt vor der neuen Spielerliste an
			if (raumDaten) raumDaten.host = raumDaten.ich;
			var stand = m.daten === undefined ? null : m.daten;
			if (abHost.length) feuern(abHost, [stand]);
			else wartenderStand = stand;
		}
	}
	function groesse(daten) {
		var text = JSON.stringify(daten === undefined ? null : daten);
		if (text.length > NACHRICHT_MAX) throw new Error("GameSave: Nachricht zu groß (höchstens 64 KB)");
		return JSON.parse(text);
	}
	var raumObjekt = {
		get code() { return raumDaten ? raumDaten.code : null; },
		get ich() { return raumDaten ? raumDaten.ich : null; },
		get host() { return raumDaten ? raumDaten.host : null; },
		get istHost() { return !!raumDaten && raumDaten.host === raumDaten.ich; },
		get zuschauer() { return !!raumDaten && !!raumDaten.zuschauer; },
		get min() { return raumDaten ? raumDaten.min : 1; },
		get max() { return raumDaten ? raumDaten.max : 1; },
		get entwurf() { return !!raumDaten && !!raumDaten.entwurf; },
		// [{ id, name, verbunden, zuschauer, host }] – in der Reihenfolge, in der sie den Raum betreten haben
		get spieler() { return raumDaten ? kopie(raumDaten.spieler) : []; },
		// an: weglassen = alle anderen, "host", eine Spieler-ID oder eine Liste von IDs
		senden: function (daten, an) { transport.an(an === undefined ? "alle" : an, groesse(daten)); },
		// Nur der Host: Stand im Raum ablegen (höchstens 256 KB). Den bekommt ein neuer Host über beiHostwerden.
		standSichern: function (daten) {
			if (!raumObjekt.istHost) throw new Error("GameSave: Nur der Host legt den Spielstand ab");
			var text = JSON.stringify(daten === undefined ? null : daten);
			if (text.length > 256 * 1024) throw new Error("GameSave: Spielstand zu groß (höchstens 256 KB)");
			transport.stand(JSON.parse(text));
		},
		beiNachricht: function (f) { abNachricht.push(f); return abmelden(abNachricht, f); },
		beiAenderung: function (f) { abAenderung.push(f); return abmelden(abAenderung, f); },
		// f(stand): Du bist (jetzt) Host. stand = zuletzt abgelegter Spielstand oder null (neuer Raum)
		beiHostwerden: function (f) {
			abHost.push(f);
			if (wartenderStand !== undefined) {
				var st = wartenderStand;
				wartenderStand = undefined;
				setTimeout(function () { f(st); });
			}
			return abmelden(abHost, f);
		},
		verlassen: function () { transport.verlassen(); },
	};

	function bibliothekTransport() {
		return {
			an: function (an, daten) { senden({ gs: 1, op: "mp", art: "an", an: an, daten: daten }); },
			stand: function (daten) { senden({ gs: 1, op: "mp", art: "stand", daten: daten }); },
			verlassen: function () { senden({ gs: 1, op: "mp", art: "verlassen" }); },
		};
	}

	// Lokal: jeder Tab ist ein Spieler, der älteste Tab ist Host. Nur zum Ausprobieren ohne Bibliothek.
	function lokalTransport() {
		var id = "tab-" + Math.random().toString(36).slice(2, 6);
		var seit = Date.now() + Math.random();
		var mitglieder = {};
		mitglieder[id] = { id: id, name: "Tab " + id.slice(4), seit: seit };
		var kanal = typeof BroadcastChannel === "function" ? new BroadcastChannel("gamesave-mp:" + location.pathname) : null;
		var letzterStand = null, hostVorher = null, bereit = false;
		function host() {
			return Object.keys(mitglieder).map(function (k) { return mitglieder[k]; })
				.sort(function (a, b) { return a.seit - b.seit; })[0].id;
		}
		function aktualisieren() {
			if (!bereit) return;
			var h = host();
			var liste = Object.keys(mitglieder).map(function (k) { return mitglieder[k]; })
				.sort(function (a, b) { return a.seit - b.seit; })
				.map(function (m) { return { id: m.id, name: m.name, verbunden: true, zuschauer: false, host: m.id === h }; });
			if (h === id && hostVorher !== id) mpEreignis({ mp: "stand", daten: letzterStand });
			hostVorher = h;
			mpEreignis({ mp: "raum", raum: { code: "LOKAL", ich: id, host: h, min: 1, max: 16, entwurf: true, zuschauer: false, spieler: liste } });
		}
		function posten(m) { if (kanal) kanal.postMessage(m); }
		if (kanal) {
			kanal.onmessage = function (e) {
				var m = e.data || {};
				if (m.typ === "hallo" || m.typ === "da") {
					mitglieder[m.id] = { id: m.id, name: m.name, seit: m.seit };
					if (m.typ === "hallo") posten({ typ: "da", id: id, name: mitglieder[id].name, seit: seit });
					aktualisieren();
				} else if (m.typ === "weg") {
					delete mitglieder[m.id];
					aktualisieren();
				} else if (m.typ === "stand") {
					letzterStand = m.daten;
				} else if (m.typ === "an") {
					var fuerMich = m.an === "alle" || m.an === id || (m.an === "host" && host() === id)
						|| (Array.isArray(m.an) && m.an.indexOf(id) >= 0);
					if (fuerMich && m.von !== id) mpEreignis({ mp: "nachricht", von: m.von, daten: m.daten });
				}
			};
			posten({ typ: "hallo", id: id, name: mitglieder[id].name, seit: seit });
			window.addEventListener("pagehide", function () { posten({ typ: "weg", id: id }); });
		}
		setTimeout(function () { bereit = true; aktualisieren(); }, kanal ? 300 : 0);   // erst auf die anderen Tabs warten
		return {
			an: function (an, daten) { posten({ typ: "an", von: id, an: an, daten: daten }); },
			stand: function (daten) { letzterStand = daten; posten({ typ: "stand", daten: daten }); },
			verlassen: function () { posten({ typ: "weg", id: id }); if (kanal) kanal.close(); },
		};
	}

	function raum() {
		if (inBibliothek && !vorab.mp) {
			return Promise.reject(new Error("GameSave: Dieses Spiel ist kein Multiplayer-Spiel – in der game.json \"multiplayer\": {\"min\": 2, \"max\": 4} eintragen"));
		}
		if (!transport) {
			if (inBibliothek) {
				transport = bibliothekTransport();
				if (vorab.mp.hatStand) wartenderStand = vorab.mp.stand === undefined ? null : vorab.mp.stand;
				raumDaten = vorab.mp.raum;
			} else {
				transport = lokalTransport();
			}
		}
		if (raumDaten) return Promise.resolve(raumObjekt);
		return new Promise(function (ja) { raumWarten.push(ja); });
	}

	// Bequemer Weg: Regeln wie auf einem Spieleserver, nur dass sie beim Host laufen.
	//   neu(spielerIds, optionen) → Zustand · zug(zustand, aktion, von) → neuer Zustand (oder throw new Error("Nicht dein Zug"))
	//   sicht(zustand, spielerId) → was dieser Spieler sehen darf (z. B. nur die eigenen Karten)
	//   optional spielerGeaendert(zustand, spieler) → Zustand, wenn jemand kommt, geht oder die Verbindung verliert
	//   optional frist(zustand) → null oder { bis: Zeitpunkt in ms (Date.now()), aktion } – Zeitgeber (1.6.0): Ist „bis“
	//     erreicht, führt der Host zug(zustand, aktion, null) aus (von = null heißt: die Uhr). Den Zeitpunkt legt das Spiel
	//     selbst im Zustand ab (z. B. zustand.zugBis = Date.now() + 60000) – so läuft die Uhr nach einem Host-Wechsel weiter.
	//   neu() bekommt als drittes Argument den bisherigen Zustand (oder null), z. B. um einen Siegzähler zu übernehmen.
	// anzeige.zeigen(sicht, raum) bei jeder neuen Sicht (null = noch nicht gestartet), anzeige.fehler(text) bei abgelehnten Zügen
	function spiel(regeln, anzeige) {
		if (!regeln || typeof regeln.neu !== "function" || typeof regeln.zug !== "function") {
			return Promise.reject(new Error("GameSave: multiplayer.spiel braucht mindestens neu() und zug()"));
		}
		anzeige = anzeige || {};
		return raum().then(function (r) {
			var zustand = null;
			var bekannt = "";
			var uhr = null, uhrNr = 0, abgelaufen = null;   // abgelaufen: dieselbe Frist löst nur einmal aus (keine Schleife)
			// Zeitgeber neu stellen: nach jedem neuen Zustand und wenn man Host wird oder es nicht mehr ist
			function uhrStellen() {
				if (uhr !== null) { clearTimeout(uhr); uhr = null; }
				if (!r.istHost || zustand === null || typeof regeln.frist !== "function") return;
				var f;
				try { f = regeln.frist(kopie(zustand)); } catch (e) { fehler(String((e && e.message) || e)); return; }
				if (!f || typeof f.bis !== "number" || !isFinite(f.bis) || f.bis === abgelaufen) return;
				var nr = ++uhrNr, aktion = f.aktion === undefined ? null : f.aktion;
				uhr = setTimeout(function () {
					uhr = null;
					if (nr !== uhrNr || !r.istHost || zustand === null) return;
					abgelaufen = f.bis;
					try { anwenden(aktion, null); } catch (e) { fehler(String((e && e.message) || e)); }
				}, Math.max(0, Math.min(f.bis - Date.now(), 2147483647)));
			}
			function zeigen(sicht) { if (anzeige.zeigen) anzeige.zeigen(sicht, r); }
			function fehler(text) { if (anzeige.fehler) anzeige.fehler(text); }
			function sichtFuer(id) {
				if (zustand === null) return null;
				return kopie(regeln.sicht ? regeln.sicht(kopie(zustand), id) : zustand);
			}
			function verteilen() {
				uhrStellen();
				if (!r.istHost) return;
				r.standSichern(zustand);
				r.spieler.forEach(function (s) {
					if (!s.verbunden) return;
					if (s.id === r.ich) zeigen(sichtFuer(s.id));
					else r.senden({ __gs: "sicht", sicht: sichtFuer(s.id) }, s.id);
				});
			}
			function anwenden(aktion, von) {
				if (zustand === null) throw new Error("Das Spiel hat noch nicht angefangen.");
				var neu = regeln.zug(kopie(zustand), kopie(aktion), von);
				if (neu === undefined) throw new Error("zug() muss den neuen Zustand zurückgeben");
				zustand = kopie(neu);
				verteilen();
			}
			r.beiHostwerden(function (stand) {
				zustand = stand === undefined ? null : stand;
				bekannt = "";
				verteilen();
			});
			r.beiNachricht(function (d, von) {
				if (!d || typeof d !== "object" || typeof d.__gs !== "string") return;
				if (d.__gs === "sicht") { if (!r.istHost) zeigen(d.sicht === undefined ? null : d.sicht); return; }
				if (d.__gs === "fehler") { fehler(String(d.text || "Zug abgelehnt")); return; }
				if (!r.istHost) return;
				if (d.__gs === "hallo") { r.senden({ __gs: "sicht", sicht: sichtFuer(von) }, von); return; }
				if (d.__gs === "zug") {
					try { anwenden(d.aktion, von); }
					catch (e) { r.senden({ __gs: "fehler", text: String((e && e.message) || e).slice(0, 200) }, von); }
				}
			});
			r.beiAenderung(function () {
				if (!r.istHost) { uhrStellen(); return; }
				var jetzt = r.spieler.filter(function (s) { return s.verbunden; }).map(function (s) { return s.id; }).join(",");
				if (jetzt === bekannt) return;
				bekannt = jetzt;
				if (regeln.spielerGeaendert && zustand !== null) {
					var neu = regeln.spielerGeaendert(kopie(zustand), r.spieler);
					if (neu !== undefined) zustand = kopie(neu);
				}
				verteilen();
			});
			if (!r.istHost) {
				zeigen(null);
				r.senden({ __gs: "hallo" }, "host");
			}
			var api = {
				get raum() { return r; },
				get laeuft() { return zustand !== null; },   // nur beim Host aussagekräftig
				zug: function (aktion) {
					if (!r.istHost) { r.senden({ __gs: "zug", aktion: aktion === undefined ? null : aktion }, "host"); return; }
					try { anwenden(aktion, r.ich); } catch (e) { fehler(String((e && e.message) || e)); }
				},
				neu: function (optionen) {
					if (!r.istHost) throw new Error("GameSave: Nur der Host startet ein neues Spiel");
					var ids = r.spieler.filter(function (s) { return s.verbunden && !s.zuschauer; }).map(function (s) { return s.id; });
					zustand = kopie(regeln.neu(ids, optionen === undefined ? null : kopie(optionen), zustand === null ? null : kopie(zustand)));
					verteilen();
				},
			};
			// Erst fertig melden, wenn ein schon wartender Spielstand übernommen ist (beiHostwerden ruft ihn per setTimeout auf) –
			// sonst würde ein sofortiges neu() danach vom alten Stand (null) überschrieben.
			return new Promise(function (ja) { setTimeout(function () { ja(api); }); });
		});
	}

	var Mehrspieler = Object.freeze({
		get verfuegbar() { return inBibliothek ? !!vorab.mp : typeof BroadcastChannel === "function"; },
		raum: raum,
		spiel: spiel,
	});

	// --- GameSave-API ---
	var lokal = {}; // nur außerhalb der Bibliothek
	var lokaleErfolge = {};
	var GameSave = {
		available: inBibliothek,
		version: vorab.version,   // Versionsnummer des Spiels, z. B. "1.2.0" (vergibt die Bibliothek beim Veröffentlichen), sonst null

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
				// Beim Testen eines Entwurfs meldet die Bibliothek das Ergebnis der Umwandlung für die
				// Prüfung vor dem Veröffentlichen (nur Entwürfe, sonst ignoriert die Bibliothek die Meldung)
				var von = (ergebnis && ergebnis.version) || 1;
				try {
					var r = aufbereiten(ergebnis, optionen, vorab.saveVersion);
					if (inBibliothek && r && r.migriert) senden({ gs: 1, op: "migration", key: key, von: von, nach: vorab.saveVersion, ok: true });
					return r;
				} catch (e) {
					if (inBibliothek) senden({ gs: 1, op: "migration", key: key, von: von, nach: vorab.saveVersion, ok: false,
						fehler: String((e && e.message) || e).slice(0, 200) });
					throw e;
				}
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
		// Erfolge (Zentrale 1.2.0): in der game.json unter "erfolge" festlegen, im Spiel freischalten.
		// Liefert { neu: true } beim ersten Mal – die Bibliothek zeigt dann selbst eine Meldung.
		erfolg: function (id) {
			return Promise.resolve().then(function () {
				if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) {
					throw new Error("GameSave: Erfolg-ID nur aus a–z, 0–9, _ und - (max. 40 Zeichen)");
				}
				if (!inBibliothek) { lokaleErfolge[id] = true; return { neu: true }; }
				return anfrage("erfolg", { erfolgId: id });
			});
		},
		// [{ id, titel, beschreibung, bild, geheim, freigeschaltet }] – freigeschaltet = Zeitpunkt oder null
		erfolge: function () {
			if (!inBibliothek) return Promise.resolve(Object.keys(lokaleErfolge).map(function (id) { return { id: id, freigeschaltet: true }; }));
			return anfrage("erfolge", {});
		},
		// Multiplayer (Zentrale 1.6.0): siehe oben und Handbuch, Kapitel „Multiplayer“
		multiplayer: Mehrspieler,
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
