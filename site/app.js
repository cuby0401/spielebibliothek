// Spielebibliothek – Bibliotheksseite
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Bibliotheksseite
//
// Phase 1: Die Spielliste kommt statisch aus games.json (nur Spiel-IDs),
// Titel/Beschreibung aus der game.json im Spielordner.
// Ab Phase 4 liefert GET /api/games die Liste.
//
// Sicherheit: Alles aus game.json ist fremder Inhalt → nur per textContent
// einsetzen, nie per innerHTML.

"use strict";

const ID_MUSTER = /^[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATEI_MUSTER = /^[A-Za-z0-9_-][A-Za-z0-9._\/-]*$/;

const el = (id) => document.getElementById(id);
let spiele = [];

function spielPfad(id) {
  return "/play/" + id.split("/").map(encodeURIComponent).join("/") + "/";
}

async function existiert(url) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-cache" });
    return r.ok;
  } catch {
    return false;
  }
}

async function spielLaden(id) {
  const [benutzer, ordner] = id.split("/");
  const spiel = { id, benutzer, ordner, titel: ordner, beschreibung: "", bild: null, warnung: null, startbar: false };
  const basis = spielPfad(id);

  try {
    const r = await fetch(basis + "game.json", { cache: "no-cache" });
    if (r.ok) {
      let meta;
      try {
        meta = JSON.parse(await r.text());
      } catch {
        spiel.warnung = "game.json ist kein gültiges JSON.";
      }
      if (meta && typeof meta === "object") {
        if (typeof meta.title === "string" && meta.title.trim()) spiel.titel = meta.title.trim().slice(0, 80);
        if (typeof meta.description === "string") spiel.beschreibung = meta.description.slice(0, 300);
        if (typeof meta.thumbnail === "string" && DATEI_MUSTER.test(meta.thumbnail) && !meta.thumbnail.includes("..")) {
          spiel.bild = basis + meta.thumbnail;
        }
      }
    }
  } catch {
    // ohne game.json: Ordnername als Titel
  }

  spiel.startbar = await existiert(basis + "index.html");
  return spiel;
}

function kachel(spiel) {
  const k = document.createElement("article");
  k.className = "kachel";

  const bild = document.createElement("div");
  bild.className = "bild";
  if (spiel.bild) {
    const img = document.createElement("img");
    img.src = spiel.bild;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => { img.remove(); bild.textContent = "🎮"; };
    bild.append(img);
  } else {
    bild.textContent = "🎮";
  }

  const inhalt = document.createElement("div");
  inhalt.className = "inhalt";

  const h = document.createElement("h2");
  h.textContent = spiel.titel;
  const autor = document.createElement("span");
  autor.className = "autor";
  autor.textContent = "von " + spiel.benutzer;
  const text = document.createElement("p");
  text.className = "beschreibung";
  text.textContent = spiel.beschreibung;
  inhalt.append(h, autor, text);

  if (spiel.warnung) {
    const w = document.createElement("p");
    w.className = "warnung";
    w.textContent = "⚠ " + spiel.warnung;
    inhalt.append(w);
  }

  const a = document.createElement("a");
  a.className = "knopf";
  if (spiel.startbar) {
    a.href = "#/spiel/" + spiel.id;
    a.textContent = "Spielen";
  } else {
    a.textContent = "unvollständig";
    a.setAttribute("aria-disabled", "true");
    a.title = "index.html fehlt";
  }
  inhalt.append(a);

  k.append(bild, inhalt);
  return k;
}

function zeigeUebersicht() {
  el("rahmen").replaceChildren(); // laufendes Spiel beenden
  el("spielansicht").hidden = true;
  el("uebersicht").hidden = false;
  document.title = "Spielebibliothek";
}

function zeigeSpiel(id) {
  const spiel = spiele.find((s) => s.id === id && s.startbar);
  if (!spiel) {
    location.hash = "#/";
    return;
  }

  const iframe = document.createElement("iframe");
  // Kein allow-same-origin, kein allow-top-navigation, kein allow-forms (Entscheidung E8)
  iframe.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-popups-to-escape-sandbox");
  iframe.setAttribute("allow", "fullscreen; gamepad; autoplay");
  iframe.setAttribute("title", spiel.titel);
  iframe.src = spielPfad(spiel.id) + "index.html";

  el("rahmen").replaceChildren(iframe);
  el("spieltitel").textContent = spiel.titel;
  el("uebersicht").hidden = true;
  el("spielansicht").hidden = false;
  document.title = spiel.titel + " – Spielebibliothek";
  iframe.focus();
}

function route() {
  const m = location.hash.match(/^#\/spiel\/(.+)$/);
  if (m && ID_MUSTER.test(m[1])) zeigeSpiel(m[1]);
  else zeigeUebersicht();
}

async function start() {
  el("vollbild").addEventListener("click", () => {
    const r = el("rahmen");
    if (r.requestFullscreen) r.requestFullscreen().catch(() => {});
  });

  try {
    const r = await fetch("/games.json", { cache: "no-cache" });
    const ids = (await r.json()).filter((id) => typeof id === "string" && ID_MUSTER.test(id));
    spiele = await Promise.all(ids.map(spielLaden));
  } catch {
    el("meldung").textContent = "Die Spielliste konnte nicht geladen werden.";
    el("meldung").hidden = false;
  }

  spiele.sort((a, b) => a.titel.localeCompare(b.titel, "de"));
  el("kacheln").replaceChildren(...spiele.map(kachel));
  if (!spiele.length && el("meldung").hidden) {
    el("meldung").textContent = "Noch keine Spiele.";
    el("meldung").hidden = false;
  }

  window.addEventListener("hashchange", route);
  route();
}

start();
