import json
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from savesvc import upload as up
from savesvc import zipinstall
from savesvc.config import Einstellungen

from .conftest import AUD, TEAM, Schluessel

AUD_UPLOAD = "aud-upload-456"
H = {"X-Upload": "1"}


def zip_bytes(eintraege):
    """eintraege: {name: inhalt} oder (ZipInfo, inhalt)-Paare"""
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
        for e in (eintraege.items() if isinstance(eintraege, dict) else eintraege):
            z.writestr(*e)
    return puffer.getvalue()


SPIEL = {"index.html": "<!doctype html>", "game.json": '{"title":"Neu"}', "js/spiel.js": "1",
         "virus.exe": "MZ", ".env": "GEHEIM=1", "__MACOSX/._index.html": "x"}


# ---------- ZIP-Installation ----------

def test_installieren_oben(tmp_path):
    ziel = tmp_path / "paul" / "snake"
    e = zipinstall.installieren(io.BytesIO(zip_bytes(SPIEL)), ziel)
    assert sorted(p.relative_to(ziel).as_posix() for p in ziel.rglob("*") if p.is_file()) == ["game.json", "index.html", "js/spiel.js"]
    assert sorted(e.uebersprungen) == [".env", "virus.exe"]
    assert oct((ziel / "index.html").stat().st_mode & 0o777) == "0o660"


def test_umschliessender_ordner_wird_erkannt(tmp_path):
    ziel = tmp_path / "s"
    zipinstall.installieren(io.BytesIO(zip_bytes({"mein-spiel/index.html": "x", "mein-spiel/a.png": "y"})), ziel)
    assert (ziel / "index.html").is_file() and (ziel / "a.png").is_file()


def test_update_ersetzt_ordner_komplett(tmp_path):
    ziel = tmp_path / "s"
    zipinstall.installieren(io.BytesIO(zip_bytes({"index.html": "v1", "alt.js": "1"})), ziel)
    zipinstall.installieren(io.BytesIO(zip_bytes({"index.html": "v2"})), ziel)
    assert (ziel / "index.html").read_text() == "v2" and not (ziel / "alt.js").exists()
    assert [p.name for p in tmp_path.iterdir()] == ["s"]   # keine .neu-/.alt-Reste


@pytest.mark.parametrize("name", ["../index.html", "a/../../x.html", "/etc/x.html", "a\\..\\x.html", "C:/x.html"])
def test_zip_slip_abgelehnt(tmp_path, name):
    with pytest.raises(zipinstall.UngueltigesZip):
        zipinstall.installieren(io.BytesIO(zip_bytes({"index.html": "x", name: "boese"})), tmp_path / "s")
    assert not (tmp_path / "s").exists() and not (tmp_path.parent / "x.html").exists()


def test_symlink_abgelehnt(tmp_path):
    link = zipfile.ZipInfo("link.html")
    link.external_attr = (0o120777 << 16)
    with pytest.raises(zipinstall.UngueltigesZip, match="Symlink"):
        zipinstall.installieren(io.BytesIO(zip_bytes([("index.html", "x"), (link, "/etc/passwd")])), tmp_path / "s")


def test_ohne_index_html(tmp_path):
    with pytest.raises(zipinstall.UngueltigesZip, match="index.html"):
        zipinstall.installieren(io.BytesIO(zip_bytes({"spiel.html": "x"})), tmp_path / "s")


def test_kein_zip(tmp_path):
    with pytest.raises(zipinstall.UngueltigesZip):
        zipinstall.installieren(io.BytesIO(b"das ist kein zip"), tmp_path / "s")


def test_zip_bombe(tmp_path, monkeypatch):
    monkeypatch.setattr(zipinstall, "MAX_GESAMT", 10_000)
    with pytest.raises(zipinstall.UngueltigesZip, match="entpackt"):
        zipinstall.installieren(io.BytesIO(zip_bytes({"index.html": "x", "a.bin": b"\0" * 50_000})), tmp_path / "s")
    assert not (tmp_path / "s").exists()


