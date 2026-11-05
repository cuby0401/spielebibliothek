import json

import pytest

import savesvc.app as appmod

LB = "/api/leaderboard/seb/zaehler"
SC = "/api/score/seb/zaehler"
SEB, PAUL = "seb@example.com", "paul@example.com"


@pytest.fixture
def ohne_ratelimit(monkeypatch):
    monkeypatch.setattr(appmod, "SCORE_ABSTAND", 0.0)


def einreichen(client, wert, email=SEB, pfad=SC):
    return client.post(pfad, json={"score": wert}, headers=client.als(email))


def test_bester_score_je_spieler_absteigend(client, ohne_ratelimit):
    for email, wert in [(SEB, 10), (SEB, 50), (SEB, 30), (PAUL, 40), (PAUL, 70)]:
        assert einreichen(client, wert, email).status_code == 201
    d = client.get(LB, headers=client.als()).json()
    assert [(e["rank"], e["player"], e["score"]) for e in d["entries"]] == [(1, "paul", 70), (2, "seb", 50)]
    assert d["order"] == "desc" and d["season"] == 1 and d["currentSeason"] == 1


def test_aufsteigend_und_gleichstand(client, umgebung, ohne_ratelimit):
    ordner = umgebung.spiele / "paul" / "rennen"
    ordner.mkdir()
    (ordner / "game.json").write_text(json.dumps({"leaderboard": {"enabled": True, "order": "asc", "label": "Sekunden"}}))
    pfad = "/api/score/paul/rennen"
    einreichen(client, 12.5, SEB, pfad)
    einreichen(client, 9.1, PAUL, pfad)
    einreichen(client, 9.1, SEB, pfad)      # gleich schnell, aber später
    einreichen(client, 20, PAUL, pfad)    # schlechter, zählt nicht
    d = client.get("/api/leaderboard/paul/rennen", headers=client.als()).json()
    assert [(e["player"], e["score"]) for e in d["entries"]] == [("paul", 9.1), ("seb", 9.1)]
    assert d["label"] == "Sekunden"


def test_neue_season_leer_alte_abrufbar(client, umgebung, ohne_ratelimit):
    einreichen(client, 100)
    meta = umgebung.spiele / "seb" / "zaehler" / "game.json"
    daten = json.loads(meta.read_text())
    daten["leaderboardSeason"] = 2
    meta.write_text(json.dumps(daten))
    d = client.get(LB, headers=client.als()).json()
    assert d["season"] == 2 and d["entries"] == [] and d["seasons"] == [1, 2]
    alt = client.get(LB + "?season=1", headers=client.als()).json()
    assert [e["score"] for e in alt["entries"]] == [100]
    assert einreichen(client, 5).json() == {"season": 2}


def test_rate_limit(client):
    assert einreichen(client, 1).status_code == 201
    assert einreichen(client, 2).status_code == 429
    # anderer Spieler ist davon unabhängig
    assert einreichen(client, 3, PAUL).status_code == 201


@pytest.mark.parametrize("wert", ["10", None, True, float("inf"), 1e16])
def test_ungueltiger_score_422(client, ohne_ratelimit, wert):
    body = json.dumps({"score": wert}, allow_nan=True)
    r = client.post(SC, content=body, headers={**client.als(), "Content-Type": "application/json"})
    assert r.status_code == 422


def test_spiel_ohne_bestenliste_409(client):
    r = client.post("/api/score/paul/snake", json={"score": 1}, headers=client.als())
    assert r.status_code == 409
    assert client.get("/api/leaderboard/paul/snake", headers=client.als()).json()["entries"] == []


def test_ohne_login_401(client):
    assert client.post(SC, json={"score": 1}).status_code == 401
    assert client.get(LB).status_code == 401


def test_games_liste_mit_season(client):
    spiele = {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}
    assert spiele["seb/zaehler"]["leaderboard"]["enabled"] is True
    assert spiele["seb/zaehler"]["leaderboardSeason"] == 1


def test_cli_reset(client, umgebung, monkeypatch, capsys, ohne_ratelimit):
    einreichen(client, 1)
    einreichen(client, 2, PAUL)
    monkeypatch.setenv("DB_PATH", str(umgebung.db))
    from savesvc.__main__ import main
    assert main(["reset-leaderboard", "seb/zaehler", "--season", "1"]) == 0
    assert "2 Scores gelöscht" in capsys.readouterr().out
    assert client.get(LB, headers=client.als()).json()["entries"] == []
