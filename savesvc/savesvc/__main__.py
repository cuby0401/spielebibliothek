"""Admin-CLI im Container:

  python -m savesvc history <player> <game> <key>
  python -m savesvc restore <history-id>
  python -m savesvc backup /data/backup/saves-latest.db
"""

import argparse
import sys
from pathlib import Path

from .config import laden
from .db import Datenbank


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m savesvc")
    sub = p.add_subparsers(dest="befehl", required=True)
    h = sub.add_parser("history", help="alte Stände eines Spielstands anzeigen")
    h.add_argument("player"); h.add_argument("game", help="<benutzer>/<spiel>"); h.add_argument("key")
    r = sub.add_parser("restore", help="alten Stand wiederherstellen")
    r.add_argument("history_id", type=int)
    b = sub.add_parser("backup", help="konsistente Kopie der Datenbank")
    b.add_argument("ziel", type=Path)
    a = p.parse_args(argv)

    db = Datenbank(laden().db_path)
    if a.befehl == "history":
        zeilen = db.verlauf(a.player, a.game, a.key)
        if not zeilen:
            print("kein Verlauf")
        for z in zeilen:
            print(f"{z['id']:>6}  {z['saved_at']}  saveVersion {z['save_version']}  {z['bytes']} Bytes")
    elif a.befehl == "restore":
        try:
            ziel = db.wiederherstellen(a.history_id)
        except KeyError:
            print(f"Verlauf-ID {a.history_id} gibt es nicht", file=sys.stderr)
            return 1
        print(f"wiederhergestellt: {ziel['player']} · {ziel['game']} · {ziel['key']} (aktueller Stand liegt jetzt im Verlauf)")
    elif a.befehl == "backup":
        db.sichern(a.ziel)
        print(f"gesichert nach {a.ziel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
