// Ende-zu-Ende-Test der UI-Bausteine (site/ui/, Testseite /ui-test/): Aussehen, kein Aufblitzen, Dialoge mit Tastatur,
// Meldungen, Reiter, Menü, Handy-Breite, Einstellungen speichern. Aufbau wie e2e-zentrale-1.5.mjs (Teststand mit DEV_USER=seb).
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-bausteine.mjs <ordner> [upload-passwort]
// Nur die Seite ohne Server (z. B. python3 -m http.server in site/): E2E_G=http://127.0.0.1:18777 E2E_OHNE_API=1 node scripts/e2e-bausteine.mjs /tmp/x
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as warte } from "node:timers/promises";
const G = process.env.E2E_G || "http://127.0.0.1:18088";
const DIR = process.argv[2] || "/tmp/sb-e2e-bausteine";
mkdirSync(DIR, { recursive: true });
const PORT = 9334;
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [...(process.env.CHROME_BIN ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] : []), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${DIR}/chrome-profil`, "--no-first-run", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
let ws, nr = 0; const offen = new Map(); const fehler = []; const konsole = []; const ergebnis = [];
const ok = (bed, text) => { ergebnis.push((bed ? "✓ " : "✗ ") + text); if (!bed) process.exitCode = 1; };
function cdp(method, params = {}, sessionId) {
  const id = ++nr; ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ja, nein) => offen.set(id, { ja, nein }));
}
let S;
async function eval_(ausdruck) {
  const r = await cdp("Runtime.evaluate", { expression: ausdruck, awaitPromise: true, returnByValue: true, userGesture: true }, S);
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function bis(ausdruck, ms = 8000) { const ende = Date.now() + ms; while (Date.now() < ende) { if (await eval_(ausdruck).catch(() => false)) return true; await warte(150); } return false; }
async function gehe(url) { await cdp("Page.navigate", { url }, S); await warte(300); return bis("window.uiTestBereit === true"); }
const taste = async (key, code = key, keyCode = 0) => {
  // Enter braucht das Zeichen, sonst sendet der Browser das Formular nicht ab
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }, S);
  await warte(120);
};
const breite = (w, h = 900) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, S);
const farbschema = (wert) => cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: wert }] }, S);
const hintergrund = () => eval_(`getComputedStyle(document.body).backgroundColor`);

(async () => {
  let v = null;
  for (let i = 0; i < 60 && !v; i++) { await warte(250); v = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
  if (!v) throw new Error("Chrome startet nicht");
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) { const o = offen.get(d.id); offen.delete(d.id); d.error ? o.nein(new Error(d.error.message)) : o.ja(d.result); }
    if (d.method === "Runtime.exceptionThrown") fehler.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") konsole.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error" && !/favicon/.test(d.params.entry.url || "")) konsole.push(d.params.entry.text);
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Page.enable", {}, S); await cdp("Runtime.enable", {}, S); await cdp("Log.enable", {}, S);
  // Was steht an <html>, bevor die Seite fertig ist? (zeigt, ob thema-frueh.js vor dem ersten Zeichnen wirkt)
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { window.__frueh = document.documentElement.getAttribute("data-thema") || "auto"; }, { once: true });` }, S);
  await breite(1280);

  // 1. Laden ohne Fehler (auch CSP: keine Inline-Skripte nötig)
  ok(await gehe(G + "/ui-test/"), "Testseite lädt und baut alle Bausteine");
  ok(fehler.length === 0 && konsole.length === 0, "keine Skript- oder CSP-Fehler" + (fehler.length + konsole.length ? ": " + [...fehler, ...konsole].join(" | ") : ""));
  ok(await eval_(`document.querySelectorAll(".b-kachel").length >= 9 && !!document.querySelector(".b-tabelle tbody tr")`), "Kacheln und Tabelle sind da");

  // 2. Thema: folgt dem Gerät, Umschalter wirkt sofort, kein Aufblitzen nach dem Neuladen
  await farbschema("light"); const hellAuto = await hintergrund();
  await farbschema("dark"); const dunkelAuto = await hintergrund();
  ok(hellAuto !== dunkelAuto, `„Automatisch“ folgt dem Gerät (${hellAuto} / ${dunkelAuto})`);
  await eval_(`document.querySelector('#t-thema [data-wert="hell"]').click()`);
  ok(await eval_(`document.documentElement.dataset.thema === "hell"`) && (await hintergrund()) === hellAuto, "„Hell“ gewinnt gegen ein dunkles Gerät");
  await eval_(`document.querySelector('#t-thema [data-wert="dunkel"]').click()`);
  await gehe(G + "/ui-test/");
  ok(await eval_(`window.__frueh === "dunkel"`), "nach dem Neuladen ist „Dunkel“ schon vor dem ersten Zeichnen gesetzt (kein Aufblitzen)");
  await farbschema("light");
  ok((await hintergrund()) === dunkelAuto, "„Dunkel“ bleibt, auch wenn das Gerät hell ist");
  await eval_(`document.querySelector('#t-thema [data-wert="auto"]').click()`);
  ok(await eval_(`!document.documentElement.hasAttribute("data-thema") && JSON.parse(localStorage.getItem("sb-aussehen")).thema === "auto"`), "„Automatisch“ entfernt das Attribut und merkt es sich");

  // 3. Akzent und Dichte
  const akzentVorher = await eval_(`getComputedStyle(document.querySelector("#t-k-primaer")).backgroundColor`);
  await eval_(`document.querySelector('#t-akzent [data-wert="violett"]').click()`);
  await warte(400);   // Knöpfe blenden die Farbe in 120 ms über
  const akzentNachher = await eval_(`getComputedStyle(document.querySelector("#t-k-primaer")).backgroundColor`);
  ok(akzentVorher !== akzentNachher && await eval_(`document.documentElement.dataset.akzent === "violett"`), "Akzentfarbe wechselt den Hauptknopf");
  ok(await eval_(`(() => { const f = [...document.querySelectorAll(".b-farbwahl__punkt")].map((k) => getComputedStyle(k).backgroundColor); return new Set(f).size === f.length; })()`), "jeder Farbpunkt zeigt seine eigene Farbe");
  const hoeheNormal = await eval_(`document.querySelector("#t-name").getBoundingClientRect().height`);
  await eval_(`document.querySelector('#t-dichte [data-wert="luftig"]').click()`);
  const hoeheLuftig = await eval_(`document.querySelector("#t-name").getBoundingClientRect().height`);
  ok(hoeheLuftig > hoeheNormal, `„Luftig“ macht Felder höher (${hoeheNormal} → ${hoeheLuftig} px)`);
  await eval_(`document.querySelector('#t-dichte [data-wert="normal"]').click(); document.querySelector('#t-akzent [data-wert="blau"]').click()`);

  // 4. Bestätigen-Dialog nur mit Tastatur: Fokus drin (auf „Abbrechen“, weil gefährlich), Tab bleibt drin, Esc = false, Fokus zurück
  await eval_(`document.querySelector("#t-bestaetigen").focus(); document.querySelector("#t-bestaetigen").click()`);
  ok(await bis(`!!document.querySelector("dialog.b-dialog[open]")`), "Bestätigen-Dialog öffnet sich");
  ok(await eval_(`document.activeElement.textContent === "Abbrechen"`), "bei Gefährlichem steht der Fokus auf „Abbrechen“");
  for (let i = 0; i < 5; i++) await taste("Tab", "Tab", 9);
  ok(await eval_(`!!document.activeElement.closest("dialog.b-dialog")`), "Tab bleibt im Dialog");
  await taste("Escape", "Escape", 27);
  ok(await bis(`!document.querySelector("dialog.b-dialog") && window.uiTestErgebnis === false`), "Esc schließt und ergibt „nein“");
  ok(await eval_(`document.activeElement.id === "t-bestaetigen"`), "Fokus springt zurück auf den Knopf");
  await eval_(`document.querySelector("#t-bestaetigen").click()`);
  await bis(`!!document.querySelector("dialog.b-dialog[open]")`);
  await eval_(`[...document.querySelectorAll("dialog.b-dialog button")].find((b) => b.textContent === "Endgültig löschen").click()`);
  ok(await bis(`window.uiTestErgebnis === true`), "„Endgültig löschen“ ergibt „ja“");

  // 5. Eingabe-Dialog prüft die Eingabe
  await eval_(`document.querySelector("#t-eingabe").click()`);
  await bis(`!!document.querySelector("dialog.b-dialog[open] input")`);
  ok(await eval_(`document.activeElement.tagName === "INPUT"`), "Eingabe-Dialog setzt den Fokus ins Feld");
  await eval_(`{ const i = document.activeElement; i.value = "kurz"; i.dispatchEvent(new Event("input")); } true`);
  await taste("Enter", "Enter", 13);
  ok(await eval_(`!!document.querySelector("dialog.b-dialog[open] .b-feld__fehler:not([hidden])")`), "zu kurze Eingabe zeigt einen Fehler und bleibt offen");
  await eval_(`{ const i = document.querySelector("dialog.b-dialog input"); i.value = "Hat im Chat beleidigt"; } true`);
  await taste("Enter", "Enter", 13);
  ok(await bis(`window.uiTestErgebnis === "Hat im Chat beleidigt"`), "gültige Eingabe kommt zurück");

  // 6. Meldungen: Erfolg im Live-Bereich, Fehler bleibt stehen
  await eval_(`document.querySelectorAll(".b-meldung").forEach((m) => m.remove()); document.querySelector("#t-meldung").click()`);
  ok(await eval_(`!!document.querySelector('.b-meldungen[aria-live="polite"] .b-meldung--erfolg[role="status"]')`), "Erfolgsmeldung erscheint im Live-Bereich");
  await eval_(`document.querySelector("#t-meldung-fehler").click()`);
  ok(await eval_(`!!document.querySelector('.b-meldung--fehler[role="alert"]')`), "Fehlermeldung wird vorgelesen (role=alert)");

  // 7. Reiter mit Pfeiltasten, Menü mit Esc
  await eval_(`document.querySelector('#t-reiter [aria-selected="true"]').focus()`);
  await taste("ArrowRight", "ArrowRight", 39);
  ok(await eval_(`document.querySelector('#t-reiter [aria-selected="true"]').dataset.id === "spiele" && document.activeElement.dataset.id === "spiele"`), "Pfeil rechts wechselt den Reiter");
  await taste("End", "End", 35);
  ok(await eval_(`document.querySelector('#t-reiter [aria-selected="true"]').dataset.id === "aufgaben"`), "Ende springt zum letzten Reiter");
  await eval_(`document.querySelector("#t-konto").click()`);
  ok(await bis(`!document.querySelector("#t-konto-menue").hidden && document.activeElement.closest("#t-konto-menue") !== null`), "Kontomenü öffnet, Fokus im Menü");
  await taste("ArrowDown", "ArrowDown", 40);
  await taste("Escape", "Escape", 27);
  ok(await eval_(`document.querySelector("#t-konto-menue").hidden && document.activeElement.id === "t-konto"`), "Esc schließt das Menü, Fokus zurück");

  // 8. Startseite anordnen
  await eval_(`[...document.querySelectorAll(".b-sortierliste button")].find((b) => b.getAttribute("aria-label") === "Favoriten nach oben").click()`);
  ok(await eval_(`window.uiTestStartseite && window.uiTestStartseite[0].id === "favoriten"`), "„nach oben“ ändert die Reihenfolge");

  // 9. Handy: nichts ragt über den Rand (320 und 390 px), Knöpfe treffbar
  for (const w of [320, 390]) {
    await breite(w, 800);
    await warte(200);
    const zuBreit = await eval_(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => {
      const r = e.getBoundingClientRect(); if (!r.width) return false; let p = e.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "hidden" || o === "scroll") return false; p = p.parentElement; }
      return r.right > w + 1; }).slice(0, 5).map((e) => e.tagName.toLowerCase() + "." + [...e.classList].join(".") + " " + Math.round(e.getBoundingClientRect().right)); })()`);
    ok(zuBreit.length === 0 && await eval_(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), `${w} px: nichts ragt über den Rand` + (zuBreit.length ? " – " + zuBreit.join(", ") : ""));
    // Konto-Menü in der Kopfleiste: am Handy ein Blatt unten, ganz im Bild (13.11.2026: hing an der Kopfleiste und ragte oben hinaus)
    await eval_(`scrollTo(0, 300); document.querySelector("#t-konto").click()`);
    await bis(`!document.querySelector("#t-konto-menue").hidden`);
    const lage = await eval_(`(() => { const r = document.querySelector("#t-konto-menue").getBoundingClientRect(); return { oben: Math.round(r.top), unten: Math.round(r.bottom), h: innerHeight }; })()`);
    ok(lage.oben >= 0 && lage.unten <= lage.h && lage.unten > lage.h / 2, `${w} px: Konto-Menü ganz im Bild, unten als Blatt (oben ${lage.oben}, unten ${lage.unten} von ${lage.h})`);
    await taste("Escape", "Escape", 27);
    await eval_(`scrollTo(0, 0)`);
  }
  await breite(1280);

  // 10. Einstellungen am Server (nur mit Teststand)
  if (!process.env.E2E_OHNE_API) {
    const r = await eval_(`fetch("/api/einstellungen", { method: "PUT", headers: { "Content-Type": "application/json", "X-Bibliothek": "1" }, body: JSON.stringify({ aussehen: { thema: "dunkel", akzent: "orange" } }) }).then((r) => r.json())`);
    ok(r.aussehen && r.aussehen.thema === "dunkel" && r.aussehen.akzent === "orange", "Aussehen wird am Server gespeichert");
    const zurueck = await eval_(`fetch("/api/einstellungen").then((r) => r.json())`);
    ok(zurueck.aussehen.akzent === "orange" && zurueck.startseite.abschnitte.length === 5, "und kommt beim Lesen zurück, mit fünf Startseiten-Abschnitten");
    await eval_(`fetch("/api/einstellungen", { method: "PUT", headers: { "Content-Type": "application/json", "X-Bibliothek": "1" }, body: JSON.stringify({ aussehen: { thema: "auto", akzent: "blau" } }) })`);
  }
  ok(fehler.length === 0, "am Ende keine Skriptfehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));

  console.log(ergebnis.join("\n"));
  const rot = ergebnis.filter((z) => z.startsWith("✗")).length;
  console.log(rot ? `\n${rot} von ${ergebnis.length} Prüfpunkten ROT` : `\nAlle ${ergebnis.length} Prüfpunkte grün`);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
