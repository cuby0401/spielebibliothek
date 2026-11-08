"""CRM (Zentrale 1.4.0, E67/E68): Personen statt users.yaml.

Wer darf was – und wer sieht was:
  - Die Personen stehen in der Datenbank (Tabellen unten). users.yaml wird nur noch als Export geschrieben:
    für den Upload-Dienst (eigener Container, kann die Datenbank nicht lesen) und als Notfall-Rückweg.
    Im Export stehen nur Personen, die gerade hinein dürfen – gesperrte und archivierte fehlen, damit sperrt
    der Upload-Dienst sie automatisch mit.
  - Eine Sperre wirkt sofort auf dem Server (auth.Pruefer fragt bei jeder Anfrage). Aus Cloudflare entfernt
    sie danach `scripts/cloudflare.py abgleichen --entfernen` am Mac (E62: kein Schreibschlüssel auf der NAS).
  - Notizen, Verwarnungen und das Protokoll sieht nur der Admin. Die Person selbst sieht ihre Stammdaten,
    Rollen und ihren Status (Endpunkte /api/mein/konto) – nie die Admin-Felder.
  - Jede Änderung durch einen Admin landet im Prüfprotokoll (crm_protokoll), vorher/nachher als JSON.
    Das Protokoll wird nie gelöscht.
  - Rollen werden ausdrücklich vergeben. ADMINS aus der Umgebung bleibt als Notfall-Admin und ist immer Admin.

Übernahme: Beim ersten Start mit leerer Personen-Tabelle werden alle Einträge aus users.yaml übernommen
(vorher gesichert nach data/backup/). Danach gilt: Wer users.yaml von Hand ergänzt, wird beim nächsten Lesen
als neue Person übernommen – entfernt wird von Hand nichts, das geht nur über das CRM.
"""

import json
import logging
import shutil
import threading
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from .auth import BENUTZER_MUSTER, Benutzerliste

log = logging.getLogger("savesvc.crm")

ROLLEN = ("spieler", "entwickler", "admin", "tester")
STATUS = ("eingeladen", "aktiv", "verwarnt", "gesperrt", "archiviert")
ZUGELASSEN = ("eingeladen", "aktiv", "verwarnt")      # dürfen hinein
TEXT_MAX = {"anzeigename": 40, "vorname": 60, "nachname": 60}

SCHEMA = """
CREATE TABLE IF NOT EXISTS personen (
    name TEXT PRIMARY KEY, anzeigename TEXT, vorname TEXT, nachname TEXT, geburtstag TEXT,
    status TEXT NOT NULL, gesperrt_bis TEXT, sperrgrund TEXT, eingeladen_von TEXT, einladung_gesendet TEXT,
    erste_anmeldung TEXT, datenschutz_bestaetigt TEXT, angelegt TEXT NOT NULL, geaendert TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS person_emails (email TEXT PRIMARY KEY, name TEXT NOT NULL, angelegt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS person_emails_name ON person_emails (name);
CREATE TABLE IF NOT EXISTS person_rollen (name TEXT NOT NULL, rolle TEXT NOT NULL, PRIMARY KEY (name, rolle));
CREATE TABLE IF NOT EXISTS person_notizen (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL, von TEXT NOT NULL, zeit TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS person_ereignisse (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, art TEXT NOT NULL, text TEXT NOT NULL,
    von TEXT, zeit TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS person_ereignisse_name ON person_ereignisse (name, id);
CREATE TABLE IF NOT EXISTS crm_protokoll (
    id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL, von TEXT NOT NULL, aktion TEXT NOT NULL,
    ziel TEXT, vorher TEXT, nachher TEXT);
"""


def jetzt() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Ungueltig(ValueError):
    """Eingabe passt nicht – wird zu HTTP 422."""


class Konflikt(ValueError):
    """Gibt es schon / geht in diesem Zustand nicht – wird zu HTTP 409."""


def email_pruefen(mail) -> str:
    mail = str(mail or "").strip().lower()
    if len(mail) > 254 or "@" not in mail or mail.count("@") != 1 or "." not in mail.split("@")[1] or any(c.isspace() for c in mail):
        raise Ungueltig("E-Mail-Adresse ungültig")
    return mail


