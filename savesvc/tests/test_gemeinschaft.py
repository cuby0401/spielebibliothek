"""Zentrale 1.2.0: Spielzeit, Glocke, Erfolge, Profil, Spiel der Woche, Tags, Speicher."""
import json

import sqlite3

import pytest

from .test_verwaltung import upload  # noqa: F401 (Fixture)

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
