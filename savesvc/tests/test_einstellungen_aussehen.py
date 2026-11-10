"""Aussehen und Startseite je Spieler (neue UI, 10.11.2026)."""
from savesvc import verwaltung

SEB, PAUL = "seb@example.com", "paul@example.com"
ALLE = [{"id": i, "sichtbar": True} for i in verwaltung.ABSCHNITTE]


def test_standardwerte(client):
    d = client.get("/api/einstellungen", headers=client.als()).json()
    assert d["aussehen"] == {"thema": "auto", "akzent": "blau", "dichte": "normal", "kachelgroesse": "mittel"}
    assert d["startseite"] == {"abschnitte": ALLE}


def test_aussehen_wird_je_schluessel_gemischt(client):
    h = client.als()
    assert client.put("/api/einstellungen", json={"aussehen": {"thema": "dunkel"}}, headers=h).status_code == 200
    r = client.put("/api/einstellungen", json={"aussehen": {"akzent": "blau", "dichte": "luftig"}}, headers=h)
    assert r.json()["aussehen"] == {"thema": "dunkel", "akzent": "blau", "dichte": "luftig", "kachelgroesse": "mittel"}
    assert client.get("/api/einstellungen", headers=h).json()["aussehen"]["thema"] == "dunkel"


def test_ungueltige_werte_422(client):
    h = client.als()
    for body in ({"aussehen": {"thema": "lila"}}, {"aussehen": {"akzent": "#ff0000"}}, {"aussehen": {"dichte": 3}},
                 {"aussehen": {"kachelgroesse": "riesig"}}, {"aussehen": {"schrift": "gross"}}, {"aussehen": "dunkel"},
                 {"startseite": {"abschnitte": [{"id": "werbung", "sichtbar": True}]}},
                 {"startseite": {"abschnitte": [{"id": "neu"}, {"id": "neu"}]}},
                 {"startseite": {"abschnitte": [{"id": "neu", "sichtbar": "ja"}]}},
                 {"startseite": {"abschnitte": "neu"}}, {"startseite": []}):
        r = client.put("/api/einstellungen", json=body, headers=h)
        assert r.status_code == 422, body
    assert client.get("/api/einstellungen", headers=h).json()["aussehen"]["thema"] == "auto"   # nichts halb gespeichert


def test_startseite_wird_normalisiert(client):
    h = client.als()
    r = client.put("/api/einstellungen", json={"startseite": {"abschnitte": [
        {"id": "alle", "sichtbar": True}, {"id": "neu", "sichtbar": False}]}}, headers=h)
    ab = r.json()["startseite"]["abschnitte"]
    assert ab[:2] == [{"id": "alle", "sichtbar": True}, {"id": "neu", "sichtbar": False}]
    assert [x["id"] for x in ab[2:]] == [i for i in verwaltung.ABSCHNITTE if i not in ("alle", "neu")]   # Fehlende hinten, sichtbar
    assert all(x["sichtbar"] for x in ab[2:])


def test_alte_daten_mit_unbekanntem_abschnitt():
    ab = verwaltung.abschnitte_bereinigen([{"id": "gibts-nicht"}, {"id": "neu", "sichtbar": False}, {"id": "neu"}, "kaputt"])
    assert ab[0] == {"id": "neu", "sichtbar": False} and len(ab) == len(verwaltung.ABSCHNITTE)
    assert verwaltung.aussehen_bereinigen({"thema": "lila", "akzent": "blau"})["thema"] == "auto"


def test_andere_einstellung_laesst_aussehen_stehen(client):
    h = client.als()
    client.put("/api/einstellungen", json={"aussehen": {"thema": "hell"},
                                           "startseite": {"abschnitte": [{"id": "favoriten", "sichtbar": False}]}}, headers=h)
    client.put("/api/einstellungen", json={"favoriten": ["seb/zaehler"], "sortierung": "neu"}, headers=h)
    d = client.get("/api/einstellungen", headers=h).json()
    assert d["aussehen"]["thema"] == "hell" and d["startseite"]["abschnitte"][0] == {"id": "favoriten", "sichtbar": False}
    assert d["favoriten"] == ["seb/zaehler"] and d["sortierung"] == "neu"


def test_je_spieler_und_simulation_getrennt(client):
    client.put("/api/einstellungen", json={"aussehen": {"thema": "dunkel"}}, headers=client.als())
    assert client.get("/api/einstellungen", headers=client.als(PAUL)).json()["aussehen"]["thema"] == "auto"
    sim = {**client.als(), "X-Ansicht": "spieler"}
    assert client.get("/api/einstellungen", headers=sim).json()["aussehen"]["thema"] == "auto"
