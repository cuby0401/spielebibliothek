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
    {"id": "crm-sperren", "bereich": "Nur Seb", "titel": "Sperren", "schritte": ["…"], "erwartet": "gesperrt", "nurAdmin": True},
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
    assert tclient.post("/api/tester/ergebnis", json={"test": "konto-leiste", "ok": True}, headers=p).status_code == 201
    # Nein braucht eine Begründung, unbekannte Tests gibt es nicht
    assert tclient.post("/api/tester/ergebnis", json={"test": "not-aus", "ok": False, "text": ""}, headers=p).status_code == 422
    assert tclient.post("/api/tester/ergebnis", json={"test": "gibtsnicht", "ok": True}, headers=p).status_code == 404
    assert tclient.post("/api/tester/ergebnis", json={"test": "not-aus", "ok": False, "text": "Seite lädt weiter"},
                        headers=tclient.als()).status_code == 201
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


def test_admin_tests_nur_fuer_admin(tclient):
    """Admin-Tests sieht nur der Admin, und zwar ganz oben; andere Tester sehen und zählen sie nicht (08.11.2026)."""
    seb, p = tclient.als(), tclient.als("paul@example.com")
    d = tclient.get("/api/tester/plan", headers=seb).json()
    assert [t["id"] for t in d["tests"]] == ["crm-sperren", "konto-leiste", "not-aus"] and d["admin"] is True
    assert d["zusammenfassung"]["gesamt"] == 3
    assert tclient.post("/api/tester/ergebnis", json={"test": "crm-sperren", "ok": True}, headers=seb).status_code == 201
    d = tclient.get("/api/tester/plan", headers=p).json()
    assert [t["id"] for t in d["tests"]] == ["konto-leiste", "not-aus"] and d["admin"] is False
    assert d["ergebnisse"] == [] and d["zusammenfassung"]["gesamt"] == 2
    assert tclient.post("/api/tester/ergebnis", json={"test": "crm-sperren", "ok": True}, headers=p).status_code == 404


def test_fotos_und_verlauf(tclient):
    """1.4.1: Fotos an Ergebnissen; nur der Eintragende fügt an, sehen darf, wer den Test sieht; Verlauf mit allen Einträgen."""
    import base64
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    url = "data:image/png;base64," + base64.b64encode(png).decode()
    seb, p = tclient.als(), tclient.als("paul@example.com")
    eid = tclient.post("/api/tester/ergebnis", json={"test": "konto-leiste", "ok": False, "text": "Knopf fehlt"}, headers=p).json()["id"]
    bid = tclient.post(f"/api/tester/ergebnis/{eid}/bilder", json={"bild": url}, headers=p).json()["id"]
    assert tclient.post(f"/api/tester/ergebnis/{eid}/bilder", json={"bild": url}, headers=seb).status_code == 403   # nicht seins
    assert tclient.post(f"/api/tester/ergebnis/{eid}/bilder", json={"bild": "kein Bild"}, headers=p).status_code == 422
    b = tclient.get(f"/api/tester/bild/{bid}", headers=seb)
    assert b.status_code == 200 and b.content == png and b.headers["content-type"] == "image/png"
    tclient.post("/api/tester/ergebnis", json={"test": "konto-leiste", "ok": True}, headers=p)
    d = tclient.get("/api/tester/plan", headers=p).json()
    assert [x["ok"] for x in d["verlauf"]] == [False, True] and d["verlauf"][0]["bilder"] == [bid]
    assert [x["ok"] for x in d["ergebnisse"]] == [True]                          # gezählt wird nur der neueste
    # Fotos an Admin-Tests sieht nur der Admin
    aid = tclient.post("/api/tester/ergebnis", json={"test": "crm-sperren", "ok": False, "text": "geht nicht"}, headers=seb).json()["id"]
    abid = tclient.post(f"/api/tester/ergebnis/{aid}/bilder", json={"bild": url}, headers=seb).json()["id"]
    assert tclient.get(f"/api/tester/bild/{abid}", headers=p).status_code == 404
    for _ in range(4):
        tclient.post(f"/api/tester/ergebnis/{aid}/bilder", json={"bild": url}, headers=seb)
    assert tclient.post(f"/api/tester/ergebnis/{aid}/bilder", json={"bild": url}, headers=seb).status_code == 409
