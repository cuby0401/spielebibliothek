#!/usr/bin/env python3
"""Aufträge auf dem Mac ausführen (Zentrale 1.4.1, NAS entlasten) – läuft alle 20 Sekunden per launchd.

Einrichten (einmalig):  sh scripts/auftraege-mac-einrichten.sh        (--aus zum Austragen)
Log:                    ~/Library/Logs/spielebibliothek-auftraege.log

Was er tut – nur, wenn Docker Desktop läuft:
  1. Lebenszeichen „Mac bereit“ an die Live-Bibliothek und an den Testserver (Admin-Panel → Aufgaben zeigt es an).
     Solange es frisch ist, lässt der Auftragsdienst auf der NAS die Aufträge liegen (ab 1.4.1 live).
  2. Übernimmt wartende Aufträge aus dem Admin-Panel der Live-Bibliothek UND des Testservers (dort gab es vorher gar
     keinen Ausführer – „Jetzt starten“ blieb ewig auf „wartet“) und führt sie hier aus:
       Unit-Tests          mit der .venv dieses Repos (Sekunden statt ca. 8 Minuten auf der NAS)
       Ende-zu-Ende-Tests  Teststand in Docker Desktop, Chrome auf dem Mac (ca. 3 statt 10 Minuten)
     Quelle ist wie auf der NAS genau der Stand des Ziels: Probe = release.tar der Probe, Live = der Live-Stand.
  3. Meldet das Ergebnis zurück (bei Rot rote Glocke und Home Assistant, wie bisher).

Sicherheit wie beim Auftragsdienst: nur fest eingebaute Aufgaben, Art und Ziel gegen eine feste Liste geprüft, keine
Befehle oder Pfade aus der Datenbank. Datenbankzugriff nur über docker exec im Container (nie sqlite3 auf dem Host).
"""

import fcntl
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

