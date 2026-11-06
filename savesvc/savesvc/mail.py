"""E-Mails verschicken (Zentrale 1.4.0): Einladungen aus dem CRM, über ein vorhandenes Postfach (SMTP, E67).

Zugangsdaten nur aus der Umgebung (.env auf der NAS, Modus 600) – nie in Einstellungen (repr!), nie im Log:
    SMTP_HOST, SMTP_PORT (587), SMTP_BENUTZER, SMTP_PASSWORT, SMTP_ABSENDER, SMTP_VERSCHLUESSELUNG (starttls | ssl)
Ohne SMTP_HOST ist der Versand aus – das CRM zeigt dann, dass die Einladung von Hand verschickt werden muss.
Verschlüsselung ist Pflicht: Klartext-SMTP gibt es absichtlich nicht.
"""

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

log = logging.getLogger("savesvc.mail")


class Versandfehler(RuntimeError):
    pass


def einstellungen() -> dict | None:
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        return None
    art = os.environ.get("SMTP_VERSCHLUESSELUNG", "starttls").strip().lower()
    return {"host": host, "port": int(os.environ.get("SMTP_PORT") or (465 if art == "ssl" else 587)),
            "benutzer": os.environ.get("SMTP_BENUTZER", ""), "art": "ssl" if art == "ssl" else "starttls",
            "absender": os.environ.get("SMTP_ABSENDER", "").strip() or os.environ.get("SMTP_BENUTZER", "")}


def eingerichtet() -> bool:
    return einstellungen() is not None


def senden(an: str, betreff: str, text: str, smtp_klasse=None) -> None:
    """Eine Text-Mail verschicken. Fehlermeldungen enthalten nie Zugangsdaten."""
    k = einstellungen()
    if not k:
        raise Versandfehler("E-Mail-Versand ist nicht eingerichtet (SMTP_HOST in der .env)")
    if "\n" in an or "\r" in an or "\n" in betreff or "\r" in betreff:
        raise Versandfehler("ungültige Adresse oder Betreff")
    m = EmailMessage()
    m["From"] = formataddr(("Spielebibliothek", k["absender"]))
    m["To"] = an
    m["Subject"] = betreff
    m["Message-ID"] = make_msgid(domain=k["absender"].split("@")[-1] if "@" in k["absender"] else None)
    m.set_content(text)
    kontext = ssl.create_default_context()
    try:
        if k["art"] == "ssl":
            verbindung = (smtp_klasse or smtplib.SMTP_SSL)(k["host"], k["port"], context=kontext, timeout=20)
        else:
            verbindung = (smtp_klasse or smtplib.SMTP)(k["host"], k["port"], timeout=20)
        with verbindung as s:
            if k["art"] == "starttls":
                s.starttls(context=kontext)
            if k["benutzer"]:
                s.login(k["benutzer"], os.environ.get("SMTP_PASSWORT", ""))
            s.send_message(m)
    except (smtplib.SMTPException, OSError) as f:
        # Nur Art und Code – die Serverantwort könnte den Benutzernamen enthalten
        code = getattr(f, "smtp_code", None)
        log.warning("Mail an %s nicht verschickt: %s%s", an.split("@")[-1], type(f).__name__, f" ({code})" if code else "")
        raise Versandfehler(f"Mail nicht verschickt: {type(f).__name__}" + (f" ({code})" if code else "")) from None
    log.info("Mail verschickt an …@%s", an.split("@")[-1])
