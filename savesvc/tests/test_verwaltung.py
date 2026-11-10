import json

import pytest

from savesvc import verwaltung

SEB, PAUL = "seb@example.com", "paul@example.com"


class FalscherUpload:
    """Ersatz für den Upload-Dienst."""
    def __init__(self):
        self.aufrufe = []
        self.konten = {"seb"}

    def __call__(self, methode, pfad, body=None):
        self.aufrufe.append((methode, pfad, body))
        if pfad == "/intern/entwickler" and methode == "GET":
            return [{"player": p, "angelegt": "2026-11-05"} for p in sorted(self.konten)]
        if pfad == "/intern/entwickler" and methode == "POST":
            self.konten.add(body["name"]); return {"name": body["name"], "passwort": "X" * 20}
        if pfad.endswith("/passwort"):
            return {"name": pfad.split("/")[3], "passwort": "Y" * 20}
        if pfad == "/intern/ereignisse":
            return [{"zeit": "2026-11-05T10:00:00+00:00", "player": "paul", "aktion": "hochgeladen", "ordner": "snake", "dateien": 3},
                    # 1.4.1: vom Admin ausgelöst – zählt nicht als Aktivität der Person
                    {"zeit": "2026-11-09T12:00:00+00:00", "player": "seb", "aktion": "neues Passwort"},
                    {"zeit": "2026-11-09T12:00:00+00:00", "player": "seb", "aktion": "Upload-Konto angelegt"}]
        return None


@pytest.fixture
def upload(monkeypatch):
    f = FalscherUpload()
    monkeypatch.setattr(verwaltung.UploadDienst, "__call__", lambda self, *a, **k: f(*a, **k))
    return f


def test_csrf_header_pflicht(client):
    ohne = {"Cf-Access-Jwt-Assertion": client.als()["Cf-Access-Jwt-Assertion"]}
    assert client.put("/api/save/seb/zaehler/x", json={"data": 1}, headers=ohne).status_code == 403
    assert client.get("/api/me", headers=ohne).status_code == 200      # lesen geht ohne


def test_me_admin(client):
    assert client.get("/api/me", headers=client.als()).json()["admin"] is True
    assert client.get("/api/me", headers=client.als(PAUL)).json()["admin"] is False


def test_einstellungen(client):
    assert client.get("/api/einstellungen", headers=client.als()).json()["sortierung"] == "alphabetisch"
    r = client.put("/api/einstellungen", json={"sortierung": "zuletzt", "favoriten": ["seb/zaehler"], "grossansicht": True}, headers=client.als())
    d = r.json(); d.pop("aussehen"); d.pop("startseite")   # neue UI, eigener Test: test_einstellungen_aussehen.py
    assert d == {"sortierung": "zuletzt", "favoriten": ["seb/zaehler"], "grossansicht": True, "bestenliste": True, "gesehen": {}}
    assert client.put("/api/einstellungen", json={"sortierung": "zufall"}, headers=client.als()).status_code == 422
    assert client.get("/api/einstellungen", headers=client.als(PAUL)).json()["favoriten"] == []   # je Spieler getrennt


def test_meine_spielstaende_zuruecksetzen(client):
    h = client.als()
    client.put("/api/save/seb/zaehler/a", json={"data": 1}, headers=h)
    client.put("/api/save/seb/zaehler/b", json={"data": 2}, headers=h)
    liste = client.get("/api/meine/spielstaende", headers=h).json()
    assert liste[0]["spiel"] == "seb/zaehler" and liste[0]["title"] == "Zähler" and {k["key"] for k in liste[0]["keys"]} == {"a", "b"}
    assert client.delete("/api/meine/spielstaende/seb/zaehler", headers=h).json() == {"geloescht": 2}
    assert client.get("/api/meine/spielstaende", headers=h).json() == []


def test_versteckte_spiele_nur_fuer_admin(client, upload):
    assert client.patch("/api/admin/spiele/paul/snake", json={"versteckt": True}, headers=client.als()).status_code == 200
    ids_paul = {s["id"] for s in client.get("/api/games", headers=client.als(PAUL)).json()}
    ids_seb = {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}
    assert "paul/snake" not in ids_paul and ids_seb["paul/snake"]["versteckt"] is True


def test_admin_nur_fuer_admins(client, upload):
    for pfad in ["/api/admin/uebersicht", "/api/admin/spiele", "/api/admin/personen", "/api/admin/antraege", "/api/admin/spielstaende"]:
        assert client.get(pfad, headers=client.als(PAUL)).status_code == 403
        assert client.get(pfad, headers=client.als()).status_code == 200, pfad


def test_entwickler_season(client, umgebung):
    # paul hat einen Spielordner → Entwickler; neue Season nur für eigene Spiele
    assert client.post("/api/entwickler/season/seb/zaehler", headers=client.als(PAUL)).status_code == 403
    assert client.post("/api/entwickler/season/paul/snake", headers=client.als(PAUL)).json() == {"season": 2}
    spiele = {s["ordner"] if "ordner" in s else s["id"]: s for s in client.get("/api/entwickler/spiele", headers=client.als(PAUL)).json()}
    assert spiele["paul/snake"]["leaderboardSeason"] == 2
    assert {s["id"] for s in client.get("/api/entwickler/spiele", headers=client.als(PAUL)).json()} == {"paul/snake", "paul/kaputt", "paul/ohne-index"}


