"""Admin-CLI im Container:

  python -m savesvc history <player> <game> <key>
  python -m savesvc restore <history-id>
  python -m savesvc backup /data/backup/saves-latest.db
  python -m savesvc reset-leaderboard <benutzer>/<spiel> [--season N]

Im Upload-Container (spielebibliothek-upload):
  python -m savesvc entwickler anlegen <name>     Upload-Konto + Spielordner; Passwort wird EINMAL angezeigt
  python -m savesvc entwickler passwort <name>    neues Passwort
  python -m savesvc entwickler sperren <name>     Upload-Konto löschen (Spiele und Spielstände bleiben)
  python -m savesvc entwickler liste
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
    lb = sub.add_parser("reset-leaderboard", help="Bestenliste eines Spiels löschen (alle Seasons oder eine)")
    lb.add_argument("game", help="<benutzer>/<spiel>")
    lb.add_argument("--season", type=int)
    en = sub.add_parser("entwickler", help="Upload-Konten (nur im Upload-Container)")
    en.add_argument("aktion", choices=["anlegen", "passwort", "sperren", "liste"])
    en.add_argument("name", nargs="?")
    a = p.parse_args(argv)

    if a.befehl == "entwickler":
        return entwickler(a.aktion, a.name)

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
    elif a.befehl == "reset-leaderboard":
        n = db.bestenliste_loeschen(a.game, a.season)
        welche = f"Season {a.season}" if a.season else "alle Seasons"
        print(f"{n} Scores gelöscht ({a.game}, {welche})")
    elif a.befehl == "backup":
        db.sichern(a.ziel)
        print(f"gesichert nach {a.ziel}")
    return 0


def entwickler(aktion: str, name: str | None) -> int:
    import os
    from .auth import BENUTZER_MUSTER, Benutzerliste
    from .upload import Entwickler, neues_passwort

    e = laden()
    store = Entwickler(Path(os.environ.get("UPLOAD_DATA", "/data")) / "upload.db")
    if aktion == "liste":
        for player, angelegt in store.liste():
            print(f"{player:<20} angelegt {angelegt}")
        return 0
    if not name or not BENUTZER_MUSTER.match(name):
        print("Name fehlt oder ungültig (klein, a–z, 0–9, _ und -)", file=sys.stderr)
        return 2
    if aktion == "sperren":
        print(f"{name} gelöscht" if store.loeschen(name) else f"{name} hatte kein Upload-Konto")
        return 0
    if aktion == "passwort" and not store.vorhanden(name):
        print(f"{name} hat kein Upload-Konto – erst anlegen", file=sys.stderr)
        return 1
    if name not in Benutzerliste(e.users_file).namen():
        print(f"Hinweis: {name} steht nicht in users.yaml – ohne Eintrag dort klappt die Anmeldung nicht.", file=sys.stderr)
    ordner = e.spiele_dir / name
    if aktion == "anlegen":
        ordner.mkdir(mode=0o770, exist_ok=True)   # erbt die Default-ACLs von spiele/
    passwort = neues_passwort()
    store.setzen(name, passwort)
    print()
    print(f"Benutzer:  {name}")
    print(f"Passwort:  {passwort}")
    print(f"Ordner:    {ordner}")
    print()
    print("Passwort jetzt notieren und persönlich weitergeben – es wird nur als Hash gespeichert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
