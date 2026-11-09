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

Fotos (1.4.1, Seb): an jedes Ergebnis bis zu 5 Bilder (vor allem bei „Hat nicht geklappt“), in derselben Datenbank wie die
Ergebnisse. Sehen kann sie, wer den Test sehen darf; anfügen nur, wer das Ergebnis eingetragen hat.

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

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi import Path as P

from . import identitaet, rollen

BILDER_MAX = 5                    # Fotos je Ergebnis (1.4.1), je höchstens 2 MB – die Seite verkleinert vorher
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
                CREATE INDEX IF NOT EXISTS ergebnisse_version ON ergebnisse (version, commit_);
                CREATE TABLE IF NOT EXISTS bilder (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, ergebnis INTEGER NOT NULL, art TEXT NOT NULL, daten BLOB NOT NULL,
                    zeit TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS bilder_ergebnis ON bilder (ergebnis, id);""")

    @contextmanager
    def verbindung(self):
        v = sqlite3.connect(self.pfad, timeout=10)
        v.row_factory = sqlite3.Row
        try:
            with v:
                yield v
        finally:
            v.close()

    def eintragen(self, version: str, commit: str, test: str, player: str, ok: bool, text: str) -> int:
        with self.verbindung() as v:
            return v.execute("INSERT INTO ergebnisse (version, commit_, test, player, ok, text, zeit) VALUES (?,?,?,?,?,?,?)",
                      (version, commit, test, player, 1 if ok else 0, text,
                       datetime.now(timezone.utc).isoformat(timespec="seconds"))).lastrowid

    def ergebnis(self, ergebnis_id: int) -> dict | None:
        with self.verbindung() as v:
            z = v.execute("SELECT version, test, player FROM ergebnisse WHERE id=?", (ergebnis_id,)).fetchone()
        return dict(z) if z else None

    def bild_anlegen(self, ergebnis_id: int, art: str, daten: bytes, maximal: int) -> int | None:
        with self.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            if v.execute("SELECT COUNT(*) FROM bilder WHERE ergebnis=?", (ergebnis_id,)).fetchone()[0] >= maximal:
                return None
            return v.execute("INSERT INTO bilder (ergebnis, art, daten, zeit) VALUES (?,?,?,?)",
                             (ergebnis_id, art, daten, datetime.now(timezone.utc).isoformat(timespec="seconds"))).lastrowid

    def bild(self, bild_id: int) -> tuple[int, str, bytes] | None:
        with self.verbindung() as v:
            z = v.execute("SELECT ergebnis, art, daten FROM bilder WHERE id=?", (bild_id,)).fetchone()
        return (z["ergebnis"], z["art"], z["daten"]) if z else None

    def liste(self, version: str) -> list[dict]:
        """Alle Ergebnisse dieser Version (über alle Commits), älteste zuerst – gefiltert wird mit gueltige()."""
        with self.verbindung() as v:
            zeilen = v.execute("SELECT * FROM ergebnisse WHERE version=? ORDER BY id", (version,)).fetchall()
            bilder: dict[int, list[int]] = {}
            for b in v.execute("SELECT b.id, b.ergebnis FROM bilder b JOIN ergebnisse e ON e.id = b.ergebnis WHERE e.version=? "
                               "ORDER BY b.id", (version,)):
                bilder.setdefault(b["ergebnis"], []).append(b["id"])
        # Gespeichert ist der Spieleordner (1.5.0, ändert sich nie und übersteht Neubauten des Testservers, deren Kopien vor dem
        # Live-Gang von 1.5.0 jedes Mal neue UUIDs bekämen). Nach außen die UUID → die Antwort-Schicht zeigt das Handle.
        return [{"id": z["id"], "test": z["test"], "player": identitaet.id_von_ordner(z["player"]), "ok": bool(z["ok"]), "text": z["text"] or "",
                 "zeit": z["zeit"], "commit": z["commit_"], "bilder": bilder.get(z["id"], [])} for z in zeilen]


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
        alle = [x for x in erg.liste(p["version"]) if x["test"] in sichtbar]
        liste = gueltige(p, alle)
        # verlauf (1.4.1): alle Einträge, auch ältere und vor einem Nachtest – fürs Archiv „wer hat wann geprüft“
        return {**p, "commit": commit, "ich": player, "admin": admin, "ergebnisse": liste, "verlauf": alle,
                "zusammenfassung": zusammenfassung(p, liste)}

    @app.post("/api/tester/ergebnis", status_code=201)
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
        return {"id": erg.eintragen(p["version"], commit, test, identitaet.ordner(player), ok, text)}

    def darf_sehen(request: Request, player: str, ergebnis_id: int) -> dict:
        x = erg.ergebnis(ergebnis_id)
        p = fuer(plan_oder_404(), rollen.rolle(e, request, player)["admin"])
        if not x or x["test"] not in {t["id"] for t in p["tests"]}:
            raise HTTPException(404, "Ergebnis nicht gefunden")
        return x

    @app.post("/api/tester/ergebnis/{ergebnis_id}/bilder", status_code=201)
    def bild_dazu(request: Request, player: str = Depends(spieler), ergebnis_id: int = P(...), body: dict[str, Any] = Body(...)):
        from . import steckbrief
        from .verwaltung import bild_aus_daten_url
        if darf_sehen(request, player, ergebnis_id)["player"] != identitaet.ordner(player):
            raise HTTPException(403, "Bilder kann nur anfügen, wer das Ergebnis eingetragen hat")
        try:
            art, daten = bild_aus_daten_url(body.get("bild"))
        except steckbrief.UngueltigesBild as f:
            raise HTTPException(422, str(f)) from None
        bid = erg.bild_anlegen(ergebnis_id, art, daten, BILDER_MAX)
        if bid is None:
            raise HTTPException(409, f"Schon {BILDER_MAX} Bilder an diesem Ergebnis")
        return {"id": bid}

    @app.get("/api/tester/bild/{bild_id}")
    def bild_zeigen(request: Request, player: str = Depends(spieler), bild_id: int = P(...)):
        from . import steckbrief
        b = erg.bild(bild_id)
        if not b:
            raise HTTPException(404, "Bild nicht gefunden")
        darf_sehen(request, player, b[0])
        return Response(b[2], media_type=steckbrief.ARTEN[b[1]],
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "default-src 'none'; sandbox"})