def test_antraege(client, umgebung):
    (umgebung.users).write_text("seb@example.com: seb\npaul@example.com: paul\nmia@example.com: mia\n")
    # Spieler dürfen Anfragen stellen (z. B. Fehler melden), aber nicht die Entwickler-Arten
    assert client.post("/api/antraege", json={"art": "fehler", "text": "Spiel friert ein"}, headers=client.als("mia@example.com")).status_code == 201
    assert client.post("/api/antraege", json={"art": "bestenliste", "text": "Bitte leeren"}, headers=client.als("mia@example.com")).status_code == 422
    assert "bestenliste" not in client.get("/api/antraege/arten", headers=client.als("mia@example.com")).json()
    r = client.post("/api/antraege", json={"art": "wunsch", "spiel": "paul/snake", "text": "Bitte Gamepad-Unterstützung"}, headers=client.als(PAUL))
    assert r.status_code == 201
    aid = r.json()["id"]
    assert client.post("/api/antraege", json={"art": "quatsch", "text": "xxx"}, headers=client.als(PAUL)).status_code == 422
    alle = client.get("/api/admin/antraege", headers=client.als()).json()
    assert alle[0]["status"] == "offen" and alle[0]["artText"] == "Wunsch / Idee"
    assert client.patch(f"/api/admin/antraege/{aid}", json={"status": "erledigt", "antwort": "Ist drin!"}, headers=client.als()).status_code == 200
    mein = client.get("/api/antraege", headers=client.als(PAUL)).json()
    assert mein[0]["status"] == "erledigt" and mein[0]["antwort"] == "Ist drin!"


def test_person_einladen_sperren_archivieren(client, umgebung, upload):
    r = client.post("/api/admin/personen", json={"email": "Emil@Example.com", "name": "emil", "rollen": ["entwickler"]}, headers=client.als())
    assert r.status_code == 201 and r.json()["passwort"] == "X" * 20 and r.json()["person"]["status"] == "eingeladen"
    inhalt = umgebung.users.read_text()
    assert "emil@example.com: emil" in inhalt and "seb@example.com: seb" in inhalt          # Export für den Upload-Dienst
    assert client.get("/api/me", headers=client.als("emil@example.com")).json()["player"] == "emil"   # wirkt sofort
    assert client.get("/api/admin/personen/emil", headers=client.als()).json()["status"] == "aktiv"    # erste Anmeldung
    assert client.post("/api/admin/personen", json={"email": "x@y.de", "name": "emil"}, headers=client.als()).status_code == 409
    assert client.post("/api/admin/personen", json={"email": "kaputt", "name": "neu"}, headers=client.als()).status_code == 422
    assert client.post("/api/admin/personen", json={"email": "a@b.de", "name": "neu", "rollen": ["gott"]}, headers=client.als()).status_code == 422
    liste = {p["name"]: p for p in client.get("/api/admin/personen", headers=client.als()).json()["personen"]}
    assert liste["emil"]["uploadKonto"] is True and "admin" in liste["seb"]["rollen"] and liste["seb"]["notfallAdmin"] is True
    # Sperren wirkt sofort, auch beim Upload-Export; Admin nicht sperrbar
    assert client.post("/api/admin/personen/seb/sperren", json={"grund": "Test"}, headers=client.als()).status_code == 409
    assert client.post("/api/admin/personen/emil/sperren", json={"grund": "Spam in der Anfrage"}, headers=client.als()).status_code == 200
    r = client.get("/api/me", headers=client.als("emil@example.com"))
    assert r.status_code == 403 and "Konto gesperrt: Spam in der Anfrage" in r.json()["detail"]
    assert "emil" not in umgebung.users.read_text()
    assert client.post("/api/admin/personen/emil/entsperren", headers=client.als()).status_code == 200
    assert client.get("/api/me", headers=client.als("emil@example.com")).status_code == 200
    # Archivieren (Sebs Test 08.11.2026): kein Zugang, Upload-Konto weg, aber alle Daten bleiben – rückgängig zu machen
    client.post("/api/admin/personen/emil/notizen", json={"text": "kommt evtl. zurück"}, headers=client.als())
    assert client.post("/api/admin/personen/emil/archivieren", headers=client.als()).status_code == 200
    assert client.get("/api/me", headers=client.als("emil@example.com")).status_code == 403
    assert "emil" not in umgebung.users.read_text()
    assert ("DELETE", "/intern/entwickler/emil", None) in upload.aufrufe
    p = client.get("/api/admin/personen/emil", headers=client.als()).json()
    assert p["status"] == "archiviert" and p["emails"] == ["emil@example.com"] and "entwickler" in p["rollen"] and p["notizen"]
    assert client.post("/api/admin/personen/emil/archivieren", headers=client.als()).status_code == 409   # schon archiviert
    # Wiederherstellen: wieder aktiv, Entwickler bekommt ein neues Upload-Passwort
    upload.konten.discard("emil")
    r = client.post("/api/admin/personen/emil/wiederherstellen", headers=client.als())
    assert r.status_code == 200 and r.json()["person"]["status"] == "aktiv" and r.json()["passwort"] == "X" * 20
    assert client.get("/api/me", headers=client.als("emil@example.com")).status_code == 200
    # Endgültig löschen: nur aus „archiviert“ und nur mit Bestätigung, danach anonymisiert und nicht wiederherstellbar
    assert client.post("/api/admin/personen/emil/loeschen", json={"bestaetigung": "emil"}, headers=client.als()).status_code == 409
    client.post("/api/admin/personen/emil/archivieren", headers=client.als())
    assert client.post("/api/admin/personen/emil/loeschen", json={}, headers=client.als()).status_code == 422
    assert client.post("/api/admin/personen/emil/loeschen", json={"bestaetigung": "emil"}, headers=client.als()).status_code == 200
    p = client.get("/api/admin/personen/emil", headers=client.als()).json()
    assert p["status"] == "geloescht" and p["emails"] == [] and p["rollen"] == [] and not p["notizen"]
    assert "emil@example.com" not in json.dumps(p).lower() and "Spam in der Anfrage" not in json.dumps(p)   # auch nicht in Zeitleiste/Protokoll
    assert client.post("/api/admin/personen/emil/wiederherstellen", headers=client.als()).status_code == 409
    assert client.get("/api/me", headers=client.als("emil@example.com")).status_code == 403


