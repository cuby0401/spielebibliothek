"""Admin-CLI im Container:

  python -m savesvc history <player> <game> <key>
  python -m savesvc restore <history-id>
  python -m savesvc backup /data/backup/saves-latest.db
  python -m savesvc reset-leaderboard <benutzer>/<spiel> [--season N]
  python -m savesvc cloudflare-soll               Welche E-Mails in „Kollegen“/„Entwickler“ gehören (JSON, für scripts/cloudflare.py)
  python -m savesvc cloudflare-lesetoken          Nur-Lese-Schlüssel von stdin prüfen und nach /data legen (Modus 600)

Für den Auftragsdienst (scripts/auftragsdienst.py, 1.3.0) – nur per docker exec von der NAS aus:
  python -m savesvc auftraege-holen               wartende Aufträge als JSON, werden dabei auf „läuft“ gesetzt
  python -m savesvc auftrag-fertig                Ergebnis von stdin (JSON) eintragen, bei Fehler Glocke + Home Assistant
  python -m savesvc lebenszeichen <version>       „Auftragsdienst läuft“ fürs Admin-Panel und den Wächter
  python -m savesvc live-status                   (Probe) Stand des Live-Deploys nach der Freigabe von stdin (JSON)

Not-Aus (Zentrale 1.4.0) – vom Mac über scripts/deploy.sh --notaus / --notaus-aus:
  python -m savesvc notaus ein|aus|status [--von NAME] [--grund TEXT]

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
    sub.add_parser("cloudflare-soll", help="Soll-Stand der Cloudflare-Richtlinien als JSON")
    sub.add_parser("cloudflare-lesetoken", help="Nur-Lese-Schlüssel von stdin hinterlegen")
    sub.add_parser("auftraege-holen", help="für den Auftragsdienst")
    sub.add_parser("auftrag-fertig", help="für den Auftragsdienst")
    lz = sub.add_parser("lebenszeichen", help="für den Auftragsdienst")
    lz.add_argument("version")
    sub.add_parser("live-status", help="für den Auftragsdienst (Probe)")
    na = sub.add_parser("notaus", help="Not-Aus ein/aus/status (vom Mac über scripts/deploy.sh --notaus / --notaus-aus)")
    na.add_argument("aktion", choices=["ein", "aus", "status"])
    na.add_argument("--von", default="mac")
    na.add_argument("--grund", default="")
    a = p.parse_args(argv)
    if a.befehl == "notaus":
        from . import notaus
        e = laden()
        db = Datenbank(e.db_path)
        if a.aktion == "ein":
            d = notaus.einschalten(e.users_file.parent, db, a.von, a.grund)
            print(f"Not-Aus AN seit {d['zeit']}")
        elif a.aktion == "aus":
            print("Not-Aus aus" if notaus.ausschalten(e.users_file.parent, db, a.von) else "Not-Aus war nicht an")
        else:
            d = notaus.aktiv(e.users_file.parent)
            print(f"AN seit {d.get('zeit')} von {d.get('von')}: {d.get('grund')}" if d else "aus")
        return 0
    if a.befehl in ("auftraege-holen", "auftrag-fertig", "lebenszeichen", "live-status"):
        return auftragsdienst(a, sys.stdin)

    if a.befehl == "entwickler":
        return entwickler(a.aktion, a.name)
    if a.befehl == "cloudflare-soll":
        return cloudflare_soll()
    if a.befehl == "cloudflare-lesetoken":
        return cloudflare_lesetoken(sys.stdin.read())

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
    from .upload import Entwickler, entwickler_anlegen

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
    passwort = entwickler_anlegen(store, e.spiele_dir, name, neu=(aktion == "anlegen"))
    print()
    print(f"Benutzer:  {name}")
    print(f"Passwort:  {passwort}")
    print(f"Ordner:    {ordner}")
    print()
    print("Passwort jetzt notieren und persönlich weitergeben – es wird nur als Hash gespeichert.")
    return 0


def auftragsdienst(a, eingabe) -> int:
    import json
    from . import auftraege
    from .auth import BENUTZER_MUSTER
    e = laden()
    db = Datenbank(e.db_path)
    if a.befehl == "auftraege-holen":
        print(json.dumps(db.auftraege_holen()))
    elif a.befehl == "lebenszeichen":
        db.dienst_setzen("auftragsdienst", a.version[:40])
    elif a.befehl == "live-status":
        d = json.loads(eingabe.read())
        erlaubt = {k: str(d[k])[:4000] for k in ("status", "zeit", "version", "commit", "text") if k in d}
        ziel = e.db_path.parent / "live-status.json"
        tmp = ziel.with_suffix(".tmp")
        tmp.write_text(json.dumps(erlaubt, ensure_ascii=False), encoding="utf-8")
        tmp.replace(ziel)
    elif a.befehl == "auftrag-fertig":
        d = json.loads(eingabe.read())
        status = d.get("status")
        if status not in ("ok", "fehler", "laeuft"):
            print("status: ok, fehler oder laeuft", file=sys.stderr)
            return 2
        art = d.get("art") if d.get("art") in auftraege.ANZEIGE else None
        ziel = d.get("ziel") if d.get("ziel") in auftraege.ZIELE else None
        aid = db.auftrag_fertig(d.get("id") if isinstance(d.get("id"), int) else None, status,
                                str(d.get("zusammenfassung", ""))[:500], str(d.get("log", "")), art=art, ziel=ziel, start=d.get("start"))
        if status == "fehler":
            from .waechter import ha_senden
            text = f"{auftraege.ANZEIGE.get(art or (db.auftrag(aid) or {}).get('art'), 'Aufgabe')} fehlgeschlagen: {str(d.get('zusammenfassung', ''))[:150]}"
            for admin_name in sorted(n for n in e.admins if BENUTZER_MUSTER.match(n)):
                db.melden(admin_name, text, "/admin/#aufgaben", wichtig=True)
            ha_senden(e, "problem", "Spielebibliothek: " + text)
        print(json.dumps({"id": aid}))
    return 0


def cloudflare_soll() -> int:
    import json
    from . import cloudflare
    from .auth import Benutzerliste
    from .verwaltung import UploadDienst
    e = laden()
    benutzer = Benutzerliste(e.users_file).alle()
    entw = {z["player"] for z in UploadDienst(e.upload_url, e.intern_token)("GET", "/intern/entwickler")}
    s = cloudflare.soll(benutzer, entw)
    print(json.dumps({"kollegen": sorted(s["kollegen"]), "entwickler": sorted(s["entwickler"]),
                      "geschuetzt": sorted(m.lower() for m, n in benutzer.items() if n in e.admins),
                      "richtlinien": {"kollegen": e.richtlinie_kollegen, "entwickler": e.richtlinie_entwickler},
                      "konto": e.cloudflare_konto}))
    return 0


def cloudflare_lesetoken(text: str) -> int:
    """Erst ausprobieren, dann speichern – nur für den Speicher-Dienst lesbar (Modus 600)."""
    import os
    from . import cloudflare
    e = laden()
    schluessel = text.strip()
    if not 20 <= len(schluessel) <= 200 or any(c.isspace() for c in schluessel):
        print("Schlüssel sieht nicht richtig aus (eine Zeile, 20–200 Zeichen)", file=sys.stderr)
        return 2
    try:
        anzahl = len(cloudflare.Api(schluessel, e.cloudflare_konto).richtlinien())
    except cloudflare.CloudflareFehler as f:
        print(f"Nicht gespeichert: {f}", file=sys.stderr)
        return 1
    ziel = e.cloudflare_schluessel
    tmp = ziel.with_suffix(".tmp")
    alt = os.umask(0o077)
    try:
        tmp.write_text(schluessel + "\n", encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(ziel)
    finally:
        os.umask(alt)
    print(f"Nur-Lese-Schlüssel gespeichert ({anzahl} Richtlinien lesbar). Das Admin-Panel zeigt den Abgleich ab sofort.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
