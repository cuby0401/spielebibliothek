"""Aufgaben im Admin-Panel (Zentrale 1.3.0): Aufträge, Zeitplan, Befehle für den Auftragsdienst, Live-Status der Probe."""

import io
import json
from datetime import datetime, timezone

from savesvc import auftraege
from savesvc.db import Datenbank

PAUL = "paul@example.com"


def test_auftrag_starten_nur_admin_und_feste_liste(client):
    assert client.post("/api/admin/auftraege", json={"art": "unit-tests", "ziel": "live"}, headers=client.als(PAUL)).status_code == 403
    assert client.post("/api/admin/auftraege", json={"art": "rm -rf /", "ziel": "live"}, headers=client.als()).status_code == 422
    assert client.post("/api/admin/auftraege", json={"art": "unit-tests", "ziel": "/etc"}, headers=client.als()).status_code == 422
    assert client.post("/api/admin/auftraege", json={"art": "live-deploy", "ziel": "live"}, headers=client.als()).status_code == 422  # nie per Knopf
    r = client.post("/api/admin/auftraege", json={"art": "unit-tests", "ziel": "live"}, headers=client.als())
    assert r.status_code == 201
    assert client.post("/api/admin/auftraege", json={"art": "unit-tests", "ziel": "live"}, headers=client.als()).status_code == 409
    d = client.get("/api/admin/auftraege", headers=client.als()).json()
    assert d["dienst"] == {"eingerichtet": False, "aktiv": False, "zuletzt": None}
    assert d["laeufe"][0]["status"] == "wartet" and d["laeufe"][0]["von"] == "seb"


def test_zeitplan(client, umgebung):
    assert client.put("/api/admin/zeitplan", json={"art": "e2e-tests", "ziel": "probe", "uhrzeit": "25:00"}, headers=client.als()).status_code == 422
    plan = client.put("/api/admin/zeitplan", json={"art": "e2e-tests", "ziel": "probe", "uhrzeit": "3:05"}, headers=client.als()).json()
    assert plan[0]["uhrzeit"] == "03:05"
    db = Datenbank(umgebung.db)
    vorher = datetime(2026, 11, 7, 1, 59, tzinfo=timezone.utc)      # 02:59 in Berlin – noch nicht dran
    assert auftraege.planen(db, vorher) == []
    danach = datetime(2026, 11, 7, 2, 10, tzinfo=timezone.utc)      # 03:10 in Berlin
    assert len(auftraege.planen(db, danach)) == 1
    assert auftraege.planen(db, danach) == []                         # am selben Tag nur einmal
    assert db.auftraege()[0]["quelle"] == "plan"
    client.put("/api/admin/zeitplan", json={"art": "e2e-tests", "ziel": "probe", "uhrzeit": None}, headers=client.als())
    assert db.zeitplan() == []


def cli(monkeypatch, umgebung, *argv, eingabe=""):
    from savesvc import __main__ as m
    monkeypatch.setenv("DB_PATH", str(umgebung.db))
    monkeypatch.setenv("USERS_FILE", str(umgebung.users))
    monkeypatch.setattr("sys.stdin", io.StringIO(eingabe))
    return m.main(list(argv))


def test_auftragsdienst_befehle(client, umgebung, monkeypatch, capsys):
    client.post("/api/admin/auftraege", json={"art": "e2e-tests", "ziel": "probe"}, headers=client.als())
    capsys.readouterr()
    assert cli(monkeypatch, umgebung, "auftraege-holen") == 0
    geholt = json.loads(capsys.readouterr().out)
    assert [(a["art"], a["ziel"]) for a in geholt] == [("e2e-tests", "probe")]
    assert cli(monkeypatch, umgebung, "auftraege-holen") == 0
    assert json.loads(capsys.readouterr().out) == []                 # schon übernommen (läuft)
    # Fehler → rote Glocke beim Admin
    assert cli(monkeypatch, umgebung, "auftrag-fertig", eingabe=json.dumps(
        {"id": geholt[0]["id"], "status": "fehler", "zusammenfassung": "3 rot", "log": "x" * 30000})) == 0
    a = client.get(f"/api/admin/auftraege/{geholt[0]['id']}", headers=client.als()).json()
    assert a["status"] == "fehler" and len(a["log"]) == 20000
    m = client.get("/api/meldungen", headers=client.als()).json()
    assert m["wichtigUngelesen"] == 1 and "Ende-zu-Ende-Tests fehlgeschlagen" in m["liste"][0]["text"]
    # Live-Deploy ohne Auftrag: neuer Eintrag
    assert cli(monkeypatch, umgebung, "auftrag-fertig", eingabe=json.dumps(
        {"art": "live-deploy", "ziel": "live", "status": "ok", "zusammenfassung": "1.3.0 ist live"})) == 0
    assert client.get("/api/admin/auftraege", headers=client.als()).json()["laeufe"][0]["art"] == "live-deploy"
    assert cli(monkeypatch, umgebung, "auftrag-fertig", eingabe=json.dumps({"status": "quatsch"})) == 2
    # Lebenszeichen
    assert cli(monkeypatch, umgebung, "lebenszeichen", "1.3.0") == 0
    assert client.get("/api/admin/auftraege", headers=client.als()).json()["dienst"]["aktiv"] is True


def test_haengende_auftraege_werden_abgeschlossen(umgebung):
    db = Datenbank(umgebung.db)
    aid = db.auftrag_anlegen("unit-tests", "live", "knopf", "seb")
    db.auftraege_holen()
    with db.verbindung() as v:
        v.execute("UPDATE auftraege SET start='2020-01-01T00:00:00+00:00' WHERE id=?", (aid,))
    db.auftraege_holen()
    assert db.auftrag(aid)["status"] == "fehler" and "abgebrochen" in db.auftrag(aid)["zusammenfassung"]
    assert db.auftrag_anlegen("unit-tests", "live", "knopf", "seb") is not None    # danach wieder startbar


def test_live_status_in_der_probe(client, umgebung, monkeypatch):
    assert cli(monkeypatch, umgebung, "live-status", eingabe=json.dumps(
        {"status": "ok", "commit": "abc1234", "text": "ist live", "geheim": "wird nicht übernommen"})) == 0
    p = client.get("/api/admin/probe", headers=client.als()).json()
    assert p["live"] == {"status": "ok", "commit": "abc1234", "text": "ist live"}


def test_waechter_merkt_stehengebliebenen_auftragsdienst(umgebung, monkeypatch):
    from types import SimpleNamespace
    from savesvc import waechter
    monkeypatch.setattr(waechter.urllib.request, "urlopen", lambda *a, **k: SimpleNamespace(status=200))
    monkeypatch.setattr(waechter.urllib.request, "build_opener", lambda *a: SimpleNamespace(open=lambda *a, **k: SimpleNamespace(status=302)))
    e = SimpleNamespace(spiele_dir=umgebung.spiele, backup_ziel=None, ha_webhook="")
    db = Datenbank(umgebung.db)
    assert waechter.pruefen(e, db, lambda *a: {"ok": True}) == []     # nie eingerichtet → kein Problem
    db.dienst_setzen("auftragsdienst", "1.3.0")
    assert waechter.pruefen(e, db, lambda *a: {"ok": True}) == []
    with db.verbindung() as v:
        v.execute("UPDATE dienst_status SET zeit='2020-01-01T00:00:00+00:00'")
    assert any("Auftragsdienst" in p for p in waechter.pruefen(e, db, lambda *a: {"ok": True}))
