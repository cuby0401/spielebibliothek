"""Gemeinschafts-Funktionen (Zentrale 1.2.0): Spielzeit, Meldungen (Glocke), Erfolge, Profil, Spiel der Woche.

Simulierte Rollen („Ansicht als …“, IDs mit „~“) schreiben unter ihrer eigenen ID und zählen in keiner Statistik.
Entwürfe (…~entwurf) zählen keine Spielzeit und lösen keine Meldungen aus; Erfolge im Entwurf sind zum Testen da
und werden beim nächsten Entwurf/Veröffentlichen gelöscht.
"""

import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Query, Request

from . import games, rollen, versionen

SPIELZEIT_MAX_JE_MELDUNG = 120     # Sekunden – die Bibliothek meldet etwa jede Minute
SDW_TAGE = 7


def registrieren(app: FastAPI, e, db, spieler, spiel, ich_daten, benutzerliste, aktuelle_season) -> None:
    takt: dict[tuple[str, str], list[float]] = {}

    def admin(request: Request, player: str = Depends(spieler)) -> str:
        if not rollen.rolle(e, request, player)["admin"]:
            raise HTTPException(403, "nur für Admins")
        return player

    def echt(player: str) -> bool:
        return "~" not in player

    def titel(game_id: str) -> str:
        try:
            b, o = game_id.split("/", 1)
            return games.beschreibung(e.spiele_dir, b, o)["title"]
        except (ValueError, OSError):
            return game_id

    # ---------- Spielzeit ----------

    @app.post("/api/spielzeit/{user}/{game}", status_code=204)
    def spielzeit(player: str = Depends(ich_daten), sp=Depends(spiel), body: dict[str, Any] = Body(...)):
        sek = body.get("sekunden")
        if not isinstance(sek, int) or isinstance(sek, bool) or not 1 <= sek <= SPIELZEIT_MAX_JE_MELDUNG:
            raise HTTPException(422, f"sekunden: 1 bis {SPIELZEIT_MAX_JE_MELDUNG}")
        if sp[0].endswith(versionen.ENTWURF):
            return
        # gegen Hochzählen per Skript: höchstens ~2,5 Minuten Spielzeit je Minute und Spiel
        jetzt = time.monotonic()
        liste = [t for t in takt.get((player, sp[0]), []) if jetzt - t < 60]
        if len(liste) >= 3:
            raise HTTPException(429, "zu viele Meldungen")
        takt[(player, sp[0])] = liste + [jetzt]
        db.spielzeit_dazu(player, sp[0], sek, body.get("neu") is True)

    # ---------- Meldungen (Glocke) ----------

    @app.get("/api/meldungen")
    def meldungen(player: str = Depends(ich_daten), archiv: bool = Query(False)):
        return db.meldungen(player, 50 if archiv else 30, archiv)

    @app.post("/api/meldungen/{meldung_id}/archivieren", status_code=204)
    def archivieren(player: str = Depends(ich_daten), meldung_id: int = P(...)):
        if not db.meldung_ablegen(player, meldung_id, "archiv"):
            raise HTTPException(404, "Meldung nicht gefunden")

    @app.post("/api/meldungen/{meldung_id}/zurueck", status_code=204)
    def zurueckholen(player: str = Depends(ich_daten), meldung_id: int = P(...)):
        db.meldung_zurueck(player, meldung_id)

    @app.delete("/api/meldungen/{meldung_id}", status_code=204)
    def loeschen(player: str = Depends(ich_daten), meldung_id: int = P(...)):
        if not db.meldung_ablegen(player, meldung_id, "geloescht"):
            raise HTTPException(404, "Meldung nicht gefunden")

    @app.post("/api/meldungen/alle-archivieren")
    def alle_archivieren(player: str = Depends(ich_daten)):
        return {"archiviert": db.meldung_ablegen(player, None, "archiv")}

    @app.post("/api/meldungen/gelesen", status_code=204)
    def gelesen(player: str = Depends(ich_daten)):
        db.meldungen_gelesen(player)

    # ---------- Erfolge ----------

    @app.get("/api/erfolge/{user}/{game}")
    def erfolge_spiel(player: str = Depends(ich_daten), sp=Depends(spiel)):
        definiert = games.erfolge(sp[1])
        frei = {x["erfolg"]: x["zeit"] for x in db.erfolge_von(player, sp[0])}
        return [{**d, "freigeschaltet": frei.get(d["id"]),
                 **({"titel": "???", "beschreibung": "Geheimer Erfolg", "bild": None} if d["geheim"] and d["id"] not in frei else {})}
                for d in definiert]

    @app.post("/api/erfolg/{user}/{game}")
    def erfolg(player: str = Depends(ich_daten), sp=Depends(spiel), body: dict[str, Any] = Body(...)):
        eid = body.get("id")
        d = next((x for x in games.erfolge(sp[1]) if x["id"] == eid), None)
        if not d:
            raise HTTPException(422, f"Erfolg {eid!r} steht nicht in der game.json unter \"erfolge\"")
        neu = db.erfolg_freischalten(player, sp[0], eid)
        if neu and echt(player) and not sp[0].endswith(versionen.ENTWURF):
            db.melden(player, f"Erfolg in „{titel(sp[0])}“: {d['titel']}", f"#/spiel/{sp[0]}")
        return {"neu": neu, "erfolg": d}

    # ---------- Profil ----------

    @app.get("/api/profil/{name}")
    def profil(request: Request, player: str = Depends(spieler), name: str = P(...)):
        if name not in benutzerliste.namen() and name != rollen.daten_id(e, request, player):
            raise HTTPException(404, "Spieler nicht gefunden")
        einst = db.spiel_einstellungen()
        ist_admin = rollen.rolle(e, request, player)["admin"]
        # Testspiele zählen nie (auch nicht für Admins) – sie sind keine Spiele (E38)
        sichtbar = {s["id"]: s for s in games.alle(e.spiele_dir)
                    if not einst.get(s["id"], {}).get("testspiel")
                    and (ist_admin or not (einst.get(s["id"], {}).get("versteckt") or einst.get(s["id"], {}).get("offline")))}
        zeit = db.spielzeit_von(name)
        erf: dict[str, list] = {}
        for x in db.erfolge_von(name):
            erf.setdefault(x["game"], []).append(x)
        spiele = []
        for sid in sorted(set(zeit) | set(erf) | set(db.zuletzt_gespielt(name))):
            s = sichtbar.get(sid)
            if not s:
                continue
            definiert = {d["id"]: d for d in games.erfolge(e.spiele_dir / sid)}
            platz = None
            if s["leaderboard"]["enabled"]:
                for eintrag in db.bestenliste(sid, aktuelle_season(sid), s["leaderboard"]["order"] == "asc", 1000):
                    if eintrag["player"] == name:
                        platz = eintrag["rank"]; break
            spiele.append({"id": sid, "title": s["title"], "sekunden": zeit.get(sid, {}).get("sekunden", 0),
                           "platz": platz, "erfolgeGesamt": len(definiert),
                           "erfolge": [{**definiert[x["erfolg"]], "zeit": x["zeit"]} for x in erf.get(sid, []) if x["erfolg"] in definiert]})
        spiele.sort(key=lambda x: -x["sekunden"])
        # Profilkopf (Zentrale 1.4.0): nur, was ohnehin öffentlich ist – Anzeigename, Rollen, dabei seit. Kein Klarname, kein Geburtstag.
        person = rollen.QUELLE.person(name) if rollen.QUELLE is not None else None
        kopf = {"anzeigename": person.get("anzeigename") or None,
                "rollen": [r for r in ("admin", "entwickler", "tester", "spieler") if r in (person.get("rollen") or [])],
                "dabeiSeit": person.get("angelegt")} if person else {"anzeigename": None, "rollen": [], "dabeiSeit": None}
        return {"name": name, "sekunden": sum(x["sekunden"] for x in spiele), "spiele": spiele,
                "erfolge": sum(len(x["erfolge"]) for x in spiele), "ich": name == rollen.daten_id(e, request, player), **kopf}

    # ---------- Spiel der Woche ----------

    def sdw_daten() -> dict | None:
        a = db.sdw_aktuell()
        if not a:
            return None
        try:
            b, o = a["game"].split("/", 1)
            s = games.beschreibung(e.spiele_dir, b, o)
        except (ValueError, OSError):
            return None
        lb = s["leaderboard"]
        top = db.bestenliste_zeitraum(a["game"], a["start"], a["ende"], lb["order"] == "asc", 5) if lb["enabled"] else []
        return {"id": a["game"], "title": s["title"], "start": a["start"], "ende": a["ende"], "bestenliste": top,
                "label": lb["label"], "format": lb["format"]}

    app.state.sdw_daten = sdw_daten

    @app.get("/api/spiel-der-woche")
    def spiel_der_woche(_: str = Depends(spieler)):
        return sdw_daten()

    @app.put("/api/admin/spiel-der-woche/{user}/{game}")
    def sdw_setzen(_: str = Depends(admin), user: str = P(...), game: str = P(...)):
        ordner = games.spielordner(e.spiele_dir, user, game)
        if not ordner:
            raise HTTPException(404, "Spiel nicht gefunden")
        if not games.bestenliste_einstellungen(ordner)["enabled"]:
            raise HTTPException(409, "Spiel der Woche braucht eine Bestenliste")
        start = datetime.now(timezone.utc)
        db.sdw_setzen(f"{user}/{game}", start.isoformat(timespec="seconds"),
                      (start + timedelta(days=SDW_TAGE)).isoformat(timespec="seconds"))
        db.melden("*", f"Spiel der Woche: „{titel(f'{user}/{game}')}“ – eigene Bestenliste nur für diese Woche", f"#/spiel/{user}/{game}")
        return sdw_daten()

    @app.delete("/api/admin/spiel-der-woche", status_code=204)
    def sdw_beenden(_: str = Depends(admin)):
        db.sdw_beenden()
