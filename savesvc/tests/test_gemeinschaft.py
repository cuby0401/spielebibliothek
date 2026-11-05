"""Zentrale 1.2.0: Spielzeit, Glocke, Erfolge, Profil, Spiel der Woche, Tags, Speicher."""
import json

import sqlite3

import pytest

from .test_verwaltung import iclient, upload  # noqa: F401 (Fixtures)

SEB, PAUL = "seb@example.com", "paul@example.com"


@pytest.fixture
def ohne_takt(monkeypatch):
    import savesvc.app as appmod
    monkeypatch.setattr(appmod, "SCORE_ABSTAND", 0.0)


def spielzeit(client, h, sek, spiel="seb/zaehler", neu=False):
    return client.post(f"/api/spielzeit/{spiel}", json={"sekunden": sek, "neu": neu}, headers=h)


def test_spielzeit(client):
    p = client.als(PAUL)
    assert spielzeit(client, p, 60, neu=True).status_code == 204
    assert spielzeit(client, p, 45).status_code == 204
    assert spielzeit(client, p, 121).status_code == 422
    spielzeit(client, p, 30)
    assert spielzeit(client, p, 30).status_code == 429          # höchstens 3 Meldungen je Minute
    s = {x["id"]: x for x in client.get("/api/games", headers=p).json()}["seb/zaehler"]
    assert s["spielzeit"] == 135 and s["meineSpielzeit"] == 135
    # Simulation zählt nicht in der Gesamtzeit
    spielzeit(client, {**client.als(), "X-Ansicht": "spieler"}, 100)
    assert {x["id"]: x for x in client.get("/api/games", headers=p).json()}["seb/zaehler"]["spielzeit"] == 135
    assert client.put("/api/einstellungen", json={"sortierung": "meistgespielt"}, headers=p).status_code == 200


def test_glocke_ueberholt_und_antrag(client, ohne_takt):
    s, p = client.als(), client.als(PAUL)
    client.post("/api/score/seb/zaehler", json={"score": 10}, headers=p)
    client.post("/api/score/seb/zaehler", json={"score": 20}, headers=s)          # seb überholt paul
    m = client.get("/api/meldungen", headers=p).json()
    assert m["ungelesen"] == 1 and "seb hat dich" in m["liste"][0]["text"]
    assert client.post("/api/meldungen/gelesen", headers=p).status_code == 204
    assert client.get("/api/meldungen", headers=p).json()["ungelesen"] == 0
    client.post("/api/score/seb/zaehler", json={"score": 15}, headers=p)          # verbessert, aber nicht vorbei
    assert client.get("/api/meldungen", headers=s).json()["ungelesen"] == 0
    # Antrag beantwortet → Meldung an den Antragsteller
    aid = client.post("/api/antraege", json={"art": "fehler", "text": "Geht nicht"}, headers=p).json()["id"]
    client.patch(f"/api/admin/antraege/{aid}", json={"status": "erledigt", "antwort": "Behoben"}, headers=s)
    assert "Behoben" in client.get("/api/meldungen", headers=p).json()["liste"][0]["text"]


def test_erfolge_und_profil(client, umgebung):
    spiel = umgebung.spiele / "seb" / "zaehler"
    meta = json.loads((spiel / "game.json").read_text())
    meta["erfolge"] = [{"id": "erster", "titel": "Erster Klick", "beschreibung": "Einmal geklickt"},
                       {"id": "geheim", "titel": "Versteckt", "geheim": True}, {"id": "UNGÜLTIG"}]
    meta["tags"] = ["Klicker", "klicker", "Test"]
    (spiel / "game.json").write_text(json.dumps(meta))
    p = client.als(PAUL)
    assert client.post("/api/erfolg/seb/zaehler", json={"id": "erster"}, headers=p).json()["neu"] is True
    assert client.post("/api/erfolg/seb/zaehler", json={"id": "erster"}, headers=p).json()["neu"] is False
    assert client.post("/api/erfolg/seb/zaehler", json={"id": "gibtsnicht"}, headers=p).status_code == 422
    liste = client.get("/api/erfolge/seb/zaehler", headers=p).json()
    assert [e["id"] for e in liste] == ["erster", "geheim"] and liste[0]["freigeschaltet"] and liste[1]["titel"] == "???"
    assert "Erster Klick" in client.get("/api/meldungen", headers=p).json()["liste"][0]["text"]
    g = {x["id"]: x for x in client.get("/api/games", headers=p).json()}["seb/zaehler"]
    assert g["tags"] == ["Klicker", "Test"] and g["erfolgeAnzahl"] == 2
    spielzeit(client, p, 60)
    pr = client.get("/api/profil/paul", headers=client.als()).json()
    assert pr["erfolge"] == 1 and pr["sekunden"] == 60 and pr["spiele"][0]["erfolgeGesamt"] == 2 and pr["ich"] is False
    assert client.get("/api/profil/niemand", headers=p).status_code == 404


