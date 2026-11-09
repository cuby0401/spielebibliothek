"""Zentrale 1.5.0: Umstellung der Identität auf UUIDs (E81) – nichts darf verloren gehen oder verrutschen."""
import json
import sqlite3

import pytest

from savesvc import crm as crm_modul
from savesvc import identitaet
from savesvc.db import Datenbank


def _stand(pfad):
    """Alle Tabellen als vergleichbarer Inhalt (ohne die neuen Spalten/Tabellen von 1.5.0)."""
    v = sqlite3.connect(pfad)
    try:
        aus = {}
        for (t,) in v.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite%' AND name NOT IN ('migrationen','handles')"):
            spalten = [z[1] for z in v.execute(f"PRAGMA table_info({t})") if not (t == "personen" and z[1] in identitaet.NEUE_SPALTEN)]
            aus[t] = v.execute(f"SELECT {', '.join(spalten)} FROM {t} ORDER BY rowid").fetchall()
        return aus
    finally:
        v.close()


@pytest.fixture
def daten(tmp_path):
    pfad = tmp_path / "saves.db"
    db = Datenbank(pfad)
    crm = crm_modul.Crm(db, frozenset({"seb"}))
    crm.anlegen("übernahme", "seb", "seb@example.com", ["admin", "spieler"], status="aktiv", aktion="uebernommen")
    crm.anlegen("seb", "paul", "paul@example.com", ["entwickler", "spieler"], status="aktiv")
    db.speichern("seb", "seb/wortjagd", "stand", {"level": 7, "name": "seb"}, 1)     # „seb“ im Spielstand bleibt!
    db.speichern("seb", "seb/wortjagd", "stand", {"level": 8}, 1)                    # → Verlauf
    db.speichern("paul", "paul/Dino_Park", "stand", {"dinos": 3}, 1)
    db.speichern("seb~spieler", "seb/wortjagd", "stand", {"level": 1}, 1)            # „Ansicht als …“
    db.speichern("altkonto", "seb/wortjagd", "stand", {"level": 2}, 1)               # Konto ohne Person
    db.score_eintragen("paul", "seb/wortjagd", 1, 120, {"zeit": 30})
    db.score_eintragen("seb", "seb/wortjagd", 1, 90)
    db.melden("*", "Neues Spiel")                                                    # an alle – bleibt „*“
    db.melden("paul", "seb hat dich überholt")
    db.auftrag_anlegen("e2e-tests", "probe", "deploy", "mac")
    db.sicherheit_eintragen("notaus", "seb", "Not-Aus ein")
    return pfad, tmp_path


