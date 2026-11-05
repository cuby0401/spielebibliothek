"""Anmeldung: Cloudflare-Access-JWT prüfen und E-Mail auf Benutzernamen abbilden."""

import logging
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
        # In Tests wird eine eigene Schlüsselquelle eingesetzt
        self._jwks = schluessel_quelle or jwt.PyJWKClient(einstellungen.jwks_url, cache_keys=True, lifespan=3600)

    def __call__(self, request: Request) -> str:
        if self.e.dev_user:
            return self.e.dev_user
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
        email = daten.get("email")
        if not isinstance(email, str) or not email:
            raise HTTPException(401, "keine E-Mail im Token")
        name = self.benutzerliste.benutzer(email)
        if not name:
            log.info("unbekannte E-Mail abgelehnt")
            raise HTTPException(403, "kein Konto in der Spielebibliothek")
        return name
