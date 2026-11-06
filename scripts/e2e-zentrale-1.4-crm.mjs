// Ende-zu-Ende-Test für Zentrale 1.4.0: CRM – Personen-Liste, einladen, Notiz, verwarnen, sperren, entsperren,
// Prüfprotokoll, „Meine Angaben“ im Profil. Aufbau wie e2e-zentrale-1.3.1-antraege.mjs.
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-zentrale-1.4-crm.mjs <ordner> <upload-passwort>
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
let S;
async function eval_(ausdruck) {
  const r = await cdp("Runtime.evaluate", { expression: ausdruck, awaitPromise: true, returnByValue: true }, S);
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function gehe(url, ms = 2500) { await cdp("Page.navigate", { url }, S); await warte(ms); }
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
    if (d.method === "Page.javascriptDialogOpening") cdp("Page.handleJavaScriptDialog", { accept: true }, d.sessionId);
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Page.enable", {}, S); await cdp("Runtime.enable", {}, S); await cdp("DOM.enable", {}, S);

  const ZEILE = (name) => `[...document.querySelectorAll("tbody tr")].find(t=>t.querySelector("td strong")?.textContent===${JSON.stringify(name)})`;
  const KNOPF = (text) => `[...document.querySelectorAll("#inhalt button")].find(b=>b.textContent===${JSON.stringify(text)})`;

  // 1) Personen-Liste: übernommen aus users.yaml, alte Adresse #benutzer leitet um
  await gehe(G + "/admin/#benutzer", 4000);
  ok(await bis(`location.hash==="#personen"`), "#benutzer leitet auf #personen um");
  ok(await bis(`!!(${ZEILE("seb")}) && !!(${ZEILE("paul")})`), "seb und paul aus users.yaml übernommen");
  ok(await eval_(`(${ZEILE("seb")}).textContent.includes("Admin") && (${ZEILE("paul")}).textContent.includes("Entwickler")`), "Rollen übernommen (seb Admin, paul Entwickler)");

  // 2) Einladen
  await eval_(`{ const f=document.querySelector("details.karte form"); const i=f.querySelectorAll("input");
    i[0].value="lea@example.com"; i[1].value="lea"; i[2].value="Lea"; f.requestSubmit(); } true`);
  ok(await bis(`location.hash==="#person/lea" && document.querySelector("#inhalt h2")?.textContent.includes("eingeladen")`), "lea eingeladen → eigene Seite, Status eingeladen");
  ok(await eval_(`document.body.textContent.includes("lea@example.com")`), "Login-E-Mail steht auf der Seite");

  // 3) Notiz, verwarnen
  await eval_(`document.querySelector("#inhalt textarea").value="E2E: interne Notiz"; (${KNOPF("Notiz speichern")}).click(); true`);
  ok(await bis(`document.body.textContent.includes("E2E: interne Notiz")`), "Notiz gespeichert und angezeigt");
  await eval_(`document.querySelector('#inhalt input[placeholder^="Grund"]').value="E2E-Verwarnung"; (${KNOPF("Verwarnen")}).click(); true`);
  ok(await bis(`document.querySelector("#inhalt h2")?.textContent.includes("verwarnt")`), "Verwarnt");

  // 4) Sperren und entsperren
  await bis(`!!(${KNOPF("Sperren")})`);
  await eval_(`document.querySelector('#inhalt input[placeholder^="Grund"]').value="E2E-Sperre"; (${KNOPF("Sperren")}).click(); true`);
  ok(await bis(`document.querySelector("#inhalt h2")?.textContent.includes("gesperrt") && document.body.textContent.includes("Gesperrt: E2E-Sperre")`), "Gesperrt, Grund angezeigt");
  await eval_(`(${KNOPF("Entsperren")}).click(); true`);
  ok(await bis(`document.querySelector("#inhalt h2")?.textContent.includes("aktiv")`), "Entsperrt → aktiv");
  ok(await eval_(`[...document.querySelectorAll("#inhalt td")].some(t=>t.textContent==="sperre")`), "Zeitleiste zeigt die Sperre");

  // 5) Stammdaten und Rolle Tester
  await eval_(`{ const i=document.querySelectorAll("#inhalt form.karte input"); i[0].value="Lea E2E"; i[0].closest("form").requestSubmit(); } true`);
  ok(await bis(`document.getElementById("meldung").textContent==="Gespeichert."`), "Stammdaten gespeichert");
  await eval_(`{ const l=[...document.querySelectorAll("#inhalt label.haken")].find(x=>x.textContent.includes("Tester")); l.querySelector("input").click(); (${KNOPF("Rollen speichern")}).click(); } true`);
  ok(await bis(`document.getElementById("meldung").textContent.includes("+Tester")`), "Rolle Tester vergeben");

  // 6) Prüfprotokoll
  await gehe(G + "/admin/#protokoll", 3000);
  const aktionen = await eval_(`[...document.querySelectorAll("tbody tr td:nth-child(3)")].map(t=>t.textContent)`);
  ok(["einladen", "notiz", "verwarnen", "sperren", "entsperren", "stammdaten", "rollen"].every((a) => aktionen.includes(a)), "Protokoll: " + aktionen.slice(0, 8).join(", "));

  // 7) Meine Angaben im eigenen Profil
  await gehe(G + "/#/profil", 3500);
  ok(await bis(`!!document.querySelector("#angaben form")`), "Profil: Abschnitt „Meine Angaben“");
  await eval_(`{ const f=document.querySelector("#angaben form"); f.querySelector("input").value="Seb E2E"; f.querySelector('input[type="checkbox"]').checked=true; f.requestSubmit(); } true`);
  await warte(1000);
  await gehe(G + "/?neu=1#/profil", 3500);      // andere Adresse → Seite wird wirklich neu geladen
  ok(await bis(`document.querySelector("#angaben form input")?.value==="Seb E2E"`), "Anzeigename gespeichert");
  ok(await eval_(`document.querySelector('#angaben input[type="checkbox"]').disabled`), "Datenschutzhinweis bestätigt");
  ok(await eval_(`fetch("/api/mein/konto").then(r=>r.text()).then(t=>!t.includes("Notiz") && !t.includes("protokoll"))`), "Mein Konto ohne Admin-Felder");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
