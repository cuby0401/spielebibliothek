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
import threading
from datetime import datetime, timezone
from pathlib import Path

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
REPO = Path(__file__).resolve().parents[1]
VENV_PY = REPO / ".venv/bin/python"
SPERRE = Path("/tmp/sb-auftraege-mac.lock")
# Welcher Auftrag gerade läuft – bleibt nach einem Abbruch (Neustart des Dienstes, Mac aus) liegen und wird beim
# nächsten Lauf als abgebrochen gemeldet, statt ewig auf „läuft“ zu stehen (09.11.2026)
LAEUFT = Path.home() / "Library/Application Support/spielebibliothek-auftraege/laeuft.json"
QUELLE = f"{ABLAGE}/spielebibliothek-quelle"
PROBE = f"{ABLAGE}/spielebibliothek-probe"
# Wo Aufträge angelegt werden: Admin-Panel der Live-Bibliothek und des Testservers (Probe)
PANELS = {"live": "spielebibliothek-savesvc", "probe": "sbprobe-savesvc"}
ARTEN = {"unit-tests", "e2e-tests"}
ZIELE = {"live", "probe"}
ZEITLIMIT = {"unit-tests": 10 * 60, "e2e-tests": 45 * 60}
SSH = ["ssh", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SERVER]
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
    # Immer nur EINEN Auftrag übernehmen (09.11.2026): Wird der Mac mitten im Lauf beendet, kann nur dieser eine
    # hängen – und genau der ist in laeuft.json vermerkt und wird beim nächsten Start als abgebrochen gemeldet.
    erlaubt = {(a, z) for a, z in d["erlaubt"]}
    with db.verbindung() as v:
        v.execute("BEGIN IMMEDIATE")
        if d.get("aufraeumen"):   # Testserver: dort räumt kein Auftragsdienst der NAS Hängengebliebene ab
            from datetime import timedelta
            grenze = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
            v.execute("UPDATE auftraege SET status='fehler', ende=?, zusammenfassung='abgebrochen (keine Rückmeldung nach 2 h)' "
                      "WHERE status='laeuft' AND start < ?", (jetzt, grenze))
        liste = []
        for z in v.execute("SELECT id, art, ziel FROM auftraege WHERE status='wartet' ORDER BY id").fetchall():
            if (z["art"], z["ziel"]) in erlaubt:
                v.execute("UPDATE auftraege SET status='laeuft', start=?, zusammenfassung='läuft auf dem Mac' WHERE id=? AND status='wartet'", (jetzt, z["id"]))
                liste.append(dict(z))
                break
        v.execute("COMMIT")
    print(json.dumps(liste))
elif d["was"] == "stand":   # Zwischenstand eines laufenden Auftrags (z. B. „Test 3/8: zentrale-1.2“)
    with db.verbindung() as v:
        v.execute("UPDATE auftraege SET zusammenfassung=? WHERE id=? AND status='laeuft'", (d["text"][:200], d["id"]))
    print("[]")
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


