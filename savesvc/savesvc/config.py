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
    backup_ziel: Path | None = None   # nächtliche Kopie für borgmatic (None = aus)
    backup_uhrzeit: str = "01:45"     # Europe/Berlin, vor borgmatic um 02:00
    admins: frozenset = frozenset({"seb"})   # dürfen /admin
    intern_token: str = ""                  # für den Upload-Dienst (Spiele löschen, Upload-Konten)
    upload_url: str = "http://upload:8000"

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
        backup_ziel=Path(os.environ["BACKUP_ZIEL"]) if os.environ.get("BACKUP_ZIEL") else None,
        backup_uhrzeit=os.environ.get("BACKUP_UHRZEIT", "01:45"),
        admins=frozenset(n.strip() for n in os.environ.get("ADMINS", "seb").split(",") if n.strip()),
        intern_token=os.environ.get("INTERN_TOKEN", ""),
        upload_url=os.environ.get("UPLOAD_URL", "http://upload:8000"),
    )