def test_umstellung_ersetzt_namen_durch_uuids_und_sonst_nichts(daten):
    pfad, tmp = daten
    vorher = _stand(pfad)
    bericht = identitaet.umstellen(pfad, tmp / "backup" / "vor-uuid.db")
    assert bericht["umgestellt"] and bericht["personen"] == 3 and bericht["verwaist"] == ["altkonto"]
    assert (tmp / "backup" / "vor-uuid.db").stat().st_size > 0                     # Sicherung liegt da
    assert _stand(tmp / "backup" / "vor-uuid.db") == vorher                         # … und ist der Stand vorher

    v = sqlite3.connect(pfad); v.row_factory = sqlite3.Row
    p = {z["alt_name"]: dict(z) for z in v.execute("SELECT * FROM personen")}
    assert all(identitaet.UUID_MUSTER.match(x["id"]) and x["name"] == x["id"] for x in p.values())
    assert [p[n]["nr"] for n in sorted(p, key=lambda n: p[n]["nr"])] == [1, 2, 3]
    assert p["seb"]["handle"] == "seb" and p["altkonto"]["status"] == "archiviert"
    seb, paul = p["seb"]["id"], p["paul"]["id"]
    # Spielstände: Besitzer ist die UUID, Inhalt Byte für Byte gleich (auch der Name „seb“ im Spielstand selbst)
    saves = {(z["player"], z["game"]): z["data"] for z in v.execute("SELECT * FROM saves")}
    assert json.loads(saves[(seb, "seb/wortjagd")]) == {"level": 8}
    assert (seb + "~spieler", "seb/wortjagd") in saves and (p["altkonto"]["id"], "seb/wortjagd") in saves
    assert [json.loads(z["data"]) for z in v.execute("SELECT data FROM save_history WHERE player=?", (seb,))] == [{"level": 7, "name": "seb"}]
    assert {z["player"] for z in v.execute("SELECT player FROM scores")} == {seb, paul}
    # Sonderwerte bleiben
    assert {z["an"] for z in v.execute("SELECT an FROM meldungen")} == {"*", paul}
    assert v.execute("SELECT von FROM auftraege").fetchone()[0] == "mac"
    assert v.execute("SELECT wer FROM sicherheit").fetchone()[0] == seb
    assert {z["von"] for z in v.execute("SELECT von FROM crm_protokoll")} == {"übernahme", seb}
    assert {z["name"] for z in v.execute("SELECT name FROM person_emails")} == {seb, paul}
    assert {z["handle"] for z in v.execute("SELECT handle FROM handles")} == {"seb", "paul", "altkonto"}
    # Spiel-IDs (Ordner) bleiben beim alten Namen (E82)
    assert {z["game"] for z in v.execute("SELECT game FROM saves")} == {"seb/wortjagd", "paul/Dino_Park"}
    v.close()


def test_zweiter_lauf_aendert_nichts(daten):
    pfad, tmp = daten
    identitaet.umstellen(pfad, tmp / "b1.db")
    stand = _stand(pfad)
    assert identitaet.umstellen(pfad, tmp / "b2.db") == {"umgestellt": False, "grund": "schon umgestellt"}
    assert _stand(pfad) == stand and not (tmp / "b2.db").exists()


def test_rueckweg_ist_exakt_und_erneute_umstellung_behaelt_ids(daten):
    pfad, tmp = daten
    vorher = _stand(pfad)
    identitaet.umstellen(pfad, tmp / "b1.db")
    ids = dict(sqlite3.connect(pfad).execute("SELECT alt_name, id FROM personen").fetchall())
    assert identitaet.zurueck(pfad, tmp / "b2.db")["zurueck"]
    nachher = _stand(pfad)
    # Die verwaiste Person bleibt als archivierter Eintrag – sonst ist alles wie vor der Umstellung
    nachher["personen"] = [z for z in nachher["personen"] if z[0] != "altkonto"]
    assert nachher == vorher
    assert not identitaet.umgestellt(pfad)
    # 1.4.1 läuft auf dieser Datenbank (Schema-Anlage und Lesen gehen)
    db = Datenbank(pfad)
    assert db.laden("seb", "seb/wortjagd", "stand") is not None
    # Wieder vorwärts: dieselben UUIDs und Nummern
    identitaet.umstellen(pfad, tmp / "b3.db")
    assert dict(sqlite3.connect(pfad).execute("SELECT alt_name, id FROM personen").fetchall()) == ids


def test_fehler_mitten_in_der_umstellung_laesst_alles_unveraendert(daten):
    pfad, tmp = daten
    vorher = _stand(pfad)

    def kaputt(v):   # simuliert einen Fehler: ein Spielstand ändert sich während der Umstellung
        v.execute("UPDATE saves SET data='{\"level\": 0}' WHERE game='paul/Dino_Park'")

    with pytest.raises(identitaet.UmstellungFehlgeschlagen, match="saves"):
        identitaet.umstellen(pfad, tmp / "b.db", _nach_umstellung=kaputt)
    assert _stand(pfad) == vorher and not identitaet.umgestellt(pfad)