def e2e_tests(repo: Path, melden=lambda text: None) -> tuple[bool, str, str]:
    skript = repo / "scripts/e2e-alle.sh"
    auf_dem_mac = "E2E_ORT" in skript.read_text(encoding="utf-8", errors="replace")
    if not auf_dem_mac:
        # Stand vor 1.4.1 (z. B. Live 1.4.0): Teststand auf der NAS wie früher; das alte Skript braucht ein Git-Repo
        subprocess.run(["git", "init", "-q"], cwd=repo, capture_output=True)
    liste = re.search(r"E2E_TESTS:-([^}]*)\}", skript.read_text(encoding="utf-8", errors="replace"))
    gesamt = len(liste.group(1).split()) if liste else "?"
    zeilen, nr, ende = [], 0, datetime.now(timezone.utc).timestamp() + ZEITLIMIT["e2e-tests"]
    p = subprocess.Popen(["sh", str(skript)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         env={**os.environ, "E2E_ORT": "mac"} if auf_dem_mac else None, start_new_session=True)
    try:
        for zeile in p.stdout:
            zeilen.append(zeile)
            m = re.match(r"→ Ende-zu-Ende: (\S+)", zeile)
            if m:
                nr += 1
                melden(f"läuft {'auf dem Mac' if auf_dem_mac else '(Teststand auf dem Server)'} – Test {nr}/{gesamt}: {m.group(1)}")
            if datetime.now(timezone.utc).timestamp() > ende:
                raise subprocess.TimeoutExpired(skript, ZEITLIMIT["e2e-tests"])
        ok = p.wait() == 0
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, 15)
        zeilen.append(f"\nAbgebrochen nach {ZEITLIMIT['e2e-tests'] // 60} Minuten")
        ok = False
    ausgabe = "".join(zeilen)
    gruen = sum(int(m) for m in re.findall(r"✓ (\d+) Prüfpunkte grün", ausgabe))
    rot = re.findall(r"^\s*✗ (.+)$", ausgabe, re.M)
    return ok, f"{gruen} Prüfpunkte grün" + (f", rot: {rot[0][:120]}" if rot else ""), ausgabe


def erlaubt(panel: str) -> list[tuple[str, str]]:
    """Was der Mac übernimmt. Ende-zu-Ende in der Live-Bibliothek nur, wenn der Stand des Ziels schon auf dem Mac laufen
    kann (ab 1.4.1) – ältere bleiben dort beim Auftragsdienst der NAS. Im Testserver führt sonst niemand aus, also
    übernimmt der Mac dort alles (ältere Stände mit Teststand auf der NAS, wie früher)."""
    liste = [("unit-tests", "live"), ("unit-tests", "probe")]
    if panel == "probe":
        return liste + [("e2e-tests", "live"), ("e2e-tests", "probe")]
    for ziel, pruefen in (("live", f"grep -q E2E_ORT {QUELLE}/scripts/e2e-alle.sh"),
                          ("probe", f"tar -xOf {PROBE}/release.tar scripts/e2e-alle.sh | grep -q E2E_ORT")):
        try:
            ssh(pruefen)
            liste.append(("e2e-tests", ziel))
        except RuntimeError:
            pass
    return liste


def lebenszeichen(wert: str) -> None:
    for panel, container in PANELS.items():
        try:
            im_container(container, {"was": "lebenszeichen", "wert": wert})
        except (RuntimeError, subprocess.TimeoutExpired) as f:
            if panel == "live":
                log(f"Lebenszeichen {panel}: {f}")


def herzschlag(stopp: threading.Event) -> None:
    """Während eines Laufs alle 20 s „Mac – beschäftigt“ melden (09.11.2026). launchd startet den Dienst nicht erneut,
    solange er noch läuft – ohne das galt der Mac nach 90 s als weg, und die NAS übernahm neue Aufträge doch selbst."""
    while not stopp.wait(20):
        lebenszeichen("Mac – beschäftigt")


def offenes_melden() -> bool:
    """Steht in laeuft.json noch ein Auftrag, ist er entweder abgebrochen (Dienst beendet) oder sein Ergebnis kam nicht
    an (NAS nicht erreichbar). Jetzt melden. → False, wenn das wieder nicht ging – dann keinen neuen Auftrag annehmen,
    sonst würde laeuft.json überschrieben und der alte bliebe ewig auf „läuft“."""
    if not LAEUFT.is_file():
        return True
    try:
        alt = json.loads(LAEUFT.read_text())
        container, aid = PANELS[alt["panel"]], int(alt["id"])
    except (ValueError, KeyError, TypeError) as f:
        log(f"laeuft.json unlesbar, verworfen: {f}")
        LAEUFT.unlink(missing_ok=True)
        return True
    erg = alt.get("ergebnis")
    try:
        if erg:
            fertig_melden(container, aid, erg["ok"], erg["text"], erg["ausgabe"])
            log(f"{alt['panel']}: Ergebnis von Auftrag {aid} nachgemeldet")
        else:
            fertig_melden(container, aid, False,
                          "abgebrochen – der Mac-Dienst wurde während des Laufs beendet (Neustart, Ruhezustand oder Mac aus). Bitte neu starten.", "")
            log(f"{alt['panel']}: Auftrag {aid} als abgebrochen gemeldet")
    except (RuntimeError, subprocess.TimeoutExpired) as f:
        log(f"Auftrag {aid} noch nicht gemeldet (nächster Versuch in 20 s): {f}")
        return False
    LAEUFT.unlink(missing_ok=True)
    return True


