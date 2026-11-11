// Ende-zu-Ende-Test für Zentrale 1.2.1 (Profil mit Spielständen/Anmeldungen, Menü, Glocke archivieren/löschen, SVG statt Emojis, Größen). Wie e2e-zentrale-1.2.mjs.
import { spawn } from "node:child_process";
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
let S; const ladeWarten = [];
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
async function hochladen(datei, neu) {
  const doc = await cdp("DOM.getDocument", {}, S);
  const n = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#datei" }, S);
  await cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [`${DIR}/${datei}`] }, S);
  await eval_(`document.getElementById("ordner").value="e2e"; document.getElementById("neu").value=${JSON.stringify(neu)};
    document.getElementById("uploadform").requestSubmit(); true`);
  return bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("als Entwurf hochgeladen")`);
}
async function updateFensterOeffnen() {
  await bis(`[...document.querySelectorAll("button")].some(b=>b.textContent==="Veröffentlichen …")`);
  await eval_(`[...document.querySelectorAll("button")].find(b=>b.textContent==="Veröffentlichen …").click(); true`);
  return bis(`document.getElementById("update-fenster").open`);
}
const dialoge = [];
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
    if (d.method === "Page.javascriptDialogOpening") { dialoge.push(d.params.message); cdp("Page.handleJavaScriptDialog", { accept: true, promptText: "Test-Grund" }, d.sessionId); }
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Page.enable", {}, S); await cdp("Runtime.enable", {}, S); await cdp("DOM.enable", {}, S);
  // UI-Bausteine (11.11.2026): Rückfragen sind eigene Dialoge (UI.bestaetigen) statt confirm() – wie früher automatisch bestätigen, Text in window.__dialoge
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `new MutationObserver(() => { for (const d of document.querySelectorAll('dialog[data-art="bestaetigen"][open]:not([data-e2e])')) {
    d.dataset.e2e = "1"; (window.__dialoge = window.__dialoge || []).push(d.textContent);
    setTimeout(() => d.querySelector(".b-dialog__fuss .b-knopf--primaer, .b-dialog__fuss .b-knopf--gefahr").click(), 50); } }).observe(document, { subtree: true, childList: true, attributes: true });` }, S);

  // 1) Konto (seit 11.11.2026 wieder mit Kontextmenü aus den Bausteinen, wie im Admin-Panel); Admin-Link oben; Symbole
  await gehe(G + "/", 3500);
  await eval_(`document.getElementById("menue-knopf").click(); true`);
  ok(await bis(`!document.getElementById("konto-menue").hidden && [...document.querySelectorAll("#konto-menue a")].some(a=>a.getAttribute("href")==="#/profil")`), "Konto-Menü mit Link ins Profil");
  await eval_(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"})); document.body.click(); true`);
  ok(await eval_(`/^[A-Z]{1,2}$/.test(document.getElementById("avatar").textContent) && !document.getElementById("admin-link").hidden`), "Initialen-Bild und Admin-Link für Admins");
  ok(await eval_(`!!document.querySelector("#glocke-knopf svg.b-ikon") && !/🔔/.test(document.getElementById("glocke-knopf").textContent)`), "Glocke als SVG, ohne Emoji");
  ok(await eval_(`!!document.querySelector(".b-kachel [data-daumen] svg.b-ikon") && ![...document.querySelectorAll("[data-daumen]")].some(d=>/👍/.test(d.textContent))`), "Daumen als SVG, ohne Emoji");

  // 2) Profil: Spiele, Spielstände, Anmeldungen; Spike zählt nicht
  await eval_(`fetch("/api/save/seb/zaehler/stand",{method:"PUT",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({data:1})}).then(r=>r.status)`);
  await eval_(`fetch("/api/spielzeit/seb/spike",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({sekunden:60})}).then(r=>r.status)`);
  await eval_(`fetch("/api/admin/spiele/seb/spike",{method:"PATCH",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({testspiel:true})}).then(r=>r.status)`);
  await gehe(G + "/#/profil", 3500);
  const leiste = await eval_(`[...document.querySelectorAll("#konto-leiste a")].map(a=>a.textContent).join("|")`);
  ok(leiste === "Profil|Meine Spiele|Meine Spielstände|Anfragen|Einstellungen|Sicherheit|Admin-Panel|Abmelden", "Konto-Leiste (1.4.0): " + leiste);
  ok(await eval_(`document.querySelector("#konto-leiste a[aria-current=page]").textContent==="Profil" && !!document.querySelector("#profil-kopf .b-avatar--xl")`), "Profil aktiv, Kopf mit Bild");
  const h2 = await eval_(`[...document.querySelectorAll("#seite h2")].map(h=>h.textContent).join("|")`);
  ok(h2 === "Meine Angaben|Gespielte Spiele mit Plätzen und Erfolgen", "Profil: Meine Angaben, gespielte Spiele: " + h2);
  ok(await eval_(`!document.querySelector("#seite table").textContent.includes("Sandbox-Spike")`), "Profil: Testspiel Spike zählt nicht");
  ok(await eval_(`[...document.querySelectorAll("#seite table thead th")].map(t=>t.textContent).join("|")==="Spiel|von|Spielzeit|Platz (aktuelle Season)|Erfolge"
    && [...document.querySelectorAll("#seite table tbody td:nth-child(2)")].some(t=>t.textContent==="dir")`), "Profil (1.4.1): Spalte „von“, eigene Spiele „dir“");
  await gehe(G + "/#/spielstaende", 3000);
  ok(await eval_(`document.querySelector("#spielstaende").textContent.includes("Zähler") && document.querySelector("#konto-leiste a[aria-current=page]").textContent==="Meine Spielstände"`), "Meine Spielstände: Zähler");
  await gehe(G + "/#/sicherheit", 3000);
  ok(await eval_(`document.querySelector("#anmeldungen").textContent.includes("dieses Gerät")`), "Sicherheit: Anmeldung dieses Geräts");
  ok(await eval_(`document.querySelector("#anmeldungen").textContent.includes("Probe/Teststand – keine echte Anmeldung")`), "Teststand: Anmeldung als „keine echte Anmeldung“ markiert, ohne Docker-IP");
  await gehe(G + "/#/anmeldungen", 2500);
  ok(await eval_(`location.hash`) === "#/sicherheit", "Alte Adresse #/anmeldungen → Sicherheit");
  await gehe(G + "/#/profil/paul", 3000);
  ok(await eval_(`!document.querySelector("#konto-leiste") && document.querySelector("#seite h1").textContent.startsWith("Profil von")`), "Fremdes Profil ohne Konto-Leiste");

  // 3) Glocke: archivieren, Archiv, löschen
  await eval_(`fetch("/api/admin/spiel-der-woche/paul/raetsel",{method:"PUT",headers:{"X-Bibliothek":"1"}}).then(r=>r.status)`);
  await gehe(G + "/", 3500);
  await eval_(`document.getElementById("glocke-knopf").click(); true`);
  await bis(`document.querySelectorAll("#glocke-liste .b-zeile-mit-aktionen").length>0`);
  const vorher = await eval_(`document.querySelectorAll("#glocke-liste .b-zeile-mit-aktionen").length`);
  await eval_(`[...document.querySelectorAll("#glocke-liste .b-zeile__aktionen button")].find(b=>b.getAttribute("aria-label")==="Archivieren").click(); true`);
  ok(await bis(`document.querySelectorAll("#glocke-liste .b-zeile-mit-aktionen").length===${vorher}-1`), "Meldung archiviert, Liste bleibt offen");
  await eval_(`[...document.querySelectorAll("#glocke-liste button")].find(b=>b.textContent==="Archiv ansehen").click(); true`);
  ok(await bis(`document.querySelectorAll("#glocke-liste .b-zeile-mit-aktionen").length===1`), "Archiv zeigt die Meldung");
  await eval_(`[...document.querySelectorAll("#glocke-liste .b-zeile__aktionen button")].find(b=>b.getAttribute("aria-label")==="Löschen").click(); true`);
  ok(await bis(`document.getElementById("glocke-liste").textContent.includes("Archiv ist leer")`), "Gelöscht – Archiv leer");

  // 4) Größen mit passender Einheit
  await gehe(G + "/admin/", 3000);
  await bis(`!!document.querySelector(".b-kennzahl")`);
  const frei = await eval_(`[...document.querySelectorAll(".b-kennzahl")].find(k=>k.textContent.includes("frei auf der NAS")).querySelector(".b-kennzahl__wert").textContent`);
  ok(/ (GB|TB|PB)$/.test(frei), "Freier NAS-Speicher in GB/TB: " + frei);
  const kont = await eval_(`document.body.textContent.includes("1 GB")`);
  ok(kont, "Kontingent als „1 GB“");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