def test_spiel_der_woche(client, ohne_takt, umgebung):
    s, p = client.als(), client.als(PAUL)
    client.post("/api/score/seb/zaehler", json={"score": 99}, headers=p)          # vor der Woche
    with sqlite3.connect(umgebung.db) as v:
        v.execute("UPDATE scores SET created_at='2026-01-01T00:00:00+00:00'")
    assert client.put("/api/admin/spiel-der-woche/paul/snake", headers=s).status_code == 409   # ohne Bestenliste
    assert client.put("/api/admin/spiel-der-woche/seb/zaehler", headers=p).status_code == 403
    d = client.put("/api/admin/spiel-der-woche/seb/zaehler", headers=s).json()
    assert d["id"] == "seb/zaehler" and d["bestenliste"] == []
    client.post("/api/score/seb/zaehler", json={"score": 5}, headers=p)
    w = client.get("/api/leaderboard/seb/zaehler?woche=true", headers=p).json()
    assert [e["score"] for e in w["entries"]] == [5]                              # nur Einträge dieser Woche
    assert {x["id"]: x for x in client.get("/api/games", headers=p).json()}["seb/zaehler"]["spielDerWoche"] is True
    assert "Spiel der Woche" in client.get("/api/meldungen", headers=p).json()["liste"][-1]["text"]
    assert client.delete("/api/admin/spiel-der-woche", headers=s).status_code == 204
    assert client.get("/api/spiel-der-woche", headers=p).json() is None


def test_simulation_leert_auch_neue_tabellen(client):
    sim = {**client.als(), "X-Ansicht": "spieler"}
    spielzeit(client, sim, 50)
    client.post("/api/admin/ansicht/spieler/zuruecksetzen", headers=client.als())
    assert {x["id"]: x for x in client.get("/api/games", headers=sim).json()}["seb/zaehler"]["meineSpielzeit"] == 0


def test_admin_platte(client, upload):
    d = client.get("/api/admin/uebersicht", headers=client.als()).json()
    assert d["platte"]["gesamt"] > 0 and d["kontingent"] == 1024 * 1024 * 1024


# ---------- Glocke: Favoriten, Fehler, Anträge (wichtig) ----------

def test_updates_nur_an_favoriten(iclient):
    c = iclient
    c.put("/api/einstellungen", json={"favoriten": ["seb/zaehler"]}, headers=c.als(PAUL))
    T = {"X-Intern-Token": "geheim"}
    assert c.post("/intern/meldung", json={"an": "favoriten:seb/zaehler", "text": "Zähler 1.1.0"}, headers=T).status_code == 204
    assert c.get("/api/meldungen", headers=c.als(PAUL)).json()["liste"][0]["text"] == "Zähler 1.1.0"
    assert c.get("/api/meldungen", headers=c.als()).json()["liste"] == []          # seb hat es nicht als Favorit


def test_neuer_fehler_meldet_sich_beim_entwickler(client):
    p = client.als(PAUL)
    melde = lambda m: client.post("/api/fehler/paul/snake", json={"meldung": m, "quelle": "a.js", "zeile": 3}, headers=client.als())
    melde("TypeError: x"); melde("TypeError: x"); melde("ReferenceError: y")
    m = client.get("/api/meldungen", headers=p).json()
    assert m["wichtigUngelesen"] == 1 and "TypeError" in m["liste"][0]["text"]     # nur eine je Spiel und Stunde
    assert m["liste"][0]["wichtig"] is True


