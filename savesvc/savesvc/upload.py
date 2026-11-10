"""Upload-Dienst der Spielebibliothek (Phase 6b, ersetzt File Browser – E19).

Läuft als eigener Container (UID 10021, Schreibrecht nur auf /spiele) hinter upload.cuby0401.uk.
Zwei Stufen wie bisher (E5):
  1. Cloudflare Access, Anwendung "upload" (Richtlinie Entwickler, 15 min) → JWT mit eigener AUD
  2. eigenes Upload-Passwort pro Entwickler (scrypt), Sitzung 15 min, Sperre nach 5 Fehlversuchen

Entwickler werden nur per CLI im Container angelegt:  python -m savesvc entwickler anlegen <name>
"""

import hashlib
import json
import hmac
import logging
import os
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Path as P, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from . import games, release, steckbrief, versionen, zipinstall
from .auth import BENUTZER_MUSTER, Benutzerliste, Pruefer
from .config import Einstellungen, laden

log = logging.getLogger("savesvc.upload")

SITZUNG = 15 * 60
COOKIE = "sb_upload"
COOKIE_PFAD = "/api/upload"
FEHL_MAX = 5
SPERRE = 15 * 60
UPLOAD_MAX = 101 * 1024 * 1024   # Cloudflare lässt ohnehin nur 100 MB pro Anfrage durch
PASSWORT_LAENGE = 20


def neues_passwort() -> str:
    zeichen = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(zeichen) for _ in range(PASSWORT_LAENGE))


class Entwickler:
    """Upload-Passwörter (scrypt) und Fehlversuche, SQLite unter /data/upload.db."""

    def __init__(self, pfad: Path):
        self.pfad = pfad
        pfad.parent.mkdir(parents=True, exist_ok=True)
        with self._v() as v:
            v.executescript("""
                CREATE TABLE IF NOT EXISTS entwickler (
                    player TEXT PRIMARY KEY, salt BLOB NOT NULL, hash BLOB NOT NULL, angelegt TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS fehlversuche (player TEXT NOT NULL, zeit REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS ereignisse (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL, player TEXT NOT NULL,
                    aktion TEXT NOT NULL, ordner TEXT, dateien INTEGER);
                CREATE TABLE IF NOT EXISTS waechter_probe (id INTEGER PRIMARY KEY CHECK (id = 1), zeit TEXT NOT NULL);
            """)

    @contextmanager
    def _v(self):
        v = sqlite3.connect(self.pfad, timeout=10, isolation_level=None)
        try:
            yield v
        finally:
            v.close()

    @staticmethod
    def _hash(passwort: str, salt: bytes) -> bytes:
        return hashlib.scrypt(passwort.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)

    def setzen(self, player: str, passwort: str) -> None:
        salt = secrets.token_bytes(16)
        with self._v() as v:
            v.execute("INSERT INTO entwickler (player, salt, hash, angelegt) VALUES (?,?,?,?) "
                      "ON CONFLICT (player) DO UPDATE SET salt=excluded.salt, hash=excluded.hash",
                      (player, salt, self._hash(passwort, salt), datetime.now(timezone.utc).isoformat(timespec="seconds")))
            v.execute("DELETE FROM fehlversuche WHERE player=?", (player,))

    def vorhanden(self, player: str) -> bool:
        with self._v() as v:
            return v.execute("SELECT 1 FROM entwickler WHERE player=?", (player,)).fetchone() is not None

    def pruefen(self, player: str, passwort: str) -> bool:
        with self._v() as v:
            z = v.execute("SELECT salt, hash FROM entwickler WHERE player=?", (player,)).fetchone()
        return bool(z) and hmac.compare_digest(self._hash(passwort, z[0]), z[1])

    def gesperrt(self, player: str) -> bool:
        with self._v() as v:
            n = v.execute("SELECT COUNT(*) FROM fehlversuche WHERE player=? AND zeit > ?",
                          (player, time.time() - SPERRE)).fetchone()[0]
        return n >= FEHL_MAX

    def fehlversuch(self, player: str) -> None:
        with self._v() as v:
            v.execute("INSERT INTO fehlversuche (player, zeit) VALUES (?,?)", (player, time.time()))
            v.execute("DELETE FROM fehlversuche WHERE zeit < ?", (time.time() - 86400,))

    def erfolg(self, player: str) -> None:
        with self._v() as v:
            v.execute("DELETE FROM fehlversuche WHERE player=?", (player,))

    def loeschen(self, player: str) -> bool:
        with self._v() as v:
            return v.execute("DELETE FROM entwickler WHERE player=?", (player,)).rowcount > 0

    def liste(self) -> list[tuple[str, str]]:
        with self._v() as v:
            return list(v.execute("SELECT player, angelegt FROM entwickler ORDER BY player"))

    def ereignis(self, player: str, aktion: str, ordner: str | None = None, dateien: int | None = None) -> None:
        with self._v() as v:
            v.execute("INSERT INTO ereignisse (zeit, player, aktion, ordner, dateien) VALUES (?,?,?,?,?)",
                      (datetime.now(timezone.utc).isoformat(timespec="seconds"), player, aktion, ordner, dateien))
            v.execute("DELETE FROM ereignisse WHERE id NOT IN (SELECT id FROM ereignisse ORDER BY id DESC LIMIT 500)")

    def schreibtest(self) -> None:
        with self._v() as v:
            v.execute("INSERT INTO waechter_probe (id, zeit) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET zeit=excluded.zeit",
                      (datetime.now(timezone.utc).isoformat(timespec="seconds"),))

    def ereignisse(self, limit: int = 25, player: str | None = None) -> list[dict]:
        with self._v() as v:
            v.row_factory = sqlite3.Row
            sql = "SELECT zeit, player, aktion, ordner, dateien FROM ereignisse" + (" WHERE player=?" if player else "") + " ORDER BY id DESC LIMIT ?"
            return [dict(z) for z in v.execute(sql, ((player, limit) if player else (limit,)))]


