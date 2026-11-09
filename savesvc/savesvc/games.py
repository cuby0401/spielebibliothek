"""Spiele finden: Ordner-Scan unter /spiele/<benutzer>/<spiel>/ plus game.json."""

import json
import logging
import re
from pathlib import Path

from . import identitaet

from .auth import BENUTZER_MUSTER

log = logging.getLogger("savesvc.games")

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


TAGS_MAX = 5
ERFOLG_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
ERFOLGE_MAX = 50


def tags(daten: dict) -> list[str]:
    """Kategorien aus der game.json ("tags": ["Puzzle", "Wörter"]) – höchstens 5, je 20 Zeichen."""
    roh = daten.get("tags") if isinstance(daten.get("tags"), list) else []
    ergebnis, gesehen = [], set()
    for t in roh:
        t = _text(t, 20)
        if t and t.lower() not in gesehen:
            gesehen.add(t.lower()); ergebnis.append(t)
        if len(ergebnis) == TAGS_MAX:
            break
    return ergebnis


def erfolge(ordner: Path) -> list[dict]:
    """Erfolge aus der game.json: [{ "id", "titel", "beschreibung", "bild", "geheim" }] (Zentrale 1.2.0)."""
    roh = meta(ordner)[0].get("erfolge")
    ergebnis, ids = [], set()
    for e in roh if isinstance(roh, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not ERFOLG_ID.match(e["id"]) or e["id"] in ids:
            continue
        bild = e.get("bild")
        if not (isinstance(bild, str) and DATEI_MUSTER.match(bild) and ".." not in bild and (ordner / bild).is_file()):
            bild = None
        ids.add(e["id"])
        ergebnis.append({"id": e["id"], "titel": _text(e.get("titel"), 60) or e["id"],
                         "beschreibung": _text(e.get("beschreibung"), 200) or "", "bild": bild, "geheim": e.get("geheim") is True})
        if len(ergebnis) == ERFOLGE_MAX:
            break
    return ergebnis


def _text(wert, laenge: int) -> str | None:
    return wert.strip()[:laenge] if isinstance(wert, str) and wert.strip() else None


def _geaendert(ordner: Path) -> str | None:
    from datetime import datetime, timezone
    try:
        datei = ordner / "index.html"
        zeit = (datei if datei.is_file() else ordner).stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(zeit, timezone.utc).isoformat(timespec="seconds")


NEU_DATEI = ".was-ist-neu.json"   # schreibt der Upload-Dienst; versteckt → wird unter play nie ausgeliefert
NEU_MAX = 200


def was_ist_neu(ordner: Path) -> dict | None:
    """Änderungstext der aktuellen Version (Idee „Was ist neu“, 05.11.2026)."""
    try:
        d = json.loads((ordner / NEU_DATEI).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    text = _text(d.get("text"), NEU_MAX) if isinstance(d, dict) else None
    zeit = d.get("zeit") if isinstance(d, dict) and isinstance(d.get("zeit"), str) else None
    return {"text": text, "zeit": zeit} if text else None


def _version_und_neu(basis: Path, ordner_name: str, ordner: Path) -> dict:
    """Versionsnummer (E35) und „Was ist neu“ (E32) – aus dem Versionsverlauf, sonst aus der alten .was-ist-neu.json."""
    from . import release
    akt = release.aktuell(basis, ordner_name)
    if akt and akt["aenderungen"]:
        neu = {"text": " · ".join(akt["aenderungen"])[:NEU_MAX * 2], "zeit": akt["zeit"], "aenderungen": akt["aenderungen"]}
    else:
        neu = was_ist_neu(ordner)
    return {"version": akt["version"] if akt else None, "neu": neu}


def beschreibung(spiele_dir: Path, benutzer: str, ordner_name: str) -> dict:
    ordner = spiele_dir / benutzer / ordner_name
    daten, warnung = meta(ordner)
    bild = daten.get("thumbnail")
    if not (isinstance(bild, str) and DATEI_MUSTER.match(bild) and ".." not in bild and (ordner / bild).is_file()):
        bild = None
    ergebnis = {
        "id": f"{benutzer}/{ordner_name}",
        # immer aus dem Ordner, nie aus game.json. Ab 1.5.0 die UUID des Besitzers (nach außen: sein aktuelles Handle);
        # der Ordner heißt weiter nach dem ersten Benutzernamen (E82). Im Upload-Dienst bleibt es der Ordnername.
        "author": identitaet.id_von_ordner(benutzer),
        "title": _text(daten.get("title"), 80) or ordner_name,
        "description": _text(daten.get("description"), 300) or "",
        "thumbnail": bild,
        "vorschau": None,
        "saveVersion": save_version(ordner),
        "leaderboard": bestenliste_einstellungen(ordner),
        "leaderboardSeason": season(ordner),
        "complete": (ordner / "index.html").is_file(),
        "geaendert": _geaendert(ordner),
        **_version_und_neu(spiele_dir / benutzer, ordner_name, ordner),
        "warning": warnung,
        "tags": tags(daten),
        "erfolgeAnzahl": len(erfolge(ordner)),
    }
    return _steckbrief_anwenden(ergebnis, spiele_dir / benutzer, ordner_name)


def _steckbrief_anwenden(b: dict, basis: Path, ordner_name: str) -> dict:
    """Steckbrief von der Upload-Seite (Zentrale 1.2.1) gilt vor der game.json – auch für Entwurf und alte Versionen."""
    from . import steckbrief
    name = re.split(r"~", ordner_name, maxsplit=1)[0]
    sb = steckbrief.lesen(basis, name)
    if sb.get("title"):
        b["title"] = sb["title"]
    if sb.get("description"):
        b["description"] = sb["description"]
    bild = steckbrief.bild(basis, name)
    if bild:
        try:
            stand = int(bild.stat().st_mtime)
        except OSError:
            stand = 0
        b["vorschau"] = f"/api/vorschau/{basis.name}/{name}?v={stand}"
    return b


def alle(spiele_dir: Path) -> list[dict]:
    ergebnis = []
    if not spiele_dir.is_dir():
        return ergebnis
    for benutzer in sorted(p for p in spiele_dir.iterdir() if p.is_dir() and not p.is_symlink()):
        if not BENUTZER_MUSTER.match(benutzer.name):
            continue  # z. B. #recycle
        try:
            ordner_liste = sorted(p for p in benutzer.iterdir() if p.is_dir() and not p.is_symlink())
        except OSError as fehler:   # ein unlesbarer Ordner darf nicht die ganze Liste kippen
            log.warning("Spielordner %s nicht lesbar: %s", benutzer.name, fehler)
            continue
        for ordner in ordner_liste:
            if ORDNER_MUSTER.match(ordner.name):
                try:
                    ergebnis.append(beschreibung(spiele_dir, benutzer.name, ordner.name))
                except OSError as fehler:
                    log.warning("Spiel %s/%s nicht lesbar: %s", benutzer.name, ordner.name, fehler)
    ergebnis.sort(key=lambda s: s["title"].lower())
    return ergebnis
