"""Abgleich der Cloudflare-Access-Richtlinien mit der Benutzerliste (Zentrale 1.3.0, Idee 9).

Sicherheitsmodell – warum zwei Schlüssel und warum der Server nie schreibt:
  Cloudflare kennt für Access-Richtlinien nur ein Schreibrecht: „Access: Apps and Policies Write“. Ein solcher Schlüssel
  könnte JEDE Anwendung und Richtlinie ändern, also den ganzen Schutz abschalten. Er liegt deshalb nie auf der NAS.
  - Server (Speicher-Dienst): höchstens ein NUR-LESE-Schlüssel („Access: Apps and Policies Read“) in /data, nur für den
    Dienst lesbar. Damit zeigt das Admin-Panel, ob Cloudflare zur Benutzerliste passt. Gelangt er in falsche Hände,
    sieht man nur die Richtlinien – ändern kann man nichts.
  - Mac (scripts/cloudflare.py): der Schreib-Schlüssel liegt im macOS-Schlüsselbund. Geschrieben wird nur nach
    Anzeige der Änderungen und Bestätigung, mit Sicherung vorher und Gegenprobe danach.

Dieses Modul hat absichtlich keine Abhängigkeiten außer der Standardbibliothek – scripts/cloudflare.py lädt es direkt.
Der Schlüssel wird nie protokolliert, nie zurückgegeben und steht in keiner Fehlermeldung.
"""

import copy
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ACCOUNT_ID = re.compile(r"^[0-9a-f]{32}$")
POLICY_ID = re.compile(r"^[0-9a-f-]{36}$")
# Felder, die Cloudflare liefert, aber beim Schreiben nicht zurückbekommen darf. Alles andere wird unverändert
# zurückgeschickt – lieber scheitert das Schreiben (dann ändert sich nichts), als dass ein Feld still zurückgesetzt wird.
NUR_LESEN = {"id", "uid", "created_at", "updated_at", "app_count", "account_id", "reusable", "app_uid"}
ENTFERNEN_MAX = 3          # mehr Adressen auf einmal entfernen nur mit ausdrücklichem --viele


class CloudflareFehler(Exception):
    pass


# ---------- reine Logik (ohne Netz, getestet) ----------

def soll(benutzer: dict[str, str], entwickler: set[str]) -> dict[str, set[str]]:
    """Welche E-Mails gehören in welche Richtlinie? benutzer: E-Mail → Name, entwickler: Namen mit Upload-Konto."""
    return {"kollegen": {m.lower() for m in benutzer},
            "entwickler": {m.lower() for m, n in benutzer.items() if n in entwickler}}


def emails(richtlinie: dict) -> set[str]:
    return {r["email"]["email"].lower() for r in richtlinie.get("include") or []
            if isinstance(r, dict) and isinstance(r.get("email"), dict) and isinstance(r["email"].get("email"), str)}


def bedenken(richtlinie: dict, name: str) -> list[str]:
    """Alles, was gegen ein automatisches Schreiben spricht. Leer = die Richtlinie sieht aus wie erwartet."""
    b = []
    if richtlinie.get("name") != name:
        b.append(f"Name ist {richtlinie.get('name')!r} statt {name!r}")
    if richtlinie.get("decision") != "allow":
        b.append(f"Aktion ist {richtlinie.get('decision')!r} statt 'allow'")
    include = richtlinie.get("include") or []
    andere = [next(iter(r), "?") if isinstance(r, dict) else "?" for r in include
              if not (isinstance(r, dict) and set(r) == {"email"})]
    if andere:
        b.append("„Einschließen“ enthält nicht nur E-Mails, sondern auch: " + ", ".join(sorted(set(andere)))
                 + " – bitte von Hand pflegen")
    if not include:
        b.append("„Einschließen“ ist leer")
    return b


def vergleich(richtlinie: dict, soll_emails: set[str]) -> dict:
    ist = emails(richtlinie)
    return {"fehlt": sorted(soll_emails - ist), "zuviel": sorted(ist - soll_emails)}


def neuer_stand(richtlinie: dict, soll_emails: set[str], geschuetzt: set[str], entfernen: bool) -> dict:
    """Schreib-Body: alles wie bisher, nur die E-Mail-Liste geändert. Geschützte Adressen (Admins) bleiben immer."""
    for m in soll_emails:
        if not EMAIL.match(m):
            raise CloudflareFehler(f"Ungültige E-Mail in der Benutzerliste: {m!r}")
    ist = emails(richtlinie)
    neu = set(soll_emails) | (ist & {g.lower() for g in geschuetzt})
    if not entfernen:
        neu |= ist
    if not neu:
        raise CloudflareFehler("Die Richtlinie wäre danach leer – abgebrochen")
    body = {k: copy.deepcopy(v) for k, v in richtlinie.items() if k not in NUR_LESEN}
    body["include"] = [{"email": {"email": m}} for m in sorted(neu)]
    return body


def unterschiede(vorher: dict, nachher: dict) -> list[str]:
    """Gegenprobe nach dem Schreiben: Hat sich außer der E-Mail-Liste etwas verändert?"""
    felder = (set(vorher) | set(nachher)) - NUR_LESEN - {"include"}
    return sorted(f for f in felder if vorher.get(f) != nachher.get(f))


