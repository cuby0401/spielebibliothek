"""Speicher-Dienst der Spielebibliothek (FastAPI).

Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Speicher-Dienst
{user}/{game} in der URL ist die Spiel-ID, der Spieler kommt immer aus dem JWT.
"""

import logging
import math
import threading
import time
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Query, Request
from fastapi.responses import JSONResponse

from . import games, rollen
from .auth import Benutzerliste, Pruefer
from .config import Einstellungen, laden
from .db import Datenbank, ZuGross

KEY_MUSTER = r"^[A-Za-z0-9_][A-Za-z0-9._:-]{0,99}$"
BODY_MAX = 300 * 1024
SCORE_ABSTAND = 1.0       # Sekunden zwischen zwei Scores je Spieler und Spiel
SCORE_MAX = 1e15          # Betrag; schützt nur vor Unsinn, nicht vor Schummeln (Kollegen-Vertrauen)


def zahl_ok(x) -> bool:
    return not isinstance(x, bool) and isinstance(x, (int, float)) and math.isfinite(x) and abs(x) <= SCORE_MAX


def pruefe_werte(werte, lb: dict) -> dict:
    """Zusatzwerte zum Score: nur in game.json deklarierte Spalten, Zahlen bzw. kurzer Text."""
    if werte is None:
        return {}
    if not isinstance(werte, dict):
        raise HTTPException(422, "werte muss ein Objekt sein")
    erlaubt = {s["key"]: s["format"] for s in lb["spalten"]}
    unbekannt = sorted(set(werte) - set(erlaubt))
    if unbekannt:
        raise HTTPException(422, f"unbekannte Spalten {unbekannt} – in game.json unter leaderboard.spalten eintragen")
    sauber = {}
    for k, v in werte.items():
        if erlaubt[k] == "text":
            if not isinstance(v, str) or len(v) > 40:
                raise HTTPException(422, f"{k}: Text mit höchstens 40 Zeichen erwartet")
        elif not zahl_ok(v):
            raise HTTPException(422, f"{k}: Zahl erwartet")
        sauber[k] = v
    return sauber


