// Ende-zu-Ende-Test für Zentrale 1.4.0: CRM – Personen-Liste, einladen, Notiz, verwarnen, sperren, entsperren,
// Prüfprotokoll, „Meine Angaben“ im Profil. Aufbau wie e2e-zentrale-1.3.1-antraege.mjs.
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-zentrale-1.4-crm.mjs <ordner> <upload-passwort>
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

  // 1.5.0: Zeilen der CRM-Liste tragen das Handle (fett steht dort der Anzeigename)
  const ZEILE = (name) => `document.querySelector('tbody tr[data-schluessel=${JSON.stringify(name)}]')`;
  // Kein leeres „null“ als Text auf der Seite (1.4.1, Nachtest 09.11.: Admin-Panel Personen und Tester-Panel)
  const OHNE_NULL = `(()=>{const w=document.createTreeWalker(document.getElementById("inhalt"),NodeFilter.SHOW_TEXT);
    while(w.nextNode()) if(w.currentNode.nodeValue.trim()==="null") return false; return true})()`;
  const KNOPF = (text) => `[...document.querySelectorAll("#inhalt button")].find(b=>b.textContent===${JSON.stringify(text)})`;
  // Admin-Panel aus Bausteinen (E85): Meldungen unten (UI.meldung), Rückfragen als eigener Dialog statt confirm()/prompt()
  const MELDUNG = `[...document.querySelectorAll(".b-meldung__text")].map(m=>m.textContent).join(" | ")`;
  const JA = `document.querySelector("dialog.b-dialog[open] .b-dialog__fuss .b-knopf:last-child").click()`;
  const STATUS = `document.getElementById("person-status")?.textContent`;
  const DIALOG_OFFEN = `!!document.querySelector("dialog.b-dialog[open]")`;

  // 1) Personen-Liste: übernommen aus users.yaml, alte Adresse #benutzer leitet um
  await gehe(G + "/admin/#benutzer", 4000);
  ok(await bis(`location.hash==="#personen"`), "#benutzer leitet auf #personen um");
  ok(await bis(`!!(${ZEILE("seb")}) && !!(${ZEILE("paul")})`), "seb und paul aus users.yaml übernommen");
  ok(await eval_(`(${ZEILE("seb")}).textContent.includes("Admin") && (${ZEILE("paul")}).textContent.includes("Entwickler")`), "Rollen übernommen (seb Admin, paul Entwickler)");
  ok(await eval_(OHNE_NULL), "Personen-Liste ohne „null“");

  // 2) Einladen
  await eval_(`{ document.getElementById("einladen-mail").value="lea@example.com"; document.getElementById("einladen-handle").value="lea";
    document.getElementById("einladen-vorname").value="Lea"; document.querySelector("#einladen form").requestSubmit(); } true`);
  ok(await bis(`location.hash==="#person/lea" && ${STATUS}==="eingeladen"`), "lea eingeladen → eigene Seite, Status eingeladen");
  ok(await eval_(`document.body.textContent.includes("lea@example.com")`), "Login-E-Mail steht auf der Seite");
  ok(await eval_(OHNE_NULL), "Personen-Seite ohne „null“ unter dem Namen");

  // 3) Notiz, verwarnen
  await eval_(`document.getElementById("notiz-text").value="E2E: interne Notiz"; (${KNOPF("Notiz speichern")}).click(); true`);
  ok(await bis(`document.body.textContent.includes("E2E: interne Notiz")`), "Notiz gespeichert und angezeigt");
  await eval_(`document.getElementById("massnahme-grund").value="E2E-Verwarnung"; (${KNOPF("Verwarnen")}).click(); true`);
  ok(await bis(`${STATUS}==="verwarnt"`), "Verwarnt");

  // 4) Sperren und entsperren
  await bis(`!!(${KNOPF("Sperren")})`);
  await eval_(`document.getElementById("massnahme-grund").value="E2E-Sperre"; (${KNOPF("Sperren")}).click(); true`);
  ok(await bis(DIALOG_OFFEN), "Sperren fragt im eigenen Dialog nach (kein Browser-Fenster)");
  await eval_(`${JA}; true`);
  ok(await bis(`${STATUS}==="gesperrt" && document.body.textContent.includes("Gesperrt: E2E-Sperre")`), "Gesperrt, Grund angezeigt");
  await eval_(`(${KNOPF("Entsperren")}).click(); true`);
  ok(await bis(`${STATUS}==="eingeladen"`), "Entsperrt → wieder eingeladen (lea hat sich nie angemeldet)");
  ok(await eval_(`[...document.querySelectorAll("#inhalt td")].some(t=>t.textContent==="sperre")`), "Zeitleiste zeigt die Sperre");

  // 5) Stammdaten und Rolle Tester
  await eval_(`{ const i=document.querySelectorAll("#stammdaten input"); i[0].value="Lea E2E"; document.getElementById("stammdaten").requestSubmit(); } true`);
  ok(await bis(`${MELDUNG}.includes("Gespeichert.")`), "Stammdaten gespeichert");
  await eval_(`{ const l=[...document.querySelectorAll("#inhalt .b-haken")].find(x=>x.textContent.includes("Tester")); l.querySelector("input").click(); (${KNOPF("Rollen speichern")}).click(); } true`);
  ok(await bis(`${MELDUNG}.includes("+Tester")`), "Rolle Tester vergeben");

  // 5b) Entwickler geben, nehmen, wieder geben (1.4.0, Nachtest 08.11., Sebs Test seb-crm-massnahmen): Der Spieleordner bleibt nach dem
  //     Entziehen stehen – der Haken darf trotzdem nicht hängen bleiben
  const ENTW = `[...document.querySelectorAll("#inhalt .b-haken")].find(x=>x.textContent==="Entwickler").querySelector("input")`;
  const rolleKlicken = async () => { await eval_(`(${ENTW}).click(); (${KNOPF("Rollen speichern")}).click(); true`); };
  await rolleKlicken();
  ok(await bis(`${MELDUNG}.includes("+Entwickler")`) && await bis(`!!document.getElementById("passwort-hinweis")`, 3000),
    "Entwickler vergeben, Upload-Passwort angezeigt");
  await bis(`(${ENTW}).checked`);
  await rolleKlicken();
  ok(await bis(`${MELDUNG}.includes("−Entwickler")`), "Entwickler entzogen");
  await gehe(G + "/admin/?neu=2#person/lea", 3500);
  ok(await bis(`!!(${ENTW}) && !(${ENTW}).checked`), "Nach dem Neuladen: Haken bei Entwickler ist weg");
  await rolleKlicken();
  ok(await bis(`${MELDUNG}.includes("+Entwickler")`), "Entwickler erneut vergeben");

  // 5c) Einladung ohne E-Mail-Versand (1.4.0, Nachtest 08.11.): Die Meldung muss sichtbar sein, auch wenn der Knopf weit unten steht
  await eval_(`scrollTo(0, document.body.scrollHeight); (${KNOPF("Einladung senden")}).click(); true`);
  ok(await bis(`${MELDUNG}.includes("nicht eingerichtet")`), "Einladung ohne SMTP: verständliche Meldung");
  ok(await eval_(`{ const r=[...document.querySelectorAll(".b-meldung")].pop().getBoundingClientRect(); r.top>=0 && r.bottom<=innerHeight && r.height>0 }`),
    "Die Meldung steht im sichtbaren Bereich (unten gescrollt)");

  // 5d) Archivieren ist rückgängig zu machen, endgültig löschen ein eigener Schritt (Sebs Test 08.11.2026)
  await gehe(G + "/admin/?neu=3#person/lea", 3500);
  await bis(`!!(${KNOPF("Archivieren …")})`);
  await eval_(`(${KNOPF("Archivieren …")}).click(); true`);
  await bis(DIALOG_OFFEN); await eval_(`${JA}; true`);
  ok(await bis(`${STATUS}==="archiviert" && !!(${KNOPF("Wiederherstellen")})`), "Archiviert → Knopf „Wiederherstellen“");
  ok(await eval_(`document.body.textContent.includes("lea@example.com") && document.body.textContent.includes("E2E: interne Notiz")`), "Archiviert: E-Mail und Notiz bleiben");
  await eval_(`(${KNOPF("Wiederherstellen")}).click(); true`);
  ok(await bis(`${STATUS}==="eingeladen" && !!document.getElementById("passwort-hinweis")`), "Wiederhergestellt: eingeladen (nie angemeldet), Entwickler bekommt neues Upload-Passwort");
  await eval_(`(${KNOPF("Archivieren …")}).click(); true`);
  await bis(DIALOG_OFFEN); await eval_(`${JA}; true`);
  await bis(`!!(${KNOPF("Endgültig löschen (anonymisieren) …")})`);
  await eval_(`(${KNOPF("Endgültig löschen (anonymisieren) …")}).click(); true`);
  await bis(DIALOG_OFFEN);
  await eval_(`document.querySelector("dialog.b-dialog[open] input").value="lea"; ${JA}; true`);
  ok(await bis(`${STATUS}==="gelöscht" && !document.body.textContent.includes("lea@example.com") && !(${KNOPF("Wiederherstellen")})`),
    "Endgültig gelöscht: E-Mail nirgends mehr auf der Seite (auch nicht im Protokoll), kein „Wiederherstellen“");

  // 6) Prüfprotokoll
  await gehe(G + "/admin/#protokoll", 3000);
  const aktionen = await eval_(`[...document.querySelectorAll("tbody tr td:nth-child(3)")].map(t=>t.textContent)`);
  ok(["einladen", "notiz", "verwarnen", "sperren", "entsperren", "stammdaten", "rollen", "archivieren", "wiederherstellen", "loeschen"].every((a) => aktionen.includes(a)), "Protokoll: " + aktionen.slice(0, 8).join(", "));

  // 7) Meine Angaben im eigenen Profil
  await gehe(G + "/#/profil", 3500);
  ok(await bis(`!!document.querySelector("#angaben form")`), "Profil: Abschnitt „Meine Angaben“");
  await eval_(`{ const f=document.querySelector("#angaben form"); f.querySelector("input").value="Seb E2E"; f.querySelector('input[type="checkbox"]').checked=true; f.requestSubmit(); } true`);
  await warte(1000);
  await gehe(G + "/?neu=1#/profil", 3500);      // andere Adresse → Seite wird wirklich neu geladen
  ok(await bis(`document.querySelector("#angaben form input")?.value==="Seb E2E"`), "Anzeigename gespeichert");
  ok(await eval_(`document.querySelector('#angaben input[type="checkbox"]').disabled`), "Datenschutzhinweis bestätigt");
  ok(await eval_(`fetch("/api/mein/konto").then(r=>r.text()).then(t=>!t.includes("Notiz") && !t.includes("protokoll"))`), "Mein Konto ohne Admin-Felder");

  ok(await eval_(`document.querySelector("#profil-name").textContent==="Seb E2E"`), "Profilkopf zeigt den Anzeigenamen");
  // 1.4.1, Nachtest 09.11. (Seb): Anzeigename oben rechts, „dabei seit“ mit Tag, „gespielt“ statt „Spiele“
  ok(await eval_(`document.getElementById("benutzer").textContent==="Seb E2E" && document.getElementById("benutzer").title==="@seb"`), "Oben rechts steht der Anzeigename");
  ok(await eval_(`/dabei seit \\d\\d\\.\\d\\d\\.\\d{4}/.test(document.querySelector("#profil-kopf").textContent)`), "„dabei seit“ mit vollem Datum");
  ok(await eval_(`[...document.querySelectorAll(".b-kennzahl__label")].some(d=>d.textContent==="gespielt")`), "Profil: „gespielt“ statt „Spiele“");
  ok(await eval_(`fetch("/api/me").then(r=>r.json()).then(m=>m.anzeigename==="Seb E2E" && m.namen.seb==="Seb E2E")`), "/api/me liefert die Anzeigenamen");
  // CRM: übernommene Personen „von seb“, „Angelegt am“ nur durch den Admin korrigierbar
  ok(await eval_(`fetch("/api/admin/personen/paul").then(r=>r.json()).then(p=>p.eingeladen_von==="seb")`), "Übernommene Person: angelegt von seb");
  ok(await eval_(`fetch("/api/admin/personen/paul",{method:"PATCH",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({angelegt:"2026-10-20"})})
    .then(r=>r.json()).then(p=>p.angelegt==="2026-10-19T22:00:00+00:00")`), "„Angelegt am“ korrigiert");

  // 8) Fehler der Bibliothek (1.4.0): Bericht mit Nummer, ganz oben in der Admin-Übersicht
  const nr = await eval_(`fetch("/api/fehler-zentrale",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},
    body:JSON.stringify({meldung:"TypeError: E2E-Test",quelle:"/app.js",zeile:42,seite:"#/e2e",version:"e2e"})}).then(r=>r.json()).then(d=>d.nr)`);
  ok(Number.isInteger(nr), "Fehler der Bibliothek bekommt eine Nummer: " + nr);
  await gehe(G + "/admin/", 3500);
  // Seit 1.5.0 (Seb, 10.11.): in der Übersicht nur eine rote Zeile, die Liste öffnet sich im eigenen Fenster
  ok(await bis(`document.getElementById("fehler-zeile")?.textContent.includes("1 Fehler in der Bibliothek") && !document.getElementById("fehler-fenster")`), "Admin-Übersicht: rote Zeile „1 Fehler in der Bibliothek“, Fenster zu");
  await eval_(`document.querySelector("#fehler-zeile button").click(); true`);
  ok(await bis(`document.getElementById("fehler-fenster")?.open && document.getElementById("fehler-fenster").textContent.includes("TypeError: E2E-Test")`), "Klick öffnet das Fenster mit dem Fehler");
  await eval_(`[...document.querySelectorAll("#fehler-fenster button")].find(b=>b.textContent==="Erledigt").click(); true`);
  ok(await bis(`document.getElementById("fehler-fenster")?.textContent.includes("Alle erledigt")`), "„Erledigt“ entfernt den Fehler im Fenster");
  await eval_(`document.getElementById("fehler-fenster").close(); true`);
  ok(await bis(`!document.getElementById("fehler-zeile") && document.body.textContent.includes("Keine Fehler in der Bibliothek")`), "Nach dem Schließen: keine rote Zeile mehr");

  // 8b) Tester-Panel (1.4.0, E76): Plan aus tests/manuell, Ergebnis eintragen, Zusammenfassung
  await gehe(G + "/tester/", 3500);
  ok(await bis(`document.querySelectorAll("#inhalt [data-test]").length>=1`), "Tester-Panel zeigt den Testplan");   // Patches haben oft nur wenige Tests
  ok(await eval_(OHNE_NULL), "Tester-Panel: kein leeres „null“");
  await eval_(`document.querySelector('#inhalt [data-test] [data-ergebnis="nein"]').click(); true`);
  ok(await bis(`[...document.querySelectorAll("#meldung, .b-meldung__text")].map(e=>e.textContent).join(" ").includes("beschreiben")`), "„Hat nicht geklappt“ ohne Begründung wird abgelehnt");
  const offenVorher = await eval_(`document.querySelectorAll('#inhalt [data-zustand="offen"]').length`);
  await eval_(`document.querySelector('#inhalt [data-test] [data-ergebnis="ja"]').click(); true`);
  ok(await bis(`document.querySelector('[data-zahl="bestanden"] .b-kennzahl__wert').textContent==="1"`), "„Hat geklappt“ zählt als bestanden");
  // 1.4.1 (Seb): eingetragene Tests verschwinden aus „Offen“ und stehen im Archiv „Bestanden“ bzw. „Abgelehnt“, mit Verlauf und Fotos
  ok(await bis(`document.querySelectorAll('#inhalt [data-zustand="offen"]').length===${offenVorher}-1`), "Bestandener Test verschwindet aus „Offen“");
  await eval_(`(async()=>{const t=document.querySelector('#inhalt [data-zustand="offen"] textarea');t.value="E2E: geht nicht";
    t.closest("[data-test]").querySelector('[data-ergebnis="nein"]').click()})(); true`);
  ok(await bis(`document.querySelectorAll('#inhalt [data-zustand="offen"]').length===${offenVorher}-2`), "Abgelehnter Test verschwindet aus „Offen“");
  const foto = await eval_(`fetch("/api/tester/plan").then(r=>r.json()).then(d=>{const x=d.verlauf.find(x=>!x.ok);
    const c=document.createElement("canvas");c.width=c.height=8;
    return fetch("/api/tester/ergebnis/"+x.id+"/bilder",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},
      body:JSON.stringify({bild:c.toDataURL("image/png")})}).then(r=>r.status)})`);
  ok(foto === 201, "Foto an das abgelehnte Ergebnis angefügt");
  await gehe(G + "/tester/#abgelehnt", 3500);
  ok(await bis(`document.querySelectorAll("#inhalt details[data-test]").length===1`), "Reiter „Abgelehnt“ zeigt den Test eingeklappt");
  await eval_(`document.querySelector("#inhalt details[data-test]").open=true; true`);
  // Bilder laden „lazy“ – erst ins Bild scrollen, sonst lädt Chrome sie je nach Fenstergröße nicht (wackelte im Mac-Auftrag 09.11.)
  ok(await bis(`(()=>{const i=document.querySelector("details[data-test] .b-liste img");i?.scrollIntoView();return !!i && i.complete && i.naturalWidth===8})()`, 15000),
    "Archiv zeigt Verlauf mit Foto");
  await gehe(G + "/tester/#bestanden", 3500);
  ok(await bis(`document.querySelectorAll("#inhalt details[data-test]").length===1 && document.querySelector('#tester-reiter [aria-selected="true"]').textContent.startsWith("Bestanden")`),
    "Reiter „Bestanden“ zeigt den Test");

  // 8c) Handy (1.4.0, Nachtest 08.11., Sebs Test konto-handy): nichts ragt über den rechten Rand, das Initialen-Bild ist ganz zu sehen.
  //     Safari auf dem iPhone setzt Schrift breiter als Chrome – deshalb auch mit 320 px prüfen (kleinstes iPhone)
  for (const breite of [320, 390]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: breite, height: 844, deviceScaleFactor: 3, mobile: true }, S);
    for (const seite of ["sicherheit", "profil"]) {
      await gehe(G + `/?handy=${breite}${seite}#/${seite}`, 3500);
      await bis(`!!document.querySelector("#konto-leiste")`);
      const m = await eval_(`({ breit: document.documentElement.scrollWidth,
        raus: [...document.querySelectorAll("#kopf a, #kopf button, #avatar")].filter(x=>x.offsetParent && x.getBoundingClientRect().right > ${breite} + 0.5)
          .map(x=>x.id || x.textContent.trim() || x.className) })`);
      // Nicht mit innerWidth vergleichen: Ist die Seite zu breit, zoomt der Browser heraus und innerWidth wächst mit
      ok(m.breit <= breite && !m.raus.length, `Handy ${breite} px #/${seite}: Seite ${m.breit} px breit` + (m.raus.length ? `, über den Rand: ${m.raus.join(", ")}` : ", nichts über den Rand"));
    }
  }
  await cdp("Emulation.clearDeviceMetricsOverride", {}, S);

  // 9) Not-Aus (1.4.0) – als Letztes, danach antwortet der Teststand absichtlich nicht mehr
  await gehe(G + "/admin/", 3500);
  ok(await bis(`!!document.querySelector("details#notaus summary") && !document.querySelector("#notaus").open`), "Not-Aus-Feld in der Übersicht (eingeklappt)");
  ok(!fehler.length, "Keine JavaScript-Fehler" + (fehler.length ? ": " + fehler.join(" | ") : ""));
  const na = await eval_(`fetch("/api/admin/notaus",{method:"POST",headers:{"X-Bibliothek":"1","Content-Type":"application/json"},body:JSON.stringify({bestaetigung:"NOT-AUS",grund:"E2E"})}).then(r=>r.status)`);
  ok(na === 200, "Not-Aus ausgelöst");
  ok(await eval_(`fetch("/api/me").then(r=>r.status)`) === 503, "Danach: Speicher-Dienst antwortet 503");
  ok(await eval_(`fetch("/api/games").then(r=>r.status)`) === 503, "Danach: keine Spielliste mehr");
  // 1.4.0, Nachtest 08.11. (Sebs Test seb-not-aus): auch Hilfe, Handbuch und die Startseite sind weg – Caddy liefert nur noch die Not-Aus-Seite
  for (const pfad of ["/", "/hilfe/", "/handbuch/", "/lib/bridge.js"]) {
    const r = await eval_(`fetch(${JSON.stringify(pfad)},{cache:"no-store"}).then(async r=>[r.status,(await r.text()).includes("Not-Aus aktiv")])`);
    ok(r[0] === 503 && r[1], `Danach: ${pfad} → 503 mit Not-Aus-Seite`);
  }
  console.log(ergebnis.join("\n"));
  chrome.kill(); process.exit();
})().catch((e) => { console.log(ergebnis.join("\n")); console.error("ABBRUCH:", e.message); chrome.kill(); process.exit(1); });
