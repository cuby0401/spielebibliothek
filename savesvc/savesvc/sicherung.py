"""Nächtliche konsistente Kopie der Datenbank für borgmatic (Phase 8).

borgmatic (Container borg-hetzner) sichert um 02:00 /volume1/games/data/backup/, aber NICHT die laufende
saves.db (+ -wal/-shm), die mitten in einem Schreibvorgang inkonsistent sein könnte. Diese Kopie über die
SQLite-Backup-API entsteht hier im Dienst selbst – borgmatic braucht so keinen Zugriff auf den Docker-Socket.
"""

import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger("savesvc.sicherung")


def naechster_termin(jetzt: datetime, uhrzeit: str) -> datetime:
    stunde, minute = (int(x) for x in uhrzeit.split(":"))
    termin = jetzt.replace(hour=stunde, minute=minute, second=0, microsecond=0)
    return termin if termin > jetzt else termin + timedelta(days=1)


def starten(db, ziel: Path, uhrzeit: str = "01:45", zone: str = "Europe/Berlin") -> threading.Thread:
    tz = ZoneInfo(zone)

    def sichern():
        try:
            db.sichern(ziel)
            log.info("Datenbank gesichert nach %s", ziel)
        except Exception:  # Dienst soll weiterlaufen, Fehler steht im Log
            log.exception("Sicherung nach %s fehlgeschlagen", ziel)

    def schleife():
        sichern()  # beim Start, damit es sofort eine aktuelle Kopie gibt
        stopp = threading.Event()
        while True:
            jetzt = datetime.now(tz)
            stopp.wait((naechster_termin(jetzt, uhrzeit) - jetzt).total_seconds())
            sichern()

    t = threading.Thread(target=schleife, name="sicherung", daemon=True)
    t.start()
    return t
