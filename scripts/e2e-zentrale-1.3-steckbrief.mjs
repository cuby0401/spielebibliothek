// Ende-zu-Ende-Test für Zentrale 1.3.0: Beschreibung und Vorschaubild auf der Upload-Seite (Steckbrief, E61),
// „noch nie angemeldet“ und Cloudflare-Abgleich im Admin-Panel, Anfragen an Entwickler, Simulation endet im Admin-Panel,
// Reiter „Aufgaben“. Aufbau wie e2e-zentrale-1.3.mjs.
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-zentrale-1.3-steckbrief.mjs <ordner> <upload-passwort>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as warte } from "node:timers/promises";
// Auf der NAS (Auftragsdienst, 1.3.0) setzt scripts/e2e-nas.sh Hostnamen und Chrome per Umgebung
const G = process.env.E2E_G || "http://<NAS_GH>:18088", U = process.env.E2E_U || "http://<NAS_UH>:18090";
const DIR = process.argv[2], PW = process.argv[3];
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [...(process.env.CHROME_BIN ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] : []), "--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${DIR}/chrome-profil`, "--no-first-run", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());   // Chrome nie hängen lassen, auch bei Abbruch
let ws, nr = 0; const offen = new Map(); const fehler = []; const ergebnis = [];
const ok = (bed, text) => { ergebnis.push((bed ? "✓ " : "✗ ") + text); if (!bed) process.exitCode = 1; };
function cdp(method, params = {}, sessionId) {
  const id = ++nr; ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ja, nein) => offen.set(id, { ja, nein }));
}
let S;
async function eval_(ausdruck) {
  const r = await cdp("Runtime.evaluate", { expression: ausdruck, awaitPromise: true, returnByValue: true }, S);
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
// 1.4.1 (schnellere Tests): statt fest ms zu warten, bis die Seite geladen ist und das DOM 400 ms still steht – höchstens ms
const RUHIG = `new Promise((fertig) => { const los = () => { let t; const o = new MutationObserver(() => { clearTimeout(t); t = setTimeout(ende, 400); });
  const ende = () => { o.disconnect(); fertig(true); }; o.observe(document, { subtree: true, childList: true, characterData: true, attributes: true }); t = setTimeout(ende, 400); };
  document.readyState === "complete" ? los() : addEventListener("load", los, { once: true }); })`;
async function gehe(url, ms = 2500) {
  await cdp("Page.navigate", { url }, S);
  const ende = Date.now() + ms;
  await warte(200);
  while (Date.now() < ende) {
    const ok = await Promise.race([eval_(RUHIG).catch(() => false), warte(Math.max(0, ende - Date.now())).then(() => true)]);
    if (ok) return;
    await warte(100);
  }
}
async function bis(ausdruck, ms = 10000) { const ende = Date.now() + ms; while (Date.now() < ende) { if (await eval_(ausdruck).catch(() => false)) return true; await warte(250); } return false; }

// Testbilder: echtes 1×1-PNG und ein SVG mit Skript (muss abgelehnt werden)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
writeFileSync(`${DIR}/vorschau.png`, PNG);
writeFileSync(`${DIR}/boese.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// Steckbrief des Spiels „zaehler“ aufklappen
const BOX = `document.querySelector("#spiel-zaehler [data-steckbrief]")`;
async function steckbriefOeffnen() {
  await bis(`!!(${BOX})`);
  await eval_(`{ const d=${BOX}; if(!d.open) d.querySelector("summary").click(); } true`);
  return bis(`!!(${BOX}).querySelector("textarea")`);
}
async function bildWaehlen(datei) {
  const doc = await cdp("DOM.getDocument", { depth: -1 }, S);
  await eval_(`(${BOX}).querySelector('input[type="file"]').id="e2e-bild"; true`);
  const n = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#e2e-bild" }, S);
  await cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [`${DIR}/${datei}`] }, S);
}

(async () => {
  let v = null;   // Chrome braucht unterschiedlich lange zum Start – bis zu 15 s warten
  for (let i = 0; i < 60 && !v; i++) { await warte(250); v = await fetch("http://127.0.0.1:9333/json/version").then((r) => r.json()).catch(() => null); }
  if (!v) throw new Error("Chrome startet nicht");
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) { const o = offen.get(d.id); offen.delete(d.id); d.error ? o.nein(new Error(d.error.message)) : o.ja(d.result); }
    if (d.method === "Runtime.exceptionThrown") fehler.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Page.javascriptDialogOpening") cdp("Page.handleJavaScriptDialog", { accept: true }, d.sessionId);
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Page.enable", {}, S); await cdp("Runtime.enable", {}, S); await cdp("DOM.enable", {}, S);
  // UI-Bausteine (11.11.2026): Rückfragen sind eigene Dialoge (UI.bestaetigen) statt confirm() – wie früher automatisch bestätigen, Text in window.__dialoge
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `new MutationObserver(() => { for (const d of document.querySelectorAll('dialog[data-art="bestaetigen"][open]:not([data-e2e])')) {
    d.dataset.e2e = "1"; (window.__dialoge = window.__dialoge || []).push(d.textContent);
    setTimeout(() => d.querySelector(".b-dialog__fuss .b-knopf--primaer, .b-dialog__fuss .b-knopf--gefahr").click(), 50); } }).observe(document, { subtree: true, childList: true, attributes: true });` }, S);

  // 1) Upload-Seite: anmelden, Beschreibung eintragen
  await gehe(U + "/");
  await eval_(`document.getElementById("passwort").value=${JSON.stringify(PW)}; document.getElementById("anmeldeform").requestSubmit(); true`);
  ok(await bis(`!document.getElementById("bereich").hidden`), "Upload-Seite: angemeldet");
  ok(await steckbriefOeffnen(), "„Beschreibung und Vorschaubild“ klappt auf");
  ok(await eval_(`/Noch kein Vorschaubild|Kein eigenes Bild/.test((${BOX}).textContent)`), "Noch kein eigenes Vorschaubild");
  await eval_(`{ const d=${BOX}; d.querySelector('input[type="text"]').value="Zähler Deluxe";
    d.querySelector("textarea").value="E2E-Beschreibung unter der Kachel"; d.querySelector("textarea").dispatchEvent(new Event("input"));
    [...d.querySelectorAll("button")].find(b=>b.textContent==="Speichern").click(); } true`);
  ok(await bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("Beschreibung gespeichert")`), "Beschreibung gespeichert");

  // 2) Vorschaubild: SVG abgelehnt, PNG angenommen
  await warte(800);
  await steckbriefOeffnen();
  ok(await eval_(`(${BOX}).querySelector("textarea").value`) === "E2E-Beschreibung unter der Kachel", "Beschreibung bleibt nach Neuladen erhalten");
  await bildWaehlen("boese.svg");
  ok(await bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("Nur PNG, JPG oder WebP")`), "SVG als Vorschaubild abgelehnt");
  await bildWaehlen("vorschau.png");
  ok(await bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("Vorschaubild gespeichert")`), "PNG als Vorschaubild gespeichert");
  ok(await bis(`(()=>{const i=(${BOX}).querySelector("[data-vorschau] img"); return i && i.complete && i.naturalWidth===1})()`), "Vorschau auf der Upload-Seite sichtbar");

  // 3) Bibliothek: Kachel zeigt Titel, Beschreibung und Bild aus dem Steckbrief
  await gehe(G + "/", 3500);
  const KACHEL = `[...document.querySelectorAll(".b-kachel")].find(k=>k.querySelector(".b-kachel__titel").textContent==="Zähler Deluxe")`;
  ok(await bis(`!!(${KACHEL})`), "Kachel mit neuem Titel „Zähler Deluxe“");
  ok(await eval_(`(${KACHEL}).querySelector(".b-kachel__beschreibung").textContent`) === "E2E-Beschreibung unter der Kachel", "Kachel zeigt die Beschreibung");
  ok(await bis(`(()=>{const i=(${KACHEL}).querySelector(".b-kachel__bild img"); return i && i.src.includes("/api/vorschau/seb/zaehler") && i.complete && i.naturalWidth===1})()`),
    "Kachel zeigt das Vorschaubild (über /api/vorschau)");
  const kopf = await eval_(`fetch((${KACHEL}).querySelector(".b-kachel__bild img").src).then(r=>r.headers.get("content-type")+"|"+r.headers.get("x-content-type-options"))`);
  ok(kopf === "image/png|nosniff", "Vorschaubild mit richtigem Typ und nosniff: " + kopf);

  // 4) Bild entfernen → wieder Platzhalter
  await gehe(U + "/");
  await steckbriefOeffnen();
  await bis(`!!(${BOX}).querySelector("[data-vorschau] img")`);
  await eval_(`[...(${BOX}).querySelectorAll("button")].find(b=>b.textContent==="Bild entfernen").click(); true`);
  ok(await bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("Vorschaubild entfernt")`), "Vorschaubild entfernt");

  // 5) Admin-Panel: „noch nie angemeldet“ und Cloudflare-Abgleich (im Teststand nicht eingerichtet)
  await gehe(G + "/admin/#benutzer", 4000);
  ok(await bis(`!!document.querySelector('tr[data-schluessel="paul"]')?.textContent.includes("noch nie angemeldet")`), "Admin: „noch nie angemeldet“ bei paul");
  ok(await eval_(`document.querySelector('tr[data-schluessel="seb"]')?.textContent.includes("noch nie angemeldet")`) === false, "Admin: seb ist angemeldet");
  ok(await eval_(`document.body.textContent.includes("Cloudflare-Abgleich nicht eingerichtet")`), "Admin: Hinweis „Cloudflare-Abgleich nicht eingerichtet“");
  ok(await eval_(`document.body.textContent.includes("scripts/cloudflare.py abgleichen")`), "Admin: Hinweis auf scripts/cloudflare.py beim Anlegen");

  // 6) Anfragen: Anfrage zu pauls Spiel geht an paul – im Admin-Panel ohne Zahl, nur eingeklappt zur Info
  await gehe(G + "/", 3000);
  const an = await eval_(`fetch("/api/antraege",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},
    body:JSON.stringify({art:"fehler",spiel:"paul/raetsel",text:"E2E: Knopf reagiert nicht"})}).then(r=>r.json()).then(d=>d.an)`);
  ok(an === "paul", "Anfrage zu pauls Spiel geht an paul");
  await gehe(G + "/#/antraege", 3000);
  ok(await eval_(`document.body.textContent.includes("geht an paul (Entwickler)")`), "Absender sieht: geht an paul");
  await gehe(G + "/admin/#antraege", 3500);
  ok(await bis(`!!document.querySelector("details summary")`) && await eval_(`!document.querySelector('#reiter [data-id="antraege"] .b-zahl')`), "Admin-Panel: keine Zahl für Spiel-Anfragen");
  ok(await eval_(`[...document.querySelectorAll("details summary")].some(s=>s.textContent.includes("Anfragen zu Spielen") && s.textContent.includes("1 offen"))`),
    "Admin-Panel: Spiel-Anfrage nur eingeklappt zur Info");

  // 7) Simulation: Beenden führt zurück ins Admin-Panel
  await gehe(G + "/admin/#uebersicht", 3500);
  await bis(`!![...document.querySelectorAll("button")].find(b=>b.textContent==="Ansicht als Spieler")`);
  await eval_(`[...document.querySelectorAll("button")].find(b=>b.textContent==="Ansicht als Spieler").click(); true`);
  ok(await bis(`location.pathname==="/" && !document.getElementById("ansicht-band").hidden`, 8000), "Simulation startet im Hauptmenü");
  await eval_(`document.getElementById("ansicht-ende").click(); true`);
  ok(await bis(`location.pathname==="/admin/" && location.hash==="#uebersicht"`, 8000), "Simulation beenden → zurück ins Admin-Panel (Übersicht)");

  // 8) Aufgaben: Auftragsdienst nicht eingerichtet, Auftrag anlegen, Zeitplan
  await gehe(G + "/admin/#aufgaben", 3500);
  ok(await bis(`document.body.textContent.includes("Noch nicht eingerichtet")`), "Aufgaben: Hinweis „Auftragsdienst noch nicht eingerichtet“");
  await eval_(`[...document.querySelectorAll("button")].find(b=>b.textContent==="Jetzt starten").click(); true`);
  ok(await bis(`[...document.querySelectorAll("td")].some(t=>t.textContent==="wartet")`), "Aufgaben: Unit-Tests gestartet (wartet)");
  await eval_(`{ const i=document.querySelector('input[type="time"]'); i.value="03:30"; i.closest("td").querySelector("button").click(); } true`);
  ok(await bis(`[...document.querySelectorAll(".b-meldung__text")].some(m=>m.textContent.includes("täglich um 03:30"))`), "Aufgaben: Zeitplan täglich 03:30");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