def test_zuletzt_aktiv_auch_ohne_spielstand(client, upload):
    """Paul hat nur hochgeladen, Eli sich nur umgesehen – beide waren aktiv (06.11.2026)."""
    liste = {b["name"]: b for b in client.get("/api/admin/personen", headers=client.als()).json()["personen"]}
    assert liste["paul"]["zuletzt"] == "2026-11-05T10:00:00+00:00"          # aus Upload-Ereignis
    client.get("/api/me", headers=client.als(PAUL))                          # Anmeldung, jetzt
    liste = {b["name"]: b for b in client.get("/api/admin/personen", headers=client.als()).json()["personen"]}
    assert liste["paul"]["zuletzt"] > "2026-11-05T10:00:00+00:00"            # Anmeldung ist später


def test_admin_spielstand_verlauf_wiederherstellen(client):
    h = client.als(PAUL)
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 1}}, headers=h)
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 99}}, headers=h)
    liste = client.get("/api/admin/spielstaende?player=paul", headers=client.als()).json()
    assert liste[0]["key"] == "stand" and liste[0]["title"] == "Zähler"
    d = client.get("/api/admin/spielstand?player=paul&game=seb/zaehler&key=stand", headers=client.als()).json()
    assert d["aktuell"]["data"] == {"zahl": 99} and d["verlauf"][0]["data"] == {"zahl": 1}
    client.post("/api/admin/spielstand/wiederherstellen", json={"id": d["verlauf"][0]["id"]}, headers=client.als())
    assert client.get("/api/save/seb/zaehler/stand", headers=h).json()["data"] == {"zahl": 1}


def test_admin_scores_und_spiel_loeschen(client, upload, monkeypatch):
    import savesvc.app as appmod
    monkeypatch.setattr(appmod, "SCORE_ABSTAND", 0.0)
    client.post("/api/score/seb/zaehler", json={"score": 5}, headers=client.als(PAUL))
    scores = client.get("/api/admin/scores/seb/zaehler", headers=client.als()).json()
    assert scores[0]["player"] == "paul"
    assert client.delete(f"/api/admin/scores/{scores[0]['id']}", headers=client.als()).status_code == 204
    assert client.get("/api/leaderboard/seb/zaehler", headers=client.als()).json()["entries"] == []
    assert client.delete("/api/admin/spiele/paul/snake", headers=client.als()).status_code == 204
    assert ("DELETE", "/intern/spiele/paul/snake", None) in upload.aufrufe


def test_uebersicht(client, upload):
    d = client.get("/api/admin/uebersicht", headers=client.als()).json()
    assert d["spiele"] == 4 and d["spieler"] == 2 and d["uploads"][0]["aktion"] == "hochgeladen"


# ---------- „Ansicht als …“ ----------

