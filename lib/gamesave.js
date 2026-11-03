// GameSave – Speicher-API für Spiele der Spielebibliothek
// Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/GameSave-Bibliothek
//
// STAND PHASE 1: nur der Fallback „außerhalb der Bibliothek“.
// Alles liegt im Arbeitsspeicher und ist nach dem Neuladen weg, available = false.
// (Im sandboxed iframe gibt es kein echtes localStorage – Zugriff wirft SecurityError.)
// Ab Phase 4 spricht GameSave per postMessage mit lib/bridge.js der Bibliotheksseite.

(function () {
  "use strict";

  const speicher = new Map();
  const scores = [];

  function kopie(wert) {
    return wert === undefined ? null : JSON.parse(JSON.stringify(wert));
  }

  function pruefeKey(key) {
    if (typeof key !== "string" || !key || key.length > 100) {
      throw new Error("GameSave: key muss ein nicht-leerer Text (max. 100 Zeichen) sein");
    }
  }

  const GameSave = {
    available: false,

    async save(key, data) {
      pruefeKey(key);
      speicher.set(key, { data: kopie(data), version: 1 });
    },

    async load(key) {
      pruefeKey(key);
      const e = speicher.get(key);
      return e ? { data: kopie(e.data), version: e.version } : { data: null, version: null };
    },

    async remove(key) {
      pruefeKey(key);
      speicher.delete(key);
    },

    async submitScore(score) {
      if (typeof score !== "number" || !isFinite(score)) {
        throw new Error("GameSave: score muss eine Zahl sein");
      }
      scores.push({ player: "lokal", score });
    },

    async leaderboard() {
      const best = scores.reduce((m, s) => Math.max(m, s.score), -Infinity);
      return scores.length ? [{ player: "lokal", score: best }] : [];
    },

    async player() {
      return "lokal";
    },
  };

  Object.freeze(GameSave);
  window.GameSave = GameSave;
})();
