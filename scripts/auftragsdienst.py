#!/usr/bin/env python3
"""Auftragsdienst der Spielebibliothek – läuft jede Minute als Cron-Job auf der NAS unter Sebi (Zentrale 1.3.0).

Einrichten (einmalig, vom Mac):  sh scripts/auftragsdienst-einrichten.sh
Log auf der NAS:                 /tmp/sb-auftragsdienst.log

Was er tut – und NUR das:
  0. Not-Aus (1.4.0): Liegt config/notaus.json im Live-Ordner, stoppt er den Tunnel (jede Minute als Erstes) und spielt nichts ein.
  1. Lebenszeichen an den Speicher-Dienst (Admin-Panel, Wächter merkt einen Ausfall).
  2. Live-Deploy nach Freigabe: Ist in der Probe genau der dort abgelegte Release-Stand (release.tar/release.json)
     freigegeben (data/freigabe.json) und noch nicht live, spielt er ihn mit scripts/nas-deploy.sh ein – aus dem Tar selbst,
     nicht aus der Probe (die läuft mit ersetzten Hostnamen). Schlägt das fehl, versucht er denselben Commit nicht erneut.
  3. Aufträge aus dem Admin-Panel: holt sie mit `docker exec … python -m savesvc auftraege-holen` und führt nur die fest
     eingebauten Aufgaben aus (Unit-Tests, Ende-zu-Ende-Tests; Ziel live oder probe). Art und Ziel werden gegen eine feste
     Liste geprüft; Befehle, Pfade oder sonstige Parameter aus der Datenbank gibt es nicht.

Sicherheit: Kein Container bekommt Zugriff auf Docker. Der Speicher-Dienst kann nur Aufträge anlegen, der Auftragsdienst
liest die Datenbank nie selbst (nur über docker exec im Container – nie sqlite3 auf dem Host, siehe 06.11.2026).
"""

import fcntl
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

# Pfade und Container – per Umgebung nur zum Testen gegen den Teststand änderbar (SB_LIVE, SB_LIVE_C, …)
LIVE = Path(os.environ.get("SB_LIVE", "/volume1/docker/spielebibliothek"))
QUELLE = Path(os.environ.get("SB_QUELLE", "/volume1/docker/spielebibliothek-quelle"))   # vollständiger Live-Stand (nas-deploy.sh)
PROBE = Path(os.environ.get("SB_PROBE", "/volume1/docker/spielebibliothek-probe"))
LIVE_C = os.environ.get("SB_LIVE_C", "spielebibliothek-savesvc")
PROBE_C = os.environ.get("SB_PROBE_C", "sbprobe-savesvc")
TUNNEL_C = os.environ.get("SB_TUNNEL_C", "spielebibliothek-cloudflared")
SPERRE = Path(os.environ.get("SB_SPERRE", "/tmp/sb-auftragsdienst.lock"))
ARTEN = {"unit-tests", "e2e-tests"}
ZIELE = {"live", "probe"}
ZEITLIMIT = {"unit-tests": 20 * 60, "e2e-tests": 45 * 60, "deploy": 20 * 60}
VERSION = re.compile(r"^\d+\.\d+\.\d+$")
COMMIT = re.compile(r"^[0-9a-f]{7,40}$")


def jetzt() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(text: str) -> None:
    print(f"{jetzt()} {text}", flush=True)


def lauft(container: str) -> bool:
    r = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", container], capture_output=True, text=True)
    return r.stdout.strip() == "true"


def dienst(container: str, *befehl: str, eingabe: dict | None = None, warten: int = 0) -> str:
    """Befehl im Speicher-Dienst (python -m savesvc …). warten: Sekunden, die auf einen Neustart gewartet wird."""
    ende = time.time() + warten
    while True:
        r = subprocess.run(["docker", "exec", "-i", container, "python", "-m", "savesvc", *befehl],
                           input=json.dumps(eingabe) if eingabe is not None else "", capture_output=True, text=True, timeout=60)
        if r.returncode == 0 or time.time() > ende:
            if r.returncode:
                raise RuntimeError(f"{container} {befehl[0]}: {r.stderr.strip()[-300:]}")
            return r.stdout
        time.sleep(5)


def ausfuehren(befehl: list[str], zeitlimit: int, cwd: Path | None = None, umgebung: dict | None = None) -> tuple[bool, str]:
    try:
        r = subprocess.run(befehl, capture_output=True, text=True, timeout=zeitlimit, cwd=cwd,
                           env={**os.environ, **umgebung} if umgebung else None)
        return r.returncode == 0, (r.stdout + r.stderr)
    except subprocess.TimeoutExpired as f:
        bisher = f.stdout.decode(errors="replace") if isinstance(f.stdout, bytes) else (f.stdout or "")
        return False, f"{bisher}\nAbgebrochen nach {zeitlimit // 60} Minuten"


