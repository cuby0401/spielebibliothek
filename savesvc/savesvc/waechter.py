"""Wächter (Zentrale 1.2.0, Ideen 7 und 8): prüft alle 5 Minuten, ob die Zentrale gesund ist, und meldet an Home Assistant.

Home Assistant bekommt über einen Webhook (HA_WEBHOOK_URL in der .env):
    {"art": "lebenszeichen", "ok": true|false, "probleme": [...]}   bei jedem Lauf – bleibt es aus, ist der Speicher-Dienst
                                                                     oder die NAS weg (HA-Timer läuft ab → Push)
    {"art": "problem", "text": "..."}                                sobald ein neues Problem auftaucht
    {"art": "wieder_ok", "text": "..."}                              wenn alles wieder läuft
    {"art": "antrag", "text": "..."}                                 bei jedem neuen Antrag (aus verwaltung.py)
Die passende Automation steht in docs/home-assistant.md.

Geprüft wird: Datenbank, Upload-Dienst, Caddy (intern), Erreichbarkeit von außen über Cloudflare, freier Speicher,
Alter der nächtlichen Datenbank-Kopie fürs Backup. Ohne HA_WEBHOOK_URL läuft der Wächter trotzdem – das Ergebnis
steht dann nur im Admin-Panel.
"""

import json
import logging
import shutil
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

log = logging.getLogger("savesvc.waechter")

TAKT = 300                   # Sekunden
BACKUP_MAX_ALTER = 26 * 3600


class _OhneUmleitung(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def ha_senden(e, art: str, text: str = "", **extra) -> None:
    """Webhook an Home Assistant – Fehler werden nur protokolliert, nie weitergereicht."""
    url = getattr(e, "ha_webhook", "")
    if not url:
        return
    try:
        anfrage = urllib.request.Request(url, method="POST", headers={"Content-Type": "application/json"},
                                         data=json.dumps({"art": art, "text": text, **extra}).encode())
        urllib.request.urlopen(anfrage, timeout=10).read()
    except Exception as f:   # noqa: BLE001 – HA nicht erreichbar darf nichts kaputt machen
        log.warning("Home Assistant nicht erreichbar (%s): %s", art, f)


def pruefen(e, db, upload) -> list[str]:
    probleme = []
    try:
        db.zaehlen()
    except Exception as f:   # noqa: BLE001
        probleme.append(f"Datenbank: {f}")
    try:
        upload("GET", "/intern/entwickler")
    except Exception as f:   # noqa: BLE001
        probleme.append(f"Upload-Dienst antwortet nicht ({getattr(f, 'detail', f)})")
    try:
        r = urllib.request.urlopen(urllib.request.Request("http://caddy:8080/zentrale.json",
                                                          headers={"Host": "games.cuby0401.uk"}), timeout=10)
        if r.status != 200:
            probleme.append(f"Caddy liefert {r.status}")
    except Exception as f:   # noqa: BLE001
        probleme.append(f"Caddy antwortet nicht ({f})")
    try:
        opener = urllib.request.build_opener(_OhneUmleitung)
        status = opener.open("https://games.cuby0401.uk/zentrale.json", timeout=15).status
    except urllib.error.HTTPError as f:
        status = f.code
    except Exception as f:   # noqa: BLE001
        status = None
        probleme.append(f"Von außen nicht erreichbar – Cloudflare/Tunnel? ({f})")
    if status is not None and status >= 500:
        probleme.append(f"Von außen nicht erreichbar – Cloudflare meldet {status} (Tunnel/cloudflared prüfen)")
    try:
        u = shutil.disk_usage(e.spiele_dir)
        if u.free < 10 * 1024 ** 3 or u.free < u.total * 0.1:
            probleme.append(f"Speicher knapp: {u.free // 1024 ** 3} GB frei")
    except OSError as f:
        probleme.append(f"Speicher nicht prüfbar: {f}")
    if e.backup_ziel:
        try:
            alter = time.time() - e.backup_ziel.stat().st_mtime
            if alter > BACKUP_MAX_ALTER:
                probleme.append(f"Datenbank-Kopie fürs Backup ist {int(alter // 3600)} h alt")
        except OSError:
            probleme.append("Datenbank-Kopie fürs Backup fehlt")
    return probleme


def starten(e, db, upload, zustand: dict) -> threading.Thread:
    """zustand wird für das Admin-Panel gefüllt: letzterLauf, probleme, homeAssistant."""
    zustand.update({"letzterLauf": None, "probleme": [], "homeAssistant": bool(e.ha_webhook)})

    def schleife():
        vorher: list[str] = []
        time.sleep(60)   # erst wenn alle Dienste hochgefahren sind
        while True:
            try:
                probleme = pruefen(e, db, upload)
            except Exception as f:   # noqa: BLE001
                probleme = [f"Wächter: {f}"]
            zustand.update({"letzterLauf": datetime.now(timezone.utc).isoformat(timespec="seconds"), "probleme": probleme})
            ha_senden(e, "lebenszeichen", ok=not probleme, probleme=probleme)
            neu = [p for p in probleme if p not in vorher]
            if neu:
                log.warning("Probleme: %s", neu)
                ha_senden(e, "problem", "Spielebibliothek: " + "; ".join(neu))
            elif vorher and not probleme:
                ha_senden(e, "wieder_ok", "Spielebibliothek läuft wieder normal.")
            vorher = probleme
            time.sleep(TAKT)

    t = threading.Thread(target=schleife, name="waechter", daemon=True)
    t.start()
    return t
