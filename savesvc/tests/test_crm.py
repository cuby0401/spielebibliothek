"""Zentrale 1.4.0: CRM – Personen statt users.yaml (E67/E68)."""
import json
from datetime import datetime, timedelta, timezone

from savesvc import crm as crm_modul, mail
from savesvc.db import Datenbank

from .test_verwaltung import upload  # noqa: F401 (Fixture)

SEB, PAUL = "seb@example.com", "paul@example.com"


def test_uebernahme_behaelt_alle_rechte(client, umgebung):
    """Nach dem Umzug: gleiche Personen, gleiche Rollen wie vorher (ADMINS → admin, Ordner → entwickler)."""
    db = Datenbank(umgebung.db)
    c = crm_modul.Crm(db, frozenset({"seb"}))
    personen = {p["name"]: p for p in c.personen()}
    assert set(personen) == {"seb", "paul"}
    assert personen["seb"]["rollen"] == ["admin", "entwickler", "spieler"]
    assert personen["paul"]["rollen"] == ["entwickler", "spieler"] and personen["paul"]["emails"] == ["paul@example.com"]
    assert all(p["status"] == "aktiv" for p in personen.values())
    assert list((umgebung.db.parent / "backup").glob("users-vor-crm-*.yaml"))                 # vorher gesichert
    me = client.get("/api/me", headers=client.als(PAUL)).json()
    assert me["uploader"] is True and me["admin"] is False
    assert client.get("/api/me", headers=client.als()).json()["admin"] is True


def test_handeintrag_in_users_yaml_wird_uebernommen(client, umgebung):
    umgebung.users.write_text(umgebung.users.read_text() + "neu@example.com: neu\n")
    assert client.get("/api/me", headers=client.als("neu@example.com")).json()["player"] == "neu"
    p = client.get("/api/admin/personen/neu", headers=client.als()).json()
    assert p["rollen"] == ["spieler"] and p["protokoll"][0]["von"] == "users.yaml"


def test_admin_felder_nie_bei_der_person_selbst(client, upload):  # noqa: F811
    client.post("/api/admin/personen/paul/notizen", json={"text": "GEHEIME NOTIZ"}, headers=client.als())
    client.post("/api/admin/personen/paul/verwarnen", json={"grund": "Zu viele Anfragen"}, headers=client.als())
    konto = client.get("/api/mein/konto", headers=client.als(PAUL))
    assert konto.status_code == 200 and konto.json()["status"] == "verwarnt"
    assert "GEHEIME" not in konto.text and not any(k in konto.json() for k in ("notizen", "zeitleiste", "protokoll", "sperrgrund"))
    # Admin-Endpunkte für Nicht-Admins gesperrt
    for pfad in ("/api/admin/personen", "/api/admin/personen/paul", "/api/admin/personen/paul/export", "/api/admin/protokoll"):
        assert client.get(pfad, headers=client.als(PAUL)).status_code == 403, pfad
    assert client.post("/api/admin/personen/seb/notizen", json={"text": "x"}, headers=client.als(PAUL)).status_code == 403
    # Verwarnung kommt rot in die Glocke, mit Grund
    m = client.get("/api/meldungen", headers=client.als(PAUL)).json()
    assert m["wichtigUngelesen"] == 1 and "Zu viele Anfragen" in m["liste"][0]["text"]
    # Simulation: keine echten CRM-Daten
    sim = {**client.als(), "X-Ansicht": "entwickler"}
    assert client.get("/api/mein/konto", headers=sim).json() == {"name": "seb~entwickler", "simuliert": True}


def test_mein_konto_aendern(client):
    h = client.als(PAUL)
    r = client.patch("/api/mein/konto", json={"anzeigename": "  Phil  ", "geburtstag": "1995-04-01", "datenschutz": True, "status": "admin"}, headers=h)
    assert r.status_code == 200 and r.json()["anzeigename"] == "Phil" and r.json()["status"] == "aktiv"   # Status nicht änderbar
    assert r.json()["datenschutz_bestaetigt"]
    assert client.patch("/api/mein/konto", json={"geburtstag": "3000-01-01"}, headers=h).status_code == 422
    assert client.patch("/api/mein/konto", json={"vorname": "x" * 61}, headers=h).status_code == 422
    # Protokoll zeigt, wer geändert hat
    assert client.get("/api/admin/personen/paul", headers=client.als()).json()["protokoll"][0]["von"] == "paul"


