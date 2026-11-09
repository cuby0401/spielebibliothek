import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from savesvc.app import erstellen
from savesvc.config import Einstellungen

TEAM = "test-team.cloudflareaccess.com"
AUD = "aud-games-123"


class Schluessel:
    """Ersatz für PyJWKClient: liefert immer den Test-Schlüssel."""

    def __init__(self, oeffentlich):
        self.oeffentlich = oeffentlich

    def get_signing_key_from_jwt(self, token):
        return SimpleNamespace(key=self.oeffentlich)


@pytest.fixture(scope="session")
def rsa_schluessel():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def token(rsa_schluessel):
    def machen(email="seb@example.com", aud=AUD, iss=f"https://{TEAM}", exp_in=3600, schluessel=None):
        jetzt = int(time.time())
        daten = {"email": email, "aud": aud, "iss": iss, "iat": jetzt, "exp": jetzt + exp_in}
        return jwt.encode(daten, schluessel or rsa_schluessel, algorithm="RS256", headers={"kid": "test"})
    return machen


@pytest.fixture
def umgebung(tmp_path: Path):
    spiele = tmp_path / "spiele"
    for benutzer, spiel, meta in [
        ("seb", "zaehler", {"title": "Zähler", "saveVersion": 2, "leaderboard": {"enabled": True}}),
        ("paul", "snake", None),
        ("paul", "kaputt", "{ das ist kein json"),
    ]:
        ordner = spiele / benutzer / spiel
        ordner.mkdir(parents=True)
        (ordner / "index.html").write_text("<!doctype html>")
        if isinstance(meta, dict):
            (ordner / "game.json").write_text(json.dumps(meta))
        elif isinstance(meta, str):
            (ordner / "game.json").write_text(meta)
    (spiele / "paul" / "ohne-index").mkdir()
    (spiele / "#recycle").mkdir()
    users = tmp_path / "users.yaml"
    users.write_text("seb@example.com: seb\nPaul@Example.com: paul\n")
    return SimpleNamespace(spiele=spiele, users=users, db=tmp_path / "data" / "saves.db")


@pytest.fixture
def client(umgebung, rsa_schluessel, token):
    e = Einstellungen(team_domain=TEAM, audience=AUD, users_file=umgebung.users,
                      spiele_dir=umgebung.spiele, db_path=umgebung.db, dev_user=None,
                      # 1.5.0: standardmäßig mit UUIDs im Hintergrund; TEST_IDENTITAET_UUID=0 = Verhalten von 1.4.1
                      identitaet_uuid=os.environ.get("TEST_IDENTITAET_UUID", "1") != "0")
    app = erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key()))
    c = TestClient(app)

    def als(email="seb@example.com", **kw):
        return {"Cf-Access-Jwt-Assertion": token(email=email, **kw), "X-Bibliothek": "1"}
    c.als = als
    return c


@pytest.fixture(autouse=True)
def _identitaet_zuruecksetzen():
    """Das Register ist je Prozess global (eine Datenbank je Dienst) – in Tests nicht an den nächsten Test vererben."""
    yield
    from savesvc import identitaet
    identitaet.REGISTER = None


@pytest.fixture
def pid(umgebung):
    """Schlüssel einer Person in der Datenbank: ihr Name (1.4.x) bzw. ihre UUID (ab 1.5.0, TEST_IDENTITAET_UUID=1)."""
    from savesvc import identitaet
    return lambda name: identitaet.Register(umgebung.db).id_von(name) or name
