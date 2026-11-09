"""Admin-Panel „Personen“ und „Mein Konto“ (Zentrale 1.4.0) – die Endpunkte zum CRM (crm.py).

Sichtbarkeit (wird in den Tests geprüft):
  - /api/admin/personen…  nur Admin. Enthält Notizen, Verwarnungen, Zeitleiste, Protokoll.
  - /api/mein/konto        nur die eigene Person: Stammdaten, E-Mails, Rollen, Status. Keine Admin-Felder.
Jede Änderung über crm.Crm → Prüfprotokoll. Nach jeder Änderung wird users.yaml neu exportiert
(Upload-Dienst und Cloudflare-Abgleich lesen sie).
"""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Request

from . import crm as crm_modul, identitaet, mail, rollen

log = logging.getLogger("savesvc.personen")

# Felder, die ausschließlich der Admin sieht – dürfen in keiner anderen Antwort vorkommen
NUR_ADMIN = ("notizen", "ereignisse", "protokoll", "sperrgrund", "eingeladen_von")


def registrieren(app: FastAPI, e, db, admin, spieler, benutzerliste: crm_modul.CrmBenutzerliste, upload,
                 cf_pruefung, cf_soll, aktivitaet) -> None:
    crm = benutzerliste.crm

    def fehler(f: Exception):
        if isinstance(f, crm_modul.Ungueltig):
            return HTTPException(422, str(f))
        if isinstance(f, crm_modul.Konflikt):
            return HTTPException(409, str(f))
        if isinstance(f, KeyError):
            return HTTPException(404, "Person nicht gefunden")
        raise f

    def ausfuehren(fn, *args):
        try:
            ergebnis = fn(*args)
        except (crm_modul.Ungueltig, crm_modul.Konflikt, KeyError) as f:
            raise fehler(f) from None
        benutzerliste.exportieren()
        return ergebnis

    def upload_konten() -> set[str] | None:
        try:
            return {z["player"] for z in upload("GET", "/intern/entwickler")}
        except HTTPException:
            return None

    def cloudflare_stand(konten: set[str]) -> tuple[dict, dict]:
        cf = cf_pruefung.ergebnis(cf_soll(konten))
        return cf, {r["art"]: set(r["fehlt"]) for r in cf.get("richtlinien", [])}

    # ---------- Liste ----------
    @app.get("/api/admin/personen")
    def liste(_: str = Depends(admin)):
        konten = upload_konten()
        aktiv = aktivitaet()
        cf, fehlt = cloudflare_stand(konten or set())
        ergebnis = []
        for p in crm.personen():
            # Rollen nur aus dem CRM (1.4.0, Nachtest 08.11.). Früher zählte ein eigener Spieleordner zusätzlich als Entwickler – dann blieb
            # der Haken nach dem Entziehen gesetzt, weil der Ordner (mit den Spielen) bleibt. Wer beim Umstieg aufs CRM
            # einen Ordner hatte, hat die Rolle bei der Übernahme bekommen (crm.uebernehmen).
            ordner = (e.spiele_dir / identitaet.ordner(p["name"])).is_dir()
            entw = "entwickler" in p["rollen"]
            ergebnis.append({
                "name": p["name"], "anzeigename": p["anzeigename"], "vorname": p["vorname"], "nachname": p["nachname"],
                "emails": p["emails"], "rollen": p["rollen"], "status": p["status"], "gesperrtBis": p["gesperrt_bis"],
                "notfallAdmin": p["name"] in rollen.notfall_admins(e), "ordner": ordner,
                "uploadKonto": None if konten is None else p["name"] in konten,
                "zuletzt": aktiv.get(p["name"]), "nieAngemeldet": p["name"] not in aktiv and not p["erste_anmeldung"],
                "einladungGesendet": p["einladung_gesendet"],
                "cloudflare": None if not cf.get("richtlinien") or p["status"] not in crm_modul.ZUGELASSEN else {
                    "kollegen": not any(m in fehlt.get("kollegen", set()) for m in p["emails"]),
                    "entwickler": (not any(m in fehlt.get("entwickler", set()) for m in p["emails"])) if entw and konten and p["name"] in konten else None}})
        return {"personen": ergebnis, "rollen": crm_modul.ROLLEN, "status": crm_modul.STATUS,
                "mail": mail.eingerichtet(), "cloudflare": {"eingerichtet": bool(cf.get("eingerichtet")), "geprueft": bool(cf.get("richtlinien"))}}

    # ---------- Einzelne Person ----------
    def zeitleiste(name: str) -> list[dict]:
        z = [{"zeit": x["zeit"], "art": x["art"], "text": x["text"], "von": x["von"]} for x in crm.ereignisse(name)]
        z += [{"zeit": a["letzte"], "art": "anmeldung", "text": f"Angemeldet: {a['geraet']}" + (f" · {a['ort']}" if a.get("ort") else ""), "von": None}
              for a in db.anmeldungen(name, 30)]
        z += [{"zeit": a["erstellt"], "art": "antrag", "text": f"Anfrage #{a['id']} ({a['art']}): {a['text'][:80]}", "von": None}
              for a in db.antraege(name)[:30]]
        try:
            z += [{"zeit": x.get("zeit"), "art": "upload", "text": f"{x.get('aktion', '')} {x.get('ordner') or ''}".strip(), "von": None}
                  for x in upload("GET", "/intern/ereignisse") if isinstance(x, dict) and x.get("player") == name][:30]
        except HTTPException:
            pass
        return sorted((x for x in z if x["zeit"]), key=lambda x: x["zeit"], reverse=True)[:150]

    @app.get("/api/admin/personen/{name}")
    def person(_: str = Depends(admin), name: str = P(...)):
        p = crm.person(name)
        if not p:
            raise HTTPException(404, "Person nicht gefunden")
        konten = upload_konten()
        return {**p, "notfallAdmin": name in rollen.notfall_admins(e), "ordner": (e.spiele_dir / identitaet.ordner(name)).is_dir(), "uploadKonto": None if konten is None else name in konten,
                "notizen": crm.notizen(name), "zeitleiste": zeitleiste(name), "protokoll": crm.protokoll(name, 100),
                "anmeldungen": db.anmeldungen(name, 50)}

    @app.post("/api/admin/personen", status_code=201)
    def einladen(admin_name: str = Depends(admin), body: dict[str, Any] = Body(...)):
        rollen_neu = body.get("rollen") or ["spieler"]
        p = ausfuehren(crm.anlegen, admin_name, str(body.get("name", "")).strip(), body.get("email"), rollen_neu, "eingeladen",
                       {k: body.get(k) for k in ("anzeigename", "vorname", "nachname", "geburtstag")})
        antwort = {"person": p}
        if "entwickler" in p["rollen"]:
            antwort["passwort"] = upload_konto_anlegen(p["name"])
        log.info("%s hat %s eingeladen (%s)", admin_name, p["name"], ", ".join(p["rollen"]))
        return antwort

    def upload_konto_anlegen(name: str) -> str | None:
        try:
            return upload("POST", "/intern/entwickler", {"name": name})["passwort"]
        except HTTPException as f:
            if f.status_code == 409:     # hat schon eins
                return None
            raise

    @app.patch("/api/admin/personen/{name}")
    def stammdaten(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        return ausfuehren(crm.stammdaten, admin_name, name, {k: body[k] for k in ("anzeigename", "vorname", "nachname", "geburtstag", "angelegt") if k in body})

    @app.put("/api/admin/personen/{name}/rollen")
    def rollen_setzen(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        dazu, weg = ausfuehren(crm.rollen_setzen, admin_name, name, body.get("rollen"))
        antwort: dict = {"dazu": dazu, "weg": weg}
        # Entwickler-Rolle ↔ Upload-Konto (eigener Dienst mit eigenem Passwort)
        if "entwickler" in dazu:
            antwort["passwort"] = upload_konto_anlegen(name)
        if "entwickler" in weg:
            try:
                upload("DELETE", f"/intern/entwickler/{name}")
            except HTTPException as f:
                antwort["hinweis"] = f"Upload-Konto nicht entfernt: {f.detail}"
        return antwort

    @app.post("/api/admin/personen/{name}/emails", status_code=201)
    def email_dazu(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        ausfuehren(crm.email_dazu, admin_name, name, body.get("email"))
        return crm.person(name)

    @app.delete("/api/admin/personen/{name}/emails/{email}")
    def email_weg(admin_name: str = Depends(admin), name: str = P(...), email: str = P(...)):
        ausfuehren(crm.email_weg, admin_name, name, email)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/notizen", status_code=201)
    def notiz(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        ausfuehren(crm.notiz, admin_name, name, body.get("text"))
        return crm.notizen(name)

    @app.post("/api/admin/personen/{name}/verwarnen")
    def verwarnen(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        ausfuehren(crm.verwarnen, admin_name, name, body.get("grund"))
        # Die Person erfährt es über die Glocke (rot) – mit Grund
        db.melden(name, f"Verwarnung von {admin_name}: {str(body.get('grund')).strip()[:250]}", "/#/profil", wichtig=True)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/verwarnung-aufheben")
    def verwarnung_aufheben(admin_name: str = Depends(admin), name: str = P(...)):
        ausfuehren(crm.verwarnung_aufheben, admin_name, name)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/sperren")
    def sperren(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        ausfuehren(crm.sperren, admin_name, name, body.get("grund"), body.get("bis"))
        log.info("%s hat %s gesperrt", admin_name, name)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/entsperren")
    def entsperren(admin_name: str = Depends(admin), name: str = P(...)):
        ausfuehren(crm.entsperren, admin_name, name)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/archivieren")
    def archivieren(admin_name: str = Depends(admin), name: str = P(...)):
        """Rückgängig zu machen: kein Zugang mehr, das Upload-Konto wird entfernt, alle Daten bleiben."""
        ausfuehren(crm.archivieren, admin_name, name)
        try:
            upload("DELETE", f"/intern/entwickler/{name}")
        except HTTPException:
            pass
        log.info("%s hat %s archiviert", admin_name, name)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/wiederherstellen")
    def wiederherstellen(admin_name: str = Depends(admin), name: str = P(...)):
        ausfuehren(crm.wiederherstellen, admin_name, name)
        antwort: dict = {"person": crm.person(name)}
        if "entwickler" in antwort["person"]["rollen"]:          # Upload-Konto wurde beim Archivieren entfernt
            antwort["passwort"] = upload_konto_anlegen(name)
        log.info("%s hat %s wiederhergestellt", admin_name, name)
        return antwort

    @app.post("/api/admin/personen/{name}/loeschen")
    def loeschen(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        if body.get("bestaetigung") != identitaet.handle(name):     # getippt wird das Handle, nicht die UUID (1.5.0)
            raise HTTPException(422, "Zur Bestätigung den Benutzernamen eingeben")
        ausfuehren(crm.loeschen, admin_name, name)
        log.info("%s hat %s endgültig gelöscht (anonymisiert)", admin_name, name)
        return crm.person(name)

    @app.post("/api/admin/personen/{name}/handle")
    def admin_handle(admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        """Admin ändert ein Handle – ohne 30-Tage-Frist (1.5.0)."""
        return ausfuehren(crm.handle_aendern, admin_name, name, body.get("handle"), True)

    @app.get("/api/admin/personen/{name}/export")
    def export(admin_name: str = Depends(admin), name: str = P(...)):
        """Auskunft (DSGVO Art. 15): alles, was über die Person gespeichert ist."""
        p = crm.person(name)
        if not p:
            raise HTTPException(404, "Person nicht gefunden")
        with crm.db.verbindung() as v:
            crm._protokoll(v, admin_name, "export", name)
        return {"person": p, "notizen": crm.notizen(name), "ereignisse": crm.ereignisse(name, 10000),
                "anmeldungen": db.anmeldungen(name, 1000), "antraege": db.antraege(name),
                "spielstaende": [{k: s[k] for k in s if k != "data"} for s in db.spielstaende(name, None)],
                "erstellt": crm_modul.jetzt()}

    @app.get("/api/admin/protokoll")
    def protokoll(_: str = Depends(admin)):
        return crm.protokoll(None, 500)

    @app.post("/api/admin/personen/{name}/einladung")
    def einladung_senden(request: Request, admin_name: str = Depends(admin), name: str = P(...), body: dict[str, Any] = Body(...)):
        """Einladungsmail. Erst wenn die E-Mail in Cloudflare steht – sonst käme beim Anmelden kein Code (E67)."""
        p = crm.person(name)
        if not p:
            raise HTTPException(404, "Person nicht gefunden")
        if p["status"] not in crm_modul.ZUGELASSEN or not p["emails"]:
            raise HTTPException(409, f"Person ist {p['status']}")
        if not mail.eingerichtet():
            raise HTTPException(409, "E-Mail-Versand ist nicht eingerichtet (SMTP in der .env) – Einladung bitte selbst schicken")
        email = p["emails"][0]
        cf, fehlt = cloudflare_stand(upload_konten() or set())
        if cf.get("richtlinien"):
            if email in fehlt.get("kollegen", set()):
                raise HTTPException(409, "Die E-Mail steht noch nicht in Cloudflare („Kollegen“). Erst am Mac: python3 scripts/cloudflare.py abgleichen")
        elif body.get("ohnePruefung") is not True:
            raise HTTPException(409, "Cloudflare-Abgleich ist nicht eingerichtet – ob die E-Mail in Cloudflare steht, kann nicht geprüft werden. "
                                     "Selbst prüfen und mit „trotzdem senden“ bestätigen.")
        adresse = str(request.base_url).rstrip("/")
        hallo = p["anzeigename"] or p["vorname"] or p["name"]
        text = (f"Hallo {hallo},\n\n{identitaet.handle(admin_name)} lädt dich zur Spielebibliothek ein.\n\n"
                f"So geht's:\n1. Öffne {adresse}\n2. Gib diese E-Mail-Adresse ein: {email}\n"
                f"3. Du bekommst einen Code per Mail (Absender Cloudflare) – den eingeben, fertig.\n\n"
                f"Dein Benutzername: {identitaet.handle(p['name'])}\nHilfe findest du in der Bibliothek unter {adresse}/hilfe/\n\n"
                f"Viel Spaß!\n")
        try:
            mail.senden(email, "Einladung zur Spielebibliothek", text)
        except mail.Versandfehler as f:
            raise HTTPException(502, str(f)) from None
        crm.einladung_gesendet(admin_name, name)
        return crm.person(name)

    # ---------- Mein Konto (die Person selbst) ----------
    @app.get("/api/mein/konto")
    def mein_konto(request: Request, player: str = Depends(spieler)):
        if rollen.simuliert(e, request, player):
            return {"name": rollen.daten_id(e, request, player), "simuliert": True}
        p = crm.person(player)
        if not p:
            raise HTTPException(404, "kein Eintrag im CRM")
        ab = crm_modul.handle_wieder_ab(p.get("handle_seit"))
        return {**{k: p[k] for k in ("name", "anzeigename", "vorname", "nachname", "geburtstag", "status", "emails", "rollen",
                                     "angelegt", "erste_anmeldung", "datenschutz_bestaetigt")},
                # 1.5.0: Handle (@name) – alle 30 Tage änderbar; None = jetzt änderbar
                "handle": identitaet.handle(player), "handleAb": ab.isoformat(timespec="seconds") if ab and ab > datetime.now(timezone.utc) else None}

    @app.put("/api/mein/handle")
    def mein_handle(request: Request, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        if rollen.simuliert(e, request, player):
            raise HTTPException(409, "In der Ansicht als Spieler/Entwickler wird nichts geändert")
        ausfuehren(crm.handle_aendern, player, player, body.get("handle"))
        return mein_konto(request, player)

    @app.patch("/api/mein/konto")
    def mein_konto_aendern(request: Request, player: str = Depends(spieler), body: dict[str, Any] = Body(...)):
        if rollen.simuliert(e, request, player):
            raise HTTPException(409, "In der Ansicht als Spieler/Entwickler wird nichts geändert")
        ausfuehren(crm.stammdaten, player, player, {k: body[k] for k in ("anzeigename", "vorname", "nachname", "geburtstag") if k in body})
        if body.get("datenschutz") is True:
            crm.datenschutz_bestaetigen(player)
        return mein_konto(request, player)
