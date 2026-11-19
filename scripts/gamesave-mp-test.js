// Testgerüst: GameSave.multiplayer.spiel mit zwei nachgestellten Tabs (lokaler Modus über BroadcastChannel)
// Aufruf: node scripts/gamesave-mp-test.js lib/gamesave.js
// Prüft die Bots (1.6.2) und den Zeitgeber frist() (1.6.0): löst beim Host aus, läuft nach einem Host-Wechsel weiter, keine Schleife;
// dazu den bisherigen Zustand als drittes Argument von neu() (Siegzähler).
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const code = fs.readFileSync(process.argv[2] || "lib/gamesave.js", "utf8");
const warte = (ms) => new Promise((ja) => setTimeout(ja, ms));

function tab(pfad = "/test") {
  const weg = [];
  const window = { name: "", location: { pathname: pfad }, addEventListener: (t, f) => { if (t === "pagehide") weg.push(f); } };
  window.parent = window;
  const ctx = vm.createContext({ window, location: window.location, BroadcastChannel, setTimeout, clearTimeout, console,
    JSON, Math, Date, Object, Array, Promise, Error, String, Number, isFinite, localStorage: undefined });
  ctx.self = window;
  vm.runInContext(code, ctx);
  return { GameSave: window.GameSave || ctx.GameSave, schliessen: () => weg.forEach((f) => f()) };
}

const FRIST = 400;
const regeln = {
  neu: (ids, opt, vorher) => ({ ids, zuege: 0, zeit: 0, siege: vorher ? vorher.siege + 1 : 0, bis: Date.now() + FRIST }),
  zug: (z, aktion, von) => {
    if (von === null) { z.zeit += 1; if (aktion && aktion.weiter) z.bis = Date.now() + FRIST; return z; }   // die Uhr
    z.zuege += 1; z.bis = Date.now() + FRIST; return z;
  },
  frist: (z) => ({ bis: z.bis, aktion: { weiter: z.zeit < 1 } }),   // zweiter Ablauf setzt keine neue Frist → darf nur einmal auslösen
};

(async () => {
  const a = tab(), b = tab();
  const sichtA = [], sichtB = [];
  const pa = a.GameSave.multiplayer.spiel(regeln, { zeigen: (s) => sichtA.push(s) });   // A betritt den Raum zuerst → Host
  await warte(50);
  const [sa, sb] = await Promise.all([pa, b.GameSave.multiplayer.spiel(regeln, { zeigen: (s) => sichtB.push(s) })]);
  assert.ok(sa.raum.istHost && !sb.raum.istHost, "der ältere Tab ist Host " + JSON.stringify([sa.raum.ich, sa.raum.host, sb.raum.ich, sb.raum.host]));

  sa.neu();
  assert.strictEqual(sa.raum.spieler.length, 2);
  await warte(FRIST / 2);
  sb.zug({});                                                       // ein Zug verschiebt die Frist
  await warte(FRIST / 2 + 50);
  assert.strictEqual(sichtA.at(-1).zeit, 0, "Frist wurde durch den Zug verschoben");
  await warte(FRIST);
  assert.strictEqual(sichtA.at(-1).zeit, 1, "Zeitgeber hat beim Host ausgelöst");
  assert.strictEqual(sichtB.at(-1).zeit, 1, "Gast sieht den Zug der Uhr");

  a.schliessen();                                                   // Host geht, B übernimmt den Stand mit laufender Uhr
  await warte(FRIST + 200);
  assert.ok(sb.raum.istHost, "B ist jetzt Host");
  assert.strictEqual(sichtB.at(-1).zeit, 2, "Uhr läuft nach dem Host-Wechsel weiter");
  await warte(FRIST + 100);
  assert.strictEqual(sichtB.at(-1).zeit, 2, "abgelaufene Frist ohne neuen Zeitpunkt löst nur einmal aus");

  sb.neu();
  assert.strictEqual(sichtB.at(-1).siege, 1, "neu() bekommt den bisherigen Zustand (Siegzähler)");
  b.schliessen();

  // ---------- Bots (1.6.2): ein Tab allein mit zwei Bots ----------
  const c = tab("/bots");
  const sichtC = [], gefragt = [];
  const reihum = {
    neu: (ids) => ({ ids, dran: 0, zuege: [] }),
    zug: (z, aktion, von) => {
      if (z.ids[z.dran] !== von) throw new Error("nicht dran");
      if (aktion !== "ok") throw new Error("ungültig");
      z.zuege.push(von); z.dran = (z.dran + 1) % z.ids.length; return z;
    },
    sicht: (z, fuer) => ({ ...z, ich: fuer }),
    bot: (sicht, stufe, id) => {
      gefragt.push([sicht.ich, stufe]);
      if (sicht.ids[sicht.dran] !== id) return null;
      return id === "bot~2" ? "kaputt" : "ok";     // Bot 2 liefert Unsinn → wird übersprungen, keine Schleife
    },
  };
  const sc = await c.GameSave.multiplayer.spiel(reihum, { zeigen: (s) => sichtC.push(s) });
  assert.strictEqual(JSON.stringify(sc.raum.botStufen), JSON.stringify(["leicht", "mittel", "schwer"]));
  sc.raum.botHinzufuegen("schwer");
  sc.raum.botHinzufuegen("leicht");
  await warte(50);
  assert.ok(sc.raum.mitBots && sc.raum.spieler.filter((s) => s.bot).length === 2, "zwei Bots im Raum");
  assert.ok(sc.raum.istHost, "ein Bot wird nie Host");
  sc.neu();
  const ich = sc.raum.ich;
  sc.zug("ok");                                                       // Mensch zieht, dann Bot 1
  await warte(1600);
  let z = sichtC.at(-1);
  assert.strictEqual(JSON.stringify(z.zuege), JSON.stringify([ich, "bot~1"]), "Bot 1 hat nach Denkzeit gezogen, Bot 2 hängt (abgelehnt)");
  assert.ok(gefragt.every(([fuer]) => fuer.startsWith("bot~")), "Bots bekommen nur ihre eigene Sicht");
  assert.ok(gefragt.some(([, st]) => st === "schwer") && gefragt.some(([, st]) => st === "leicht"), "Stufe kommt beim Bot an");
  await warte(1600);
  assert.strictEqual(sichtC.at(-1).zuege.length, 2, "abgelehnter Bot zieht nicht in einer Schleife weiter");
  sc.raum.botEntfernen("bot~2");
  await warte(50);
  assert.strictEqual(sc.raum.spieler.filter((s) => s.bot).length, 1, "Bot entfernt");
  console.log("✓ GameSave.multiplayer: Zeitgeber, Siegzähler und Bots ok");
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