def test_bombe_mit_falscher_groessenangabe(tmp_path, monkeypatch):
    # Header behauptet kleine Datei – gezählt wird beim Entpacken
    monkeypatch.setattr(zipinstall, "MAX_EINZELDATEI", 1000)
    roh = bytearray(zip_bytes({"index.html": "x", "a.bin": b"\0" * 5000}))
    with pytest.raises(zipinstall.UngueltigesZip):
        zipinstall.installieren(io.BytesIO(bytes(roh)), tmp_path / "s")


# ---------- Upload-API ----------

class FalscherSpeicher:
    """Ersatz für den Speicher-Dienst (interne Schnittstelle)."""

    def __init__(self):
        self.aufrufe = []
        self.tests = {"geoeffnet": True, "migrationOk": 1, "migrationFehler": [], "fehler": 0}
        self.weg = False

    def __call__(self, methode, pfad, body=None):
        from fastapi import HTTPException
        self.aufrufe.append((methode, pfad.split("?")[0], body))
        if self.weg:
            raise HTTPException(502, "Speicher-Dienst nicht erreichbar")
        if pfad.startswith("/intern/entwurf/") and methode == "GET":
            return self.tests
        if pfad.startswith("/intern/season/"):
            return {"season": 2}
        if pfad.startswith("/intern/spielstaende-zurueck/"):
            return {"zurueckgeholt": 3, "ohneAltenStand": 0}
        return None


@pytest.fixture
def uclient(umgebung, rsa_schluessel, token, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_COOKIE_SECURE", "1")
    e = Einstellungen(team_domain=TEAM, audience=AUD_UPLOAD, users_file=umgebung.users,
                      spiele_dir=umgebung.spiele, db_path=tmp_path / "unbenutzt.db", dev_user=None)
    daten = tmp_path / "upload-daten"
    daten.mkdir()
    speicher = FalscherSpeicher()
    app = up.erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key()), daten=daten, speicher=speicher)
    c = TestClient(app, base_url="https://testserver")
    c.als = lambda email="paul@example.com", **kw: {"Cf-Access-Jwt-Assertion": token(email=email, **{"aud": AUD_UPLOAD, **kw}), **H}
    c.store = up.Entwickler(daten / "upload.db")
    c.speicher = speicher
    return c


def anmelden(c, pw="richtiges-passwort-123", email="paul@example.com"):
    return c.post("/api/upload/anmelden", json={"passwort": pw}, headers=c.als(email))


def test_ohne_access_401_und_falsche_aud(uclient):
    assert uclient.get("/api/upload/status").status_code == 401

    from .conftest import AUD as GAMES_AUD

    # Token der Anwendung "games" gilt hier nicht
    r = uclient.get("/api/upload/status", headers={"Cf-Access-Jwt-Assertion": uclient.als(aud=GAMES_AUD)["Cf-Access-Jwt-Assertion"]})
    assert r.status_code == 401


def test_ohne_konto(uclient):
    assert uclient.get("/api/upload/status", headers=uclient.als()).json()["entwickler"] is False
    assert anmelden(uclient).status_code == 403


def test_anmelden_hochladen_listen_loeschen(uclient, umgebung):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    assert uclient.get("/api/upload/spiele", headers=uclient.als()).status_code == 401   # ohne Passwort
    r = anmelden(uclient)
    assert r.status_code == 204
    keks = r.headers["set-cookie"]
    assert "HttpOnly" in keks and "Secure" in keks and "SameSite=strict" in keks and "Path=/api/upload" in keks
    datei = {"datei": ("spiel.zip", zip_bytes(SPIEL), "application/zip")}
    r = uclient.post("/api/upload/spiele/neues-spiel", files=datei, headers=uclient.als())
    assert r.status_code == 200, r.text
    assert r.json()["dateien"] == 3 and sorted(r.json()["uebersprungen"]) == [".env", "virus.exe"]
    assert (umgebung.spiele / "paul" / "neues-spiel~entwurf" / "index.html").is_file()   # immer erst Entwurf (E35)
    liste = {s["ordner"]: s for s in uclient.get("/api/upload/spiele", headers=uclient.als()).json()}
    assert liste["neues-spiel"]["title"] == "Neu" and liste["neues-spiel"]["complete"] is True
    assert uclient.delete("/api/upload/spiele/neues-spiel", headers=uclient.als()).status_code == 204
    assert not [p for p in (umgebung.spiele / "paul").iterdir() if "neues-spiel" in p.name]


