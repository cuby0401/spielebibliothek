"""Anmeldung: Cloudflare-Access-JWT prüfen und E-Mail auf Benutzernamen abbilden."""

import logging
import os
import re
import threading
from pathlib import Path

import jwt
import yaml
from fastapi import HTTPException, Request

log = logging.getLogger("savesvc.auth")

BENUTZER_MUSTER = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class Benutzerliste:
    """users.yaml: { "paul@example.com": "paul", … }. Wird bei Änderung neu gelesen."""

    def __init__(self, pfad: Path):
        self.pfad = pfad
        self._stand: float | None = None
        self._zuordnung: dict[str, str] = {}
        self._sperre = threading.Lock()

    def _neu_laden(self) -> None:
        try:
            stand = self.pfad.stat().st_mtime
        except FileNotFoundError:
            self._zuordnung, self._stand = {}, None
            return
        if stand == self._stand:
            return
        roh = yaml.safe_load(self.pfad.read_text(encoding="utf-8")) or {}
        if not isinstance(roh, dict):
            raise ValueError("users.yaml muss eine Zuordnung E-Mail: Benutzername sein")
        neu = {}
        for email, name in roh.items():
            name = str(name)
            if not BENUTZER_MUSTER.match(name):
                log.warning("users.yaml: ungültiger Benutzername %r – übersprungen", name)
                continue
            neu[str(email).strip().lower()] = name
        self._zuordnung, self._stand = neu, stand
        log.info("users.yaml geladen: %d Benutzer", len(neu))

    def alle(self) -> dict[str, str]:
        with self._sperre:
            self._neu_laden()
            return dict(self._zuordnung)

    def speichern(self, zuordnung: dict[str, str]) -> None:
        """users.yaml neu schreiben (atomar). Kommentare der alten Datei gehen dabei verloren."""
        kopf = ("# Login-E-Mail (Cloudflare Access) → Benutzername. Verwaltet über das Admin-Panel\n"
                "# (games.cuby0401.uk/admin) – Änderungen per Hand sind ebenfalls möglich und wirken sofort.\n\n")
        zeilen = "".join(f"{yaml.safe_dump({e: n}, allow_unicode=True).strip()}\n" for e, n in sorted(zuordnung.items(), key=lambda x: x[1]))
        tmp = self.pfad.with_name(f".{self.pfad.name}.neu")
        tmp.write_text(kopf + zeilen, encoding="utf-8")
        # Gruppenbits = ACL-Maske: Sebi und der Upload-Dienst behalten ihre Rechte (live per ACL). „other“ darf lesen,
        # damit der Upload-Dienst die Datei auch dort lesen kann, wo es keine ACL gibt (Teststand, Probe) – den Zugriff
        # von außen verhindert der Ordner config/ (live 770).
        os.chmod(tmp, 0o664)
        tmp.replace(self.pfad)
        with self._sperre:
            self._stand = None

    def namen(self) -> set[str]:
        with self._sperre:
            self._neu_laden()
            return set(self._zuordnung.values())

    def benutzer(self, email: str) -> str | None:
        with self._sperre:
            self._neu_laden()
            return self._zuordnung.get(email.strip().lower())


class Pruefer:
    """Prüft das Header-JWT von Cloudflare Access."""

    def __init__(self, einstellungen, benutzerliste: Benutzerliste, schluessel_quelle=None):
        self.e = einstellungen
        self.benutzerliste = benutzerliste
        self.getrennt: set[tuple[str, int]] = set()   # (Spieler, iat) – füllt app.py aus der Datenbank
        # In Tests wird eine eigene Schlüsselquelle eingesetzt
        self._jwks = schluessel_quelle or jwt.PyJWKClient(einstellungen.jwks_url, cache_keys=True, lifespan=3600)

    def __call__(self, request: Request) -> str:
        if self.e.dev_user:
            # Nur Teststand: DEV_USER nennt einen Benutzernamen → ab 1.5.0 die UUID der Person (im Upload-Dienst bleibt es der Name)
            from . import identitaet
            request.state.person = identitaet.id_von(self.e.dev_user) or self.e.dev_user
            return request.state.person
        token = request.headers.get("Cf-Access-Jwt-Assertion")
        if not token:
            raise HTTPException(401, "nicht angemeldet")
        try:
            schluessel = self._jwks.get_signing_key_from_jwt(token).key
            daten = jwt.decode(
                token,
                schluessel,
                algorithms=["RS256"],
                audience=self.e.audience,
                issuer=self.e.issuer,
                options={"require": ["exp", "aud", "iss"]},
            )
        except jwt.PyJWTError as fehler:
            log.info("JWT abgelehnt: %s", fehler)
            raise HTTPException(401, "Anmeldung ungültig") from None
        request.state.sitzung_bis = daten.get("exp")   # Ende der Cloudflare-Sitzung (Sekunden, UTC)
        request.state.sitzung_start = daten.get("iat")   # Zeitpunkt der Anmeldung (für „Meine Anmeldungen“)
        email = daten.get("email")
        if not isinstance(email, str) or not email:
            raise HTTPException(401, "keine E-Mail im Token")
        name = self.benutzerliste.benutzer(email)
        if not name:
            # CRM (1.4.0): gesperrte Personen bekommen den Grund zu sehen – die Sperre wirkt sofort
            gesperrt = getattr(self.benutzerliste, "gesperrt", None)
            sperre = gesperrt(email) if gesperrt else None
            if sperre and sperre["status"] == "gesperrt":
                log.info("gesperrte Person abgelehnt")
                request.state.person = sperre.get("name")          # fürs Sicherheitsprotokoll (1.5.0)
                raise HTTPException(403, "Konto gesperrt" + (f": {sperre['grund']}" if sperre.get("grund") else "")
                                    + (f" (bis {sperre['bis'][:16].replace('T', ' ')} UTC)" if sperre.get("bis") else ""))
            log.info("unbekannte E-Mail abgelehnt")
            raise HTTPException(403, "kein Konto in der Spielebibliothek")
        # „Verbindung trennen“ (Zentrale 1.2.1): diese Anmeldung gilt nicht mehr – die Seite meldet das Gerät ab
        request.state.person = name                                 # fürs Sicherheitsprotokoll (1.5.0)
        if (name, int(daten.get("iat") or 0)) in self.getrennt:
            raise HTTPException(401, "Sitzung getrennt")
        return name