def ausfuehren_auftrag(panel: str, container: str, art: str, ziel: str, aid: int) -> None:
    log(f"{panel}: Auftrag {aid} {art} ({ziel})")
    LAEUFT.parent.mkdir(parents=True, exist_ok=True)
    LAEUFT.write_text(json.dumps({"panel": panel, "id": aid, "pid": os.getpid()}))
    start = datetime.now(timezone.utc)
    stopp = threading.Event()
    threading.Thread(target=herzschlag, args=(stopp,), daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="sb-auftrag-mac-") as tmp:
            try:
                repo, version = quelle(ziel, Path(tmp))
                def melden(text, c=container, i=aid):
                    try:
                        im_container(c, {"was": "stand", "id": i, "text": text})
                    except (RuntimeError, subprocess.TimeoutExpired):
                        pass
                ok, zusammenfassung, ausgabe = unit_tests(repo) if art == "unit-tests" else e2e_tests(repo, melden)
            except Exception as f:   # noqa: BLE001
                ok, zusammenfassung, ausgabe, version = False, str(f)[:300], str(f), "?"
    finally:
        stopp.set()
    dauer = int((datetime.now(timezone.utc) - start).total_seconds())
    text = f"Mac · {version}: {zusammenfassung} ({dauer // 60}:{dauer % 60:02d})"
    log(f"{panel}: Auftrag {aid} {'ok' if ok else 'FEHLER'} – {text}")
    # Ergebnis erst vermerken, dann melden: Kommt es nicht an (NAS kurz weg), meldet der nächste Lauf es nach (09.11.2026)
    LAEUFT.write_text(json.dumps({"panel": panel, "id": aid, "pid": os.getpid(),
                                  "ergebnis": {"ok": ok, "text": text, "ausgabe": ausgabe[-20000:]}}))
    offenes_melden()


def main() -> int:
    if not docker_laeuft():
        return 0                                       # ohne Docker Desktop: kein Lebenszeichen, die NAS übernimmt
    with open(SPERRE, "w") as sperre:
        try:
            fcntl.flock(sperre, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:                        # z. B. ein Lauf von Hand – nie zwei gleichzeitig (Teststand, Ports)
            lebenszeichen("Mac – beschäftigt")
            return 0
        lebenszeichen("Mac – bereit")
        if not offenes_melden():                       # wir haben die Sperre, also läuft der dort vermerkte Auftrag nicht mehr
            return 0
        # Einen Auftrag nach dem anderen; nach jedem neu nachsehen (auch im anderen Panel)
        while True:
            gefunden = False
            for panel, container in PANELS.items():
                try:
                    auftraege = im_container(container, {"was": "holen", "erlaubt": erlaubt(panel), "aufraeumen": panel == "probe"})
                except (RuntimeError, subprocess.TimeoutExpired):
                    continue                           # z. B. Testserver gerade im Umbau
                for a in auftraege:
                    art, ziel, aid = a.get("art"), a.get("ziel"), a.get("id")
                    if art not in ARTEN or ziel not in ZIELE or not isinstance(aid, int):
                        continue
                    ausfuehren_auftrag(panel, container, art, ziel, aid)
                    gefunden = True
                    if LAEUFT.is_file():               # Ergebnis kam nicht an – erst nachmelden, dann weiter
                        return 0
            if not gefunden:
                return 0


if __name__ == "__main__":
    sys.exit(main())