def erstellen(einstellungen: Einstellungen | None = None, schluessel_quelle=None) -> FastAPI:
    e = einstellungen or laden()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if e.dev_user:
        logging.getLogger("savesvc").warning("DEV_USER=%s – Anmeldung wird übersprungen (nur lokal!)", e.dev_user)

    db = Datenbank(e.db_path)
    if e.backup_ziel:
        from . import sicherung
        sicherung.starten(db, e.backup_ziel, e.backup_uhrzeit)
    benutzerliste = Benutzerliste(e.users_file)
    spieler = Pruefer(e, benutzerliste, schluessel_quelle)
    app = FastAPI(title="Spielebibliothek – Speicher-Dienst", docs_url=None, redoc_url=None, openapi_url=None)

    def spiel(user: str = P(...), game: str = P(...)):
        ordner = games.spielordner(e.spiele_dir, user, game)
        if not ordner:
            raise HTTPException(404, "Spiel nicht gefunden")
        return f"{user}/{game}", ordner

    @app.middleware("http")
    async def body_grenze(request, weiter):
        # Riesige Anfragen gar nicht erst einlesen (Spielstand max. 256 KB + JSON-Hülle)
        laenge = request.headers.get("content-length")
        if laenge and laenge.isdigit() and int(laenge) > BODY_MAX:
            return JSONResponse({"detail": "Anfrage zu groß"}, status_code=413)
        # CSRF: Cloudflare hängt die Anmeldung an jede Anfrage an games – auch an eine, die eine fremde
        # Seite auslöst. Ändernde Anfragen brauchen deshalb diesen Header (fremde Seiten können ihn nicht setzen).
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.headers.get("x-bibliothek") != "1":
            return JSONResponse({"detail": "Header X-Bibliothek fehlt"}, status_code=403)
        return await weiter(request)

    @app.exception_handler(ZuGross)
    async def zu_gross(_, fehler: ZuGross):
        return JSONResponse({"detail": str(fehler)}, status_code=413)

    def ich_daten(request: Request, player: str = Depends(spieler)) -> str:
        return rollen.daten_id(e, request, player)

    def aktuelle_season(game_id: str, ordner=None) -> int:
        # game.json oder – falls höher – per Knopf gesetzte Season (Entwickler/Admin)
        ordner = ordner or e.spiele_dir / game_id
        return max(games.season(ordner), db.season_override(game_id) or 0)

    @app.get("/api/me")
    def me(request: Request, player: str = Depends(spieler)):
        # Entwickler = hat einen eigenen Spielordner (wird beim Anlegen des Upload-Kontos erzeugt).
        # „Ansicht als …“ (rollen.py): echte Admins können Spieler- oder Entwickler-Sicht simulieren.
        r = rollen.rolle(e, request, player)
        return {"player": player, "uploader": r["uploader"], "admin": r["admin"],
                "ansicht": r["ansicht"], "echterAdmin": r["echterAdmin"]}

    @app.get("/api/games")
    def spiele(request: Request, player: str = Depends(spieler)):
        einst = db.spiel_einstellungen()
        zuletzt = db.zuletzt_gespielt(rollen.daten_id(e, request, player))
        ist_admin = rollen.rolle(e, request, player)["admin"]
        ergebnis = []
        for s in games.alle(e.spiele_dir):
            ein = einst.get(s["id"], {})
            if ein.get("versteckt") and not ist_admin:
                continue   # ausgeblendet (nur Anzeige – die Dateien bleiben unter play erreichbar)
            ergebnis.append({**s, "leaderboardSeason": aktuelle_season(s["id"]),
                             "versteckt": bool(ein.get("versteckt")), "hervorgehoben": bool(ein.get("hervorgehoben")),
                             "zuletztGespielt": zuletzt.get(s["id"])})
        return ergebnis

    @app.get("/api/save/{user}/{game}")
    def alle_keys(player: str = Depends(ich_daten), sp=Depends(spiel)):
        return {"keys": db.keys(player, sp[0])}

    @app.get("/api/save/{user}/{game}/{key}")
    def laden_(player: str = Depends(ich_daten), sp=Depends(spiel), key: str = P(..., pattern=KEY_MUSTER)):
        stand = db.laden(player, sp[0], key)
        if stand is None:
            raise HTTPException(404, "kein Spielstand")
        return stand

    @app.put("/api/save/{user}/{game}/{key}")
    def speichern(
        player: str = Depends(ich_daten),
        sp=Depends(spiel),
        key: str = P(..., pattern=KEY_MUSTER),
        body: dict[str, Any] = Body(...),
    ):
        if "data" not in body:
            raise HTTPException(422, "Feld data fehlt")
        return db.speichern(player, sp[0], key, body["data"], games.save_version(sp[1]))

    @app.delete("/api/save/{user}/{game}/{key}", status_code=204)
    def loeschen(player: str = Depends(ich_daten), sp=Depends(spiel), key: str = P(..., pattern=KEY_MUSTER)):
        db.loeschen(player, sp[0], key)

    # --- Bestenliste ---
    letzter_score: dict[tuple[str, str], float] = {}
    score_sperre = threading.Lock()

    @app.post("/api/score/{user}/{game}", status_code=201)
    def score(request: Request, player: str = Depends(spieler), sp=Depends(spiel), body: dict[str, Any] = Body(...)):
        if rollen.simuliert(e, request, player):
            raise HTTPException(409, "In der Ansicht als Spieler/Entwickler werden keine Bestenlisten-Einträge gespeichert")
        lb = games.bestenliste_einstellungen(sp[1])
        if not lb["enabled"]:
            raise HTTPException(409, "dieses Spiel hat keine Bestenliste")
        werte = pruefe_werte(body.get("werte"), lb)
        if lb["rangiertNach"] == "score":
            wert = body.get("score")
            if not zahl_ok(wert):
                raise HTTPException(422, "score muss eine endliche Zahl sein")
        else:
            wert = werte.get(lb["rangiertNach"])
            if not zahl_ok(wert):
                raise HTTPException(422, f"Wert {lb['rangiertNach']!r} (rangiertNach) fehlt oder ist keine Zahl")
        with score_sperre:
            jetzt = time.monotonic()
            if jetzt - letzter_score.get((player, sp[0]), -SCORE_ABSTAND) < SCORE_ABSTAND:
                raise HTTPException(429, "höchstens ein Score pro Sekunde")
            letzter_score[(player, sp[0])] = jetzt
        season = aktuelle_season(sp[0], sp[1])
        db.score_eintragen(player, sp[0], season, float(wert), werte)
        return {"season": season}

    @app.get("/api/leaderboard/{user}/{game}")
    def bestenliste(
        player: str = Depends(spieler),
        sp=Depends(spiel),
        season: int | None = Query(None, ge=1, le=1_000_000),
        limit: int = Query(10, ge=1, le=100),
    ):
        lb = games.bestenliste_einstellungen(sp[1])
        aktuell = aktuelle_season(sp[0], sp[1])
        gewaehlt = season or aktuell
        eintraege = db.bestenliste(sp[0], gewaehlt, lb["order"] == "asc", limit) if lb["enabled"] else []
        return {
            **lb,
            "season": gewaehlt,
            "currentSeason": aktuell,
            "seasons": sorted(set(db.seasons(sp[0])) | {aktuell}),
            "entries": eintraege,
        }

    from . import verwaltung
    verwaltung.registrieren(app, e, db, spieler, benutzerliste, aktuelle_season)

    return app


def app_factory() -> FastAPI:
    """Einstiegspunkt für uvicorn --factory."""
    return erstellen()