# ---------- Cloudflare-API ----------

class Api:
    def __init__(self, schluessel: str, konto: str, oeffnen=urllib.request.urlopen):
        if not ACCOUNT_ID.match(konto or ""):
            raise CloudflareFehler("Konto-ID (CF_ACCOUNT_ID) fehlt oder hat das falsche Format (32 Zeichen 0–9/a–f)")
        if not schluessel or any(c.isspace() for c in schluessel):
            raise CloudflareFehler("Schlüssel fehlt oder enthält Leerzeichen")
        self._schluessel = schluessel
        self.konto = konto
        self._oeffnen = oeffnen

    def __repr__(self) -> str:          # Schlüssel nie ausgeben, auch nicht versehentlich
        return f"Api(konto={self.konto!r})"

    def _anfrage(self, methode: str, pfad: str, body: dict | None = None):
        anfrage = urllib.request.Request(API + pfad, method=methode,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers={"Authorization": "Bearer " + self._schluessel,
                                                  "Content-Type": "application/json", "User-Agent": "spielebibliothek"})
        try:
            with self._oeffnen(anfrage, timeout=20) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as f:
            try:
                fehler = json.loads(f.read()).get("errors") or []
            except ValueError:
                fehler = []
            text = "; ".join(str(x.get("message", x)) for x in fehler if isinstance(x, dict)) or f"HTTP {f.code}"
            if f.code in (401, 403):
                text += " – Schlüssel ungültig, abgelaufen oder ohne passendes Recht"
            raise CloudflareFehler(f"Cloudflare: {text}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as f:
            raise CloudflareFehler(f"Cloudflare nicht erreichbar: {getattr(f, 'reason', f)}") from None
        except ValueError:
            raise CloudflareFehler("Cloudflare: unerwartete Antwort") from None
        if not d.get("success"):
            raise CloudflareFehler("Cloudflare: " + "; ".join(str(x.get("message", x)) for x in d.get("errors") or []))
        return d.get("result")

    def richtlinien(self) -> list[dict]:
        ergebnis, seite = [], 1
        while True:
            teil = self._anfrage("GET", f"/accounts/{self.konto}/access/policies?per_page=50&page={seite}") or []
            ergebnis += teil
            if len(teil) < 50 or seite >= 20:
                return ergebnis
            seite += 1

    def richtlinie_finden(self, name: str) -> dict:
        treffer = [r for r in self.richtlinien() if r.get("name") == name]
        if len(treffer) != 1:
            raise CloudflareFehler(f"Richtlinie {name!r} {'nicht gefunden' if not treffer else 'gibt es mehrfach'} "
                                   "(wiederverwendbare Richtlinien unter Zugriffssteuerungen → Richtlinien)")
        return self.richtlinie(treffer[0]["id"])

    def richtlinie(self, policy_id: str) -> dict:
        if not POLICY_ID.match(policy_id or ""):
            raise CloudflareFehler("ungültige Richtlinien-ID")
        return self._anfrage("GET", f"/accounts/{self.konto}/access/policies/{policy_id}")

    def schreiben(self, policy_id: str, body: dict) -> dict:
        if not POLICY_ID.match(policy_id or ""):
            raise CloudflareFehler("ungültige Richtlinien-ID")
        return self._anfrage("PUT", f"/accounts/{self.konto}/access/policies/{policy_id}", body)


# ---------- Nur-Lese-Prüfung im Speicher-Dienst ----------

class Pruefung:
    """Vergleicht die Richtlinien mit der Benutzerliste. Ergebnis 5 Minuten zwischengespeichert."""

    PUFFER = 300

    def __init__(self, schluessel_datei: Path, konto: str, namen: dict[str, str], oeffnen=urllib.request.urlopen):
        self.datei, self.konto, self.namen, self._oeffnen = schluessel_datei, konto, namen, oeffnen
        self._stand: tuple[float, tuple, dict] | None = None

    def eingerichtet(self) -> bool:
        return bool(self.konto) and self.datei.is_file()

    def ergebnis(self, soll_emails: dict[str, set[str]], neu: bool = False) -> dict:
        if not self.eingerichtet():
            return {"eingerichtet": False}
        schluessel_soll = tuple((k, tuple(sorted(v))) for k, v in sorted(soll_emails.items()))
        if not neu and self._stand and time.monotonic() - self._stand[0] < self.PUFFER and self._stand[1] == schluessel_soll:
            return self._stand[2]
        try:
            api = Api(self.datei.read_text(encoding="utf-8").strip(), self.konto, self._oeffnen)
            richtlinien = []
            for art, name in self.namen.items():
                r = api.richtlinie_finden(name)
                richtlinien.append({"art": art, "name": name, **vergleich(r, soll_emails.get(art, set())),
                                    "bedenken": bedenken(r, name)})
            d = {"eingerichtet": True, "richtlinien": richtlinien, "geprueft": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        except (CloudflareFehler, OSError) as f:
            d = {"eingerichtet": True, "fehler": str(f), "richtlinien": []}
        self._stand = (time.monotonic(), schluessel_soll, d)
        return d
