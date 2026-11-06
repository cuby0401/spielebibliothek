"""Phase 10: Benutzermenü, Entwickler-Bereich, Anträge und Admin-Panel (Speicher-Dienst-Seite).

Alles, was in spiele/ schreibt oder Upload-Konten betrifft, erledigt der Upload-Dienst – der
Speicher-Dienst ruft ihn über die interne Schnittstelle /intern (geheimes Token, von außen nicht erreichbar).
"""

import base64
import binascii
import json
import logging
import os
import shutil
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Query, Request
from fastapi.responses import Response

from . import games, rollen, steckbrief, versionen
from .auth import BENUTZER_MUSTER, Benutzerliste

log = logging.getLogger("savesvc.verwaltung")

SORTIERUNGEN = ("alphabetisch", "zuletzt", "neu", "meistgespielt")
ARTEN = {
    "fehler": "Fehler melden",
    "wunsch": "Wunsch / Idee",
    "spielstand": "Spielstand wiederherstellen",
    "bestenliste": "Bestenliste zurücksetzen",
    "spiel": "Spiel löschen oder umbenennen",
    "sonstiges": "Sonstiges",
}
NUR_ENTWICKLER = {"bestenliste", "spiel"}   # betreffen eigene Spiele
# Zentrale 1.3.0: Diese Arten gehen mit einem gewählten Spiel an dessen Entwickler – nicht an den Admin.
# Alles andere (Spielstand, Bestenliste, Spiel löschen/umbenennen, Anträge ohne Spiel) kann nur der Admin erledigen.
SPIEL_ARTEN = {"fehler", "wunsch", "sonstiges"}
STATUS = ("offen", "erledigt", "abgelehnt")
BILDER_MAX = 5                    # Bilder je Antrag (1.3.1) – PNG/JPG/WebP, je höchstens 2 MB (die Seite verkleinert vorher)


