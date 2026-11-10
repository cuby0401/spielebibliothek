// Aussehen sofort setzen, bevor die Seite gezeichnet wird (kein weißes Aufblitzen im dunklen Thema).
// Synchron im <head> laden, VOR den Stylesheets. Quelle ist der Zwischenspeicher „sb-aussehen“, den
// UI.aussehenAnwenden() nach jedem Laden der Einstellungen vom Server auffrischt. Ohne Zwischenspeicher: folgt dem Gerät.
(function () {
	"use strict";
	var ERLAUBT = { thema: ["hell", "dunkel"], akzent: ["gruen", "tuerkis", "violett", "rosa", "orange"],
		dichte: ["kompakt", "luftig"], kachel: ["klein", "gross"] };
	try {
		var a = JSON.parse(localStorage.getItem("sb-aussehen") || "{}") || {};
		var wurzel = document.documentElement;
		var werte = { thema: a.thema, akzent: a.akzent, dichte: a.dichte, kachel: a.kachelgroesse };
		for (var k in ERLAUBT) if (ERLAUBT[k].indexOf(werte[k]) >= 0) wurzel.setAttribute("data-" + k, werte[k]);
	} catch (e) { /* privates Fenster o. Ä.: dann eben Standard */ }
})();
