"""Einstellungen aus Umgebungsvariablen (siehe compose.yaml)."""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Einstellungen:
    team_domain: str          # z. B. cold-glitter-fc3b.cloudflareaccess.com
    audience: str             # AUD-Tag der Access-Anwendung "games"
    users_file: Path          # E-Mail → Benutzername
    spiele_dir: Path          # /spiele (nur lesend)
    db_path: Path             # /data/saves.db
    dev_user: str | None      # NUR lokal: Anmeldung überspringen

    @property
    def jwks_url(self) -> str:
        return f"https://{self.team_domain}/cdn-cgi/access/certs"

    @property
    def issuer(self) -> str:
        return f"https://{self.team_domain}"


def laden() -> Einstellungen:
    dev_user = os.environ.get("DEV_USER") or None
    if dev_user and os.environ.get("DEV_ALLOW") != "1":
        # Schutz gegen versehentlichen Bypass im Produktiv-Compose
        raise SystemExit("DEV_USER ist gesetzt, aber DEV_ALLOW=1 fehlt – Start verweigert.")
    return Einstellungen(
        team_domain=os.environ.get("ACCESS_TEAM_DOMAIN", ""),
        audience=os.environ.get("ACCESS_AUD", ""),
        users_file=Path(os.environ.get("USERS_FILE", "/config/users.yaml")),
        spiele_dir=Path(os.environ.get("SPIELE_DIR", "/spiele")),
        db_path=Path(os.environ.get("DB_PATH", "/data/saves.db")),
        dev_user=dev_user,
    )
