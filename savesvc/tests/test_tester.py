"""Tester-Panel (Zentrale 1.4.0, E76)."""
import json

import pytest
from fastapi.testclient import TestClient

from savesvc.app import erstellen
from savesvc.config import Einstellungen

from .conftest import AUD, TEAM, Schluessel

PLAN = {"version": "1.4.0", "hinweis": "Bitte alles am Rechner testen.", "tests": [
    {"id": "konto-leiste", "bereich": "Konto", "titel": "Leiste", "schritte": ["Auf den Namen klicken"], "erwartet": "Profil öffnet sich"},
    {"id": "not-aus", "bereich": "Sicherheit", "titel": "Not-Aus", "schritte": ["…"], "erwartet": "503"},
    {"id": "Ungültig!", "titel": "wird übersprungen"},
]}


@pytest.fixture
def tclient(umgebung, rsa_schluessel, token, tmp_path, monkeypatch):
    plan = tmp_path / "testplan"
    plan.mkdir()
    (plan / "1.4.0.json").write_text(json.dumps(PLAN))
    monkeypatch.setenv("TESTPLAN_DIR", str(plan))
    monkeypatch.setenv("TESTERGEBNISSE", str(tmp_path / "tests" / "ergebnisse.db"))
    e = Einstellungen(team_domain=TEAM, audience=AUD, users_file=umgebung.users, spiele_dir=umgebung.spiele,
                      db_path=umgebung.db, dev_user=None, waechter=False, zentrale_version="1.4.0", zentrale_commit="abc1234")
    c = TestClient(erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key())))
    c.als = lambda email="seb@example.com", **kw: {"Cf-Access-Jwt-Assertion": token(email=email, **kw), "X-Bibliothek": "1"}
    return c


def test_plan_und_ergebnisse(tclient):
    p = tclient.als("paul@example.com")
    d = tclient.get("/api/tester/plan", headers=p).json()
    assert [t["id"] for t in d["tests"]] == ["konto-leiste", "not-aus"] and d["version"] == "1.4.0"
    assert d["zusammenfassung"] == {"gesamt": 2, "bestanden": 0, "fehlgeschlagen": 0, "offen": 2}
    assert tclient.post("/api/tester/ergebnis", json={"test": "konto-leiste", "ok": True}, headers=p).status_code == 204
    # Nein braucht eine Begründung, unbekannte Tests gibt es nicht
    assert tclient.post("/api/tester/ergebnis", json={"test": "not-aus", "ok": False, "text": ""}, headers=p).status_code == 422
    assert tclient.post("/api/tester/ergebnis", json={"test": "gibtsnicht", "ok": True}, headers=p).status_code == 404
    assert tclient.post("/api/tester/ergebnis", json={"test": "not-aus", "ok": False, "text": "Seite lädt weiter"},
                        headers=tclient.als()).status_code == 204
    d = tclient.get("/api/tester/plan", headers=p).json()
    assert d["zusammenfassung"] == {"gesamt": 2, "bestanden": 1, "fehlgeschlagen": 1, "offen": 0}
    assert {(x["test"], x["player"], x["ok"]) for x in d["ergebnisse"]} == {("konto-leiste", "paul", True), ("not-aus", "seb", False)}
    # Nachtesten: das neueste Ergebnis je Tester zählt
    tclient.post("/api/tester/ergebnis", json={"test": "not-aus", "ok": True, "text": "jetzt geht es"}, headers=tclient.als())
    assert tclient.get("/api/tester/plan", headers=p).json()["zusammenfassung"]["bestanden"] == 2


def test_ohne_anmeldung(tclient):
    assert tclient.get("/api/tester/plan").status_code == 401                       # ohne Access-Token nichts


def test_live_ohne_testserver(client):
    assert client.get("/api/tester/plan", headers=client.als()).status_code == 404   # live (ohne TESTPLAN_DIR) gibt es das nicht


def test_nachtest_neu_ab(tclient, tmp_path, monkeypatch):
    """Ergebnisse gelten über Commits hinweg; nur Tests mit „neuAb“ stehen danach wieder auf offen (08.11.2026)."""
    p = tclient.als("paul@example.com")
    tclient.post("/api/tester/ergebnis", json={"test": "konto-leiste", "ok": True}, headers=p)
    tclient.post("/api/tester/ergebnis", json={"test": "not-aus", "ok": False, "text": "Hilfe geht noch"}, headers=p)
    plan = dict(PLAN, tests=[PLAN["tests"][0], dict(PLAN["tests"][1], neuAb="2999-01-01T00:00:00+00:00")])
    (tmp_path / "testplan" / "1.4.0.json").write_text(json.dumps(plan))
    d = tclient.get("/api/tester/plan", headers=p).json()
    assert d["zusammenfassung"] == {"gesamt": 2, "bestanden": 1, "fehlgeschlagen": 0, "offen": 1}
    assert d["tests"][1]["neuAb"] == "2999-01-01T00:00:00+00:00" and d["tests"][0]["neuAb"] is None
    assert [x["test"] for x in d["ergebnisse"]] == ["konto-leiste"]
