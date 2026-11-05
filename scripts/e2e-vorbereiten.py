"""Testdaten für die Ende-zu-Ende-Tests: e2e-v1.zip / e2e-v2.zip (saveVersion 1/2 mit Migration) in <ordner>."""
import json
import sys
import zipfile
from pathlib import Path

ziel = Path(sys.argv[1])
spiel = '''<!doctype html><html><head><script src="/lib/gamesave.js"></script></head><body><p id="t">...</p><script>
(async()=>{try{const {data}=await GameSave.load("stand",{standard:{zahl:0},migration:{2:(a)=>({...a,neu:true})}});
data.zahl++; await GameSave.save("stand",data); document.getElementById("t").textContent="ok";}catch(e){document.getElementById("t").textContent=e.message;}})();
</script></body></html>'''
for sv in (1, 2):
    with zipfile.ZipFile(ziel / f"e2e-v{sv}.zip", "w") as z:
        z.writestr("index.html", spiel)
        z.writestr("game.json", json.dumps({"title": "E2E", "description": "Test", "saveVersion": sv}))
