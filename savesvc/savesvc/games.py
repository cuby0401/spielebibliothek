"""Spiele finden: Ordner-Scan unter /spiele/<benutzer>/<spiel>/ plus game.json."""

import json
import re
from pathlib import Path

from .auth import BENUTZER_MUSTER

ORDNER_MUSTER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
DATEI_MUSTER = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._/-]{0,199}$")


def gueltige_id(benutzer: str, ordner: str) -> bool:
    return bool(BENUTZER_MUSTER.match(benutzer) and ORDNER_MUSTER.match(ordner))


def spielordner(spiele_dir: Path, benutzer: str, ordner: str) -> Path | None:
    """Ordner des Spiels, falls die ID gültig ist und der Ordner existiert."""
    if not gueltige_id(benutzer, ordner):
        return None
    pfad = spiele_dir / benutzer / ordner
    return pfad if pfad.is_dir() and not pfad.is_symlink() else None


def meta(ordner: Path) -> tuple[dict, str | None]:
    """game.json lesen. Liefert (Daten, Warnung)."""
    datei = ordner / "game.json"
    if not datei.is_file():
        return {}, None
    try:
        daten = json.loads(datei.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}, "game.json ist kein gültiges JSON"
    if not isinstance(daten, dict):
        return {}, "game.json ist kein Objekt"
    return daten, None


def save_version(ordner: Path) -> int:
    v = meta(ordner)[0].get("saveVersion", 1)
    return v if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 1_000_000 else 1


def season(ordner: Path) -> int:
    s = meta(ordner)[0].get("leaderboardSeason", 1)
    return s if isinstance(s, int) and not isinstance(s, bool) and 1 <= s <= 1_000_000 else 1


FORMATE = ("zahl", "dezimal", "zeit", "text")
SPALTEN_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,30}$")
SPALTEN_MAX = 6


def bestenliste_einstellungen(ordner: Path) -> dict:
    """leaderboard aus game.json, bereinigt. Regeln (wer gewinnt, ein Eintrag pro Spieler) legt der
    Server fest – der Entwickler bestimmt nur Rangwert, Reihenfolge und Darstellung."""
    lb = meta(ordner)[0].get("leaderboard")
    lb = lb if isinstance(lb, dict) else {}
    spalten = []
    for s in lb.get("spalten") if isinstance(lb.get("spalten"), list) else []:
        if not isinstance(s, dict) or not isinstance(s.get("key"), str) or not SPALTEN_KEY.match(s["key"]):
            continue
        if s["key"] == "score" or any(x["key"] == s["key"] for x in spalten):
            continue
        spalten.append({
            "key": s["key"],
            "label": _text(s.get("label"), 30) or s["key"],
            "format": s.get("format") if s.get("format") in FORMATE else "zahl",
        })
        if len(spalten) == SPALTEN_MAX:
            break
    rang = lb.get("rangiertNach")
    if not any(s["key"] == rang and s["format"] != "text" for s in spalten):
        rang = "score"
    return {
        "enabled": lb.get("enabled") is True,
        "order": "asc" if lb.get("order") == "asc" else "desc",
        "label": _text(lb.get("label"), 30) or "Punkte",
        "format": lb.get("format") if lb.get("format") in FORMATE[:3] else "zahl",
        "rangiertNach": rang,
        "spalten": spalten,
    }


def _text(wert, laenge: int) -> str | None:
    return wert.strip()[:laenge] if isinstance(wert, str) and wert.strip() else None


def beschreibung(spiele_dir: Path, benutzer: str, ordner_name: str) -> dict:
    ordner = spiele_dir / benutzer / ordner_name
    daten, warnung = meta(ordner)
    bild = daten.get("thumbnail")
    if not (isinstance(bild, str) and DATEI_MUSTER.match(bild) and ".." not in bild and (ordner / bild).is_file()):
        bild = None
    return {
        "id": f"{benutzer}/{ordner_name}",
        "author": benutzer,                       # immer aus dem Ordner, nie aus game.json
        "title": _text(daten.get("title"), 80) or ordner_name,
        "description": _text(daten.get("description"), 300) or "",
        "thumbnail": bild,
        "saveVersion": save_version(ordner),
        "leaderboard": bestenliste_einstellungen(ordner),
        "leaderboardSeason": season(ordner),
        "complete": (ordner / "index.html").is_file(),
        "warning": warnung,
    }


def alle(spiele_dir: Path) -> list[dict]:
    ergebnis = []
    if not spiele_dir.is_dir():
        return ergebnis
    for benutzer in sorted(p for p in spiele_dir.iterdir() if p.is_dir() and not p.is_symlink()):
        if not BENUTZER_MUSTER.match(benutzer.name):
            continue  # z. B. #recycle
        for ordner in sorted(p for p in benutzer.iterdir() if p.is_dir() and not p.is_symlink()):
            if ORDNER_MUSTER.match(ordner.name):
                ergebnis.append(beschreibung(spiele_dir, benutzer.name, ordner.name))
    ergebnis.sort(key=lambda s: s["title"].lower())
    return ergebnis