def test_fehlende_zuordnung_wird_erkannt(daten):
    pfad, tmp = daten

    def neuer_name(v):   # ein Spielstand unter einem Namen, der keiner Person gehört
        v.execute("INSERT INTO saves (player, game, key, data, save_version, updated_at) VALUES ('fremd','x','k','1',1,'2026')")

    with pytest.raises(identitaet.UmstellungFehlgeschlagen):
        identitaet.umstellen(pfad, tmp / "b.db", _nach_umstellung=neuer_name)
    assert not identitaet.umgestellt(pfad)
    assert sqlite3.connect(pfad).execute("SELECT COUNT(*) FROM saves WHERE player='fremd'").fetchone()[0] == 0


def test_leere_datenbank(tmp_path):
    Datenbank(tmp_path / "saves.db")
    crm_modul.Crm(Datenbank(tmp_path / "saves.db"))
    assert identitaet.umstellen(tmp_path / "saves.db", tmp_path / "b.db")["personen"] == 0


# ---------- Schritt 1: Umstellung beim Start, Rückweg-Befehle ----------

def _einstellungen(umgebung, **kw):
    from savesvc.config import Einstellungen
    kw.setdefault("identitaet_uuid", False)        # ohne Angabe: Stand 1.4.1 (ohne Umstellung)
    return Einstellungen(team_domain="t", audience="a", users_file=umgebung.users, spiele_dir=umgebung.spiele,
                         db_path=umgebung.db, dev_user=None, **kw)


def test_start_ohne_schalter_stellt_nicht_um(umgebung):
    from savesvc.app import erstellen
    erstellen(_einstellungen(umgebung))
    assert not identitaet.umgestellt(umgebung.db)
    assert not list((umgebung.db.parent / "backup").glob("vor-uuid-*.db"))


def test_start_stellt_einmal_um_mit_sicherung(umgebung):
    from savesvc.app import erstellen
    erstellen(_einstellungen(umgebung, identitaet_uuid=True))
    assert identitaet.umgestellt(umgebung.db)
    sicherungen = list((umgebung.db.parent / "backup").glob("vor-uuid-*.db"))
    assert len(sicherungen) == 1
    # Die Sicherung ist der Stand vor der Umstellung: dort stehen noch die Benutzernamen
    assert {z[0] for z in sqlite3.connect(sicherungen[0]).execute("SELECT name FROM personen")} == {"seb", "paul"}
    stempel = sicherungen[0].stat().st_mtime
    erstellen(_einstellungen(umgebung, identitaet_uuid=True))       # zweiter Start: nichts mehr zu tun
    assert sicherungen[0].stat().st_mtime == stempel


def test_start_nach_fehler_verweigert(umgebung, monkeypatch):
    from savesvc.app import erstellen
    erstellen(_einstellungen(umgebung))                                # Ausgangsstand 1.4.1
    vorher = _stand(umgebung.db)

    def kaputt(v):
        v.execute("DELETE FROM scores")
        v.execute("INSERT INTO saves (player, game, key, data, save_version, updated_at) VALUES ('x','y','z','1',1,'2026')")
    echt = identitaet.umstellen
    monkeypatch.setattr(identitaet, "umstellen", lambda p, s: echt(p, s, _nach_umstellung=kaputt))
    with pytest.raises(SystemExit, match="UUID"):
        erstellen(_einstellungen(umgebung, identitaet_uuid=True))
    assert _stand(umgebung.db) == vorher and not identitaet.umgestellt(umgebung.db)


def test_befehle_status_und_zurueck(umgebung, monkeypatch, capsys):
    from savesvc.__main__ import main
    from savesvc.app import erstellen
    erstellen(_einstellungen(umgebung))
    vorher = _stand(umgebung.db)
    monkeypatch.setenv("DB_PATH", str(umgebung.db))
    assert main(["identitaet-status"]) == 0 and capsys.readouterr().out.strip() == "nicht umgestellt"
    erstellen(_einstellungen(umgebung, identitaet_uuid=True))
    assert main(["identitaet-status"]) == 0 and capsys.readouterr().out.strip() == "umgestellt"
    assert main(["identitaet-zurueck", str(umgebung.db.parent / "backup" / "vor-rueckweg.db")]) == 0
    assert (umgebung.db.parent / "backup" / "vor-rueckweg.db").is_file()
    assert _stand(umgebung.db) == vorher and not identitaet.umgestellt(umgebung.db)


