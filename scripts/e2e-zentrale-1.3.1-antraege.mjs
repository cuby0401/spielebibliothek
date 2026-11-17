// Ende-zu-Ende-Test für Zentrale 1.3.1: Entwurf testen → „Zurück zum Hochladen“ (Anfrage von Emil),
// Anfrage mit Bild, Glocke öffnet die Anfrage, Antworten in der Anfrage. Aufbau wie e2e-zentrale-1.3-steckbrief.mjs.
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-zentrale-1.3.1-antraege.mjs <ordner> <upload-passwort>
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as warte } from "node:timers/promises";
// Auf der NAS (Auftragsdienst, 1.3.0) setzt scripts/e2e-nas.sh Hostnamen und Chrome per Umgebung
const G = process.env.E2E_G || "http://127.0.0.1:18088", U = process.env.E2E_U || "http://upload.localhost:18090";
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
async function datei(selektor, name) {
  const doc = await cdp("DOM.getDocument", { depth: -1 }, S);
  const n = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: selektor }, S);
  await cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [`${DIR}/${name}`] }, S);
}
// Testbild: echtes 4×4-PNG (rot)
writeFileSync(`${DIR}/screenshot.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==", "base64"));

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

  // 1) Upload-Seite: anmelden, Entwurf hochladen, „Testen“ im selben Tab
  await gehe(U + "/");
  await eval_(`document.getElementById("passwort").value=${JSON.stringify(PW)}; document.getElementById("anmeldeform").requestSubmit(); true`);
  ok(await bis(`!document.getElementById("bereich").hidden`), "Upload-Seite: angemeldet");
  await datei("#datei", "e2e-v1.zip");
  await eval_(`document.getElementById("ordner").value="e2e"; document.getElementById("neu").value="Erste Version"; document.getElementById("uploadform").requestSubmit(); true`);
  ok(await bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("als Entwurf hochgeladen")`), "Entwurf hochgeladen");
  const TESTEN = `[...document.querySelectorAll("#spiel-e2e a")].find(a=>a.textContent==="Testen")`;
  ok(await bis(`!!(${TESTEN})`), "Spiel hat die Kennung #spiel-e2e und einen Knopf „Testen“");
  ok(await eval_(`!(${TESTEN}).target`), "„Testen“ öffnet im selben Tab (kein neuer Tab)");

  // 2) Entwurf: Zurück-Knopf und Hinweis führen zur Upload-Seite (zum Spiel)
  await gehe(G + "/#/entwurf/seb/e2e", 5000);
  ok(await bis(`!document.getElementById("entwurf-hinweis").hidden`), "Entwurf läuft");
  const zurueck = await eval_(`({ t: document.getElementById("spiel-zurueck").textContent, h: document.getElementById("spiel-zurueck").href,
    l: document.querySelector("#entwurf-hinweis a")?.href })`);
  ok(zurueck.t === "Zurück zum Hochladen", "Zurück-Knopf heißt „Zurück zum Hochladen“");
  ok(zurueck.h.endsWith("/#spiel-e2e") && zurueck.l === zurueck.h, "Zurück-Knopf und Hinweis-Link führen zu …/#spiel-e2e: " + zurueck.h);
  await gehe(U + "/#spiel-e2e", 4000);
  ok(await bis(`document.getElementById("spiel-e2e")?.hasAttribute("data-hervorgehoben")`), "Upload-Seite: Spiel e2e wird hervorgehoben");
  ok(await eval_(`[...document.querySelectorAll("#spiel-e2e button")].some(b=>b.textContent==="Veröffentlichen …")`), "… mit „Veröffentlichen …“ direkt dabei");

  // 3) Anfrage mit Bild über das Formular
  await gehe(G + "/#/antraege", 3000);
  await eval_(`document.querySelector("#antrag-formular textarea").value="E2E: Zurück-Knopf im Entwurf"; true`);
  await datei('#antrag-formular input[type="file"]', "screenshot.png");
  ok(await bis(`(()=>{const i=document.querySelector("#bild-vorschau img"); return i && i.complete && i.naturalWidth===4})()`), "Bild-Vorschau im Formular (verkleinert/umgewandelt)");
  await eval_(`document.querySelector("#antrag-formular").requestSubmit(); true`);
  ok(await bis(`document.body.textContent.includes("Anfrage verschickt")`), "Anfrage mit Bild verschickt");
  ok(await bis(`[...document.querySelectorAll("a")].some(a=>a.textContent==="Öffnen · 1 Bild")`), "„Meine Anfragen“: „Öffnen · 1 Bild“");

  // 4) Glocke: Meldung führt direkt in die Anfrage
  await gehe(G + "/", 3500);
  await eval_(`document.getElementById("glocke-knopf").click(); true`);
  ok(await bis(`[...document.querySelectorAll("#glocke-liste a")].some(a=>/\\/#\\/antrag\\/\\d+$/.test(a.href))`), "Glocke: Meldung verlinkt auf die Anfrage");
  await eval_(`[...document.querySelectorAll("#glocke-liste a")].find(a=>/\\/#\\/antrag\\/\\d+$/.test(a.href)).click(); true`);
  ok(await bis(`/^Anfrage #\\d+$/.test(document.querySelector("#seite h1")?.textContent || "")`), "Anfrage öffnet sich als eigene Seite");
  ok(await eval_(`document.querySelector("#antrag-text").textContent`) === "E2E: Zurück-Knopf im Entwurf", "Anfragetext steht im Ticket");
  ok(await bis(`(()=>{const i=document.querySelector("#antrag-galerie img"); return i && i.complete && i.naturalWidth===4})()`), "Bild wird in der Anfrage angezeigt");
  const art = await eval_(`fetch(document.querySelector("#antrag-galerie img").src).then(r=>r.headers.get("content-type")+"|"+r.headers.get("x-content-type-options"))`);
  ok(/^image\/(webp|jpeg)\|nosniff$/.test(art), "Bild mit richtigem Typ und nosniff: " + art);

  // 5) Antworten im Ticket (Admin-Anfrage → seb darf antworten)
  await eval_(`document.querySelector("#seite textarea").value="E2E erledigt"; [...document.querySelectorAll("#seite button")].find(b=>b.textContent==="Erledigt").click(); true`);
  ok(await bis(`document.querySelector("#antrag-status")?.textContent==="erledigt"`), "Anfrage im Ticket erledigt");
  ok(await eval_(`document.querySelector("#antrag-antwort")?.textContent.includes("E2E erledigt")`), "Antwort steht im Ticket");
  ok(await eval_(`document.querySelector("#seite-zurueck").getAttribute("href")`) === "#/", "Zurück-Pfeil führt dorthin, wo man herkam (Übersicht)");

  // 6) Admin-Panel: „Öffnen“ bei der Anfrage
  await gehe(G + "/admin/#antraege", 3500);
  ok(await bis(`[...document.querySelectorAll("a")].some(a=>/^Öffnen \\(1 Bild\\)$/.test(a.textContent) && a.getAttribute("href").startsWith("/#/antrag/"))`), "Admin-Panel: „Öffnen (1 Bild)“");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
