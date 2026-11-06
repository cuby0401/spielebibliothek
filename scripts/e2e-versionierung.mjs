// Ende-zu-Ende-Test der Versionierung im Teststand (Chrome headless über DevTools-Protokoll), Node ≥ 22.
// Vorher: Teststand starten (scripts/teststand.sh up), Upload-Konto: docker exec sbtest-upload python -m savesvc entwickler anlegen seb
// Testspiele e2e-v1.zip / e2e-v2.zip (saveVersion 1/2, laden mit migration { 2: … }) in <ordner> legen.
// Aufruf: node scripts/e2e-versionierung.mjs <ordner> <upload-passwort>
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
  await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, S);

  // 1) Upload-Seite: anmelden, v1 hochladen
  await gehe(U + "/");
  await eval_(`document.getElementById("passwort").value=${JSON.stringify(PW)}; document.getElementById("anmeldeform").requestSubmit(); true`);
  ok(await bis(`!document.getElementById("bereich").hidden`), "Upload-Seite: angemeldet");
  ok(await eval_(`!document.querySelector('input[name="art"]')`), "Upload-Seite: keine Auswahl „Sofort veröffentlichen“ mehr");
  ok(await hochladen("e2e-v1.zip", "Erste Version"), "v1 als Entwurf hochgeladen");
  // Prüfung vor dem Testen: Warnung „noch nicht getestet“
  ok(await updateFensterOeffnen(), "Update-Fenster öffnet");
  const p0 = await eval_(`[...document.querySelectorAll("#uf-punkte li")].map(l=>l.className+":"+l.textContent).join("\\n")`);
  ok(p0.includes("warnung:Entwurf wurde noch nicht getestet"), "Prüfung warnt: Entwurf nicht getestet");
  ok(await eval_(`document.getElementById("uf-version").textContent.includes("1.0.0")`), "Fenster zeigt: erste Veröffentlichung = 1.0.0");
  await eval_(`document.getElementById("update-fenster").close(); true`);

  // 2) Entwurf in der Bibliothek testen
  await gehe(G + "/#/entwurf/seb/e2e", 5000);
  ok(await eval_(`!document.getElementById("entwurf-hinweis").hidden`), "Bibliothek: Entwurf läuft");

  // 3) Veröffentlichen über das Fenster
  await gehe(U + "/");
  await updateFensterOeffnen();
  const p1 = await eval_(`[...document.querySelectorAll("#uf-punkte li")].map(l=>l.className+":"+l.textContent).join("\\n")`);
  ok(p1.includes("ok:Entwurf wurde in der Bibliothek getestet"), "Prüfung: Test erkannt (Upload-Dienst → Speicher-Dienst /intern)");
  ok(await eval_(`document.getElementById("uf-aenderungen").value`) === "Erste Version", "Gesammelte Änderung im Fenster");
  await eval_(`document.getElementById("uf-los").click(); true`);
  ok(await bis(`document.getElementById("meldung").textContent.includes("Version 1.0.0 veröffentlicht")`), "Veröffentlicht als 1.0.0");

  // 4) Bibliothek: spielen (Stand mit saveVersion 1), Versionsnummer + Verlauf
  await gehe(G + "/#/spiel/seb/e2e", 5000);
  ok(await eval_(`document.getElementById("version-knopf").textContent`) === "v1.0.0", "Bibliothek zeigt v1.0.0");
  await eval_(`document.getElementById("version-knopf").click(); true`);
  ok(await bis(`document.getElementById("versionen-panel").textContent.includes("Erste Version")`), "Versionsverlauf zeigt „Erste Version“");
  const s1 = await eval_(`fetch("/api/save/seb/e2e/stand").then(r=>r.json())`);
  ok(s1.version === 1 && s1.data.zahl >= 1, "Spielstand mit saveVersion 1 gespeichert: " + JSON.stringify(s1.data));

  // 5) v2 mit saveVersion 2 → Entwurf testen → Migration gemeldet → minor → 1.1.0
  await gehe(U + "/");
  ok(await hochladen("e2e-v2.zip", "Neues Feld"), "v2 als Entwurf hochgeladen");
  await gehe(G + "/#/entwurf/seb/e2e", 5000);
  await gehe(U + "/");
  await updateFensterOeffnen();
  const p2 = await eval_(`[...document.querySelectorAll("#uf-punkte li")].map(l=>l.className+":"+l.textContent).join("\\n")`);
  ok(p2.includes("ok:Umwandlung auf saveVersion 2 mit deinem Spielstand getestet"), "Prüfung: Migration im Entwurf getestet (gamesave → Bridge → Speicher-Dienst)");
  ok(p2.includes("hinweis:saveVersion steigt (1 → 2)"), "Prüfung: Hinweis saveVersion steigt");
  ok(await eval_(`document.querySelector('[data-v="minor"]').textContent`) === "→ 1.1.0", "Vorschlag kleines Update: 1.1.0");
  await eval_(`document.querySelector('input[name="uf-art"][value="minor"]').checked=true; document.getElementById("uf-los").click(); true`);
  ok(await bis(`document.getElementById("meldung").textContent.includes("Version 1.1.0 veröffentlicht")`), "Veröffentlicht als 1.1.0");

  // 6) Bibliothek: „Neu in Version 1.1.0“, Stand umgewandelt
  await gehe(G + "/#/spiel/seb/e2e", 5000);
  ok(await eval_(`!document.getElementById("neu-hinweis").hidden && document.getElementById("neu-text").textContent`) === "Neu in Version 1.1.0: Neues Feld", "Hinweis „Neu in Version 1.1.0“");
  const s2 = await eval_(`fetch("/api/save/seb/e2e/stand").then(r=>r.json())`);
  ok(s2.version === 2 && s2.data.neu === true, "Spielstand umgewandelt auf saveVersion 2: " + JSON.stringify(s2.data));

  // 7) Rollback auf 1.0.0 → Rückfrage → Spielstände zurückholen
  await gehe(U + "/");
  await bis(`[...document.querySelectorAll("button")].some(b=>b.textContent==="Zurücksetzen")`);
  await eval_(`[...document.querySelectorAll("button")].find(b=>b.textContent==="Zurücksetzen").click(); true`);
  ok(await bis(`document.getElementById("rollback-fenster").open`), "Rückfrage zu Spielständen erscheint");
  ok((await eval_(`document.getElementById("rb-text").textContent`)).includes("saveVersion 2"), "Rückfrage erklärt saveVersion 2 → 1");
  await eval_(`document.querySelector('#rollback-fenster button[value="zuruecksetzen"]').click(); true`);
  ok(await bis(`document.getElementById("meldung").textContent.includes("1 Spielstände zurückgeholt")`), "1 Spielstand zurückgeholt");
  const s3 = await eval_(`fetch("${G}/api/save/seb/e2e/stand",{credentials:"include"}).then(r=>r.json()).catch(e=>({fehler:String(e)}))`).catch(() => null);
  await gehe(G + "/", 2500);
  const s4 = await eval_(`fetch("/api/save/seb/e2e/stand").then(r=>r.json())`);
  ok(s4.version === 1 && s4.data.neu === undefined, "Spielstand wieder auf saveVersion 1: " + JSON.stringify(s4.data));
  const vv = await eval_(`fetch("/api/versionen/seb/e2e").then(r=>r.json())`);
  ok(vv.aktuell === "1.0.0" && vv.releases[0].art === "rollback", "Versionsverlauf: aktuell 1.0.0, oben „Zurückgesetzt“");

  // 8) Testspiel: nicht in der Übersicht
  await eval_(`fetch("/api/admin/spiele/seb/spike",{method:"PATCH",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({testspiel:true})}).then(r=>r.status)`);
  await gehe(G + "/", 3000);
  const titel = await eval_(`[...document.querySelectorAll("#kacheln h2")].map(h=>h.textContent)`);
  ok(!titel.some((t) => /spike/i.test(t)) && titel.includes("E2E"), "Testspiel „spike“ fehlt in der Übersicht, E2E ist da");

  // 9) Hilfe und Handbuch
  await gehe(G + "/hilfe/");
  ok(await eval_(`!document.getElementById("kopieren") && document.body.textContent.includes("Entwickler-Handbuch")`), "Hilfe: nur Spieler-Inhalte + Verweis aufs Handbuch");
  await gehe(G + "/handbuch/");
  ok(await bis(`document.getElementById("prompt-text").textContent.includes("UPDATES UND VERSIONEN")`), "Handbuch: Prompt-Block aus prompt.txt geladen");
  const zip = await eval_(`fetch("/handbuch/startvorlage.zip").then(r=>r.status)`);
  ok(zip === 200, "Startvorlage herunterladbar");

  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
