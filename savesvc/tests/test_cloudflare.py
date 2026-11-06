"""Cloudflare-Abgleich (Zentrale 1.3.0, Idee 9): Sicherheitsregeln, Nur-Lese-Prüfung, Admin-Panel, CLI."""

import io
import json
import os
import urllib.error

import pytest

from savesvc import cloudflare as cf

from .test_verwaltung import upload  # noqa: F401 – Fixture

KONTO = "a" * 32
PID = "6d60e7b7-08b9-4c96-8c1a-0123456789ab"
SCHLUESSEL = "geheimer-schluessel-1234567890"


def richtlinie(*mails, **extra):
    return {"id": PID, "name": "Kollegen", "decision": "allow", "created_at": "x", "updated_at": "y", "app_count": 2,
            "reusable": True, "session_duration": "168h", "exclude": [], "require": [],
            "include": [{"email": {"email": m}} for m in mails], **extra}


# ---------- reine Logik ----------

def test_soll():
    s = cf.soll({"Seb@x.de": "seb", "p@x.de": "paul", "e@x.de": "eli"}, {"seb", "paul"})
    assert s == {"kollegen": {"seb@x.de", "p@x.de", "e@x.de"}, "entwickler": {"seb@x.de", "p@x.de"}}


def test_bedenken():
    assert cf.bedenken(richtlinie("a@x.de"), "Kollegen") == []
    assert "Name" in cf.bedenken(richtlinie("a@x.de"), "Entwickler")[0]
    assert any("allow" in b for b in cf.bedenken(richtlinie("a@x.de", decision="bypass"), "Kollegen"))
    # „Jeder“ oder ganze Domains: nie automatisch anfassen
    r = richtlinie("a@x.de")
    r["include"].append({"everyone": {}})
    r["include"].append({"email_domain": {"domain": "gmail.com"}})
    b = cf.bedenken(r, "Kollegen")
    assert any("everyone" in x and "email_domain" in x for x in b)
    assert any("leer" in x for x in cf.bedenken(richtlinie(), "Kollegen"))


def test_vergleich_gross_klein_egal():
    v = cf.vergleich(richtlinie("Seb@X.de", "alt@x.de"), {"seb@x.de", "emil@x.de"})
    assert v == {"fehlt": ["emil@x.de"], "zuviel": ["alt@x.de"]}


def test_neuer_stand_aendert_nur_emails():
    r = richtlinie("seb@x.de", "alt@x.de", mfa_config={"x": 1})
    body = cf.neuer_stand(r, {"seb@x.de", "neu@x.de"}, geschuetzt={"seb@x.de"}, entfernen=False)
    assert not set(body) & cf.NUR_LESEN                       # nur-lesbare Felder nicht zurückschicken
    assert body["session_duration"] == "168h" and body["mfa_config"] == {"x": 1} and body["decision"] == "allow"
    assert cf.emails(body) == {"seb@x.de", "alt@x.de", "neu@x.de"}      # ohne --entfernen bleibt „alt“
    assert cf.emails(cf.neuer_stand(r, {"neu@x.de"}, {"seb@x.de"}, entfernen=True)) == {"seb@x.de", "neu@x.de"}  # Admin bleibt
    assert r["include"][0] == {"email": {"email": "seb@x.de"}}             # Original unverändert
    with pytest.raises(cf.CloudflareFehler, match="leer"):
        cf.neuer_stand(richtlinie("a@x.de"), set(), set(), entfernen=True)
    with pytest.raises(cf.CloudflareFehler, match="Ungültige"):
        cf.neuer_stand(r, {"kein-mail"}, set(), entfernen=False)


def test_unterschiede():
    vorher = richtlinie("a@x.de")
    assert cf.unterschiede(vorher, {**richtlinie("b@x.de"), "updated_at": "z"}) == []
    assert cf.unterschiede(vorher, {**vorher, "decision": "bypass"}) == ["decision"]


# ---------- API ----------