def test_nur_eigener_ordner(uclient, umgebung):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    anmelden(uclient)
    # Ordnernamen mit Pfadanteilen werden abgelehnt
    for ordner in ["..", ".versteckt", "a%2Fb"]:
        r = uclient.delete(f"/api/upload/spiele/{ordner}", headers=uclient.als())
        assert r.status_code in (404, 422)
    assert (umgebung.spiele / "seb" / "zaehler").is_dir()


def test_cookie_eines_anderen_gilt_nicht(uclient):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    uclient.store.setzen("seb", "anderes-passwort-12345")
    anmelden(uclient)                                  # Cookie für paul
    r = uclient.get("/api/upload/spiele", headers=uclient.als("seb@example.com"))
    assert r.status_code == 401


def test_sperre_nach_fehlversuchen(uclient):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    for _ in range(up.FEHL_MAX):
        assert anmelden(uclient, "falsch").status_code == 401
    assert anmelden(uclient).status_code == 429        # auch das richtige Passwort jetzt gesperrt


def test_csrf_header_pflicht(uclient):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    ohne = {k: v for k, v in uclient.als().items() if k != "X-Upload"}
    assert uclient.post("/api/upload/anmelden", json={"passwort": "richtiges-passwort-123"}, headers=ohne).status_code == 403


def test_kaputtes_zip_422(uclient):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    anmelden(uclient)
    r = uclient.post("/api/upload/spiele/x", files={"datei": ("x.zip", b"kein zip", "application/zip")}, headers=uclient.als())
    assert r.status_code == 422


def test_cli_entwickler_anlegen(umgebung, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("UPLOAD_DATA", str(tmp_path / "ud"))
    monkeypatch.setenv("USERS_FILE", str(umgebung.users))
    monkeypatch.setenv("SPIELE_DIR", str(umgebung.spiele))
    from savesvc.__main__ import main
    assert main(["entwickler", "anlegen", "paul"]) == 0
    pw = [z.split()[-1] for z in capsys.readouterr().out.splitlines() if z.startswith("Passwort:")][0]
    assert len(pw) == 20
    assert up.Entwickler(tmp_path / "ud" / "upload.db").pruefen("paul", pw)
    assert main(["entwickler", "sperren", "paul"]) == 0
    assert not up.Entwickler(tmp_path / "ud" / "upload.db").vorhanden("paul")


def test_intern_nur_mit_token(uclient, monkeypatch, umgebung):
    assert uclient.get("/intern/entwickler").status_code == 403          # kein Token gesetzt → immer gesperrt


def test_intern_mit_token(umgebung, rsa_schluessel, token, tmp_path, monkeypatch):
    monkeypatch.setenv("INTERN_TOKEN", "geheim-123")
    e = Einstellungen(team_domain=TEAM, audience=AUD_UPLOAD, users_file=umgebung.users,
                      spiele_dir=umgebung.spiele, db_path=tmp_path / "x.db", dev_user=None)
    (tmp_path / "ud").mkdir()
    c = TestClient(up.erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key()), daten=tmp_path / "ud"))
    t = {"X-Intern-Token": "geheim-123"}
    assert c.get("/intern/entwickler", headers={"X-Intern-Token": "falsch"}).status_code == 403
    r = c.post("/intern/entwickler", json={"name": "emil"}, headers=t)
    assert r.status_code == 201 and len(r.json()["passwort"]) == 20 and (umgebung.spiele / "emil").is_dir()
    assert c.post("/intern/entwickler", json={"name": "emil"}, headers=t).status_code == 409
    assert len(c.post("/intern/entwickler/emil/passwort", headers=t).json()["passwort"]) == 20
    assert [x["player"] for x in c.get("/intern/entwickler", headers=t).json()] == ["emil"]
    assert c.delete("/intern/spiele/paul/snake", headers=t).status_code == 204 and not (umgebung.spiele / "paul" / "snake").exists()
    assert c.delete("/intern/entwickler/emil", headers=t).status_code == 204
    assert {x["aktion"] for x in c.get("/intern/ereignisse", headers=t).json()} >= {"Upload-Konto angelegt", "gelöscht (Admin)"}


