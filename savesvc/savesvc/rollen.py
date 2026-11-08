"""Rollen und „Ansicht als …“ (wie „Server als Rolle ansehen“ bei Discord).

Ein echter Admin kann per Header X-Ansicht: spieler | entwickler die Bibliothek so sehen, wie diese Rolle
sie sieht – der Server antwortet dann tatsächlich mit den Rechten dieser Rolle. Der Header nimmt nur Rechte
weg, er gibt nie welche: Bei Nicht-Admins wird er ignoriert.
"""

from fastapi import Request

ANSICHTEN = ("spieler", "entwickler")

# CRM (Zentrale 1.4.0): Rollen kommen ausdrücklich aus dem CRM. Wird beim Start des Speicher-Dienstes gesetzt
# (app.erstellen). Ohne CRM (Upload-Dienst, alte Tests) gilt wie bisher: Admin = ADMINS, Entwickler = hat Ordner.
QUELLE = None   # crm.Crm


def crm_rollen(player: str) -> set[str]:
    return QUELLE.rollen(player) if QUELLE is not None else set()


def admins(e) -> set[str]:
    """Alle Admins: Notfall-Admins aus ADMINS und alle mit der CRM-Rolle admin."""
    extra = {p["name"] for p in QUELLE.personen() if "admin" in p["rollen"] and p["status"] in ("aktiv", "verwarnt", "eingeladen")} \
        if QUELLE is not None else set()
    return set(e.admins) | extra


def rolle(e, request: Request, player: str) -> dict:
    crm = crm_rollen(player)
    echter_admin = player in e.admins or "admin" in crm
    # Mit CRM zählt nur die Rolle (1.4.0, Nachtest 08.11.): Ein Spieleordner bleibt nach dem Entziehen der Rolle stehen (die Spiele
    # bleiben), darf aber nicht weiter als „Entwickler“ gelten. Ohne CRM (Upload-Dienst, alte Tests) wie bisher der Ordner.
    hat_ordner = "entwickler" in crm if QUELLE is not None else (e.spiele_dir / player).is_dir()
    ansicht = request.headers.get("x-ansicht")
    if echter_admin and ansicht in ANSICHTEN:
        return {"admin": False, "entwickler": ansicht == "entwickler", "uploader": ansicht == "entwickler" and hat_ordner,
                "ansicht": ansicht, "echterAdmin": True}
    return {"admin": echter_admin, "entwickler": hat_ordner or echter_admin, "uploader": hat_ordner,
            "ansicht": None, "echterAdmin": echter_admin}


def daten_id(e, request: Request, player: str) -> str:
    """Unter welchem Namen Spielstände, Einstellungen und Anfragen liegen. In der Simulation eine eigene,
    leere Identität (z. B. „seb~spieler“) – wie ein neuer Kollege; Sebs echte Daten bleiben unberührt."""
    a = rolle(e, request, player)["ansicht"]
    return f"{player}~{a}" if a else player


def simuliert(e, request: Request, player: str) -> str | None:
    return rolle(e, request, player)["ansicht"]