def test_ansicht_als_spieler(client, upload):
    client.patch("/api/admin/spiele/paul/snake", json={"versteckt": True}, headers=client.als())
    h = {**client.als(), "X-Ansicht": "spieler"}
    me = client.get("/api/me", headers=h).json()
    assert isinstance(me.pop("sitzungBis"), int) and me.pop("probe") is False and me.pop("design") is False
    me.pop("anzeigename"); me.pop("namen")
    assert me.pop("konto") == "seb"
    assert me == {"player": "seb", "uploader": False, "admin": False, "ansicht": "spieler", "echterAdmin": True, "tester": False}
    assert "paul/snake" not in {s["id"] for s in client.get("/api/games", headers=h).json()}
    r = client.get("/api/admin/uebersicht", headers=h)
    assert r.status_code == 403 and "Ansicht als spieler" in r.text
    assert client.get("/api/entwickler/spiele", headers=h).status_code == 403
    assert client.get("/api/einstellungen", headers=h).status_code == 200      # eigenes Konto bleibt


def test_ansicht_als_entwickler(client):
    h = {**client.als(), "X-Ansicht": "entwickler"}
    me = client.get("/api/me", headers=h).json()
    assert me["admin"] is False and me["uploader"] is True and me["ansicht"] == "entwickler"
    assert client.get("/api/entwickler/spiele", headers=h).status_code == 200
    assert client.get("/api/admin/spiele", headers=h).status_code == 403


def test_ansicht_gibt_keine_rechte(client):
    # Ein Nicht-Admin kann sich mit dem Header nichts verschaffen – er wird ignoriert
    h = {**client.als(PAUL), "X-Ansicht": "entwickler"}
    assert client.get("/api/me", headers=h).json()["ansicht"] is None
    assert client.get("/api/admin/uebersicht", headers={**client.als(PAUL), "X-Ansicht": "admin"}).status_code == 403


def test_simulation_hat_eigenes_leeres_konto(client, monkeypatch):
    import savesvc.app as appmod
    monkeypatch.setattr(appmod, "SCORE_ABSTAND", 0.0)
    echt = client.als()
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 42}}, headers=echt)
    client.put("/api/einstellungen", json={"favoriten": ["seb/zaehler"]}, headers=echt)
    sim = {**echt, "X-Ansicht": "spieler"}
    assert client.get("/api/meine/spielstaende", headers=sim).json() == []
    assert client.get("/api/save/seb/zaehler/stand", headers=sim).status_code == 404
    assert client.get("/api/einstellungen", headers=sim).json()["favoriten"] == []
    # in der Simulation speichern geht – getrennt vom echten Stand
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 1}}, headers=sim)
    assert client.get("/api/save/seb/zaehler/stand", headers=echt).json()["data"] == {"zahl": 42}
    # Bestenliste und Anfragen werden in der Simulation nicht gespeichert
    assert client.post("/api/score/seb/zaehler", json={"score": 5}, headers=sim).status_code == 409
    assert client.post("/api/antraege", json={"art": "fehler", "text": "Test aus der Simulation"}, headers=sim).status_code == 409
    assert client.get("/api/antraege", headers=sim).json() == []


# ---------- Entwürfe (Bibliothek) und Fehlerberichte ----------

def entwurf_anlegen(umgebung, inhalt='{"title": "Snake 2.0", "saveVersion": 2}'):
    e = umgebung.spiele / "paul" / "snake~entwurf"
    e.mkdir()
    (e / "index.html").write_text("<!doctype html>")
    (e / "game.json").write_text(inhalt)


def test_entwurf_nur_fuer_besitzer_und_admin(client, umgebung):
    entwurf_anlegen(umgebung)
    mia = "mia@example.com"
    umgebung.users.write_text("seb@example.com: seb\npaul@example.com: paul\nmia@example.com: mia\n")
    assert client.get("/api/save/paul/snake~entwurf/x", headers=client.als(PAUL)).status_code == 404   # kein Stand, aber erlaubt
    assert client.put("/api/save/paul/snake~entwurf/x", json={"data": 1}, headers=client.als(PAUL)).status_code == 200
    assert client.put("/api/save/paul/snake~entwurf/x", json={"data": 1}, headers=client.als(mia)).status_code == 404
    assert client.put("/api/save/paul/snake~entwurf/x", json={"data": 1}, headers=client.als()).status_code == 200   # Admin
    assert "paul/snake~entwurf" not in {s["id"] for s in client.get("/api/games", headers=client.als()).json()}
    assert client.post("/api/score/paul/snake~entwurf", json={"score": 1}, headers=client.als(PAUL)).status_code in (409,)


def test_entwurf_starten_kopiert_spielstand_einmal(client, umgebung):
    entwurf_anlegen(umgebung)
    h = client.als(PAUL)
    client.put("/api/save/paul/snake/stand", json={"data": {"level": 4}}, headers=h)
    r = client.post("/api/entwickler/entwurf/paul/snake", headers=h).json()
    assert r["id"] == "paul/snake~entwurf" and r["title"] == "Snake 2.0" and r["saveVersion"] == 2 and r["spielstaendeKopiert"] == 1
    client.put("/api/save/paul/snake~entwurf/stand", json={"data": {"level": 9}}, headers=h)
    assert client.post("/api/entwickler/entwurf/paul/snake", headers=h).json()["spielstaendeKopiert"] == 0   # nicht überschrieben
    assert client.get("/api/save/paul/snake/stand", headers=h).json()["data"] == {"level": 4}   # echter Stand unberührt
    assert client.post("/api/entwickler/entwurf/paul/snake", headers=client.als("mia@example.com")).status_code in (403, 404)


