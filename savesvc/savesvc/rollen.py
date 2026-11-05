"""Rollen und „Ansicht als …“ (wie „Server als Rolle ansehen“ bei Discord).

Ein echter Admin kann per Header X-Ansicht: spieler | entwickler die Bibliothek so sehen, wie diese Rolle
sie sieht – der Server antwortet dann tatsächlich mit den Rechten dieser Rolle. Der Header nimmt nur Rechte
weg, er gibt nie welche: Bei Nicht-Admins wird er ignoriert.
"""

from fastapi import Request

ANSICHTEN = ("spieler", "entwickler")


def rolle(e, request: Request, player: str) -> dict:
    echter_admin = player in e.admins
    hat_ordner = (e.spiele_dir / player).is_dir()
    ansicht = request.headers.get("x-ansicht")
    if echter_admin and ansicht in ANSICHTEN:
        return {"admin": False, "entwickler": ansicht == "entwickler", "uploader": ansicht == "entwickler" and hat_ordner,
                "ansicht": ansicht, "echterAdmin": True}
    return {"admin": echter_admin, "entwickler": hat_ordner or echter_admin, "uploader": hat_ordner,
            "ansicht": None, "echterAdmin": echter_admin}