def bild_aus_daten_url(wert) -> tuple[str, bytes]:
    """„data:image/…;base64,…“ → (Art, Bytes). Die Art wird an den Bytes erkannt, nicht an der Angabe."""
    if not isinstance(wert, str) or not wert.startswith("data:image/") or ";base64," not in wert:
        raise steckbrief.UngueltigesBild("Bild ungültig")
    if len(wert) > (steckbrief.BILD_MAX * 4) // 3 + 200:
        raise steckbrief.UngueltigesBild("Bild zu groß (max. 2 MB)")
    try:
        daten = base64.b64decode(wert.split(";base64,", 1)[1], validate=True)
    except (binascii.Error, ValueError):
        raise steckbrief.UngueltigesBild("Bild ungültig") from None
    if not daten or len(daten) > steckbrief.BILD_MAX:
        raise steckbrief.UngueltigesBild("Bild zu groß (max. 2 MB)")
    return steckbrief.art_von(daten), daten
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
    from . import auftraege, cloudflare
    cf_pruefung = cloudflare.Pruefung(e.cloudflare_schluessel, e.cloudflare_konto,
                                      {"kollegen": e.richtlinie_kollegen, "entwickler": e.richtlinie_entwickler})

    def cf_soll(entw_namen: set[str]) -> dict[str, set[str]]:
        return cloudflare.soll(benutzerliste.alle(), entw_namen)

    waechter_zustand: dict = {"letzterLauf": None, "probleme": [], "homeAssistant": bool(e.ha_webhook), "aktiv": e.waechter}
    if e.waechter:
        from . import waechter
        waechter.starten(e, db, upload, waechter_zustand)

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
        zeit = db.spielzeit_je_spiel()
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
                             "entwurf": entw, "fehler": f_live, "fehlerEntwurf": f_entw, "daumen": daumen.get(sid, 0),
                             "spielzeit": zeit.get(sid, {}).get("sekunden", 0), "sitzungen": zeit.get(sid, {}).get("sitzungen", 0)})
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
        neu = db.fehler_melden(sid, meldung, text("quelle", 200), zahl("zeile"), zahl("spalte"),
                               text("stack", 1500) or None, browser_von(request.headers.get("user-agent", "")))
        # Glocke des Entwicklers: neue Fehlerart in einem veröffentlichten Spiel – höchstens eine Meldung je Spiel und Stunde
        if neu and not game.endswith(versionen.ENTWURF) and not db.wichtig_kuerzlich(user, f"#/meine-spiele?{sid}"):
            db.melden(user, f"Neuer Fehler in „{titel_von(sid)}“: {meldung[:120]}" + (f" (Zeile {zahl('zeile')})" if zahl("zeile") else ""),
                      f"#/meine-spiele?{sid}", wichtig=True)

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
        if user != player and player not in rollen.admins(e):
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
        # Bilder kommen danach einzeln über POST /api/antraege/{id}/bilder (Grenze je Anfrage, 1.3.1)
        aid = db.antrag_anlegen(player, art, spiel, text.strip())
        log.info("neuer Antrag %d von %s (%s)", aid, player, art)
        kurz = " ".join(text.split())[:100]
        besitzer = zustaendig({"art": art, "spiel": spiel})
        if besitzer:
            # Spiel-Antrag (1.3.0): nur der Entwickler bekommt ihn – der Admin nicht (keine Glocke, keine Zahl, kein Push)
            if besitzer != player:
                db.melden(besitzer, f"Antrag zu „{titel_von(spiel)}“ von {player} ({ARTEN[art]}): {kurz}", f"/#/antrag/{aid}",
                          wichtig=(art == "fehler"))
            return {"id": aid, "an": besitzer}
        for a in sorted(rollen.admins(e)):
            db.melden(a, f"Neuer Antrag von {player} ({ARTEN[art]}): {kurz}", f"/#/antrag/{aid}", wichtig=True)
        from . import waechter
        waechter.ha_senden(e, "antrag", f"Neuer Antrag von {player} ({ARTEN[art]}): {kurz}")
        return {"id": aid, "an": "admin"}

    def zustaendig(a: dict) -> str | None:
        """Entwickler, der einen Antrag bearbeitet – None = Admin."""
        spiel = a.get("spiel") or ""
        if a.get("art") not in SPIEL_ARTEN or "/" not in spiel:
            return None
        besitzer, ordner = spiel.split("/", 1)
        if not (games.spielordner(e.spiele_dir, besitzer, ordner) or
                games.spielordner(e.spiele_dir, besitzer, ordner + versionen.ENTWURF)):
            return None
        return besitzer

    def mit_infos(a: dict, bildzahlen: dict | None = None) -> dict:
        z = zustaendig(a)
        return {**a, "artText": ARTEN.get(a["art"], a["art"]), "zustaendig": z or "admin",
                "title": titel_von(a["spiel"]) if a.get("spiel") else None,
                "bilder": (bildzahlen if bildzahlen is not None else db.antrag_bild_zahlen()).get(a["id"], 0)}

    def liste_mit_infos(antraege: list[dict]) -> list[dict]:
        zahlen = db.antrag_bild_zahlen()
        return [mit_infos(a, zahlen) for a in antraege]

    # ---------- Ein Antrag als „Ticket“ (1.3.1): aus der Glocke, aus „Meine Spiele“ und aus „Anträge“ ----------
    def sicht(request: Request, player: str, antrag_id: int) -> tuple[dict, bool]:
        """(Antrag, darf antworten). Sehen dürfen: Antragsteller, zuständiger Entwickler, Admin. Sonst 404."""
        a = db.antrag(antrag_id)
        if not a:
            raise HTTPException(404, "Antrag nicht gefunden")
        r = rollen.rolle(e, request, player)
        z = zustaendig(a)
        darf_antworten = not r["ansicht"] and (z == player or (z is None and r["admin"]))
        if not (a["player"] == rollen.daten_id(e, request, player) or darf_antworten or r["admin"]):
            raise HTTPException(404, "Antrag nicht gefunden")
        return a, darf_antworten

    @app.get("/api/antraege/{antrag_id}")
    def antrag_einzeln(request: Request, player: str = Depends(spieler), antrag_id: int = P(...)):
        a, darf_antworten = sicht(request, player, antrag_id)
        eigener = a["player"] == rollen.daten_id(e, request, player)
        return {**mit_infos(a), "bilder": db.antrag_bilder(antrag_id), "darfAntworten": darf_antworten,
                "eigener": eigener, "darfBilder": (eigener or darf_antworten) and not rollen.simuliert(e, request, player),
                "bilderMax": BILDER_MAX}

    @app.post("/api/antraege/{antrag_id}/bilder", status_code=201)
    def antrag_bild_dazu(request: Request, player: str = Depends(spieler), antrag_id: int = P(...), body: dict[str, Any] = Body(...)):
        a, darf_antworten = sicht(request, player, antrag_id)
        if rollen.simuliert(e, request, player) or not (a["player"] == player or darf_antworten):
            raise HTTPException(403, "Nur Antragsteller und Bearbeiter können Bilder anfügen")
        try:
            bart, daten = bild_aus_daten_url(body.get("bild"))
        except steckbrief.UngueltigesBild as f:
            raise HTTPException(422, str(f)) from None
        bid = db.antrag_bild_anlegen(antrag_id, bart, daten, player, BILDER_MAX)
        if bid is None:
            raise HTTPException(409, f"Schon {BILDER_MAX} Bilder an diesem Antrag")
        return {"id": bid}

    @app.get("/api/antraege/{antrag_id}/bilder/{bild_id}")
    def antrag_bild_zeigen(request: Request, player: str = Depends(spieler), antrag_id: int = P(...), bild_id: int = P(...)):
        sicht(request, player, antrag_id)
        b = db.antrag_bild(antrag_id, bild_id)
        if not b:
            raise HTTPException(404, "Bild nicht gefunden")
        return Response(b[1], media_type=steckbrief.ARTEN[b[0]],
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "default-src 'none'; sandbox"})

    @app.delete("/api/antraege/{antrag_id}/bilder/{bild_id}", status_code=204)
    def antrag_bild_weg(request: Request, player: str = Depends(spieler), antrag_id: int = P(...), bild_id: int = P(...)):
        sicht(request, player, antrag_id)
        bild = next((b for b in db.antrag_bilder(antrag_id) if b["id"] == bild_id), None)
        if not bild:
            raise HTTPException(404, "Bild nicht gefunden")
        if rollen.simuliert(e, request, player) or not (bild["von"] == player or rollen.rolle(e, request, player)["admin"]):
            raise HTTPException(403, "Nur wer das Bild angefügt hat, kann es entfernen")
        db.antrag_bild_loeschen(antrag_id, bild_id)

    @app.patch("/api/antraege/{antrag_id}")
    def antrag_antworten(request: Request, player: str = Depends(spieler), antrag_id: int = P(...), body: dict[str, Any] = Body(...)):
        a, darf_antworten = sicht(request, player, antrag_id)
        if not darf_antworten:
            raise HTTPException(403, "Diesen Antrag bearbeitet " + (zustaendig(a) or "Seb"))
        return antworten(a, body, player)

    @app.get("/api/antraege")
    def meine_antraege(player: str = Depends(ich_daten)):
        return liste_mit_infos(db.antraege(player))

    # Spiel-Anträge für den Entwickler (1.3.0): pro Spiel, offen und geschlossen
    @app.get("/api/entwickler/antraege")
    def entwickler_antraege(request: Request, player: str = Depends(entwickler)):
        if rollen.simuliert(e, request, player):
            return []
        return liste_mit_infos([a for a in db.antraege() if zustaendig(a) == player])

    @app.patch("/api/entwickler/antraege/{antrag_id}")
    def entwickler_antwort(request: Request, player: str = Depends(entwickler), antrag_id: int = P(...),
                           body: dict[str, Any] = Body(...)):
        if rollen.simuliert(e, request, player):
            raise HTTPException(409, "In der Ansicht als Spieler/Entwickler werden keine Anträge beantwortet")
        a = db.antrag(antrag_id)
        if not a or zustaendig(a) != player:
            raise HTTPException(404, "Antrag nicht gefunden")
        return antworten(a, body, player)

    def antworten(a: dict, body: dict, von: str) -> dict:
        status, antwort = body.get("status"), body.get("antwort")
        if status not in STATUS:
            raise HTTPException(422, f"status: {', '.join(STATUS)}")
        if antwort is not None and (not isinstance(antwort, str) or len(antwort) > 4000):
            raise HTTPException(422, "antwort zu lang")
        db.antrag_bearbeiten(a["id"], status, antwort, von)
        if status != "offen" and a["player"] != von:   # Glocke: Antragsteller erfährt die Antwort
            zu = f" zu „{titel_von(a['spiel'])}“" if a.get("spiel") else ""
            db.melden(a["player"], f"Dein Antrag{zu} wurde {'erledigt' if status == 'erledigt' else 'abgelehnt'} ({von})"
                                   + (f": {antwort[:120]}" if antwort else ""), f"/#/antrag/{a['id']}")
        return {"ok": True}

    # ---------- Anmeldungen (E55) ----------

    @app.get("/api/meine/anmeldungen")
    def meine_anmeldungen(request: Request, player: str = Depends(spieler)):
        aktuell = (int(getattr(request.state, "sitzung_start", 0) or 0), browser_von(request.headers.get("user-agent", "")))
        getrennt = spieler.getrennt
        return [{**a, "aktuell": (a["sitzung"], a["geraet"]) == aktuell, "getrennt": (player, a["sitzung"]) in getrennt}
                for a in db.anmeldungen(player, 50)]

    @app.get("/api/admin/anmeldungen")
    def alle_anmeldungen(_: str = Depends(admin)):
        getrennt = spieler.getrennt
        return [{**a, "getrennt": (a["player"], a["sitzung"]) in getrennt} for a in db.anmeldungen(None, 200)]

    def trennen(player: str, sitzung, von: str) -> None:
        if not isinstance(sitzung, int) or isinstance(sitzung, bool) or sitzung <= 0:
            raise HTTPException(422, "sitzung ungültig")
        db.sitzung_trennen(player, sitzung, von)
        spieler.getrennt.add((player, sitzung))
        log.info("%s hat die Sitzung %s von %s getrennt", von, sitzung, player)

    @app.post("/api/meine/anmeldungen/trennen", status_code=204)
    def eigene_trennen(request: Request, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        """Eine eigene Anmeldung beenden – das Gerät wird beim nächsten Klick abgemeldet (Zentrale 1.2.1)."""
        aktuell = int(getattr(request.state, "sitzung_start", 0) or 0)
        if body.get("alleAnderen") is True:
            for a in db.anmeldungen(player, 100):
                if a["sitzung"] and a["sitzung"] != aktuell:
                    trennen(player, a["sitzung"], player)
            return
        if body.get("sitzung") == aktuell:
            raise HTTPException(409, "Das ist dieses Gerät – zum Abmelden „Abmelden“ benutzen")
        if not any(a["sitzung"] == body.get("sitzung") for a in db.anmeldungen(player, 100)):
            raise HTTPException(404, "Anmeldung nicht gefunden")
        trennen(player, body.get("sitzung"), player)

    @app.post("/api/admin/anmeldungen/trennen", status_code=204)
    def admin_trennen(player: str = Depends(admin), body: dict[str, Any] = Body(...)):
        wer = body.get("player")
        if not isinstance(wer, str) or not any(a["sitzung"] == body.get("sitzung") for a in db.anmeldungen(wer, 100)):
            raise HTTPException(404, "Anmeldung nicht gefunden")
        trennen(wer, body.get("sitzung"), player)

    # ---------- Probe-Zentrale (E56) ----------

    freigabe_datei = e.db_path.parent / "freigabe.json"

    @app.get("/api/admin/probe")
    def probe_status(_: str = Depends(admin)):
        kopie = e.db_path.parent / "kopie-von"
        try:
            freigabe = json.loads(freigabe_datei.read_text())
        except (OSError, ValueError):
            freigabe = None
        return {"probe": e.probe, "commit": e.zentrale_commit, "version": e.zentrale_version,
                "kopieVon": kopie.read_text().strip() if kopie.exists() else None, "freigabe": freigabe,
                "live": live_status()}

    def live_status() -> dict | None:
        """Was der Auftragsdienst nach der Freigabe gemeldet hat (1.3.0): wartet, läuft, ok oder fehler."""
        try:
            return json.loads((e.db_path.parent / "live-status.json").read_text())
        except (OSError, ValueError):
            return None

    @app.post("/api/admin/probe/freigeben")
    def probe_freigeben(player: str = Depends(admin), body: dict[str, Any] = Body(default={})):
        """Seb hat die Probe getestet → scripts/deploy.sh darf genau diesen Commit live einspielen."""
        if not e.probe:
            raise HTTPException(409, "Nur in der Probe-Zentrale")
        if not e.zentrale_commit:
            raise HTTPException(409, "Probe ohne Commit gestartet – mit scripts/deploy.sh --probe aufsetzen")
        notiz = " ".join(str(body.get("notiz") or "").split())[:300]
        daten = {"commit": e.zentrale_commit, "version": e.zentrale_version, "von": player,
                 "zeit": datetime.now(timezone.utc).isoformat(timespec="seconds"), "notiz": notiz}
        freigabe_datei.write_text(json.dumps(daten, ensure_ascii=False))
        return daten

    @app.delete("/api/admin/probe/freigeben", status_code=204)
    def probe_freigabe_zurueck(_: str = Depends(admin)):
        if not e.probe:
            raise HTTPException(409, "Nur in der Probe-Zentrale")
        freigabe_datei.unlink(missing_ok=True)

    # ---------- Admin ----------

    def platte() -> dict:
        """Freier Platz auf dem Spiele-Volume – Warnung im Admin-Panel unter 10 % oder 10 GB (Zentrale 1.2.0)."""
        try:
            u = shutil.disk_usage(e.spiele_dir)
        except OSError:
            return {}
        return {"frei": u.free, "gesamt": u.total, "knapp": u.free < 10 * 1024 ** 3 or u.free < u.total * 0.1}

    def kontingent_mb() -> int:
        try:
            return int(os.environ.get("UPLOAD_KONTINGENT_MB", "1024"))
        except ValueError:
            return 1024

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
            "spieler": len(set(benutzerliste.alle().values())),
            # Testspiele (E38) sind keine Spiele für Spieler – getrennt zählen
            "spiele": sum(1 for x in alle_spiele if not einst_alle.get(x["id"], {}).get("testspiel")),
            "testspiele": sum(1 for x in alle_spiele if einst_alle.get(x["id"], {}).get("testspiel")),
            "offline": sum(1 for x in alle_spiele if einst_alle.get(x["id"], {}).get("offline")),
            "zaehler": db.zaehlen(),
            "offeneAntraege": sum(1 for a in db.antraege() if a["status"] == "offen" and not zustaendig(a)),
            "aktivitaet": [{**a, "title": titel_von(a["game"])} for a in db.letzte_aktivitaet()],
            "uploads": ereignisse,
            "speicher": speicher,
            "datenbank": e.db_path.stat().st_size if e.db_path.exists() else 0,
            "platte": platte(),
            "waechter": waechter_zustand,
            "kontingent": kontingent_mb() * 1024 * 1024,
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
        zeit = db.spielzeit_je_spiel()
        daumen = db.daumen_zahlen()
        einst = db.spiel_einstellungen()
        fehler = db.fehler_zahlen()
        return [{**s, **{"versteckt": False, "hervorgehoben": False, "testspiel": False}, **{k: v for k, v in einst.get(s["id"], {}).items() if k != "season"},
                 "leaderboardSeason": aktuelle_season(s["id"]), **statistik.get(s["id"], {"spieler": 0, "zuletzt": None, "scores": 0}),
                 "fehler": fehler.get(s["id"], {}), "daumen": daumen.get(s["id"], 0),
                 "spielzeit": zeit.get(s["id"], {}).get("sekunden", 0)}
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

    # Personen (CRM, Zentrale 1.4.0) – ersetzt „Benutzer“. „Zuletzt aktiv“ = das Späteste aus Spielständen/Scores,
    # Anmeldungen (auch reines Umsehen) und Upload-Ereignissen (06.11.2026)
    def aktivitaet() -> dict[str, str]:
        aktiv: dict[str, str] = {}

        def merken(name: str, zeit: str | None) -> None:
            if name and zeit and zeit > aktiv.get(name, ""):
                aktiv[name] = zeit

        for a in db.letzte_aktivitaet(1000):
            merken(a["player"], a["zeit"])
        for a in db.anmeldungen(limit=1000):
            merken(a["player"], a["letzte"])
        try:
            for a in upload("GET", "/intern/ereignisse"):
                if isinstance(a, dict):
                    merken(a.get("player", ""), a.get("zeit"))
        except HTTPException:
            pass
        return aktiv

    from . import personen
    personen.registrieren(app, e, db, admin, spieler, benutzerliste, upload, cf_pruefung, cf_soll, aktivitaet)

    auftraege.registrieren(app, e, db, admin)   # Aufgaben: Tests und Zeitplan (1.3.0)

    @app.get("/api/admin/cloudflare")
    def cloudflare_stand(_: str = Depends(admin), neu: bool = Query(False)):
        """Vergleich Benutzerliste ↔ Cloudflare-Richtlinien. Liest nur – geändert wird mit scripts/cloudflare.py am Mac."""
        try:
            entw = {z["player"] for z in upload("GET", "/intern/entwickler")}
        except HTTPException as f:
            return {"eingerichtet": cf_pruefung.eingerichtet(), "fehler": f"Upload-Dienst: {f.detail}", "richtlinien": []}
        return cf_pruefung.ergebnis(cf_soll(entw), neu=neu)

    @app.post("/api/admin/entwickler/{name}/passwort")
    def neues_passwort(_: str = Depends(admin), name: str = P(...)):
        return upload("POST", f"/intern/entwickler/{name}/passwort")

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
        # „zustaendig“: admin = Bibliothek (zählt, mit Glocke) – sonst der Entwickler (nur zur Info)
        return liste_mit_infos(db.antraege())

    @app.patch("/api/admin/antraege/{antrag_id}")
    def antrag_beantworten(admin_name: str = Depends(admin), antrag_id: int = P(...), body: dict[str, Any] = Body(...)):
        a = db.antrag(antrag_id)
        if not a:
            raise HTTPException(404, "Antrag nicht gefunden")
        return antworten(a, body, admin_name)
