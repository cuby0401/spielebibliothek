"""Entwürfe und Versionen eines Spiels (Ideen „Entwürfe“ und „Versionen und Rückgängig“, 05.11.2026).

Alles liegt neben dem Spielordner in spiele/<benutzer>/:
    snake/                     live – sehen alle
    snake~entwurf/             Entwurf – nur Entwickler und Admin (über die Bibliothek testbar)
    snake~v20261105143012/     ältere Versionen (die letzten VERSIONEN_MAX)
„~“ kommt in normalen Spielnamen nicht vor (ORDNER_MUSTER) – solche Ordner erscheinen nie als eigenes Spiel.
"""

import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

ENTWURF = "~entwurf"
VERSION = "~v"
VERSIONEN_MAX = 5
VERSION_ID = re.compile(r"^\d{14}(-\d{1,3})?$")


def entwurf(basis: Path, ordner: str) -> Path:
    return basis / f"{ordner}{ENTWURF}"


def _info(pfad: Path) -> dict:
    dateien = [f for f in pfad.rglob("*") if f.is_file()]
    zeit = max((f.stat().st_mtime for f in dateien), default=pfad.stat().st_mtime)
    return {"dateien": len(dateien), "bytes": sum(f.stat().st_size for f in dateien),
            "geaendert": datetime.fromtimestamp(zeit, timezone.utc).isoformat(timespec="seconds")}


def entwurf_info(basis: Path, ordner: str) -> dict | None:
    p = entwurf(basis, ordner)
    return _info(p) if p.is_dir() else None


def versionen(basis: Path, ordner: str) -> list[dict]:
    """Neueste zuerst. id = Zeitstempel der Archivierung (UTC)."""
    ergebnis = []
    if not basis.is_dir():
        return ergebnis
    for p in basis.iterdir():
        if p.is_dir() and p.name.startswith(ordner + VERSION):
            vid = p.name[len(ordner) + len(VERSION):]
            if VERSION_ID.match(vid):
                zeit = datetime.strptime(vid[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                ergebnis.append({"id": vid, "archiviert": zeit.isoformat(timespec="seconds"), **_info(p)})
    return sorted(ergebnis, key=lambda v: v["id"], reverse=True)


def archivieren(basis: Path, ordner: str) -> str | None:
    """Live-Ordner zur Version machen (wird beim Veröffentlichen/Zurücksetzen/Direkt-Upload aufgerufen)."""
    live = basis / ordner
    if not live.is_dir():
        return None
    vid = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    ziel, n = basis / f"{ordner}{VERSION}{vid}", 1
    while ziel.exists():
        ziel = basis / f"{ordner}{VERSION}{vid}-{n}"; n += 1
    live.rename(ziel)
    aufraeumen(basis, ordner)
    return ziel.name[len(ordner) + len(VERSION):]


def aufraeumen(basis: Path, ordner: str) -> None:
    for alt in versionen(basis, ordner)[VERSIONEN_MAX:]:
        shutil.rmtree(basis / f"{ordner}{VERSION}{alt['id']}", ignore_errors=True)


def veroeffentlichen(basis: Path, ordner: str) -> None:
    e = entwurf(basis, ordner)
    if not e.is_dir():
        raise FileNotFoundError("kein Entwurf vorhanden")
    archivieren(basis, ordner)
    e.rename(basis / ordner)


def zuruecksetzen(basis: Path, ordner: str, vid: str) -> None:
    if not VERSION_ID.match(vid or ""):
        raise FileNotFoundError("Version nicht gefunden")
    v = basis / f"{ordner}{VERSION}{vid}"
    if not v.is_dir():
        raise FileNotFoundError("Version nicht gefunden")
    archivieren(basis, ordner)          # aktuelle Live-Version bleibt als Version erhalten
    v.rename(basis / ordner)


def alles_loeschen(basis: Path, ordner: str) -> bool:
    gefunden = False
    for p in [basis / ordner, entwurf(basis, ordner)] + [basis / f"{ordner}{VERSION}{v['id']}" for v in versionen(basis, ordner)]:
        if p.is_dir():
            shutil.rmtree(p); gefunden = True
    return gefunden