def geburtstag_pruefen(wert) -> str | None:
    if wert in (None, ""):
        return None
    try:
        d = date.fromisoformat(str(wert))
    except ValueError:
        raise Ungueltig("Geburtstag: JJJJ-MM-TT") from None
    if not date(1900, 1, 1) <= d <= date.today():
        raise Ungueltig("Geburtstag liegt außerhalb des gültigen Bereichs")
    return d.isoformat()


def text_pruefen(feld: str, wert) -> str | None:
    if wert in (None, ""):
        return None
    if not isinstance(wert, str):
        raise Ungueltig(f"{feld} muss Text sein")
    wert = " ".join(wert.split())
    if len(wert) > TEXT_MAX[feld]:
        raise Ungueltig(f"{feld}: höchstens {TEXT_MAX[feld]} Zeichen")
    return wert or None


class Crm:
    """Datenzugriff auf die CRM-Tabellen (gleiche Datenbank wie der Speicher-Dienst)."""

    def __init__(self, db, admins: frozenset = frozenset()):
        self.db = db
        self.admins = admins
        with db.verbindung() as v:
            v.executescript(SCHEMA)

    # ---------- lesen ----------

    def leer(self) -> bool:
        with self.db.verbindung() as v:
            return v.execute("SELECT COUNT(*) FROM personen").fetchone()[0] == 0

    def _ablaufen_lassen(self, v) -> None:
        """Abgelaufene Sperren (gesperrt_bis in der Vergangenheit) aufheben – passiert beim Lesen."""
        for z in v.execute("SELECT name FROM personen WHERE status='gesperrt' AND gesperrt_bis IS NOT NULL AND gesperrt_bis <= ?",
                           (jetzt(),)).fetchall():
            v.execute("UPDATE personen SET status='aktiv', gesperrt_bis=NULL, sperrgrund=NULL, geaendert=? WHERE name=?", (jetzt(), z["name"]))
            v.execute("INSERT INTO person_ereignisse (name, art, text, von, zeit) VALUES (?,?,?,?,?)",
                      (z["name"], "entsperrt", "Sperre abgelaufen", None, jetzt()))

    def zuordnung(self, nur_zugelassene: bool = True) -> dict[str, str]:
        """E-Mail → Benutzername."""
        with self.db.verbindung() as v:
            self._ablaufen_lassen(v)
            sql = "SELECT e.email, e.name FROM person_emails e JOIN personen p ON p.name = e.name"
            if nur_zugelassene:
                sql += f" WHERE p.status IN ({','.join('?' * len(ZUGELASSEN))})"
            return {z["email"]: z["name"] for z in v.execute(sql, ZUGELASSEN if nur_zugelassene else ())}

    def person(self, name: str) -> dict | None:
        with self.db.verbindung() as v:
            self._ablaufen_lassen(v)
            z = v.execute("SELECT * FROM personen WHERE name=?", (name,)).fetchone()
            if not z:
                return None
            p = dict(z)
            p["emails"] = [r["email"] for r in v.execute("SELECT email FROM person_emails WHERE name=? ORDER BY angelegt, email", (name,))]
            p["rollen"] = self._rollen(v, name)
        return p

    def personen(self) -> list[dict]:
        with self.db.verbindung() as v:
            self._ablaufen_lassen(v)
            mails: dict[str, list[str]] = {}
            for r in v.execute("SELECT email, name FROM person_emails ORDER BY angelegt, email"):
                mails.setdefault(r["name"], []).append(r["email"])
            rollen: dict[str, set[str]] = {}
            for r in v.execute("SELECT name, rolle FROM person_rollen"):
                rollen.setdefault(r["name"], set()).add(r["rolle"])
            liste = []
            for z in v.execute("SELECT * FROM personen ORDER BY name"):
                p = dict(z)
                p["emails"] = mails.get(p["name"], [])
                p["rollen"] = sorted(rollen.get(p["name"], set()) | ({"admin"} if p["name"] in self.admins else set()))
                liste.append(p)
        return liste

    def _rollen(self, v, name: str) -> list[str]:
        r = {z["rolle"] for z in v.execute("SELECT rolle FROM person_rollen WHERE name=?", (name,))}
        if name in self.admins:
            r.add("admin")
        return sorted(r)

    def rollen(self, name: str) -> set[str]:
        with self.db.verbindung() as v:
            return set(self._rollen(v, name))

    def gesperrt(self, email: str) -> dict | None:
        """Für die Fehlermeldung beim Anmelden: Sperrgrund und -ende, falls diese E-Mail gesperrt ist."""
        with self.db.verbindung() as v:
            self._ablaufen_lassen(v)
            z = v.execute("""SELECT p.status, p.sperrgrund, p.gesperrt_bis FROM person_emails e JOIN personen p ON p.name = e.name
                             WHERE e.email=?""", (email.strip().lower(),)).fetchone()
        if z and z["status"] in ("gesperrt", "archiviert"):
            return {"status": z["status"], "grund": z["sperrgrund"], "bis": z["gesperrt_bis"]}
        return None

    def ereignisse(self, name: str, limit: int = 200) -> list[dict]:
        with self.db.verbindung() as v:
            return [dict(z) for z in v.execute("SELECT * FROM person_ereignisse WHERE name=? ORDER BY id DESC LIMIT ?", (name, limit))]

    def notizen(self, name: str) -> list[dict]:
        with self.db.verbindung() as v:
            return [dict(z) for z in v.execute("SELECT * FROM person_notizen WHERE name=? ORDER BY id DESC", (name,))]

    def protokoll(self, ziel: str | None = None, limit: int = 300) -> list[dict]:
        with self.db.verbindung() as v:
            sql = "SELECT * FROM crm_protokoll" + (" WHERE ziel=?" if ziel else "") + " ORDER BY id DESC LIMIT ?"
            return [dict(z) for z in v.execute(sql, ((ziel, limit) if ziel else (limit,)))]

    # ---------- schreiben (immer mit Protokoll) ----------

    def _protokoll(self, v, von: str, aktion: str, ziel: str | None, vorher=None, nachher=None) -> None:
        v.execute("INSERT INTO crm_protokoll (zeit, von, aktion, ziel, vorher, nachher) VALUES (?,?,?,?,?,?)",
                  (jetzt(), von, aktion, ziel,
                   json.dumps(vorher, ensure_ascii=False, sort_keys=True) if vorher is not None else None,
                   json.dumps(nachher, ensure_ascii=False, sort_keys=True) if nachher is not None else None))

    def _ereignis(self, v, name: str, art: str, text: str, von: str | None) -> None:
        v.execute("INSERT INTO person_ereignisse (name, art, text, von, zeit) VALUES (?,?,?,?,?)", (name, art, text[:500], von, jetzt()))

    def anlegen(self, von: str, name: str, email: str, rollen: list[str], status: str = "eingeladen", daten: dict | None = None,
                aktion: str = "einladen") -> dict:
        if not BENUTZER_MUSTER.match(name or ""):
            raise Ungueltig("Benutzername: klein, a–z, 0–9, _ und -, max. 32 Zeichen")
        email = email_pruefen(email)
        rollen = self._rollen_pruefen(rollen)
        daten = daten or {}
        felder = {f: text_pruefen(f, daten.get(f)) for f in TEXT_MAX}
        geb = geburtstag_pruefen(daten.get("geburtstag"))
        with self.db.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            try:
                if v.execute("SELECT 1 FROM personen WHERE name=?", (name,)).fetchone():
                    raise Konflikt("Benutzername ist vergeben")
                z = v.execute("SELECT name FROM person_emails WHERE email=?", (email,)).fetchone()
                if z:
                    raise Konflikt(f"E-Mail ist schon {z['name']!r} zugeordnet")
                v.execute("""INSERT INTO personen (name, anzeigename, vorname, nachname, geburtstag, status, eingeladen_von, angelegt, geaendert)
                             VALUES (?,?,?,?,?,?,?,?,?)""",
                          (name, felder["anzeigename"], felder["vorname"], felder["nachname"], geb, status, von, jetzt(), jetzt()))
                v.execute("INSERT INTO person_emails (email, name, angelegt) VALUES (?,?,?)", (email, name, jetzt()))
                for r in rollen:
                    v.execute("INSERT INTO person_rollen (name, rolle) VALUES (?,?)", (name, r))
                self._ereignis(v, name, aktion, f"{'Eingeladen' if aktion == 'einladen' else 'Übernommen'} von {von} – Rollen: {', '.join(rollen)}", von)
                self._protokoll(v, von, aktion, name, None, {"email": email, "rollen": rollen, "status": status, **felder, "geburtstag": geb})
                v.execute("COMMIT")
            except BaseException:
                v.execute("ROLLBACK")
                raise
        return self.person(name)

    def _rollen_pruefen(self, rollen) -> list[str]:
        if not isinstance(rollen, list) or not all(r in ROLLEN for r in rollen):
            raise Ungueltig(f"Rollen: {', '.join(ROLLEN)}")
        return sorted(set(rollen) | {"spieler"})       # spielen dürfen alle

    def _vorhanden(self, v, name: str) -> dict:
        z = v.execute("SELECT * FROM personen WHERE name=?", (name,)).fetchone()
        if not z:
            raise KeyError(name)
        return dict(z)

    def stammdaten(self, von: str, name: str, daten: dict) -> dict:
        neu = {}
        for f in TEXT_MAX:
            if f in daten:
                neu[f] = text_pruefen(f, daten[f])
        if "geburtstag" in daten:
            neu["geburtstag"] = geburtstag_pruefen(daten["geburtstag"])
        if not neu:
            return self.person(name)
        with self.db.verbindung() as v:
            alt = self._vorhanden(v, name)
            v.execute(f"UPDATE personen SET {', '.join(f'{k}=?' for k in neu)}, geaendert=? WHERE name=?", (*neu.values(), jetzt(), name))
            self._protokoll(v, von, "stammdaten", name, {k: alt[k] for k in neu}, neu)
        return self.person(name)

    def datenschutz_bestaetigen(self, name: str) -> None:
        with self.db.verbindung() as v:
            v.execute("UPDATE personen SET datenschutz_bestaetigt=? WHERE name=? AND datenschutz_bestaetigt IS NULL", (jetzt(), name))

    def rollen_setzen(self, von: str, name: str, rollen) -> tuple[list[str], list[str]]:
        """→ (neu dazu, weggefallen). Notfall-Admins (ADMINS) bleiben immer Admin."""
        rollen = self._rollen_pruefen(rollen)
        with self.db.verbindung() as v:
            self._vorhanden(v, name)
            alt = {z["rolle"] for z in v.execute("SELECT rolle FROM person_rollen WHERE name=?", (name,))}
            if name in self.admins and "admin" not in rollen:
                raise Konflikt("Notfall-Admin (ADMINS) kann die Admin-Rolle nicht verlieren")
            if name == von and "admin" in alt and "admin" not in rollen:
                raise Konflikt("Du kannst dir die Admin-Rolle nicht selbst nehmen")
            dazu, weg = sorted(set(rollen) - alt), sorted(alt - set(rollen))
            v.execute("DELETE FROM person_rollen WHERE name=?", (name,))
            for r in rollen:
                v.execute("INSERT INTO person_rollen (name, rolle) VALUES (?,?)", (name, r))
            if dazu or weg:
                self._ereignis(v, name, "rollen", "Rollen: " + ", ".join([f"+{r}" for r in dazu] + [f"−{r}" for r in weg]), von)
                self._protokoll(v, von, "rollen", name, sorted(alt), rollen)
        return dazu, weg

    def email_dazu(self, von: str, name: str, email: str) -> None:
        email = email_pruefen(email)
        with self.db.verbindung() as v:
            self._vorhanden(v, name)
            z = v.execute("SELECT name FROM person_emails WHERE email=?", (email,)).fetchone()
            if z:
                raise Konflikt(f"E-Mail ist schon {z['name']!r} zugeordnet")
            v.execute("INSERT INTO person_emails (email, name, angelegt) VALUES (?,?,?)", (email, name, jetzt()))
            self._ereignis(v, name, "email", f"E-Mail hinzugefügt: {email}", von)
            self._protokoll(v, von, "email-dazu", name, None, email)

    def email_weg(self, von: str, name: str, email: str) -> None:
        email = str(email or "").strip().lower()
        with self.db.verbindung() as v:
            self._vorhanden(v, name)
            n = v.execute("SELECT COUNT(*) FROM person_emails WHERE name=?", (name,)).fetchone()[0]
            if not v.execute("SELECT 1 FROM person_emails WHERE email=? AND name=?", (email, name)).fetchone():
                raise KeyError(email)
            if n <= 1:
                raise Konflikt("Die letzte E-Mail kann nicht entfernt werden – stattdessen sperren oder archivieren")
            v.execute("DELETE FROM person_emails WHERE email=?", (email,))
            self._ereignis(v, name, "email", f"E-Mail entfernt: {email}", von)
            self._protokoll(v, von, "email-weg", name, email, None)

    def notiz(self, von: str, name: str, text) -> None:
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise Ungueltig("Notiz: 1 bis 4000 Zeichen")
        with self.db.verbindung() as v:
            self._vorhanden(v, name)
            v.execute("INSERT INTO person_notizen (name, text, von, zeit) VALUES (?,?,?,?)", (name, text.strip(), von, jetzt()))
            self._protokoll(v, von, "notiz", name, None, text.strip())

    def verwarnen(self, von: str, name: str, grund) -> None:
        if not isinstance(grund, str) or not 3 <= len(grund.strip()) <= 500:
            raise Ungueltig("Grund: 3 bis 500 Zeichen")
        with self.db.verbindung() as v:
            alt = self._vorhanden(v, name)
            if alt["status"] not in ("aktiv", "verwarnt", "eingeladen"):
                raise Konflikt(f"Person ist {alt['status']}")
            v.execute("UPDATE personen SET status='verwarnt', geaendert=? WHERE name=?", (jetzt(), name))
            self._ereignis(v, name, "verwarnung", grund.strip(), von)
            self._protokoll(v, von, "verwarnen", name, alt["status"], {"status": "verwarnt", "grund": grund.strip()})

    def sperren(self, von: str, name: str, grund, bis=None) -> None:
        if name in self.admins or name == von:
            raise Konflikt("Admins und du selbst können nicht gesperrt werden")
        if not isinstance(grund, str) or not 3 <= len(grund.strip()) <= 500:
            raise Ungueltig("Grund: 3 bis 500 Zeichen")
        if bis not in (None, ""):
            try:
                ende = datetime.fromisoformat(str(bis))
            except ValueError:
                raise Ungueltig("bis: Datum/Uhrzeit (ISO)") from None
            if ende.tzinfo is None:
                ende = ende.replace(tzinfo=timezone.utc)
            if ende <= datetime.now(timezone.utc):
                raise Ungueltig("bis liegt in der Vergangenheit")
            bis = ende.astimezone(timezone.utc).isoformat(timespec="seconds")
        else:
            bis = None
        with self.db.verbindung() as v:
            alt = self._vorhanden(v, name)
            if alt["status"] == "archiviert":
                raise Konflikt("Person ist archiviert")
            v.execute("UPDATE personen SET status='gesperrt', sperrgrund=?, gesperrt_bis=?, geaendert=? WHERE name=?",
                      (grund.strip(), bis, jetzt(), name))
            self._ereignis(v, name, "sperre", grund.strip() + (f" (bis {bis})" if bis else ""), von)
            self._protokoll(v, von, "sperren", name, alt["status"], {"status": "gesperrt", "grund": grund.strip(), "bis": bis})

    def entsperren(self, von: str, name: str) -> None:
        with self.db.verbindung() as v:
            alt = self._vorhanden(v, name)
            if alt["status"] != "gesperrt":
                raise Konflikt("Person ist nicht gesperrt")
            v.execute("UPDATE personen SET status='aktiv', sperrgrund=NULL, gesperrt_bis=NULL, geaendert=? WHERE name=?", (jetzt(), name))
            self._ereignis(v, name, "entsperrt", "Entsperrt", von)
            self._protokoll(v, von, "entsperren", name, {"status": "gesperrt", "grund": alt["sperrgrund"]}, "aktiv")

    def verwarnung_aufheben(self, von: str, name: str) -> None:
        with self.db.verbindung() as v:
            alt = self._vorhanden(v, name)
            if alt["status"] != "verwarnt":
                raise Konflikt("Person ist nicht verwarnt")
            v.execute("UPDATE personen SET status='aktiv', geaendert=? WHERE name=?", (jetzt(), name))
            self._ereignis(v, name, "status", "Verwarnung aufgehoben", von)
            self._protokoll(v, von, "verwarnung-aufheben", name, "verwarnt", "aktiv")

    def archivieren(self, von: str, name: str) -> None:
        """„Löschen“ als Anonymisieren: kein Zugang mehr, persönliche Angaben, E-Mails, Notizen und Rollen weg.
        Der Benutzername bleibt als Pseudonym (Spielstände, Bestenliste, Spiele hängen daran)."""
        if name in self.admins or name == von:
            raise Konflikt("Admins und du selbst können nicht archiviert werden")
        with self.db.verbindung() as v:
            alt = self._vorhanden(v, name)
            mails = [z["email"] for z in v.execute("SELECT email FROM person_emails WHERE name=?", (name,))]
            v.execute("""UPDATE personen SET status='archiviert', anzeigename=NULL, vorname=NULL, nachname=NULL, geburtstag=NULL,
                         sperrgrund=NULL, gesperrt_bis=NULL, geaendert=? WHERE name=?""", (jetzt(), name))
            v.execute("DELETE FROM person_emails WHERE name=?", (name,))
            v.execute("DELETE FROM person_notizen WHERE name=?", (name,))
            v.execute("DELETE FROM person_rollen WHERE name=?", (name,))
            self._ereignis(v, name, "archiviert", "Archiviert – persönliche Angaben entfernt", von)
            # Protokoll ohne die gelöschten Inhalte – nur, dass es passiert ist und wie viele E-Mails es waren
            self._protokoll(v, von, "archivieren", name, {"status": alt["status"], "emails": len(mails)}, "archiviert")

    def einladung_gesendet(self, von: str, name: str) -> None:
        with self.db.verbindung() as v:
            self._vorhanden(v, name)
            v.execute("UPDATE personen SET einladung_gesendet=? WHERE name=?", (jetzt(), name))
            self._ereignis(v, name, "einladung", "Einladungsmail verschickt", von)
            self._protokoll(v, von, "einladung-senden", name, None, None)

    def angemeldet(self, name: str) -> None:
        """Erste Anmeldung: eingeladen → aktiv."""
        with self.db.verbindung() as v:
            n = v.execute("UPDATE personen SET status='aktiv', erste_anmeldung=?, geaendert=? WHERE name=? AND status='eingeladen'",
                          (jetzt(), jetzt(), name)).rowcount
            if n:
                self._ereignis(v, name, "status", "Erste Anmeldung", None)
            v.execute("UPDATE personen SET erste_anmeldung=? WHERE name=? AND erste_anmeldung IS NULL", (jetzt(), name))


