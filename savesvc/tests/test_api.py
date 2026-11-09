import time
import sqlite3

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from savesvc import db as dbmod

SEB = "/api/save/seb/zaehler"


# --- Anmeldung ---

def test_ohne_token_401(client):
    assert client.get("/api/me").status_code == 401


@pytest.mark.parametrize("kw", [
    {"aud": "andere-anwendung"},          # z. B. Token der Anwendung play
    {"iss": "https://fremd.cloudflareaccess.com"},
    {"exp_in": -10},
])
def test_falsches_token_401(client, kw):
    assert client.get("/api/me", headers=client.als(**kw)).status_code == 401


def test_fremd_signiert_401(client, token):
    fremd = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    h = {"Cf-Access-Jwt-Assertion": token(schluessel=fremd)}
    assert client.get("/api/me", headers=h).status_code == 401


def test_unbekannte_email_403(client):
    assert client.get("/api/me", headers=client.als("fremd@example.com")).status_code == 403


def test_me_und_grossschreibung(client):
    me = client.get("/api/me", headers=client.als(exp_in=3600)).json()
    assert abs(me.pop("sitzungBis") - (time.time() + 3600)) < 60   # Ende der Cloudflare-Sitzung aus dem JWT
    assert me.pop("anzeigename") is None and me.pop("namen") == {}
    assert me.pop("probe") is False
    assert me.pop("konto") == "seb"                       # 1.5.0: Konto = Spieleordner (Zwischenspeicher im Browser)
    assert me == {"player": "seb", "uploader": True, "admin": True, "ansicht": None, "echterAdmin": True, "tester": False}
    assert client.get("/api/me", headers=client.als("PAUL@example.COM")).json()["player"] == "paul"


def test_users_yaml_wird_neu_gelesen(client, umgebung):
    assert client.get("/api/me", headers=client.als("neu@example.com")).status_code == 403
    import os, time
    umgebung.users.write_text("seb@example.com: seb\nneu@example.com: neu\n")
    os.utime(umgebung.users, (time.time() + 5, time.time() + 5))
    # nur spielen: kein eigener Spielordner → kein Upload-Link
    me = client.get("/api/me", headers=client.als("neu@example.com")).json()
    me.pop("sitzungBis"); me.pop("probe"); me.pop("anzeigename"); me.pop("namen")
    assert me.pop("konto") == "neu"
    assert me == {"player": "neu", "uploader": False, "admin": False, "ansicht": None, "echterAdmin": False, "tester": False}


def test_ohne_login_kein_404_leck(client):
    # unbekanntes Spiel ohne Anmeldung → 401, nicht 404
    assert client.get("/api/save/gibts/nicht/x").status_code == 401


# --- Spiele ---

def test_games_liste(client):
    spiele = {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}
    assert set(spiele) == {"seb/zaehler", "paul/snake", "paul/kaputt", "paul/ohne-index"}
    assert spiele["seb/zaehler"]["title"] == "Zähler"
    assert spiele["seb/zaehler"]["saveVersion"] == 2
    assert spiele["seb/zaehler"]["author"] == "seb"
    assert spiele["paul/snake"]["title"] == "snake"          # ohne game.json: Ordnername
    assert spiele["paul/kaputt"]["warning"]
    assert spiele["paul/kaputt"]["complete"] is True
    assert spiele["paul/ohne-index"]["complete"] is False


# --- Spielstände ---

def test_speichern_laden_loeschen(client):
    h = client.als()
    assert client.get(f"{SEB}/stand", headers=h).status_code == 404
    r = client.put(f"{SEB}/stand", json={"data": {"level": 3}}, headers=h)
    assert r.status_code == 200 and r.json()["version"] == 2   # saveVersion aus game.json
    stand = client.get(f"{SEB}/stand", headers=h).json()
    assert stand["data"] == {"level": 3} and stand["version"] == 2
    assert client.get(SEB, headers=h).json() == {"keys": ["stand"]}
    assert client.delete(f"{SEB}/stand", headers=h).status_code == 204
    assert client.get(f"{SEB}/stand", headers=h).status_code == 404


