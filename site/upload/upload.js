// Upload-Seite (Phase 6b): upload.cuby0401.uk → Upload-Dienst unter /api/upload
"use strict";

const $ = (id) => document.getElementById(id);
const API = "/api/upload";
// Größe lesbar, Einheit passend zur Größe: B, KB, MB, GB, TB, PB (Zentrale 1.2.1)
function groesse(b) {
	const einheiten = ["B", "KB", "MB", "GB", "TB", "PB"];
	let i = 0, n = Math.max(0, Number(b) || 0);
	while (n >= 1024 && i < einheiten.length - 1) { n /= 1024; i++; }
	const stellen = i === 0 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
	return n.toLocaleString("de-DE", { maximumFractionDigits: stellen }) + " " + einheiten[i];
}
const datum = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

function meldung(text, art = "") {
	$("meldung").textContent = text;
	$("meldung").className = "meldung " + art;
	$("meldung").hidden = !text;
}

async function api(methode, pfad, body) {
	const r = await fetch(API + pfad, {
		method: methode,
		credentials: "same-origin",
		redirect: "manual",
		cache: "no-store",
		headers: { "X-Upload": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (r.type === "opaqueredirect") {
		location.reload(); // Cloudflare-Sitzung (15 min) abgelaufen → neuer Code
		throw new Error("Sitzung abgelaufen");
	}
	const d = r.status === 204 ? null : await r.json().catch(() => ({}));
	if (!r.ok) {
		const e = new Error(d && typeof d.detail === "string" ? d.detail : d && d.detail && d.detail.text ? d.detail.text : "Fehler " + r.status);
		e.status = r.status;
		e.detail = d && d.detail;
		throw e;
	}
	return d;
}

function zeige(bereich) {
	$("anmeldung").hidden = bereich !== "anmeldung";
	$("bereich").hidden = bereich !== "bereich";
	$("abmelden").hidden = bereich !== "bereich";
}

const GAMES = "https://games.cuby0401.uk";
const knopfK = (text, onclick, art = "leise") => {
	const k = document.createElement("button");
	k.type = "button"; k.className = "knopf klein " + art; k.textContent = text; k.onclick = onclick; return k;
};
const div = (klasse, ...kinder) => { const d = document.createElement("div"); if (klasse) d.className = klasse; d.append(...kinder); return d; };
const span = (text, klasse) => { const s = document.createElement("span"); s.textContent = text; if (klasse) s.className = klasse; return s; };

async function aktion(fn, erfolg) {
	try { await fn(); if (erfolg) meldung(erfolg, "ok"); }
	catch (e) { if (e.status === 401) return start(); meldung(e.message, "fehler"); }
	liste();
}

let bekannteOrdner = new Set();
let kontingent = 0;   // aus /status, für „% deines Kontingents“

// „Update hochladen“ an einem Spiel: Ordnername festlegen, damit kein zweites Spiel entsteht
function updateFuer(s) {
	$("ordner").value = s.ordner;
	$("ordner").readOnly = true;
	const hinweis = $("update-fuer");
	hinweis.replaceChildren(document.createTextNode(`Update für „${s.title}“${s.version ? " (aktuell Version " + s.version + ")" : ""} – Ordner ${s.ordner} ist festgelegt. `),
		knopfK("Stattdessen neues Spiel", () => updateFuerAufheben()));
	hinweis.hidden = false;
	$("uploadform").scrollIntoView({ behavior: "smooth", block: "start" });
	$("datei").focus();
}
function updateFuerAufheben() {
	$("ordner").readOnly = false;
	$("update-fuer").hidden = true;
}

async function liste() {
	let spiele;
	try {
		spiele = await api("GET", "/spiele");
	} catch (e) {
		if (e.status === 401) return start();
		return meldung(e.message, "fehler");
	}
	bekannteOrdner = new Set(spiele.map((x) => x.ordner));
	if (!spiele.length) return $("liste").replaceChildren(span("Noch keine Spiele hochgeladen.", "leise"));
	$("liste").replaceChildren(...spiele.map((s) => {
		const pfad = "/spiele/" + encodeURIComponent(s.ordner);
		const bereich = div("bereich",
			div("titel", s.title + (s.version ? `  ·  Version ${s.version}` : "")),
			div("info", s.live ? `Live · Ordner ${s.ordner} · ${s.live.dateien} Dateien · ${groesse(s.live.bytes)} · geändert ${datum(s.live.geaendert)}`
				: `Ordner ${s.ordner} · noch nicht veröffentlicht`));
		if (s.speicher) {   // Speicher dieses Spiels – zählt alles zu deinem Kontingent (Zentrale 1.2.0)
			const sp = s.speicher, gesamt = sp.live + sp.entwurf + sp.versionen;
			bereich.append(div("info", `Speicher: ${groesse(gesamt)}` + (kontingent ? ` (${Math.max(1, Math.round(gesamt / kontingent * 100))} % deines Kontingents)` : "") +
				` – live ${groesse(sp.live)}` + (sp.entwurf ? `, Entwurf ${groesse(sp.entwurf)}` : "") + (sp.versionen ? `, ältere Versionen ${groesse(sp.versionen)}` : "")));
		}
		if (s.warning || (s.live && !s.complete)) bereich.append(div("warnung", "⚠ " + (s.warning || "index.html fehlt")));

		if (s.entwurf) {
			const testen = document.createElement("a");
			testen.href = `${GAMES}/#/entwurf/${encodeURIComponent($("benutzer").textContent)}/${encodeURIComponent(s.ordner)}`;
			testen.target = "_blank"; testen.rel = "noopener"; testen.className = "knopf klein leise"; testen.textContent = "Testen";
			const box = div("entwurf-box",
				span(`Entwurf vom ${datum(s.entwurf.geaendert)} · ${s.entwurf.dateien} Dateien`),
				div("zeile-klein", testen,
					knopfK("Veröffentlichen …", () => updateFenster(s), ""),
					knopfK("Verwerfen", () => {
						if (!confirm("Entwurf verwerfen? Die gesammelten Änderungen werden ebenfalls verworfen.")) return;
						aktion(() => api("DELETE", pfad + "/entwurf"), `${s.ordner}: Entwurf verworfen.`);
					}, "gefahr")));
			if (s.aenderungen.length) {
				const ul = document.createElement("ul");
				ul.className = "verlauf";
				for (const a of s.aenderungen) { const li = document.createElement("li"); li.textContent = a.text; ul.append(li); }
				box.append(span("Gesammelte Änderungen fürs nächste Update:", "info"), ul);
			}
			bereich.append(box);
		}
		if (s.versionen.length) {
			const wahl = document.createElement("select");
			for (const v of s.versionen) {
				const o = document.createElement("option");
				o.value = v.id;
				o.textContent = (v.version ? `Version ${v.version} – ` : "") + `bis ${datum(v.archiviert)} (${v.dateien} Dateien)`;
				wahl.append(o);
			}
			bereich.append(div("zeile-klein", span("Ältere Versionen:", "leise"), wahl,
				knopfK("Zurücksetzen", () => zuruecksetzen(s, wahl.value, wahl.selectedOptions[0].textContent))));
		}
		if (s.releases.length) {
			const d = document.createElement("details");
			d.className = "verlauf";
			const sum = document.createElement("summary"); sum.textContent = "Versionsverlauf";
			const ul = document.createElement("ul");
			for (const r of s.releases) {
				const li = document.createElement("li");
				li.textContent = `${r.version} (${datum(r.zeit)})${r.art === "rollback" ? " ↩" : ""}: ${r.aenderungen.join(" · ")}`;
				ul.append(li);
			}
			d.append(sum, ul);
			bereich.append(d);
		}
		bereich.append(steckbriefBereich(s));
		bereich.append(div("zeile-klein", knopfK("Update hochladen", () => updateFuer(s), "")));
		const weg = knopfK("Löschen", () => {
			if (!confirm(`„${s.title}“ (${s.ordner}) komplett löschen – inklusive Entwurf, älterer Versionen und Versionsverlauf? Spielstände und Bestenliste bleiben erhalten.`)) return;
			aktion(() => api("DELETE", pfad), `${s.ordner} gelöscht.`);
		}, "gefahr");
		return div("eintrag", bereich, weg);
	}));
}

// ---------- Steckbrief: Titel, Beschreibung, Vorschaubild (Zentrale 1.2.1) ----------
// Gilt sofort, ohne neue Version, und übersteht Updates. Vorrang vor der game.json.
function steckbriefBereich(s) {
	const pfad = "/spiele/" + encodeURIComponent(s.ordner);
	const d = document.createElement("details");
	d.className = "verlauf steckbrief";
	const sum = document.createElement("summary");
	sum.textContent = "Beschreibung und Vorschaubild";
	d.append(sum);
	d.addEventListener("toggle", async () => {
		if (!d.open || d.dataset.geladen) return;
		d.dataset.geladen = "1";
		let sb;
		try { sb = await api("GET", pfad + "/steckbrief"); }
		catch (e) { if (e.status === 401) return start(); return d.append(span(e.message, "warnung")); }
		const feld = (beschriftung, wert, platzhalter, max, mehrzeilig) => {
			const l = document.createElement("label");
			l.className = "block";
			l.append(document.createTextNode(beschriftung));
			const f = document.createElement(mehrzeilig ? "textarea" : "input");
			if (mehrzeilig) f.rows = 3; else f.type = "text";
			f.maxLength = max; f.value = wert; f.placeholder = platzhalter;
			l.append(f);
			return [l, f];
		};
		const [lt, titel] = feld("Titel (max. 80 Zeichen)", sb.title, sb.gameJson.title || s.ordner, 80, false);
		const [lb, text] = feld("Beschreibung – steht in der Bibliothek unter dem Spiel (max. 300 Zeichen)", sb.description,
			sb.gameJson.description || "z. B. Weiche Hindernissen aus und sammle Sterne.", 300, true);
		const zaehler = span("", "leise klein");
		const zaehlen = () => { zaehler.textContent = `${text.value.length} / 300`; };
		text.addEventListener("input", zaehlen); zaehlen();
		const speichern = knopfK("Speichern", () => aktion(() => api("PUT", pfad + "/steckbrief",
			{ title: titel.value, description: text.value }), `„${titel.value || s.title}“: Beschreibung gespeichert – gilt sofort.`), "");

		const vorschau = div("vorschau-box");
		const bildZeigen = (info) => {
			vorschau.replaceChildren();
			if (info) {
				const img = document.createElement("img");
				img.src = API + pfad + "/vorschaubild?v=" + info.stand;
				img.alt = "Vorschaubild";
				vorschau.append(img, span(groesse(info.bytes), "leise klein"));
			} else {
				vorschau.append(span(sb.gameJson.thumbnail ? "Kein eigenes Bild – es gilt das thumbnail aus der game.json." : "Noch kein Vorschaubild.", "leise klein"));
			}
		};
		bildZeigen(sb.vorschaubild);
		const wahl = document.createElement("input");
		wahl.type = "file"; wahl.accept = "image/png,image/jpeg,image/webp"; wahl.hidden = true;
		wahl.onchange = async () => {
			const datei = wahl.files[0];
			if (!datei) return;
			if (datei.size > 2 * 1024 * 1024) return meldung("Das Vorschaubild ist größer als 2 MB.", "fehler");
			const f = new FormData();
			f.append("datei", datei);
			const r = await fetch(API + pfad + "/vorschaubild", { method: "PUT", body: f, credentials: "same-origin", headers: { "X-Upload": "1" } });
			const antwort = await r.json().catch(() => ({}));
			if (r.status === 401) return start();
			if (!r.ok) return meldung(typeof antwort.detail === "string" ? antwort.detail : "Fehler " + r.status, "fehler");
			sb = antwort;
			bildZeigen(sb.vorschaubild);
			meldung(`Vorschaubild gespeichert – gilt sofort.`, "ok");
			wahl.value = "";
		};
		const bildKnopf = knopfK("Bild wählen …", () => wahl.click(), "");
		const bildWeg = knopfK("Bild entfernen", async () => {
			if (!confirm("Vorschaubild entfernen?")) return;
			try { await api("DELETE", pfad + "/vorschaubild"); sb.vorschaubild = null; bildZeigen(null); meldung("Vorschaubild entfernt.", "ok"); }
			catch (e) { if (e.status === 401) return start(); meldung(e.message, "fehler"); }
		}, "gefahr");
		d.append(lt, lb, div("zeile-klein", zaehler, speichern),
			span("Vorschaubild: am besten 16:9, z. B. 640 × 360 Pixel. PNG, JPG oder WebP, max. 2 MB.", "leise klein"),
			vorschau, div("zeile-klein", bildKnopf, bildWeg), wahl);
	});
	return d;
}

// ---------- Update-Fenster (E35/E36) ----------
async function updateFenster(s) {
	let pr;
	try { pr = await api("GET", "/spiele/" + encodeURIComponent(s.ordner) + "/pruefung"); }
	catch (e) { if (e.status === 401) return start(); return meldung(e.message, "fehler"); }
	const f = $("update-fenster");
	$("uf-titel").textContent = `„${s.title}“ veröffentlichen`;
	$("uf-version").textContent = pr.erstveroeffentlichung
		? "Erste Veröffentlichung – das Spiel bekommt Version 1.0.0."
		: `Aktuell live: ${pr.version ? "Version " + pr.version : "noch ohne Versionsnummer"}`;
	for (const el of f.querySelectorAll("[data-v]")) el.textContent = pr.erstveroeffentlichung ? "" : "→ " + pr.vorschlaege[el.dataset.v];
	for (const r of f.querySelectorAll('input[name="uf-art"]')) r.disabled = pr.erstveroeffentlichung;
	$("uf-aenderungen").value = pr.aenderungen.join("\n") || (pr.erstveroeffentlichung ? "Erste Version" : "");
	$("uf-punkte").replaceChildren(...pr.punkte.map((p) => { const li = document.createElement("li"); li.className = p.stufe; li.textContent = p.text; return li; }));
	$("uf-season-zeile").hidden = !pr.seasonEmpfohlen; $("uf-season").checked = pr.seasonEmpfohlen;
	$("uf-gelesen-zeile").hidden = !pr.warnungen || !!pr.fehler; $("uf-gelesen").checked = false;
	$("uf-los").disabled = !!pr.fehler;
	$("uf-los").textContent = pr.fehler ? "Erst die Fehler beheben (neu hochladen)" : "Veröffentlichen";
	$("uf-los").onclick = async () => {
		if (pr.warnungen && !$("uf-gelesen").checked) return alert("Bitte erst die Warnungen lesen und das Häkchen setzen.");
		const art = f.querySelector('input[name="uf-art"]:checked').value;
		const aenderungen = $("uf-aenderungen").value.split("\n").map((z) => z.trim()).filter(Boolean);
		if (!aenderungen.length) return alert("Bitte mindestens eine Zeile schreiben, was neu ist.");
		try {
			const d = await api("POST", "/spiele/" + encodeURIComponent(s.ordner) + "/veroeffentlichen",
				{ art, aenderungen, neueSeason: $("uf-season").checked, warnungenGelesen: $("uf-gelesen").checked });
			f.close();
			meldung(`✓ „${s.title}“ ist als Version ${d.version} veröffentlicht.` + (d.season ? ` Neue Season ${d.season} gestartet.` : ""), "ok");
		} catch (e) {
			if (e.status === 401) { f.close(); return start(); }
			alert(e.message);
		}
		liste();
	};
	f.showModal();
}

// ---------- Rollback mit Rückfrage (E37) ----------
async function zuruecksetzen(s, vid, beschriftung) {
	if (!confirm(`„${s.title}“ zurücksetzen auf: ${beschriftung}?\nDie aktuelle Version wird dabei aufgehoben.`)) return;
	const pfad = "/spiele/" + encodeURIComponent(s.ordner) + "/zuruecksetzen";
	try {
		await api("POST", pfad, { version: vid });
		meldung(`${s.ordner}: zurückgesetzt.`, "ok");
	} catch (e) {
		if (e.status === 401) return start();
		if (e.status !== 409 || !e.detail || e.detail.frage !== "spielstaende") { meldung(e.message, "fehler"); return liste(); }
		const f = $("rollback-fenster");
		$("rb-text").textContent = e.detail.text;
		f.returnValue = "";
		f.showModal();
		const wahl = await new Promise((ok) => f.addEventListener("close", () => ok(f.returnValue), { once: true }));
		if (wahl !== "zuruecksetzen" && wahl !== "behalten") { meldung("Nicht zurückgesetzt."); return liste(); }
		try {
			const d = await api("POST", pfad, { version: vid, spielstaende: wahl });
			const sp = d.spielstaende;
			meldung(`${s.ordner}: zurückgesetzt.` + (sp ? ` ${sp.zurueckgeholt} Spielstände zurückgeholt` +
				(sp.ohneAltenStand ? `, ${sp.ohneAltenStand} ohne alten Stand unverändert.` : ".") : " Spielstände behalten."), "ok");
		} catch (e2) { meldung(e2.message, "fehler"); }
	}
	liste();
}

function hochladen(datei, ordner) {
	return new Promise((ja, nein) => {
		const x = new XMLHttpRequest();
		x.open("POST", API + "/spiele/" + encodeURIComponent(ordner));
		x.setRequestHeader("X-Upload", "1");
		x.upload.onprogress = (e) => { if (e.lengthComputable) $("fortschritt").value = (e.loaded / e.total) * 100; };
		x.onload = () => {
			let d = {};
			try { d = JSON.parse(x.responseText); } catch { /* egal */ }
			if (x.status >= 200 && x.status < 300) ja(d);
			else { const e = new Error(typeof d.detail === "string" ? d.detail : "Fehler " + x.status); e.status = x.status; nein(e); }
		};
		x.onerror = () => nein(new Error("Verbindung abgebrochen – evtl. ist die Datei größer als 100 MB oder die Sitzung abgelaufen"));
		const f = new FormData();
		f.append("datei", datei);
		f.append("neu", $("neu").value.trim());
		x.send(f);
	});
}

$("datei").addEventListener("change", () => {
	const d = $("datei").files[0];
	if (d && !$("ordner").value) {
		$("ordner").value = d.name.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64);
	}
});

$("uploadform").addEventListener("submit", async (ev) => {
	ev.preventDefault();
	const datei = $("datei").files[0];
	const ordner = $("ordner").value.trim();
	if (!datei) return;
	if (datei.size > 100 * 1024 * 1024) return meldung("Die Datei ist größer als 100 MB.", "fehler");
	if (!bekannteOrdner.has(ordner) && bekannteOrdner.size &&
		!confirm(`„${ordner}“ ist ein neuer Ordner – das wird ein NEUES Spiel (eigene Spielstände und Bestenliste).\n\nWolltest du ein bestehendes Spiel aktualisieren? Dann „Abbrechen“ und beim Spiel auf „Update hochladen“ klicken.`)) return;
	$("fortschritt").hidden = false; $("fortschritt").value = 0;
	meldung("Lade hoch …");
	try {
		const d = await hochladen(datei, ordner);
		let text = `✓ ${d.ordner}: ${d.dateien} Dateien als Entwurf hochgeladen.`;
		if (d.uebersprungen && d.uebersprungen.length) text += ` Übersprungen (nicht erlaubt): ${d.uebersprungen.join(", ")}.`;
		meldung(text + " Unten auf „Testen“ klicken, kurz spielen, dann „Veröffentlichen …“.", "ok");
		$("uploadform").reset();
		updateFuerAufheben();
	} catch (e) {
		if (e.status === 401) { meldung("Sitzung abgelaufen – bitte neu anmelden.", "fehler"); return start(); }
		meldung("✗ " + e.message, "fehler");
	} finally {
		$("fortschritt").hidden = true;
		liste();
	}
});

$("anmeldeform").addEventListener("submit", async (ev) => {
	ev.preventDefault();
	try {
		await api("POST", "/anmelden", { passwort: $("passwort").value });
		$("passwort").value = "";
		meldung("");
		start();
	} catch (e) {
		meldung(e.message, "fehler");
		$("passwort").select();
	}
});

$("abmelden").addEventListener("click", async () => {
	try { await api("POST", "/abmelden"); } catch { /* egal */ }
	meldung("Abgemeldet.");
	start();
});

async function start() {
	let s;
	try {
		s = await api("GET", "/status");
	} catch (e) {
		return meldung(e.status === 403 ? "Für deine E-Mail-Adresse gibt es kein Konto in der Spielebibliothek." : e.message, "fehler");
	}
	$("benutzer").textContent = s.player;
	$("benutzer").hidden = false;
	if (!s.entwickler) { zeige(""); return meldung("Du hast noch kein Upload-Konto – bitte bei Seb melden.", "fehler"); }
	if (s.gesperrt) meldung("Zu viele falsche Passwörter – bitte 15 Minuten warten.", "fehler");
	if (!s.angemeldet) { zeige("anmeldung"); $("passwort").focus(); return; }
	zeige("bereich");
	if (s.speicher) kontingent = s.speicher.grenze;
	if (s.speicher) {   // Kontingent je Entwickler (Zentrale 1.2.0)
		const anteil = s.speicher.belegt / s.speicher.grenze;
		$("speicher").textContent = `Dein Speicher: ${groesse(s.speicher.belegt)} von ${groesse(s.speicher.grenze)} belegt` +
			(anteil > 0.8 ? " – fast voll. Alte Versionen oder Spiele löschen, oder Seb um mehr Platz bitten." : " (Spiele, Entwürfe und aufgehobene Versionen).");
		$("speicher").className = "klein " + (anteil > 0.8 ? "warnung" : "leise");
		$("speicher").hidden = false;
	}
	liste();
}

start();
