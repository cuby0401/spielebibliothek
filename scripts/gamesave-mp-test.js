// Testgerüst: GameSave.multiplayer.spiel mit zwei nachgestellten Tabs (lokaler Modus über BroadcastChannel)
// Aufruf: node scripts/gamesave-mp-test.js lib/gamesave.js
// Prüft den Zeitgeber frist() (1.6.0): löst beim Host aus, läuft nach einem Host-Wechsel weiter, keine Schleife;
// dazu den bisherigen Zustand als drittes Argument von neu() (Siegzähler).
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const code = fs.readFileSync(process.argv[2] || "lib/gamesave.js", "utf8");
const warte = (ms) => new Promise((ja) => setTimeout(ja, ms));

function tab() {
  const weg = [];
  const window = { name: "", location: { pathname: "/test" }, addEventListener: (t, f) => { if (t === "pagehide") weg.push(f); } };
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
  console.log("✓ GameSave.multiplayer: Zeitgeber und Siegzähler ok");
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
