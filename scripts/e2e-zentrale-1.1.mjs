// Ende-zu-Ende-Test für Zentrale 1.1.0 (Offline, Update hochladen, Fußzeile, Hilfe-Center, Admin-Zählung). Aufruf wie e2e-versionierung.mjs.
// Ende-zu-Ende-Test der Versionierung im Teststand (Chrome headless über DevTools-Protokoll)
import { spawn } from "node:child_process";
import { setTimeout as warte } from "node:timers/promises";
const G = "http://<NAS_GH>:18088", U = "http://<NAS_UH>:18090";
const DIR = process.argv[2], PW = process.argv[3];
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${DIR}/chrome-profil`, "--no-first-run", "about:blank"], { stdio: "ignore" });
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
async function gehe(url, ms = 2500) { await cdp("Page.navigate", { url }, S); await warte(ms); }
async function bis(ausdruck, ms = 10000) { const ende = Date.now() + ms; while (Date.now() < ende) { if (await eval_(ausdruck).catch(() => false)) return true; await warte(250); } return false; }
async function hochladen(datei, neu) {
  const doc = await cdp("DOM.getDocument", {}, S);
  const n = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#datei" }, S);
  await cdp("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [`${DIR}/${datei}`] }, S);
  await eval_(`document.getElementById("ordner").value="e2e"; document.getElementById("neu").value=${JSON.stringify(neu)};
    document.getElementById("uploadform").requestSubmit(); true`);
  return bis(`document.getElementById("meldung").textContent.includes("als Entwurf hochgeladen")`);
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

  await gehe(U + "/");
  await eval_(`document.getElementById("passwort").value=${JSON.stringify(PW)}; document.getElementById("anmeldeform").requestSubmit(); true`);
  ok(await bis(`!document.getElementById("bereich").hidden`), "Upload: angemeldet");
  ok(await hochladen("e2e-v1.zip", "Erste Version"), "Spiel e2e hochgeladen (neuer Ordner, Rückfrage bestätigt)");
  await updateFensterOeffnen();
  await eval_(`document.getElementById("uf-gelesen").checked=true; document.getElementById("uf-los").click(); true`);
  ok(await bis(`document.getElementById("meldung").textContent.includes("1.0.0")`), "e2e als 1.0.0 veröffentlicht");
  // Update hochladen
  await bis(`[...document.querySelectorAll("button")].some(b=>b.textContent==="Update hochladen")`);
  await eval_(`[...document.querySelectorAll(".eintrag")].find(e=>e.textContent.includes("Ordner e2e")).querySelector("button.knopf.klein:not(.leise):not(.gefahr)") && [...[...document.querySelectorAll(".eintrag")].find(e=>e.textContent.includes("Ordner e2e")).querySelectorAll("button")].find(b=>b.textContent==="Update hochladen").click(); true`);
  ok(await eval_(`document.getElementById("ordner").readOnly && document.getElementById("ordner").value==="e2e" && !document.getElementById("update-fuer").hidden`), "„Update hochladen“ legt Ordner e2e fest");
  ok((await eval_(`document.getElementById("update-fuer").textContent`)).includes("Version 1.0.0"), "Hinweis nennt die aktuelle Version");
  const n0 = dialoge.length;
  ok(await hochladen("e2e-v2.zip", "Update"), "Update in festgelegten Ordner ohne Rückfrage");
  ok(dialoge.length === n0, "keine Rückfrage beim Update");
  // neuer Ordner → Rückfrage
  const doc = await cdp("DOM.getDocument", {}, S);
  const nd = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#datei" }, S);
  await cdp("DOM.setFileInputFiles", { nodeId: nd.nodeId, files: [`${DIR}/e2e-v1.zip`] }, S);
  await eval_(`document.getElementById("ordner").value="anderes"; document.getElementById("uploadform").requestSubmit(); true`);
  await bis(`document.getElementById("meldung").textContent.includes("anderes")`);
  ok(dialoge.slice(n0).some((t) => t.includes("NEUES Spiel")), "Rückfrage bei neuem Ordnernamen");

  // Bibliothek: Menü, Fußzeile, offline nehmen
  await gehe(G + "/", 3000);
  ok(await eval_(`![...document.querySelectorAll("#menue a")].some(a=>a.textContent.includes("Handbuch"))`), "Kontextmenü ohne Handbuch");
  ok(await eval_(`[...document.querySelectorAll(".fuss a")].map(a=>a.textContent).join("|")`) === "Hilfe|Entwickler-Handbuch|Fehler melden / Idee", "Fußzeile: Hilfe · Handbuch · Fehler melden");
  await gehe(G + "/#/meine-spiele", 3000);
  await bis(`[...document.querySelectorAll("button")].some(b=>b.textContent==="Offline nehmen")`);
  await eval_(`[...document.querySelectorAll("tr")].find(t=>t.textContent.includes("Ordner e2e")).querySelector("button").click(); true`);
  ok(await bis(`[...document.querySelectorAll("button")].some(b=>b.textContent==="Wieder online stellen")`), "Meine Spiele: offline genommen");
  ok(await eval_(`document.body.textContent.includes("Test-Grund")`), "Grund wird angezeigt");
  const sim = await eval_(`fetch("/api/games",{headers:{"X-Ansicht":"spieler"}}).then(r=>r.json()).then(l=>l.some(s=>s.id==="seb/e2e"))`);
  ok(sim === false, "Als Spieler unsichtbar");
  await gehe(G + "/", 3000);
  ok(await eval_(`[...document.querySelectorAll(".kachel")].find(k=>k.querySelector("h2").textContent==="E2E").textContent.includes("offline")`), "Kachel zeigt „offline“ für den Entwickler");
  await gehe(G + "/#/spiel/seb/e2e", 3000);
  ok(await eval_(`!document.getElementById("entwurf-hinweis").hidden && document.getElementById("entwurf-hinweis").textContent.startsWith("Offline")`), "Spielansicht: Hinweis „Offline“");

  // Admin: Zählung
  await eval_(`fetch("/api/admin/spiele/seb/spike",{method:"PATCH",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({testspiel:true})}).then(r=>r.status)`);
  await gehe(G + "/admin/", 3000);
  const kz = await eval_(`[...document.querySelectorAll(".kennzahl .text")].map(t=>t.textContent).join("|")`);
  ok(/Spiele \(\+1 Testspiele\) · 1 offline/.test(kz), "Admin zählt Testspiele getrennt: " + kz.split("|")[1]);
  ok(await eval_(`document.body.textContent.includes("Zentrale")`), "Admin: Abschnitt „Zentrale“");

  // Hilfe-Center
  await gehe(G + "/hilfe/");
  ok(await eval_(`document.querySelector(".hilfe-reiter a.aktiv").textContent`) === "Spielen", "Hilfe: Reiter „Spielen“ aktiv");
  await gehe(G + "/handbuch/");
  ok(await eval_(`document.querySelector(".hilfe-reiter a.aktiv").textContent`) === "Spiele entwickeln", "Handbuch: Reiter „Spiele entwickeln“ aktiv");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
