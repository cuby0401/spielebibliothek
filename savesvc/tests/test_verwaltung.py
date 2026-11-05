import json

import pytest

from savesvc import verwaltung

SEB, PAUL = "seb@example.com", "paul@example.com"


class FalscherUpload:
    """Ersatz für den Upload-Dienst."""
    def __init__(self):
        self.aufrufe = []
        self.konten = {"seb"}

    def __call__(self, methode, pfad, body=None):
        self.aufrufe.append((methode, pfad, body))
        if pfad == "/intern/entwickler" and methode == "GET":
            return [{"player": p, "angelegt": "2026-11-05"} for p in sorted(self.konten)]
        if pfad == "/intern/entwickler" and methode == "POST":
            self.konten.add(body["name"]); return {"name": body["name"], "passwort": "X" * 20}
        if pfad.endswith("/passwort"):
            return {"name": pfad.split("/")[3], "passwort": "Y" * 20}
        if pfad == "/intern/ereignisse":
            return [{"zeit": "2026-11-05T10:00:00+00:00", "player": "paul", "aktion": "hochgeladen", "ordner": "snake", "dateien": 3}]
        return None


@pytest.fixture
def upload(monkeypatch):
    f = FalscherUpload()
    monkeypatch.setattr(verwaltung.UploadDienst, "__call__", lambda self, *a, **k: f(*a, **k))
    return f


def test_csrf_header_pflicht(client):
    ohne = {"Cf-Access-Jwt-Assertion": client.als()["Cf-Access-Jwt-Assertion"]}
    assert client.put("/api/save/seb/zaehler/x", json={"data": 1}, headers=ohne).status_code == 403
    assert client.get("/api/me", headers=ohne).status_code == 200      # lesen geht ohne


def test_me_admin(client):
    assert client.get("/api/me", headers=client.als()).json()["admin"] is True
    assert client.get("/api/me", headers=client.als(PAUL)).json()["admin"] is False


def test_einstellungen(client):
    assert client.get("/api/einstellungen", headers=client.als()).json()["sortierung"] == "alphabetisch"
    r = client.put("/api/einstellungen", json={"sortierung": "zuletzt", "favoriten": ["seb/zaehler"], "grossansicht": True}, headers=client.als())
    assert r.json() == {"sortierung": "zuletzt", "favoriten": ["seb/zaehler"], "grossansicht": True, "bestenliste": True}
    assert client.put("/api/einstellungen", json={"sortierung": "zufall"}, headers=client.als()).status_code == 422
    assert client.get("/api/einstellungen", headers=client.als(PAUL)).json()["favoriten"] == []   # je Spieler getrennt


def test_meine_spielstaende_zuruecksetzen(client):
    h = client.als()
    client.put("/api/save/seb/zaehler/a", json={"data": 1}, headers=h)
    client.put("/api/save/seb/zaehler/b", json={"data": 2}, headers=h)
    liste = client.get("/api/meine/spielstaende", headers=h).json()
    assert liste[0]["spiel"] == "seb/zaehler" and liste[0]["title"] == "Zähler" and {k["key"] for k in liste[0]["keys"]} == {"a", "b"}
    assert client.delete("/api/meine/spielstaende/seb/zaehler", headers=h).json() == {"geloescht": 2}
    assert client.get("/api/meine/spielstaende", headers=h).json() == []


def test_versteckte_spiele_nur_fuer_admin(client, upload):
    assert client.patch("/api/admin/spiele/paul/snake", json={"versteckt": True}, headers=client.als()).status_code == 200
    ids_paul = {s["id"] for s in client.get("/api/games", headers=client.als(PAUL)).json()}
    ids_seb = {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}
    assert "paul/snake" not in ids_paul and ids_seb["paul/snake"]["versteckt"] is True


def test_admin_nur_fuer_admins(client, upload):
    for pfad in ["/api/admin/uebersicht", "/api/admin/spiele", "/api/admin/benutzer", "/api/admin/antraege", "/api/admin/spielstaende"]:
        assert client.get(pfad, headers=client.als(PAUL)).status_code == 403
        assert client.get(pfad, headers=client.als()).status_code == 200, pfad


def test_entwickler_season(client, umgebung):
    # paul hat einen Spielordner → Entwickler; neue Season nur für eigene Spiele
    assert client.post("/api/entwickler/season/seb/zaehler", headers=client.als(PAUL)).status_code == 403
    assert client.post("/api/entwickler/season/paul/snake", headers=client.als(PAUL)).json() == {"season": 2}
    spiele = {s["ordner"] if "ordner" in s else s["id"]: s for s in client.get("/api/entwickler/spiele", headers=client.als(PAUL)).json()}
    assert spiele["paul/snake"]["leaderboardSeason"] == 2
    assert {s["id"] for s in client.get("/api/entwickler/spiele", headers=client.als(PAUL)).json()} == {"paul/snake", "paul/kaputt", "paul/ohne-index"}