def test_entwickler_spiele_mit_entwurf_und_fehlern(client, umgebung):
    entwurf_anlegen(umgebung)
    h = client.als(PAUL)
    ua = {"User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit Version/26 Safari/605"}
    for _ in range(3):
        client.post("/api/fehler/paul/snake", json={"meldung": "TypeError: x is undefined", "quelle": "spiel.js", "zeile": 112, "spalte": 5}, headers={**h, **ua})
    client.post("/api/fehler/paul/snake~entwurf", json={"meldung": "ReferenceError: y", "quelle": "neu.js", "zeile": 3}, headers=h)
    spiele = {s["id"]: s for s in client.get("/api/entwickler/spiele", headers=h).json()}
    assert spiele["paul/snake"]["entwurf"]["dateien"] == 2
    assert spiele["paul/snake"]["fehler"]["anzahl"] == 3 and spiele["paul/snake"]["fehler"]["arten"] == 1
    assert spiele["paul/snake"]["fehlerEntwurf"]["arten"] == 1
    liste = client.get("/api/entwickler/fehler", headers=h).json()
    eintrag = next(f for f in liste if f["quelle"] == "spiel.js")
    assert eintrag["anzahl"] == 3 and eintrag["browser"] == "Safari (Mac)" and eintrag["title"] == "snake"
    # andere Entwickler sehen fremde Fehler nicht und dürfen sie nicht löschen
    assert client.get("/api/entwickler/fehler", headers=client.als()).json() == [] or all(
        f["game"].startswith("seb/") for f in client.get("/api/entwickler/fehler", headers=client.als()).json())
    assert len(client.get("/api/entwickler/fehler?alle=true", headers=client.als()).json()) == 2   # Admin: alle
    assert client.delete(f"/api/entwickler/fehler/{eintrag['id']}", headers=h).status_code == 204
    assert all(f["id"] != eintrag["id"] for f in client.get("/api/entwickler/fehler", headers=h).json())


def test_fehlerbericht_ratelimit_und_kuerzen(client):
    h = client.als(PAUL)
    for i in range(30):
        client.post("/api/fehler/seb/zaehler", json={"meldung": f"Fehler {i}", "zeile": i}, headers=h)
    alle = client.get("/api/entwickler/fehler", headers=client.als()).json()
    assert len(alle) == 20                                           # höchstens 20 pro Minute
    client.post("/api/fehler/seb/zaehler", json={"meldung": "x" * 5000}, headers=client.als())
    assert max(len(f["meldung"]) for f in client.get("/api/entwickler/fehler", headers=client.als()).json()) <= 300


def test_fehler_der_bibliothek(client):
    """Zentrale 1.4.0: Fehler der Bibliotheksseite selbst – Nummer für den Spieler, sichtbar und löschbar nur für Admins."""
    h = client.als(PAUL)
    bericht = {"meldung": "TypeError: Cannot set properties of null (setting 'href')", "quelle": "/app.js", "zeile": 480,
               "spalte": 20, "stack": "at zeigeSpiel (app.js:480:20)", "seite": "#/spiel/seb/zaehler", "version": "1.4.0 abc1234"}
    nr = client.post("/api/fehler-zentrale", json=bericht, headers=h).json()["nr"]
    assert isinstance(nr, int)
    assert client.post("/api/fehler-zentrale", json=bericht, headers=h).json()["nr"] == nr      # gleicher Fehler → gleiche Nummer
    alle = client.get("/api/entwickler/fehler?alle=true", headers=client.als()).json()
    f = next(x for x in alle if x["id"] == nr)
    assert f["zentrale"] is True and f["anzahl"] == 2 and f["title"] == "Bibliothek (Zentrale)"
    assert f["stack"].startswith("Seite: #/spiel/seb/zaehler · Version: 1.4.0 abc1234")
    # Admin bekommt eine wichtige Meldung, Entwickler sehen den Bericht nicht und dürfen ihn nicht löschen
    assert any("Fehler in der Bibliothek" in m["text"] and m["wichtig"] for m in client.get("/api/meldungen", headers=client.als()).json()["liste"])
    assert all(x["game"] != "zentrale" for x in client.get("/api/entwickler/fehler", headers=h).json())
    assert client.delete(f"/api/entwickler/fehler/{nr}", headers=h).status_code == 404
    assert client.delete(f"/api/entwickler/fehler/{nr}", headers=client.als()).status_code == 204


# ---------- Daumen hoch und „gesehen“ (05.11.2026) ----------

