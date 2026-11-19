"""MCP-Server (Zentrale 1.6.0, E88): Schlüssel für Claude Code, OAuth für die Claude-App, Werkzeuge, Hinweis bei anderen KIs."""

import base64
import hashlib
import json
import secrets
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from .test_upload import FalscherSpeicher, anmelden, uclient  # noqa: F401  (Fixture)

HANDBUCH = Path(__file__).resolve().parents[2] / "site" / "handbuch"


@pytest.fixture
def mc(monkeypatch, request):
    monkeypatch.setenv("MCP_HANDBUCH", str(HANDBUCH))
    monkeypatch.setenv("MCP_URL", "https://mcp.example")
    monkeypatch.setenv("UPLOAD_OEFFENTLICH", "https://upload.example")
    monkeypatch.setenv("GAMES_OEFFENTLICH", "https://games.example")
    c = request.getfixturevalue("uclient")
    c.store.setzen("paul", "richtiges-passwort-123")
    assert anmelden(c).status_code == 204
    return c


def schluessel(c) -> str:
    r = c.post("/api/upload/mcp/zugaenge", json={"name": "Laptop"}, headers=c.als())
    assert r.status_code == 201, r.text
    assert r.json()["befehl"].startswith("claude mcp add --transport http spielebibliothek https://mcp.example/mcp")
    return r.json()["schluessel"]