def test_antrag_meldet_sich_bei_admin_und_entwickler(client):
    client.post("/api/antraege", json={"art": "fehler", "spiel": "paul/snake", "text": "Stürzt ab"}, headers=client.als("seb@example.com"))
    # seb ist Admin → Meldung an seb; paul ist Besitzer → Meldung an paul
    assert "Neuer Antrag" in client.get("/api/meldungen", headers=client.als()).json()["liste"][0]["text"]
    pm = client.get("/api/meldungen", headers=client.als(PAUL)).json()
    assert pm["wichtigUngelesen"] == 1 and "meldet einen Fehler" in pm["liste"][0]["text"]


def test_waechter_meldet_probleme(monkeypatch, umgebung):
    from types import SimpleNamespace
    from savesvc import waechter
    gesendet = []
    monkeypatch.setattr(waechter.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("weg")))
    monkeypatch.setattr(waechter.urllib.request, "build_opener", lambda *a: SimpleNamespace(open=lambda *a, **k: SimpleNamespace(status=302)))
    e = SimpleNamespace(spiele_dir=umgebung.spiele, backup_ziel=None, ha_webhook="")
    db = SimpleNamespace(zaehlen=lambda: {})
    def upload(*a):
        raise RuntimeError("Upload weg")
    probleme = waechter.pruefen(e, db, upload)
    assert any("Upload-Dienst" in p for p in probleme) and any("Caddy" in p for p in probleme)
    assert not any("außen" in p for p in probleme)                                 # 302 von Cloudflare Access = erreichbar
    waechter.ha_senden(e, "test")                                                     # ohne URL: tut nichts, kein Fehler


# ---------- Anmeldungen (E55) und Probe-Zentrale (E56) ----------

def test_anmeldungen(client):
    h = {**client.als(PAUL), "User-Agent": "Mozilla/5.0 (iPad; CPU OS 18) Safari/605.1", "Cf-Connecting-Ip": "203.0.113.7",
         "Cf-Ipcountry": "DE", "Cf-Ipcity": "Berlin"}
    client.get("/api/me", headers=h)
    client.get("/api/me", headers=h)                                   # gleiche Sitzung, gleiches Gerät → ein Eintrag
    client.get("/api/me", headers={**client.als(PAUL), "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130"})
    liste = client.get("/api/meine/anmeldungen", headers=h).json()
    assert len(liste) == 2
    ipad = next(a for a in liste if a["geraet"] == "Safari (iPad)")
    assert ipad["ip"] == "203.0.113.7" and ipad["ort"] == "Berlin, DE" and ipad["aktuell"] is True
    assert {a["player"] for a in client.get("/api/admin/anmeldungen", headers=client.als()).json()} >= {"paul"}
    assert client.get("/api/admin/anmeldungen", headers=client.als(PAUL)).status_code == 403


def test_probe_freigabe(umgebung, rsa_schluessel, token):
    from fastapi.testclient import TestClient
    from savesvc.app import erstellen
    from savesvc.config import Einstellungen
    from .conftest import AUD, TEAM, Schluessel
    def app(probe):
        e = Einstellungen(team_domain=TEAM, audience=AUD, users_file=umgebung.users, spiele_dir=umgebung.spiele,
                          db_path=umgebung.db, dev_user=None, probe=probe, zentrale_commit="abc1234", zentrale_version="1.2.0")
        return TestClient(erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key())))
    h = {"Cf-Access-Jwt-Assertion": token(), "X-Bibliothek": "1"}
    live = app(False)
    assert live.post("/api/admin/probe/freigeben", headers=h).status_code == 409   # nur in der Probe
    probe = app(True)
    assert probe.get("/api/me", headers=h).json()["probe"] is True
    d = probe.post("/api/admin/probe/freigeben", json={"notiz": "alles getestet"}, headers=h).json()
    assert d["commit"] == "abc1234" and d["notiz"] == "alles getestet"
    assert json.loads((umgebung.db.parent / "freigabe.json").read_text())["commit"] == "abc1234"
    assert probe.get("/api/admin/probe", headers=h).json()["freigabe"]["version"] == "1.2.0"
    assert probe.delete("/api/admin/probe/freigeben", headers=h).status_code == 204
    assert not (umgebung.db.parent / "freigabe.json").exists()


