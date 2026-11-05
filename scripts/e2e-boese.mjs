// Sicherheitstest „Böse“ im Teststand: alle Angriffe müssen abgewehrt sein. Aufruf: node scripts/e2e-boese.mjs <ordner>
import { spawn } from "node:child_process";
import { setTimeout as warte } from "node:timers/promises";
const G = "http://<NAS_GH>:18088";
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${process.argv[2]}/chrome-profil2`, "--no-first-run", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());   // Chrome nie hängen lassen, auch bei Abbruch
let ws, nr = 0; const offen = new Map(); const rahmen = [];
const cdp = (method, params = {}, sessionId) => { const id = ++nr; ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return new Promise((ja) => offen.set(id, ja)); };
(async () => {
  let v = null;   // Chrome braucht unterschiedlich lange zum Start – bis zu 15 s warten
  for (let i = 0; i < 60 && !v; i++) { await warte(250); v = await fetch("http://127.0.0.1:9334/json/version").then((r) => r.json()).catch(() => null); }
  if (!v) throw new Error("Chrome startet nicht");
  ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) { offen.get(d.id)(d.result); offen.delete(d.id); }
    if (d.method === "Target.attachedToTarget" && d.params.targetInfo.type === "iframe") rahmen.push(d.params.sessionId); });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const S = (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, S);
  await cdp("Page.navigate", { url: G + "/#/spiel/seb/boese" }, S);
  await warte(12000);
  let gut = false;
  for (const r of rahmen) {
    const t = await cdp("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true }, r);
    if (t?.result?.value) {
      console.log(t.result.value.split("\n").filter((z) => /abgewehrt|✗|Angriffe/.test(z)).slice(0, 25).join("\n"));
      if (/alle \d+ Angriffe abgewehrt/.test(t.result.value)) gut = true;
    }
  }
  console.log(gut ? "✓ Böse: alles abgewehrt" : "✗ Böse: NICHT alles abgewehrt");
  chrome.kill(); process.exit(gut ? 0 : 1);
})();