# ---------- Schritt 2: nach außen nie eine UUID ----------

def test_keine_uuid_in_antworten(umgebung, rsa_schluessel, token, monkeypatch):
    """Ruft jeden GET-Endpunkt unter /api/ auf – als Spieler (paul) und als Admin (seb), mit Daten in allen Bereichen.
    Keine Antwort darf eine Personen-UUID enthalten; überall stehen Handles."""
    import re as _re
    from fastapi.testclient import TestClient
    from savesvc import verwaltung
    from savesvc.app import erstellen
    from .conftest import AUD, TEAM, Schluessel
    from savesvc.config import Einstellungen

    monkeypatch.setattr(verwaltung.UploadDienst, "__call__", lambda self, m, p, b=None: [] if m == "GET" else {"passwort": "x"})
    e = Einstellungen(team_domain=TEAM, audience=AUD, users_file=umgebung.users, spiele_dir=umgebung.spiele,
                      db_path=umgebung.db, dev_user=None, identitaet_uuid=True)
    app = erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key()))
    c = TestClient(app)
    seb = {"Cf-Access-Jwt-Assertion": token(), "X-Bibliothek": "1"}
    paul = {"Cf-Access-Jwt-Assertion": token(email="paul@example.com"), "X-Bibliothek": "1"}
    assert identitaet.umgestellt(umgebung.db)

    # Daten in allen Bereichen: Spielstände, Scores, Daumen, Anfragen, Meldungen, Notizen, Simulation
    c.get("/api/me", headers=seb); c.get("/api/me", headers=paul)
    c.put("/api/save/seb/zaehler/stand", json={"data": {"level": 3}}, headers=paul)
    c.put("/api/save/seb/zaehler/stand", json={"data": {"level": 4}}, headers=paul)
    c.post("/api/score/seb/zaehler", json={"score": 10}, headers=paul)
    c.post("/api/score/seb/zaehler", json={"score": 12}, headers=seb)
    c.put("/api/daumen/seb/zaehler", json={"an": True}, headers=paul)
    a = c.post("/api/antraege", json={"art": "fehler", "spiel": "seb/zaehler", "text": "Geht nicht richtig"}, headers=paul).json()
    c.patch(f"/api/antraege/{a.get('id', 1)}", json={"status": "erledigt", "antwort": "behoben"}, headers=seb)
    c.post("/api/admin/personen/paul/notizen", json={"text": "Notiz"}, headers=seb)
    c.post("/api/admin/personen/paul/verwarnen", json={"grund": "Test der Glocke"}, headers=seb)
    c.post("/api/admin/personen/paul/verwarnung-aufheben", headers=seb)
    c.put("/api/save/seb/zaehler/stand", json={"data": 1}, headers={**seb, "X-Ansicht": "spieler"})

    werte = {"user": "seb", "game": "zaehler", "name": "paul", "key": "stand", "rolle": "spieler", "email": "paul@example.com"}
    gefunden, geprueft = [], 0
    for route in app.routes:
        pfad = getattr(route, "path", "")
        if "GET" not in getattr(route, "methods", set()) or not pfad.startswith("/api/"):
            continue
        teile = _re.findall(r"{(\w+)}", pfad)
        url = pfad
        for t in teile:
            url = url.replace("{" + t + "}", werte.get(t, "1"))
        for wer, h in (("paul", paul), ("seb", seb)):
            r = c.get(url, headers=h)
            geprueft += 1
            if identitaet.UUID_IN_TEXT.search(r.text):
                gefunden.append(f"{wer} {url} → {r.status_code}: {identitaet.UUID_IN_TEXT.search(r.text).group(0)}")
    assert geprueft > 60
    assert not gefunden, "UUID nach außen:\n" + "\n".join(gefunden)
    # … und die Namen stimmen: Handles statt UUIDs
    assert c.get("/api/me", headers=paul).json()["player"] == "paul"
    assert [x["player"] for x in c.get("/api/leaderboard/seb/zaehler", headers=paul).json()["entries"]] == ["seb", "paul"]
    assert c.get("/api/profil/paul", headers=seb).json()["name"] == "paul"


