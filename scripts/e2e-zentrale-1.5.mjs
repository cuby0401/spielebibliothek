// Ende-zu-Ende-Test für Zentrale 1.5.0: Identität (UUID innen, Handle außen), Handle ändern, CRM mit Suche und Personenkarte,
// Sicherheitsprotokoll. Aufbau wie e2e-zentrale-1.4-crm.mjs (Teststand mit DEV_USER=seb).
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-zentrale-1.5.mjs <ordner> <upload-passwort>
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
let S, eingabe = "";   // Antwort auf prompt()-Dialoge
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
    if (d.method === "Page.javascriptDialogOpening") cdp("Page.handleJavaScriptDialog", { accept: true, promptText: eingabe }, d.sessionId);
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Page.enable", {}, S); await cdp("Runtime.enable", {}, S); await cdp("DOM.enable", {}, S);

  const UUID = "/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/";
  const OHNE_UUID = `!${UUID}.test(document.body.innerText)`;
  const OHNE_NULL = `(()=>{const w=document.createTreeWalker(document.getElementById("inhalt"),NodeFilter.SHOW_TEXT);
    while(w.nextNode()) if(w.currentNode.nodeValue.trim()==="null") return false; return true})()`;
  const ZEILEN = `[...document.querySelectorAll("tbody tr[data-handle]")]`;
  const tippen = (sel, text) => eval_(`{ const i=document.querySelector(${JSON.stringify(sel)}); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); } true`);

  // 1) CRM-Liste: Reiter heißt CRM, Nummern, Handles, keine UUID
  await gehe(G + "/admin/#crm", 4000);
  ok(await bis(`location.hash==="#personen" && document.querySelector("#inhalt h2")?.textContent.startsWith("CRM")`), "#crm öffnet das CRM (Reiter „CRM“)");
  ok(await eval_(`[...document.querySelectorAll("#reiter a")].some(a=>a.textContent.trim()==="CRM")`), "Reiter heißt „CRM“");
  ok(await eval_(`${ZEILEN}.length>=2 && ${ZEILEN}.every(t=>/^P-\\d{4}$/.test(t.querySelector("td.nr").textContent))`), "Jede Person hat eine Nummer P-0000");
  ok(await eval_(OHNE_UUID) && await eval_(OHNE_NULL), "CRM-Liste ohne UUID und ohne „null“");
  // 2) Suche: Name, Nummer, Enter öffnet die Karte
  await tippen("input.crm-suche", "paul");
  ok(await bis(`${ZEILEN}.length===1 && ${ZEILEN}[0].dataset.handle==="paul"`), "Suche „paul“ → genau paul");
  const nrPaul = await eval_(`${ZEILEN}[0].querySelector("td.nr").textContent`);
  await tippen("input.crm-suche", nrPaul);
  ok(await bis(`${ZEILEN}.length===1 && ${ZEILEN}[0].dataset.handle==="paul"`), `Suche nach Nummer ${nrPaul} → paul`);
  await eval_(`document.querySelector("input.crm-suche").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"})); true`);
  ok(await bis(`location.hash==="#person/paul" && !!document.querySelector(".crm-kopf h2")`), "Enter öffnet die Personenkarte");
  ok(await eval_(`document.querySelector(".crm-kopf").textContent.includes(${JSON.stringify(nrPaul)})`), "Karte zeigt die Nummer");
  ok(await eval_(`[...document.querySelectorAll(".crm-block h3")].some(x=>x.textContent==="Stammdaten")`), "Block „Stammdaten“");
  ok(await eval_(`![...document.querySelectorAll(".crm-block h3")].some(x=>x.textContent.startsWith("Sicherheitsprotokoll"))`), "Leerer Block „Sicherheitsprotokoll“ fehlt");
  ok(await eval_(OHNE_UUID) && await eval_(OHNE_NULL), "Personenkarte ohne UUID und ohne „null“");
  await gehe(G + "/admin/#person/" + nrPaul, 3500);
  ok(await bis(`document.querySelector(".crm-kopf")?.textContent.includes("@paul") || document.querySelector(".crm-kopf h2")?.textContent.includes("paul")`), "Adresse #person/P-… öffnet die Karte");
  await gehe(G + "/admin/#personen", 3500);
  ok(await bis(`document.querySelector("input.crm-suche")?.value===${JSON.stringify(nrPaul)}`), "Suche bleibt beim Zurückgehen erhalten");

  // 3) Handle ändern im eigenen Konto (seb), mit Frist und alter Adresse
  await gehe(G + "/#/profil", 3500);
  ok(await bis(`[...document.querySelectorAll("#angaben h3")].some(x=>x.textContent==="Handle")`), "Konto: Abschnitt „Handle“");
  await eval_(`{ const f=[...document.querySelectorAll("#angaben form")].find(f=>f.querySelector("h3")?.textContent==="Handle"); f.querySelector("input").value="seb_e2e"; f.requestSubmit(); } true`);
  ok(await bis(`fetch("/api/me").then(r=>r.json()).then(m=>m.player==="seb_e2e" && m.konto==="seb")`, 8000), "Handle geändert: @seb_e2e, Konto bleibt seb");
  await gehe(G + "/?neu=1#/profil", 4000);
  ok(await bis(`document.getElementById("benutzer").title==="@seb_e2e"`), "Oben rechts: @seb_e2e");
  ok(await bis(`[...document.querySelectorAll("#angaben form")].find(f=>f.querySelector("h3")?.textContent==="Handle")?.querySelector("input").disabled===true`), "Danach gesperrt (30 Tage)");
  ok(await eval_(`document.body.textContent.includes("Wieder änderbar ab")`), "Hinweis „Wieder änderbar ab …“");
  await gehe(G + "/#/profil/seb", 3500);
  ok(await bis(`document.querySelector(".profil-kopf")?.textContent.includes("@seb_e2e")`), "Alte Profil-Adresse #/profil/seb zeigt @seb_e2e");
  ok(await eval_(OHNE_UUID), "Bibliothek ohne UUID");
  // Admin setzt zurück (ohne Frist); das alte Handle bleibt reserviert
  ok(await eval_(`fetch("/api/admin/personen/seb_e2e/handle",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({handle:"seb"})}).then(r=>r.json()).then(p=>p.handle==="seb")`), "Admin setzt @seb zurück (ohne Frist)");
  await gehe(G + "/admin/#person/seb", 3500);
  ok(await bis(`document.querySelector(".crm-kopf")?.textContent.includes("früher @seb_e2e")`), "Karte: „früher @seb_e2e“");
  ok(await eval_(`fetch("/api/mein/handle",{method:"PUT",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({handle:"paul"})}).then(r=>r.status)`) === 409, "Fremdes Handle @paul: abgelehnt");

  // 4) Sicherheitsprotokoll: abgelehnter Zugriff (in „Ansicht als Spieler“ ist das Admin-Panel gesperrt)
  await eval_(`fetch("/api/admin/personen",{headers:{"X-Ansicht":"spieler"}}).then(r=>r.status)`);
  await gehe(G + "/admin/?neu=2#person/seb", 3500);
  ok(await bis(`[...document.querySelectorAll(".crm-block h3")].some(x=>x.textContent.startsWith("Sicherheitsprotokoll"))`), "Karte: Block „Sicherheitsprotokoll“");
  ok(await eval_(`document.body.textContent.includes("GET /api/admin/personen → 403")`), "Abgelehnter Zugriff steht darin");
  ok(await eval_(OHNE_UUID) && await eval_(OHNE_NULL), "Karte von seb ohne UUID und ohne „null“");

  // 5) Kacheln filtern, Admin-Anmeldungen zeigen Handles (in 1.4.1 war die Spalte leer)
  await gehe(G + "/admin/#personen", 3500);
  await tippen("input.crm-suche", "");
  await eval_(`[...document.querySelectorAll("button.kennzahl")].find(b=>b.textContent.includes("verwarnt oder gesperrt")).click(); true`);
  ok(await bis(`${ZEILEN}.length===0 || ${ZEILEN}.every(t=>/verwarnt|gesperrt/.test(t.textContent))`), "Kachel „verwarnt oder gesperrt“ filtert");
  ok(await eval_(`(()=>{const h=[...document.querySelectorAll("h2")].find(x=>x.textContent==="Letzte Anmeldungen"); const t=h?.nextElementSibling?.nextElementSibling; return !t || [...t.querySelectorAll("tbody tr td:first-child")].every(td=>td.textContent.trim().length>0)})()`), "Letzte Anmeldungen: Spalte Spieler gefüllt");
  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
