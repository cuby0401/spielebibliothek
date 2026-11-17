// Ende-zu-Ende-Test für Zentrale 1.6.0: Multiplayer. Das Beispiel „Vier gewinnt“ wird als Entwurf hochgeladen und in zwei Tabs
// geöffnet (im Entwurf darf man gegen sich selbst spielen: seb und seb-2). Lobby, Raum erstellen, mit Code beitreten, Raum-Karte,
// Züge über den Host, Host verlässt den Raum → der andere übernimmt mit dem Spielstand.
// Aufruf (macht scripts/e2e-alle.sh): node scripts/e2e-zentrale-1.6-multiplayer.mjs <ordner> <upload-passwort>
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as warte } from "node:timers/promises";
const G = process.env.E2E_G || "http://<NAS_GH>:18088", U = process.env.E2E_U || "http://<NAS_UH>:18090";
const DIR = process.argv[2], PW = process.argv[3];
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [...(process.env.CHROME_BIN ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] : []), "--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${DIR}/chrome-profil`, "--no-first-run", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
let ws, nr = 0; const offen = new Map(); const fehler = []; const ergebnis = []; const rahmen = new Map();   // Tab-Session → iframe-Session
const ok = (bed, text) => { ergebnis.push((bed ? "✓ " : "✗ ") + text); if (!bed) process.exitCode = 1; };
function cdp(method, params = {}, sessionId) {
  const id = ++nr; ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ja, nein) => offen.set(id, { ja, nein }));
}
async function eval_(S, ausdruck) {
  const r = await cdp("Runtime.evaluate", { expression: ausdruck, awaitPromise: true, returnByValue: true }, S);
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function bis(S, ausdruck, ms = 10000) { const ende = Date.now() + ms; while (Date.now() < ende) { if (await eval_(S, ausdruck).catch(() => false)) return true; await warte(250); } return false; }
const imSpiel = (S, ausdruck) => eval_(rahmen.get(S), ausdruck);
async function bisImSpiel(S, ausdruck, ms = 10000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (rahmen.get(S) && await imSpiel(S, ausdruck).catch(() => false)) return true; await warte(250); }
  return false;
}
async function tab() {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Page.enable", {}, S); await cdp("Runtime.enable", {}, S);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `new MutationObserver(() => { for (const d of document.querySelectorAll('dialog[data-art="bestaetigen"][open]:not([data-e2e])')) {
    d.dataset.e2e = "1"; setTimeout(() => d.querySelector(".b-dialog__fuss .b-knopf--primaer, .b-dialog__fuss .b-knopf--gefahr").click(), 50); } }).observe(document, { subtree: true, childList: true, attributes: true });` }, S);
  await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, S);
  return S;
}
(async () => {
  let v = null;
  for (let i = 0; i < 60 && !v; i++) { await warte(250); v = await fetch("http://127.0.0.1:9333/json/version").then((r) => r.json()).catch(() => null); }
  if (!v) throw new Error("Chrome startet nicht");
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) { const o = offen.get(d.id); offen.delete(d.id); d.error ? o.nein(new Error(d.error.message)) : o.ja(d.result); }
    if (d.method === "Runtime.exceptionThrown") fehler.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Target.attachedToTarget" && d.params.targetInfo.type === "iframe" && d.sessionId) {
      rahmen.set(d.sessionId, d.params.sessionId);
      cdp("Runtime.enable", {}, d.params.sessionId).catch(() => {});
    }
  });

  // 1) Beispiel als Entwurf hochladen
  const A = await tab();
  await cdp("Page.navigate", { url: U + "/" }, A);
  await bis(A, `!!document.getElementById("anmeldeform")`);
  await eval_(A, `document.getElementById("passwort").value=${JSON.stringify(PW)}; document.getElementById("anmeldeform").requestSubmit(); true`);
  ok(await bis(A, `!document.getElementById("bereich").hidden`), "Upload-Seite: angemeldet");
  const zip = readFileSync(`${DIR}/vier-gewinnt.zip`).toString("base64");
  const status = await eval_(A, `(async () => { const b = Uint8Array.from(atob(${JSON.stringify(zip)}), (c) => c.charCodeAt(0));
    const fd = new FormData(); fd.append("datei", new Blob([b]), "vier-gewinnt.zip"); fd.append("neu", "Erste Version");
    return (await fetch("/api/upload/spiele/vier-gewinnt", { method: "POST", headers: { "X-Upload": "1" }, body: fd })).status; })()`);
  ok(status === 200, "Vier gewinnt als Entwurf hochgeladen");

  // 2) Tab A: Lobby, Raum erstellen
  await cdp("Page.navigate", { url: G + "/#/entwurf/seb/vier-gewinnt" }, A);
  ok(await bis(A, `!!document.getElementById("mp-lobby")`), "Lobby erscheint statt des Spiels");
  ok(await eval_(A, `document.getElementById("mp-lobby").textContent.includes("2 Spieler")`), "Lobby nennt die Spielerzahl aus der game.json");
  await eval_(A, `document.getElementById("mp-neu").click(); true`);
  ok(await bis(A, `!document.getElementById("mp-karte").hidden && /^[A-Z]{4}$/.test(document.getElementById("mp-code").textContent)`), "Raum erstellt, Raum-Karte mit Code");
  const code = await eval_(A, `document.getElementById("mp-code").textContent`);
  ok(await bisImSpiel(A, `document.getElementById("status").textContent.includes("Warte auf einen Mitspieler")`), "Spiel läuft im Raum: Host wartet auf Mitspieler");

  // 3) Tab B: mit Code beitreten
  const B = await tab();
  await cdp("Page.navigate", { url: G + "/#/entwurf/seb/vier-gewinnt" }, B);
  ok(await bis(B, `!!document.getElementById("mp-lobby")`), "Zweiter Tab: Lobby");
  ok(await bis(B, `document.getElementById("mp-raeume").textContent.includes(${JSON.stringify(code)})`), "Zweiter Tab: Raum steht unter „Offene Räume“");
  await eval_(B, `{ const i = document.querySelector("#mp-lobby input"); i.value = ${JSON.stringify(code.toLowerCase())}; i.dispatchEvent(new Event("input")); document.getElementById("mp-beitreten").click(); } true`);
  ok(await bis(B, `document.getElementById("mp-karte").textContent.includes("(du)") && document.querySelectorAll("#mp-inhalt .b-zeile").length === 2`), "Zweiter Tab: im Raum, zwei Spieler in der Raum-Karte");
  ok(await bis(A, `document.querySelectorAll("#mp-inhalt .b-zeile").length === 2 && document.getElementById("mp-titel").textContent.includes("2/2")`), "Erster Tab sieht den Mitspieler");

  // 4) Spielen: Host startet, Züge gehen über den Host
  ok(await bisImSpiel(A, `!document.getElementById("neu").hidden`), "Host hat „Spiel starten“");
  ok(await bisImSpiel(B, `document.getElementById("neu").hidden && document.getElementById("status").textContent.includes("Host")`), "Mitspieler wartet auf den Host");
  await imSpiel(A, `document.getElementById("neu").click(); true`);
  ok(await bisImSpiel(A, `document.getElementById("status").textContent.includes("Du bist dran")`), "Host ist dran");
  ok(await bisImSpiel(B, `document.getElementById("status").textContent.includes("ist dran")`), "Mitspieler sieht, wer dran ist");
  await imSpiel(B, `document.querySelector('.feld[data-spalte="3"]').click(); true`);
  ok(await bisImSpiel(B, `document.getElementById("fehler").textContent.includes("nicht dran")`), "Zug außer der Reihe: der Host lehnt ab");
  await imSpiel(A, `document.querySelector('.feld[data-spalte="3"]').click(); true`);
  ok(await bisImSpiel(B, `document.querySelectorAll('.feld[data-farbe="0"]').length === 1 && document.getElementById("status").textContent.includes("Du bist dran")`), "Zug des Hosts kommt beim Mitspieler an");
  await imSpiel(B, `document.querySelector('.feld[data-spalte="4"]').click(); true`);
  ok(await bisImSpiel(A, `document.querySelectorAll('.feld[data-farbe="1"]').length === 1`), "Zug des Mitspielers kommt beim Host an");

  // 5) Host verlässt den Raum → B wird Host und spielt mit demselben Stand weiter
  await eval_(A, `document.getElementById("mp-verlassen").click(); true`);
  ok(await bis(A, `!!document.getElementById("mp-lobby")`), "Verlassen: zurück in der Lobby");
  ok(await bis(B, `document.getElementById("mp-karte").textContent.includes("Host") && document.querySelectorAll("#mp-inhalt .b-zeile").length === 1`), "Mitspieler ist jetzt allein und Host");
  ok(await bisImSpiel(B, `!document.getElementById("neu").hidden && document.querySelectorAll('.feld[data-farbe]').length === 2`), "Neuer Host hat den Spielstand übernommen");

  // 6) A kommt per Code zurück, B wirft A raus
  await eval_(A, `{ const i = document.querySelector("#mp-lobby input"); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event("input")); document.getElementById("mp-beitreten").click(); } true`);
  ok(await bis(B, `document.querySelectorAll("#mp-inhalt .b-zeile").length === 2`), "Erster Tab wieder im Raum");
  ok(await bisImSpiel(A, `document.querySelectorAll('.feld[data-farbe]').length === 2`), "Zurückgekehrter Spieler bekommt den aktuellen Stand");
  await eval_(B, `document.querySelector('#mp-inhalt [aria-label$="rauswerfen"]').click(); true`);
  ok(await bis(A, `!!document.getElementById("mp-lobby")`), "Rausgeworfen: zurück in der Lobby");

  const ohneFehler = fehler.filter((f) => !/ResizeObserver/.test(f));
  ok(ohneFehler.length === 0, "keine JavaScript-Fehler" + (ohneFehler.length ? ": " + ohneFehler.slice(0, 3).join(" | ") : ""));
  console.log(ergebnis.join("\n"));
  chrome.kill();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.log(ergebnis.join("\n")); console.log("ABBRUCH: " + e.message); chrome.kill(); process.exit(1); });
