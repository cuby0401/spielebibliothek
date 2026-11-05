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

@pytest.fixture
def uclient(umgebung, rsa_schluessel, token, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_COOKIE_SECURE", "1")
    e = Einstellungen(team_domain=TEAM, audience=AUD_UPLOAD, users_file=umgebung.users,
                      spiele_dir=umgebung.spiele, db_path=tmp_path / "unbenutzt.db", dev_user=None)
    daten = tmp_path / "upload-daten"
    daten.mkdir()
    app = up.erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key()), daten=daten)
    c = TestClient(app, base_url="https://testserver")
    c.als = lambda email="paul@example.com", **kw: {"Cf-Access-Jwt-Assertion": token(email=email, **{"aud": AUD_UPLOAD, **kw}), **H}
    c.store = up.Entwickler(daten / "upload.db")
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
    assert (umgebung.spiele / "paul" / "neues-spiel" / "index.html").is_file()
    liste = {s["ordner"]: s for s in uclient.get("/api/upload/spiele", headers=uclient.als()).json()}
    assert liste["neues-spiel"]["title"] == "Neu" and liste["neues-spiel"]["complete"] is True
    assert uclient.delete("/api/upload/spiele/neues-spiel", headers=uclient.als()).status_code == 204
    assert not (umgebung.spiele / "paul" / "neues-spiel").exists()


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


# ---------- Entwürfe und Versionen ----------

def angemeldeter(uclient):
    uclient.store.setzen("paul", "richtiges-passwort-123")
    anmelden(uclient)
    return uclient


def hoch(c, ordner, inhalt, entwurf=False):
    return c.post(f"/api/upload/spiele/{ordner}" + ("?entwurf=true" if entwurf else ""),
                  files={"datei": ("s.zip", zip_bytes({"index.html": inhalt}), "application/zip")}, headers=c.als())


def test_entwurf_veroeffentlichen_und_versionen(uclient, umgebung, monkeypatch):
    c = angemeldeter(uclient)
    basis = umgebung.spiele / "paul"
    assert hoch(c, "rennen", "v1").status_code == 200                       # neu, direkt live
    assert hoch(c, "rennen", "v2-entwurf", entwurf=True).status_code == 200
    assert (basis / "rennen" / "index.html").read_text() == "v1"           # live unverändert
    assert (basis / "rennen~entwurf" / "index.html").read_text() == "v2-entwurf"
    s = {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}["rennen"]
    assert s["entwurf"]["dateien"] == 1 and s["versionen"] == []
    assert c.post("/api/upload/spiele/rennen/veroeffentlichen", headers=c.als()).status_code == 200
    assert (basis / "rennen" / "index.html").read_text() == "v2-entwurf" and not (basis / "rennen~entwurf").exists()
    s = {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}["rennen"]
    assert len(s["versionen"]) == 1 and s["entwurf"] is None
    # Zurücksetzen auf v1 – die aktuelle Version bleibt dabei erhalten
    vid = s["versionen"][0]["id"]
    assert c.post("/api/upload/spiele/rennen/zuruecksetzen", json={"version": vid}, headers=c.als()).status_code == 200
    assert (basis / "rennen" / "index.html").read_text() == "v1"
    s = {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}["rennen"]
    assert len(s["versionen"]) == 1 and s["versionen"][0]["id"] != vid
    assert c.post("/api/upload/spiele/rennen/zuruecksetzen", json={"version": "../../etc"}, headers=c.als()).status_code == 404


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
        hoch(c, "rennen", f"v{i}")
    s = {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}["rennen"]
    assert len(s["versionen"]) == v.VERSIONEN_MAX


def test_nur_entwurf_neues_spiel_und_verwerfen(uclient, umgebung):
    c = angemeldeter(uclient)
    assert hoch(c, "neu", "x", entwurf=True).status_code == 200
    s = {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}["neu"]
    assert s["live"] is None and s["entwurf"] is not None
    assert c.delete("/api/upload/spiele/neu/entwurf", headers=c.als()).status_code == 204
    assert "neu" not in {x["ordner"] for x in c.get("/api/upload/spiele", headers=c.als()).json()}


def test_loeschen_raeumt_alles_weg(uclient, umgebung):
    c = angemeldeter(uclient)
    hoch(c, "weg", "1"); hoch(c, "weg", "2"); hoch(c, "weg", "3", entwurf=True)
    assert c.delete("/api/upload/spiele/weg", headers=c.als()).status_code == 204
    assert not [p for p in (umgebung.spiele / "paul").iterdir() if p.name.startswith("weg")]


# ---------- „Was ist neu“ (05.11.2026) ----------

def test_was_ist_neu_wandert_mit_dem_ordner(uclient, umgebung):
    c = angemeldeter(uclient)
    basis = umgebung.spiele / "paul"
    r = c.post("/api/upload/spiele/rennen?entwurf=true", data={"neu": "  Neues   Level 4\n"},
               files={"datei": ("s.zip", zip_bytes({"index.html": "v2"}), "application/zip")}, headers=c.als())
    assert r.status_code == 200, r.text
    s = {x["ordner"]: x for x in c.get("/api/upload/spiele", headers=c.als()).json()}["rennen"]
    assert s["neuEntwurf"]["text"] == "Neues Level 4" and s["neu"] is None
    assert c.post("/api/upload/spiele/rennen/veroeffentlichen", headers=c.als()).status_code == 200
    from savesvc import games
    assert games.beschreibung(umgebung.spiele, "paul", "rennen")["neu"]["text"] == "Neues Level 4"
    # ohne Text: keine Datei, die neue Version hat keinen Änderungstext
    assert hoch(c, "rennen", "v3").status_code == 200
    assert not (basis / "rennen" / games.NEU_DATEI).exists()