def test_antraege(client, umgebung):
    (umgebung.users).write_text("seb@example.com: seb\npaul@example.com: paul\nmia@example.com: mia\n")
    assert client.post("/api/antraege", json={"art": "wunsch", "text": "Bitte Gamepad"}, headers=client.als("mia@example.com")).status_code == 403  # nur Entwickler
    r = client.post("/api/antraege", json={"art": "wunsch", "spiel": "paul/snake", "text": "Bitte Gamepad-Unterstützung"}, headers=client.als(PAUL))
    assert r.status_code == 201
    aid = r.json()["id"]
    assert client.post("/api/antraege", json={"art": "quatsch", "text": "xxx"}, headers=client.als(PAUL)).status_code == 422
    alle = client.get("/api/admin/antraege", headers=client.als()).json()
    assert alle[0]["status"] == "offen" and alle[0]["artText"] == "Feature-Wunsch"
    assert client.patch(f"/api/admin/antraege/{aid}", json={"status": "erledigt", "antwort": "Ist drin!"}, headers=client.als()).status_code == 200
    mein = client.get("/api/antraege", headers=client.als(PAUL)).json()
    assert mein[0]["status"] == "erledigt" and mein[0]["antwort"] == "Ist drin!"


def test_benutzer_anlegen_und_entfernen(client, umgebung, upload):
    r = client.post("/api/admin/benutzer", json={"email": "Emil@Example.com", "name": "emil", "entwickler": True}, headers=client.als())
    assert r.status_code == 201 and r.json()["passwort"] == "X" * 20
    inhalt = umgebung.users.read_text()
    assert "emil@example.com: emil" in inhalt and "seb@example.com: seb" in inhalt
    assert client.get("/api/me", headers=client.als("emil@example.com")).json()["player"] == "emil"   # wirkt sofort
    assert client.post("/api/admin/benutzer", json={"email": "x@y.de", "name": "emil"}, headers=client.als()).status_code == 409
    assert client.post("/api/admin/benutzer", json={"email": "kaputt", "name": "neu"}, headers=client.als()).status_code == 422
    liste = {b["name"]: b for b in client.get("/api/admin/benutzer", headers=client.als()).json()}
    assert liste["emil"]["uploadKonto"] is True and liste["seb"]["admin"] is True
    assert client.delete("/api/admin/benutzer/seb", headers=client.als()).status_code == 409      # Admin nicht löschbar
    assert client.delete("/api/admin/benutzer/emil", headers=client.als()).status_code == 200
    assert client.get("/api/me", headers=client.als("emil@example.com")).status_code == 403
    assert ("DELETE", "/intern/entwickler/emil", None) in upload.aufrufe


def test_admin_spielstand_verlauf_wiederherstellen(client):
    h = client.als(PAUL)
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 1}}, headers=h)
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 99}}, headers=h)
    liste = client.get("/api/admin/spielstaende?player=paul", headers=client.als()).json()
    assert liste[0]["key"] == "stand" and liste[0]["title"] == "Zähler"
    d = client.get("/api/admin/spielstand?player=paul&game=seb/zaehler&key=stand", headers=client.als()).json()
    assert d["aktuell"]["data"] == {"zahl": 99} and d["verlauf"][0]["data"] == {"zahl": 1}
    client.post("/api/admin/spielstand/wiederherstellen", json={"id": d["verlauf"][0]["id"]}, headers=client.als())
    assert client.get("/api/save/seb/zaehler/stand", headers=h).json()["data"] == {"zahl": 1}


def test_admin_scores_und_spiel_loeschen(client, upload, monkeypatch):
    import savesvc.app as appmod
    monkeypatch.setattr(appmod, "SCORE_ABSTAND", 0.0)
    client.post("/api/score/seb/zaehler", json={"score": 5}, headers=client.als(PAUL))
    scores = client.get("/api/admin/scores/seb/zaehler", headers=client.als()).json()
    assert scores[0]["player"] == "paul"
    assert client.delete(f"/api/admin/scores/{scores[0]['id']}", headers=client.als()).status_code == 204
    assert client.get("/api/leaderboard/seb/zaehler", headers=client.als()).json()["entries"] == []
    assert client.delete("/api/admin/spiele/paul/snake", headers=client.als()).status_code == 204
    assert ("DELETE", "/intern/spiele/paul/snake", None) in upload.aufrufe


def test_uebersicht(client, upload):
    d = client.get("/api/admin/uebersicht", headers=client.als()).json()
    assert d["spiele"] == 4 and d["spieler"] == 2 and d["uploads"][0]["aktion"] == "hochgeladen"
