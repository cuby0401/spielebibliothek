#!/bin/sh
# Baut site/handbuch/startvorlage.zip aus vorlage/ + site/handbuch/prompt.txt (als KI-ANWEISUNG.txt),
# seit 1.6.0 dazu site/handbuch/multiplayer-vorlage.zip aus examples/vier-gewinnt/.
# Nach jeder Änderung an vorlage/ oder prompt.txt ausführen und das ZIP mit committen.
set -e
cd "$(dirname "$0")/.."
python3 - <<'PY'
import zipfile, pathlib, time
ziel = pathlib.Path("site/handbuch/startvorlage.zip")
fest = (2026, 11, 5, 0, 0, 0)   # feste Zeitstempel → gleiches ZIP bei gleichem Inhalt
with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(pathlib.Path("vorlage").iterdir()):
        if p.is_file() and not p.name.startswith("."):
            z.writestr(zipfile.ZipInfo("mein-spiel/" + p.name, fest), p.read_bytes())
    z.writestr(zipfile.ZipInfo("mein-spiel/KI-ANWEISUNG.txt", fest), pathlib.Path("site/handbuch/prompt.txt").read_bytes())
print("geschrieben:", ziel, ziel.stat().st_size, "Bytes")
# Multiplayer-Vorlage (1.6.0): Beispiel „Vier gewinnt“ + derselbe Prompt-Block
ziel = pathlib.Path("site/handbuch/multiplayer-vorlage.zip")
with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(pathlib.Path("examples/vier-gewinnt").iterdir()):
        if p.is_file() and not p.name.startswith("."):
            z.writestr(zipfile.ZipInfo("mein-multiplayer-spiel/" + p.name, fest), p.read_bytes())
    z.writestr(zipfile.ZipInfo("mein-multiplayer-spiel/KI-ANWEISUNG.txt", fest), pathlib.Path("site/handbuch/prompt.txt").read_bytes())
print("geschrieben:", ziel, ziel.stat().st_size, "Bytes")
PY
