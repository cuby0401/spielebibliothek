import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

from savesvc import sicherung
from savesvc.db import Datenbank

TZ = ZoneInfo("Europe/Berlin")


def test_naechster_termin():
    assert sicherung.naechster_termin(datetime(2026, 11, 5, 1, 0, tzinfo=TZ), "01:45") == datetime(2026, 11, 5, 1, 45, tzinfo=TZ)
    assert sicherung.naechster_termin(datetime(2026, 11, 5, 1, 45, tzinfo=TZ), "01:45") == datetime(2026, 11, 6, 1, 45, tzinfo=TZ)
    assert sicherung.naechster_termin(datetime(2026, 11, 5, 23, 0, tzinfo=TZ), "01:45") == datetime(2026, 11, 6, 1, 45, tzinfo=TZ)


def test_sicherung_beim_start(tmp_path):
    db = Datenbank(tmp_path / "saves.db")
    db.speichern("seb", "seb/zaehler", "stand", {"zahl": 7}, 1)
    ziel = tmp_path / "backup" / "saves-latest.db"
    t = sicherung.starten(db, ziel)
    for _ in range(50):
        if ziel.exists():
            break
        t.join(0.1)
    v = sqlite3.connect(ziel)
    assert v.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert v.execute("SELECT data FROM saves").fetchone()[0] == '{"zahl":7}'
