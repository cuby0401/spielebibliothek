"""Zentrale 1.5.0: Zugriffstests mit fremden IDs (E81, Plan „Identität und CRM“ → Sicherheit).

Ein normaler Spieler (paul) versucht auf jedem Weg, an Daten anderer zu kommen oder Admin-Rechte zu nutzen – mit
Handles UND mit UUIDs. Jeder Versuch muss scheitern. Wer jemand ist, kommt nur aus der Anmeldung; eine UUID oder ein
Handle in Adresse, Formular oder Parameter berechtigt nie zu etwas.
"""
import re

import pytest

from savesvc import identitaet

from .test_verwaltung import upload  # noqa: F401 (Fixture)

PAUL = "paul@example.com"


@pytest.fixture
def lage(client, upload, umgebung):  # noqa: F811
    seb, paul = client.als(), client.als(PAUL)
    client.get("/api/me", headers=seb); client.get("/api/me", headers=paul)
    client.put("/api/save/seb/zaehler/stand", json={"data": {"geheim": "SEB-STAND"}}, headers=seb)
    a = client.post("/api/antraege", json={"art": "sonstiges", "text": "SEB-PRIVAT bitte nur für Seb"}, headers=seb).json()
    reg = identitaet.Register(umgebung.db)
    assert reg.aktiv(), "Zugriffstests laufen mit UUIDs im Hintergrund"
    return {"seb": seb, "paul": paul, "antrag": a["id"], "seb_id": reg.id_von("seb"), "paul_id": reg.id_von("paul")}


def test_admin_endpunkte_fuer_spieler_gesperrt(client, lage):
    """Jeder Endpunkt unter /api/admin/ – jede Methode, Person per Handle und per UUID – antwortet 403 (oder 401)."""
    werte_handle = {"name": "seb", "user": "seb", "game": "zaehler", "email": "seb@example.com", "rolle": "spieler"}
    werte_uuid = {**werte_handle, "name": lage["seb_id"]}
    geprueft = 0
    for route in client.app.routes:
        pfad = getattr(route, "path", "")
        if not pfad.startswith("/api/admin/"):
            continue
        for methode in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
            for werte in (werte_handle, werte_uuid):
                url = re.sub(r"{(\w+)}", lambda m: str(werte.get(m.group(1), "1")), pfad)
                r = client.request(methode, url, headers=lage["paul"], json={})
                geprueft += 1
                assert r.status_code in (401, 403), f"{methode} {url} → {r.status_code}: {r.text[:200]}"
                assert "SEB-" not in r.text
    assert geprueft > 80


def test_fremde_anfrage_nicht_lesbar(client, lage):
    r = client.get(f"/api/antraege/{lage['antrag']}", headers=lage["paul"])
    assert r.status_code in (403, 404) and "SEB-PRIVAT" not in r.text
    assert "SEB-PRIVAT" not in client.get("/api/antraege", headers=lage["paul"]).text
    assert client.patch(f"/api/antraege/{lage['antrag']}", json={"status": "erledigt"}, headers=lage["paul"]).status_code in (403, 404)


def test_fremder_spielstand_nicht_lesbar(client, lage):
    """Spielstände hängen am angemeldeten Spieler – der Spielordner „seb“ in der Adresse ist das Spiel, nicht die Person."""
    r = client.get("/api/save/seb/zaehler/stand", headers=lage["paul"])
    assert "SEB-STAND" not in r.text
    assert "SEB-STAND" not in client.get("/api/meine/spielstaende", headers=lage["paul"]).text


def test_player_in_parameter_und_formular_wirkt_nicht(client, lage):
    for wer in ("seb", lage["seb_id"]):
        assert "SEB-STAND" not in client.get(f"/api/meine/spielstaende?player={wer}", headers=lage["paul"]).text
        assert "SEB-STAND" not in client.get(f"/api/save/seb/zaehler/stand?player={wer}", headers=lage["paul"]).text
        # Speichern mit fremdem Namen im Formular landet trotzdem beim angemeldeten Spieler
        client.put(f"/api/save/seb/zaehler/stand?player={wer}", json={"data": "VON-PAUL", "player": wer}, headers=lage["paul"])
    assert "VON-PAUL" not in client.get("/api/save/seb/zaehler/stand", headers=lage["seb"]).text
    assert "SEB-STAND" in client.get("/api/save/seb/zaehler/stand", headers=lage["seb"]).text


def test_ansicht_als_nur_fuer_admins(client, lage):
    me = client.get("/api/me", headers={**lage["paul"], "X-Ansicht": "entwickler"}).json()
    assert me["admin"] is False and me["ansicht"] is None


def test_uuid_in_der_adresse_gibt_nicht_mehr_preis(client, lage):
    """Eine UUID statt des Handles öffnet nichts Zusätzliches – das öffentliche Profil ist dasselbe, ohne UUID."""
    mit_handle = client.get("/api/profil/seb", headers=lage["paul"])
    mit_uuid = client.get(f"/api/profil/{lage['seb_id']}", headers=lage["paul"])
    assert mit_handle.status_code == 200 and mit_uuid.json() == mit_handle.json()
    assert not identitaet.UUID_IN_TEXT.search(mit_uuid.text)
    assert client.get("/api/profil/gibtesnicht", headers=lage["paul"]).status_code == 404


def test_intern_nur_mit_token(client, lage):
    for methode, url in (("GET", "/intern/entwurf/seb/zaehler?seit=2000-01-01"), ("POST", "/intern/meldung")):
        r = client.request(methode, url, headers=lage["paul"], json={"an": "*", "text": "x"})
        assert r.status_code in (401, 403, 404), f"{methode} {url} → {r.status_code}"
