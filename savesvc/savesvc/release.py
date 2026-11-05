"""Versionen der Spiele: Versionsnummer, gesammelte Änderungen, Prüfung vor dem Veröffentlichen (E35–E37).

Ablauf für Entwickler:
    1. Jeder Upload landet als Entwurf. Optional mit einer Zeile „Was hast du geändert?“ – die Zeilen
       werden gesammelt wie Commits, bis veröffentlicht wird.
    2. „Veröffentlichen …“ öffnet das Update-Fenster: Art des Updates wählen (Patch/Hotfix, kleines
       oder großes Update) → die Bibliothek vergibt die nächste Nummer MAJOR.MINOR.PATCH.
       Vorher läuft die Prüfung (pruefen() + Testergebnisse aus dem Speicher-Dienst).
    3. Beim Veröffentlichen wird aus den gesammelten Änderungen ein Eintrag im Versionsverlauf.

Ablage (versteckte Dateien – Caddy liefert sie unter play nie aus, ein ZIP kann sie nicht anlegen):
    spiele/<benutzer>/.<ordner>.versionen.json   Versionsverlauf + gesammelte Änderungen (bleibt bei Rollbacks)
    spiele/<benutzer>/<ordner>/.version.json     Nummer der Version, die in diesem Ordner liegt
                                                 (wandert beim Archivieren mit – so kennt jede alte Version ihre Nummer)

Die Versionsnummer vergibt nur die Bibliothek. „version“ in der game.json wird ignoriert.
saveVersion (game.json) ist davon unabhängig und steigt nur, wenn sich das Speicherformat ändert.
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

ARTEN = {"patch": "Patch / Hotfix", "minor": "Kleines Update", "major": "Großes Update"}
VERSION = re.compile(r"^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$")
AENDERUNG_MAX = 200          # Zeichen je Zeile
AENDERUNGEN_MAX = 50         # gesammelte Zeilen je Update
RELEASES_MAX = 200


def jetzt() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def zeile(text) -> str:
    return " ".join(str(text or "").split())[:AENDERUNG_MAX]


# ---------- Dateien ----------

def _verlauf_datei(basis: Path, ordner: str) -> Path:
    return basis / f".{ordner}.versionen.json"


def _json_lesen(datei: Path) -> dict:
    try:
        d = json.loads(datei.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError, UnicodeDecodeError):
        return {}


def _json_schreiben(datei: Path, daten: dict) -> None:
    tmp = datei.with_name(datei.name + ".neu")
    tmp.write_text(json.dumps(daten, ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(tmp, 0o660)
    tmp.replace(datei)


def verlauf(basis: Path, ordner: str) -> dict:
    d = _json_lesen(_verlauf_datei(basis, ordner))
    aend = [a for a in d.get("aenderungen", []) if isinstance(a, dict) and isinstance(a.get("text"), str)]
    rel = [r for r in d.get("releases", []) if isinstance(r, dict) and isinstance(r.get("version"), str)]
    return {"aenderungen": aend, "releases": rel}


def ordner_version(ordner: Path) -> dict | None:
    """{version, saveVersion} der Version, die in diesem Ordner liegt – None bei Spielen von vor E35."""
    d = _json_lesen(ordner / ".version.json")
    return d if isinstance(d.get("version"), str) and VERSION.match(d["version"]) else None


def verlauf_loeschen(basis: Path, ordner: str) -> None:
    _verlauf_datei(basis, ordner).unlink(missing_ok=True)


# ---------- Nummern ----------

def naechste(version: str | None, art: str) -> str:
    if art not in ARTEN:
        raise ValueError("art: patch, minor oder major")
    m = VERSION.match(version or "")
    if not m:
        return "1.0.0"   # erste Veröffentlichung (oder Spiel von vor der Versionierung)
    a, b, c = map(int, m.groups())
    return {"major": f"{a + 1}.0.0", "minor": f"{a}.{b + 1}.0", "patch": f"{a}.{b}.{c + 1}"}[art]


def vorschlaege(version: str | None) -> dict:
    return {art: naechste(version, art) for art in ARTEN}


# ---------- Änderungen und Veröffentlichung ----------

def aenderung_merken(basis: Path, ordner: str, text: str, wer: str) -> None:
    text = zeile(text)
    if not text:
        return
    d = verlauf(basis, ordner)
    d["aenderungen"] = (d["aenderungen"] + [{"text": text, "zeit": jetzt(), "von": wer}])[-AENDERUNGEN_MAX:]
    _json_schreiben(_verlauf_datei(basis, ordner), d)


def aenderungen_verwerfen(basis: Path, ordner: str) -> None:
    d = verlauf(basis, ordner)
    if d["aenderungen"]:
        d["aenderungen"] = []
        _json_schreiben(_verlauf_datei(basis, ordner), d)


def veroeffentlicht(basis: Path, ordner: str, version: str, art: str, save_version: int, aenderungen: list[str], wer: str) -> dict:
    """Nach dem Umbenennen Entwurf → live: Nummer in den Ordner schreiben, Eintrag im Verlauf anlegen."""
    eintrag = {"version": version, "art": art, "saveVersion": save_version, "zeit": jetzt(), "von": wer,
               "aenderungen": [z for z in (zeile(a) for a in aenderungen) if z][:AENDERUNGEN_MAX]}
    _json_schreiben(basis / ordner / ".version.json", {"version": version, "saveVersion": save_version, "zeit": eintrag["zeit"]})
    d = verlauf(basis, ordner)
    d["releases"] = (d["releases"] + [eintrag])[-RELEASES_MAX:]
    d["aenderungen"] = []
    _json_schreiben(_verlauf_datei(basis, ordner), d)
    return eintrag


def zurueckgesetzt(basis: Path, ordner: str, wer: str, spielstaende: str | None) -> dict | None:
    """Nach einem Rollback: Eintrag im Verlauf („zurückgesetzt auf 1.1.0“)."""
    v = ordner_version(basis / ordner)
    if not v:
        return None
    text = f"Zurückgesetzt auf Version {v['version']}"
    if spielstaende == "zuruecksetzen":
        text += " – Spielstände auf den passenden Stand zurückgeholt"
    eintrag = {"version": v["version"], "art": "rollback", "saveVersion": v.get("saveVersion"), "zeit": jetzt(), "von": wer,
               "aenderungen": [text]}
    d = verlauf(basis, ordner)
    d["releases"] = (d["releases"] + [eintrag])[-RELEASES_MAX:]
    _json_schreiben(_verlauf_datei(basis, ordner), d)
    return eintrag


def aktuell(basis: Path, ordner: str) -> dict | None:
    """Für die Bibliothek: Nummer der Live-Version und was darin neu ist."""
    v = ordner_version(basis / ordner)
    if not v:
        return None
    passend = [r for r in verlauf(basis, ordner)["releases"] if r["version"] == v["version"] and r.get("art") != "rollback"]
    r = passend[-1] if passend else {}
    return {"version": v["version"], "zeit": v.get("zeit") or r.get("zeit"), "art": r.get("art"),
            "aenderungen": r.get("aenderungen", [])}


# ---------- Prüfung vor dem Veröffentlichen ----------

ABSOLUT = re.compile(r"""(?:src|href)\s*=\s*["']/(?!lib/gamesave\.js|lib/localstorage-shim\.js)[^"'/]""", re.I)
EXTERN = re.compile(r"""<(?:script|link|img|audio|video|source)\b[^>]*?(?:src|href)\s*=\s*["'](?:https?:)?//""", re.I)
GAMESAVE = re.compile(r"""src\s*=\s*["']/lib/gamesave\.js["']""", re.I)


def _meta(ordner: Path) -> tuple[dict | None, str | None]:
    datei = ordner / "game.json"
    if not datei.is_file():
        return {}, None
    try:
        d = json.loads(datei.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None, "game.json ist kein gültiges JSON"
    return (d, None) if isinstance(d, dict) else (None, "game.json ist kein Objekt")


def _save_version(meta: dict) -> int:
    v = meta.get("saveVersion", 1)
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 1 else 1


def _html_dateien(ordner: Path, grenze: int = 40) -> list[Path]:
    return sorted(ordner.rglob("*.htm*"))[:grenze]


def pruefen(live: Path | None, entwurf: Path) -> dict:
    """Prüft den Entwurf gegen die Live-Version – nur anhand der Dateien.
    Liefert {"punkte": [{"stufe": "ok"|"hinweis"|"warnung"|"fehler", "text"}], "saveVersionAlt", "saveVersionNeu", "seasonEmpfohlen"}.
    Fehler blockieren das Veröffentlichen, Warnungen müssen bestätigt werden."""
    from . import games
    punkte: list[dict] = []
    p = lambda stufe, text: punkte.append({"stufe": stufe, "text": text})

    if not (entwurf / "index.html").is_file():
        p("fehler", "index.html fehlt – im ZIP muss index.html ganz oben liegen (oder in genau einem Ordner).")
    neu, fehler = _meta(entwurf)
    if fehler:
        p("fehler", fehler + " – die Bibliothek kann Titel, Spielstand-Version und Bestenliste nicht lesen.")
        neu = {}
    alt, _ = _meta(live) if live and live.is_dir() else ({}, None)
    alt = alt or {}

    sv_alt = _save_version(alt) if live and live.is_dir() else None
    sv_neu = _save_version(neu)
    if sv_alt is not None and sv_neu < sv_alt:
        p("fehler", f"saveVersion ist gesunken ({sv_alt} → {sv_neu}). Gespeicherte Stände sind schon auf {sv_alt} – "
                    "das neue Spiel würde sie nicht verstehen. saveVersion darf nur gleich bleiben oder steigen.")
    elif sv_alt is not None and sv_neu > sv_alt:
        p("hinweis", f"saveVersion steigt ({sv_alt} → {sv_neu}): Spielstände werden beim nächsten Laden umgewandelt. "
                     "Dafür braucht GameSave.load(…, { migration: { " + str(sv_neu) + ": … } }).")
    elif sv_alt is not None:
        p("ok", f"saveVersion bleibt {sv_neu} – Spielstände bleiben, wie sie sind.")

    if not neu.get("title"):
        p("hinweis", "Kein „title“ in der game.json – die Kachel zeigt den Ordnernamen.")

    season = False
    if live and live.is_dir():
        lb_alt = games.bestenliste_einstellungen(live)
        lb_neu = games.bestenliste_einstellungen(entwurf)
        if lb_alt["enabled"] and not lb_neu["enabled"]:
            p("warnung", "Die Bestenliste wird abgeschaltet. Die Einträge bleiben gespeichert, sind aber nicht mehr sichtbar.")
        elif lb_alt["enabled"] and lb_neu["enabled"]:
            weg = sorted({s["key"] for s in lb_alt["spalten"]} - {s["key"] for s in lb_neu["spalten"]})
            if lb_alt["rangiertNach"] != lb_neu["rangiertNach"] or lb_alt["order"] != lb_neu["order"]:
                season = True
                p("warnung", "Die Bestenliste wird anders sortiert (rangiertNach/order geändert). Alte und neue Einträge "
                             "sind nicht vergleichbar – eine neue Season ist empfohlen.")
            if weg:
                season = True
                p("warnung", f"Spalten der Bestenliste fallen weg: {', '.join(weg)}. Alte Einträge zeigen dort „–“ – "
                             "eine neue Season ist empfohlen.")

    html = _html_dateien(entwurf)
    inhalt = ""
    for datei in html:
        try:
            inhalt += datei.read_text(encoding="utf-8", errors="replace")[:500_000]
        except OSError:
            pass
    if html and not GAMESAVE.search(inhalt):
        p("warnung", "Keine HTML-Datei bindet /lib/gamesave.js ein – dann wird nichts gespeichert und es gibt keine Bestenliste. "
                     "Erste Zeile im <head>: <script src=\"/lib/gamesave.js\"></script>")
    if ABSOLUT.search(inhalt):
        p("warnung", "Absolute Pfade wie src=\"/…\" gefunden – die führen hier ins Leere (weiße Fläche). "
                     "Relativ schreiben: src=\"js/spiel.js\" statt src=\"/js/spiel.js\".")
    if EXTERN.search(inhalt):
        p("warnung", "Dateien von fremden Servern (CDN, https://…) gefunden – die werden blockiert (E20). Alles mitliefern.")

    return {"punkte": punkte, "saveVersionAlt": sv_alt, "saveVersionNeu": sv_neu, "seasonEmpfohlen": season}
