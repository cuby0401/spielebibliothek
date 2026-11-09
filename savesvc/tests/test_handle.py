"""Zentrale 1.5.0 (E82): Handle ändern – alle 30 Tage, frühere bleiben reserviert, nichts anderes ändert sich."""
from datetime import datetime, timedelta, timezone

import os

import pytest

from savesvc.db import Datenbank

from .test_verwaltung import upload  # noqa: F401 (Fixture)

pytestmark = pytest.mark.skipif(os.environ.get("TEST_IDENTITAET_UUID") == "0", reason="setzt UUIDs voraus (1.5.0)")

PAUL = "paul@example.com"


def _alt_machen(umgebung, pid, tage):
    with Datenbank(umgebung.db).verbindung() as v:
        v.execute("UPDATE personen SET handle_seit=? WHERE name=?", ((datetime.now(timezone.utc) - timedelta(days=tage)).isoformat(), pid))


def test_handle_aendern_und_frist(client, umgebung, pid):
    p = client.als(PAUL)
    client.put("/api/save/seb/zaehler/stand", json={"data": {"level": 9}}, headers=p)
    client.post("/api/score/seb/zaehler", json={"score": 77}, headers=p)
    k = client.get("/api/mein/konto", headers=p).json()
    assert k["handle"] == "paul" and k["handleAb"] is None                    # noch nie geändert → sofort
    # Regeln
    for falsch, code in (("ph", 422), ("Phil ipp", 422), ("-phil", 422), ("x" * 21, 422), ("admin", 409), ("seb", 409), ("paul", 409)):
        assert client.put("/api/mein/handle", json={"handle": falsch}, headers=p).status_code == code, falsch
    r = client.put("/api/mein/handle", json={"handle": "@Phil_Dev"}, headers=p)
    assert r.status_code == 200 and r.json()["handle"] == "phil_dev" and r.json()["handleAb"]
    # Überall das neue Handle, Spielstände und Bestenliste unverändert, Spieleordner bleibt
    assert client.get("/api/me", headers=p).json()["player"] == "phil_dev"
    assert client.get("/api/me", headers=p).json()["konto"] == "paul"
    assert client.get("/api/save/seb/zaehler/stand", headers=p).json()["data"] == {"level": 9}
    assert [e["player"] for e in client.get("/api/leaderboard/seb/zaehler", headers=p).json()["entries"]] == ["phil_dev"]
    assert {s["author"] for s in client.get("/api/games", headers=p).json() if s["id"].startswith("paul/")} == {"phil_dev"}
    assert "paul/snake" in {s["id"] for s in client.get("/api/entwickler/spiele", headers=p).json()}
    # Alte Profil-Adresse leitet weiter
    assert client.get("/api/profil/paul", headers=client.als()).json()["name"] == "phil_dev"
    # Frist: erst nach 30 Tagen wieder
    r = client.put("/api/mein/handle", json={"handle": "phil2"}, headers=p)
    assert r.status_code == 409 and "30 Tage" in r.json()["detail"]
    _alt_machen(umgebung, pid("phil_dev"), 31)
    assert client.put("/api/mein/handle", json={"handle": "phil2"}, headers=p).json()["handle"] == "phil2"
    # Frühere Handles sind reserviert – für andere; die Person selbst darf zurück
    assert client.post("/api/admin/personen/seb/handle", json={"handle": "phil_dev"}, headers=client.als()).status_code == 409
    _alt_machen(umgebung, pid("phil2"), 31)
    assert client.put("/api/mein/handle", json={"handle": "paul"}, headers=p).json()["handle"] == "paul"
    # Zeitleiste und Protokoll
    person = client.get("/api/admin/personen/paul", headers=client.als()).json()
    assert any("@phil_dev → @phil2" in z["text"] for z in person["zeitleiste"])


def test_admin_ohne_frist_und_adminrechte_bleiben(client, umgebung):
    s = client.als()
    assert client.post("/api/admin/personen/seb/handle", json={"handle": "sebastian"}, headers=s).json()["handle"] == "sebastian"
    assert client.post("/api/admin/personen/sebastian/handle", json={"handle": "chef"}, headers=s).json()["handle"] == "chef"
    me = client.get("/api/me", headers=s).json()
    assert me["player"] == "chef" and me["admin"] is True                      # ADMINS=seb gilt weiter (über die UUID)
    assert client.get("/api/admin/personen/seb", headers=s).json()["handle"] == "chef"   # Ordnername findet die Person


def test_spieler_kann_fremdes_handle_nicht_aendern(client, upload):  # noqa: F811
    p = client.als(PAUL)
    assert client.post("/api/admin/personen/seb/handle", json={"handle": "boese"}, headers=p).status_code == 403
    assert client.put("/api/mein/handle", json={"handle": "neu_name", "player": "seb"}, headers=p).json()["handle"] == "neu_name"
    assert client.get("/api/me", headers=client.als()).json()["player"] == "seb"


def test_simulation_aendert_nichts(client):
    r = client.put("/api/mein/handle", json={"handle": "simuliert"}, headers={**client.als(), "X-Ansicht": "spieler"})
    assert r.status_code == 409


def test_personennummer_und_geloeschte_person(client, upload, pid):  # noqa: F811
    s = client.als()
    nr = client.get("/api/admin/personen/paul", headers=s).json()["nr"]
    assert client.get(f"/api/admin/personen/P-{nr:04d}", headers=s).json()["handle"] == "paul"
    assert client.get("/api/admin/personen/P-9999", headers=s).status_code == 404
    client.post("/api/score/seb/zaehler", json={"score": 5}, headers=client.als(PAUL))
    client.post("/api/admin/personen/paul/archivieren", headers=s)
    assert client.post("/api/admin/personen/paul/loeschen", json={"bestaetigung": "paul"}, headers=s).status_code == 200
    # überall „gelöschte Person“, die Karte bleibt über die Nummer erreichbar
    assert [e["player"] for e in client.get("/api/leaderboard/seb/zaehler", headers=s).json()["entries"]] == ["gelöschte Person"]
    assert client.get(f"/api/admin/personen/P-{nr:04d}", headers=s).json()["status"] == "geloescht"
    assert client.get("/api/profil/paul", headers=s).status_code == 404
