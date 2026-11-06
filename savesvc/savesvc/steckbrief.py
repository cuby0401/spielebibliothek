"""Steckbrief eines Spiels (Zentrale 1.3.0): Titel, Beschreibung und Vorschaubild direkt auf der Upload-Seite pflegen.

Liegt neben dem Spielordner (wie der Versionsverlauf), damit er Uploads, Veröffentlichen und Zurücksetzen übersteht:
    <entwickler>/.<ordner>.steckbrief.json     {"title": "...", "description": "..."}
    <entwickler>/.<ordner>.vorschau.<png|jpg|webp>
Was hier steht, gilt vor der game.json. Leere Felder fallen auf die game.json zurück.
Das Bild wird vom Speicher-Dienst unter /api/vorschau/<entwickler>/<ordner> ausgeliefert (nur mit Anmeldung).
SVG ist absichtlich nicht erlaubt: Es läge auf games.cuby0401.uk und könnte dort Skripte enthalten.
"""

import json
from pathlib import Path

TITEL_MAX = 80
BESCHREIBUNG_MAX = 300
BILD_MAX = 2 * 1024 * 1024
ARTEN = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class UngueltigesBild(ValueError):
    pass


def _datei(basis: Path, ordner: str) -> Path:
    return basis / f".{ordner}.steckbrief.json"


def lesen(basis: Path, ordner: str) -> dict:
    try:
        d = json.loads(_datei(basis, ordner).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in d.items() if k in ("title", "description") and isinstance(v, str) and v.strip()}


def schreiben(basis: Path, ordner: str, title: str | None, description: str | None) -> dict:
    daten = {}
    if title and title.strip():
        daten["title"] = " ".join(title.split())[:TITEL_MAX]
    if description and description.strip():
        daten["description"] = " ".join(description.split())[:BESCHREIBUNG_MAX]
    p = _datei(basis, ordner)
    if daten:
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(daten, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)
    else:
        p.unlink(missing_ok=True)
    return daten


def art_von(inhalt: bytes) -> str:
    """Bildart an den ersten Bytes erkennen – die Dateiendung zählt nicht."""
    if inhalt.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if inhalt.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if inhalt[:4] == b"RIFF" and inhalt[8:12] == b"WEBP":
        return "webp"
    raise UngueltigesBild("Nur PNG, JPG oder WebP als Vorschaubild")


def bild(basis: Path, ordner: str) -> Path | None:
    for endung in ARTEN:
        p = basis / f".{ordner}.vorschau.{endung}"
        if p.is_file():
            return p
    return None


def bild_speichern(basis: Path, ordner: str, inhalt: bytes) -> Path:
    if not inhalt:
        raise UngueltigesBild("Leere Datei")
    if len(inhalt) > BILD_MAX:
        raise UngueltigesBild("Vorschaubild zu groß (max. 2 MB)")
    endung = art_von(inhalt)
    bild_loeschen(basis, ordner)
    ziel = basis / f".{ordner}.vorschau.{endung}"
    tmp = basis / f".{ordner}.vorschau.tmp"
    tmp.write_bytes(inhalt)
    tmp.replace(ziel)
    return ziel


def bild_loeschen(basis: Path, ordner: str) -> bool:
    weg = False
    for endung in ARTEN:
        p = basis / f".{ordner}.vorschau.{endung}"
        if p.is_file():
            p.unlink()
            weg = True
    return weg


def alles_loeschen(basis: Path, ordner: str) -> None:
    _datei(basis, ordner).unlink(missing_ok=True)
    bild_loeschen(basis, ordner)
