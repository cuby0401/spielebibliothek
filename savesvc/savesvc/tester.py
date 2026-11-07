"""Tester-Panel (Zentrale 1.4.0, E76): Tester prüfen eine neue Version auf dem Testserver nach genauer Anleitung.

- Den Testplan schreibt Claude ins Repo: tests/manuell/<Version>.json. Er kommt mit jedem Probe-Bau mit
  (scripts/teststand.sh bindet den Ordner als /testplan ein) – dafür braucht es keinen Zugriff aufs Live-System.
- Die Ergebnisse liegen in einer eigenen kleinen Datenbank außerhalb der Probe-Daten (/tests/ergebnisse.db,
  auf der NAS /volume1/docker/spielebibliothek-tests). Sie überstehen damit jeden Neubau der Probe.
- Nur aktiv, wenn TESTPLAN_DIR gesetzt ist (Probe und Teststand). Live gibt es die Endpunkte nicht (404).
- Wer den Testserver erreicht, ist Tester: Den Zugang regelt die Access-Anwendung „Spielebibliothek Test“.

Testplan-Format:
  {"version": "1.4.0", "hinweis": "…",
   "tests": [{"id": "konto-leiste", "bereich": "Konto", "titel": "…", "schritte": ["…", "…"], "erwartet": "…"}]}
"""

import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException

ID_MUSTER = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
VERSION_MUSTER = re.compile(r"^\d+\.\d+\.\d+$")


def plan_laden(ordner: Path, version: str) -> dict | None:
    """Testplan dieser Version; fehlt er, der neueste vorhandene. Ungültige Einträge werden übersprungen."""
    if not ordner.is_dir():
        return None
    datei = ordner / f"{version}.json" if VERSION_MUSTER.match(version or "") else None
    if not datei or not datei.is_file():
        kandidaten = sorted((p for p in ordner.glob("*.json") if VERSION_MUSTER.match(p.stem)),
                            key=lambda p: tuple(int(x) for x in p.stem.split(".")))
        if not kandidaten:
            return None
        datei = kandidaten[-1]
    try:
        roh = json.loads(datei.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    tests = []
    for t in roh.get("tests", []):
        if not isinstance(t, dict) or not ID_MUSTER.match(str(t.get("id", ""))):
            continue
        tests.append({"id": t["id"], "bereich": str(t.get("bereich", ""))[:60], "titel": str(t.get("titel", ""))[:200],
                      "schritte": [str(s)[:500] for s in t.get("schritte", []) if isinstance(s, str)][:30],
                      "erwartet": str(t.get("erwartet", ""))[:800], "hinweis": str(t.get("hinweis", ""))[:500]})
    return {"version": datei.stem, "hinweis": str(roh.get("hinweis", ""))[:1000], "tests": tests}


class Ergebnisse:
    def __init__(self, pfad: Path):
        self.pfad = pfad
        pfad.parent.mkdir(parents=True, exist_ok=True)
        with self.verbindung() as v:
            v.executescript("""
                CREATE TABLE IF NOT EXISTS ergebnisse (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, commit_ TEXT NOT NULL, test TEXT NOT NULL,
                    player TEXT NOT NULL, ok INTEGER NOT NULL, text TEXT, zeit TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS ergebnisse_version ON ergebnisse (version, commit_);""")

    @contextmanager
    def verbindung(self):
        v = sqlite3.connect(self.pfad, timeout=10)
        v.row_factory = sqlite3.Row
        try:
            with v:
                yield v
        finally:
            v.close()

    def eintragen(self, version: str, commit: str, test: str, player: str, ok: bool, text: str) -> None:
        with self.verbindung() as v:
            v.execute("INSERT INTO ergebnisse (version, commit_, test, player, ok, text, zeit) VALUES (?,?,?,?,?,?,?)",
                      (version, commit, test, player, 1 if ok else 0, text,
                       datetime.now(timezone.utc).isoformat(timespec="seconds")))

    def liste(self, version: str, commit: str) -> list[dict]:
        """Je Test und Tester nur das neueste Ergebnis (man kann nachtesten), älteste zuerst."""
        with self.verbindung() as v:
            zeilen = v.execute("""SELECT * FROM ergebnisse WHERE id IN (
                                      SELECT MAX(id) FROM ergebnisse WHERE version=? AND commit_=? GROUP BY test, player)
                                  ORDER BY id""", (version, commit)).fetchall()
        return [{"test": z["test"], "player": z["player"], "ok": bool(z["ok"]), "text": z["text"] or "", "zeit": z["zeit"]} for z in zeilen]


def zusammenfassung(plan: dict, ergebnisse: list[dict]) -> dict:
    """Je Test: bestanden (mind. ein OK, kein offenes Nein), fehlgeschlagen (neuestes Ergebnis eines Testers ist Nein), offen."""
    je_test: dict[str, list[dict]] = {}
    for x in ergebnisse:
        je_test.setdefault(x["test"], []).append(x)
    bestanden = fehlgeschlagen = 0
    for t in plan["tests"]:
        liste = je_test.get(t["id"], [])
        if any(not x["ok"] for x in liste):
            fehlgeschlagen += 1
        elif liste:
            bestanden += 1
    return {"gesamt": len(plan["tests"]), "bestanden": bestanden, "fehlgeschlagen": fehlgeschlagen,
            "offen": len(plan["tests"]) - bestanden - fehlgeschlagen}


def einrichten(app: FastAPI, e, spieler) -> None:
    ordner = os.environ.get("TESTPLAN_DIR")
    if not ordner:
        return
    ordner = Path(ordner)
    erg = Ergebnisse(Path(os.environ.get("TESTERGEBNISSE", "/tests/ergebnisse.db")))
    commit = e.zentrale_commit or "?"

    def plan_oder_404() -> dict:
        p = plan_laden(ordner, e.zentrale_version)
        if not p:
            raise HTTPException(404, "Für diese Version gibt es noch keinen Testplan")
        return p

    @app.get("/api/tester/plan")
    def plan(player: str = Depends(spieler)):
        p = plan_oder_404()
        liste = erg.liste(p["version"], commit)
        return {**p, "commit": commit, "ich": player, "ergebnisse": liste, "zusammenfassung": zusammenfassung(p, liste)}

    @app.post("/api/tester/ergebnis", status_code=204)
    def ergebnis(player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        p = plan_oder_404()
        test = body.get("test")
        if test not in {t["id"] for t in p["tests"]}:
            raise HTTPException(404, "Diesen Test gibt es nicht")
        ok = body.get("ok")
        if not isinstance(ok, bool):
            raise HTTPException(422, "ok: true oder false")
        text = body.get("text") if isinstance(body.get("text"), str) else ""
        text = text.strip()[:2000]
        if not ok and len(text) < 5:
            raise HTTPException(422, "Bitte kurz beschreiben, was falsch lief")
        erg.eintragen(p["version"], commit, test, player, ok, text)
