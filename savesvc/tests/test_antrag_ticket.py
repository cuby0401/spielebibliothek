"""Zentrale 1.3.1: Eine Anfrage als „Ticket“ (aus der Glocke öffnen) und Bilder an Anfragen."""
import base64

SEB, PAUL, MIA = "seb@example.com", "paul@example.com", "mia@example.com"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
url = lambda daten, art="png": f"data:image/{art};base64," + base64.b64encode(daten).decode()


def mit_mia(umgebung):
    umgebung.users.write_text("seb@example.com: seb\npaul@example.com: paul\nmia@example.com: mia\n")


def test_ticket_sichtbarkeit_und_link_in_der_glocke(client, umgebung):
    mit_mia(umgebung)
    r = client.post("/api/antraege", json={"art": "fehler", "spiel": "paul/snake", "text": "Maus bewegt Spieler"}, headers=client.als(MIA))
    assert r.status_code == 201
    aid = r.json()["id"]
    assert client.post(f"/api/antraege/{aid}/bilder", json={"bild": url(PNG)}, headers=client.als(MIA)).status_code == 201
    # Glocke beim Entwickler verlinkt direkt auf die Anfrage
    assert client.get("/api/meldungen", headers=client.als(PAUL)).json()["liste"][0]["link"] == f"/#/antrag/{aid}"
    # Absender, Entwickler und Admin sehen ihn – andere nicht
    for wer, antworten in ((MIA, False), (PAUL, True), (SEB, False)):
        t = client.get(f"/api/antraege/{aid}", headers=client.als(wer))
        assert t.status_code == 200 and t.json()["darfAntworten"] is antworten, wer
    t = client.get(f"/api/antraege/{aid}", headers=client.als(MIA)).json()
    assert t["eigener"] is True and len(t["bilder"]) == 1 and t["bilder"][0]["von"] == "mia"
    umgebung.users.write_text(umgebung.users.read_text() + "lea@example.com: lea\n")
    assert client.get(f"/api/antraege/{aid}", headers=client.als("lea@example.com")).status_code == 404
    assert client.get(f"/api/antraege/{aid}/bilder/{t['bilder'][0]['id']}", headers=client.als("lea@example.com")).status_code == 404
    # Bild ausliefern: richtige Art, nosniff, Sandbox
    b = client.get(f"/api/antraege/{aid}/bilder/{t['bilder'][0]['id']}", headers=client.als(PAUL))
    assert b.status_code == 200 and b.content == PNG and b.headers["content-type"] == "image/png"
    assert b.headers["x-content-type-options"] == "nosniff" and "sandbox" in b.headers["content-security-policy"]
    # Antworten über das Ticket: nur der Zuständige (Admin bei Spiel-Anfragen nicht)
    assert client.patch(f"/api/antraege/{aid}", json={"status": "erledigt"}, headers=client.als(MIA)).status_code == 403
    assert client.patch(f"/api/antraege/{aid}", json={"status": "erledigt"}, headers=client.als(SEB)).status_code == 403
    assert client.patch(f"/api/antraege/{aid}", json={"status": "erledigt", "antwort": "Behoben"}, headers=client.als(PAUL)).status_code == 200
    m = client.get("/api/meldungen", headers=client.als(MIA)).json()["liste"][0]
    assert "Behoben" in m["text"] and m["link"] == f"/#/antrag/{aid}"
    # Liste zeigt die Zahl der Bilder
    assert client.get("/api/antraege", headers=client.als(MIA)).json()[0]["bilder"] == 1


def test_admin_antrag_ticket(client, umgebung):
    mit_mia(umgebung)
    aid = client.post("/api/antraege", json={"art": "fehler", "text": "Zurück-Knopf im Entwurf"}, headers=client.als(MIA)).json()["id"]
    assert client.get("/api/meldungen", headers=client.als()).json()["liste"][0]["link"] == f"/#/antrag/{aid}"
    assert client.get(f"/api/antraege/{aid}", headers=client.als()).json()["darfAntworten"] is True
    assert client.get(f"/api/antraege/{aid}", headers=client.als(PAUL)).status_code == 404
    assert client.patch(f"/api/antraege/{aid}", json={"status": "erledigt"}, headers=client.als()).status_code == 200


def test_bilder_pruefen(client, umgebung):
    mit_mia(umgebung)
    h = client.als(MIA)
    aid = client.post("/api/antraege", json={"art": "fehler", "text": "xxx"}, headers=h).json()["id"]
    # kein Bild / SVG / GIF / zu groß → abgelehnt
    for falsch in (url(b"<svg onload=alert(1)>", "svg"), "kein bild", url(b"GIF89a...."), 123,
                   url(b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024))):
        assert client.post(f"/api/antraege/{aid}/bilder", json={"bild": falsch}, headers=h).status_code == 422
    riesig = client.post(f"/api/antraege/{aid}/bilder", json={"bild": url(b"\x89PNG\r\n\x1a\n" + b"\x00" * (3 * 1024 * 1024))}, headers=h)
    assert riesig.status_code == 413
    # Grenze für normale Anfragen bleibt klein
    assert client.post("/api/antraege", json={"art": "fehler", "text": "x" * 400000}, headers=h).status_code == 413
    for _ in range(4):
        assert client.post(f"/api/antraege/{aid}/bilder", json={"bild": url(PNG)}, headers=h).status_code == 201
    # nachträglich: Absender ja (bis 5), Fremde nein
    assert client.post(f"/api/antraege/{aid}/bilder", json={"bild": url(b"\xff\xd8\xff" + b"\x00" * 10, "jpeg")}, headers=h).status_code == 201
    assert client.post(f"/api/antraege/{aid}/bilder", json={"bild": url(PNG)}, headers=h).status_code == 409
    assert client.post(f"/api/antraege/{aid}/bilder", json={"bild": url(PNG)}, headers=client.als(PAUL)).status_code == 404
    bilder = client.get(f"/api/antraege/{aid}", headers=h).json()["bilder"]
    assert [b["art"] for b in bilder] == ["png"] * 4 + ["jpg"]
    # entfernen: nur wer es angefügt hat (oder Admin)
    assert client.delete(f"/api/antraege/{aid}/bilder/{bilder[0]['id']}", headers=h).status_code == 204
    assert client.delete(f"/api/antraege/{aid}/bilder/{bilder[1]['id']}", headers=client.als()).status_code == 204
    assert len(client.get(f"/api/antraege/{aid}", headers=h).json()["bilder"]) == 3


def test_simulation_sieht_echte_antraege_nicht(client):
    aid = client.post("/api/antraege", json={"art": "fehler", "text": "echte Anfrage"}, headers=client.als()).json()["id"]
    sim = {**client.als(), "X-Ansicht": "spieler"}
    assert client.get(f"/api/antraege/{aid}", headers=sim).status_code == 404