def test_daumen(client):
    p = client.als(PAUL)
    assert client.put("/api/daumen/seb/zaehler", json={"an": True}, headers=p).json() == {"an": True, "daumen": 1}
    assert client.put("/api/daumen/seb/zaehler", json={"an": True}, headers=p).json()["daumen"] == 1   # doppelt zählt nicht
    spiele = {s["id"]: s for s in client.get("/api/games", headers=p).json()}
    assert spiele["seb/zaehler"]["daumen"] == 1 and spiele["seb/zaehler"]["meinDaumen"] is True
    assert {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}["seb/zaehler"]["meinDaumen"] is False
    assert {s["id"]: s for s in client.get("/api/admin/spiele", headers=client.als()).json()}["seb/zaehler"]["daumen"] == 1
    # eigenes Spiel, Simulation und ungültige Werte
    assert client.put("/api/daumen/seb/zaehler", json={"an": True}, headers=client.als()).status_code == 409
    assert client.put("/api/daumen/paul/snake", json={"an": True}, headers={**client.als(), "X-Ansicht": "spieler"}).status_code == 409
    assert client.put("/api/daumen/paul/snake", json={"an": "ja"}, headers=client.als()).status_code == 422
    assert client.put("/api/daumen/seb/zaehler", json={"an": False}, headers=p).json()["daumen"] == 0


def test_gesehen_wird_zusammengefuehrt(client):
    h = client.als()
    client.put("/api/einstellungen", json={"gesehen": {"seb/zaehler": "2026-11-05T10:00:00+00:00"}}, headers=h)
    d = client.put("/api/einstellungen", json={"gesehen": {"paul/snake": "2026-11-05T11:00:00+00:00"}}, headers=h).json()
    assert d["gesehen"] == {"seb/zaehler": "2026-11-05T10:00:00+00:00", "paul/snake": "2026-11-05T11:00:00+00:00"}
    assert client.put("/api/einstellungen", json={"gesehen": ["x"]}, headers=h).status_code == 422


def test_simulation_zaehlt_nicht_in_statistiken(client):
    # „Ansicht als …“ ist kein echter Spieler: weder in Meine Spiele noch im Admin-Panel mitzählen
    sim = {**client.als(), "X-Ansicht": "spieler"}
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 1}}, headers=sim)
    st = {s["id"]: s for s in client.get("/api/entwickler/spiele", headers=client.als()).json()}["seb/zaehler"]
    assert st["spieler"] == 0 and st["zuletzt"] is None
    assert {s["id"]: s for s in client.get("/api/admin/spiele", headers=client.als()).json()}["seb/zaehler"]["spieler"] == 0
    u = client.get("/api/admin/uebersicht", headers=client.als()).json()
    assert u["zaehler"]["saves"] == 0 and u["aktivitaet"] == []
    assert client.get("/api/admin/spielstaende", headers=client.als()).json() == []
    # echter Spieler zählt
    client.put("/api/save/seb/zaehler/stand", json={"data": {"zahl": 2}}, headers=client.als(PAUL))
    assert {s["id"]: s for s in client.get("/api/admin/spiele", headers=client.als()).json()}["seb/zaehler"]["spieler"] == 1


# ---------- Versionierung: interne Schnittstelle, Testergebnisse, Rollback (E35–E37) ----------

@pytest.fixture
def iclient(umgebung, rsa_schluessel, token):
    from fastapi.testclient import TestClient
    from savesvc.app import erstellen
    from savesvc.config import Einstellungen
    from .conftest import AUD, TEAM, Schluessel
    e = Einstellungen(team_domain=TEAM, audience=AUD, users_file=umgebung.users, spiele_dir=umgebung.spiele,
                      db_path=umgebung.db, dev_user=None, intern_token="geheim")
    c = TestClient(erstellen(e, schluessel_quelle=Schluessel(rsa_schluessel.public_key())))
    c.als = lambda email=SEB, **kw: {"Cf-Access-Jwt-Assertion": token(email=email, **kw), "X-Bibliothek": "1"}
    return c


T = {"X-Intern-Token": "geheim"}


def test_intern_nur_mit_token(iclient):
    assert iclient.get("/intern/entwurf/paul/snake?seit=2000-01-01").status_code == 403
    assert iclient.get("/intern/entwurf/paul/snake?seit=2000-01-01", headers={"X-Intern-Token": "falsch"}).status_code == 403
    assert iclient.get("/intern/entwurf/paul/snake?seit=2000-01-01", headers=T).status_code == 200