def rpc(c, token, methode, params=None, sitzung=None, nr=1):
    kopf = {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream"}
    if sitzung:
        kopf["Mcp-Session-Id"] = sitzung
    return c.post("/mcp", json={"jsonrpc": "2.0", "id": nr, "method": methode, "params": params or {}}, headers=kopf)


def werkzeug(c, token, name, sitzung=None, **argumente):
    r = rpc(c, token, "tools/call", {"name": name, "arguments": argumente}, sitzung)
    assert r.status_code == 200, r.text
    return r.json()["result"]


def starten(c, token, client="claude-code"):
    r = rpc(c, token, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": client, "version": "1"}})
    assert r.status_code == 200
    return r.json()["result"], r.headers["mcp-session-id"]


def test_ohne_schluessel_401_mit_hinweis_auf_oauth(mc):
    r = mc.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    assert 'resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' in r.headers["www-authenticate"]
    assert rpc(mc, "sbk_falsch", "tools/list").status_code == 401
    meta = mc.get("/.well-known/oauth-authorization-server").json()
    assert meta["authorization_endpoint"] == "https://upload.example/upload/mcp-freigabe.html"
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert mc.get("/.well-known/oauth-protected-resource").json()["resource"] == "https://mcp.example/mcp"


def test_claude_code_schluessel_und_werkzeuge(mc, umgebung):
    t = schluessel(mc)
    info, s = starten(mc, t)
    assert info["serverInfo"]["name"] == "spielebibliothek" and "Hinweis" not in info["instructions"]
    namen = [w["name"] for w in rpc(mc, t, "tools/list", sitzung=s).json()["result"]["tools"]]
    assert namen == ["handbuch", "vorlage", "meine_spiele", "dateien", "hochladen", "pruefung", "fehlerberichte"]
    # notifications/initialized → 202 ohne Inhalt
    r = mc.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 202

    inhalt = werkzeug(mc, t, "handbuch", s)["content"][0]["text"]
    assert "multiplayer:" in inhalt and "gamesave:" in inhalt
    mp = werkzeug(mc, t, "handbuch", s, kapitel="multiplayer")["content"][0]["text"]
    assert "GameSave.multiplayer" in mp
    vorlage = werkzeug(mc, t, "vorlage", s, art="multiplayer")["content"][0]["text"]
    assert "===== index.html =====" in vorlage and "multiplayer" in vorlage

    erg = werkzeug(mc, t, "hochladen", s, ordner="karten", aenderung="Erste Version",
                   dateien=[{"pfad": "index.html", "inhalt": "<!doctype html><script src=\"/lib/gamesave.js\"></script>"},
                            {"pfad": "game.json", "inhalt": json.dumps({"title": "Karten", "multiplayer": {"min": 2, "max": 6}})},
                            {"pfad": "bild.png", "inhalt": base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 20).decode(), "base64": True}])
    assert erg["isError"] is False
    d = json.loads(erg["content"][0]["text"])
    assert d["dateien"] == 3 and d["testen"] == "https://games.example/#/entwurf/paul/karten"
    assert d["veroeffentlichen"] == "https://upload.example/#spiel-karten"
    assert (umgebung.spiele / "paul" / "karten~entwurf" / "bild.png").is_file()
    assert not (umgebung.spiele / "paul" / "karten").exists()          # nie direkt live
    assert mc.store.ereignisse(5, "paul")[0]["aktion"] == "als Entwurf hochgeladen (über Claude)"

    # ergänzen: nur eine Datei ändern, eine löschen
    erg = werkzeug(mc, t, "hochladen", s, ordner="karten", aenderung="Neues Bild", modus="ergaenzen", loeschen=["bild.png"],
                   dateien=[{"pfad": "./regeln.txt", "inhalt": "Regeln"}])
    assert erg["isError"] is False
    liste = json.loads(werkzeug(mc, t, "dateien", s, ordner="karten")["content"][0]["text"])
    assert sorted(x["pfad"] for x in liste) == ["game.json", "index.html", "regeln.txt"]
    assert werkzeug(mc, t, "dateien", s, ordner="karten", pfad="regeln.txt")["content"][0]["text"] == "Regeln"

    spiele = {x["ordner"]: x for x in json.loads(werkzeug(mc, t, "meine_spiele", s)["content"][0]["text"])}
    assert spiele["karten"]["entwurf"] is True and spiele["karten"]["veroeffentlicht"] is False and spiele["snake"]["veroeffentlicht"] is True
    pr = json.loads(werkzeug(mc, t, "pruefung", s, ordner="karten")["content"][0]["text"])
    assert pr["erstveroeffentlichung"] is True and pr["testen"].endswith("/karten")
    assert werkzeug(mc, t, "fehlerberichte", s)["content"][0]["text"] == "Keine Fehlerberichte."
    assert ("GET", "/intern/fehler/paul", None) in mc.speicher.aufrufe


def test_hochladen_prueft_pfade_und_index(mc):
    t = schluessel(mc)
    _, s = starten(mc, t)
    for dateien, text in [([{"pfad": "../boese.html", "inhalt": "x"}, {"pfad": "index.html", "inhalt": "x"}], "Ungültiger Pfad"),
                          ([{"pfad": "spiel.html", "inhalt": "x"}], "index.html fehlt"),
                          ([{"pfad": "index.html", "inhalt": "%%%", "base64": True}], "base64")]:
        erg = werkzeug(mc, t, "hochladen", s, ordner="x", aenderung="a", dateien=dateien)
        assert erg["isError"] is True and text in erg["content"][0]["text"], erg
    erg = werkzeug(mc, t, "hochladen", s, ordner="../seb", aenderung="a", dateien=[{"pfad": "index.html", "inhalt": "x"}])
    assert erg["isError"] is True
    erg = werkzeug(mc, t, "dateien", s, ordner="gibts-nicht")
    assert erg["isError"] is True


def test_andere_ki_bekommt_hinweis(mc):
    t = schluessel(mc)
    info, s = starten(mc, t, client="ChatGPT")
    assert info["instructions"].startswith("Hinweis: Die Spielebibliothek ist für Claude gebaut")
    erg = werkzeug(mc, t, "meine_spiele", s)
    assert erg["content"][0]["text"].startswith("Hinweis:") and "snake" in erg["content"][1]["text"]


def test_widerrufen_und_konto_geloescht(mc):
    t = schluessel(mc)
    zugaenge = mc.get("/api/upload/mcp/zugaenge", headers=mc.als()).json()["zugaenge"]
    assert [z["name"] for z in zugaenge] == ["Laptop"]
    assert mc.delete(f"/api/upload/mcp/zugaenge/{zugaenge[0]['id']}", headers=mc.als()).status_code == 204
    assert rpc(mc, t, "tools/list").status_code == 401
    t2 = schluessel(mc)
    assert rpc(mc, t2, "tools/list").status_code == 200
    mc.store.loeschen("paul")                     # ohne Upload-Konto gilt kein Schlüssel
    assert rpc(mc, t2, "tools/list").status_code == 401


def test_oauth_fuer_die_claude_app(mc):
    r = mc.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]})
    assert r.status_code == 201
    cid = r.json()["client_id"]
    assert mc.post("/oauth/register", json={"redirect_uris": ["http://boese.example/cb"]}).status_code == 400
    ziel = "https://claude.ai/api/mcp/auth_callback"
    assert mc.get(f"/api/upload/mcp/anfrage?client_id={cid}&redirect_uri={ziel}", headers=mc.als()).json() == {"name": "Claude", "ziel": "claude.ai"}
    assert mc.get(f"/api/upload/mcp/anfrage?client_id={cid}&redirect_uri=https://boese.example/cb", headers=mc.als()).status_code == 400

    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    # Ablehnen
    r = mc.post("/api/upload/mcp/freigeben", headers=mc.als(), json={"client_id": cid, "redirect_uri": ziel, "state": "s1", "erlauben": False})
    assert parse_qs(urlsplit(r.json()["weiter"]).query) == {"error": ["access_denied"], "state": ["s1"]}
    # Erlauben – nur mit Upload-Passwort (Cookie)
    body = {"client_id": cid, "redirect_uri": ziel, "state": "s2", "code_challenge": challenge, "code_challenge_method": "S256", "erlauben": True}
    mc.cookies.clear()
    assert mc.post("/api/upload/mcp/freigeben", headers=mc.als(), json=body).status_code == 401
    anmelden(mc)
    q = parse_qs(urlsplit(mc.post("/api/upload/mcp/freigeben", headers=mc.als(), json=body).json()["weiter"]).query)
    assert q["state"] == ["s2"] and q["iss"] == ["https://mcp.example"]
    code = q["code"][0]

    falsch = mc.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": ziel, "client_id": cid,
                                           "code_verifier": "falsch" * 8})
    assert falsch.status_code == 400 and falsch.json()["error"] == "invalid_grant"
    # Code ist nach einem Versuch verbraucht → neu holen
    code = parse_qs(urlsplit(mc.post("/api/upload/mcp/freigeben", headers=mc.als(), json=body).json()["weiter"]).query)["code"][0]
    r = mc.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": ziel, "client_id": cid, "code_verifier": verifier})
    assert r.status_code == 200, r.text
    tok = r.json()
    assert tok["token_type"] == "Bearer" and tok["expires_in"] == 3600
    assert rpc(mc, tok["access_token"], "tools/list").status_code == 200
    assert mc.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": ziel, "client_id": cid,
                                         "code_verifier": verifier}).status_code == 400     # zweimal geht nicht

    neu = mc.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid}).json()
    assert rpc(mc, neu["access_token"], "tools/list").status_code == 200
    assert rpc(mc, tok["access_token"], "tools/list").status_code == 401                    # altes Token ersetzt
    assert mc.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid}).status_code == 400
    namen = [z["name"] for z in mc.get("/api/upload/mcp/zugaenge", headers=mc.als()).json()["zugaenge"]]
    assert namen == ["Claude"]


