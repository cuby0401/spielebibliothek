"""Interne Schnittstelle des Speicher-Dienstes für den Upload-Dienst (Versionierung, E35–E37).

Nur im Docker-Netz erreichbar: Caddy leitet für games.cuby0401.uk nur /api/* an den Speicher-Dienst weiter,
/intern/* landet dort im Datei-Server (404). Zusätzlich ist das geheime INTERN_TOKEN nötig.

Der Upload-Dienst verwaltet die Dateien, der Speicher-Dienst die Datenbank. Für das Update-Fenster braucht der
Upload-Dienst Testergebnisse aus der Datenbank, für Veröffentlichen und Rollback muss er dort etwas ändern.
"""

import hmac
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Query, Request

from . import games, identitaet, versionen


def registrieren(app: FastAPI, e, db, aktuelle_season) -> None:
    def intern(request: Request) -> None:
        if not e.intern_token or not hmac.compare_digest(request.headers.get("x-intern-token", ""), e.intern_token):
            raise HTTPException(403, "kein Zugriff")

    def sid(user: str, ordner: str) -> str:
        if not games.gueltige_id(user, ordner):
            raise HTTPException(422, "ungültige Spiel-ID")
        return f"{user}/{ordner}"

    @app.get("/intern/entwurf/{user}/{ordner}", dependencies=[Depends(intern)])
    def entwurf_stand(user: str = P(...), ordner: str = P(...), seit: str = Query(..., max_length=40)):
        """Was seit dem Hochladen des Entwurfs getestet wurde."""
        game = sid(user, ordner) + versionen.ENTWURF
        tests = db.entwurf_tests(game, seit)
        return {
            "geoeffnet": any(t["art"] == "geoeffnet" for t in tests),
            "migrationOk": sum(1 for t in tests if t["art"] == "migration" and t["ok"]),
            "migrationFehler": [t["text"] for t in tests if t["art"] == "migration" and not t["ok"]][:5],
            "fehler": db.fehler_seit(game, seit),
        }

    @app.post("/intern/entwurf/{user}/{ordner}/zuruecksetzen", status_code=204, dependencies=[Depends(intern)])
    def entwurf_zuruecksetzen(user: str = P(...), ordner: str = P(...)):
        db.entwurf_zuruecksetzen(sid(user, ordner) + versionen.ENTWURF)

    @app.post("/intern/season/{user}/{ordner}", dependencies=[Depends(intern)])
    def neue_season(user: str = P(...), ordner: str = P(...)):
        game = sid(user, ordner)
        neu = aktuelle_season(game) + 1
        db.spiel_setzen(game, season=neu)
        return {"season": neu}

    @app.post("/intern/spielstaende-zurueck/{user}/{ordner}", dependencies=[Depends(intern)])
    def spielstaende_zurueck(user: str = P(...), ordner: str = P(...), body: dict[str, Any] = Body(...)):
        bis = body.get("bisSaveVersion")
        if not isinstance(bis, int) or isinstance(bis, bool) or bis < 1:
            raise HTTPException(422, "bisSaveVersion: Zahl ab 1")
        return db.spielstaende_zurueckholen(sid(user, ordner), bis)

    @app.post("/intern/meldung", status_code=204, dependencies=[Depends(intern)])
    def meldung(body: dict[str, Any] = Body(...)):
        """Upload-Dienst meldet z. B. „Neues Spiel“ oder „Version 1.2.0“ an alle (Glocke, Zentrale 1.2.0)."""
        an, text, link = body.get("an"), body.get("text"), body.get("link")
        if not (isinstance(an, str) and an and isinstance(text, str) and text.strip()):
            raise HTTPException(422, "an und text nötig")
        if an.startswith("favoriten:"):   # Updates nur an Spieler, die das Spiel als Favorit haben
            db.melden_favoriten(an[len("favoriten:"):], text.strip(), link if isinstance(link, str) else None)
        else:
            # Der Upload-Dienst nennt Entwickler beim Ordnernamen → UUID (1.5.0); „*“ = an alle bleibt
            db.melden(an if an == "*" else identitaet.id_von_ordner(an), text.strip(), link if isinstance(link, str) else None)