# ---------- Entwürfe, Versionen, Update-Fenster (E28, E35–E37) ----------

def angemeldeter(uclient):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    anmelden(uclient)
    return uclient


GS = '<!doctype html><script src="/lib/gamesave.js"></script>'


def hoch(c, ordner, inhalt=GS, neu="", game=None):
    dateien = {"index.html": inhalt}
    if game is not None:
        dateien["game.json"] = game if isinstance(game, str) else json.dumps(game)
    return c.post(f"/api/upload/spiele/{ordner}", data={"neu": neu},
                  files={"datei": ("s.zip", zip_bytes(dateien), "application/zip")}, headers=c.als())


def veroeff(c, ordner, art="minor", aenderungen=("Test",), **kw):
    return c.post(f"/api/upload/spiele/{ordner}/veroeffentlichen", json={"art": art, "aenderungen": list(aenderungen), **kw},
                  headers=c.als())


def liste(c):
    return {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}


def test_upload_ist_immer_entwurf_und_versionsnummern(uclient, umgebung):
    c = angemeldeter(uclient)
    basis = umgebung.spiele / "paul"
    assert hoch(c, "rennen", neu="Erste Version").status_code == 200
    assert not (basis / "rennen").exists() and (basis / "rennen~entwurf").is_dir()
    assert ("POST", "/intern/entwurf/paul/rennen/zuruecksetzen", None) in c.speicher.aufrufe
    pr = c.get("/api/upload/spiele/rennen/pruefung", headers=c.als()).json()
    assert pr["erstveroeffentlichung"] and pr["aenderungen"] == ["Erste Version"] and pr["fehler"] == 0
    r = veroeff(c, "rennen", "major", ["Erste Version"])
    assert r.status_code == 200, r.text
    assert r.json()["version"] == "1.0.0"                                   # erste Veröffentlichung immer 1.0.0
    assert not (basis / "rennen" / ".entwurf.json").exists()
    hoch(c, "rennen", GS + "v2", neu="Neues Level 4")
    hoch(c, "rennen", GS + "v2b", neu="Sprung-Fehler behoben")
    s = liste(c)["rennen"]
    assert s["version"] == "1.0.0" and [a["text"] for a in s["aenderungen"]] == ["Neues Level 4", "Sprung-Fehler behoben"]
    assert veroeff(c, "rennen", "minor", ["Neues Level 4", "Sprung-Fehler behoben"]).json()["version"] == "1.1.0"
    assert hoch(c, "rennen", GS + "v3").status_code == 200
    assert veroeff(c, "rennen", "patch", ["Hotfix"]).json()["version"] == "1.1.1"
    s = liste(c)["rennen"]
    assert s["version"] == "1.1.1" and s["aenderungen"] == [] and [r["version"] for r in s["releases"]] == ["1.1.1", "1.1.0", "1.0.0"]
    from savesvc import games
    b = games.beschreibung(umgebung.spiele, "paul", "rennen")
    assert b["version"] == "1.1.1" and b["neu"]["aenderungen"] == ["Hotfix"]
    # Ohne Änderungstext oder mit falscher Art geht es nicht
    hoch(c, "rennen", GS + "v4")
    assert veroeff(c, "rennen", "patch", []).status_code == 422
    assert veroeff(c, "rennen", "riesig").status_code == 422


def test_pruefung_blockiert_bei_fehlern(uclient, umgebung):
    c = angemeldeter(uclient)
    hoch(c, "spiel", game={"saveVersion": 2})
    assert veroeff(c, "spiel").status_code == 200
    hoch(c, "spiel", game={"saveVersion": 1})                              # saveVersion gesunken
    pr = c.get("/api/upload/spiele/spiel/pruefung", headers=c.als()).json()
    assert pr["fehler"] == 1 and any("gesunken" in x["text"] for x in pr["punkte"])
    assert veroeff(c, "spiel", warnungenGelesen=True).status_code == 409
    hoch(c, "spiel", game="{ kaputt")
    assert c.get("/api/upload/spiele/spiel/pruefung", headers=c.als()).json()["fehler"] >= 1
    # ohne index.html lehnt schon der Upload ab (die Prüfung fängt es zusätzlich ab)
    assert c.post("/api/upload/spiele/spiel", files={"datei": ("s.zip", zip_bytes({"spiel.html": GS}), "application/zip")},
                  headers=c.als()).status_code == 422