def lesen(pfad: Path) -> dict:
    try:
        return json.loads(pfad.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def entpacken_pruefen(tar: Path) -> None:
    with tarfile.open(tar) as t:
        for m in t.getmembers():
            if m.name.startswith("/") or ".." in Path(m.name).parts or not (m.isfile() or m.isdir()):
                raise RuntimeError(f"Release enthält einen unerlaubten Eintrag: {m.name}")


def entpacken(tar: Path, ziel: Path) -> None:
    """Release-Tar entpacken – vorher prüfen: nur normale Dateien/Ordner, keine absoluten Pfade, kein „..“, keine Links."""
    entpacken_pruefen(tar)
    ziel.mkdir(parents=True, exist_ok=True)
    ok, ausgabe = ausfuehren(["tar", "--no-same-owner", "-xf", str(tar), "-C", str(ziel)], 300)
    if not ok:
        raise RuntimeError("Entpacken fehlgeschlagen: " + ausgabe[-300:])


# ---------- 0. Not-Aus (Zentrale 1.4.0, E72) ----------

def notaus_aktiv() -> bool:
    return (LIVE / "config/notaus.json").exists()


def notaus() -> None:
    """Ist der Not-Aus an, den Tunnel stoppen – die Bibliothek ist dann von außen nicht mehr erreichbar.
    Läuft bei jedem Aufruf als Erstes, auch wenn noch lange Tests laufen (vor der Sperre)."""
    if not notaus_aktiv() or not lauft(TUNNEL_C):
        return
    r = subprocess.run(["docker", "stop", TUNNEL_C], capture_output=True, text=True, timeout=60)
    log(f"NOT-AUS: Tunnel {TUNNEL_C} gestoppt" if r.returncode == 0 else f"NOT-AUS: Tunnel stoppen fehlgeschlagen: {r.stderr.strip()[-300:]}")


# ---------- 2. Live-Deploy nach Freigabe ----------

def nummer(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def deploy_nach_freigabe() -> None:
    if notaus_aktiv():
        return                                                     # ein Deploy würde den Tunnel wieder starten
    freigabe, release = lesen(PROBE / "data/freigabe.json"), lesen(PROBE / "release.json")
    version, commit = str(release.get("version", "")), str(release.get("commit", ""))
    if not (VERSION.match(version) and COMMIT.match(commit)) or freigabe.get("commit") != commit:
        return
    live = lesen(LIVE / "site/zentrale.json")
    if live.get("commit") == commit:
        return                                                     # schon live
    # Nie zurück auf eine ältere oder gleich alte Version (06.11.2026: 1.3.1 kam direkt live, danach spielte der
    # Dienst die alte Freigabe 1.3.0 wieder darüber). Zurück geht nur von Hand: scripts/deploy.sh --zurueck.
    if VERSION.match(str(live.get("version", ""))) and nummer(version) <= nummer(str(live["version"])):
        return
    # Pro Freigabe nur EIN Versuch – schlägt er fehl, nicht endlos wiederholen. Neuer Versuch: in der Probe
    # „Freigabe zurücknehmen“ und erneut freigeben (neue Freigabe-Zeit).
    versuch = PROBE / "deploy-versuch.json"
    v = lesen(versuch)
    if v.get("commit") == commit and v.get("freigabe") == freigabe.get("zeit"):
        return
    versuch.write_text(json.dumps({"commit": commit, "freigabe": freigabe.get("zeit"), "zeit": jetzt()}))
    entpacken_pruefen(PROBE / "release.tar")
    tar = PROBE / "release.tar"
    start = jetzt()
    status = {"status": "laeuft", "zeit": start, "version": version, "commit": commit, "text": "Wird live eingespielt …"}
    if lauft(PROBE_C):
        dienst(PROBE_C, "live-status", eingabe=status)
    log(f"Live-Deploy {version} ({commit}) nach Freigabe")
    with tempfile.TemporaryDirectory(prefix="sb-deploy-") as tmp:
        skript = Path(tmp) / "nas-deploy.sh"
        with tarfile.open(tar) as t:
            mitglied = t.extractfile("scripts/nas-deploy.sh")
            skript.write_bytes(mitglied.read() if mitglied else b"")
        # Ziel immer ausdrücklich mitgeben – nas-deploy.sh soll nie stillschweigend auf seine Standardpfade zurückfallen
        ok, ausgabe = ausfuehren(["sh", str(skript), str(tar), version, commit], ZEITLIMIT["deploy"],
                                 umgebung={"ZIEL": str(LIVE), "QUELLE": str(QUELLE)})
    kurz = f"Zentrale {version} ist live" if ok else "Live-Deploy fehlgeschlagen – die bisherige Version läuft weiter bzw. scripts/deploy.sh --zurueck"
    log(kurz)
    if lauft(PROBE_C):
        dienst(PROBE_C, "live-status", eingabe={**status, "status": "ok" if ok else "fehler", "zeit": jetzt(), "text": kurz + "\n" + ausgabe[-1500:]})
    try:   # der Speicher-Dienst wurde gerade neu gestartet – bis zu 2 Minuten warten
        dienst(LIVE_C, "auftrag-fertig", warten=120, eingabe={"art": "live-deploy", "ziel": "live", "status": "ok" if ok else "fehler",
                                                             "start": start, "zusammenfassung": f"{version} ({commit}): {kurz}", "log": ausgabe})
    except RuntimeError as f:
        log(f"Ergebnis nicht eingetragen: {f}")


# ---------- 3. Aufträge ----------

def quelle(ziel: str, tmp: Path) -> Path:
    if ziel == "live":
        if not (QUELLE / "VERSION").is_file():
            raise RuntimeError("Der vollständige Live-Stand liegt noch nicht vor – kommt mit dem nächsten Deploy (scripts/nas-deploy.sh)")
        return QUELLE
    if not (PROBE / "release.tar").is_file():
        raise RuntimeError("In der Probe liegt kein Release-Stand – erst scripts/deploy.sh --probe")
    entpacken(PROBE / "release.tar", tmp / "repo")
    return tmp / "repo"


def unit_tests(repo: Path) -> tuple[bool, str, str]:
    bild = "sb-auftrag-unittest"
    ok, ausgabe = ausfuehren(["docker", "build", "-q", "--target", "test", "-t", bild, str(repo / "savesvc")], ZEITLIMIT["unit-tests"])
    if ok:
        ok, ausgabe = ausfuehren(["docker", "run", "--rm", bild], ZEITLIMIT["unit-tests"])
        subprocess.run(["docker", "rmi", bild], capture_output=True)
    zeilen = [z for z in ausgabe.strip().splitlines() if z.strip()]
    zusammenfassung = next((z.strip("= ") for z in reversed(zeilen) if " passed" in z or " failed" in z or " error" in z),
                           zeilen[-1] if zeilen else "keine Ausgabe")
    return ok, zusammenfassung, ausgabe


def e2e_tests(repo: Path) -> tuple[bool, str, str]:
    ok, ausgabe = ausfuehren(["sh", str(repo / "scripts/e2e-nas.sh"), str(repo)], ZEITLIMIT["e2e-tests"])
    gruen = sum(int(m) for m in re.findall(r"✓ (\d+) Prüfpunkte grün", ausgabe))
    rot = re.findall(r"^\s*✗ (.+)$", ausgabe, re.M)
    zusammenfassung = f"{gruen} Prüfpunkte grün" + (f", {len(rot)} rot: {rot[0][:120]}" if rot else "") if ok or gruen else (ausgabe.strip().splitlines() or ["keine Ausgabe"])[-1]
    return ok, zusammenfassung, ausgabe


def auftraege() -> None:
    for a in json.loads(dienst(LIVE_C, "auftraege-holen") or "[]"):
        art, ziel, aid = a.get("art"), a.get("ziel"), a.get("id")
        if art not in ARTEN or ziel not in ZIELE or not isinstance(aid, int):
            dienst(LIVE_C, "auftrag-fertig", eingabe={"id": aid if isinstance(aid, int) else None, "status": "fehler",
                                                      "zusammenfassung": "unbekannte Aufgabe – nicht ausgeführt", "log": ""})
            continue
        log(f"Auftrag {aid}: {art} ({ziel})")
        with tempfile.TemporaryDirectory(prefix="sb-auftrag-") as tmp:
            try:
                repo = quelle(ziel, Path(tmp))
                ok, zusammenfassung, ausgabe = (unit_tests if art == "unit-tests" else e2e_tests)(repo)
            except Exception as f:   # noqa: BLE001
                ok, zusammenfassung, ausgabe = False, str(f)[:300], str(f)
        version = lesen((QUELLE if ziel == "live" else PROBE) / "release.json").get("version")
        dienst(LIVE_C, "auftrag-fertig", eingabe={"id": aid, "status": "ok" if ok else "fehler",
                                                  "zusammenfassung": (f"{version}: " if version else "") + zusammenfassung, "log": ausgabe})
        log(f"Auftrag {aid}: {'ok' if ok else 'FEHLER'} – {zusammenfassung}")


def main() -> int:
    try:
        notaus()
    except Exception as f:   # noqa: BLE001
        log(f"notaus: {f}")
    with open(SPERRE, "w") as sperre:
        try:
            fcntl.flock(sperre, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0                                               # läuft noch (z. B. lange Tests)
        live_version = lesen(QUELLE / "release.json").get("version") or lesen(LIVE / "site/zentrale.json").get("version") or "?"
        if lauft(LIVE_C):
            try:
                dienst(LIVE_C, "lebenszeichen", live_version)
            except RuntimeError as f:
                log(str(f))
        for schritt in (deploy_nach_freigabe, auftraege):
            try:
                schritt()
            except Exception as f:   # noqa: BLE001 – ein Fehler in einem Schritt darf die anderen nicht aufhalten
                log(f"{schritt.__name__}: {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
