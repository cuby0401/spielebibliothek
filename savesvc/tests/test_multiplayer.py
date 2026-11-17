"""Multiplayer (Zentrale 1.6.0, E88): Räume, Nachrichten, Host-Wechsel mit Spielstand, Rauswerfen, Einladen."""

import json

import pytest
from starlette.websockets import WebSocketDisconnect

HERKUNFT = "http://testserver"


@pytest.fixture
def mp(umgebung, request):
    for ordner, meta in [("vier", {"title": "Vier", "multiplayer": {"min": 2, "max": 2}}),
                         ("solo", {"title": "Solo"})]:
        o = umgebung.spiele / "seb" / ordner
        o.mkdir(parents=True)
        (o / "index.html").write_text("<!doctype html>")
        (o / "game.json").write_text(json.dumps(meta))
    entwurf = umgebung.spiele / "seb" / "vier~entwurf"
    entwurf.mkdir()
    (entwurf / "index.html").write_text("<!doctype html>")
    (entwurf / "game.json").write_text(json.dumps({"multiplayer": True}))
    umgebung.users.write_text(umgebung.users.read_text() + "eli@example.com: eli\nmax@example.com: max\n")
    c = request.getfixturevalue("client")

    def verbinden(email="seb@example.com", pfad="seb/vier", herkunft=HERKUNFT, **q):
        kopf = {"Cf-Access-Jwt-Assertion": c.als(email)["Cf-Access-Jwt-Assertion"]}
        if herkunft:
            kopf["origin"] = herkunft
        abfrage = "&".join(f"{k}={v}" for k, v in q.items())
        return c.websocket_connect(f"/api/mp/{pfad}" + (f"?{abfrage}" if abfrage else ""), headers=kopf)
    c.verbinden = verbinden
    return c


def naechste(ws, art):
    for _ in range(20):
        n = ws.receive_json()
        if n.get("t") == art:
            return n
    raise AssertionError(f"keine Nachricht {art}")


