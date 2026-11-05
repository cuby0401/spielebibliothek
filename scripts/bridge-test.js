// Testgerüst: bridge.js mit nachgestelltem Browser und Server
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const code = fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.Bridge = Bridge;";
const lsMap = new Map();
const localStorage = { getItem: (k) => lsMap.has(k) ? lsMap.get(k) : null, setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k), key: (i) => [...lsMap.keys()][i] ?? null, get length() { return lsMap.size; } };
const handler = {}; const docHandler = {};
let server = { abgelaufen: false, offline: false, daten: new Map(), scores: [], anfragen: [] };
async function fetch(url, opt = {}) {
  server.anfragen.push(opt.method + " " + url);
  if (server.offline) throw new TypeError("Failed to fetch");
  if (server.abgelaufen) return { type: "opaqueredirect", status: 0, ok: false };
  const ok = (body, status = 200) => ({ type: "basic", status, ok: status < 300, json: async () => body });
  if (url === "/api/me") return ok({ player: "seb", sitzungBis: Math.floor(Date.now() / 1000) + 3600 });
  if (url.startsWith("/api/save/")) {
    if (opt.method === "PUT") { server.daten.set(url, JSON.parse(opt.body).data); return ok({}); }
    if (opt.method === "DELETE") { server.daten.delete(url); return ok(null, 204); }
    return server.daten.has(url) ? ok({ data: server.daten.get(url), version: 1 }) : ok({ detail: "kein" }, 404);
  }
  if (url.startsWith("/api/score/")) { server.scores.push(JSON.parse(opt.body)); return ok({ season: 1 }, 201); }
  return ok({}, 404);
}
const spielFenster = { gesendet: [], postMessage(m) { this.gesendet.push(m); } };
const ctx = {
  console, setTimeout, clearTimeout, JSON, Promise, Date, Map, WeakMap, Object, Array, Error, TypeError, encodeURIComponent, Number, String, Math,
  localStorage, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch,
  location: { reload() { ctx.neuGeladen = true; }, pathname: "/", search: "", hash: "" },
  window: { addEventListener: (t, f) => (handler[t] = f) },
  document: { visibilityState: "visible", addEventListener: (t, f) => ((docHandler[t] ||= []).push(f)),
    createElement: () => ({ setAttribute() {}, contentWindow: spielFenster }) },
};
ctx.globalThis = ctx;
vm.createContext(ctx); vm.runInContext(code, ctx);
const B = ctx.Bridge;
const warte = (ms = 20) => new Promise((r) => setTimeout(r, ms));
let nr = 0;
async function ausSpiel(m) {
  const id = ++nr; handler.message({ origin: B.PLAY, source: spielFenster, data: { gs: 1, id, ...m } });
  for (let i = 0; i < 50; i++) { const a = spielFenster.gesendet.find((x) => x.id === id); if (a) return a; await warte(5); }
  throw new Error("keine Antwort");
}
(async () => {
  let ablauf = 0, wieder = 0;
  B.beiAblauf = () => ablauf++; B.beiWieder = () => wieder++;
  B.spieler = "seb";
  await B.starten({ id: "seb/wortjagd", title: "W", saveVersion: 1 }, { replaceChildren() {} });
  const url = "/api/save/seb/wortjagd/stand";

  // 1) normal
  assert.equal((await ausSpiel({ op: "save", key: "stand", data: { a: 1 } })).ok, true);
  assert.deepEqual(server.daten.get(url), { a: 1 });

  // 2) Sitzung läuft ab → Spiel speichert weiter, alles landet im Puffer
  server.abgelaufen = true;
  assert.equal((await ausSpiel({ op: "save", key: "stand", data: { a: 2 } })).ok, true, "save bei Ablauf ok");
  assert.equal(ablauf, 1, "Band gezeigt");
  assert.equal((await ausSpiel({ op: "save", key: "stand", data: { a: 3 } })).ok, true);
  assert.equal((await ausSpiel({ op: "score", score: 42 })).ok, true, "score bei Ablauf ok");
  const geladen = await ausSpiel({ op: "load", key: "stand" });
  assert.deepEqual(geladen.result.data, { a: 3 }, "load liefert gepufferten Stand");
  handler.message({ origin: B.PLAY, source: spielFenster, data: { gs: 1, op: "lsWrite", changes: { hs: "99" } } });
  // Tab wird geschlossen → localStorage-Ersatz sofort und synchron in den Puffer
  handler.pagehide();
  const puffer = JSON.parse(localStorage.getItem("sb-puffer:seb:"));
  assert.deepEqual(puffer.saves[url].body.data, { a: 3 });
  assert.deepEqual(puffer.saves["/api/save/seb/wortjagd/__ls"].body.data, { hs: "99" });
  assert.equal(puffer.scores.length, 1);
  assert.deepEqual(server.daten.get(url), { a: 1 }, "Server noch alt");

  // 3) Neue Anmeldung → nachreichen
  server.abgelaufen = false;
  const n = await B.nachreichen();
  assert.equal(n, 3, "3 Einträge nachgereicht");
  assert.deepEqual(server.daten.get(url), { a: 3 });
  assert.deepEqual(server.daten.get("/api/save/seb/wortjagd/__ls"), { hs: "99" });
  assert.deepEqual(server.scores, [{ score: 42 }]);
  assert.equal(localStorage.getItem("sb-puffer:seb:"), null, "Puffer leer");
  assert.equal(wieder, 1, "Band wieder weg");

  // 4) Offline (keine Verbindung) → ebenfalls puffern
  server.offline = true;
  assert.equal((await ausSpiel({ op: "save", key: "stand", data: { a: 4 } })).ok, true);
  server.offline = false;
  assert.equal(await B.nachreichen(), 1);
  assert.deepEqual(server.daten.get(url), { a: 4 });

  // 5) Zeitablauf: eine Minute vor Sitzungsende wird ohne Netz direkt gepuffert
  B.sitzungBis = Math.floor(Date.now() / 1000) + 30;
  const vorher = server.anfragen.length;
  assert.equal((await ausSpiel({ op: "save", key: "stand", data: { a: 5 } })).ok, true);
  assert.equal(server.anfragen.length, vorher, "keine Anfrage mehr, direkt gepuffert");
  assert.equal(ablauf, 2);
  assert.deepEqual(JSON.parse(localStorage.getItem("sb-puffer:seb:")).saves[url].body.data, { a: 5 });

  // 6) Lange im Hintergrund bei abgelaufener Sitzung → neu laden (Anmeldung)
  const hidden = () => { ctx.document.visibilityState = "hidden"; docHandler.visibilitychange.forEach((f) => f()); };
  const visible = () => { ctx.document.visibilityState = "visible"; docHandler.visibilitychange.forEach((f) => f()); };
  const echtJetzt = Date.now;
  hidden(); ctx.Date.now = () => echtJetzt() + 31 * 60000; visible(); ctx.Date.now = echtJetzt;
  assert.equal(ctx.neuGeladen, true, "nach 30 min im Hintergrund neu geladen");
  console.log("alle Bridge-Tests grün");
  process.exit(0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