def test_spieler_getrennt(client):
    client.put(f"{SEB}/stand", json={"data": 1}, headers=client.als())
    assert client.get(f"{SEB}/stand", headers=client.als("paul@example.com")).status_code == 404


def test_unbekanntes_spiel_404(client):
    h = client.als()
    assert client.put("/api/save/seb/gibtsnicht/x", json={"data": 1}, headers=h).status_code == 404
    assert client.get("/api/save/..%2F..%2Fetc/passwd/x", headers=h).status_code == 404


def test_ungueltiger_key_422(client):
    assert client.put(f"{SEB}/..evil", json={"data": 1}, headers=client.als()).status_code == 422


def test_data_fehlt_422(client):
    assert client.put(f"{SEB}/x", json={"daten": 1}, headers=client.als()).status_code == 422


def test_groessenlimit_413(client):
    h = client.als()
    gross = "x" * (dbmod.DATEN_MAX + 10)
    assert client.put(f"{SEB}/x", json={"data": gross}, headers=h).status_code == 413
    riesig = "x" * (400 * 1024)
    assert client.put(f"{SEB}/x", json={"data": riesig}, headers=h).status_code == 413


def test_key_limit_413(client):
    h = client.als()
    for i in range(dbmod.KEYS_MAX):
        assert client.put(f"{SEB}/k{i}", json={"data": i}, headers=h).status_code == 200
    assert client.put(f"{SEB}/k-zuviel", json={"data": 1}, headers=h).status_code == 413
    # vorhandenen Key überschreiben geht weiter
    assert client.put(f"{SEB}/k0", json={"data": "neu"}, headers=h).status_code == 200


def test_verlauf_auf_5_gekuerzt(client, umgebung, pid):
    h = client.als()
    for i in range(8):
        client.put(f"{SEB}/stand", json={"data": i}, headers=h)
    client.delete(f"{SEB}/stand", headers=h)
    v = sqlite3.connect(umgebung.db)
    zeilen = v.execute("SELECT data FROM save_history WHERE player=? AND key='stand' ORDER BY id", (pid("seb"),)).fetchall()
    assert [z[0] for z in zeilen] == ["3", "4", "5", "6", "7"]


def test_cli_history_restore_backup(client, umgebung, monkeypatch, capsys, tmp_path):
    h = client.als()
    client.put(f"{SEB}/stand", json={"data": "alt"}, headers=h)
    client.put(f"{SEB}/stand", json={"data": "neu"}, headers=h)
    monkeypatch.setenv("DB_PATH", str(umgebung.db))
    from savesvc.__main__ import main
    assert main(["history", "seb", "seb/zaehler", "stand"]) == 0
    hid = int(capsys.readouterr().out.split()[0])
    assert main(["restore", str(hid)]) == 0
    assert client.get(f"{SEB}/stand", headers=h).json()["data"] == "alt"
    ziel = tmp_path / "backup" / "saves.db"
    assert main(["backup", str(ziel)]) == 0
    assert sqlite3.connect(ziel).execute("SELECT COUNT(*) FROM saves").fetchone()[0] == 1


def test_dev_user_ohne_freigabe_verweigert(monkeypatch):
    from savesvc.config import laden
    monkeypatch.setenv("DEV_USER", "seb")
    monkeypatch.delenv("DEV_ALLOW", raising=False)
    with pytest.raises(SystemExit):
        laden()


def test_unlesbarer_ordner_kippt_liste_nicht(client, umgebung, monkeypatch):
    from pathlib import Path
    echt = Path.iterdir
    def iterdir(self):
        if self.name == "paul":
            raise PermissionError("kein Zugriff")
        return echt(self)
    monkeypatch.setattr(Path, "iterdir", iterdir)
    ids = {s["id"] for s in client.get("/api/games", headers=client.als()).json()}
    assert ids == {"seb/zaehler"}
