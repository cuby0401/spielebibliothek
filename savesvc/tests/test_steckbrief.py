"""Steckbrief (Zentrale 1.2.1): Titel, Beschreibung, Vorschaubild auf der Upload-Seite pflegen."""

import pytest

from savesvc import games, steckbrief

from .test_upload import anmelden, uclient  # noqa: F401 – Fixture

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\0" * 32
WEBP = b"RIFF\0\0\0\0WEBPVP8 " + b"\0" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def test_bildart_an_bytes(tmp_path):
    assert steckbrief.art_von(PNG) == "png" and steckbrief.art_von(JPG) == "jpg" and steckbrief.art_von(WEBP) == "webp"
    for falsch in (SVG, b"GIF89a....", b"<html>"):
        with pytest.raises(steckbrief.UngueltigesBild):
            steckbrief.art_von(falsch)


def test_steckbrief_gilt_vor_game_json(umgebung):
    basis = umgebung.spiele / "seb"
    assert games.beschreibung(umgebung.spiele, "seb", "zaehler")["title"] == "Zähler"
    steckbrief.schreiben(basis, "zaehler", "  Zähler  Deluxe ", "Zähle  bis\n100.")
    b = games.beschreibung(umgebung.spiele, "seb", "zaehler")
    assert b["title"] == "Zähler Deluxe" and b["description"] == "Zähle bis 100." and b["vorschau"] is None
    steckbrief.bild_speichern(basis, "zaehler", PNG)
    b = games.beschreibung(umgebung.spiele, "seb", "zaehler")
    assert b["vorschau"].startswith("/api/vorschau/seb/zaehler?v=")
    # gilt auch für den Entwurf
    assert games.beschreibung(umgebung.spiele, "seb", "zaehler~entwurf")["title"] == "Zähler Deluxe"
    # leere Felder → wieder die game.json
    steckbrief.schreiben(basis, "zaehler", "", "")
    assert games.beschreibung(umgebung.spiele, "seb", "zaehler")["title"] == "Zähler"
    assert not (basis / ".zaehler.steckbrief.json").exists()


def test_bild_ersetzt_andere_art_und_grenzen(tmp_path):
    steckbrief.bild_speichern(tmp_path, "s", PNG)
    steckbrief.bild_speichern(tmp_path, "s", JPG)
    assert [p.name for p in tmp_path.iterdir()] == [".s.vorschau.jpg"]
    with pytest.raises(steckbrief.UngueltigesBild, match="2 MB"):
        steckbrief.bild_speichern(tmp_path, "s", PNG + b"\0" * steckbrief.BILD_MAX)
    with pytest.raises(steckbrief.UngueltigesBild):
        steckbrief.bild_speichern(tmp_path, "s", b"")


def test_upload_api_steckbrief(uclient, umgebung):  # noqa: F811
    uclient.store.setzen("paul", "richtiges-passwort-123")
    anmelden(uclient)
    h = uclient.als()
    p = "/api/upload/spiele/snake"
    r = uclient.get(p + "/steckbrief", headers=h)
    assert r.status_code == 200 and r.json()["title"] == "" and r.json()["vorschaubild"] is None
    r = uclient.put(p + "/steckbrief", json={"title": "Snake", "description": "Friss Äpfel."}, headers=h)
    assert r.status_code == 200 and r.json()["description"] == "Friss Äpfel."
    assert uclient.put(p + "/steckbrief", json={"title": 5}, headers=h).status_code == 422
    # Bild: SVG und Falsches abgelehnt, PNG angenommen
    assert uclient.put(p + "/vorschaubild", files={"datei": ("x.svg", SVG, "image/svg+xml")}, headers=h).status_code == 422
    r = uclient.put(p + "/vorschaubild", files={"datei": ("x.png", PNG, "image/png")}, headers=h)
    assert r.status_code == 200 and r.json()["vorschaubild"]["bytes"] == len(PNG)
    r = uclient.get(p + "/vorschaubild", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG
    assert r.headers["x-content-type-options"] == "nosniff"
    # fremdes / unbekanntes Spiel
    assert uclient.get("/api/upload/spiele/gibtsnicht/steckbrief", headers=h).status_code == 404
    # ohne X-Upload-Header (CSRF) nichts ändern
    ohne = {k: v for k, v in h.items() if k != "X-Upload"}
    assert uclient.put(p + "/steckbrief", json={"title": "x"}, headers=ohne).status_code == 403
    # Bild entfernen, beim Löschen des Spiels alles weg
    assert uclient.delete(p + "/vorschaubild", headers=h).status_code == 204
    assert steckbrief.bild(umgebung.spiele / "paul", "snake") is None
    assert uclient.delete(p, headers=h).status_code == 204
    assert not (umgebung.spiele / "paul" / ".snake.steckbrief.json").exists()


def test_vorschau_im_speicherdienst(client, umgebung):
    basis = umgebung.spiele / "paul"
    assert client.get("/api/vorschau/paul/snake", headers=client.als()).status_code == 404
    steckbrief.bild_speichern(basis, "snake", WEBP)
    r = client.get("/api/vorschau/paul/snake", headers=client.als())
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp" and r.content == WEBP
    assert "sandbox" in r.headers["content-security-policy"]
    assert client.get("/api/vorschau/paul/snake").status_code == 401                     # nur mit Anmeldung
    assert client.get("/api/vorschau/paul/..%2Fseb", headers=client.als()).status_code == 404
    spiel = next(s for s in client.get("/api/games", headers=client.als()).json() if s["id"] == "paul/snake")
    assert spiel["vorschau"].startswith("/api/vorschau/paul/snake?v=")