def test_entwurf_testergebnisse(iclient, umgebung):
    entwurf_anlegen(umgebung, '{"title": "Snake 2", "saveVersion": 2}')
    p = iclient.als(PAUL)
    assert iclient.post("/api/entwickler/entwurf/paul/snake", headers=p).status_code == 200
    r = iclient.post("/api/entwickler/migration/paul/snake~entwurf", json={"key": "stand", "von": 1, "nach": 2, "ok": True}, headers=p)
    assert r.status_code == 204
    iclient.post("/api/entwickler/migration/paul/snake~entwurf", json={"key": "x", "von": 1, "nach": 2, "ok": False, "fehler": "TypeError"}, headers=p)
    d = iclient.get("/intern/entwurf/paul/snake?seit=2000-01-01", headers=T).json()
    assert d["geoeffnet"] and d["migrationOk"] == 1 and "TypeError" in d["migrationFehler"][0]
    # nur für Entwürfe und nur der Entwickler selbst (oder Admin)
    assert iclient.post("/api/entwickler/migration/paul/snake", json={"ok": True}, headers=p).status_code == 404
    assert iclient.post("/api/entwickler/migration/paul/snake~entwurf", json={"ok": True}, headers=iclient.als("emil@example.com")).status_code in (403, 404)
    # neuer Entwurf → Tests und Test-Spielstände weg
    iclient.put("/api/save/paul/snake~entwurf/stand", json={"data": 1}, headers=p)
    assert iclient.post("/intern/entwurf/paul/snake/zuruecksetzen", headers=T).status_code == 204
    assert iclient.get("/intern/entwurf/paul/snake?seit=2000-01-01", headers=T).json()["geoeffnet"] is False
    assert iclient.get("/api/save/paul/snake~entwurf/stand", headers=p).status_code == 404


def test_umwandlung_wird_dauerhaft_gesichert_und_zurueckgeholt(iclient, umgebung):
    p = iclient.als(PAUL)
    ordner = umgebung.spiele / "seb" / "zaehler"
    (ordner / "game.json").write_text('{"saveVersion": 1}')
    iclient.put("/api/save/seb/zaehler/stand", json={"data": {"alt": 1}}, headers=p)
    (ordner / "game.json").write_text('{"saveVersion": 2}')
    for i in range(10):     # mehr Speicherungen als der Verlauf (5) aufhebt
        iclient.put("/api/save/seb/zaehler/stand", json={"data": {"neu": i}}, headers=p)
    r = iclient.post("/intern/spielstaende-zurueck/seb/zaehler", json={"bisSaveVersion": 1}, headers=T).json()
    assert r == {"zurueckgeholt": 1, "ohneAltenStand": 0}
    d = iclient.get("/api/save/seb/zaehler/stand", headers=p).json()
    assert d["data"] == {"alt": 1} and d["version"] == 1
    assert iclient.post("/intern/spielstaende-zurueck/seb/zaehler", json={"bisSaveVersion": 0}, headers=T).status_code == 422


def test_intern_season_und_versionsverlauf(iclient, umgebung):
    assert iclient.post("/intern/season/seb/zaehler", headers=T).json() == {"season": 2}
    from savesvc import release
    basis = umgebung.spiele / "seb"
    release.aenderung_merken(basis, "zaehler", "Neu: Knopf", "seb")
    release.veroeffentlicht(basis, "zaehler", "1.0.0", "major", 1, ["Erste Version"], "seb")
    d = iclient.get("/api/versionen/seb/zaehler", headers=iclient.als()).json()
    assert d["aktuell"] == "1.0.0" and d["releases"][0]["aenderungen"] == ["Erste Version"]
    spiel = {s["id"]: s for s in iclient.get("/api/games", headers=iclient.als()).json()}["seb/zaehler"]
    assert spiel["version"] == "1.0.0" and spiel["neu"]["aenderungen"] == ["Erste Version"]


def test_testspiel_nie_in_der_uebersicht_fuer_andere(client):
    assert client.patch("/api/admin/spiele/paul/snake", json={"testspiel": True}, headers=client.als()).status_code == 200
    assert "paul/snake" not in {s["id"] for s in client.get("/api/games", headers=client.als(PAUL)).json()}
    admin = {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}
    assert admin["paul/snake"]["testspiel"] is True          # Admin bekommt es (zum Öffnen), die Seite zeigt es nicht als Kachel
    assert {s["id"]: s for s in client.get("/api/admin/spiele", headers=client.als()).json()}["paul/snake"]["testspiel"] is True
    sim = {**client.als(), "X-Ansicht": "spieler"}
    assert "paul/snake" not in {s["id"] for s in client.get("/api/games", headers=sim).json()}


def test_uebersicht_zaehlt_testspiele_getrennt(client, upload):
    client.patch("/api/admin/spiele/paul/snake", json={"testspiel": True}, headers=client.als())
    d = client.get("/api/admin/uebersicht", headers=client.als()).json()
    assert d["spiele"] == 3 and d["testspiele"] == 1