# ---------- Zentrale 1.3.0: Meldungen ablegen, Verbindungen trennen, Profil ohne Testspiele ----------

def test_meldungen_archivieren_und_loeschen(iclient):
    c, T = iclient, {"X-Intern-Token": "geheim"}
    for t in ("eins", "zwei", "drei"):
        c.post("/intern/meldung", json={"an": "*", "text": "🎮 " + t}, headers=T)
    p = c.als(PAUL)
    liste = c.get("/api/meldungen", headers=p).json()["liste"]
    assert [m["text"] for m in liste] == ["drei", "zwei", "eins"]                  # Emoji am Anfang entfernt
    assert c.post(f"/api/meldungen/{liste[0]['id']}/archivieren", headers=p).status_code == 204
    assert c.delete(f"/api/meldungen/{liste[1]['id']}", headers=p).status_code == 204
    assert [m["text"] for m in c.get("/api/meldungen", headers=p).json()["liste"]] == ["eins"]
    assert [m["text"] for m in c.get("/api/meldungen?archiv=true", headers=p).json()["liste"]] == ["drei"]
    assert len(c.get("/api/meldungen", headers=c.als()).json()["liste"]) == 3      # andere Spieler unberührt
    c.post(f"/api/meldungen/{liste[0]['id']}/zurueck", headers=p)
    assert c.post("/api/meldungen/alle-archivieren", headers=p).json()["archiviert"] >= 2
    m = c.get("/api/meldungen", headers=p).json()
    assert m["liste"] == [] and m["ungelesen"] == 0
    assert c.delete("/api/meldungen/99999", headers=p).status_code == 404


def test_verbindung_trennen(client, token):
    import time as t
    alt = {"Cf-Access-Jwt-Assertion": token(email=PAUL), "X-Bibliothek": "1", "User-Agent": "Mozilla/5.0 (iPad) Safari/605"}
    client.get("/api/me", headers=alt)
    t.sleep(1.1)                                                                   # neue Anmeldung = anderes iat
    neu = {"Cf-Access-Jwt-Assertion": token(email=PAUL), "X-Bibliothek": "1", "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/130"}
    client.get("/api/me", headers=neu)                                           # die Seite ruft /api/me immer zuerst auf
    liste = client.get("/api/meine/anmeldungen", headers=neu).json()
    ipad = next(a for a in liste if "iPad" in a["geraet"])
    jetzt = next(a for a in liste if a["aktuell"])
    assert client.post("/api/meine/anmeldungen/trennen", json={"sitzung": jetzt["sitzung"]}, headers=neu).status_code == 409
    assert client.post("/api/meine/anmeldungen/trennen", json={"sitzung": ipad["sitzung"]}, headers=neu).status_code == 204
    r = client.get("/api/me", headers=alt)
    assert r.status_code == 401 and r.json()["detail"] == "Sitzung getrennt"
    assert client.get("/api/me", headers=neu).status_code == 200
    assert next(a for a in client.get("/api/meine/anmeldungen", headers=neu).json() if "iPad" in a["geraet"])["getrennt"] is True
    # Admin kann trennen, andere nicht
    assert client.post("/api/admin/anmeldungen/trennen", json={"player": "paul", "sitzung": jetzt["sitzung"]}, headers=neu).status_code == 403
    assert client.post("/api/admin/anmeldungen/trennen", json={"player": "paul", "sitzung": jetzt["sitzung"]}, headers=client.als()).status_code == 204
    assert client.get("/api/me", headers=neu).status_code == 401


def test_profil_ohne_testspiele(client):
    p = client.als(PAUL)
    client.post("/api/spielzeit/seb/zaehler", json={"sekunden": 60}, headers=p)
    client.patch("/api/admin/spiele/seb/zaehler", json={"testspiel": True}, headers=client.als())
    assert client.get("/api/profil/paul", headers=client.als()).json()["spiele"] == []   # auch für Admins nicht
