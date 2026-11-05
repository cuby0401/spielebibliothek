"""Upload-Dienst der Spielebibliothek (Phase 6b, ersetzt File Browser – E19).

Läuft als eigener Container (UID 10021, Schreibrecht nur auf /spiele) hinter upload.cuby0401.uk.
Zwei Stufen wie bisher (E5):
  1. Cloudflare Access, Anwendung "upload" (Richtlinie Entwickler, 15 min) → JWT mit eigener AUD
  2. eigenes Upload-Passwort pro Entwickler (scrypt), Sitzung 15 min, Sperre nach 5 Fehlversuchen

Entwickler werden nur per CLI im Container angelegt:  python -m savesvc entwickler anlegen <name>
"""

import hashlib
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

from fastapi import Body, Depends, FastAPI, File, HTTPException, Path as P, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse

from . import games, versionen, zipinstall
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

    def ereignisse(self, limit: int = 25) -> list[dict]:
        with self._v() as v:
            v.row_factory = sqlite3.Row
            return [dict(z) for z in v.execute("SELECT zeit, player, aktion, ordner, dateien FROM ereignisse ORDER BY id DESC LIMIT ?", (limit,))]


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


def erstellen(e: Einstellungen | None = None, schluessel_quelle=None, daten: Path | None = None) -> FastAPI:
    e = e or laden()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    daten = daten or Path(os.environ.get("UPLOAD_DATA", "/data"))
    sicher = os.environ.get("UPLOAD_COOKIE_SECURE", "1") != "0"
    store = Entwickler(daten / "upload.db")
    geheim = geheimnis(daten / "geheimnis")
    spieler = Pruefer(e, Benutzerliste(e.users_file), schluessel_quelle)
    app = FastAPI(title="Spielebibliothek – Upload", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def schutz(request: Request, weiter):
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

    @app.get("/api/upload/status")
    def status(request: Request, player: str = Depends(spieler)):
        return {
            "player": player,
            "entwickler": store.vorhanden(player),
            "angemeldet": cookie_gueltig(geheim, request.cookies.get(COOKIE, ""), player),
            "gesperrt": store.gesperrt(player),
        }

    @app.post("/api/upload/anmelden", status_code=204)
    def anmelden(response: Response, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        if not store.vorhanden(player):
            raise HTTPException(403, "kein Upload-Konto – bitte bei Seb melden")
        if store.gesperrt(player):
            raise HTTPException(429, f"zu viele Fehlversuche – in {SPERRE // 60} Minuten wieder versuchen")
        passwort = body.get("passwort")
        if not isinstance(passwort, str) or not store.pruefen(player, passwort):
            store.fehlversuch(player)
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
            ergebnis.append({
                "ordner": name,
                "title": b["title"],
                "complete": b["complete"],
                "warning": b["warning"],
                "live": versionen._info(live) if live.is_dir() else None,
                "entwurf": entw,
                "versionen": versionen.versionen(basis, name),
            })
        return ergebnis

    @app.post("/api/upload/spiele/{ordner}")
    def hochladen(player: str = Depends(angemeldet), ordner: str = P(...), datei: UploadFile = File(...),
                  entwurf: bool = Query(False)):
        ziel = ordnerpfad(player, ordner)
        basis = ziel.parent
        try:
            if entwurf:
                ergebnis = zipinstall.installieren(datei.file, versionen.entwurf(basis, ordner))
            else:
                ergebnis = zipinstall.installieren(datei.file, ziel, wegraeumen=lambda: versionen.archivieren(basis, ordner))
        except zipinstall.UngueltigesZip as fehler:
            raise HTTPException(422, str(fehler)) from None
        art = "als Entwurf hochgeladen" if entwurf else "hochgeladen"
        log.info("%s hat %s %s (%d Dateien)", player, ordner, art, ergebnis.dateien)
        store.ereignis(player, art, ordner, ergebnis.dateien)
        return {"ordner": ordner, "entwurf": entwurf, "dateien": ergebnis.dateien, "bytes": ergebnis.bytes,
                "uebersprungen": ergebnis.uebersprungen[:50]}

    @app.post("/api/upload/spiele/{ordner}/veroeffentlichen")
    def veroeffentlichen(player: str = Depends(angemeldet), ordner: str = P(...)):
        basis = ordnerpfad(player, ordner).parent
        try:
            versionen.veroeffentlichen(basis, ordner)
        except FileNotFoundError as f:
            raise HTTPException(404, str(f)) from None
        store.ereignis(player, "Entwurf veröffentlicht", ordner)
        return {"ok": True}

    @app.delete("/api/upload/spiele/{ordner}/entwurf", status_code=204)
    def entwurf_verwerfen(player: str = Depends(angemeldet), ordner: str = P(...)):
        e_pfad = versionen.entwurf(ordnerpfad(player, ordner).parent, ordner)
        if not e_pfad.is_dir():
            raise HTTPException(404, "kein Entwurf vorhanden")
        shutil.rmtree(e_pfad)
        store.ereignis(player, "Entwurf verworfen", ordner)

    @app.post("/api/upload/spiele/{ordner}/zuruecksetzen")
    def zuruecksetzen(player: str = Depends(angemeldet), ordner: str = P(...), body: dict[str, Any] = Body(...)):
        basis = ordnerpfad(player, ordner).parent
        try:
            versionen.zuruecksetzen(basis, ordner, str(body.get("version", "")))
        except FileNotFoundError as f:
            raise HTTPException(404, str(f)) from None
        store.ereignis(player, f"auf Version {body.get('version')} zurückgesetzt", ordner)
        return {"ok": True}

    @app.delete("/api/upload/spiele/{ordner}", status_code=204)
    def loeschen(player: str = Depends(angemeldet), ordner: str = P(...)):
        ziel = ordnerpfad(player, ordner)
        if not versionen.alles_loeschen(ziel.parent, ordner):
            raise HTTPException(404, "Spiel nicht gefunden")
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
        store.ereignis(user, "gelöscht (Admin)", ordner)

    @app.get("/intern/ereignisse", dependencies=[Depends(intern)])
    def i_ereignisse():
        return store.ereignisse()

    return app


def app_factory() -> FastAPI:
    """Einstiegspunkt für uvicorn --factory."""
    return erstellen()
