"""Tester-Panel (Zentrale 1.4.0, E76): Tester prüfen eine neue Version auf dem Testserver nach genauer Anleitung.

- Den Testplan schreibt Claude ins Repo: tests/manuell/<Version>.json. Er kommt mit jedem Probe-Bau mit
  (scripts/teststand.sh bindet den Ordner als /testplan ein) – dafür braucht es keinen Zugriff aufs Live-System.
- Die Ergebnisse liegen in einer eigenen kleinen Datenbank außerhalb der Probe-Daten (/tests/ergebnisse.db,
  auf der NAS /volume1/docker/spielebibliothek-tests). Sie überstehen damit jeden Neubau der Probe.
- Nur aktiv, wenn TESTPLAN_DIR gesetzt ist (Probe und Teststand). Live gibt es die Endpunkte nicht (404).
- Wer den Testserver erreicht, ist Tester: Den Zugang regelt die Access-Anwendung „Spielebibliothek Test“.

Testplan-Format:
  {"version": "1.4.0", "hinweis": "…",
   "tests": [{"id": "konto-leiste", "bereich": "Konto", "titel": "…", "schritte": ["…", "…"], "erwartet": "…",
              "neuAb": "2026-11-08T12:00:00+00:00", "nurAdmin": false}]}

„nurAdmin“: Tests, die nur ein Admin machen kann (CRM, Not-Aus, Freigabe). Andere Tester sehen sie gar nicht und können
dafür nichts eintragen. Der Admin bekommt sie ganz oben (Seb, 08.11.2026: er ist der einzige Admin).

Ergebnisse gelten für die ganze Version, auch über neue Commits hinweg – sonst müsste nach jeder kleinen Korrektur
alles neu getestet werden. Ändert sich etwas an einem Test-Bereich, bekommt der Test „neuAb“ (Zeitpunkt, 1.4.0
nach Sebs Test am 08.11.2026): Ergebnisse davor zählen nicht mehr, der Test steht wieder auf offen.
"""

import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request

from . import rollen

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
                      "erwartet": str(t.get("erwartet", ""))[:800], "hinweis": str(t.get("hinweis", ""))[:500],
                      "neuAb": _zeitpunkt(t.get("neuAb")), "nurAdmin": t.get("nurAdmin") is True})
    return {"version": datei.stem, "hinweis": str(roh.get("hinweis", ""))[:1000], "tests": tests}


def _zeitpunkt(wert) -> str | None:
    """„neuAb“ als ISO-Zeit in UTC (wie die gespeicherten Ergebnisse) – sonst None."""
    if not isinstance(wert, str):
        return None
    try:
        d = datetime.fromisoformat(wert)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat(timespec="seconds")


def gueltige(plan: dict, ergebnisse: list[dict]) -> list[dict]:
    """Je Test und Tester das neueste Ergebnis – Ergebnisse vor „neuAb“ des Tests zählen nicht mehr."""
    neu_ab = {t["id"]: t.get("neuAb") for t in plan["tests"]}
    neueste: dict[tuple, dict] = {}
    for x in ergebnisse:                                    # älteste zuerst → spätere überschreiben
        ab = neu_ab.get(x["test"])
        if ab and _zeitpunkt(x["zeit"]) < ab:
            continue
        neueste[(x["test"], x["player"])] = x
    return sorted(neueste.values(), key=lambda x: x["zeit"])


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

    def liste(self, version: str) -> list[dict]:
        """Alle Ergebnisse dieser Version (über alle Commits), älteste zuerst – gefiltert wird mit gueltige()."""
        with self.verbindung() as v:
            zeilen = v.execute("SELECT * FROM ergebnisse WHERE version=? ORDER BY id", (version,)).fetchall()
        return [{"test": z["test"], "player": z["player"], "ok": bool(z["ok"]), "text": z["text"] or "", "zeit": z["zeit"],
                 "commit": z["commit_"]} for z in zeilen]


def fuer(plan: dict, admin: bool) -> dict:
    """Sicht eines Testers: ohne Admin-Tests; für den Admin stehen sie oben (Reihenfolge sonst wie im Plan)."""
    if admin:
        return {**plan, "tests": sorted(plan["tests"], key=lambda t: not t["nurAdmin"])}
    return {**plan, "tests": [t for t in plan["tests"] if not t["nurAdmin"]]}


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
    def plan(request: Request, player: str = Depends(spieler)):
        admin = rollen.rolle(e, request, player)["admin"]
        p = fuer(plan_oder_404(), admin)
        sichtbar = {t["id"] for t in p["tests"]}
        liste = [x for x in gueltige(p, erg.liste(p["version"])) if x["test"] in sichtbar]
        return {**p, "commit": commit, "ich": player, "admin": admin, "ergebnisse": liste,
                "zusammenfassung": zusammenfassung(p, liste)}

    @app.post("/api/tester/ergebnis", status_code=204)
    def ergebnis(request: Request, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        p = fuer(plan_oder_404(), rollen.rolle(e, request, player)["admin"])
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
