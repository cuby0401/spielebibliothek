// Ende-zu-Ende-Test für Zentrale 1.2.0 (Suche, Kategorien, Daumen, Spiel der Woche, Glocke, Erfolge, Spielzeit, Profil, Speicher). Braucht im Teststand ein Spiel paul/raetsel mit tags, leaderboard und erfolgen [start, profi(geheim)], das beim Laden GameSave.erfolg("start") aufruft.
// Ende-zu-Ende-Test der Versionierung im Teststand (Chrome headless über DevTools-Protokoll)
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

  // 1) Übersicht: Suche, Kategorien, Daumen auf der Kachel
  await gehe(G + "/", 3500);
  const kachel = (t) => `[...document.querySelectorAll(".b-kachel")].find(k=>k.querySelector(".b-kachel__titel").textContent===${JSON.stringify(t)})`;
  // Weitere Beispielspiele (z. B. Solitär, 14.11.) bringen eigene Kategorien mit – geprüft wird nur, dass die von Rätselspaß da sind
  const filter = await eval_(`[...document.querySelectorAll("#tag-filter .b-marke")].map(b=>b.textContent)`);
  ok(filter.includes("Puzzle") && filter.includes("Wörter"), "Kategorien-Filter aus den tags");
  await eval_(`{ const s=document.getElementById("suche"); s.value="zähl"; s.dispatchEvent(new Event("input")); } true`);
  ok(await bis(`[...document.querySelectorAll("#kacheln .b-kachel__titel")].map(h=>h.textContent).join(",")==="Zähler"`), "Suche „zähl“ → nur Zähler");
  await eval_(`{ const s=document.getElementById("suche"); s.value=""; s.dispatchEvent(new Event("input")); [...document.querySelectorAll("#tag-filter .b-marke")].find(b=>b.textContent==="Puzzle").click(); } true`);
  ok(await bis(`[...document.querySelectorAll("#kacheln .b-kachel__titel")].map(h=>h.textContent).join(",")==="Rätselspaß"`), "Kategorie „Puzzle“ → nur Rätselspaß");
  await eval_(`[...document.querySelectorAll("#tag-filter .b-marke")][0].click(); true`);
  await bis(`!!document.getElementById("reihe-alle")`);
  // Sebs Test 13.11.2026: „Alle Spiele“ ist nicht mehr einstellbar und steht immer ganz unten – auch bei alten Einstellungen (oben, ausgeblendet)
  await eval_(`fetch("/api/einstellungen",{method:"PUT",headers:{"Content-Type":"application/json","X-Bibliothek":"1"},body:JSON.stringify({startseite:{abschnitte:[{id:"alle",sichtbar:false},{id:"weiterspielen",sichtbar:true}]}})}).then(r=>r.status)`);
  await gehe(G + "/", 3500);
  ok(await bis(`document.getElementById("reihe-alle") && document.getElementById("reihe-alle")===[...document.querySelectorAll("#startseite > *")].pop()`), "„Alle Spiele“ trotz alter Einstellung (oben, aus) sichtbar und ganz unten");
  await gehe(G + "/#/einstellungen", 3500);
  ok(await bis(`document.querySelectorAll(".b-sortierliste__eintrag").length===4 && ![...document.querySelectorAll(".b-sortierliste__text")].some(l=>l.textContent==="Alle Spiele")`), "Einstellungen → Startseite ohne „Alle Spiele“");
  await eval_(`fetch("/api/einstellungen",{method:"PUT",headers:{"Content-Type":"application/json","X-Bibliothek":"1"},body:JSON.stringify({startseite:{abschnitte:[]}})}).then(r=>r.status)`);
  await gehe(G + "/", 3500);
  await bis(`!!document.getElementById("reihe-alle")`);
  ok(await eval_(`${kachel("Zähler")}.querySelector("[data-daumen]").disabled`), "Eigenes Spiel: Daumen nur Anzeige");
  await eval_(`${kachel("Rätselspaß")}.querySelector("[data-daumen]").click(); true`);
  ok(await bis(`${kachel("Rätselspaß")}.querySelector("[data-daumen]").textContent==="1" && ${kachel("Rätselspaß")}.querySelector("[data-daumen]").getAttribute("aria-pressed")==="true"`), "Daumen auf der Kachel gegeben → 1");

  // 2) Spiel der Woche + Glocke
  await eval_(`fetch("/api/admin/spiel-der-woche/paul/raetsel",{method:"PUT",headers:{"X-Bibliothek":"1"}}).then(r=>r.status)`);
  await gehe(G + "/", 3500);
  ok(await eval_(`!document.getElementById("sdw").hidden && document.getElementById("sdw").textContent.includes("Rätselspaß")`), "Banner „Spiel der Woche“");
  ok(await eval_(`${kachel("Rätselspaß")}.textContent.includes("Spiel der Woche")`), "Kachel-Marke „Spiel der Woche“");
  ok(await eval_(`!document.getElementById("glocke-zahl").hidden && +document.getElementById("glocke-zahl").textContent>=1`), "Glocke zeigt ungelesene Meldung");
  await eval_(`document.getElementById("glocke-knopf").click(); true`);
  ok(await bis(`document.getElementById("glocke-liste").textContent.includes("Spiel der Woche")`), "Glocke-Liste enthält die Meldung");
  ok(await bis(`document.getElementById("glocke-zahl").hidden`), "Nach dem Öffnen gelesen");

  // 3) Spiel: Wochen-Bestenliste, Erfolg-Einblendung, Erfolge-Liste, Spielzeit
  await gehe(G + "/#/spiel/paul/raetsel", 6500);
  await warte(6000);   // echte Spielzeit (wird gezählt) – nicht durch das schnellere gehe() abkürzen
  ok((await eval_(`document.getElementById("bl-titel").textContent`)).startsWith("Diese Woche"), "Bestenliste zeigt zuerst „Diese Woche“");
  ok(await eval_(`[...document.getElementById("bl-season").options].some(o=>o.value==="woche")`), "Auswahl enthält „Diese Woche“");
  ok(await bis(`UI.meldungsVerlauf().some(t=>t.includes("Losgelegt"))`), "Einblendung „Erfolg freigeschaltet: Losgelegt“");
  ok(await bis(`document.getElementById("erfolge").textContent.includes("Erfolge 1/2") && document.getElementById("erfolge").textContent.includes("???")`), "Erfolge 1/2, geheimer als ???");
  ok(await eval_(`document.getElementById("daumen").textContent==="1" && !document.getElementById("daumen").disabled`), "Daumen im Spiel zeigt 1");
  await gehe(G + "/#/", 2500);
  await warte(1500);
  const sz = await eval_(`fetch("/api/games").then(r=>r.json()).then(l=>l.find(s=>s.id==="paul/raetsel").meineSpielzeit)`);
  ok(sz >= 5, "Spielzeit gezählt: " + sz + " s");

  // 4) Profil
  await gehe(G + "/#/profil", 3000);
  ok(await eval_(`document.querySelector("#seite h1").textContent==="Mein Profil" && document.body.textContent.includes("Losgelegt")`), "Mein Profil mit Erfolg");
  await gehe(G + "/#/spielstaende", 2500);
  // (Spalte „Deine Spielzeit“ erscheint nur, wenn es Spielstände gibt)

  // 4b) Wichtige Meldung (Anfrage an die Bibliothek → Admin): rote, wackelnde Glocke + Einblendung.
  //     Seit 1.3.0 ohne Spiel – Anfragen zu einem Spiel gehen an dessen Entwickler (E64), geprüft in e2e-zentrale-1.3-steckbrief.mjs
  await eval_(`fetch("/api/antraege",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({art:"fehler",text:"Bibliothek stürzt beim Start ab"})}).then(r=>r.status)`);
  await gehe(G + "/", 3500);
  ok(await eval_(`document.getElementById("glocke-knopf").hasAttribute("data-alarm")`), "Glocke rot/wackelnd bei wichtiger Meldung");
  ok(await eval_(`!!document.getElementById("alarm")?.open && document.getElementById("alarm").textContent.includes("Neue Anfrage")`), "Einblendung „Wichtige Meldung“");
  await eval_(`document.querySelector("#alarm button").click(); document.getElementById("glocke-knopf").click(); true`);
  ok(await bis(`!document.getElementById("glocke-knopf").hasAttribute("data-alarm")`), "Nach dem Öffnen nicht mehr rot");
  await gehe(G + "/", 3000);
  ok(await eval_(`!document.getElementById("alarm")`), "Einblendung kommt nicht erneut");

  // 5) Admin + Upload
  await gehe(G + "/admin/", 3000);
  ok(await eval_(`document.body.textContent.includes("frei auf der NAS")`), "Admin: freier Speicher");
  await gehe(G + "/admin/#spiele", 3000);
  ok(await eval_(`document.body.textContent.includes("Spiel der Woche: „Rätselspaß“")`), "Admin: laufendes Spiel der Woche");
  await gehe(U + "/");
  await eval_(`document.getElementById("passwort").value=${JSON.stringify(PW)}; document.getElementById("anmeldeform").requestSubmit(); true`);
  ok(await bis(`!document.getElementById("speicher").hidden && document.getElementById("speicher").textContent.includes("1 GB")`) || await bis(`document.getElementById("speicher").textContent.includes("von")`), "Upload: Speicheranzeige");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