class Antwort(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FalschesCloudflare:
    def __init__(self, richtlinien, status=200):
        self.richtlinien, self.status, self.anfragen = richtlinien, status, []

    def __call__(self, anfrage, timeout=None):
        self.anfragen.append(anfrage)
        if self.status != 200:
            raise urllib.error.HTTPError(anfrage.full_url, self.status, "x", {},
                                         io.BytesIO(json.dumps({"success": False, "errors": [{"message": "Authentication error"}]}).encode()))
        if anfrage.full_url.endswith("/access/policies?per_page=50&page=1"):
            ergebnis = [{"id": r["id"], "name": r["name"]} for r in self.richtlinien]
        else:
            ergebnis = next(r for r in self.richtlinien if anfrage.full_url.endswith(r["id"]))
        return Antwort(json.dumps({"success": True, "result": ergebnis}).encode())


def test_api_schluessel_nie_sichtbar():
    falsch = FalschesCloudflare([], status=403)
    a = cf.Api(SCHLUESSEL, KONTO, falsch)
    assert SCHLUESSEL not in repr(a)
    with pytest.raises(cf.CloudflareFehler) as f:
        a.richtlinien()
    assert SCHLUESSEL not in str(f.value) and "ohne passendes Recht" in str(f.value)
    assert falsch.anfragen[0].get_header("Authorization") == "Bearer " + SCHLUESSEL
    with pytest.raises(cf.CloudflareFehler, match="Konto-ID"):
        cf.Api(SCHLUESSEL, "kaputt")
    with pytest.raises(cf.CloudflareFehler, match="Richtlinien-ID"):
        cf.Api(SCHLUESSEL, KONTO, falsch).richtlinie("../../zones")


def test_richtlinie_finden_nur_eindeutig():
    zwei = [richtlinie("a@x.de"), {**richtlinie("b@x.de"), "id": PID.replace("6", "7")}]
    with pytest.raises(cf.CloudflareFehler, match="mehrfach"):
        cf.Api(SCHLUESSEL, KONTO, FalschesCloudflare(zwei)).richtlinie_finden("Kollegen")
    with pytest.raises(cf.CloudflareFehler, match="nicht gefunden"):
        cf.Api(SCHLUESSEL, KONTO, FalschesCloudflare(zwei)).richtlinie_finden("Entwickler")


def test_pruefung(tmp_path):
    datei = tmp_path / "cf.token"
    falsch = FalschesCloudflare([richtlinie("seb@x.de"),
                                 {**richtlinie("seb@x.de"), "id": PID.replace("6", "7"), "name": "Entwickler"}])
    p = cf.Pruefung(datei, KONTO, {"kollegen": "Kollegen", "entwickler": "Entwickler"}, falsch)
    assert p.ergebnis({"kollegen": set()}) == {"eingerichtet": False}           # ohne Schlüssel: aus
    datei.write_text(SCHLUESSEL)
    soll = {"kollegen": {"seb@x.de", "emil@x.de"}, "entwickler": {"seb@x.de"}}
    e = p.ergebnis(soll)
    assert e["richtlinien"][0]["fehlt"] == ["emil@x.de"] and e["richtlinien"][1]["fehlt"] == []
    n = len(falsch.anfragen)
    p.ergebnis(soll)
    assert len(falsch.anfragen) == n                                             # 5 Minuten zwischengespeichert
    p.ergebnis(soll, neu=True)
    assert len(falsch.anfragen) > n
    assert all(a.get_method() == "GET" for a in falsch.anfragen)                 # der Server liest nur


# ---------- Admin-Panel ----------

def test_admin_ohne_cloudflare(client, upload):  # noqa: F811
    assert client.get("/api/admin/cloudflare", headers=client.als()).json() == {"eingerichtet": False}
    assert client.get("/api/admin/cloudflare", headers=client.als("paul@example.com")).status_code == 403
    liste = {b["name"]: b for b in client.get("/api/admin/benutzer", headers=client.als()).json()}
    assert liste["seb"]["cloudflare"] is None
    assert liste["seb"]["nieAngemeldet"] is True                                  # noch nichts getan
    client.get("/api/me", headers=client.als())
    liste = {b["name"]: b for b in client.get("/api/admin/benutzer", headers=client.als()).json()}
    assert liste["seb"]["nieAngemeldet"] is False
    assert liste["paul"]["nieAngemeldet"] is False                              # hat hochgeladen (Upload-Ereignis)


# ---------- CLI: Nur-Lese-Schlüssel hinterlegen ----------

def test_cli_lesetoken(tmp_path, monkeypatch, capsys):
    from savesvc import __main__ as cli
    ziel = tmp_path / "cloudflare-lesen.token"
    monkeypatch.setenv("CF_ACCOUNT_ID", KONTO)
    monkeypatch.setenv("CF_LESE_SCHLUESSEL", str(ziel))
    monkeypatch.setattr(cf.Api, "richtlinien", lambda self: (_ for _ in ()).throw(cf.CloudflareFehler("Cloudflare: kaputt")))
    monkeypatch.setattr("sys.stdin", io.StringIO(SCHLUESSEL + "\n"))
    assert cli.main(["cloudflare-lesetoken"]) == 1 and not ziel.exists()        # funktioniert nicht → nicht gespeichert
    monkeypatch.setattr(cf.Api, "richtlinien", lambda self: [{"id": PID}])
    monkeypatch.setattr("sys.stdin", io.StringIO(SCHLUESSEL + "\n"))
    assert cli.main(["cloudflare-lesetoken"]) == 0
    assert ziel.read_text().strip() == SCHLUESSEL and oct(os.stat(ziel).st_mode & 0o777) == "0o600"
    assert SCHLUESSEL not in capsys.readouterr().out
    monkeypatch.setattr("sys.stdin", io.StringIO("mit leerzeichen drin"))
    assert cli.main(["cloudflare-lesetoken"]) == 2