class CrmBenutzerliste(Benutzerliste):
    """Gleiche Schnittstelle wie auth.Benutzerliste – die Quelle ist aber das CRM.

    users.yaml wird bei jeder Änderung neu geschrieben (Export). Ändert jemand die Datei von Hand, werden neue
    Einträge beim nächsten Lesen als Personen übernommen (Rolle spieler, Status aktiv)."""

    def __init__(self, pfad: Path, crm: Crm, spiele_dir: Path | None = None):
        super().__init__(pfad)
        self.crm = crm
        self.spiele_dir = spiele_dir
        self._yaml_stand: float | None = None
        self._crm_sperre = threading.Lock()

    def _yaml_uebernehmen(self) -> None:
        try:
            stand = self.pfad.stat().st_mtime
        except FileNotFoundError:
            return
        if stand == self._yaml_stand:
            return
        self._yaml_stand = stand
        try:
            roh = yaml.safe_load(self.pfad.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as f:
            log.warning("users.yaml nicht lesbar: %s", f)
            return
        if not isinstance(roh, dict):
            return
        bekannt = self.crm.zuordnung(nur_zugelassene=False)
        namen = {p["name"] for p in self.crm.personen()}
        for email, name in roh.items():
            email, name = str(email).strip().lower(), str(name)
            if email in bekannt or not BENUTZER_MUSTER.match(name):
                continue
            try:
                if name in namen:
                    self.crm.email_dazu("users.yaml", name, email)
                else:
                    rollen = ["spieler"] + (["entwickler"] if self.spiele_dir and (self.spiele_dir / name).is_dir() else [])
                    self.crm.anlegen("users.yaml", name, email, rollen, status="aktiv", aktion="uebernommen")
                    namen.add(name)
                log.info("users.yaml: %s (%s) ins CRM übernommen", name, email)
            except (Ungueltig, Konflikt) as f:
                log.warning("users.yaml: %s nicht übernommen: %s", name, f)

    def alle(self) -> dict[str, str]:
        with self._crm_sperre:
            self._yaml_uebernehmen()
            return self.crm.zuordnung()

    def namen(self) -> set[str]:
        return set(self.alle().values())

    def benutzer(self, email: str) -> str | None:
        return self.alle().get(email.strip().lower())

    def gesperrt(self, email: str) -> dict | None:
        return self.crm.gesperrt(email)

    def exportieren(self) -> None:
        """users.yaml = alle, die gerade hinein dürfen (für den Upload-Dienst und als Notfall-Rückweg)."""
        with self._crm_sperre:
            soll = self.crm.zuordnung()
            if Benutzerliste(self.pfad).alle() == soll and self.pfad.exists():
                return                                   # unverändert – Datei (und Kommentare) nicht anfassen
            Benutzerliste.speichern(self, soll)
            try:
                self._yaml_stand = self.pfad.stat().st_mtime
            except FileNotFoundError:
                pass

    def speichern(self, zuordnung: dict[str, str]) -> None:   # alte Schnittstelle – nicht mehr verwenden
        raise RuntimeError("users.yaml wird aus dem CRM erzeugt – Änderungen über crm.Crm")


def uebernehmen(crm: Crm, users_file: Path, backup_dir: Path, admins: frozenset, spiele_dir: Path,
                tester: frozenset = frozenset()) -> int:
    """Erster Start mit CRM: alle aus users.yaml übernehmen. Vorher wird users.yaml gesichert. → Anzahl.
    tester (Umgebung TESTER, 1.4.0, Nachtest 08.11.): wer schon vor dem CRM Tester war – steht sonst nirgends, nur in Cloudflare."""
    if not crm.leer():
        return 0
    alt = Benutzerliste(users_file).alle()
    if not alt:
        return 0
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(users_file, backup_dir / f"users-vor-crm-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.yaml")
    except OSError as f:
        log.warning("users.yaml konnte nicht gesichert werden: %s", f)
    n = 0
    namen_fertig: set[str] = set()
    for email, name in sorted(alt.items(), key=lambda x: x[1]):
        if name in namen_fertig:
            crm.email_dazu("übernahme", name, email)
            continue
        rollen = ["spieler"] + (["admin"] if name in admins else []) + (["entwickler"] if (spiele_dir / name).is_dir() else []) \
            + (["tester"] if name in tester else [])
        crm.anlegen("übernahme", name, email, rollen, status="aktiv", aktion="uebernommen")
        namen_fertig.add(name)
        n += 1
    log.info("CRM: %d Personen aus users.yaml übernommen", n)
    return n