def test_rollen_und_upload_konto(client, upload):  # noqa: F811
    upload.konten.discard("paul")
    r = client.put("/api/admin/personen/paul/rollen", json={"rollen": ["spieler", "tester"]}, headers=client.als())
    assert r.json() == {"dazu": ["tester"], "weg": ["entwickler"]}
    assert ("DELETE", "/intern/entwickler/paul", None) in upload.aufrufe
    r = client.put("/api/admin/personen/paul/rollen", json={"rollen": ["entwickler"]}, headers=client.als())
    assert r.json()["dazu"] == ["entwickler"] and r.json()["passwort"] == "X" * 20
    # Admin kann sich die Admin-Rolle nicht selbst nehmen; Notfall-Admin bleibt immer Admin
    assert client.put("/api/admin/personen/seb/rollen", json={"rollen": ["spieler"]}, headers=client.als()).status_code == 409
    # CRM-Admin: wirkt sofort, auch für Anfragen an „admin“
    client.put("/api/admin/personen/paul/rollen", json={"rollen": ["entwickler", "admin"]}, headers=client.als())
    assert client.get("/api/me", headers=client.als(PAUL)).json()["admin"] is True
    client.post("/api/antraege", json={"art": "wunsch", "text": "Dunkles Design"}, headers=client.als())
    assert client.get("/api/meldungen", headers=client.als(PAUL)).json()["wichtigUngelesen"] == 1


def test_sperre_mit_ablauf(client, umgebung):
    bald = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    assert client.post("/api/admin/personen/paul/sperren", json={"grund": "kurz", "bis": "2000-01-01T00:00:00"}, headers=client.als()).status_code == 422
    assert client.post("/api/admin/personen/paul/sperren", json={"grund": "Pause", "bis": bald}, headers=client.als()).status_code == 200
    assert "bis" in client.get("/api/me", headers=client.als(PAUL)).json()["detail"]
    db = Datenbank(umgebung.db)
    with db.verbindung() as v:
        v.execute("UPDATE personen SET gesperrt_bis='2000-01-01T00:00:00+00:00' WHERE name='paul'")
    assert client.get("/api/me", headers=client.als(PAUL)).status_code == 200                 # abgelaufen → frei
    p = client.get("/api/admin/personen/paul", headers=client.als()).json()
    assert p["status"] == "aktiv" and any(z["text"] == "Sperre abgelaufen" for z in p["zeitleiste"])


def test_emails_und_export(client):
    assert client.post("/api/admin/personen/seb/emails", json={"email": "seb+test@example.com"}, headers=client.als()).status_code == 201
    assert client.get("/api/me", headers=client.als("seb+test@example.com")).json()["player"] == "seb"
    assert client.post("/api/admin/personen/paul/emails", json={"email": "seb+test@example.com"}, headers=client.als()).status_code == 409
    assert client.delete("/api/admin/personen/paul/emails/paul@example.com", headers=client.als()).status_code == 409   # letzte
    client.put("/api/save/seb/zaehler/x", json={"data": {"geheim": 1}}, headers=client.als(PAUL))
    ex = client.get("/api/admin/personen/paul/export", headers=client.als()).json()
    assert ex["person"]["name"] == "paul" and ex["spielstaende"] and "data" not in ex["spielstaende"][0]
    assert client.get("/api/admin/protokoll", headers=client.als()).json()[0]["aktion"] == "export"


class FalscherSmtp:
    gesendet = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        self.tls = True

    def login(self, b, p):
        assert p == "geheim"

    def send_message(self, m):
        FalscherSmtp.gesendet.append(m)


def test_einladung_per_mail(client, monkeypatch, upload):  # noqa: F811
    client.post("/api/admin/personen", json={"email": "lea@example.com", "name": "lea", "vorname": "Lea"}, headers=client.als())
    assert "nicht eingerichtet" in client.post("/api/admin/personen/lea/einladung", json={}, headers=client.als()).json()["detail"]
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_BENUTZER", "bibliothek@example.com")
    monkeypatch.setenv("SMTP_PASSWORT", "geheim")
    monkeypatch.setattr(mail.smtplib, "SMTP", FalscherSmtp)
    # Cloudflare-Abgleich nicht eingerichtet → nur mit ausdrücklicher Bestätigung
    assert client.post("/api/admin/personen/lea/einladung", json={}, headers=client.als()).status_code == 409
    r = client.post("/api/admin/personen/lea/einladung", json={"ohnePruefung": True}, headers=client.als())
    assert r.status_code == 200 and r.json()["einladung_gesendet"]
    m = FalscherSmtp.gesendet[-1]
    assert m["To"] == "lea@example.com" and "Hallo Lea" in m.get_content() and "Benutzername: lea" in m.get_content()
    assert "geheim" not in m.as_string()
    # Fehler beim Versand: Meldung ohne Zugangsdaten
    class Kaputt(FalscherSmtp):
        def login(self, b, p):
            raise mail.smtplib.SMTPAuthenticationError(535, b"bibliothek@example.com geheim falsch")
    monkeypatch.setattr(mail.smtplib, "SMTP", Kaputt)
    r = client.post("/api/admin/personen/lea/einladung", json={"ohnePruefung": True}, headers=client.als())
    assert r.status_code == 502 and "geheim" not in r.text and "bibliothek@" not in r.text


