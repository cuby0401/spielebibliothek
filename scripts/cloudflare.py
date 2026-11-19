#!/usr/bin/env python3
"""Cloudflare-Richtlinien „Kollegen“ und „Entwickler“ mit der Benutzerliste abgleichen – NUR vom Mac aus (Zentrale 1.3.0).

  python3 scripts/cloudflare.py pruefen              zeigt, was fehlt oder zu viel ist (ändert nichts)
  python3 scripts/cloudflare.py abgleichen           fehlende E-Mails eintragen – nach Anzeige und Bestätigung
  python3 scripts/cloudflare.py abgleichen --entfernen   zusätzlich E-Mails entfernen, die nicht mehr in der Bibliothek sind
  python3 scripts/cloudflare.py wiederherstellen <sicherung.json>   eine Richtlinie auf eine Sicherung zurücksetzen
  python3 scripts/cloudflare.py lesetoken            Nur-Lese-Schlüssel für das Admin-Panel auf den Server legen

Sicherheit (warum so umständlich, siehe auch docs/cloudflare-abgleich.md):
  - Der Schreib-Schlüssel kann in Cloudflare JEDE Access-Richtlinie ändern. Er liegt nur im macOS-Schlüsselbund
    (Dienst „spielebibliothek-cloudflare“) und nie auf der NAS, in Dateien, in der Shell-History oder im Repo.
  - Geschrieben wird nur eine wiederverwendbare Richtlinie mit genau dem erwarteten Namen, Aktion „allow“ und
    ausschließlich E-Mail-Regeln. Alles andere bricht ab – solche Richtlinien bitte von Hand pflegen.
  - Vor dem Schreiben: Anzeige aller Änderungen, Bestätigung mit „ja“, Sicherung als JSON in
    ~/Library/Application Support/spielebibliothek/cloudflare/. Admins (seb) werden nie entfernt, eine Richtlinie wird nie
    leer, mehr als 3 Entfernungen auf einmal nur mit --viele.
  - Danach: Richtlinie neu lesen und prüfen, dass genau die gewünschten E-Mails drinstehen und sich sonst nichts geändert hat.
"""

import argparse
import getpass
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "savesvc"))
from savesvc import cloudflare as cf  # noqa: E402  (bewusst ohne Abhängigkeiten, siehe Modul)

def _lokal(name: str, standard: str | None = None) -> str:
    """Wert aus der Umgebung oder lokal.env im Repo-Wurzelordner (nicht im Git, Vorlage lokal.env.example)."""
    if os.environ.get(name):
        return os.environ[name]
    datei = Path(__file__).resolve().parents[1] / "lokal.env"
    if datei.is_file():
        for zeile in datei.read_text(encoding="utf-8").splitlines():
            k, _, v = zeile.partition("=")
            if k.strip() == name and not zeile.lstrip().startswith("#"):
                return v.strip()
    if standard is not None:
        return standard
    raise SystemExit(f"{name} fehlt: lokal.env im Repo-Wurzelordner anlegen (Vorlage lokal.env.example).")


# Wo die Zentrale läuft (SERVER_ORT in lokal.env, seit 20.11.2026): nas oder vm – wie scripts/lokal.sh
SERVER_ORT = _lokal("SERVER_ORT", "nas")
if SERVER_ORT not in ("nas", "vm"):
    raise SystemExit(f"SERVER_ORT in lokal.env muss nas oder vm sein, ist: {SERVER_ORT}")
SERVER = _lokal("VM" if SERVER_ORT == "vm" else "NAS")
ABLAGE = "/opt/stacks" if SERVER_ORT == "vm" else "/volume1/docker"
CONTAINER = "spielebibliothek-savesvc"
SCHLUESSELBUND = ("spielebibliothek-cloudflare", "schreiben")    # Dienst, Konto
SICHERUNGEN = Path.home() / "Library/Application Support/spielebibliothek/cloudflare"