def entwickler_anlegen(store: "Entwickler", spiele_dir: Path, name: str, neu: bool = True) -> str:
    """Upload-Konto anlegen (neu=True, inkl. Spielordner) oder neues Passwort setzen. Liefert das Passwort."""
    if neu:
        (spiele_dir / name).mkdir(mode=0o770, exist_ok=True)   # erbt die Default-ACLs von spiele/
    passwort = neues_passwort()
    store.setzen(name, passwort)
    return passwort


def geheimnis(pfad: Path) -> bytes:
    """Schlüssel für die Sitzungs-Cookies; wird beim ersten Start erzeugt."""
    if not pfad.exists():
        fd = os.open(pfad, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(secrets.token_bytes(32))
    return pfad.read_bytes()


def _signatur(geheim: bytes, text: str) -> str:
    return hmac.new(geheim, text.encode(), hashlib.sha256).hexdigest()


def cookie_ausstellen(geheim: bytes, player: str) -> str:
    text = f"{player}|{int(time.time()) + SITZUNG}"
    return f"{text}|{_signatur(geheim, text)}"


def cookie_gueltig(geheim: bytes, wert: str, player: str) -> bool:
    try:
        name, ablauf, sig = wert.split("|")
    except ValueError:
        return False
    return (hmac.compare_digest(sig, _signatur(geheim, f"{name}|{ablauf}"))
            and name == player and ablauf.isdigit() and int(ablauf) > time.time())


MB = 1024 * 1024


def kontingent() -> int:
    """Speicher je Entwickler (Spiele + Entwürfe + aufgehobene Versionen), Standard 1 GB. Zentrale 1.2.0."""
    try:
        return max(10, int(os.environ.get("UPLOAD_KONTINGENT_MB", "1024"))) * MB
    except ValueError:
        return 1024 * MB


def belegt(ordner: Path) -> int:
    try:
        return sum(f.stat().st_size for f in ordner.rglob("*") if f.is_file())
    except OSError:
        return 0


ENTWURF_INFO = ".entwurf.json"   # Zeitpunkt des Entwurfs-Uploads (versteckt, nur im Entwurf)


class SpeicherDienst:
    """Interne Aufrufe an den Speicher-Dienst (Testergebnisse, Season, Spielstände beim Rollback)."""

    def __init__(self, url: str, token: str):
        self.url, self.token = url.rstrip("/"), token

    def __call__(self, methode: str, pfad: str, body: dict | None = None) -> Any:
        import urllib.error
        import urllib.request
        if not self.token:
            raise HTTPException(503, "INTERN_TOKEN fehlt – Speicher-Dienst nicht erreichbar")
        anfrage = urllib.request.Request(self.url + pfad, method=methode,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers={"X-Intern-Token": self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(anfrage, timeout=15) as r:
                inhalt = r.read()
                return json.loads(inhalt) if inhalt else None
        except urllib.error.HTTPError as f:
            raise HTTPException(502, f"Speicher-Dienst: Fehler {f.code}") from None
        except OSError as f:
            raise HTTPException(502, f"Speicher-Dienst nicht erreichbar: {f}") from None


def erstellen(e: Einstellungen | None = None, schluessel_quelle=None, daten: Path | None = None,
              speicher: SpeicherDienst | None = None) -> FastAPI:
    e = e or laden()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    daten = daten or Path(os.environ.get("UPLOAD_DATA", "/data"))
    sicher = os.environ.get("UPLOAD_COOKIE_SECURE", "1") != "0"
    store = Entwickler(daten / "upload.db")
    geheim = geheimnis(daten / "geheimnis")
    spieler = Pruefer(e, Benutzerliste(e.users_file), schluessel_quelle)
    speicher = speicher or SpeicherDienst(os.environ.get("SAVESVC_URL", "http://savesvc:8000"), os.environ.get("INTERN_TOKEN", ""))

    def speicher_still(methode: str, pfad: str, body: dict | None = None) -> None:
        """Aufräumen im Speicher-Dienst – ein Fehler darf den Upload nicht scheitern lassen."""
        try:
            speicher(methode, pfad, body)
        except HTTPException as f:
            log.warning("Speicher-Dienst %s %s: %s", methode, pfad, f.detail)

    app = FastAPI(title="Spielebibliothek – Upload", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def schutz(request: Request, weiter):
        from . import notaus   # Not-Aus (1.4.0): dieselbe Datei wie im Speicher-Dienst, hier nur lesbar eingebunden
        if notaus.aktiv(e.users_file.parent):
            return JSONResponse({"detail": notaus.MELDUNG}, status_code=503, headers={"Retry-After": "3600"})
        laenge = request.headers.get("content-length")
        if laenge and laenge.isdigit() and int(laenge) > UPLOAD_MAX:
            return JSONResponse({"detail": "Datei zu groß (max. 100 MB)"}, status_code=413)
        # CSRF: Fremde Seiten können diesen Header nicht ohne CORS-Freigabe setzen
        # (/intern ist nur im Docker-Netz erreichbar und hat ein eigenes Token)
        if request.url.path.startswith("/intern/"):
            return await weiter(request)
        if request.method in ("POST", "PUT", "DELETE") and request.headers.get("x-upload") != "1":
            return JSONResponse({"detail": "Header X-Upload fehlt"}, status_code=403)
        return await weiter(request)

    def angemeldet(request: Request, player: str = Depends(spieler)) -> str:
        if not store.vorhanden(player):
            raise HTTPException(403, "kein Upload-Konto – bitte bei Seb melden")
        if not cookie_gueltig(geheim, request.cookies.get(COOKIE, ""), player):
            raise HTTPException(401, "Upload-Passwort nötig")
        return player

    def ordnerpfad(player: str, ordner: str) -> Path:
        if not games.ORDNER_MUSTER.match(ordner):
            raise HTTPException(422, "Ordnername: Buchstaben, Ziffern, . _ - (max. 64 Zeichen, nicht mit . beginnend)")
        return e.spiele_dir / player / ordner

    def handle_von(ordner: str) -> str:
        """Aktuelles Handle für die Anzeige oben (1.5.0); ohne Speicher-Dienst bleibt es beim Ordnernamen."""
        try:
            from urllib.parse import quote
            r = speicher("GET", f"/intern/handle/{quote(ordner)}")
        except HTTPException:
            return ordner
        h = r.get("handle") if isinstance(r, dict) else None
        return h if isinstance(h, str) and h else ordner

    @app.get("/api/upload/status")
    def status(request: Request, player: str = Depends(spieler)):
        return {
            "player": player, "handle": handle_von(player),
            "entwickler": store.vorhanden(player),
            "angemeldet": cookie_gueltig(geheim, request.cookies.get(COOKIE, ""), player),
            "gesperrt": store.gesperrt(player),
            "speicher": {"belegt": belegt(e.spiele_dir / player), "grenze": kontingent()},
        }

    @app.post("/api/upload/anmelden", status_code=204)
    def anmelden(response: Response, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        if not store.vorhanden(player):
            raise HTTPException(403, "kein Upload-Konto – bitte bei Seb melden")
        if store.gesperrt(player):
            store.ereignis(player, "Upload-Anmeldung gesperrt (zu viele Fehlversuche)")      # Sicherheitsprotokoll (1.5.0)
            raise HTTPException(429, f"zu viele Fehlversuche – in {SPERRE // 60} Minuten wieder versuchen")
        passwort = body.get("passwort")
        if not isinstance(passwort, str) or not store.pruefen(player, passwort):
            store.fehlversuch(player)
            store.ereignis(player, "Upload-Passwort falsch")                                   # Sicherheitsprotokoll (1.5.0)
            log.info("falsches Upload-Passwort für %s", player)
            raise HTTPException(401, "Passwort falsch")
        store.erfolg(player)
        response.set_cookie(COOKIE, cookie_ausstellen(geheim, player), max_age=SITZUNG, path=COOKIE_PFAD,
                            httponly=True, secure=sicher, samesite="strict")

    @app.post("/api/upload/abmelden", status_code=204)
    def abmelden(response: Response):
        response.delete_cookie(COOKIE, path=COOKIE_PFAD, httponly=True, secure=sicher, samesite="strict")

    def spiel_namen(basis: Path) -> list[str]:
        """Alle Spiele eines Entwicklers – auch solche, die bisher nur als Entwurf existieren."""
        namen = set()
        if basis.is_dir():
            for p in basis.iterdir():
                name = p.name[:-len(versionen.ENTWURF)] if p.name.endswith(versionen.ENTWURF) else p.name
                if p.is_dir() and games.ORDNER_MUSTER.match(name):
                    namen.add(name)
        return sorted(namen)

    @app.get("/api/upload/spiele")
    def meine_spiele(player: str = Depends(angemeldet)):
        basis = e.spiele_dir / player
        ergebnis = []
        for name in spiel_namen(basis):
            live = basis / name
            entw = versionen.entwurf_info(basis, name)
            b = games.beschreibung(e.spiele_dir, player, name if live.is_dir() else name + versionen.ENTWURF)
            vl = release.verlauf(basis, name)
            ergebnis.append({
                "ordner": name,
                "title": b["title"],
                "complete": b["complete"],
                "warning": b["warning"],
                "version": (release.ordner_version(live) or {}).get("version") if live.is_dir() else None,
                "aenderungen": vl["aenderungen"],               # gesammelt seit der letzten Veröffentlichung
                "releases": list(reversed(vl["releases"]))[:10],
                "live": versionen._info(live) if live.is_dir() else None,
                "entwurf": entw,
                "versionen": versionen.versionen(basis, name),
                # Speicher dieses Spiels (zählt alles zum Kontingent), Zentrale 1.2.0
                "speicher": {"live": belegt(live) if live.is_dir() else 0,
                             "entwurf": belegt(versionen.entwurf(basis, name)) if entw else 0,
                             "versionen": sum(belegt(basis / f"{name}{versionen.VERSION}{v['id']}") for v in versionen.versionen(basis, name))},
            })
        return ergebnis

    @app.post("/api/upload/spiele/{ordner}")
    def hochladen(player: str = Depends(angemeldet), ordner: str = P(...), datei: UploadFile = File(...),
                  neu: str = Form("")):
        """Jeder Upload landet als Entwurf (E35). Veröffentlicht wird nur über das Update-Fenster."""
        ziel = ordnerpfad(player, ordner)
        basis = ziel.parent
        entwurf = versionen.entwurf(basis, ordner)
        try:
            ergebnis = zipinstall.installieren(datei.file, entwurf)
        except zipinstall.UngueltigesZip as fehler:
            store.ereignis(player, f"Upload blockiert: {str(fehler)[:200]}", ordner)          # Sicherheitsprotokoll (1.5.0)
            raise HTTPException(422, str(fehler)) from None
        jetzt_belegt, grenze = belegt(basis), kontingent()
        if jetzt_belegt > grenze:   # Kontingent überschritten → Entwurf wieder entfernen
            shutil.rmtree(entwurf, ignore_errors=True)
            raise HTTPException(413, f"Dein Speicher ist voll: {(jetzt_belegt - ergebnis.bytes) // MB} MB belegt, das Spiel braucht "
                                     f"{ergebnis.bytes // MB + 1} MB, erlaubt sind {grenze // MB} MB. Alte Versionen oder Spiele "
                                     "löschen – oder Seb um mehr Platz bitten.")
        (entwurf / ENTWURF_INFO).write_text(json.dumps({"zeit": release.jetzt(), "von": player}), encoding="utf-8")
        release.aenderung_merken(basis, ordner, neu, player)
        speicher_still("POST", f"/intern/entwurf/{player}/{ordner}/zuruecksetzen")   # frischer Test mit echtem Spielstand
        log.info("%s hat %s als Entwurf hochgeladen (%d Dateien)", player, ordner, ergebnis.dateien)
        store.ereignis(player, "als Entwurf hochgeladen", ordner, ergebnis.dateien)
        return {"ordner": ordner, "entwurf": True, "dateien": ergebnis.dateien, "bytes": ergebnis.bytes,
                "uebersprungen": ergebnis.uebersprungen[:50]}

    def pruefung(player: str, ordner: str) -> dict:
        """Prüfung vor dem Veröffentlichen (E36): Dateien + Testergebnisse aus dem Speicher-Dienst."""
        basis = ordnerpfad(player, ordner).parent
        entwurf = versionen.entwurf(basis, ordner)
        if not entwurf.is_dir():
            raise HTTPException(404, "kein Entwurf vorhanden")
        live = basis / ordner
        er = release.pruefen(live if live.is_dir() else None, entwurf)
        punkte = er["punkte"]
        try:
            seit = json.loads((entwurf / ENTWURF_INFO).read_text(encoding="utf-8"))["zeit"]
        except (OSError, ValueError, KeyError):
            seit = versionen.entwurf_info(basis, ordner)["geaendert"]
        try:
            from urllib.parse import quote
            t = speicher("GET", f"/intern/entwurf/{player}/{ordner}?seit={quote(seit)}")
        except HTTPException as f:
            t = None
            punkte.append({"stufe": "warnung", "text": f"Testergebnisse nicht abrufbar ({f.detail}). Bitte selbst sicher sein, dass der Entwurf läuft."})
        if t is not None:
            if t["geoeffnet"]:
                punkte.append({"stufe": "ok", "text": "Entwurf wurde in der Bibliothek getestet."})
            else:
                punkte.append({"stufe": "warnung", "text": "Entwurf wurde noch nicht getestet – auf „Testen“ klicken und kurz spielen."})
            sv_alt, sv_neu = er["saveVersionAlt"], er["saveVersionNeu"]
            if t["migrationFehler"]:
                punkte.append({"stufe": "fehler", "text": "Umwandlung des Spielstands ist beim Testen fehlgeschlagen: "
                                                          + "; ".join(t["migrationFehler"])})
            elif sv_alt is not None and sv_neu > sv_alt:
                if t["migrationOk"]:
                    punkte.append({"stufe": "ok", "text": f"Umwandlung auf saveVersion {sv_neu} mit deinem Spielstand getestet."})
                else:
                    punkte.append({"stufe": "warnung", "text": f"Umwandlung auf saveVersion {sv_neu} noch nicht getestet. Im Entwurf "
                                                               "ein Spiel laden, zu dem du einen alten Spielstand hast."})
            if t["fehler"]:
                punkte.append({"stufe": "warnung", "text": f"{t['fehler']} JavaScript-Fehler beim Testen des Entwurfs – siehe Konto → Meine Spiele → Fehlerberichte."})
        version = (release.ordner_version(live) or {}).get("version") if live.is_dir() else None
        return {"ordner": ordner, "version": version, "erstveroeffentlichung": not live.is_dir(),
                "vorschlaege": release.vorschlaege(version), "arten": release.ARTEN,
                "aenderungen": [a["text"] for a in release.verlauf(basis, ordner)["aenderungen"]],
                "punkte": punkte, "seasonEmpfohlen": er["seasonEmpfohlen"],
                "fehler": sum(1 for x in punkte if x["stufe"] == "fehler"),
                "warnungen": sum(1 for x in punkte if x["stufe"] == "warnung")}

    @app.get("/api/upload/spiele/{ordner}/pruefung")
    def pruefung_abrufen(player: str = Depends(angemeldet), ordner: str = P(...)):
        return pruefung(player, ordner)

    @app.post("/api/upload/spiele/{ordner}/veroeffentlichen")
    def veroeffentlichen(player: str = Depends(angemeldet), ordner: str = P(...), body: dict[str, Any] = Body(...)):
        """Update-Fenster abschicken: Prüfung läuft hier noch einmal – dem Browser wird nicht geglaubt."""
        art = body.get("art")
        if art not in release.ARTEN:
            raise HTTPException(422, "art: patch, minor oder major")
        aenderungen = body.get("aenderungen")
        if not isinstance(aenderungen, list) or not all(isinstance(a, str) for a in aenderungen):
            raise HTTPException(422, "aenderungen: Liste von Texten")
        aenderungen = [z for z in (release.zeile(a) for a in aenderungen) if z]
        if not aenderungen:
            raise HTTPException(422, "Bitte mindestens eine Zeile angeben, was sich geändert hat.")
        pr = pruefung(player, ordner)
        if pr["fehler"]:
            raise HTTPException(409, "Die Prüfung hat Fehler gefunden – erst beheben, dann neu hochladen.")
        if pr["warnungen"] and body.get("warnungenGelesen") is not True:
            raise HTTPException(409, "Bitte die Warnungen lesen und bestätigen.")
        version = release.naechste(pr["version"], art) if not pr["erstveroeffentlichung"] else "1.0.0"
        basis = ordnerpfad(player, ordner).parent
        sv = release._save_version(release._meta(versionen.entwurf(basis, ordner))[0] or {})
        (versionen.entwurf(basis, ordner) / ENTWURF_INFO).unlink(missing_ok=True)
        try:
            versionen.veroeffentlichen(basis, ordner)
        except FileNotFoundError as f:
            raise HTTPException(404, str(f)) from None
        eintrag = release.veroeffentlicht(basis, ordner, version, art, sv, aenderungen, player)
        speicher_still("POST", f"/intern/entwurf/{player}/{ordner}/zuruecksetzen")
        season = None
        if body.get("neueSeason") is True:
            try:
                season = speicher("POST", f"/intern/season/{player}/{ordner}")["season"]
            except HTTPException as f:
                log.warning("Neue Season für %s/%s nicht gesetzt: %s", player, ordner, f.detail)
        store.ereignis(player, f"Version {version} veröffentlicht", ordner)
        titel = games.beschreibung(e.spiele_dir, player, ordner)["title"]
        speicher_still("POST", "/intern/meldung", {
            # neues Spiel → alle; Update → nur wer es als Favorit hat (Seb, 05.11.2026)
            "an": "*" if pr["erstveroeffentlichung"] else f"favoriten:{player}/{ordner}", "link": f"#/spiel/{player}/{ordner}",
            "text": (f"Neues Spiel: „{titel}“ von {player}" if pr["erstveroeffentlichung"]
                     else f"„{titel}“ ist jetzt Version {version}: {' · '.join(aenderungen)[:150]}")})
        return {"version": version, "eintrag": eintrag, "season": season}

    @app.delete("/api/upload/spiele/{ordner}/entwurf", status_code=204)
    def entwurf_verwerfen(player: str = Depends(angemeldet), ordner: str = P(...)):
        basis = ordnerpfad(player, ordner).parent
        e_pfad = versionen.entwurf(basis, ordner)
        if not e_pfad.is_dir():
            raise HTTPException(404, "kein Entwurf vorhanden")
        shutil.rmtree(e_pfad)
        release.aenderungen_verwerfen(basis, ordner)
        speicher_still("POST", f"/intern/entwurf/{player}/{ordner}/zuruecksetzen")
        store.ereignis(player, "Entwurf verworfen", ordner)

    @app.post("/api/upload/spiele/{ordner}/zuruecksetzen")
    def zuruecksetzen(player: str = Depends(angemeldet), ordner: str = P(...), body: dict[str, Any] = Body(...)):
        """Rollback auf eine ältere Version. Liegt die alte Version vor einer saveVersion-Erhöhung, wird gefragt,
        was mit den Spielständen passieren soll (E37): zurückholen oder behalten."""
        basis = ordnerpfad(player, ordner).parent
        vid = str(body.get("version", ""))
        ziel = basis / f"{ordner}{versionen.VERSION}{vid}"
        live = basis / ordner
        if not (versionen.VERSION_ID.match(vid) and ziel.is_dir()):
            raise HTTPException(404, "Version nicht gefunden")
        sv_ziel = release._save_version(release._meta(ziel)[0] or {})
        sv_live = release._save_version(release._meta(live)[0] or {}) if live.is_dir() else sv_ziel
        wahl = body.get("spielstaende")
        ergebnis = None
        if sv_ziel < sv_live:
            if wahl not in ("zuruecksetzen", "behalten"):
                nummer = (release.ordner_version(ziel) or {}).get("version") or "der alten Version"
                raise HTTPException(409, {
                    "frage": "spielstaende",
                    "text": f"Seit Version {nummer} wurden die Spielstände auf saveVersion {sv_live} umgewandelt. "
                            f"Version {nummer} kennt nur saveVersion {sv_ziel} und versteht die neuen Stände vermutlich nicht.",
                    "saveVersionZiel": sv_ziel, "saveVersionAktuell": sv_live})
            if wahl == "zuruecksetzen":
                ergebnis = speicher("POST", f"/intern/spielstaende-zurueck/{player}/{ordner}", {"bisSaveVersion": sv_ziel})
        try:
            versionen.zuruecksetzen(basis, ordner, vid)
        except FileNotFoundError as f:
            raise HTTPException(404, str(f)) from None
        release.zurueckgesetzt(basis, ordner, player, wahl if sv_ziel < sv_live else None)
        store.ereignis(player, f"auf Version {vid} zurückgesetzt", ordner)
        return {"ok": True, "spielstaende": ergebnis}

    # ---------- Steckbrief: Titel, Beschreibung, Vorschaubild (Zentrale 1.2.1) ----------

    def spiel_basis(player: str, ordner: str) -> Path:
        ziel = ordnerpfad(player, ordner)
        if not (ziel.is_dir() or versionen.entwurf(ziel.parent, ordner).is_dir()):
            raise HTTPException(404, "Spiel nicht gefunden")
        return ziel.parent

    def steckbrief_antwort(basis: Path, ordner: str) -> dict:
        quelle = basis / ordner if (basis / ordner).is_dir() else versionen.entwurf(basis, ordner)
        daten, _ = games.meta(quelle)
        sb = steckbrief.lesen(basis, ordner)
        bild = steckbrief.bild(basis, ordner)
        return {"title": sb.get("title", ""), "description": sb.get("description", ""),
                "gameJson": {"title": games._text(daten.get("title"), steckbrief.TITEL_MAX) or "",
                             "description": games._text(daten.get("description"), steckbrief.BESCHREIBUNG_MAX) or "",
                             "thumbnail": bool(daten.get("thumbnail"))},
                "vorschaubild": {"bytes": bild.stat().st_size, "stand": int(bild.stat().st_mtime)} if bild else None}

    @app.get("/api/upload/spiele/{ordner}/steckbrief")
    def steckbrief_lesen(player: str = Depends(angemeldet), ordner: str = P(...)):
        return steckbrief_antwort(spiel_basis(player, ordner), ordner)

    @app.put("/api/upload/spiele/{ordner}/steckbrief")
    def steckbrief_schreiben(player: str = Depends(angemeldet), ordner: str = P(...), body: dict[str, Any] = Body(...)):
        basis = spiel_basis(player, ordner)
        title, description = body.get("title"), body.get("description")
        if not all(x is None or isinstance(x, str) for x in (title, description)):
            raise HTTPException(422, "title und description müssen Text sein")
        steckbrief.schreiben(basis, ordner, title, description)
        store.ereignis(player, "Beschreibung geändert", ordner)
        return steckbrief_antwort(basis, ordner)

    @app.put("/api/upload/spiele/{ordner}/vorschaubild")
    def vorschaubild_hochladen(player: str = Depends(angemeldet), ordner: str = P(...), datei: UploadFile = File(...)):
        basis = spiel_basis(player, ordner)
        inhalt = datei.file.read(steckbrief.BILD_MAX + 1)
        try:
            steckbrief.bild_speichern(basis, ordner, inhalt)
        except steckbrief.UngueltigesBild as f:
            raise HTTPException(422, str(f)) from None
        store.ereignis(player, "Vorschaubild geändert", ordner)
        return steckbrief_antwort(basis, ordner)

    @app.delete("/api/upload/spiele/{ordner}/vorschaubild", status_code=204)
    def vorschaubild_loeschen(player: str = Depends(angemeldet), ordner: str = P(...)):
        steckbrief.bild_loeschen(spiel_basis(player, ordner), ordner)

    @app.get("/api/upload/spiele/{ordner}/vorschaubild")
    def vorschaubild_zeigen(player: str = Depends(angemeldet), ordner: str = P(...)):
        bild = steckbrief.bild(spiel_basis(player, ordner), ordner)
        if not bild:
            raise HTTPException(404, "kein Vorschaubild")
        return FileResponse(bild, media_type=steckbrief.ARTEN[bild.suffix[1:]],
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                     "Content-Security-Policy": "default-src 'none'; sandbox"})

    @app.delete("/api/upload/spiele/{ordner}", status_code=204)
    def loeschen(player: str = Depends(angemeldet), ordner: str = P(...)):
        ziel = ordnerpfad(player, ordner)
        if not versionen.alles_loeschen(ziel.parent, ordner):
            raise HTTPException(404, "Spiel nicht gefunden")
        release.verlauf_loeschen(ziel.parent, ordner)
        steckbrief.alles_loeschen(ziel.parent, ordner)
        log.info("%s hat %s gelöscht (inkl. Entwurf und Versionen)", player, ordner)
        store.ereignis(player, "gelöscht", ordner)

    # ---------- interne Schnittstelle für den Speicher-Dienst (Admin-Panel) ----------
    # Caddy leitet /intern nie nach außen; zusätzlich ist ein geheimes Token nötig.
    token = os.environ.get("INTERN_TOKEN", "")

    def intern(request: Request) -> None:
        if not token or not hmac.compare_digest(request.headers.get("x-intern-token", ""), token):
            raise HTTPException(403, "kein Zugriff")

    def name_ok(name: str) -> str:
        if not BENUTZER_MUSTER.match(name or ""):
            raise HTTPException(422, "Benutzername ungültig")
        return name

    @app.get("/intern/entwickler", dependencies=[Depends(intern)])
    def i_liste():
        return [{"player": p, "angelegt": a} for p, a in store.liste()]

    @app.post("/intern/entwickler", status_code=201, dependencies=[Depends(intern)])
    def i_anlegen(body: dict[str, Any] = Body(...)):
        name = name_ok(body.get("name"))
        if store.vorhanden(name):
            raise HTTPException(409, f"{name} hat schon ein Upload-Konto")
        passwort = entwickler_anlegen(store, e.spiele_dir, name)
        store.ereignis(name, "Upload-Konto angelegt")
        return {"name": name, "passwort": passwort}

    @app.post("/intern/entwickler/{name}/passwort", dependencies=[Depends(intern)])
    def i_passwort(name: str = P(...)):
        name_ok(name)
        if not store.vorhanden(name):
            raise HTTPException(404, f"{name} hat kein Upload-Konto")
        passwort = entwickler_anlegen(store, e.spiele_dir, name, neu=False)
        store.ereignis(name, "neues Passwort")
        return {"name": name, "passwort": passwort}

    @app.delete("/intern/entwickler/{name}", status_code=204, dependencies=[Depends(intern)])
    def i_sperren(name: str = P(...)):
        if store.loeschen(name_ok(name)):
            store.ereignis(name, "Upload-Konto gelöscht")

    @app.delete("/intern/spiele/{user}/{ordner}", status_code=204, dependencies=[Depends(intern)])
    def i_spiel_loeschen(user: str = P(...), ordner: str = P(...)):
        name_ok(user)
        ziel = ordnerpfad(user, ordner)
        if not versionen.alles_loeschen(ziel.parent, ordner):
            raise HTTPException(404, "Spiel nicht gefunden")
        release.verlauf_loeschen(ziel.parent, ordner)
        steckbrief.alles_loeschen(ziel.parent, ordner)
        store.ereignis(user, "gelöscht (Admin)", ordner)

    @app.get("/intern/gesund", dependencies=[Depends(intern)])
    def i_gesund():
        """Für den Wächter (1.3.0): eigene Datenbank wirklich beschreiben, Spieleordner beschreibbar?"""
        try:
            store.schreibtest()
        except sqlite3.Error as f:
            raise HTTPException(503, f"Upload-Datenbank nicht beschreibbar ({f})") from None
        if not os.access(e.spiele_dir, os.W_OK):
            raise HTTPException(503, "Spieleordner nicht beschreibbar – Uploads schlagen fehl")
        return {"ok": True}

    @app.get("/intern/ereignisse", dependencies=[Depends(intern)])
    def i_ereignisse(player: str | None = None, limit: int = 25):
        return store.ereignisse(max(1, min(limit, 200)), player)

    return app


def app_factory() -> FastAPI:
    """Einstiegspunkt für uvicorn --factory."""
    return erstellen()
