"""Aufgaben im Admin-Panel (Zentrale 1.3.0): Tests per Knopf oder Zeitplan, Live-Deploy nach Freigabe in der Probe.

Wer was darf – absichtlich streng getrennt:
  - Der Speicher-Dienst (hängt am Internet) legt nur AUFTRÄGE in die Datenbank: Art und Ziel aus einer festen Liste.
    Er hat keinen Zugriff auf Docker und kann selbst nichts ausführen.
  - Der Auftragsdienst (scripts/auftragsdienst.py) läuft als Cron-Job auf der NAS unter Sebi. Er holt Aufträge mit
    `docker exec … python -m savesvc auftraege-holen`, führt NUR die fest eingebauten Aufgaben aus und meldet das
    Ergebnis mit `… auftrag-fertig` zurück. Er nimmt nie Befehle, Pfade oder Parameter aus der Datenbank entgegen.
  - Live-Deploy nach Freigabe: Der Auftragsdienst prüft selbst die Freigabe in der Probe (freigabe.json) gegen den dort
    abgelegten, unveränderten Release-Stand (release.tar). Dafür gibt es keinen Auftrag – niemand kann ihn über das
    Admin-Panel auslösen.
"""

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P

ARTEN = {"unit-tests": "Unit-Tests", "e2e-tests": "Ende-zu-Ende-Tests"}
ZIELE = {"live": "Live-Stand", "probe": "Probe"}
ANZEIGE = {**ARTEN, "live-deploy": "Live-Deploy nach Freigabe"}
LEBENSZEICHEN_MAX = timedelta(minutes=10)
ZONE = ZoneInfo("Europe/Berlin")


def dienst_zustand(db) -> dict:
    """Läuft der Auftragsdienst? (Er meldet sich bei jedem Lauf, also jede Minute.)"""
    z = db.dienst("auftragsdienst")
    if not z:
        return {"eingerichtet": False, "aktiv": False, "zuletzt": None}
    alt = datetime.now(timezone.utc) - datetime.fromisoformat(z["zeit"])
    return {"eingerichtet": True, "aktiv": alt < LEBENSZEICHEN_MAX, "zuletzt": z["zeit"], "version": z["wert"]}


def planen(db, jetzt: datetime | None = None) -> list[int]:
    """Fällige Zeitplan-Einträge als Aufträge anlegen (jede Minute aus dem Planer-Thread)."""
    lokal = (jetzt or datetime.now(timezone.utc)).astimezone(ZONE)
    neu = []
    for z in db.zeitplan_faellig(lokal.strftime("%Y-%m-%d"), lokal.strftime("%H:%M")):
        aid = db.auftrag_anlegen(z["art"], z["ziel"], "plan", None)
        if aid:
            neu.append(aid)
    return neu


def planer_starten(db) -> threading.Thread:
    def schleife():
        while True:
            try:
                planen(db)
            except Exception:   # noqa: BLE001 – der Planer darf nie den Dienst stören
                pass
            time.sleep(60)
    t = threading.Thread(target=schleife, name="planer", daemon=True)
    t.start()
    return t


def registrieren(app: FastAPI, e, db, admin) -> None:
    if e.waechter:
        planer_starten(db)

    @app.get("/api/admin/auftraege")
    def uebersicht(_: str = Depends(admin)):
        return {"dienst": dienst_zustand(db), "arten": ARTEN, "ziele": ZIELE, "anzeige": ANZEIGE,
                "zeitplan": db.zeitplan(), "laeufe": db.auftraege(30)}

    @app.post("/api/admin/auftraege", status_code=201)
    def starten(admin_name: str = Depends(admin), body: dict[str, Any] = Body(...)):
        art, ziel = body.get("art"), body.get("ziel")
        if art not in ARTEN or ziel not in ZIELE:
            raise HTTPException(422, "unbekannte Aufgabe")
        aid = db.auftrag_anlegen(art, ziel, "knopf", admin_name)
        if aid is None:
            raise HTTPException(409, "Diese Aufgabe wartet schon oder läuft gerade")
        return {"id": aid}

    @app.get("/api/admin/auftraege/{auftrag_id}")
    def einzeln(_: str = Depends(admin), auftrag_id: int = P(...)):
        a = db.auftrag(auftrag_id)
        if not a:
            raise HTTPException(404, "Auftrag nicht gefunden")
        return a

    @app.put("/api/admin/zeitplan")
    def zeitplan(_: str = Depends(admin), body: dict[str, Any] = Body(...)):
        art, ziel, uhrzeit = body.get("art"), body.get("ziel"), body.get("uhrzeit")
        if art not in ARTEN or ziel not in ZIELE:
            raise HTTPException(422, "unbekannte Aufgabe")
        if uhrzeit is not None:
            try:
                uhrzeit = datetime.strptime(str(uhrzeit), "%H:%M").strftime("%H:%M")
            except ValueError:
                raise HTTPException(422, "uhrzeit: HH:MM") from None
        db.zeitplan_setzen(art, ziel, uhrzeit)
        return db.zeitplan()