def test_protokoll_hat_vorher_nachher(client):
    client.patch("/api/admin/personen/paul", json={"vorname": "Paul"}, headers=client.als())
    eintrag = client.get("/api/admin/protokoll", headers=client.als()).json()[0]
    assert eintrag["aktion"] == "stammdaten" and eintrag["von"] == "seb" and eintrag["ziel"] == "paul"
    assert json.loads(eintrag["vorher"]) == {"vorname": None} and json.loads(eintrag["nachher"]) == {"vorname": "Paul"}


def test_entwickler_entziehen_trotz_spieleordner(client, upload):  # noqa: F811
    """1.4.0, Nachtest 08.11. (Sebs Test seb-crm-massnahmen): Nach dem Entziehen blieb der Haken bei Entwickler stehen, weil der
    Spieleordner (die Spiele bleiben) weiter als Entwickler zählte – neu vergeben ging dann nicht mehr."""
    upload.konten.discard("paul")
    r = client.put("/api/admin/personen/paul/rollen", json={"rollen": ["spieler"]}, headers=client.als())
    assert r.json() == {"dazu": [], "weg": ["entwickler"]}
    p = client.get("/api/admin/personen/paul", headers=client.als()).json()
    assert p["rollen"] == ["spieler"] and p["ordner"] is True               # Haken weg, Ordner bleibt
    liste = {x["name"]: x for x in client.get("/api/admin/personen", headers=client.als()).json()["personen"]}
    assert liste["paul"]["rollen"] == ["spieler"]
    me = client.get("/api/me", headers=client.als(PAUL)).json()
    assert me["uploader"] is False
    # Wieder vergeben klappt und legt ein neues Upload-Konto an
    r = client.put("/api/admin/personen/paul/rollen", json={"rollen": ["spieler", "entwickler"]}, headers=client.als())
    assert r.json()["dazu"] == ["entwickler"] and r.json()["passwort"] == "X" * 20
    assert client.get("/api/me", headers=client.als(PAUL)).json()["uploader"] is True


def test_uebernahme_mit_testern(tmp_path, umgebung):
    """1.4.0, Nachtest 08.11. (Sebs Test seb-crm-personen): Emil war schon Tester, das CRM wusste davon nichts. TESTER setzt die Rolle
    bei der Übernahme; danach zählt nur noch das CRM."""
    umgebung.users.write_text(umgebung.users.read_text() + "emil@example.com: emil\n")
    db = Datenbank(umgebung.db)
    c = crm_modul.Crm(db, frozenset({"seb"}))
    assert crm_modul.uebernehmen(c, umgebung.users, tmp_path / "b", frozenset({"seb"}), umgebung.spiele, frozenset({"emil"})) == 3
    rollen = {p["name"]: p["rollen"] for p in c.personen()}
    assert rollen["emil"] == ["spieler", "tester"] and "tester" not in rollen["paul"]
    # zweiter Start: nichts passiert mehr (CRM nicht leer)
    assert crm_modul.uebernehmen(c, umgebung.users, tmp_path / "b", frozenset({"seb"}), umgebung.spiele, frozenset({"paul"})) == 0


def test_nie_angemeldet_bleibt_eingeladen(client, upload):  # noqa: F811
    """Entsperren, Verwarnung aufheben, Wiederherstellen: wer sich nie angemeldet hat, ist danach „eingeladen“, nicht „aktiv“."""
    h = client.als()
    client.post("/api/admin/personen", json={"email": "neu@example.com", "name": "neu"}, headers=h)
    client.post("/api/admin/personen/neu/sperren", json={"grund": "Test"}, headers=h)
    assert client.post("/api/admin/personen/neu/entsperren", headers=h).json()["status"] == "eingeladen"
    client.post("/api/admin/personen/neu/verwarnen", json={"grund": "Test"}, headers=h)
    assert client.post("/api/admin/personen/neu/verwarnung-aufheben", headers=h).json()["status"] == "eingeladen"
    client.post("/api/admin/personen/neu/archivieren", headers=h)
    assert client.post("/api/admin/personen/neu/wiederherstellen", headers=h).json()["person"]["status"] == "eingeladen"