def geschlossen(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as f:
        for _ in range(20):
            ws.receive_json()
    return f.value.code


def test_raum_erstellen_beitreten_und_nachrichten(mp):
    with mp.verbinden(neu=1) as a:
        st = naechste(a, "stand")
        assert st["daten"] is None                        # neuer Raum, noch kein Spielstand
        raum = naechste(a, "raum")["raum"]
        assert len(raum["code"]) == 4 and raum["host"] == raum["ich"] == "seb" and raum["max"] == 2
        with mp.verbinden("paul@example.com", raum=raum["code"].lower()) as b:
            rb = naechste(b, "raum")["raum"]
            assert rb["ich"] == "paul" and rb["host"] == "seb" and [s["id"] for s in rb["spieler"]] == ["seb", "paul"]
            assert naechste(a, "raum")["raum"]["spieler"][1]["name"] == "paul"
            b.send_text(json.dumps({"t": "an", "an": "host", "daten": {"zug": 3}}))
            assert naechste(a, "nachricht") == {"t": "nachricht", "von": "paul", "daten": {"zug": 3}}
            a.send_text(json.dumps({"t": "an", "an": "paul", "daten": {"hand": [1, 2]}}))
            assert naechste(b, "nachricht")["daten"] == {"hand": [1, 2]}
            a.send_text(json.dumps({"t": "an", "an": "alle", "daten": "hallo"}))
            assert naechste(b, "nachricht")["daten"] == "hallo"
            b.send_text("ping")
            assert b.receive_text() == "pong"


def test_host_geht_neuer_host_bekommt_den_stand(mp):
    with mp.verbinden(neu=1) as a:
        code = naechste(a, "raum")["raum"]["code"]
        with mp.verbinden("paul@example.com", raum=code) as b:
            naechste(b, "raum")
            b.send_text(json.dumps({"t": "stand", "daten": {"x": 1}}))
            assert naechste(b, "fehler")["text"].startswith("Nur der Host")
            a.send_text(json.dumps({"t": "stand", "daten": {"runde": 7}}))
            a.send_text(json.dumps({"t": "verlassen"}))
            assert naechste(b, "stand")["daten"] == {"runde": 7}
            assert naechste(b, "raum")["raum"]["host"] == "paul"


def test_kein_multiplayer_fremde_herkunft_unbekannter_raum(mp):
    with mp.verbinden(pfad="seb/solo", neu=1) as w:
        assert geschlossen(w) == 4004
    with mp.verbinden(herkunft="https://boese.example", neu=1) as w:
        assert geschlossen(w) == 4003
    with mp.verbinden(herkunft=None, neu=1) as w:
        assert geschlossen(w) == 4003
    with mp.verbinden(raum="ABCD") as w:
        assert geschlossen(w) == 4404
    with mp.verbinden("fremd@example.com", neu=1) as w:
        assert geschlossen(w) == 4403
    # Entwurf eines anderen: gibt es für paul nicht
    with mp.verbinden("paul@example.com", pfad="seb/vier~entwurf", neu=1) as w:
        assert geschlossen(w) == 4404


def test_rauswerfen_und_voller_raum(mp):
    with mp.verbinden(neu=1) as a:
        code = naechste(a, "raum")["raum"]["code"]
        with mp.verbinden("paul@example.com", raum=code) as b:
            naechste(b, "raum")                            # erst paul ganz drin, dann eli (sonst zufällige Reihenfolge)
            c = mp.verbinden("eli@example.com", raum=code).__enter__()
            rc = naechste(c, "raum")["raum"]
            assert rc["zuschauer"] is True                 # max 2 Spieler → eli schaut zu
            b.send_text(json.dumps({"t": "rauswerfen", "wer": "eli"}))
            assert naechste(b, "fehler")["text"].startswith("Rauswerfen darf nur der Host")
            a.send_text(json.dumps({"t": "rauswerfen", "wer": "eli"}))
            assert geschlossen(c) == 4001
        with mp.verbinden("eli@example.com", raum=code) as c2:
            assert geschlossen(c2) == 4001


def test_zweiter_tab_uebernimmt_den_platz(mp):
    with mp.verbinden(neu=1) as a:
        code = naechste(a, "raum")["raum"]["code"]
        with mp.verbinden("paul@example.com", raum=code) as b1:
            naechste(b1, "raum")
            with mp.verbinden("paul@example.com", raum=code) as b2:
                assert len(naechste(b2, "raum")["raum"]["spieler"]) == 2
                assert geschlossen(b1) == 4000


def test_entwurf_zwei_tabs_derselben_person(mp):
    with mp.verbinden(pfad="seb/vier~entwurf", neu=1, tab="tab-eins") as a:
        code = naechste(a, "raum")["raum"]["code"]
        with mp.verbinden(pfad="seb/vier~entwurf", raum=code, tab="tab-zwei") as b:
            raum = naechste(b, "raum")["raum"]
            assert [s["id"] for s in raum["spieler"]] == ["seb", "seb-2"] and raum["entwurf"] is True


def test_zu_grosse_nachricht(mp):
    with mp.verbinden(neu=1) as a:
        naechste(a, "raum")
        a.send_text(json.dumps({"t": "an", "daten": "x" * (70 * 1024)}))
        assert geschlossen(a) == 4009


def test_offene_raeume_und_einladen(mp, pid):
    with mp.verbinden(neu=1) as a:
        code = naechste(a, "raum")["raum"]["code"]
        r = mp.get("/api/mp/seb/vier/raeume", headers=mp.als("paul@example.com"))
        assert r.status_code == 200
        assert r.json()["raeume"][0]["code"] == code and r.json()["max"] == 2
        a.send_text(json.dumps({"t": "offen", "an": False}))
        naechste(a, "raum")
        assert mp.get("/api/mp/seb/vier/raeume", headers=mp.als("paul@example.com")).json()["raeume"] == []
        # Einladen über die Glocke – nur wer im Raum ist
        r = mp.post("/api/mp/seb/vier/einladen", headers=mp.als("paul@example.com"), json={"code": code, "an": ["eli"]})
        assert r.status_code == 404
        r = mp.post("/api/mp/seb/vier/einladen", headers=mp.als(), json={"code": code, "an": ["paul", "eli"]})
        assert r.status_code == 200 and r.json() == {"eingeladen": 2}
        glocke = mp.get("/api/meldungen", headers=mp.als("paul@example.com")).json()["liste"]
        assert glocke[0]["link"] == f"#/spiel/seb/vier?raum={code}" and "lädt dich zu „Vier“ ein" in glocke[0]["text"]
        r = mp.post("/api/mp/seb/vier/einladen", headers=mp.als(), json={"code": code, "an": ["niemand-da"]})
        assert r.status_code == 404
    assert mp.get("/api/mp/seb/solo/raeume", headers=mp.als()).status_code == 404


def test_spieleliste_zeigt_multiplayer(mp):
    spiele = {s["id"]: s for s in mp.get("/api/games", headers=mp.als()).json()}
    assert spiele["seb/vier"]["multiplayer"] == {"min": 2, "max": 2}
    assert spiele["seb/solo"]["multiplayer"] is None


def test_host_verliert_verbindung_nach_gnadenfrist_neuer_host(mp, monkeypatch):
    from savesvc import multiplayer
    monkeypatch.setattr(multiplayer, "HOST_GNADE", 0.05)
    with mp.verbinden("paul@example.com", neu=1) as a:
        code = naechste(a, "raum")["raum"]["code"]
        a.send_text(json.dumps({"t": "stand", "daten": [1, 2, 3]}))
        with mp.verbinden(raum=code) as b:
            naechste(b, "raum")
            a.close()
            raum = naechste(b, "raum")["raum"]        # paul getrennt, noch Host (Gnadenfrist)
            assert raum["host"] == "paul" and raum["spieler"][0]["verbunden"] is False
            assert naechste(b, "stand")["daten"] == [1, 2, 3]
            assert naechste(b, "raum")["raum"]["host"] == "seb"
            # paul kommt zurück: wieder dabei, aber nicht mehr Host
            with mp.verbinden("paul@example.com", raum=code) as a2:
                raum = naechste(a2, "raum")["raum"]
                assert raum["host"] == "seb" and raum["ich"] == "paul"


def test_mitspieler_zum_einladen(mp):
    mp.get("/api/me", headers=mp.als("paul@example.com"))     # eingeladen → aktiv bei der ersten Anmeldung
    liste = mp.get("/api/mp/mitspieler", headers=mp.als()).json()
    assert [x["id"] for x in liste] == ["eli", "max", "paul"]      # ohne einen selbst
