"""Phase 10: Benutzermenü, Entwickler-Bereich, Anträge und Admin-Panel (Speicher-Dienst-Seite).

Alles, was in spiele/ schreibt oder Upload-Konten betrifft, erledigt der Upload-Dienst – der
Speicher-Dienst ruft ihn über die interne Schnittstelle /intern (geheimes Token, von außen nicht erreichbar).
"""

import json
import logging
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Query, Request

from . import games, rollen, versionen
from .auth import BENUTZER_MUSTER, Benutzerliste

log = logging.getLogger("savesvc.verwaltung")

SORTIERUNGEN = ("alphabetisch", "zuletzt", "neu")
ARTEN = {
    "fehler": "Fehler melden",
    "wunsch": "Wunsch / Idee",
    "spielstand": "Spielstand wiederherstellen",
    "bestenliste": "Bestenliste zurücksetzen",
    "spiel": "Spiel löschen oder umbenennen",
    "sonstiges": "Sonstiges",
}
NUR_ENTWICKLER = {"bestenliste", "spiel"}   # betreffen eigene Spiele
STATUS = ("offen", "erledigt", "abgelehnt")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UploadDienst:
    """Interne Aufrufe an den Upload-Dienst."""

    def __init__(self, url: str, token: str):
        self.url, self.token = url.rstrip("/"), token

    def __call__(self, methode: str, pfad: str, body: dict | None = None) -> Any:
        if not self.token:
            raise HTTPException(503, "INTERN_TOKEN fehlt – Upload-Dienst nicht erreichbar")
        anfrage = urllib.request.Request(
            self.url + pfad, method=methode,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"X-Intern-Token": self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(anfrage, timeout=15) as r:
                inhalt = r.read()
                return json.loads(inhalt) if inhalt else None
        except urllib.error.HTTPError as f:
            try:
                detail = json.loads(f.read()).get("detail", str(f))
            except Exception:
                detail = str(f)
            raise HTTPException(f.code if f.code < 500 else 502, f"Upload-Dienst: {detail}") from None
        except OSError as f:
            raise HTTPException(502, f"Upload-Dienst nicht erreichbar: {f}") from None


def browser_von(ua: str) -> str:
    """Nur Browser und Gerätetyp – keine weiteren Daten."""
    b = ("Edge" if "Edg/" in ua else "Firefox" if "Firefox/" in ua else "Chrome" if "Chrome/" in ua
         else "Safari" if "Safari/" in ua else "anderer")
    g = ("iPad" if "iPad" in ua else "iPhone" if "iPhone" in ua else "Android" if "Android" in ua
         else "Windows" if "Windows" in ua else "Mac" if "Macintosh" in ua else "Linux" if "Linux" in ua else "")
    return f"{b} ({g})" if g else b


def registrieren(app: FastAPI, e, db, spieler, benutzerliste: Benutzerliste, aktuelle_season, upload: UploadDienst | None = None):
    upload = upload or UploadDienst(e.upload_url, e.intern_token)

    def ist_entwickler(player: str) -> bool:
        return (e.spiele_dir / player).is_dir()

    def admin(request: Request, player: str = Depends(spieler)) -> str:
        r = rollen.rolle(e, request, player)
        if not r["admin"]:
            raise HTTPException(403, f"Ansicht als {r['ansicht']} aktiv – Admin-Funktionen gesperrt" if r["ansicht"] else "nur für Admins")
        return player

    def entwickler(request: Request, player: str = Depends(spieler)) -> str:
        if not rollen.rolle(e, request, player)["entwickler"]:
            raise HTTPException(403, "nur für Entwickler")
        return player

    def spiel_id(user: str, game: str):
        ordner = games.spielordner(e.spiele_dir, user, game)
        if not ordner:
            raise HTTPException(404, "Spiel nicht gefunden")
        return f"{user}/{game}", ordner

    def titel_von(spiel: str) -> str:
        try:
            b, o = spiel.split("/", 1)
            for name in (o, o + versionen.ENTWURF):    # Spiele, die es bisher nur als Entwurf gibt
                if games.gueltige_id(b, o) and (e.spiele_dir / b / name).is_dir():
                    return games.beschreibung(e.spiele_dir, b, name)["title"]
        except (ValueError, OSError):
            pass
        return spiel

    # ---------- Einstellungen (alle) ----------

    def ich_daten(request: Request, player: str = Depends(spieler)) -> str:
        return rollen.daten_id(e, request, player)

    @app.get("/api/einstellungen")
    def einstellungen_lesen(player: str = Depends(ich_daten)):
        d = db.einstellungen(player)
        return {
            "sortierung": d.get("sortierung") if d.get("sortierung") in SORTIERUNGEN else "alphabetisch",
            "favoriten": [f for f in d.get("favoriten", []) if isinstance(f, str)],
            "grossansicht": d.get("grossansicht") is True,
            "bestenliste": d.get("bestenliste") is not False,
            # Spiel-ID → „geaendert“ der Version, die der Spieler zuletzt geöffnet hat (Marke „Aktualisiert“)
            "gesehen": {k: v for k, v in (d.get("gesehen") or {}).items() if isinstance(k, str) and isinstance(v, str)}
                       if isinstance(d.get("gesehen"), dict) else {},
        }

    @app.put("/api/einstellungen")
    def einstellungen_schreiben(player: str = Depends(ich_daten), body: dict[str, Any] = Body(...)):
        d = einstellungen_lesen(player)
        if "sortierung" in body:
            if body["sortierung"] not in SORTIERUNGEN:
                raise HTTPException(422, f"sortierung: {', '.join(SORTIERUNGEN)}")
            d["sortierung"] = body["sortierung"]
        if "favoriten" in body:
            fav = body["favoriten"]
            if not isinstance(fav, list) or len(fav) > 200 or not all(isinstance(f, str) and len(f) <= 100 for f in fav):
                raise HTTPException(422, "favoriten: Liste von Spiel-IDs")
            d["favoriten"] = list(dict.fromkeys(fav))
        if "gesehen" in body:   # wird zusammengeführt, nicht ersetzt
            g = body["gesehen"]
            if not isinstance(g, dict) or not all(isinstance(k, str) and len(k) <= 100 and isinstance(v, str) and len(v) <= 40
                                                  for k, v in g.items()):
                raise HTTPException(422, "gesehen: Objekt Spiel-ID → Zeitpunkt")
            zusammen = {**d["gesehen"], **g}
            d["gesehen"] = dict(list(zusammen.items())[-300:])
        for k in ("grossansicht", "bestenliste"):
            if k in body:
                if not isinstance(body[k], bool):
                    raise HTTPException(422, f"{k}: true oder false")
                d[k] = body[k]
        db.einstellungen_setzen(player, d)
        return d

    # ---------- Meine Spielstände (alle) ----------

    @app.get("/api/meine/spielstaende")
    def meine_spielstaende(player: str = Depends(ich_daten)):
        nach_spiel: dict[str, dict] = {}
        for z in db.meine_spielstaende(player):
            s = nach_spiel.setdefault(z["game"], {"spiel": z["game"], "title": titel_von(z["game"]), "keys": [], "zuletzt": ""})
            s["keys"].append({k: z[k] for k in ("key", "bytes", "version", "updatedAt")})
            s["zuletzt"] = max(s["zuletzt"], z["updatedAt"])
        return sorted(nach_spiel.values(), key=lambda s: s["zuletzt"], reverse=True)

    @app.delete("/api/meine/spielstaende/{user}/{game}")
    def spielstaende_zuruecksetzen(player: str = Depends(ich_daten), user: str = P(...), game: str = P(...)):
        if not (BENUTZER_MUSTER.match(user) and games.ORDNER_MUSTER.match(game)):
            raise HTTPException(404, "Spiel nicht gefunden")
        return {"geloescht": db.spielstaende_loeschen(player, f"{user}/{game}")}

    # ---------- Entwickler ----------

    def eigene_spiele(player: str) -> list[str]:
        """Ordnernamen der Spiele eines Entwicklers – live oder nur als Entwurf."""
        basis = e.spiele_dir / player
        namen = set()
        if basis.is_dir():
            for p in basis.iterdir():
                name = p.name[: -len(versionen.ENTWURF)] if p.name.endswith(versionen.ENTWURF) else p.name
                if p.is_dir() and games.ORDNER_MUSTER.match(name):
                    namen.add(name)
        return sorted(namen)

    @app.get("/api/entwickler/spiele")
    def entwickler_spiele(player: str = Depends(entwickler)):
        statistik = db.spiel_statistik()
        daumen = db.daumen_zahlen()
        einst = db.spiel_einstellungen()
        fehler = db.fehler_zahlen()
        basis = e.spiele_dir / player
        ergebnis = []
        for name in eigene_spiele(player):
            sid = f"{player}/{name}"
            if einst.get(sid, {}).get("testspiel"):
                continue   # Testspiele (E38) sind keine Spiele – Verwaltung nur im Admin-Panel
            live = (basis / name).is_dir()
            try:
                s = games.beschreibung(e.spiele_dir, player, name if live else name + versionen.ENTWURF)
                entw = versionen.entwurf_info(basis, name)
            except OSError as fehler:   # unlesbarer Ordner: überspringen statt alles abbrechen
                log.warning("Spiel %s nicht lesbar: %s", sid, fehler)
                continue
            s["id"] = sid
            st = statistik.get(sid, {})
            f_live = fehler.get(sid, {})
            f_entw = fehler.get(sid + versionen.ENTWURF, {})
            ergebnis.append({**s, "live": live, "leaderboardSeason": aktuelle_season(sid),
                             "spieler": st.get("spieler", 0), "zuletzt": st.get("zuletzt"), "scores": st.get("scores", 0),
                             "versteckt": einst.get(sid, {}).get("versteckt", False),
                             "offline": einst.get(sid, {}).get("offline", False), "offlineGrund": einst.get(sid, {}).get("offlineGrund"),
                             "entwurf": entw, "fehler": f_live, "fehlerEntwurf": f_entw, "daumen": daumen.get(sid, 0)})
        return ergebnis

    @app.put("/api/entwickler/offline/{user}/{game}")
    def offline_setzen(request: Request, player: str = Depends(entwickler), user: str = P(...), game: str = P(...),
                       body: dict[str, Any] = Body(...)):
        """Eigenes Spiel vorübergehend offline nehmen, z. B. bei vielen Fehlern (E40). Wirkt wie „ausblenden“,
        aber der Entwickler entscheidet selbst; Admins dürfen es für jedes Spiel."""
        if user != player and not rollen.rolle(e, request, player)["admin"]:
            raise HTTPException(403, "nur für eigene Spiele")
        sid, _o = spiel_id(user, game)
        an = body.get("offline")
        if not isinstance(an, bool):
            raise HTTPException(422, "offline: true oder false")
        grund = " ".join(str(body.get("grund") or "").split())[:200] or None
        db.spiel_setzen(sid, offline=int(an), offline_grund=grund if an else None,
                        offline_seit=datetime.now(timezone.utc).isoformat(timespec="seconds") if an else None)
        log.info("%s hat %s %s", player, sid, "offline genommen" if an else "wieder online gestellt")
        return {"offline": an, "grund": grund if an else None}

    @app.post("/api/entwickler/entwurf/{user}/{game}")
    def entwurf_starten(request: Request, player: str = Depends(spieler), user: str = P(...), game: str = P(...)):
        """Entwurf zum Testen öffnen: Beschreibung liefern und beim ersten Mal den eigenen Spielstand hineinkopieren."""
        if user != player and not rollen.rolle(e, request, player)["echterAdmin"]:
            raise HTTPException(404, "Entwurf nicht gefunden")
        ordner = e.spiele_dir / user / (game + versionen.ENTWURF)
        if not (games.gueltige_id(user, game) and ordner.is_dir()):
            raise HTTPException(404, "Entwurf nicht gefunden")
        try:
            b = games.beschreibung(e.spiele_dir, user, game + versionen.ENTWURF)
        except OSError:
            raise HTTPException(503, "Entwurf ist gerade nicht lesbar – Rechte auf der NAS prüfen") from None
        kopiert = db.spielstaende_kopieren(rollen.daten_id(e, request, player), f"{user}/{game}", f"{user}/{game}{versionen.ENTWURF}")
        db.entwurf_test(f"{user}/{game}{versionen.ENTWURF}", player, "geoeffnet", True, None)   # für die Prüfung (E36)
        return {**b, "id": f"{user}/{game}{versionen.ENTWURF}", "entwurfVon": f"{user}/{game}", "spielstaendeKopiert": kopiert}

    @app.post("/api/entwickler/migration/{user}/{game}", status_code=204)
    def migration_melden(request: Request, player: str = Depends(spieler), user: str = P(...), game: str = P(...),
                         body: dict[str, Any] = Body(...)):
        """gamesave.js meldet beim Testen eines Entwurfs, ob die Umwandlung eines Spielstands geklappt hat (E36)."""
        ordner = e.spiele_dir / user / game
        basis = game[: -len(versionen.ENTWURF)] if game.endswith(versionen.ENTWURF) else ""
        darf = player == user or rollen.rolle(e, request, player)["echterAdmin"]
        if not (basis and darf and games.gueltige_id(user, basis) and ordner.is_dir()):
            raise HTTPException(404, "Entwurf nicht gefunden")
        ok = body.get("ok") is True
        von, nach = body.get("von"), body.get("nach")
        text = f"{str(body.get('key'))[:100]}: saveVersion {von} → {nach}" + ("" if ok else f" – {str(body.get('fehler'))[:200]}")
        db.entwurf_test(f"{user}/{game}", player, "migration", ok, text)

    # ---------- Fehlerberichte (Idee „Automatische Fehlerberichte“) ----------
    fehler_takt: dict[tuple[str, str], list[float]] = {}

    @app.post("/api/fehler/{user}/{game}", status_code=204)
    def fehler_melden(request: Request, player: str = Depends(spieler), user: str = P(...), game: str = P(...),
                      body: dict[str, Any] = Body(...)):
        sid = f"{user}/{game}"
        basis = game[: -len(versionen.ENTWURF)] if game.endswith(versionen.ENTWURF) else game
        if not (games.gueltige_id(user, basis) and (e.spiele_dir / user / game).is_dir()):
            raise HTTPException(404, "Spiel nicht gefunden")
        # höchstens 20 Meldungen pro Minute je Spieler und Spiel
        import time as _t
        jetzt = _t.monotonic()
        liste = [x for x in fehler_takt.get((player, sid), []) if jetzt - x < 60]
        if len(liste) >= 20:
            fehler_takt[(player, sid)] = liste
            return
        fehler_takt[(player, sid)] = liste + [jetzt]
        def text(k, n):
            x = body.get(k)
            return x[:n] if isinstance(x, str) else ""
        def zahl(k):
            x = body.get(k)
            return int(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x < 10_000_000 else 0
        meldung = text("meldung", 300).strip() or "(ohne Meldung)"
        db.fehler_melden(sid, meldung, text("quelle", 200), zahl("zeile"), zahl("spalte"),
                         text("stack", 1500) or None, browser_von(request.headers.get("user-agent", "")))

    @app.get("/api/entwickler/fehler")
    def fehler_ansehen(request: Request, player: str = Depends(entwickler), alle: bool = Query(False)):
        if alle and rollen.rolle(e, request, player)["admin"]:
            liste = db.fehler_liste(None)
        else:
            ids = []
            for name in eigene_spiele(player):
                ids += [f"{player}/{name}", f"{player}/{name}{versionen.ENTWURF}"]
            liste = db.fehler_liste(ids)
        return [{**f, "entwurf": f["game"].endswith(versionen.ENTWURF), "title": titel_von(f["game"].removesuffix(versionen.ENTWURF))} for f in liste]

    @app.delete("/api/entwickler/fehler/{fehler_id}", status_code=204)
    def fehler_erledigt(request: Request, player: str = Depends(entwickler), fehler_id: int = P(...)):
        f = db.fehler_eintrag(fehler_id)
        if not f or (f["game"].split("/")[0] != player and not rollen.rolle(e, request, player)["admin"]):
            raise HTTPException(404, "Fehlerbericht nicht gefunden")
        db.fehler_loeschen(fehler_id)

    @app.post("/api/entwickler/season/{user}/{game}")
    def neue_season(player: str = Depends(entwickler), user: str = P(...), game: str = P(...)):
        if user != player and player not in e.admins:
            raise HTTPException(403, "nur für eigene Spiele")
        sid, _ = spiel_id(user, game)
        neu = aktuelle_season(sid) + 1
        db.spiel_setzen(sid, season=neu)
        log.info("%s: neue Season %d für %s", player, neu, sid)
        return {"season": neu}

    # ---------- Anträge ----------

    def arten_fuer(request: Request, player: str) -> dict:
        ist_entw = rollen.rolle(e, request, player)["entwickler"]
        return {k: t for k, t in ARTEN.items() if ist_entw or k not in NUR_ENTWICKLER}

    @app.get("/api/antraege/arten")
    def antragsarten(request: Request, player: str = Depends(spieler)):
        return arten_fuer(request, player)

    @app.post("/api/antraege", status_code=201)
    def antrag_stellen(request: Request, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        if rollen.simuliert(e, request, player):
            raise HTTPException(409, "In der Ansicht als Spieler/Entwickler werden keine Anträge verschickt")
        art, text, spiel = body.get("art"), body.get("text"), body.get("spiel") or None
        if art not in arten_fuer(request, player):
            raise HTTPException(422, "unbekannte oder nicht erlaubte Art")
        if not isinstance(text, str) or not 3 <= len(text.strip()) <= 4000:
            raise HTTPException(422, "Beschreibung: 3 bis 4000 Zeichen")
        if spiel is not None and (not isinstance(spiel, str) or len(spiel) > 100):
            raise HTTPException(422, "spiel ungültig")
        aid = db.antrag_anlegen(player, art, spiel, text.strip())
        log.info("neuer Antrag %d von %s (%s)", aid, player, art)
        return {"id": aid}

    @app.get("/api/antraege")
    def meine_antraege(player: str = Depends(ich_daten)):
        return db.antraege(player)

    # ---------- Admin ----------

    @app.get("/api/admin/uebersicht")
    def uebersicht(_: str = Depends(admin)):
        alle_spiele = games.alle(e.spiele_dir)
        einst_alle = db.spiel_einstellungen()
        speicher: dict[str, int] = {}
        for s in alle_spiele:
            ordner = e.spiele_dir / s["id"]
            speicher[s["author"]] = speicher.get(s["author"], 0) + sum(f.stat().st_size for f in ordner.rglob("*") if f.is_file())
        kopie = e.backup_ziel
        try:
            ereignisse = upload("GET", "/intern/ereignisse")
        except HTTPException as f:
            ereignisse = [{"fehler": f.detail}]
        return {
            "spieler": len(benutzerliste.alle()),
            # Testspiele (E38) sind keine Spiele für Spieler – getrennt zählen
            "spiele": sum(1 for x in alle_spiele if not einst_alle.get(x["id"], {}).get("testspiel")),
            "testspiele": sum(1 for x in alle_spiele if einst_alle.get(x["id"], {}).get("testspiel")),
            "offline": sum(1 for x in alle_spiele if einst_alle.get(x["id"], {}).get("offline")),
            "zaehler": db.zaehlen(),
            "offeneAntraege": sum(1 for a in db.antraege() if a["status"] == "offen"),
            "aktivitaet": [{**a, "title": titel_von(a["game"])} for a in db.letzte_aktivitaet()],
            "uploads": ereignisse,
            "speicher": speicher,
            "datenbank": e.db_path.stat().st_size if e.db_path.exists() else 0,
            "sicherung": datetime.fromtimestamp(kopie.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
                         if kopie and kopie.exists() else None,
        }

    @app.post("/api/admin/ansicht/{rolle}/zuruecksetzen")
    def ansicht_zuruecksetzen(player: str = Depends(admin), rolle: str = P(...)):
        """Vor jedem Start von „Ansicht als …“: das simulierte Konto (z. B. seb~spieler) leeren – die Simulation
        beginnt immer wie ein neuer Kollege (Seb, 05.11.2026)."""
        if rolle not in rollen.ANSICHTEN:
            raise HTTPException(422, "rolle: spieler oder entwickler")
        return {"geloescht": db.konto_leeren(f"{player}~{rolle}")}

    @app.get("/api/admin/spiele")
    def admin_spiele(_: str = Depends(admin)):
        statistik = db.spiel_statistik()
        daumen = db.daumen_zahlen()
        einst = db.spiel_einstellungen()
        fehler = db.fehler_zahlen()
        return [{**s, **{"versteckt": False, "hervorgehoben": False, "testspiel": False}, **{k: v for k, v in einst.get(s["id"], {}).items() if k != "season"},
                 "leaderboardSeason": aktuelle_season(s["id"]), **statistik.get(s["id"], {"spieler": 0, "zuletzt": None, "scores": 0}),
                 "fehler": fehler.get(s["id"], {}), "daumen": daumen.get(s["id"], 0)}
                for s in games.alle(e.spiele_dir)]

    @app.patch("/api/admin/spiele/{user}/{game}")
    def spiel_einstellen(_: str = Depends(admin), user: str = P(...), game: str = P(...), body: dict[str, Any] = Body(...)):
        sid, _o = spiel_id(user, game)
        felder = {k: int(bool(body[k])) for k in ("versteckt", "hervorgehoben", "testspiel") if k in body}
        db.spiel_setzen(sid, **felder)
        return {"ok": True}

    @app.delete("/api/admin/spiele/{user}/{game}", status_code=204)
    def spiel_loeschen(admin_name: str = Depends(admin), user: str = P(...), game: str = P(...)):
        spiel_id(user, game)
        upload("DELETE", f"/intern/spiele/{user}/{game}")
        log.info("%s hat Spiel %s/%s gelöscht", admin_name, user, game)

    @app.delete("/api/admin/bestenliste/{user}/{game}")
    def bestenliste_leeren(_: str = Depends(admin), user: str = P(...), game: str = P(...), season: int | None = Query(None)):
        sid, _o = spiel_id(user, game)
        return {"geloescht": db.bestenliste_loeschen(sid, season)}

    @app.get("/api/admin/scores/{user}/{game}")
    def admin_scores(_: str = Depends(admin), user: str = P(...), game: str = P(...), season: int | None = Query(None)):
        sid, _o = spiel_id(user, game)
        return db.scores_liste(sid, season)

    @app.delete("/api/admin/scores/{score_id}", status_code=204)
    def score_entfernen(_: str = Depends(admin), score_id: int = P(...)):
        if not db.score_loeschen(score_id):
            raise HTTPException(404, "Score nicht gefunden")

    # Benutzer
    @app.get("/api/admin/benutzer")
    def benutzer(_: str = Depends(admin)):
        try:
            entw = {z["player"]: z for z in upload("GET", "/intern/entwickler")}
        except HTTPException:
            entw = {}
        aktiv: dict[str, str] = {}
        for a in db.letzte_aktivitaet(1000):
            aktiv.setdefault(a["player"], a["zeit"])
        return [{"email": mail, "name": name, "admin": name in e.admins, "ordner": ist_entwickler(name),
                 "uploadKonto": name in entw, "zuletzt": aktiv.get(name)}
                for mail, name in sorted(benutzerliste.alle().items(), key=lambda x: x[1])]

    @app.post("/api/admin/benutzer", status_code=201)
    def benutzer_anlegen(admin_name: str = Depends(admin), body: dict[str, Any] = Body(...)):
        mail = str(body.get("email", "")).strip().lower()
        name = str(body.get("name", "")).strip()
        if not EMAIL.match(mail):
            raise HTTPException(422, "E-Mail-Adresse ungültig")
        if not BENUTZER_MUSTER.match(name):
            raise HTTPException(422, "Benutzername: klein, a–z, 0–9, _ und -, max. 32 Zeichen")
        zuordnung = benutzerliste.alle()
        if mail in zuordnung:
            raise HTTPException(409, f"E-Mail ist schon {zuordnung[mail]!r} zugeordnet")
        if name in zuordnung.values():
            raise HTTPException(409, "Benutzername ist vergeben")
        zuordnung[mail] = name
        benutzerliste.speichern(zuordnung)
        ergebnis = {"email": mail, "name": name}
        if body.get("entwickler") is True:
            ergebnis["passwort"] = upload("POST", "/intern/entwickler", {"name": name})["passwort"]
        log.info("%s hat Benutzer %s angelegt (Entwickler: %s)", admin_name, name, "passwort" in ergebnis)
        return ergebnis

    @app.delete("/api/admin/benutzer/{name}")
    def benutzer_entfernen(admin_name: str = Depends(admin), name: str = P(...)):
        if name in e.admins:
            raise HTTPException(409, "Admins können hier nicht entfernt werden")
        zuordnung = benutzerliste.alle()
        neu = {m: n for m, n in zuordnung.items() if n != name}
        if len(neu) == len(zuordnung):
            raise HTTPException(404, "Benutzer nicht gefunden")
        benutzerliste.speichern(neu)
        try:
            upload("DELETE", f"/intern/entwickler/{name}")
        except HTTPException:
            pass
        log.info("%s hat Benutzer %s entfernt", admin_name, name)
        return {"ok": True}

    @app.post("/api/admin/entwickler/{name}")
    def entwickler_machen(_: str = Depends(admin), name: str = P(...)):
        if name not in benutzerliste.alle().values():
            raise HTTPException(404, "erst als Benutzer anlegen")
        return upload("POST", "/intern/entwickler", {"name": name})

    @app.post("/api/admin/entwickler/{name}/passwort")
    def neues_passwort(_: str = Depends(admin), name: str = P(...)):
        return upload("POST", f"/intern/entwickler/{name}/passwort")

    @app.delete("/api/admin/entwickler/{name}")
    def entwickler_entziehen(_: str = Depends(admin), name: str = P(...)):
        upload("DELETE", f"/intern/entwickler/{name}")
        return {"ok": True}

    # Spielstände
    @app.get("/api/admin/spielstaende")
    def admin_spielstaende(_: str = Depends(admin), player: str | None = Query(None), game: str | None = Query(None)):
        return [{**z, "title": titel_von(z["game"])} for z in db.spielstaende(player, game)]

    @app.get("/api/admin/spielstand")
    def admin_spielstand(_: str = Depends(admin), player: str = Query(...), game: str = Query(...), key: str = Query(...)):
        stand = db.laden(player, game, key)
        return {"aktuell": stand, "verlauf": db.verlauf_mit_daten(player, game, key)}

    @app.post("/api/admin/spielstand/wiederherstellen")
    def admin_wiederherstellen(admin_name: str = Depends(admin), body: dict[str, Any] = Body(...)):
        try:
            ziel = db.wiederherstellen(int(body.get("id")))
        except (KeyError, TypeError, ValueError):
            raise HTTPException(404, "Verlaufseintrag nicht gefunden") from None
        log.info("%s hat Verlauf %s wiederhergestellt", admin_name, body.get("id"))
        return ziel

    @app.delete("/api/admin/spielstand", status_code=204)
    def admin_spielstand_loeschen(_: str = Depends(admin), player: str = Query(...), game: str = Query(...), key: str = Query(...)):
        db.loeschen(player, game, key)

    # Anträge
    @app.get("/api/admin/antraege")
    def alle_antraege(_: str = Depends(admin)):
        return [{**a, "artText": ARTEN.get(a["art"], a["art"])} for a in db.antraege()]

    @app.patch("/api/admin/antraege/{antrag_id}")
    def antrag_beantworten(_: str = Depends(admin), antrag_id: int = P(...), body: dict[str, Any] = Body(...)):
        status = body.get("status")
        antwort = body.get("antwort")
        if status not in STATUS:
            raise HTTPException(422, f"status: {', '.join(STATUS)}")
        if antwort is not None and (not isinstance(antwort, str) or len(antwort) > 4000):
            raise HTTPException(422, "antwort zu lang")
        if not db.antrag_bearbeiten(antrag_id, status, antwort):
            raise HTTPException(404, "Antrag nicht gefunden")
        return {"ok": True}