NAS = os.environ.get("NAS", "$NAS")
REPO = Path(__file__).resolve().parents[1]
VENV_PY = REPO / ".venv/bin/python"
SPERRE = Path("/tmp/sb-auftraege-mac.lock")
QUELLE = "/volume1/docker/spielebibliothek-quelle"
PROBE = "/volume1/docker/spielebibliothek-probe"
# Wo Aufträge angelegt werden: Admin-Panel der Live-Bibliothek und des Testservers (Probe)
PANELS = {"live": "spielebibliothek-savesvc", "probe": "sbprobe-savesvc"}
ARTEN = {"unit-tests", "e2e-tests"}
ZIELE = {"live", "probe"}
ZEITLIMIT = {"unit-tests": 10 * 60, "e2e-tests": 45 * 60}
SSH = ["ssh", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", NAS]
os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

# Läuft im Container (python -c), nutzt nur, was es seit 1.3.0 gibt – damit es auch gegen eine ältere Live-Version geht.
IM_CONTAINER = r"""
import json, sys
from datetime import datetime, timezone
from pathlib import Path
from savesvc.db import Datenbank
d = json.loads(sys.stdin.read())
db = Datenbank(Path("/data/saves.db"))
jetzt = datetime.now(timezone.utc).isoformat(timespec="seconds")
if d["was"] == "lebenszeichen":
    db.dienst_setzen("mac", d["wert"][:80])
    print("[]")
elif d["was"] == "holen":
    erlaubt = {(a, z) for a, z in d["erlaubt"]}
    with db.verbindung() as v:
        v.execute("BEGIN IMMEDIATE")
        liste = []
        for z in v.execute("SELECT id, art, ziel FROM auftraege WHERE status='wartet' ORDER BY id").fetchall():
            if (z["art"], z["ziel"]) in erlaubt:
                v.execute("UPDATE auftraege SET status='laeuft', start=?, zusammenfassung='läuft auf dem Mac' WHERE id=? AND status='wartet'", (jetzt, z["id"]))
                liste.append(dict(z))
        v.execute("COMMIT")
    print(json.dumps(liste))
"""


def log(text: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {text}", flush=True)


def ssh(befehl: str, eingabe: str | bytes = "", zeitlimit: int = 60, roh: bool = False):
    r = subprocess.run([*SSH, befehl], input=eingabe if roh else str(eingabe), capture_output=True, text=not roh, timeout=zeitlimit)
    if r.returncode:
        raise RuntimeError(f"ssh {befehl[:60]}: {(r.stderr if not roh else r.stderr.decode(errors='replace')).strip()[-300:]}")
    return r.stdout


def im_container(container: str, daten: dict) -> list:
    return json.loads(ssh(f"docker exec -i {container} python -c {sh_quote(IM_CONTAINER)}", json.dumps(daten)) or "[]")


def sh_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


def fertig_melden(container: str, aid: int, ok: bool, zusammenfassung: str, ausgabe: str) -> None:
    ssh(f"docker exec -i {container} python -m savesvc auftrag-fertig",
        json.dumps({"id": aid, "status": "ok" if ok else "fehler", "zusammenfassung": zusammenfassung[:480], "log": ausgabe[-20000:]}))


def docker_laeuft() -> bool:
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def entpacken(tar: Path, ziel: Path) -> None:
    with tarfile.open(tar) as t:
        for m in t.getmembers():
            if m.name.startswith("/") or ".." in Path(m.name).parts or not (m.isfile() or m.isdir()):
                raise RuntimeError(f"Quelle enthält einen unerlaubten Eintrag: {m.name}")
        t.extractall(ziel, filter="data")


def quelle(ziel: str, tmp: Path) -> tuple[Path, str]:
    """Genau den Stand des Ziels holen – Probe: release.tar, Live: der vollständige Live-Stand."""
    tar = tmp / "quelle.tar"
    if ziel == "probe":
        tar.write_bytes(ssh(f"cat {PROBE}/release.tar", zeitlimit=300, roh=True))
        info = json.loads(ssh(f"cat {PROBE}/release.json") or "{}")
    else:
        tar.write_bytes(ssh(f"tar -C {QUELLE} -cf - .", zeitlimit=300, roh=True))
        info = json.loads(ssh(f"cat {QUELLE}/release.json") or "{}")
    repo = tmp / "repo"
    repo.mkdir()
    entpacken(tar, repo)
    return repo, str(info.get("version") or "?")


def ausfuehren(befehl: list[str], zeitlimit: int, **kw) -> tuple[bool, str]:
    try:
        r = subprocess.run(befehl, capture_output=True, text=True, timeout=zeitlimit, **kw)
        return r.returncode == 0, r.stdout + r.stderr
    except subprocess.TimeoutExpired as f:
        bisher = f.stdout.decode(errors="replace") if isinstance(f.stdout, bytes) else (f.stdout or "")
        return False, f"{bisher}\nAbgebrochen nach {zeitlimit // 60} Minuten"


def unit_tests(repo: Path) -> tuple[bool, str, str]:
    ok, ausgabe = ausfuehren([str(VENV_PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"], ZEITLIMIT["unit-tests"],
                             cwd=repo / "savesvc")
    zeilen = [z for z in ausgabe.strip().splitlines() if z.strip()]
    return ok, next((z.strip("= ") for z in reversed(zeilen) if " passed" in z or " failed" in z or " error" in z),
                    zeilen[-1] if zeilen else "keine Ausgabe"), ausgabe


def e2e_tests(repo: Path) -> tuple[bool, str, str]:
    ok, ausgabe = ausfuehren(["sh", str(repo / "scripts/e2e-alle.sh")], ZEITLIMIT["e2e-tests"],
                             env={**os.environ, "E2E_ORT": "mac"})
    gruen = sum(int(m) for m in re.findall(r"✓ (\d+) Prüfpunkte grün", ausgabe))
    rot = re.findall(r"^\s*✗ (.+)$", ausgabe, re.M)
    return ok, f"{gruen} Prüfpunkte grün" + (f", rot: {rot[0][:120]}" if rot else ""), ausgabe


def erlaubt() -> list[tuple[str, str]]:
    """Was der Mac übernimmt. Ende-zu-Ende nur, wenn der Stand des Ziels schon auf dem Mac laufen kann (ab 1.4.1) –
    ältere Live-Stände bleiben beim Auftragsdienst auf der NAS."""
    liste = [("unit-tests", "live"), ("unit-tests", "probe")]
    for ziel, pruefen in (("live", f"grep -q E2E_ORT {QUELLE}/scripts/e2e-alle.sh"),
                          ("probe", f"tar -xOf {PROBE}/release.tar scripts/e2e-alle.sh | grep -q E2E_ORT")):
        try:
            ssh(pruefen)
            liste.append(("e2e-tests", ziel))
        except RuntimeError:
            pass
    return liste


def main() -> int:
    if not docker_laeuft():
        return 0                                       # ohne Docker Desktop: kein Lebenszeichen, die NAS übernimmt
    with open(SPERRE, "w") as sperre:
        beschaeftigt = False
        try:
            fcntl.flock(sperre, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            beschaeftigt = True
        for panel, container in PANELS.items():
            try:
                im_container(container, {"was": "lebenszeichen", "wert": "Mac – beschäftigt" if beschaeftigt else "Mac – bereit"})
            except (RuntimeError, subprocess.TimeoutExpired) as f:
                if panel == "live":
                    log(f"Lebenszeichen {panel}: {f}")
        if beschaeftigt:
            return 0                                   # ein Lauf ist noch dran – nie zwei gleichzeitig (Teststand, Ports)
        try:
            frei = erlaubt()
        except (RuntimeError, subprocess.TimeoutExpired):
            return 0
        for panel, container in PANELS.items():
            try:
                auftraege = im_container(container, {"was": "holen", "erlaubt": frei})
            except (RuntimeError, subprocess.TimeoutExpired):
                continue                               # z. B. Testserver gerade im Umbau
            for a in auftraege:
                art, ziel, aid = a.get("art"), a.get("ziel"), a.get("id")
                if art not in ARTEN or ziel not in ZIELE or not isinstance(aid, int):
                    continue
                log(f"{panel}: Auftrag {aid} {art} ({ziel})")
                start = datetime.now(timezone.utc)
                with tempfile.TemporaryDirectory(prefix="sb-auftrag-mac-") as tmp:
                    try:
                        repo, version = quelle(ziel, Path(tmp))
                        ok, zusammenfassung, ausgabe = (unit_tests if art == "unit-tests" else e2e_tests)(repo)
                    except Exception as f:   # noqa: BLE001
                        ok, zusammenfassung, ausgabe, version = False, str(f)[:300], str(f), "?"
                dauer = int((datetime.now(timezone.utc) - start).total_seconds())
                text = f"Mac · {version}: {zusammenfassung} ({dauer // 60}:{dauer % 60:02d})"
                try:
                    fertig_melden(container, aid, ok, text, ausgabe)
                except (RuntimeError, subprocess.TimeoutExpired) as f:
                    log(f"Ergebnis {aid} nicht gemeldet: {f}")
                log(f"{panel}: Auftrag {aid} {'ok' if ok else 'FEHLER'} – {text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
