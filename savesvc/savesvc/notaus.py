"""Not-Aus (Zentrale 1.4.0, E72): Bei Verdacht auf ein Datenleck trennt ein Admin die Bibliothek sofort vom Internet.

Ablauf:
  1. Admin-Panel → „Not-Aus“ (oder am Mac: scripts/deploy.sh --notaus) schreibt /config/notaus.json.
  2. Ab dieser Sekunde beantworten Speicher-Dienst und Upload-Dienst JEDE Anfrage mit 503 – es kommen keine Daten mehr heraus.
     Beide lesen dieselbe Datei (config/ ist im Upload-Container nur lesbar eingebunden).
  3. Der Auftragsdienst auf der NAS (jede Minute) sieht die Datei und stoppt den Tunnel (spielebibliothek-cloudflared).
     Solange sie da ist, spielen weder er noch nas-deploy.sh etwas ein – ein Deploy würde den Tunnel wieder starten.
  4. Wieder einschalten geht NUR vom Mac: scripts/deploy.sh --notaus-aus. Wer ein Admin-Konto gekapert hat, kann
     den Not-Aus also nicht rückgängig machen.

Jedes Ein- und Ausschalten steht im Sicherheitsprotokoll (Tabelle sicherheit, ein Jahr aufbewahrt).
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

DATEINAME = "notaus.json"
MELDUNG = "Not-Aus aktiv – die Spielebibliothek ist vorübergehend abgeschaltet."


def pfad(config_dir: Path) -> Path:
    return Path(config_dir) / DATEINAME


def aktiv(config_dir: Path) -> dict | None:
    """Zustand des Not-Aus – None, wenn aus. Eine unlesbare Datei gilt als AN (lieber zu vorsichtig)."""
    p = pfad(config_dir)
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {"zeit": None, "von": "?", "grund": ""}
    except (OSError, ValueError):
        return {"zeit": None, "von": "?", "grund": "(Datei unlesbar)"}


def einschalten(config_dir: Path, db, von: str, grund: str) -> dict:
    d = {"zeit": datetime.now(timezone.utc).isoformat(timespec="seconds"), "von": von[:60], "grund": grund.strip()[:300]}
    p = pfad(config_dir)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o644)   # der Upload-Container (anderer Benutzer) muss sie lesen können
    tmp.replace(p)
    db.sicherheit_eintragen("notaus-ein", von, d["grund"] or "(ohne Grund)")
    return d


def ausschalten(config_dir: Path, db, von: str) -> bool:
    p = pfad(config_dir)
    if not p.exists():
        return False
    vorher = aktiv(config_dir) or {}
    p.unlink()
    db.sicherheit_eintragen("notaus-aus", von, f"war an seit {vorher.get('zeit') or '?'} (von {vorher.get('von') or '?'})")
    return True