def test_pruefung_warnungen_muessen_bestaetigt_werden(uclient):
    c = angemeldeter(uclient)
    hoch(c, "w", '<script src="https://cdn.example.com/three.js"></script><img src="/bild.png">')
    pr = c.get("/api/upload/spiele/w/pruefung", headers=c.als()).json()
    texte = " ".join(x["text"] for x in pr["punkte"] if x["stufe"] == "warnung")
    assert "gamesave.js" in texte and "Absolute Pfade" in texte and "fremden Servern" in texte
    assert veroeff(c, "w").status_code == 409
    assert veroeff(c, "w", warnungenGelesen=True).status_code == 200


def test_pruefung_nutzt_testergebnisse(uclient):
    c = angemeldeter(uclient)
    hoch(c, "m", game={"saveVersion": 1}); veroeff(c, "m")
    hoch(c, "m", game={"saveVersion": 2})
    c.speicher.tests = {"geoeffnet": False, "migrationOk": 0, "migrationFehler": [], "fehler": 2}
    texte = [x["text"] for x in c.get("/api/upload/spiele/m/pruefung", headers=c.als()).json()["punkte"] if x["stufe"] == "warnung"]
    assert any("noch nicht getestet" in t for t in texte) and any("Umwandlung" in t for t in texte) and any("2 JavaScript-Fehler" in t for t in texte)
    c.speicher.tests = {"geoeffnet": True, "migrationOk": 0, "migrationFehler": ["stand: saveVersion 1 → 2 – TypeError"], "fehler": 0}
    assert c.get("/api/upload/spiele/m/pruefung", headers=c.als()).json()["fehler"] == 1
    c.speicher.weg = True          # Speicher-Dienst weg: nur Warnung, Upload selbst klappt trotzdem
    assert hoch(c, "m", game={"saveVersion": 2}).status_code == 200
    assert any("nicht abrufbar" in x["text"] for x in c.get("/api/upload/spiele/m/pruefung", headers=c.als()).json()["punkte"])


def test_neue_season_bei_geaenderter_bestenliste(uclient):
    c = angemeldeter(uclient)
    hoch(c, "b", game={"leaderboard": {"enabled": True, "order": "desc"}}); veroeff(c, "b")
    hoch(c, "b", game={"leaderboard": {"enabled": True, "order": "asc"}})
    pr = c.get("/api/upload/spiele/b/pruefung", headers=c.als()).json()
    assert pr["seasonEmpfohlen"] is True
    r = veroeff(c, "b", warnungenGelesen=True, neueSeason=True)
    assert r.json()["season"] == 2 and ("POST", "/intern/season/paul/b", None) in c.speicher.aufrufe


def test_rollback_fragt_bei_saveversion_grenze(uclient, umgebung):
    c = angemeldeter(uclient)
    basis = umgebung.spiele / "paul"
    hoch(c, "r", GS + "v1", game={"saveVersion": 1}); veroeff(c, "r")
    hoch(c, "r", GS + "v2", game={"saveVersion": 2}); veroeff(c, "r")
    vid = liste(c)["r"]["versionen"][0]["id"]
    r = c.post("/api/upload/spiele/r/zuruecksetzen", json={"version": vid}, headers=c.als())
    assert r.status_code == 409 and r.json()["detail"]["frage"] == "spielstaende"
    assert (basis / "r" / "index.html").read_text().endswith("v2")         # noch nichts passiert
    r = c.post("/api/upload/spiele/r/zuruecksetzen", json={"version": vid, "spielstaende": "zuruecksetzen"}, headers=c.als())
    assert r.status_code == 200 and r.json()["spielstaende"]["zurueckgeholt"] == 3
    assert ("POST", "/intern/spielstaende-zurueck/paul/r", {"bisSaveVersion": 1}) in c.speicher.aufrufe
    assert (basis / "r" / "index.html").read_text().endswith("v1")
    s = liste(c)["r"]
    assert s["version"] == "1.0.0" and s["releases"][0]["art"] == "rollback"
    # zurück auf 1.1.0 (gleiche Richtung nach oben): keine Frage
    vid2 = s["versionen"][0]["id"]
    assert c.post("/api/upload/spiele/r/zuruecksetzen", json={"version": vid2}, headers=c.als()).status_code == 200
    assert c.post("/api/upload/spiele/r/zuruecksetzen", json={"version": "../../etc"}, headers=c.als()).status_code == 404


