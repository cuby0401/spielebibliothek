// Spielebibliothek – Bausteine (window.UI). Der Pflicht-Werkzeugkasten für jede Oberfläche der Zentrale.
//
// Regeln (docs/ui-bausteine.md, docs/entwicklung.md):
//  - Jede Fabrik nimmt EIN Optionsobjekt und gibt ein DOM-Element zurück (Dialoge: ein Promise).
//  - Texte immer per textContent. Keine Fabrik nimmt HTML an. Einzige innerHTML-Stelle: Icons aus ikonen.js.
//  - Aussehen nur über Klassen .b-… aus bausteine.css und Tokens --b-… aus tokens.css. Keine Inline-Farben.
//  - Fehlt etwas: zuerst hier einen Baustein ergänzen (mit Eintrag in docs/ui-bausteine.md), dann die Seite bauen.
// Laden: tokens.css, bausteine.css, ikonen.js, bausteine.js (klassische Skripte, ohne Build, CSP script-src 'self').
(function () {
	"use strict";

	// ---------- Grundlagen ----------
	let zaehler = 0;
	const neueId = (vorsilbe) => `${vorsilbe || "b"}-${++zaehler}`;
	const SVG_NS = "http://www.w3.org/2000/svg";

	// h("button", {text, class, onclick, …}, …kinder) – gleiche Signatur wie früher in konto.js
	function h(tag, eigenschaften, ...kinder) {
		const e = document.createElement(tag);
		for (const [k, v] of Object.entries(eigenschaften || {})) {
			if (v === false || v === undefined || v === null) continue;
			if (k === "text") e.textContent = v;
			else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
			else if (v === true) e.setAttribute(k, "");
			else e.setAttribute(k, v);
		}
		anhaengen(e, kinder);
		return e;
	}
	function anhaengen(e, kinder) {
		for (const kind of [kinder].flat(Infinity)) {
			if (kind === null || kind === undefined || kind === false) continue;
			e.append(typeof kind === "number" ? String(kind) : kind);
		}
		return e;
	}
	const klassen = (...k) => k.filter(Boolean).join(" ");

	function ikon(name, { groesse } = {}) {
		const pfade = (window.UI_IKONEN || {})[name];
		const s = document.createElementNS(SVG_NS, "svg");
		s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", klassen("b-ikon", groesse && `b-ikon--${groesse}`));
		s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
		s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
		s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
		if (pfade) s.innerHTML = pfade;   // konstante Pfade aus ikonen.js
		else console.warn("UI.ikon: unbekanntes Icon", name);
		return s;
	}
	const pruefen = (bedingung, text) => { if (!bedingung) throw new Error("UI: " + text); };

	// ---------- Aktionen ----------
	// art: primaer | standard | leise | gefahr | gefahr-leise; groesse: s | m | l
	function knopf(o = {}) {
		const nurIkon = !!o.nurIkon;
		if (nurIkon) pruefen(o.label, "knopf mit nurIkon braucht label (wird vorgelesen)");
		const tag = o.href ? "a" : "button";
		const k = h(tag, {
			class: klassen("b-knopf", `b-knopf--${o.art || "standard"}`, o.groesse && o.groesse !== "m" && `b-knopf--${o.groesse}`,
				nurIkon && "b-knopf--nur-ikon", o.breit && "b-knopf--breit", o.klasse),
			type: tag === "button" ? (o.typ || "button") : null, href: o.href || null, id: o.id, title: o.titel || (nurIkon ? o.label : null),
			"aria-label": nurIkon ? o.label : o.label || null, target: o.neuesFenster ? "_blank" : null, rel: o.neuesFenster ? "noopener" : null,
			onclick: o.onclick,
		});
		if (o.ikon) k.append(ikon(o.ikon));
		if (!nurIkon && o.text) k.append(h("span", { class: "b-knopf__text", text: o.text }));
		if (o.ikonRechts) k.append(ikon(o.ikonRechts));
		if (o.zahl) k.append(h("span", { class: "b-zahl", text: String(o.zahl) }));
		k.laden = (an) => { k.toggleAttribute("data-laedt", !!an); k.setAttribute("aria-busy", an ? "true" : "false"); if (tag === "button") k.disabled = !!an || !!k.dataset.aus; };
		k.aus = (an) => { if (an) k.dataset.aus = "1"; else delete k.dataset.aus; if (tag === "button") k.disabled = !!an; else k.setAttribute("aria-disabled", an ? "true" : "false"); };
		if (o.deaktiviert) k.aus(true);
		if (o.laedt) k.laden(true);
		return k;
	}
	// Mehrere Knöpfe nebeneinander, rechtsbündig (Dialog-/Formularfuß) oder links
	const knopfleiste = (knoepfe, { ausrichtung } = {}) =>
		h("div", { class: klassen("b-knopfleiste", ausrichtung === "links" && "b-knopfleiste--links", ausrichtung === "verteilt" && "b-knopfleiste--verteilt") }, knoepfe);

	// Segment-Wahl (wie in iOS): wenige feste Möglichkeiten, eine aktiv. optionen: [[wert, text, ikon?], …]
	function segment(o = {}) {
		const id = o.id || neueId("seg");
		const gruppe = h("div", { class: "b-segment", role: "radiogroup", id, "aria-label": o.label || null });
		const knoepfe = o.optionen.map(([wert, text, ik]) => {
			const k = h("button", { type: "button", role: "radio", class: "b-segment__wahl", "data-wert": wert, "aria-checked": String(wert === o.wert), tabindex: wert === o.wert ? "0" : "-1" },
				ik ? ikon(ik) : null, h("span", { text }));
			k.addEventListener("click", () => setzen(wert, true));
			return k;
		});
		function setzen(wert, melden) {
			for (const k of knoepfe) { const an = k.dataset.wert === wert; k.setAttribute("aria-checked", String(an)); k.tabIndex = an ? 0 : -1; }
			gruppe.dataset.wert = wert;
			if (melden && o.onwechsel) o.onwechsel(wert);
		}
		gruppe.addEventListener("keydown", (ev) => pfeilNavigation(ev, knoepfe, (k) => { k.focus(); setzen(k.dataset.wert, true); }));
		gruppe.append(...knoepfe);
		setzen(o.wert ?? (o.optionen[0] || [])[0], false);
		Object.defineProperty(gruppe, "wert", { configurable: true, get: () => gruppe.dataset.wert, set: (w) => setzen(w, false) });
		return mitLabel(gruppe, o, id, "div");
	}
	function pfeilNavigation(ev, liste, waehlen, { senkrecht = false } = {}) {
		const vor = senkrecht ? "ArrowDown" : "ArrowRight", zurueck = senkrecht ? "ArrowUp" : "ArrowLeft";
		const i = liste.indexOf(document.activeElement.closest("button, a, [role]"));
		let ziel = null;
		if (ev.key === vor || (!senkrecht && ev.key === "ArrowDown")) ziel = liste[(i + 1) % liste.length];
		else if (ev.key === zurueck || (!senkrecht && ev.key === "ArrowUp")) ziel = liste[(i - 1 + liste.length) % liste.length];
		else if (ev.key === "Home") ziel = liste[0];
		else if (ev.key === "End") ziel = liste[liste.length - 1];
		if (ziel) { ev.preventDefault(); waehlen(ziel); }
	}

	// ---------- Formular ----------
	// Gemeinsamer Rahmen: Label oben, Feld, Hinweis, Fehler darunter (Stripe-Muster)
	// anzeige = was im Rahmen steht (das Feld selbst oder eine Hülle darum, z. B. mit Pfeil oder Passwort-Auge)
	function feldRahmen(o, steuer, id, anzeige) {
		const hinweisId = id + "-hinweis", fehlerId = id + "-fehler";
		const hinweis = o.hinweis ? h("p", { class: "b-feld__hinweis", id: hinweisId, text: o.hinweis }) : null;
		const fehler = h("p", { class: "b-feld__fehler", id: fehlerId, role: "alert", hidden: true });
		steuer.setAttribute("aria-describedby", [hinweis && hinweisId, fehlerId].filter(Boolean).join(" "));
		const label = o.label ? h("label", { class: "b-feld__label", for: id },
			o.label, o.pflicht ? null : (o.optional ? h("span", { class: "b-feld__optional", text: " (optional)" }) : null)) : null;
		const rahmen = h("div", { class: klassen("b-feld", o.klasse) }, label, anzeige || steuer, hinweis, fehler);
		rahmen.eingabe = steuer;
		rahmen.fehlerSetzen = (text) => {
			fehler.textContent = text || ""; fehler.hidden = !text;
			steuer.setAttribute("aria-invalid", text ? "true" : "false");
		};
		Object.defineProperty(rahmen, "wert", { configurable: true,
			get: () => (steuer.type === "checkbox" ? steuer.checked : steuer.value),
			set: (w) => { if (steuer.type === "checkbox") steuer.checked = !!w; else steuer.value = w ?? ""; },
		});
		if (o.fehler) rahmen.fehlerSetzen(o.fehler);
		return rahmen;
	}
	function mitLabel(steuer, o, id, art) {
		if (!o.label || o.ohneLabel) return steuer;
		const rahmen = h("div", { class: "b-feld" },
			h(art === "div" ? "span" : "label", { class: "b-feld__label", id: id + "-label", for: art === "div" ? null : id, text: o.label }),
			steuer, o.hinweis ? h("p", { class: "b-feld__hinweis", text: o.hinweis }) : null);
		if (art === "div") { steuer.setAttribute("aria-labelledby", id + "-label"); steuer.removeAttribute("aria-label"); }
		Object.defineProperty(rahmen, "wert", { configurable: true, get: () => steuer.wert, set: (w) => { steuer.wert = w; } });
		rahmen.eingabe = steuer;
		return rahmen;
	}

	// Textfeld. typ: text | email | password | number | date | datetime-local | time | url | search
	function feld(o = {}) {
		const id = o.id || neueId("feld");
		const eingabe = h("input", {
			class: "b-eingabe", id, name: o.name || null, type: o.typ || "text", value: o.wert ?? null, placeholder: o.platzhalter || null,
			required: !!o.pflicht, autocomplete: o.autocomplete || null, maxlength: o.max || null, min: o.min ?? null,
			inputmode: o.inputmode || null, readonly: !!o.nurLesen, disabled: !!o.deaktiviert, spellcheck: o.typ === "email" || o.typ === "password" ? "false" : null,
			oninput: o.oninput ? (ev) => o.oninput(ev.target.value, ev) : null, onchange: o.onchange ? (ev) => o.onchange(ev.target.value, ev) : null,
		});
		let huelle = null;
		if (o.typ === "password") {
			huelle = h("div", { class: "b-feld__huelle" }, eingabe);
			const zeigen = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "auge", label: "Passwort zeigen", klasse: "b-feld__zusatz",
				onclick: () => { const an = eingabe.type === "password"; eingabe.type = an ? "text" : "password"; zeigen.setAttribute("aria-pressed", String(an)); } });
			zeigen.setAttribute("aria-pressed", "false");
			huelle.append(zeigen);
		}
		return feldRahmen(o, eingabe, id, huelle);
	}
	function textbereich(o = {}) {
		const id = o.id || neueId("text");
		const t = h("textarea", { class: "b-eingabe b-eingabe--text", id, name: o.name || null, rows: String(o.zeilen || 4), placeholder: o.platzhalter || null,
			required: !!o.pflicht, maxlength: o.max || null, disabled: !!o.deaktiviert,
			oninput: o.oninput ? (ev) => o.oninput(ev.target.value, ev) : null });
		t.value = o.wert || "";
		return feldRahmen(o, t, id);
	}
	// Auswahlliste (nativ, damit Handy und Tastatur gut funktionieren). optionen: [[wert, text], …] oder [{gruppe, optionen}]
	function auswahl(o = {}) {
		const id = o.id || neueId("wahl");
		const s = h("select", { class: "b-eingabe b-eingabe--wahl", id, name: o.name || null, required: !!o.pflicht, disabled: !!o.deaktiviert,
			onchange: o.onchange ? (ev) => o.onchange(ev.target.value, ev) : null });
		const option = ([wert, text]) => { const op = h("option", { value: wert, text }); if (wert === o.wert) op.selected = true; return op; };
		if (o.platzhalter) s.append(h("option", { value: "", text: o.platzhalter, disabled: true, selected: o.wert == null }));
		for (const x of o.optionen || []) s.append(Array.isArray(x) ? option(x) : h("optgroup", { label: x.gruppe }, x.optionen.map(option)));
		const huelle = h("div", { class: "b-feld__huelle b-feld__huelle--wahl" }, s, ikon("winkel-runter"));
		return feldRahmen(o, s, id, huelle);
	}
	// Schalter (an/aus mit sofortiger Wirkung), als ganze Zeile: Text links, Schalter rechts
	function schalter(o = {}) {
		const id = o.id || neueId("schalter");
		const k = h("button", { type: "button", role: "switch", class: "b-schalter", id, "aria-checked": String(!!o.an), disabled: !!o.deaktiviert },
			h("span", { class: "b-schalter__knopf" }));
		const zeile = h("div", { class: klassen("b-schalter-zeile", o.klasse) },
			h("div", { class: "b-schalter-zeile__text" },
				h("label", { for: id, class: "b-schalter-zeile__titel", id: id + "-label", text: o.label }),
				o.hinweis ? h("p", { class: "b-feld__hinweis", id: id + "-hinweis", text: o.hinweis }) : null),
			k);
		k.setAttribute("aria-labelledby", id + "-label");
		if (o.hinweis) k.setAttribute("aria-describedby", id + "-hinweis");
		k.addEventListener("click", () => { const an = k.getAttribute("aria-checked") !== "true"; k.setAttribute("aria-checked", String(an)); if (o.onwechsel) o.onwechsel(an); });
		Object.defineProperty(zeile, "wert", { configurable: true, get: () => k.getAttribute("aria-checked") === "true", set: (w) => k.setAttribute("aria-checked", String(!!w)) });
		zeile.eingabe = k;
		return zeile;
	}
	function haken(o = {}) {
		const id = o.id || neueId("haken");
		const c = h("input", { type: "checkbox", class: "b-haken__kasten", id, name: o.name || null, value: o.wertName || null, disabled: !!o.deaktiviert,
			onchange: o.onwechsel ? (ev) => o.onwechsel(ev.target.checked, ev) : null });
		c.checked = !!o.an;
		const z = h("div", { class: klassen("b-haken", o.klasse) }, c,
			h("div", {}, h("label", { for: id, class: "b-haken__text", text: o.label }), o.hinweis ? h("p", { class: "b-feld__hinweis", text: o.hinweis }) : null));
		Object.defineProperty(z, "wert", { configurable: true, get: () => c.checked, set: (w) => { c.checked = !!w; } });
		z.eingabe = c;
		return z;
	}
	// Radio-Gruppe für 2–6 sich ausschließende Möglichkeiten mit Erklärung. optionen: [[wert, text, hinweis?], …]
	function radio(o = {}) {
		const name = o.name || neueId("radio");
		const fs = h("fieldset", { class: klassen("b-radio", o.klasse) }, o.label ? h("legend", { class: "b-feld__label", text: o.label }) : null);
		for (const [wert, text, hinweis] of o.optionen || []) {
			const id = neueId("radio");
			const r = h("input", { type: "radio", class: "b-radio__punkt", name, id, value: wert, onchange: o.onwechsel ? () => o.onwechsel(wert) : null });
			r.checked = wert === o.wert;
			fs.append(h("div", { class: "b-radio__wahl" }, r,
				h("div", {}, h("label", { for: id, class: "b-haken__text", text }), hinweis ? h("p", { class: "b-feld__hinweis", text: hinweis }) : null)));
		}
		Object.defineProperty(fs, "wert", { configurable: true,
			get: () => (fs.querySelector("input:checked") || {}).value,
			set: (w) => { for (const r of fs.querySelectorAll("input")) r.checked = r.value === w; },
		});
		return fs;
	}
	// Datei wählen oder hineinziehen. ondatei(dateien[]) – Prüfung (Größe, Typ) macht der Aufrufer
	function datei(o = {}) {
		const id = o.id || neueId("datei");
		const input = h("input", { type: "file", id, class: "b-datei__input", accept: o.accept || null, multiple: !!o.mehrfach, name: o.name || null });
		const text = h("span", { class: "b-datei__text", text: o.text || (o.mehrfach ? "Dateien hierher ziehen oder auswählen" : "Datei hierher ziehen oder auswählen") });
		const auswahlText = h("span", { class: "b-datei__auswahl", hidden: true });
		const flaeche = h("label", { class: "b-datei", for: id }, ikon("hochladen", { groesse: "l" }), text, auswahlText, input);
		const melden = (liste) => {
			const dateien = [...(liste || [])];
			auswahlText.hidden = !dateien.length;
			auswahlText.textContent = dateien.length === 1 ? dateien[0].name : dateien.length ? `${dateien.length} Dateien` : "";
			if (o.ondatei && dateien.length) o.ondatei(dateien);
		};
		input.addEventListener("change", () => melden(input.files));
		for (const ev of ["dragenter", "dragover"]) flaeche.addEventListener(ev, (e) => { e.preventDefault(); flaeche.dataset.ziehen = "1"; });
		for (const ev of ["dragleave", "drop"]) flaeche.addEventListener(ev, () => { delete flaeche.dataset.ziehen; });
		flaeche.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) { try { input.files = e.dataTransfer.files; } catch (_) { /* Safari alt */ } melden(e.dataTransfer.files); } });
		const r = feldRahmen(o, input, id, flaeche);
		r.leeren = () => { input.value = ""; melden([]); };
		Object.defineProperty(r, "wert", { configurable: true, get: () => [...input.files] });
		return r;
	}
	// Suchfeld mit Lupe, Löschen-Knopf und Verzögerung (tippt man schnell, wird nur einmal gesucht)
	function suche(o = {}) {
		const id = o.id || neueId("suche");
		const eingabe = h("input", { type: "search", class: "b-suche__eingabe", id, placeholder: o.platzhalter || "Suchen", value: o.wert || null,
			"aria-label": o.label || o.platzhalter || "Suchen", autocomplete: "off", enterkeyhint: "search" });
		let warten;
		const leeren = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "schliessen", label: "Suche leeren", klasse: "b-suche__leeren",
			onclick: () => { eingabe.value = ""; aktualisieren(); eingabe.focus(); if (o.oninput) o.oninput(""); } });
		const aktualisieren = () => { leeren.hidden = !eingabe.value; };
		eingabe.addEventListener("input", () => {
			aktualisieren(); clearTimeout(warten);
			if (o.oninput) warten = setTimeout(() => o.oninput(eingabe.value.trim()), o.verzoegerung ?? 200);
		});
		eingabe.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && eingabe.value) { ev.preventDefault(); leeren.click(); } });
		const s = h("div", { class: klassen("b-suche", o.klasse), role: "search" }, ikon("suche"), eingabe, leeren);
		aktualisieren();
		Object.defineProperty(s, "wert", { configurable: true, get: () => eingabe.value.trim(), set: (w) => { eingabe.value = w || ""; aktualisieren(); } });
		s.eingabe = eingabe;
		return s;
	}
	// Formular: verhindert Neuladen, sperrt den Hauptknopf während onabsenden läuft, zeigt Fehler als Meldung
	function formular(o = {}) {
		const f = h("form", { class: klassen("b-formular", o.klasse), novalidate: true, id: o.id }, o.inhalt);
		const absenden = o.absenden === false ? null : knopf({ art: "primaer", typ: "submit", text: o.absenden || "Speichern" });
		if (absenden || o.aktionen) f.append(knopfleiste([...(o.aktionen || []), absenden]));
		f.addEventListener("submit", async (ev) => {
			ev.preventDefault();
			if (!f.checkValidity()) {
				for (const el of f.querySelectorAll(":invalid")) { const r = el.closest(".b-feld"); if (r && r.fehlerSetzen) r.fehlerSetzen(el.validationMessage); }
				const erstes = f.querySelector(":invalid"); if (erstes) erstes.focus();
				return;
			}
			for (const r of f.querySelectorAll(".b-feld")) if (r.fehlerSetzen) r.fehlerSetzen("");
			if (!o.onabsenden) return;
			if (absenden) absenden.laden(true);
			try { await o.onabsenden(new FormData(f), f); }
			catch (e) { meldung(e && e.message ? e.message : String(e), { art: "fehler" }); }
			finally { if (absenden) absenden.laden(false); }
		});
		f.absendenKnopf = absenden;
		return f;
	}

	// ---------- Inhalt ----------
	// Karte: eine abgeschlossene Einheit (Einstellungsblock, Personenblock). titel, untertitel, aktionen (rechts oben), inhalt, fuss
	function karte(o = {}) {
		const kopf = o.titel || o.aktionen ? h("div", { class: "b-karte__kopf" },
			h("div", { class: "b-karte__titelblock" },
				o.titel ? h(o.ebene || "h3", { class: "b-karte__titel", text: o.titel }) : null,
				o.untertitel ? h("p", { class: "b-karte__untertitel", text: o.untertitel }) : null),
			o.aktionen ? h("div", { class: "b-karte__aktionen" }, o.aktionen) : null) : null;
		const k = h(o.onclick || o.href ? (o.href ? "a" : "button") : "section", {
			class: klassen("b-karte", (o.onclick || o.href) && "b-karte--klickbar", o.art && `b-karte--${o.art}`, o.flach && "b-karte--flach", o.klasse),
			href: o.href || null, type: o.onclick && !o.href ? "button" : null, onclick: o.onclick || null, id: o.id,
		}, kopf, o.inhalt != null ? h("div", { class: "b-karte__inhalt" }, o.inhalt) : null, o.fuss ? h("div", { class: "b-karte__fuss" }, o.fuss) : null);
		return k;
	}
	// Spielkachel. bild (URL) oder farbe 1–4 als Fläche; marken [{text, art}], fortschritt 0..1, favorit true/false (zeigt Stern-Knopf)
	function spielkachel(o = {}) {
		const bild = h("div", { class: klassen("b-kachel__bild", !o.bild && `b-kachel__bild--${o.farbe || 1 + (Math.abs(hashText(o.titel || "")) % 4)}`) });
		if (o.bild) bild.append(h("img", { src: o.bild, alt: "", loading: "lazy", decoding: "async" }));
		else bild.append(ikon(o.ikon || "spiel", { groesse: "xl" }));
		if (o.marken && o.marken.length) bild.append(h("div", { class: "b-kachel__marken" }, o.marken.map((m) => marke(typeof m === "string" ? { text: m } : { ...m, klein: true }))));
		const ziel = h(o.href ? "a" : "button", { class: "b-kachel__ziel", href: o.href || null, type: o.href ? null : "button", onclick: o.onclick || null,
			"aria-label": o.untertitel ? `${o.titel}, ${o.untertitel}` : o.titel });
		const text = h("div", { class: "b-kachel__text" },
			h("span", { class: "b-kachel__titel", text: o.titel }),
			o.untertitel ? h("span", { class: "b-kachel__untertitel", text: o.untertitel }) : null,
			o.fortschritt != null ? fortschritt({ wert: o.fortschritt, max: 1, label: o.fortschrittLabel || "Fortschritt", klein: true }) : null);
		const k = h("article", { class: klassen("b-kachel", o.klasse), id: o.id, "data-id": o.spielId || null }, bild, text, ziel);
		if (o.favorit !== undefined) {
			const stern = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "stern", label: o.favorit ? "Aus Favoriten entfernen" : "Zu Favoriten", klasse: "b-kachel__stern" });
			stern.setAttribute("aria-pressed", String(!!o.favorit));
			stern.addEventListener("click", (ev) => {
				ev.stopPropagation();
				const an = stern.getAttribute("aria-pressed") !== "true";
				stern.setAttribute("aria-pressed", String(an)); stern.setAttribute("aria-label", an ? "Aus Favoriten entfernen" : "Zu Favoriten"); stern.title = stern.getAttribute("aria-label");
				if (o.onfavorit) o.onfavorit(an);
			});
			k.append(stern);
		}
		return k;
	}
	function hashText(t) { let x = 0; for (let i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) | 0; return x; }

	// Liste aus Zeilen (Einstellungen, Meldungen, Personen). zeilen: [{ikon|avatar, titel, text, rechts, onclick|href, gefahr}]
	function liste(zeilen, o = {}) {
		return h("ul", { class: klassen("b-liste", o.ohneRahmen && "b-liste--ohne-rahmen", o.klasse), "aria-label": o.label || null },
			(zeilen || []).map((z) => h("li", { class: "b-liste__eintrag" }, z instanceof Node ? z : zeile(z))));
	}
	function zeile(o = {}) {
		const tag = o.href ? "a" : o.onclick ? "button" : "div";
		return h(tag, { class: klassen("b-zeile", tag !== "div" && "b-zeile--klickbar", o.gefahr && "b-zeile--gefahr", o.ungelesen && "b-zeile--neu", o.klasse),
			href: o.href || null, type: tag === "button" ? "button" : null, onclick: o.onclick || null, id: o.id },
			o.avatar ? avatar(typeof o.avatar === "string" ? { name: o.avatar } : o.avatar) : o.ikon ? h("span", { class: "b-zeile__ikon" }, ikon(o.ikon)) : null,
			h("span", { class: "b-zeile__text" },
				h("span", { class: "b-zeile__titel", text: o.titel }),
				o.text ? h("span", { class: "b-zeile__unter", text: o.text }) : null),
			o.rechts != null ? h("span", { class: "b-zeile__rechts" }, typeof o.rechts === "string" ? h("span", { text: o.rechts }) : o.rechts) : null,
			tag !== "div" && o.pfeil !== false ? ikon("winkel-rechts") : null);
	}
	// Tabelle. spalten: [{titel, feld | wert(zeile) → Text/Element, rechts, sortierbar, breite, mono}]; zeilen: Objekte
	function tabelle(o = {}) {
		let sortSpalte = null, absteigend = false;
		const tbody = h("tbody");
		const koepfe = o.spalten.map((s, i) => {
			const th = h("th", { scope: "col", class: klassen(s.rechts && "b-tabelle--rechts"), style: s.breite ? `width:${s.breite}` : null });
			if (s.sortierbar) {
				const k = h("button", { type: "button", class: "b-tabelle__sort" }, h("span", { text: s.titel }), ikon("sortieren"));
				k.addEventListener("click", () => { absteigend = sortSpalte === i ? !absteigend : false; sortSpalte = i; zeichnen(); });
				th.append(k);
			} else th.textContent = s.titel;
			return th;
		});
		const wertVon = (s, z) => (s.wert ? s.wert(z) : z[s.feld]);
		const sortWert = (s, z) => { const w = s.sortWert ? s.sortWert(z) : wertVon(s, z); return w instanceof Node ? w.textContent : w; };
		function zeichnen() {
			let zeilen = [...(o.zeilen || [])];
			koepfe.forEach((th, i) => th.setAttribute("aria-sort", i === sortSpalte ? (absteigend ? "descending" : "ascending") : "none"));
			if (sortSpalte != null) {
				const s = o.spalten[sortSpalte];
				zeilen.sort((a, b) => { const x = sortWert(s, a), y = sortWert(s, b);
					const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "de", { numeric: true });
					return absteigend ? -r : r; });
			}
			tbody.replaceChildren(...(zeilen.length ? zeilen.map((z) => {
				const tr = h("tr", { class: klassen(o.onzeile && "b-tabelle__klickbar"), tabindex: o.onzeile ? "0" : null, "data-schluessel": o.schluessel ? z[o.schluessel] : null });
				for (const s of o.spalten) {
					const w = wertVon(s, z);
					tr.append(h("td", { class: klassen(s.rechts && "b-tabelle--rechts", s.mono && "b-tabelle--mono", s.leise && "b-tabelle--leise") }, w instanceof Node ? w : (w ?? "–")));
				}
				if (o.onzeile) {
					tr.addEventListener("click", (ev) => { if (!ev.target.closest("button, a, input, select")) o.onzeile(z, ev); });
					tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target === tr) o.onzeile(z, ev); });
				}
				return tr;
			}) : [h("tr", {}, h("td", { colspan: String(o.spalten.length), class: "b-tabelle__leer" }, typeof o.leer === "string" || !o.leer ? (o.leer || "Noch keine Einträge.") : o.leer))]));
		}
		zeichnen();
		const t = h("div", { class: klassen("b-tabelle", o.klasse) }, h("table", {}, o.titel ? h("caption", { class: "b-unsichtbar", text: o.titel }) : null, h("thead", {}, h("tr", {}, koepfe)), tbody));
		t.zeilenSetzen = (z) => { o.zeilen = z; zeichnen(); };
		return t;
	}
	// Kennzahl (Admin-Übersicht): großer Wert, Beschriftung darunter. onclick macht sie klickbar
	function kennzahl(o = {}) {
		return h(o.onclick || o.href ? (o.href ? "a" : "button") : "div", {
			class: klassen("b-kennzahl", (o.onclick || o.href) && "b-kennzahl--klickbar", o.art && `b-kennzahl--${o.art}`, o.klasse),
			type: o.onclick && !o.href ? "button" : null, href: o.href || null, onclick: o.onclick || null, id: o.id },
			h("span", { class: "b-kennzahl__wert", text: String(o.wert ?? "–") }),
			h("span", { class: "b-kennzahl__label", text: o.label }),
			o.hinweis ? h("span", { class: "b-kennzahl__hinweis", text: o.hinweis }) : null);
	}
	function fortschritt(o = {}) {
		const max = o.max || 100, wert = Math.max(0, Math.min(max, o.wert || 0));
		const p = h("div", { class: klassen("b-fortschritt", o.klein && "b-fortschritt--klein", o.art && `b-fortschritt--${o.art}`), role: "progressbar",
			"aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": String(wert), "aria-label": o.label || "Fortschritt" },
			h("span", { class: "b-fortschritt__balken", style: `width:${(wert / max) * 100}%` }));
		if (o.zeigeText) return h("div", { class: "b-fortschritt-zeile" }, p, h("span", { class: "b-fortschritt__text", text: o.zeigeText === true ? `${Math.round((wert / max) * 100)} %` : o.zeigeText }));
		return p;
	}
	// Marke / Status / Chip. art: neutral | akzent | erfolg | warnung | gefahr | info. onentfernen macht daraus einen Chip mit ×
	function marke(o = {}) {
		if (typeof o === "string") o = { text: o };
		const m = h(o.onclick ? "button" : "span", { class: klassen("b-marke", `b-marke--${o.art || "neutral"}`, o.klein && "b-marke--klein", o.punkt && "b-marke--punkt",
			o.onclick && "b-marke--klickbar", o.klasse), type: o.onclick ? "button" : null, onclick: o.onclick || null, "aria-pressed": o.an !== undefined ? String(!!o.an) : null },
			o.ikon ? ikon(o.ikon) : null, h("span", { text: o.text }));
		if (o.onentfernen) m.append(knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "schliessen", label: `${o.text} entfernen`, klasse: "b-marke__weg", onclick: o.onentfernen }));
		return m;
	}
	// Avatar mit Initialen, Farbe fest aus dem Namen (jeder hat immer dieselbe). groesse: s | m | l | xl
	function avatar(o = {}) {
		const name = o.name || "?";
		const teile = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
		const initialen = ((teile[0] || "?")[0] + (teile.length > 1 ? teile[teile.length - 1][0] : (teile[0] || "")[1] || "")).toUpperCase();
		const a = h("span", { class: klassen("b-avatar", `b-avatar--${o.groesse || "m"}`, `b-avatar--f${1 + (Math.abs(hashText(name)) % 6)}`, o.klasse),
			title: o.titel || null, "aria-hidden": o.label ? null : "true", role: o.label ? "img" : null, "aria-label": o.label || null });
		if (o.bild) a.append(h("img", { src: o.bild, alt: "" })); else a.textContent = initialen;
		return a;
	}

	// ---------- Navigation ----------
	// Reiter. eintraege: [{id, text, zahl, ikon}], aktiv, onwechsel(id). Pfeiltasten wie bei echten Tabs.
	function reiter(o = {}) {
		const leiste = h("div", { class: klassen("b-reiter", o.klasse), role: "tablist", "aria-label": o.label || null, id: o.id });
		const knoepfe = o.eintraege.map((e) => {
			const k = h("button", { type: "button", role: "tab", class: "b-reiter__eintrag", id: (o.id || "reiter") + "-" + e.id, "data-id": e.id,
				"aria-controls": e.panel || null }, e.ikon ? ikon(e.ikon) : null, h("span", { text: e.text }), e.zahl ? h("span", { class: "b-zahl", text: String(e.zahl) }) : null);
			k.addEventListener("click", () => setzen(e.id, true));
			return k;
		});
		function setzen(id, melden) {
			for (const k of knoepfe) { const an = k.dataset.id === id; k.setAttribute("aria-selected", String(an)); k.tabIndex = an ? 0 : -1; }
			leiste.dataset.aktiv = id;
			if (melden && o.onwechsel) o.onwechsel(id);
		}
		leiste.addEventListener("keydown", (ev) => pfeilNavigation(ev, knoepfe, (k) => { k.focus(); setzen(k.dataset.id, true); }));
		leiste.append(...knoepfe);
		setzen(o.aktiv ?? o.eintraege[0].id, false);
		leiste.setzen = (id) => setzen(id, false);
		leiste.zahlSetzen = (id, zahl) => {
			const k = knoepfe.find((x) => x.dataset.id === id); if (!k) return;
			let z = k.querySelector(".b-zahl"); if (!zahl) { if (z) z.remove(); return; }
			if (!z) { z = h("span", { class: "b-zahl" }); k.append(z); } z.textContent = String(zahl);
		};
		return leiste;
	}
	// Seitenleiste (Konto-Bereich, Admin). gruppen: [{titel, eintraege: [{id, text, ikon, href, zahl}]}]. Auf dem Handy: waagerechte Leiste.
	function seitenleiste(o = {}) {
		const nav = h("nav", { class: klassen("b-seitenleiste", o.klasse), "aria-label": o.label || "Bereich" });
		for (const g of o.gruppen) {
			const ul = h("ul", { class: "b-seitenleiste__liste" });
			for (const e of g.eintraege) ul.append(h("li", {}, h("a", { class: "b-seitenleiste__eintrag", href: e.href || "#" + e.id, "data-id": e.id,
				"aria-current": e.id === o.aktiv ? "page" : null, onclick: o.onwechsel ? (ev) => { ev.preventDefault(); nav.setzen(e.id); o.onwechsel(e.id); } : null },
				e.ikon ? ikon(e.ikon) : null, h("span", { text: e.text }), e.zahl ? h("span", { class: "b-zahl", text: String(e.zahl) }) : null)));
			nav.append(h("div", { class: "b-seitenleiste__gruppe" }, g.titel ? h("p", { class: "b-seitenleiste__titel", text: g.titel }) : null, ul));
		}
		nav.setzen = (id) => { for (const a of nav.querySelectorAll(".b-seitenleiste__eintrag")) if (a.dataset.id === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); };
		return nav;
	}
	// Kopfleiste oben (Milchglas, klebt). marke {text, href}, mitte (z. B. Suche), rechts [Elemente]
	function kopfleiste(o = {}) {
		return h("header", { class: klassen("b-kopfleiste", o.klasse), id: o.id },
			h("div", { class: "b-kopfleiste__innen" },
				h("a", { class: "b-kopfleiste__marke", href: (o.marke || {}).href || "/" }, h("span", { class: "b-kopfleiste__zeichen", "aria-hidden": "true" }), h("span", { text: (o.marke || {}).text || "Spielebibliothek" })),
				o.mitte ? h("div", { class: "b-kopfleiste__mitte" }, o.mitte) : h("div", { class: "b-kopfleiste__mitte" }),
				h("div", { class: "b-kopfleiste__rechts" }, o.rechts || [])));
	}
	// Menü / Popover am Auslöser-Knopf. eintraege: [{text, ikon, onclick, href, gefahr} | "trenner" | {titel}] oder inhalt (Element, z. B. Glocke)
	let offenesMenue = null;
	function menue(o = {}) {
		pruefen(o.ausloeser, "menue braucht einen ausloeser (Knopf)");
		const id = o.id || neueId("menue");
		const feld = h("div", { class: klassen("b-menue", o.breit && "b-menue--breit", o.klasse), id, role: o.inhalt ? "dialog" : "menu", hidden: true,
			"aria-label": o.label || null, "data-ausrichtung": o.ausrichtung || "rechts" });
		const eintraege = [];
		if (o.inhalt) feld.append(o.inhalt);
		for (const e of o.eintraege || []) {
			if (e === "trenner") { feld.append(h("div", { class: "b-menue__trenner", role: "separator" })); continue; }
			if (e.titel) { feld.append(h("p", { class: "b-menue__titel", text: e.titel })); continue; }
			const k = h(e.href ? "a" : "button", { class: klassen("b-menue__eintrag", e.gefahr && "b-menue__eintrag--gefahr"), role: "menuitem", tabindex: "-1",
				type: e.href ? null : "button", href: e.href || null },
				e.ikon ? ikon(e.ikon) : null, h("span", { text: e.text }), e.rechts ? h("span", { class: "b-menue__rechts", text: e.rechts }) : null);
			k.addEventListener("click", (ev) => { schliessen(true); if (e.onclick) e.onclick(ev); });
			eintraege.push(k); feld.append(k);
		}
		const hulle = h("div", { class: "b-menue-anker" });
		o.ausloeser.setAttribute("aria-haspopup", o.inhalt ? "dialog" : "menu");
		o.ausloeser.setAttribute("aria-expanded", "false");
		o.ausloeser.setAttribute("aria-controls", id);
		function oeffnen() {
			if (offenesMenue && offenesMenue !== api) offenesMenue.schliessen(false);
			feld.hidden = false; o.ausloeser.setAttribute("aria-expanded", "true"); offenesMenue = api;
			if (o.onoeffnen) o.onoeffnen();
			const erstes = eintraege[0] || feld.querySelector("button, a, input, [tabindex]");
			if (erstes) setTimeout(() => erstes.focus(), 0);
		}
		function schliessen(fokusZurueck) {
			if (feld.hidden) return;
			feld.hidden = true; o.ausloeser.setAttribute("aria-expanded", "false");
			if (offenesMenue === api) offenesMenue = null;
			if (fokusZurueck) o.ausloeser.focus();
		}
		o.ausloeser.addEventListener("click", (ev) => { ev.stopPropagation(); if (feld.hidden) oeffnen(); else schliessen(false); });
		feld.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape") { ev.preventDefault(); schliessen(true); }
			else if (eintraege.length) pfeilNavigation(ev, eintraege, (k) => k.focus(), { senkrecht: true });
		});
		document.addEventListener("click", (ev) => { if (!feld.hidden && !feld.contains(ev.target) && !o.ausloeser.contains(ev.target)) schliessen(false); });
		hulle.append(o.ausloeser, feld);
		const api = { element: hulle, feld, oeffnen, schliessen: (f) => schliessen(f) };
		hulle.menue = api;
		return hulle;
	}
	// Abschnitt (Startseiten-Reihe, Seitenbereich). titel, untertitel, alle {text, href, onclick}, aktionen, inhalt, einklappbar
	function abschnitt(o = {}) {
		const id = o.id || neueId("abschnitt");
		const kopf = h("div", { class: "b-abschnitt__kopf" },
			h("div", { class: "b-abschnitt__titelblock" },
				h(o.ebene || "h2", { class: "b-abschnitt__titel", id: id + "-titel", text: o.titel }),
				o.untertitel ? h("p", { class: "b-abschnitt__untertitel", text: o.untertitel }) : null),
			h("div", { class: "b-abschnitt__aktionen" }, o.aktionen || [],
				o.alle ? h(o.alle.href ? "a" : "button", { class: "b-abschnitt__alle", href: o.alle.href || null, type: o.alle.href ? null : "button", onclick: o.alle.onclick || null },
					h("span", { text: o.alle.text || "Alle anzeigen" }), ikon("winkel-rechts")) : null));
		const inhalt = h("div", { class: "b-abschnitt__inhalt", id: id + "-inhalt" }, o.inhalt);
		const s = h("section", { class: klassen("b-abschnitt", o.klasse), "aria-labelledby": id + "-titel", id }, kopf, inhalt);
		if (o.einklappbar) {
			const k = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "winkel-runter", label: "Ein- oder ausklappen", klasse: "b-abschnitt__klappe" });
			const setzen = (offen) => { k.setAttribute("aria-expanded", String(offen)); inhalt.hidden = !offen; s.dataset.offen = offen ? "1" : "0"; };
			k.setAttribute("aria-controls", id + "-inhalt");
			k.addEventListener("click", () => { const offen = inhalt.hidden; setzen(offen); if (o.onklappen) o.onklappen(offen); });
			kopf.querySelector(".b-abschnitt__aktionen").append(k);
			setzen(o.offen !== false);
		}
		s.inhalt = inhalt;
		return s;
	}

	// ---------- Layout ----------
	// Kachelraster (Spiele): Spaltenbreite folgt der Kachelgröße des Spielers. reihe: waagerecht scrollen (Startseite)
	const raster = (kinder, o = {}) => h("div", { class: klassen("b-raster", o.art && `b-raster--${o.art}`, o.klasse), id: o.id }, kinder);
	const reihe = (kinder, o = {}) => h("div", { class: klassen("b-reihe", o.klasse), id: o.id, role: "list" }, [kinder].flat().map((k) => { k.setAttribute("role", "listitem"); return k; }));
	// Senkrechter Stapel mit gleichem Abstand; abstand: s | m | l
	const stapel = (kinder, o = {}) => h("div", { class: klassen("b-stapel", o.abstand && `b-stapel--${o.abstand}`, o.klasse), id: o.id }, kinder);
	// Waagerecht nebeneinander, bricht um; verteilt = links/rechts auseinander
	const leiste = (kinder, o = {}) => h("div", { class: klassen("b-leiste", o.verteilt && "b-leiste--verteilt", o.klasse), id: o.id }, kinder);
	// Seitengerüst: Titel, Untertitel, Zurück-Link, Aktionen rechts, dann Inhalt (max. Breite)
	function seite(o = {}) {
		return h("div", { class: klassen("b-seite", o.schmal && "b-seite--schmal", o.klasse), id: o.id },
			h("div", { class: "b-seite__kopf" },
				o.zurueck ? h("a", { class: "b-seite__zurueck", href: o.zurueck.href || "#", onclick: o.zurueck.onclick || null }, ikon("winkel-links"), h("span", { text: o.zurueck.text || "Zurück" })) : null,
				h("div", { class: "b-seite__titelzeile" },
					h("div", {}, h("h1", { class: "b-seite__titel", text: o.titel }), o.untertitel ? h("p", { class: "b-seite__untertitel", text: o.untertitel }) : null),
					o.aktionen ? h("div", { class: "b-seite__aktionen" }, o.aktionen) : null)),
			h("div", { class: "b-seite__inhalt" }, o.inhalt));
	}
	// Seite mit Seitenleiste links (Konto, Admin)
	const bereich = (o = {}) => h("div", { class: klassen("b-bereich", o.klasse) }, o.leiste, h("div", { class: "b-bereich__inhalt" }, o.inhalt));
	// Kurze Wert-Paare (Steckbrief, Personendaten): [[Begriff, Wert], …]
	function angaben(paare, o = {}) {
		return h("dl", { class: klassen("b-angaben", o.klasse) }, paare.filter(Boolean).map(([k, v]) => [h("dt", { text: k }), h("dd", {}, v instanceof Node ? v : (v ?? "–"))]));
	}
	function text(inhalt, o = {}) { return h(o.tag || "p", { class: klassen("b-text", o.art && `b-text--${o.art}`, o.klasse), id: o.id, text: inhalt }); }

	// ---------- Rückmeldung ----------
	// Meldung unten in der Mitte (Snackbar). art: info | erfolg | fehler. Fehler bleiben, bis man sie schließt.
	let stapelMeldungen = null;
	function meldung(textInhalt, o = {}) {
		if (!stapelMeldungen) {
			stapelMeldungen = h("div", { class: "b-meldungen", "aria-live": "polite", "aria-relevant": "additions" });
			document.body.append(stapelMeldungen);
		}
		const art = o.art || "info";
		const weg = () => { m.dataset.weg = "1"; setTimeout(() => m.remove(), 220); };
		const m = h("div", { class: klassen("b-meldung", `b-meldung--${art}`), role: art === "fehler" ? "alert" : "status" },
			art !== "info" ? ikon(art === "fehler" ? "fehler" : art === "erfolg" ? "erfolg" : "info") : null,
			h("span", { class: "b-meldung__text", text: textInhalt }),
			o.aktion ? h("button", { type: "button", class: "b-meldung__aktion", text: o.aktion.text, onclick: () => { weg(); o.aktion.onclick(); } }) : null,
			h("button", { type: "button", class: "b-meldung__zu", "aria-label": "Meldung schließen", onclick: weg }, ikon("schliessen")));
		stapelMeldungen.append(m);
		while (stapelMeldungen.children.length > 3) stapelMeldungen.firstElementChild.remove();
		const dauer = o.dauer ?? (art === "fehler" ? 0 : o.aktion ? 8000 : 5000);
		if (dauer) setTimeout(weg, dauer);
		return m;
	}
	// Hinweis im Seitenfluss (Banner). art: info | erfolg | warnung | gefahr | akzent. aktion: Element oder {text, onclick, href}
	function hinweis(o = {}) {
		const art = o.art || "info";
		const IK = { info: "info", erfolg: "erfolg", warnung: "warnung", gefahr: "fehler", akzent: "info" };
		const n = h("div", { class: klassen("b-hinweis", `b-hinweis--${art}`, o.klasse), role: art === "gefahr" || art === "warnung" ? "alert" : "status", id: o.id },
			ikon(o.ikon || IK[art] || "info"),
			h("div", { class: "b-hinweis__text" }, o.titel ? h("strong", { class: "b-hinweis__titel", text: o.titel }) : null, o.text ? h("p", { text: o.text }) : null, o.inhalt || null),
			o.aktion ? h("div", { class: "b-hinweis__aktion" }, o.aktion instanceof Node ? o.aktion : knopf({ art: "standard", groesse: "s", ...o.aktion })) : null);
		if (o.schliessbar) n.append(knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "schliessen", label: "Hinweis schließen", klasse: "b-hinweis__zu",
			onclick: () => { n.remove(); if (o.onschliessen) o.onschliessen(); } }));
		return n;
	}
	// Leerer Zustand: sagt, was hier erscheinen wird und wie man anfängt
	function leer(o = {}) {
		return h("div", { class: klassen("b-leer", o.klein && "b-leer--klein", o.klasse) },
			h("span", { class: "b-leer__ikon" }, ikon(o.ikon || "info", { groesse: "l" })),
			h("p", { class: "b-leer__titel", text: o.titel || "Noch nichts da" }),
			o.text ? h("p", { class: "b-leer__text", text: o.text }) : null,
			o.aktion ? (o.aktion instanceof Node ? o.aktion : knopf({ art: "primaer", ...o.aktion })) : null);
	}
	// Laden: kreisel (kurz) oder skelett (Platzhalter in der Form des Inhalts)
	function laden(o = {}) {
		if (o.art === "skelett") {
			const n = o.zeilen || 3;
			if (o.form === "kacheln") {
				const r = raster(Array.from({ length: n }, () => h("div", { class: "b-skelett b-skelett--kachel" })), { klasse: "b-laden-skelett" });
				r.setAttribute("aria-busy", "true"); r.setAttribute("aria-label", o.label || "Wird geladen");
				return r;
			}
			return h("div", { class: "b-laden-skelett", "aria-busy": "true", "aria-label": o.label || "Wird geladen" },
				Array.from({ length: n }, (_, i) => h("div", { class: "b-skelett b-skelett--zeile", style: i === n - 1 ? "width:60%" : null })));
		}
		return h("div", { class: klassen("b-laden", o.klein && "b-laden--klein"), role: "status" }, h("span", { class: "b-kreisel", "aria-hidden": "true" }), h("span", { class: o.ohneText ? "b-unsichtbar" : "b-laden__text", text: o.label || "Wird geladen …" }));
	}

	// ---------- Dialoge (natives <dialog>: Fokus bleibt drin, Esc schließt) ----------
	function dialog(o = {}) {
		const id = o.id || neueId("dialog");
		const d = h("dialog", { class: klassen("b-dialog", o.breit && "b-dialog--breit", o.gefahr && "b-dialog--gefahr", o.klasse), id, "aria-labelledby": id + "-titel",
			"aria-describedby": o.text ? id + "-text" : null });
		const zu = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "schliessen", label: "Schließen", klasse: "b-dialog__zu", onclick: () => api.schliessen(null) });
		d.append(
			h("div", { class: "b-dialog__kopf" }, h("h2", { class: "b-dialog__titel", id: id + "-titel", text: o.titel || "" }), o.ohneZu ? null : zu),
			h("div", { class: "b-dialog__inhalt" }, o.text ? h("p", { class: "b-dialog__text", id: id + "-text", text: o.text }) : null, o.inhalt || null),
			o.aktionen ? h("div", { class: "b-dialog__fuss" }, knopfleiste(o.aktionen)) : null);
		let vorher = null, ergebnis = null, aufloesen = null;
		d.addEventListener("cancel", (ev) => { if (o.festhalten) ev.preventDefault(); else ergebnis = null; });
		d.addEventListener("close", () => {
			d.remove();
			if (vorher && document.contains(vorher)) vorher.focus();
			if (o.onschliessen) o.onschliessen(ergebnis);
			if (aufloesen) aufloesen(ergebnis);
		});
		d.addEventListener("click", (ev) => { if (ev.target === d && !o.festhalten) api.schliessen(null); });   // Klick auf den Hintergrund
		const api = {
			element: d,
			oeffnen() {
				vorher = document.activeElement; document.body.append(d); d.showModal();
				const ziel = d.querySelector("[autofocus]") || d.querySelector(".b-dialog__inhalt input, .b-dialog__inhalt textarea, .b-dialog__inhalt select") || d.querySelector(".b-dialog__fuss .b-knopf--primaer, .b-dialog__fuss .b-knopf--gefahr") || zu;
				if (ziel) ziel.focus();
				return new Promise((r) => { aufloesen = r; });
			},
			schliessen(wert) { ergebnis = wert; if (d.open) d.close(); },
		};
		return api;
	}
	// Ersetzt confirm(): await UI.bestaetigen({titel, text, ja: "Löschen", gefahr: true}) → true/false
	function bestaetigen(o = {}) {
		let api;
		const ja = knopf({ art: o.gefahr ? "gefahr" : "primaer", text: o.ja || "OK", onclick: () => api.schliessen(true) });
		const nein = knopf({ art: "standard", text: o.nein || "Abbrechen", onclick: () => api.schliessen(false) });
		api = dialog({ titel: o.titel || "Sicher?", text: o.text, inhalt: o.inhalt, gefahr: o.gefahr, aktionen: [nein, ja] });
		if (o.gefahr) nein.setAttribute("autofocus", "");   // bei Gefährlichem steht der Fokus auf „Abbrechen“
		return api.oeffnen().then((w) => w === true);
	}
	// Ersetzt prompt(): await UI.eingabe({titel, label, wert, pruefen: (w) => Fehlertext|""}) → Text oder null
	function eingabe(o = {}) {
		let api;
		const f = (o.mehrzeilig ? textbereich : feld)({ label: o.label, wert: o.wert, platzhalter: o.platzhalter, hinweis: o.hinweis, typ: o.typ, max: o.max, pflicht: o.pflicht !== false });
		const ok = knopf({ art: o.gefahr ? "gefahr" : "primaer", text: o.ja || "OK", typ: "submit" });
		const form = h("form", { class: "b-stapel", novalidate: true }, f);
		form.addEventListener("submit", (ev) => {
			ev.preventDefault();
			const w = String(f.wert).trim();
			const fehler = (o.pflicht !== false && !w) ? "Bitte ausfüllen." : o.pruefen ? o.pruefen(w) : "";
			if (fehler) { f.fehlerSetzen(fehler); f.eingabe.focus(); return; }
			api.schliessen(w);
		});
		ok.addEventListener("click", (ev) => { ev.preventDefault(); form.requestSubmit(); });
		api = dialog({ titel: o.titel, text: o.text, inhalt: form, gefahr: o.gefahr,
			aktionen: [knopf({ art: "standard", text: o.nein || "Abbrechen", onclick: () => api.schliessen(null) }), ok] });
		return api.oeffnen().then((w) => (typeof w === "string" ? w : null));
	}
	// Ersetzt alert(): await UI.hinweisDialog({titel, text})
	function hinweisDialog(o = {}) {
		let api;
		api = dialog({ titel: o.titel || "Hinweis", text: o.text, inhalt: o.inhalt, aktionen: [knopf({ art: "primaer", text: o.ok || "OK", onclick: () => api.schliessen(true) })] });
		return api.oeffnen().then(() => undefined);
	}

	// ---------- Aussehen je Spieler ----------
	// a = Einstellungen.aussehen vom Server {thema, akzent, dichte, kachelgroesse}. Setzt Attribute an <html> und merkt sie für thema-frueh.js
	function aussehenAnwenden(a = {}) {
		const w = document.documentElement;
		const setzen = (attr, wert, standard) => { if (wert && wert !== standard) w.setAttribute(attr, wert); else w.removeAttribute(attr); };
		setzen("data-thema", a.thema, "auto");
		setzen("data-akzent", a.akzent, "blau");
		setzen("data-dichte", a.dichte, "normal");
		setzen("data-kachel", a.kachelgroesse, "mittel");
		try { localStorage.setItem("sb-aussehen", JSON.stringify({ thema: a.thema, akzent: a.akzent, dichte: a.dichte, kachelgroesse: a.kachelgroesse })); } catch (_) { /* egal */ }
	}
	// Die Wahlmöglichkeiten mit deutschen Namen (für Einstellungsseiten), gleiche Reihenfolge wie im Server
	const AUSSEHEN = Object.freeze({
		thema: [["auto", "Automatisch", "geraet"], ["hell", "Hell", "sonne"], ["dunkel", "Dunkel", "mond"]],
		akzent: [["blau", "Blau"], ["gruen", "Grün"], ["tuerkis", "Türkis"], ["violett", "Violett"], ["rosa", "Rosa"], ["orange", "Orange"]],
		dichte: [["kompakt", "Kompakt"], ["normal", "Normal"], ["luftig", "Luftig"]],
		kachelgroesse: [["klein", "Klein"], ["mittel", "Mittel"], ["gross", "Groß"]],
	});
	// Farbwahl als runde Punkte (Akzent). optionen wie AUSSEHEN.akzent
	function farbwahl(o = {}) {
		const id = o.id || neueId("farbe");
		const gruppe = h("div", { class: "b-farbwahl", role: "radiogroup", id, "aria-label": o.label || "Farbe" });
		const knoepfe = (o.optionen || AUSSEHEN.akzent).map(([wert, name]) => {
			const k = h("button", { type: "button", role: "radio", class: "b-farbwahl__punkt", "data-akzent": wert, "data-wert": wert, "aria-label": name, title: name },
				ikon("haken"));
			k.addEventListener("click", () => setzen(wert, true));
			return k;
		});
		function setzen(wert, melden) {
			for (const k of knoepfe) { const an = k.dataset.wert === wert; k.setAttribute("aria-checked", String(an)); k.tabIndex = an ? 0 : -1; }
			gruppe.dataset.wert = wert;
			if (melden && o.onwechsel) o.onwechsel(wert);
		}
		gruppe.addEventListener("keydown", (ev) => pfeilNavigation(ev, knoepfe, (k) => { k.focus(); setzen(k.dataset.wert, true); }));
		gruppe.append(...knoepfe);
		setzen(o.wert || "blau", false);
		Object.defineProperty(gruppe, "wert", { configurable: true, get: () => gruppe.dataset.wert, set: (w) => setzen(w, false) });
		return mitLabel(gruppe, o, id, "div");
	}
	// Liste umsortieren (Startseite anordnen): eintraege [{id, text, sichtbar}], onwechsel(liste). Hoch/Runter-Knöpfe statt nur Ziehen.
	function sortierliste(o = {}) {
		let daten = (o.eintraege || []).map((e) => ({ ...e }));
		const ul = h("ul", { class: "b-sortierliste", "aria-label": o.label || "Reihenfolge" });
		function zeichnen(fokusId, fokusRichtung) {
			ul.replaceChildren(...daten.map((e, i) => {
				const hoch = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "pfeil-hoch", label: `${e.text} nach oben`, deaktiviert: i === 0, onclick: () => schieben(i, -1) });
				const runter = knopf({ art: "leise", groesse: "s", nurIkon: true, ikon: "pfeil-runter", label: `${e.text} nach unten`, deaktiviert: i === daten.length - 1, onclick: () => schieben(i, 1) });
				hoch.dataset.richtung = "hoch"; runter.dataset.richtung = "runter";
				const sicht = h("input", { type: "checkbox", class: "b-haken__kasten", id: `sl-${e.id}`, "aria-label": `${e.text} anzeigen` });
				sicht.checked = e.sichtbar !== false;
				sicht.addEventListener("change", () => { e.sichtbar = sicht.checked; li.toggleAttribute("data-versteckt", !sicht.checked); melden(); });
				const li = h("li", { class: "b-sortierliste__eintrag", "data-id": e.id, "data-versteckt": e.sichtbar === false ? "" : null },
					sicht, h("label", { for: `sl-${e.id}`, class: "b-sortierliste__text", text: e.text }), h("span", { class: "b-sortierliste__knoepfe" }, hoch, runter));
				return li;
			}));
			if (fokusId) {
				const li = ul.querySelector(`[data-id="${fokusId}"]`);
				const k = li && (li.querySelector(`[data-richtung="${fokusRichtung}"]:not(:disabled)`) || li.querySelector("button:not(:disabled)"));
				if (k) k.focus();
			}
		}
		function schieben(i, d) {
			const j = i + d; if (j < 0 || j >= daten.length) return;
			[daten[i], daten[j]] = [daten[j], daten[i]];
			zeichnen(daten[j].id, d < 0 ? "hoch" : "runter"); melden();
		}
		const melden = () => { if (o.onwechsel) o.onwechsel(daten.map(({ id, sichtbar }) => ({ id, sichtbar: sichtbar !== false }))); };
		zeichnen();
		Object.defineProperty(ul, "wert", { configurable: true, get: () => daten.map(({ id, sichtbar }) => ({ id, sichtbar: sichtbar !== false })) });
		return mitLabel(ul, o, neueId("sortierliste"), "div");
	}

	window.UI = Object.freeze({
		version: "1.0.0",
		h, anhaengen, ikon, klassen,
		knopf, knopfleiste, segment, farbwahl,
		feld, textbereich, auswahl, schalter, haken, radio, datei, suche, formular, sortierliste,
		karte, spielkachel, liste, zeile, tabelle, kennzahl, fortschritt, marke, avatar, angaben, text,
		reiter, seitenleiste, kopfleiste, menue, abschnitt,
		raster, reihe, stapel, leiste, seite, bereich,
		meldung, hinweis, leer, laden,
		dialog, bestaetigen, eingabe, hinweisDialog,
		aussehenAnwenden, AUSSEHEN,
	});
})();