def test_entwickler_nimmt_spiel_offline(client):
    p = client.als(PAUL)
    r = client.put("/api/entwickler/offline/paul/snake", json={"offline": True, "grund": "  zu viele   Fehler "}, headers=p)
    assert r.json() == {"offline": True, "grund": "zu viele Fehler"}
    # andere Spieler sehen es nicht, der Entwickler selbst und Admins schon
    assert "paul/snake" not in {s["id"] for s in client.get("/api/games", headers={**client.als(), "X-Ansicht": "spieler"}).json()}
    # auch der Autor selbst sieht es in „Ansicht als Spieler“ nicht (Simulation = Sicht eines anderen Spielers)
    client.put("/api/entwickler/offline/seb/zaehler", json={"offline": True}, headers=client.als())
    assert "seb/zaehler" not in {s["id"] for s in client.get("/api/games", headers={**client.als(), "X-Ansicht": "spieler"}).json()}
    eigen = {s["id"]: s for s in client.get("/api/games", headers=p).json()}["paul/snake"]
    assert eigen["offline"] is True and eigen["offlineGrund"] == "zu viele Fehler"
    assert {s["id"]: s for s in client.get("/api/games", headers=client.als()).json()}["paul/snake"]["offline"] is True
    assert {s["id"]: s for s in client.get("/api/entwickler/spiele", headers=p).json()}["paul/snake"]["offline"] is True
    # fremdes Spiel: nein (außer Admin)
    assert client.put("/api/entwickler/offline/seb/zaehler", json={"offline": True}, headers=p).status_code == 403
    assert client.put("/api/entwickler/offline/paul/snake", json={"offline": False}, headers=client.als()).json()["offline"] is False
    assert "paul/snake" in {s["id"] for s in client.get("/api/games", headers={**client.als(), "X-Ansicht": "spieler"}).json()}


def test_testspiele_nicht_in_meine_spiele(client):
    client.patch("/api/admin/spiele/seb/zaehler", json={"testspiel": True}, headers=client.als())
    assert "seb/zaehler" not in {s["id"] for s in client.get("/api/entwickler/spiele", headers=client.als()).json()}


def test_simulation_startet_leer(client):
    sim = {**client.als(), "X-Ansicht": "spieler"}
    client.put("/api/save/seb/zaehler/stand", json={"data": 1}, headers=sim)
    client.put("/api/einstellungen", json={"sortierung": "neu"}, headers=sim)
    echt = client.als()
    client.put("/api/save/seb/zaehler/stand", json={"data": 42}, headers=echt)
    assert client.post("/api/admin/ansicht/spieler/zuruecksetzen", headers=echt).json() == {"geloescht": 1}
    assert client.get("/api/save/seb/zaehler/stand", headers=sim).status_code == 404
    assert client.get("/api/einstellungen", headers=sim).json()["sortierung"] == "alphabetisch"
    assert client.get("/api/save/seb/zaehler/stand", headers=echt).json()["data"] == 42     # echtes Konto unberührt
    assert client.post("/api/admin/ansicht/admin/zuruecksetzen", headers=echt).status_code == 422
    assert client.post("/api/admin/ansicht/spieler/zuruecksetzen", headers=client.als(PAUL)).status_code == 403
    assert client.post("/api/admin/ansicht/spieler/zuruecksetzen", headers=sim).status_code == 403   # aus der Simulation heraus nicht


# ---------- Not-Aus (Zentrale 1.4.0, E72) ----------

def test_notaus(client, umgebung):
    from savesvc import notaus
    from savesvc.db import Datenbank
    p = client.als(PAUL)
    assert client.post("/api/admin/notaus", json={"bestaetigung": "NOT-AUS"}, headers=p).status_code == 403          # nur Admins
    assert client.post("/api/admin/notaus", json={"bestaetigung": "ja"}, headers=client.als()).status_code == 422     # Bestätigung nötig
    assert client.post("/api/admin/notaus", json={"bestaetigung": "NOT-AUS"},
                       headers={**client.als(), "X-Ansicht": "spieler"}).status_code == 403                          # nicht in „Ansicht als …“
    assert client.get("/api/me", headers=p).status_code == 200
    r = client.post("/api/admin/notaus", json={"bestaetigung": "NOT-AUS", "grund": "Verdacht auf Datenleck"}, headers=client.als())
    assert r.status_code == 200 and "deploy.sh --notaus-aus" in r.json()["hinweis"]
    # ab sofort: keine Antwort mit Daten mehr – für niemanden, auch nicht für Admins oder intern
    for pfad in ("/api/me", "/api/games", "/api/admin/uebersicht", "/api/admin/sicherheit", "/intern/gesund"):
        assert client.get(pfad, headers=client.als()).status_code == 503, pfad
    assert client.post("/api/admin/notaus", json={"bestaetigung": "NOT-AUS"}, headers=client.als()).status_code == 503
    # Ausschalten nur von außen (CLI vom Mac), danach geht alles wieder; beides steht im Sicherheitsprotokoll
    db = Datenbank(umgebung.db)
    assert notaus.ausschalten(umgebung.users.parent, db, "mac") is True
    assert client.get("/api/me", headers=p).status_code == 200
    liste = client.get("/api/admin/sicherheit", headers=client.als()).json()
    assert [x["art"] for x in liste[:2]] == ["notaus-aus", "notaus-ein"]
    assert liste[1]["wer"] == "seb" and liste[1]["text"] == "Verdacht auf Datenleck"
    assert client.get("/api/admin/sicherheit", headers=p).status_code == 403


def test_notaus_unlesbare_datei_gilt_als_an(tmp_path):
    from savesvc import notaus
    (tmp_path / "notaus.json").write_text("kaputt")
    assert notaus.aktiv(tmp_path) is not None
    assert notaus.aktiv(tmp_path / "gibtsnicht") is None
