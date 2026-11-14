// Findet Startwerte (seeds), deren Klondike-Verteilung (1 Karte ziehen, beliebig oft durchgehen) lösbar ist.
// Mischen und Geben MÜSSEN exakt wie im Spiel sein (zufallZahlen + geben in index.html).
const ANZAHL = Number(process.argv[2] || 800);
const LIMIT = 150000;

function zufallZahlen(seed) {           // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
function mischenMit(seed) {
  const z = zufallZahlen(seed);
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = z() % (i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
const rang = (id) => (id % 13) + 1, farbe = (id) => Math.floor(id / 13), rot = (id) => farbe(id) === 1 || farbe(id) === 2;

function loesbar(start) {
  const d = start.slice();
  const tab = [[], [], [], [], [], [], []], zu = [0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 7; r++) for (let t = r; t < 7; t++) tab[t].push(d.pop());
  for (let t = 0; t < 7; t++) zu[t] = t;              // Anzahl verdeckter Karten
  // Talon in Ziehreihenfolge: das Spiel zieht mit pop() vom Ende
  const talon = d.slice().reverse();
  const found = [0, 0, 0, 0];
  const gesehen = new Set();
  let knoten = 0;

  const passtTab = (id, t) => {
    const s = tab[t];
    if (!s.length) return rang(id) === 13;
    const o = s[s.length - 1];
    return rot(o) !== rot(id) && rang(o) === rang(id) + 1;
  };
  const schluessel = () => found.join(",") + "|" + talon.join(".") + "|" + tab.map((s, i) => zu[i] + ":" + s.join(".")).sort().join("/");

  function suche() {
    if (found[0] + found[1] + found[2] + found[3] === 52) return true;
    if (++knoten > LIMIT) return false;
    const k = schluessel();
    if (gesehen.has(k)) return false;
    gesehen.add(k);

    // 1. auf die Ablage (Tableau)
    for (let t = 0; t < 7; t++) {
      const s = tab[t]; if (!s.length) continue;
      const id = s[s.length - 1];
      if (found[farbe(id)] === rang(id) - 1) {
        s.pop(); found[farbe(id)]++;
        const aufgedeckt = zu[t] > 0 && zu[t] === s.length; if (aufgedeckt) zu[t]--;
        if (suche()) return true;
        if (aufgedeckt) zu[t]++; found[farbe(id)]--; s.push(id);
      }
    }
    // 2. Talon auf die Ablage
    for (let i = 0; i < talon.length; i++) {
      const id = talon[i];
      if (found[farbe(id)] === rang(id) - 1) {
        talon.splice(i, 1); found[farbe(id)]++;
        if (suche()) return true;
        found[farbe(id)]--; talon.splice(i, 0, id);
      }
    }
    // 3. Tableau zu Tableau
    for (let t = 0; t < 7; t++) {
      const s = tab[t];
      for (let k = zu[t]; k < s.length; k++) {
        const id = s[k];
        const ganz = k === zu[t];
        if (ganz && k === 0 && rang(id) === 13) continue;     // König von leerer Spalte weg bringt nichts
        if (!ganz) {                                          // Teilstapel nur, wenn die Karte darunter danach auf die Ablage kann
          const u = s[k - 1];
          if (found[farbe(u)] !== rang(u) - 1) continue;
        }
        for (let z = 0; z < 7; z++) {
          if (z === t || !passtTab(id, z)) continue;
          if (!tab[z].length && rang(id) !== 13) continue;
          const teil = s.splice(k);
          tab[z].push(...teil);
          const aufgedeckt = zu[t] > 0 && zu[t] === s.length; if (aufgedeckt) zu[t]--;
          if (suche()) return true;
          if (aufgedeckt) zu[t]++;
          tab[z].splice(tab[z].length - teil.length);
          s.push(...teil);
          if (!tab[z].length) break;                          // in eine leere Spalte reicht ein Versuch
        }
      }
    }
    // 4. Talon aufs Tableau
    for (let i = 0; i < talon.length; i++) {
      const id = talon[i];
      for (let z = 0; z < 7; z++) {
        if (!passtTab(id, z)) continue;
        talon.splice(i, 1); tab[z].push(id);
        if (suche()) return true;
        tab[z].pop(); talon.splice(i, 0, id);
        if (!tab[z].length) break;
      }
    }
    return false;
  }
  return suche();
}

const gefunden = [];
let versucht = 0;
for (let seed = 1; gefunden.length < ANZAHL; seed++) {
  versucht++;
  if (loesbar(mischenMit(seed))) gefunden.push(seed);
}
console.error(`versucht ${versucht}, lösbar ${gefunden.length}`);
console.log(JSON.stringify(gefunden));