def _users(umgebung, text):
    import os
    import time
    umgebung.users.write_text(text)
    t = time.time() + 5
    os.utime(umgebung.users, (t, t))          # neue Änderungszeit, damit die Liste sicher neu gelesen wird


def test_gesperrte_person_verliert_den_ki_zugang(mc, request):
    """1.6.2: Vor /mcp steht kein Cloudflare Access – eine Sperre im CRM (Person fehlt in users.yaml) muss trotzdem greifen."""
    umgebung = request.getfixturevalue("umgebung")
    vorher = umgebung.users.read_text()
    t = schluessel(mc)
    assert rpc(mc, t, "tools/list").status_code == 200
    _users(umgebung, "seb@example.com: seb\n")                         # paul gesperrt → nicht mehr im Export
    assert rpc(mc, t, "tools/list").status_code == 401
    _users(umgebung, vorher)                                          # Sperre aufgehoben → Schlüssel gilt wieder
    assert rpc(mc, t, "tools/list").status_code == 200


def test_gesperrte_person_bekommt_kein_neues_token(mc, request):
    umgebung = request.getfixturevalue("umgebung")
    vorher = umgebung.users.read_text()
    ziel = "https://claude.ai/api/mcp/auth_callback"
    cid = mc.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": [ziel]}).json()["client_id"]
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    body = {"client_id": cid, "redirect_uri": ziel, "state": "s", "code_challenge": challenge, "code_challenge_method": "S256", "erlauben": True}
    code = parse_qs(urlsplit(mc.post("/api/upload/mcp/freigeben", headers=mc.als(), json=body).json()["weiter"]).query)["code"][0]
    tok = mc.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": ziel, "client_id": cid,
                                        "code_verifier": verifier}).json()
    _users(umgebung, "seb@example.com: seb\n")
    r = mc.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    _users(umgebung, vorher)


@pytest.mark.parametrize("uri, ok", [
    ("https://claude.ai/api/mcp/auth_callback", True),
    ("https://claude.com/api/mcp/auth_callback", True),
    ("http://localhost:33418/callback", True),
    ("http://127.0.0.1:9/rueckweg", True),
    ("https://boese.example/api/mcp/auth_callback", False),
    ("https://claude.ai/anderer/pfad", False),
    ("https://claude.ai.boese.example/api/mcp/auth_callback", False),
    ("https://nutzer@claude.ai/api/mcp/auth_callback", False),
    ("https://claude.ai:8443/api/mcp/auth_callback", False),
    ("http://claude.ai/api/mcp/auth_callback", False),
])
def test_nur_ruecksprung_adressen_von_claude(mc, uri, ok):
    r = mc.post("/oauth/register", json={"client_name": "x", "redirect_uris": [uri]})
    assert (r.status_code == 201) == ok, (uri, r.status_code)


def test_registrierungen_je_ip_begrenzt(mc):
    from savesvc import mcp
    for _ in range(mcp.CLIENTS_PRO_IP):
        assert mc.post("/oauth/register", json={"redirect_uris": ["http://localhost:1/cb"]}, headers={"Cf-Connecting-Ip": "203.0.113.1"}).status_code == 201
    assert mc.post("/oauth/register", json={"redirect_uris": ["http://localhost:1/cb"]}, headers={"Cf-Connecting-Ip": "203.0.113.1"}).status_code == 429
    # Eine andere Adresse ist davon nicht betroffen
    assert mc.post("/oauth/register", json={"redirect_uris": ["http://localhost:1/cb"]}, headers={"Cf-Connecting-Ip": "203.0.113.2"}).status_code == 201