def test_rollback_spielstaende_behalten(uclient):
    c = angemeldeter(uclient)
    hoch(c, "k", game={"saveVersion": 1}); veroeff(c, "k")
    hoch(c, "k", game={"saveVersion": 3}); veroeff(c, "k")
    vid = liste(c)["k"]["versionen"][0]["id"]
    vorher = len(c.speicher.aufrufe)
    assert c.post("/api/upload/spiele/k/zuruecksetzen", json={"version": vid, "spielstaende": "behalten"}, headers=c.als()).status_code == 200
    assert not [a for a in c.speicher.aufrufe[vorher:] if "spielstaende-zurueck" in a[1]]


def test_nur_letzte_versionen_bleiben(uclient, umgebung, monkeypatch):
    import savesvc.versionen as v
    from datetime import datetime as echt, timezone
    zaehler = iter(range(100))
    class Zeit:
        @staticmethod
        def now(tz=None):
            return echt(2026, 11, 5, 10, 0, next(zaehler), tzinfo=timezone.utc)
        strptime = staticmethod(echt.strptime)
        fromtimestamp = staticmethod(echt.fromtimestamp)
    monkeypatch.setattr(v, "datetime", Zeit)
    c = angemeldeter(uclient)
    for i in range(8):
        hoch(c, "rennen", GS + f"v{i}"); veroeff(c, "rennen", "patch")
    s = liste(c)["rennen"]
    assert len(s["versionen"]) == v.VERSIONEN_MAX and s["version"] == "1.0.7"


def test_entwurf_verwerfen(uclient, umgebung):
    c = angemeldeter(uclient)
    assert hoch(c, "neu", neu="wird verworfen").status_code == 200
    s = liste(c)["neu"]
    assert s["live"] is None and s["entwurf"] is not None
    assert c.delete("/api/upload/spiele/neu/entwurf", headers=c.als()).status_code == 204
    assert "neu" not in liste(c)


def test_loeschen_raeumt_alles_weg(uclient, umgebung):
    c = angemeldeter(uclient)
    hoch(c, "weg"); veroeff(c, "weg"); hoch(c, "weg"); veroeff(c, "weg"); hoch(c, "weg")
    assert c.delete("/api/upload/spiele/weg", headers=c.als()).status_code == 204
    assert not [p for p in (umgebung.spiele / "paul").iterdir() if "weg" in p.name]


def test_speicher_kontingent(uclient, umgebung, monkeypatch):
    c = angemeldeter(uclient)
    monkeypatch.setenv("UPLOAD_KONTINGENT_MB", "10")
    assert c.get("/api/upload/status", headers=c.als()).json()["speicher"]["grenze"] == 10 * 1024 * 1024
    gross = zip_bytes({"index.html": GS, "daten.bin": b"x" * (11 * 1024 * 1024)})
    r = c.post("/api/upload/spiele/riesig", files={"datei": ("s.zip", gross, "application/zip")}, headers=c.als())
    assert r.status_code == 413 and "Speicher ist voll" in r.json()["detail"]
    assert not (umgebung.spiele / "paul" / "riesig~entwurf").exists()
    assert hoch(c, "klein").status_code == 200
    s = liste(c)["klein"]["speicher"]
    assert s["entwurf"] > 0 and s["live"] == 0 and s["versionen"] == 0
