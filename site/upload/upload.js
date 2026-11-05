// Upload-Seite (Phase 6b): upload.cuby0401.uk → Upload-Dienst unter /api/upload
"use strict";

const $ = (id) => document.getElementById(id);
const API = "/api/upload";
const groesse = (b) => b > 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.ceil(b / 1024) + " KB";
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
		const e = new Error(d && typeof d.detail === "string" ? d.detail : "Fehler " + r.status);
		e.status = r.status;
		throw e;
	}
	return d;
}

function zeige(bereich) {
	$("anmeldung").hidden = bereich !== "anmeldung";
	$("bereich").hidden = bereich !== "bereich";
	$("abmelden").hidden = bereich !== "bereich";
}

async function liste() {
	let spiele;
	try {
		spiele = await api("GET", "/spiele");
	} catch (e) {
		if (e.status === 401) return start();
		return meldung(e.message, "fehler");
	}
	if (!spiele.length) {
		const p = document.createElement("p");
		p.className = "leise";
		p.textContent = "Noch keine Spiele hochgeladen.";
		return $("liste").replaceChildren(p);
	}
	$("liste").replaceChildren(...spiele.map((s) => {
		const zeile = document.createElement("div");
		zeile.className = "eintrag";
		const links = document.createElement("div");
		const titel = document.createElement("div"); titel.className = "titel"; titel.textContent = s.title;
		const info = document.createElement("div"); info.className = "info";
		info.textContent = `Ordner ${s.ordner} · ${s.dateien} Dateien · ${groesse(s.bytes)} · geändert ${datum(s.geaendert)}`;
		links.append(titel, info);
		if (s.warning || !s.complete) {
			const w = document.createElement("div"); w.className = "warnung";
			w.textContent = "⚠ " + (s.warning || "index.html fehlt");
			links.append(w);
		}
		const weg = document.createElement("button");
		weg.type = "button"; weg.className = "knopf gefahr"; weg.textContent = "Löschen";
		weg.onclick = async () => {
			if (!confirm(`„${s.title}“ (${s.ordner}) wirklich löschen? Spielstände und Bestenliste bleiben erhalten.`)) return;
			try { await api("DELETE", "/spiele/" + encodeURIComponent(s.ordner)); meldung(`${s.ordner} gelöscht.`, "ok"); }
			catch (e) { meldung(e.message, "fehler"); }
			liste();
		};
		zeile.append(links, weg);
		return zeile;
	}));
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
	$("fortschritt").hidden = false; $("fortschritt").value = 0;
	meldung("Lade hoch …");
	try {
		const d = await hochladen(datei, ordner);
		let text = `✓ ${d.ordner}: ${d.dateien} Dateien installiert.`;
		if (d.uebersprungen && d.uebersprungen.length) text += ` Übersprungen (nicht erlaubt): ${d.uebersprungen.join(", ")}`;
		meldung(text + " In der Bibliothek neu laden, dann ist es da.", "ok");
		$("uploadform").reset();
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
	liste();
}

start();