def ssh(befehl: list[str], eingabe: str | None = None) -> str:
    r = subprocess.run(["ssh", "-o", "LogLevel=ERROR", SERVER, *befehl], input=eingabe, capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise SystemExit(f"Server ({SERVER_ORT}): {r.stderr.strip() or r.stdout.strip() or 'Fehler ' + str(r.returncode)}")
    return r.stdout


def soll_vom_server() -> dict:
    # Nur im Container lesen – nie sqlite3/users.yaml direkt auf dem Host anfassen (06.11.2026)
    return json.loads(ssh(["docker", "exec", CONTAINER, "python", "-m", "savesvc", "cloudflare-soll"]))


def schreib_schluessel() -> str:
    r = subprocess.run(["security", "find-generic-password", "-s", SCHLUESSELBUND[0], "-a", SCHLUESSELBUND[1], "-w"],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("Kein Schreib-Schlüssel im Schlüsselbund. Einmalig hinterlegen (fragt verdeckt nach dem Schlüssel):\n"
                         f"  security add-generic-password -s {SCHLUESSELBUND[0]} -a {SCHLUESSELBUND[1]} -w\n"
                         "Wie der Schlüssel angelegt wird: docs/cloudflare-abgleich.md")
    return r.stdout.strip()


def api(soll: dict) -> cf.Api:
    konto = soll.get("konto") or os.environ.get("CF_ACCOUNT_ID", "")
    return cf.Api(schreib_schluessel(), konto)


def sichern(richtlinie: dict) -> Path:
    SICHERUNGEN.mkdir(parents=True, exist_ok=True, mode=0o700)
    basis = f"{time.strftime('%Y%m%d-%H%M%S')}-{richtlinie['name']}"
    p, n = SICHERUNGEN / f"{basis}.json", 1
    while p.exists():                  # nie eine ältere Sicherung überschreiben
        n += 1
        p = SICHERUNGEN / f"{basis}-{n}.json"
    p.write_text(json.dumps(richtlinie, indent=1, ensure_ascii=False), encoding="utf-8")
    p.chmod(0o600)
    return p


def bestaetigt(frage: str) -> bool:
    try:
        return input(f"{frage} Zum Ausführen „ja“ eintippen: ").strip().lower() == "ja"
    except EOFError:
        return False


def pruefen(_a) -> int:
    soll = soll_vom_server()
    a = api(soll)
    alles_gut = True
    for art, name in soll["richtlinien"].items():
        r = a.richtlinie_finden(name)
        v = cf.vergleich(r, set(soll[art]))
        b = cf.bedenken(r, name)
        print(f"\n{name}: {len(cf.emails(r))} E-Mails in Cloudflare")
        for x in b:
            print(f"  ⚠ {x}")
        for m in v["fehlt"]:
            print(f"  + fehlt in Cloudflare: {m}")
        for m in v["zuviel"]:
            print(f"  − nur in Cloudflare (nicht in der Bibliothek): {m}")
        if not (b or v["fehlt"] or v["zuviel"]):
            print("  ✓ passt")
        alles_gut &= not (b or v["fehlt"] or v["zuviel"])
    return 0 if alles_gut else 1


def abgleichen(a_) -> int:
    soll = soll_vom_server()
    a = api(soll)
    geschuetzt = set(soll["geschuetzt"])
    plan = []
    for art, name in soll["richtlinien"].items():
        r = a.richtlinie_finden(name)
        b = cf.bedenken(r, name)
        if b:
            print(f"✗ {name}: wird nicht automatisch geändert:\n  - " + "\n  - ".join(b))
            return 1
        v = cf.vergleich(r, set(soll[art]))
        weg = [m for m in v["zuviel"] if m not in geschuetzt] if a_.entfernen else []
        if len(weg) > cf.ENTFERNEN_MAX and not a_.viele:
            print(f"✗ {name}: {len(weg)} E-Mails würden entfernt – das sieht nach einem Fehler aus. Mit --viele erzwingen.")
            return 1
        if v["fehlt"] or weg:
            plan.append((name, r, set(soll[art]), v["fehlt"], weg))
        print(f"\n{name}:")
        for m in v["fehlt"]:
            print(f"  + eintragen: {m}")
        for m in weg:
            print(f"  − entfernen: {m}")
        for m in v["zuviel"]:
            if m not in weg:
                print(f"  · bleibt (nur in Cloudflare{', Admin' if m in geschuetzt else ''}): {m}"
                      + ("" if a_.entfernen or m in geschuetzt else "  → mit --entfernen herausnehmen"))
        if not (v["fehlt"] or weg):
            print("  ✓ nichts zu tun")
    if not plan:
        return 0
    print()
    if not bestaetigt(f"{sum(len(p[3]) + len(p[4]) for p in plan)} Änderung(en) in Cloudflare schreiben?"):
        print("Abgebrochen – nichts geändert.")
        return 1
    for name, r, soll_m, _plus, _minus in plan:
        datei = sichern(r)
        body = cf.neuer_stand(r, soll_m, geschuetzt, entfernen=a_.entfernen)
        erwartet = {x["email"]["email"] for x in body["include"]}
        a.schreiben(r["id"], body)
        nachher = a.richtlinie(r["id"])
        diff = cf.unterschiede(r, nachher)
        if cf.emails(nachher) != erwartet or diff:
            print(f"✗ {name}: Gegenprobe stimmt nicht! Abweichend: {diff or 'E-Mail-Liste'}.\n"
                  f"  Sicherung: {datei}\n  Zurück: python3 scripts/cloudflare.py wiederherstellen '{datei}'")
            return 2
        print(f"✓ {name}: geschrieben und gegengeprüft (Sicherung: {datei})")
    if any(p[4] for p in plan):
        print("\nHinweis: Entfernte Personen behalten eine laufende Anmeldung bis zum Ablauf – sofort raus: in Cloudflare "
              "unter Zugriffssteuerungen → Benutzer die Sitzung widerrufen.")
    return 0


def wiederherstellen(a_) -> int:
    alt = json.loads(Path(a_.datei).read_text(encoding="utf-8"))
    soll = soll_vom_server()
    a = api(soll)
    jetzt = a.richtlinie(alt["id"])
    if jetzt.get("name") != alt.get("name"):
        print(f"✗ Die Richtlinie heißt inzwischen {jetzt.get('name')!r} – abgebrochen.")
        return 1
    print(f"{alt['name']}: zurück auf den Stand der Sicherung")
    for m in sorted(cf.emails(alt) - cf.emails(jetzt)):
        print(f"  + {m}")
    for m in sorted(cf.emails(jetzt) - cf.emails(alt)):
        print(f"  − {m}")
    if not bestaetigt("Zurücksetzen?"):
        print("Abgebrochen – nichts geändert.")
        return 1
    sichern(jetzt)
    a.schreiben(alt["id"], {k: v for k, v in alt.items() if k not in cf.NUR_LESEN})
    print("✓ zurückgesetzt" if cf.emails(a.richtlinie(alt["id"])) == cf.emails(alt) else "✗ Gegenprobe stimmt nicht – bitte im Dashboard prüfen")
    return 0


def lesetoken(_a) -> int:
    print("Nur-Lese-Schlüssel („Access: Apps and Policies Read“ – NICHT den Schreib-Schlüssel!).")
    schluessel = getpass.getpass("Schlüssel (wird nicht angezeigt): ").strip()
    if not schluessel:
        return 1
    # über stdin in den Container – so steht er in keiner Befehlszeile, keiner Datei auf dem Mac und keinem Log
    print(ssh(["docker", "exec", "-i", CONTAINER, "python", "-m", "savesvc", "cloudflare-lesetoken"], eingabe=schluessel).strip())
    return 0


def main() -> int:
    p = argparse.ArgumentParser(prog="scripts/cloudflare.py", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="befehl", required=True)
    sub.add_parser("pruefen").set_defaults(f=pruefen)
    ab = sub.add_parser("abgleichen")
    ab.add_argument("--entfernen", action="store_true", help="auch E-Mails entfernen, die nicht mehr in der Bibliothek sind")
    ab.add_argument("--viele", action="store_true", help=f"mehr als {cf.ENTFERNEN_MAX} Entfernungen erlauben")
    ab.set_defaults(f=abgleichen)
    w = sub.add_parser("wiederherstellen")
    w.add_argument("datei")
    w.set_defaults(f=wiederherstellen)
    sub.add_parser("lesetoken").set_defaults(f=lesetoken)
    a = p.parse_args()
    try:
        return a.f(a)
    except cf.CloudflareFehler as f:
        print(f"✗ {f}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