def test_home_assistant_bekommt_handles(umgebung, rsa_schluessel, token, monkeypatch):
    """Nachrichten an Home Assistant laufen nicht durch die Antwort-Schicht – auch dort Handle statt UUID."""
    from fastapi.testclient import TestClient
    from savesvc import waechter
    from savesvc.app import erstellen
    from savesvc.config import Einstellungen
    from .conftest import AUD, TEAM, Schluessel
    gesendet = []
    monkeypatch.setattr(waechter, "ha_senden", lambda e, art, text="", **k: gesendet.append(text))
    e = Einstellungen(team_domain=TEAM, audience=AUD, users_file=umgebung.users, spiele_dir=umgebung.spiele,
                      db_path=umgebung.db, dev_user=None, identitaet_uuid=True)
    c = TestClient(erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key())))
    paul = {"Cf-Access-Jwt-Assertion": token(email="paul@example.com"), "X-Bibliothek": "1"}
    assert c.post("/api/antraege", json={"art": "wunsch", "text": "Dunkles Design bitte"}, headers=paul).status_code == 201
    assert gesendet and "von paul" in gesendet[-1] and not identitaet.UUID_IN_TEXT.search(" ".join(gesendet))


def test_dev_user_im_teststand_wird_uuid(umgebung):
    """Teststand (DEV_USER=seb): nach der Umstellung ist man als die Person seb angemeldet, nicht als Name „seb“."""
    from fastapi.testclient import TestClient
    from savesvc.app import erstellen
    c = TestClient(erstellen(_einstellungen(umgebung, identitaet_uuid=True).__class__(
        **{**_einstellungen(umgebung, identitaet_uuid=True).__dict__, "dev_user": "seb"})))
    me = c.get("/api/me").json()
    assert me["player"] == "seb" and me["admin"] is True
    c.put("/api/save/seb/zaehler/stand", json={"data": 5}, headers={"X-Bibliothek": "1"})
    reg = identitaet.Register(umgebung.db)
    v = sqlite3.connect(umgebung.db)
    assert v.execute("SELECT player FROM saves").fetchone()[0] == reg.id_von("seb")


def test_zwischenspeicher_liest_neue_personen_sofort(umgebung):
    """Der kurze Zwischenspeicher des Registers darf nie dazu führen, dass eine UUID nach außen geht oder eine neue
    Person unbekannt ist – fehlt etwas, wird sofort frisch gelesen."""
    from savesvc import crm as crm_modul
    from savesvc.app import erstellen
    erstellen(_einstellungen(umgebung, identitaet_uuid=True))
    reg = identitaet.REGISTER
    reg.karten()                                        # Zwischenspeicher gefüllt
    c = crm_modul.Crm(Datenbank(umgebung.db))
    p = c.anlegen("seb", "neu_da", "neu@example.com", ["spieler"])
    reg._karten = (reg._karten[0] if reg._karten else 0, {"handle": {}, "ordner": {}, "id": {}, "nr": {}})   # absichtlich veraltet
    assert reg.nach_aussen({"x": p["name"]}) == {"x": "neu_da"}
    assert reg.id_von("neu_da") == p["name"] and reg.ordner(p["name"]) == "neu_da"
