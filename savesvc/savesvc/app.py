"""Speicher-Dienst der Spielebibliothek (FastAPI).

Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Speicher-Dienst
{user}/{game} in der URL ist die Spiel-ID, der Spieler kommt immer aus dem JWT.
"""

import re
import logging
import math
import threading
import time
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from . import games, notaus, rollen, steckbrief, versionen
from .auth import Benutzerliste, Pruefer
from .config import Einstellungen, laden
from .db import Datenbank, ZuGross

KEY_MUSTER = r"^[A-Za-z0-9_][A-Za-z0-9._:-]{0,99}$"
BODY_MAX = 300 * 1024
BILD_BODY_MAX = 3 * 1024 * 1024 + 4096                  # Bild an einer Anfrage: max. 2 MB, als Base64 ≈ 2,7 MB
BILD_PFAD = re.compile(r"^/api/antraege/\d+/bilder$")
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
    # CRM (Zentrale 1.4.0): Personen in der Datenbank, users.yaml nur noch als Export (crm.py)
    from . import crm as crm_modul
    crm = crm_modul.Crm(db, e.admins)
    crm_modul.uebernehmen(crm, e.users_file, e.db_path.parent / "backup", e.admins, e.spiele_dir, e.tester)
    crm_modul.dabei_seit_nachholen(crm)
    benutzerliste = crm_modul.CrmBenutzerliste(e.users_file, crm, e.spiele_dir)
    try:
        benutzerliste.exportieren()
    except OSError as f:
        logging.getLogger("savesvc").warning("users.yaml konnte nicht geschrieben werden: %s", f)
    rollen.QUELLE = crm
    spieler = Pruefer(e, benutzerliste, schluessel_quelle)
    spieler.getrennt = db.getrennte_sitzungen()
    app = FastAPI(title="Spielebibliothek – Speicher-Dienst", docs_url=None, redoc_url=None, openapi_url=None)

    def spiel(request: Request, user: str = P(...), game: str = P(...), player: str = Depends(spieler)):
        # Entwürfe (<ordner>~entwurf) nur für den Entwickler selbst und echte Admins
        if game.endswith(versionen.ENTWURF):
            basis = game[: -len(versionen.ENTWURF)]
            darf = player == user or rollen.rolle(e, request, player)["echterAdmin"]
            ordner = e.spiele_dir / user / game
            gueltig = games.gueltige_id(user, basis) and ordner.is_dir() and not ordner.is_symlink()
            if not (darf and gueltig):
                raise HTTPException(404, "Spiel nicht gefunden")
            return f"{user}/{game}", ordner
        ordner = games.spielordner(e.spiele_dir, user, game)
        if not ordner:
            raise HTTPException(404, "Spiel nicht gefunden")
        return f"{user}/{game}", ordner

    @app.middleware("http")
    async def body_grenze(request, weiter):
        # Not-Aus (1.4.0): ab der ersten Sekunde keine Antwort mehr mit Daten – auch nicht intern
        if notaus.aktiv(e.users_file.parent):
            return JSONResponse({"detail": notaus.MELDUNG}, status_code=503, headers={"Retry-After": "3600"})
        # Riesige Anfragen gar nicht erst einlesen (Spielstand max. 256 KB + JSON-Hülle)
        laenge = request.headers.get("content-length")
        grenze = BILD_BODY_MAX if BILD_PFAD.match(request.url.path) else BODY_MAX   # 1.3.1: ein Bild je Anfrage an eine Anfrage
        if laenge and laenge.isdigit() and int(laenge) > grenze:
            return JSONResponse({"detail": "Anfrage zu groß"}, status_code=413)
        # CSRF: Cloudflare hängt die Anmeldung an jede Anfrage an games – auch an eine, die eine fremde
        # Seite auslöst. Ändernde Anfragen brauchen deshalb diesen Header (fremde Seiten können ihn nicht setzen).
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.headers.get("x-bibliothek") != "1" \
                and not request.url.path.startswith("/intern/"):   # /intern: nur Docker-Netz + eigenes Token
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

    letzte_anmeldung: dict[tuple, float] = {}

    def anmeldung_merken(request: Request, player: str) -> None:
        """Gerät, Ort und IP je Cloudflare-Sitzung festhalten (E55). Höchstens alle 5 Minuten ein Schreibzugriff."""
        from .verwaltung import browser_von
        sitzung = int(getattr(request.state, "sitzung_start", 0) or 0)
        geraet = browser_von(request.headers.get("user-agent", ""))
        schluessel = (player, sitzung, geraet)
        if time.monotonic() - letzte_anmeldung.get(schluessel, -1e9) < 300:
            return
        letzte_anmeldung[schluessel] = time.monotonic()
        h = request.headers
        ip = h.get("cf-connecting-ip") or (request.client.host if request.client else None)
        # Ort: Land kommt von Cloudflare immer, Stadt/Region nur mit der Managed Transform „Add visitor location headers“
        ort = ", ".join(x for x in (h.get("cf-ipcity"), h.get("cf-region"), h.get("cf-ipcountry")) if x and x != "XX") or None
        if not sitzung:
            # Probe/Teststand (DEV_USER): keine Cloudflare-Anmeldung – die IP wäre nur die interne Docker-Adresse,
            # und jeder Browser (auch Testläufe) erschiene als eigenes Gerät mit derselben IP (07.11.2026)
            ip, ort = None, "Probe/Teststand – keine echte Anmeldung"
        db.anmeldung(player, sitzung, geraet, ip, ort)

    @app.get("/api/vorschau/{user}/{ordner}")
    def vorschau(_: str = Depends(spieler), user: str = P(...), ordner: str = P(...)):
        """Vorschaubild aus dem Steckbrief (Zentrale 1.2.1) – nur PNG/JPG/WebP, Art an den ersten Bytes geprüft."""
        if not games.BENUTZER_MUSTER.match(user) or not games.ORDNER_MUSTER.match(ordner):
            raise HTTPException(404, "kein Vorschaubild")
        bild = steckbrief.bild(e.spiele_dir / user, ordner)
        if not bild:
            raise HTTPException(404, "kein Vorschaubild")
        return FileResponse(bild, media_type=steckbrief.ARTEN[bild.suffix[1:]],
                            headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
                                     "Content-Security-Policy": "default-src 'none'; sandbox"})

    @app.get("/api/me")
    def me(request: Request, player: str = Depends(spieler)):
        # Entwickler = hat einen eigenen Spielordner (wird beim Anlegen des Upload-Kontos erzeugt).
        # „Ansicht als …“ (rollen.py): echte Admins können Spieler- oder Entwickler-Sicht simulieren.
        r = rollen.rolle(e, request, player)
        anmeldung_merken(request, player)
        crm.angemeldet(player)          # eingeladen → aktiv bei der ersten Anmeldung (CRM)
        return {"player": player, "uploader": r["uploader"], "admin": r["admin"], "probe": e.probe,
                # Tester (1.4.0): Link „Tester-Panel“ in der Konto-Leiste; der Testserver selbst prüft über Cloudflare Access
                "tester": not r["ansicht"] and "tester" in rollen.crm_rollen(player),
                "ansicht": r["ansicht"], "echterAdmin": r["echterAdmin"],
                "sitzungBis": getattr(request.state, "sitzung_bis", None)}

    @app.get("/api/games")
    def spiele(request: Request, player: str = Depends(spieler)):
        einst = db.spiel_einstellungen()
        zuletzt = db.zuletzt_gespielt(rollen.daten_id(e, request, player))
        ist_admin = rollen.rolle(e, request, player)["admin"]
        simuliert = bool(rollen.simuliert(e, request, player))
        daumen = db.daumen_zahlen()
        meine = set() if rollen.simuliert(e, request, player) else db.meine_daumen(player)
        zeit_alle = db.spielzeit_je_spiel()
        zeit_ich = db.spielzeit_von(rollen.daten_id(e, request, player))
        sdw = db.sdw_aktuell()
        ergebnis = []
        for s in games.alle(e.spiele_dir):
            ein = einst.get(s["id"], {})
            if (ein.get("versteckt") or ein.get("testspiel")) and not ist_admin:
                continue   # ausgeblendet bzw. Testspiel (nur Anzeige – die Dateien bleiben unter play erreichbar)
            if ein.get("offline") and not ist_admin and (s["author"] != player or simuliert):
                continue   # vom Entwickler offline genommen (E40) – nur er selbst und Admins sehen es (nicht in „Ansicht als …“)
            ergebnis.append({**s, "leaderboardSeason": aktuelle_season(s["id"]),
                             "versteckt": bool(ein.get("versteckt")), "hervorgehoben": bool(ein.get("hervorgehoben")),
                             "testspiel": bool(ein.get("testspiel")),
                             "offline": bool(ein.get("offline")), "offlineGrund": ein.get("offlineGrund"),
                             "zuletztGespielt": zuletzt.get(s["id"]),
                             "daumen": daumen.get(s["id"], 0), "meinDaumen": s["id"] in meine,
                             "spielzeit": zeit_alle.get(s["id"], {}).get("sekunden", 0),
                             "meineSpielzeit": zeit_ich.get(s["id"], {}).get("sekunden", 0),
                             "spielDerWoche": bool(sdw and sdw["game"] == s["id"])})
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
        if sp[0].endswith(versionen.ENTWURF):
            raise HTTPException(409, "Im Entwurf werden keine Bestenlisten-Einträge gespeichert – erst nach dem Veröffentlichen")
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
        aufsteigend = lb["order"] == "asc"
        vorher = db.bestenliste(sp[0], season, aufsteigend, 1000)
        db.score_eintragen(player, sp[0], season, float(wert), werte)
        # Glocke: wer gerade überholt wurde, bekommt eine Meldung (nur echte Spieler)
        nachher = db.bestenliste(sp[0], season, aufsteigend, 1000)
        rang_vorher = next((x["rank"] for x in vorher if x["player"] == player), len(vorher) + 1)
        rang_nachher = next((x["rank"] for x in nachher if x["player"] == player), None)
        if rang_nachher and rang_nachher < rang_vorher and "~" not in player:
            ueber = {x["player"] for x in vorher if x["rank"] < rang_vorher} & {x["player"] for x in nachher if x["rank"] > rang_nachher}
            for anderer in sorted(ueber):
                if "~" not in anderer:
                    db.melden(anderer, f"{player} hat dich in „{games.beschreibung(e.spiele_dir, *sp[0].split('/', 1))['title']}“ überholt "
                                       f"(jetzt Platz {rang_nachher})", f"#/spiel/{sp[0]}")
        return {"season": season}

    # --- Daumen hoch (Idee „Bewertung“, 05.11.2026): Rückmeldung an die Entwickler ---
    @app.put("/api/daumen/{user}/{game}")
    def daumen_setzen(request: Request, player: str = Depends(spieler), sp=Depends(spiel), body: dict[str, Any] = Body(...)):
        if rollen.simuliert(e, request, player):
            raise HTTPException(409, "In der Ansicht als Spieler/Entwickler wird nicht bewertet")
        if sp[0].endswith(versionen.ENTWURF):
            raise HTTPException(409, "Entwürfe werden nicht bewertet")
        if sp[0].split("/")[0] == player:
            raise HTTPException(409, "Eigene Spiele kann man nicht bewerten")
        an = body.get("an")
        if not isinstance(an, bool):
            raise HTTPException(422, "an: true oder false")
        db.daumen_setzen(player, sp[0], an)
        return {"an": an, "daumen": db.daumen_zahlen().get(sp[0], 0)}

    # --- Versionsverlauf (E35) ---
    @app.get("/api/versionen/{user}/{game}")
    def versionsverlauf(user: str = P(...), sp=Depends(spiel)):
        from . import release
        basis = sp[1].parent
        rel = release.verlauf(basis, sp[1].name)["releases"]
        return {"aktuell": (release.ordner_version(sp[1]) or {}).get("version"),
                "releases": [{k: r.get(k) for k in ("version", "art", "zeit", "von", "aenderungen")} for r in reversed(rel)]}

    @app.get("/api/leaderboard/{user}/{game}")
    def bestenliste(
        player: str = Depends(spieler),
        sp=Depends(spiel),
        season: int | None = Query(None, ge=1, le=1_000_000),
        limit: int = Query(10, ge=1, le=100),
        woche: bool = Query(False),
    ):
        lb = games.bestenliste_einstellungen(sp[1])
        aktuell = aktuelle_season(sp[0], sp[1])
        gewaehlt = season or aktuell
        sdw = db.sdw_aktuell()
        if woche:   # Spiel der Woche: nur Einträge aus dieser Woche (Zentrale 1.2.0)
            if not (sdw and sdw["game"] == sp[0]):
                raise HTTPException(404, "Dieses Spiel ist gerade nicht Spiel der Woche")
            return {**lb, "season": gewaehlt, "currentSeason": aktuell, "seasons": sorted(set(db.seasons(sp[0])) | {aktuell}),
                    "woche": {"start": sdw["start"], "ende": sdw["ende"]},
                    "entries": db.bestenliste_zeitraum(sp[0], sdw["start"], sdw["ende"], lb["order"] == "asc", limit)}
        eintraege = db.bestenliste(sp[0], gewaehlt, lb["order"] == "asc", limit) if lb["enabled"] else []
        return {
            **lb,
            "season": gewaehlt,
            "currentSeason": aktuell,
            "seasons": sorted(set(db.seasons(sp[0])) | {aktuell}),
            "entries": eintraege,
            "spielDerWoche": bool(sdw and sdw["game"] == sp[0]),
        }

    from . import verwaltung
    verwaltung.registrieren(app, e, db, spieler, benutzerliste, aktuelle_season)
    from . import intern
    intern.registrieren(app, e, db, aktuelle_season)
    from . import gemeinschaft
    gemeinschaft.registrieren(app, e, db, spieler, spiel, ich_daten, benutzerliste, aktuelle_season)
    from . import tester   # Tester-Panel (1.4.0): nur auf dem Testserver (TESTPLAN_DIR gesetzt)
    tester.einrichten(app, e, spieler)

    return app


def app_factory() -> FastAPI:
    """Einstiegspunkt für uvicorn --factory."""
    return erstellen()
