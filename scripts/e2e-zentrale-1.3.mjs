// Ende-zu-Ende-Test für Zentrale 1.2.1 (Profil mit Spielständen/Anmeldungen, Menü, Glocke archivieren/löschen, SVG statt Emojis, Größen). Wie e2e-zentrale-1.2.mjs.
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

  // 1) Menü und Symbole
  await gehe(G + "/", 3500);
  const menue = await eval_(`[...document.querySelectorAll("#menue a")].map(a=>a.textContent).join("|")`);
  ok(!menue.includes("Spielstände") && !menue.includes("Anmeldungen") && menue.includes("Mein Profil"), "Kontextmenü: nur noch „Mein Profil“: " + menue);
  ok(await eval_(`!!document.querySelector("#glocke-knopf svg.ikon") && !/🔔/.test(document.getElementById("glocke-knopf").textContent)`), "Glocke als SVG, ohne Emoji");
  ok(await eval_(`!!document.querySelector(".kachel .daumen svg.ikon") && ![...document.querySelectorAll(".daumen")].some(d=>/👍/.test(d.textContent))`), "Daumen als SVG, ohne Emoji");

  // 2) Profil: Spiele, Spielstände, Anmeldungen; Spike zählt nicht
  await eval_(`fetch("/api/save/seb/zaehler/stand",{method:"PUT",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({data:1})}).then(r=>r.status)`);
  await eval_(`fetch("/api/spielzeit/seb/spike",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({sekunden:60})}).then(r=>r.status)`);
  await eval_(`fetch("/api/admin/spiele/seb/spike",{method:"PATCH",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({testspiel:true})}).then(r=>r.status)`);
  await gehe(G + "/#/profil", 3500);
  const h2 = await eval_(`[...document.querySelectorAll("#seite h2")].map(h=>h.textContent).join("|")`);
  ok(h2 === "Spiele|Spielstände|Anmeldungen", "Profil: Spiele, Spielstände, Anmeldungen");
  ok(await eval_(`document.querySelector("#spielstaende").textContent.includes("Zähler")`), "Profil: Spielstand von Zähler");
  ok(await eval_(`!document.querySelector("#seite table").textContent.includes("Sandbox-Spike")`), "Profil: Testspiel Spike zählt nicht");
  ok(await eval_(`document.querySelector("#anmeldungen").textContent.includes("dieses Gerät")`), "Profil: Anmeldung dieses Geräts");
  await gehe(G + "/#/spielstaende", 2500);
  ok(await eval_(`location.hash`) === "#/profil", "Alte Adresse #/spielstaende → Profil");

  // 3) Glocke: archivieren, Archiv, löschen
  await eval_(`fetch("/api/admin/spiel-der-woche/paul/raetsel",{method:"PUT",headers:{"X-Bibliothek":"1"}}).then(r=>r.status)`);
  await gehe(G + "/", 3500);
  await eval_(`document.getElementById("glocke-knopf").click(); true`);
  await bis(`document.querySelectorAll("#glocke-liste .meldung-zeile").length>0`);
  const vorher = await eval_(`document.querySelectorAll("#glocke-liste .meldung-zeile").length`);
  await eval_(`[...document.querySelectorAll("#glocke-liste .aktionen button")].find(b=>b.textContent==="Archiv").click(); true`);
  ok(await bis(`document.querySelectorAll("#glocke-liste .meldung-zeile").length===${vorher}-1`), "Meldung archiviert, Liste bleibt offen");
  await eval_(`[...document.querySelectorAll(".glocke-fuss button")].find(b=>b.textContent==="Archiv ansehen").click(); true`);
  ok(await bis(`document.querySelectorAll("#glocke-liste .meldung-zeile").length===1`), "Archiv zeigt die Meldung");
  await eval_(`[...document.querySelectorAll("#glocke-liste .aktionen button")].find(b=>b.textContent==="Löschen").click(); true`);
  ok(await bis(`document.getElementById("glocke-liste").textContent.includes("Archiv ist leer")`), "Gelöscht – Archiv leer");

  // 4) Größen mit passender Einheit
  await gehe(G + "/admin/", 3000);
  const frei = await eval_(`[...document.querySelectorAll(".kennzahl")].find(k=>k.textContent.includes("frei auf der NAS")).querySelector(".wert").textContent`);
  ok(/ (GB|TB|PB)$/.test(frei), "Freier NAS-Speicher in GB/TB: " + frei);
  const kont = await eval_(`document.body.textContent.includes("1 GB")`);
  ok(kont, "Kontingent als „1 GB“");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
