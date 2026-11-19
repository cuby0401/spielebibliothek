"""Multiplayer (Zentrale 1.6.0, E88): Räume, in denen die Browser der Mitspieler Nachrichten austauschen.

Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Multiplayer-und-MCP

Grundsatz (Weg A, Seb 17.11.2026): Auf der NAS läuft kein Code der Entwickler. Die Spielregeln rechnet der Browser des
Hosts, dieser Dienst bringt nur Raum, Spieler und Nachrichten zusammen:
  - Raum mit 4-stelligem Code, ein Host, Spieler und Zuschauer, Rauswerfen, Wiederverbinden.
  - Nachrichten an alle, an den Host oder an einzelne Spieler (der Host schickt jedem nur seine eigenen Karten).
  - Der Host legt den Spielstand im Raum ab. Geht er verloren, übernimmt ein anderer Spieler mit genau diesem Stand.
  - Mitspielen kann nur, wer in der Bibliothek angemeldet ist. Namen kommen aus der Bibliothek, nie vom Spiel.

Verbindung: WebSocket der Bibliotheksseite (games.cuby0401.uk, gleiche Herkunft) – nicht des Spiels. Das Spiel spricht
wie beim Speichern per postMessage mit der Bibliothek (lib/bridge.js), die Spiel-ID hängt am iframe, nie an der Nachricht.

Protokoll (JSON-Text, dazu "ping" → "pong"):
  Browser → Dienst: {t: "an", an: "alle"|"host"|<id>|[<id>…], daten} · {t: "stand", daten} (nur Host)
                    {t: "rauswerfen", wer} · {t: "host", wer} · {t: "offen", an} (nur Host) · {t: "verlassen"}
  Dienst → Browser: {t: "raum", raum: {…}} bei jeder Änderung · {t: "nachricht", von, daten}
                    {t: "stand", daten} an den (neuen) Host · {t: "fehler", text}
Schließ-Codes: 4000 in anderem Tab übernommen, 4001 rausgeworfen, 4003 verboten, 4004 kein Multiplayer-Spiel,
4008 zu viele Nachrichten, 4009 Nachricht zu groß, 4401 nicht angemeldet, 4404 Raum nicht gefunden, 4409 Raum voll,
4429 zu viele neue Räume, 4503 Not-Aus.

Bots (1.6.2): Der Host setzt Bots auf freie Plätze ({t: "bot", stufe}), entfernt sie mit „rauswerfen“. Ein Bot ist nur ein
Eintrag in der Spielerliste (bot: Stufe) ohne Verbindung – seine Züge rechnet der Browser des Hosts mit dem Code des Spiels
(GameSave.multiplayer.spiel, Regel bot). Auf der NAS läuft auch dafür nichts.

Gruppen (1.6.2): Raum ohne Spiel (WebSocket /api/mp/gruppe, Link #/gruppe/CODE). Der Host wählt ein Multiplayer-Spiel
({t: "spiel", spiel: "user/ordner"}): Der Dienst legt dafür einen Raum an, übernimmt die Bots der Gruppe und nennt den Raum
allen in der Gruppe (aktuell). Die Gruppe bleibt während des Spiels verbunden.

Räume liegen nur im Arbeitsspeicher. Nach einem Neustart des Dienstes sind sie weg – die Browser verbinden neu, finden
ihren Raum nicht mehr und landen wieder in der Lobby. Spielstände der Spieler (GameSave.save) sind davon nicht betroffen.
"""

import asyncio
import json
import logging
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from fastapi import Body, Depends, FastAPI, HTTPException, Path as P, Request, WebSocket, WebSocketDisconnect

from . import games, identitaet, notaus, rollen, versionen

log = logging.getLogger("savesvc.multiplayer")

CODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ"          # ohne I und O (Verwechslung mit 1 und 0)
CODE_MUSTER = re.compile(r"^[A-Z]{4}$")
ID_MUSTER = re.compile(r"^[a-z0-9][a-z0-9_~-]{0,40}$")
TAB_MUSTER = re.compile(r"^[A-Za-z0-9_-]{6,40}$")
NACHRICHT_MAX = 64 * 1024                           # eine Nachricht (Zug, Sicht eines Spielers)
STAND_MAX = 256 * 1024                              # abgelegter Spielstand des Hosts (wie ein GameSave-Spielstand)
ZUSCHAUER_MAX = 16
RAEUME_MAX = 300                                    # alle Räume zusammen
NEUE_RAEUME_PRO_MINUTE = 10                         # je Person
TAKT, TAKT_VORRAT = 40, 120                         # Nachrichten je Sekunde (Dauer) und Spitze je Verbindung
HOST_GNADE = 10.0                                   # s: so lange behält ein Host, der kurz die Verbindung verliert, seinen Platz
GETRENNT_ENTFERNEN = 5 * 60                         # s: getrennte Mitglieder fliegen danach aus der Liste
RAUM_LEER_LOESCHEN = 15 * 60                        # s: Raum ohne verbundene Mitglieder wird danach gelöscht
EINLADUNGEN_PRO_10_MIN = 20
GRUPPE_MAX = 16                                     # Mitglieder einer Gruppe (Menschen und Bots)
GRUPPE_STUFEN = ["leicht", "mittel", "schwer"]      # Bots in der Gruppe – im Spiel auf dessen Stufen abgebildet
BOT_PID = "~bot"


@dataclass
class Mitglied:
    id: str                    # nach außen (Spiel): Handle, im Entwurf beim zweiten Tab z. B. "seb-2"
    pid: str                   # Person (UUID) – nur innen
    tab: str | None
    name: str
    zuschauer: bool
    seit: float
    ws: WebSocket | None = None
    getrennt_seit: float | None = None
    bot: str | None = None     # Bots (1.6.2): Schwierigkeitsstufe; ein Bot hat keine Verbindung und ist trotzdem „da“

    @property
    def verbunden(self) -> bool:
        return self.ws is not None or self.bot is not None

    @property
    def mensch_da(self) -> bool:
        return self.ws is not None


@dataclass
class Raum:
    code: str
    spiel: str
    min: int
    max: int
    entwurf: bool
    host: str | None = None
    offen: bool = True
    stand: str | None = None   # JSON-Text, so wie der Host ihn geschickt hat
    mitglieder: dict[str, Mitglied] = field(default_factory=dict)
    gesperrt: set[str] = field(default_factory=set)
    leer_seit: float | None = None
    host_timer: asyncio.Task | None = None
    erstellt: float = field(default_factory=time.time)
    bots: list[str] = field(default_factory=list)     # Stufen, die das Spiel anbietet (leer = keine Bots)
    art: str = "spiel"                                # "spiel" oder "gruppe" (1.6.2)
    gruppe: str | None = None                         # Raum eines Spiels, das eine Gruppe gestartet hat: Code der Gruppe
    aktuell: dict | None = None                       # Gruppe: gerade gewähltes Spiel {spiel, code, titel}
    host_wunsch: str | None = None                    # Raum aus einer Gruppe: deren Host soll auch hier Host sein

    def verbundene(self) -> list[Mitglied]:
        return [m for m in self.mitglieder.values() if m.mensch_da]

    def menschen(self) -> list[Mitglied]:
        return self.verbundene()

    def spieler(self) -> list[Mitglied]:
        return [m for m in self.mitglieder.values() if not m.zuschauer]


class Takt:
    """Eimer-Verfahren: Spitzen sind erlaubt, auf Dauer höchstens TAKT Nachrichten je Sekunde."""

    def __init__(self):
        self.vorrat, self.zeit = float(TAKT_VORRAT), time.monotonic()

    def erlaubt(self) -> bool:
        jetzt_ = time.monotonic()
        self.vorrat = min(TAKT_VORRAT, self.vorrat + (jetzt_ - self.zeit) * TAKT)
        self.zeit = jetzt_
        if self.vorrat < 1:
            return False
        self.vorrat -= 1
        return True


class Raeume:
    def __init__(self, namen=lambda pid: pid):
        self.raeume: dict[str, Raum] = {}
        self.namen = namen                 # pid → Anzeigename (oder Handle)
        self.neu_je_person: dict[str, deque] = {}
        self.einladungen: dict[str, deque] = {}

    # ---------- Verwaltung ----------

    def aufraeumen(self) -> None:
        jetzt_ = time.time()
        for code, r in list(self.raeume.items()):
            for mid, m in list(r.mitglieder.items()):
                if not m.verbunden and m.getrennt_seit and jetzt_ - m.getrennt_seit > GETRENNT_ENTFERNEN and mid != r.host:
                    del r.mitglieder[mid]
            if not r.verbundene() and (r.leer_seit or jetzt_) and jetzt_ - (r.leer_seit or jetzt_) > RAUM_LEER_LOESCHEN:
                if r.host_timer:
                    r.host_timer.cancel()
                del self.raeume[code]

    def neuer_code(self) -> str:
        for _ in range(200):
            code = "".join(secrets.choice(CODE_ZEICHEN) for _ in range(4))
            if code not in self.raeume:
                return code
        raise RuntimeError("kein freier Raumcode")

    def darf_neu(self, pid: str) -> bool:
        q = self.neu_je_person.setdefault(pid, deque())
        jetzt_ = time.monotonic()
        while q and jetzt_ - q[0] > 60:
            q.popleft()
        if len(q) >= NEUE_RAEUME_PRO_MINUTE:
            return False
        q.append(jetzt_)
        return True

    def darf_einladen(self, pid: str, anzahl: int) -> bool:
        q = self.einladungen.setdefault(pid, deque())
        jetzt_ = time.monotonic()
        while q and jetzt_ - q[0] > 600:
            q.popleft()
        if len(q) + anzahl > EINLADUNGEN_PRO_10_MIN:
            return False
        q.extend([jetzt_] * anzahl)
        return True

    def offene(self, spiel: str, pid: str) -> list[dict]:
        self.aufraeumen()
        liste = []
        for r in self.raeume.values():
            if r.spiel != spiel or not r.offen or pid in r.gesperrt or not r.verbundene():
                continue
            host = r.mitglieder.get(r.host) if r.host else None
            liste.append({"code": r.code, "host": host.name if host else None,
                          "spieler": sum(1 for m in r.spieler() if m.verbunden), "max": r.max,
                          "bots": sum(1 for m in r.spieler() if m.bot),
                          "voll": len(r.spieler()) >= r.max, "erstellt": int(r.erstellt)})
        return sorted(liste, key=lambda x: -x["erstellt"])

    # ---------- Zustand nach außen ----------

    def zustand(self, r: Raum, fuer: Mitglied) -> dict:
        return {"code": r.code, "spiel": r.spiel, "ich": fuer.id, "host": r.host, "offen": r.offen,
                "min": r.min, "max": r.max, "entwurf": r.entwurf, "zuschauer": fuer.zuschauer,
                "art": r.art, "bots": r.bots, "gruppe": r.gruppe, "aktuell": r.aktuell,
                "spieler": [{"id": m.id, "name": m.name, "verbunden": m.verbunden, "zuschauer": m.zuschauer,
                             "host": m.id == r.host, "bot": m.bot} for m in r.mitglieder.values()]}

    async def senden(self, m: Mitglied, nachricht: dict | str) -> None:
        ws = m.ws
        if ws is None:
            return
        try:
            await ws.send_text(nachricht if isinstance(nachricht, str) else json.dumps(nachricht, ensure_ascii=False, separators=(",", ":")))
        except Exception:   # Verbindung schon weg – das merkt die Empfangsschleife selbst
            pass

    async def verteilen(self, r: Raum) -> None:
        for m in r.verbundene():
            await self.senden(m, {"t": "raum", "raum": self.zustand(r, m)})

    async def stand_an_host(self, r: Raum) -> None:
        host = r.mitglieder.get(r.host) if r.host else None
        if host and host.verbunden:
            await self.senden(host, '{"t":"stand","daten":' + (r.stand or "null") + "}")

    # ---------- Host ----------

    def nachfolger(self, r: Raum, ausser: str | None = None) -> Mitglied | None:
        kandidaten = [m for m in r.mitglieder.values() if m.mensch_da and m.id != ausser]   # nie ein Bot
        kandidaten.sort(key=lambda m: (m.zuschauer, m.seit))
        return kandidaten[0] if kandidaten else None

    async def host_wechseln(self, r: Raum, neu: Mitglied | None) -> None:
        if r.host_timer:
            r.host_timer.cancel()
            r.host_timer = None
        if neu is None or neu.id == r.host:
            return
        log.info("Raum %s: neuer Host", r.code)
        r.host = neu.id
        await self.stand_an_host(r)
        await self.verteilen(r)

    def host_spaeter_pruefen(self, r: Raum) -> None:
        if r.host_timer:
            r.host_timer.cancel()

        async def pruefen():
            await asyncio.sleep(HOST_GNADE)
            r.host_timer = None
            host = r.mitglieder.get(r.host) if r.host else None
            if host is None or not host.verbunden:
                await self.host_wechseln(r, self.nachfolger(r))
        r.host_timer = asyncio.get_running_loop().create_task(pruefen())

    # ---------- Ein- und Austritt ----------

    def mitglied_finden(self, r: Raum, pid: str, tab: str | None) -> Mitglied | None:
        for m in r.mitglieder.values():
            if m.pid == pid and (not r.entwurf or m.tab == tab):
                return m
        return None

    def neue_id(self, r: Raum, pid: str) -> str:
        basis = identitaet.handle(pid) or pid
        if basis not in r.mitglieder:
            return basis
        n = 2
        while f"{basis}-{n}" in r.mitglieder:
            n += 1
        return f"{basis}-{n}"

    async def beitreten(self, r: Raum, ws: WebSocket, pid: str, tab: str | None, zuschauer: bool) -> Mitglied:
        m = self.mitglied_finden(r, pid, tab)
        if m:
            alt = m.ws
            m.ws, m.getrennt_seit = ws, None
            if alt is not None and alt is not ws:
                try:
                    await alt.close(4000, "In einem anderen Tab übernommen")
                except Exception:
                    pass
        else:
            voll = len(r.spieler()) >= r.max
            if (zuschauer or voll) and sum(1 for x in r.mitglieder.values() if x.zuschauer) >= ZUSCHAUER_MAX:
                raise Abweisung(4409, "Der Raum ist voll.")
            mid = self.neue_id(r, pid)
            name = self.namen(pid) or mid
            if mid != identitaet.handle(pid):
                name = f"{name} ({mid.rsplit('-', 1)[-1]})"
            m = Mitglied(id=mid, pid=pid, tab=tab, name=name, zuschauer=zuschauer or voll, seit=time.time(), ws=ws)
            r.mitglieder[mid] = m
        r.leer_seit = None
        host = r.mitglieder.get(r.host) if r.host else None
        if host is None or (not host.verbunden and r.host_timer is None) or (r.host_wunsch == pid and r.stand is None):
            r.host = m.id
        if r.host == m.id:
            if r.host_timer:
                r.host_timer.cancel()
                r.host_timer = None
            await self.stand_an_host(r)
        await self.verteilen(r)
        return m

    async def getrennt(self, r: Raum, m: Mitglied, ws: WebSocket) -> None:
        if m.ws is not ws:          # schon von einem anderen Tab übernommen
            return
        m.ws, m.getrennt_seit = None, time.time()
        if not r.verbundene():
            r.leer_seit = time.time()
        if r.host == m.id:
            self.host_spaeter_pruefen(r)
        await self.verteilen(r)

    async def entfernen(self, r: Raum, m: Mitglied, code: int, grund: str) -> None:
        r.mitglieder.pop(m.id, None)
        ws, m.ws = m.ws, None
        if ws is not None:
            try:
                await ws.close(code, grund)
            except Exception:
                pass
        if not r.verbundene():
            r.leer_seit = time.time()
        if r.host == m.id:
            r.host = None
            await self.host_wechseln(r, self.nachfolger(r))
        await self.verteilen(r)

    # ---------- Nachrichten ----------

    async def bearbeiten(self, r: Raum, m: Mitglied, roh: str) -> None:
        try:
            n = json.loads(roh)
        except ValueError:
            return await self.senden(m, {"t": "fehler", "text": "Nachricht ist kein JSON."})
        if not isinstance(n, dict):
            return
        art = n.get("t")
        ist_host = r.host == m.id
        if art == "an":
            if len(roh) > NACHRICHT_MAX + 200:
                raise Abweisung(4009, "Nachricht zu groß (höchstens 64 KB).")
            ziel = n.get("an", "alle")
            if ziel == "alle":
                empfaenger = [x for x in r.verbundene() if x.id != m.id]
            elif ziel == "host":
                empfaenger = [x for x in r.verbundene() if x.id == r.host and x.id != m.id]
            else:
                ids = ziel if isinstance(ziel, list) else [ziel]
                ids = {i for i in ids if isinstance(i, str)}
                empfaenger = [x for x in r.verbundene() if x.id in ids]
            text = json.dumps({"t": "nachricht", "von": m.id, "daten": n.get("daten")}, ensure_ascii=False, separators=(",", ":"))
            for x in empfaenger:
                await self.senden(x, text)
        elif art == "stand":
            if not ist_host:
                return await self.senden(m, {"t": "fehler", "text": "Nur der Host legt den Spielstand ab."})
            text = json.dumps(n.get("daten"), ensure_ascii=False, separators=(",", ":"))
            if len(text.encode()) > STAND_MAX:
                return await self.senden(m, {"t": "fehler", "text": "Spielstand zu groß (höchstens 256 KB)."})
            r.stand = text
        elif art == "rauswerfen":
            ziel = r.mitglieder.get(n.get("wer")) if isinstance(n.get("wer"), str) else None
            if not ist_host or ziel is None or ziel.id == m.id:
                return await self.senden(m, {"t": "fehler", "text": "Rauswerfen darf nur der Host, und nur andere."})
            if ziel.pid != m.pid and not ziel.bot:      # sich selbst im zweiten Tab (Entwurf) nicht für immer aussperren
                r.gesperrt.add(ziel.pid)
            await self.entfernen(r, ziel, 4001, f"{m.name} hat dich aus dem Raum geworfen.")
        elif art == "host":
            ziel = r.mitglieder.get(n.get("wer")) if isinstance(n.get("wer"), str) else None
            if not ist_host or ziel is None or not ziel.mensch_da:
                return await self.senden(m, {"t": "fehler", "text": "Den Host weitergeben darf nur der Host, an einen verbundenen Spieler."})
            await self.host_wechseln(r, ziel)
        elif art == "offen":
            if not ist_host:
                return
            r.offen = n.get("an") is True
            await self.verteilen(r)
        elif art == "verlassen":
            await self.entfernen(r, m, 1000, "Raum verlassen")
        elif art == "bot":
            stufe = n.get("stufe")
            if not ist_host:
                return await self.senden(m, {"t": "fehler", "text": "Bots setzt nur der Host."})
            if stufe not in r.bots:
                return await self.senden(m, {"t": "fehler", "text": "Dieses Spiel hat keine Bots mit dieser Stufe."})
            if len(r.spieler()) >= r.max:
                return await self.senden(m, {"t": "fehler", "text": "Kein Platz mehr frei."})
            self.bot_setzen(r, stufe)
            await self.verteilen(r)
        elif art == "spiel" and r.art == "gruppe":
            if not ist_host:
                return await self.senden(m, {"t": "fehler", "text": "Das Spiel sucht der Host der Gruppe aus."})
            fehler = await self.spiel_fuer_gruppe(r, m, n.get("spiel"))
            if fehler:
                return await self.senden(m, {"t": "fehler", "text": fehler})
        elif art == "zurueck" and r.art == "gruppe":
            if ist_host and r.aktuell:
                r.aktuell = None
                await self.verteilen(r)

    def bot_setzen(self, r: Raum, stufe: str, bot_id: str | None = None, name: str | None = None) -> Mitglied:
        if bot_id is None:
            n = 1
            while f"bot~{n}" in r.mitglieder:
                n += 1
            bot_id, name = f"bot~{n}", f"Bot {n} ({stufe[:1].upper() + stufe[1:]})"
        b = Mitglied(id=bot_id, pid=BOT_PID, tab=None, name=name or bot_id, zuschauer=False, seit=time.time(), bot=stufe)
        r.mitglieder[bot_id] = b
        return b

    async def spiel_fuer_gruppe(self, g: Raum, m: Mitglied, sid: object) -> str | None:
        """Wird von registrieren() gesetzt (braucht die Spiele-Prüfung)."""
        return "Spiele auswählen geht gerade nicht."


class Abweisung(Exception):
    def __init__(self, code: int, text: str):
        super().__init__(text)
        self.code, self.text = code, text


def registrieren(app: FastAPI, e, db, spieler, crm) -> Raeume:
    def name_von(pid: str) -> str:
        p = crm.person(pid) if crm else None
        return ((p or {}).get("anzeigename") or "").strip() or identitaet.handle(pid) or pid

    raeume = Raeume(name_von)
    app.state.raeume = raeume

    def spiel_pruefen(conn, user: str, game: str, player: str) -> tuple[str, dict, bool]:
        """Wie spiel() in app.py: Entwürfe nur für den Entwickler selbst und echte Admins. Dazu: Multiplayer in game.json."""
        entwurf = game.endswith(versionen.ENTWURF)
        if entwurf:
            basis = game[: -len(versionen.ENTWURF)]
            darf = identitaet.ordner(player) == user or rollen.rolle(e, conn, player)["echterAdmin"]
            ordner = e.spiele_dir / user / game
            if not (darf and games.gueltige_id(user, basis) and ordner.is_dir() and not ordner.is_symlink()):
                raise Abweisung(4404, "Spiel nicht gefunden.")
        else:
            ordner = games.spielordner(e.spiele_dir, user, game)
            if not ordner:
                raise Abweisung(4404, "Spiel nicht gefunden.")
        mp = games.multiplayer(games.meta(ordner)[0])
        if not mp:
            raise Abweisung(4004, "Dieses Spiel ist kein Multiplayer-Spiel (game.json: \"multiplayer\").")
        return f"{user}/{game}", mp, entwurf

    def stufe_im_spiel(stufe: str, stufen: list[str]) -> str:
        """Bot der Gruppe (leicht/mittel/schwer) → passende Stufe des Spiels (gleicher Name oder gleiche Lage)."""
        if stufe in stufen:
            return stufe
        i = GRUPPE_STUFEN.index(stufe) if stufe in GRUPPE_STUFEN else 1
        return stufen[int(i * (len(stufen) - 1) / (len(GRUPPE_STUFEN) - 1) + 0.5)]   # kaufmännisch runden

    async def spiel_fuer_gruppe(g: Raum, m: Mitglied, sid: object) -> str | None:
        if not isinstance(sid, str) or sid.count("/") != 1:
            return "Unbekanntes Spiel."
        user, game = sid.split("/")
        if game.endswith(versionen.ENTWURF):
            return "Entwürfe kann man nicht in einer Gruppe spielen."
        try:
            sid, mp, _ = spiel_pruefen(m.ws, user, game, m.pid)
        except Abweisung as a:
            return a.text
        menschen = [x for x in g.mitglieder.values() if not x.bot and x.mensch_da]
        bots = [x for x in g.mitglieder.values() if x.bot]
        anzahl = len(menschen) + len(bots)
        if bots and not mp["bots"]:
            return "Dieses Spiel hat keine Bots – nimm die Bots aus der Gruppe oder such ein anderes Spiel aus."
        if not mp["min"] <= anzahl <= mp["max"]:
            spanne = f"{mp['min']}" if mp["min"] == mp["max"] else f"{mp['min']}–{mp['max']}"
            return f"Dieses Spiel ist für {spanne} Spieler, ihr seid {anzahl}."
        raeume.aufraeumen()
        if len(raeume.raeume) >= RAEUME_MAX:
            return "Gerade sind zu viele Räume offen – bitte später noch einmal."
        r = Raum(code=raeume.neuer_code(), spiel=sid, min=mp["min"], max=mp["max"], entwurf=False, bots=mp["bots"],
                 offen=False, gruppe=g.code, host_wunsch=(g.mitglieder[g.host].pid if g.host in g.mitglieder else None))
        r.leer_seit = time.time()        # kommt niemand, räumt aufraeumen() den Raum nach 15 Minuten weg
        for b in bots:
            raeume.bot_setzen(r, stufe_im_spiel(b.bot, mp["bots"]), b.id, b.name)
        raeume.raeume[r.code] = r
        try:
            titel = games.beschreibung(e.spiele_dir, user, game)["title"]
        except Exception:
            titel = game
        g.aktuell = {"spiel": sid, "code": r.code, "titel": titel}
        log.info("Gruppe %s spielt %s (Raum %s)", g.code, sid, r.code)
        await raeume.verteilen(g)
        return None

    raeume.spiel_fuer_gruppe = spiel_fuer_gruppe

    def http_spiel(request: Request, user: str, game: str, player: str):
        try:
            return spiel_pruefen(request, user, game, player)
        except Abweisung as a:
            raise HTTPException(404, a.text) from None

    @app.post("/api/mp/gruppe/einladen")
    def gruppe_einladen(player: str = Depends(spieler), body: dict = Body(...)):
        """Mitspieler über die Glocke in die Gruppe einladen (1.6.2). Nur wer selbst in der Gruppe ist."""
        code, an = body.get("code"), body.get("an")
        g = raeume.raeume.get(code) if isinstance(code, str) else None
        if not g or g.art != "gruppe" or not any(m.pid == player and m.mensch_da for m in g.mitglieder.values()):
            raise HTTPException(404, "Gruppe nicht gefunden")
        ziele = einladungs_ziele(an, player)
        for pid in ziele:
            db.melden(pid, f"{name_von(player)} lädt dich in die Gruppe {g.code} ein.", f"#/gruppe/{g.code}")
        return {"eingeladen": len(ziele)}

    def einladungs_ziele(an, player: str) -> list[str]:
        if not isinstance(an, list) or not an or len(an) > 10 or not all(isinstance(x, str) for x in an):
            raise HTTPException(422, "an: Liste mit 1 bis 10 Spielern")
        ziele = []
        for name in an:
            pid = identitaet.id_von(name)
            person = crm.person(pid) if (crm and pid) else None
            if not pid or not person or person.get("status") not in ("aktiv", "verwarnt", "eingeladen") or pid == player:
                raise HTTPException(404, f"Spieler {name} nicht gefunden")
            ziele.append(pid)
        if not raeume.darf_einladen(player, len(ziele)):
            raise HTTPException(429, "Zu viele Einladungen – in ein paar Minuten wieder.")
        return ziele

    @app.get("/api/mp/{user}/{game}/raeume")
    def offene_raeume(request: Request, user: str = P(...), game: str = P(...), player: str = Depends(spieler)):
        sid, mp, _ = http_spiel(request, user, game, player)
        return {"raeume": raeume.offene(sid, player), "min": mp["min"], "max": mp["max"]}

    @app.get("/api/mp/mitspieler")
    def mitspieler(player: str = Depends(spieler)):
        """Wen man einladen kann: alle aktiven Personen außer einem selbst (Anzeigenamen sind in der Bibliothek ohnehin öffentlich)."""
        liste = [{"id": p["name"], "name": name_von(p["name"])} for p in (crm.personen() if crm else [])
                 if p.get("status") in ("aktiv", "verwarnt") and p["name"] != player and "~" not in p["name"]]
        return sorted(liste, key=lambda x: x["name"].lower())

    @app.post("/api/mp/{user}/{game}/einladen")
    def einladen(request: Request, user: str = P(...), game: str = P(...), player: str = Depends(spieler),
                 body: dict = Body(...)):
        """Mitspieler über die Glocke einladen. Nur wer selbst gerade im Raum ist."""
        sid, _, entwurf = http_spiel(request, user, game, player)
        if entwurf:
            raise HTTPException(422, "Einladungen gibt es erst, wenn das Spiel veröffentlicht ist.")
        code, an = body.get("code"), body.get("an")
        r = raeume.raeume.get(code) if isinstance(code, str) else None
        if not r or r.spiel != sid or not any(m.pid == player and m.verbunden for m in r.mitglieder.values()):
            raise HTTPException(404, "Raum nicht gefunden")
        ziele = einladungs_ziele(an, player)
        titel = games.beschreibung(e.spiele_dir, user, game)["title"]
        for pid in ziele:
            db.melden(pid, f"{name_von(player)} lädt dich zu „{titel}“ ein (Raum {r.code}).", f"#/spiel/{sid}?raum={r.code}")
        return {"eingeladen": len(ziele)}

    @app.websocket("/api/mp/gruppe")
    async def gruppe_verbindung(ws: WebSocket):
        await verbindung(ws, None, None)

    @app.websocket("/api/mp/{user}/{game}")
    async def verbindung(ws: WebSocket, user: str | None, game: str | None):
        # Nur die Bibliothek selbst (gleiche Herkunft) – sonst könnte eine fremde Seite mit der Anmeldung des Besuchers mitspielen
        herkunft, host = ws.headers.get("origin"), ws.headers.get("host")
        await ws.accept()
        gruppe = user is None
        try:
            if not herkunft or urlsplit(herkunft).netloc != host:
                raise Abweisung(4003, "Verbindung nur aus der Bibliothek.")
            if notaus.aktiv(e.users_file.parent):
                raise Abweisung(4503, notaus.MELDUNG)
            try:
                player = spieler(ws)
            except HTTPException as f:
                raise Abweisung(4401 if f.status_code == 401 else 4403, str(f.detail)) from None
            if gruppe:
                sid, mp, entwurf = "gruppe", {"min": 1, "max": GRUPPE_MAX, "bots": GRUPPE_STUFEN}, False
            else:
                sid, mp, entwurf = spiel_pruefen(ws, user, game, player)
            q = ws.query_params
            tab = q.get("tab") if TAB_MUSTER.match(q.get("tab") or "") else None
            raeume.aufraeumen()
            if q.get("neu") == "1":
                if len(raeume.raeume) >= RAEUME_MAX:
                    raise Abweisung(4429, "Gerade sind zu viele Räume offen – bitte später noch einmal.")
                if not raeume.darf_neu(player):
                    raise Abweisung(4429, "Zu viele neue Räume in kurzer Zeit – bitte kurz warten.")
                r = Raum(code=raeume.neuer_code(), spiel=sid, min=mp["min"], max=mp["max"], entwurf=entwurf, bots=mp["bots"],
                         art="gruppe" if gruppe else "spiel")
                raeume.raeume[r.code] = r
            else:
                code = (q.get("raum") or "").strip().upper()
                r = raeume.raeume.get(code) if CODE_MUSTER.match(code) else None
                if r is None or r.spiel != sid:
                    raise Abweisung(4404, "Diesen Raum gibt es nicht (mehr).")
                if player in r.gesperrt:
                    raise Abweisung(4001, "Du wurdest aus diesem Raum geworfen.")
            m = await raeume.beitreten(r, ws, player, tab, q.get("zuschauer") == "1")
        except Abweisung as a:
            try:
                await ws.close(a.code, a.text[:120])
            except Exception:
                pass
            return
        takt = Takt()
        try:
            while True:
                roh = await ws.receive_text()
                if roh == "ping":
                    await ws.send_text("pong")
                    continue
                if not takt.erlaubt():
                    raise Abweisung(4008, "Zu viele Nachrichten – höchstens 40 je Sekunde.")
                if len(roh) > STAND_MAX + 1024:
                    raise Abweisung(4009, "Nachricht zu groß.")
                if r.mitglieder.get(m.id) is not m or m.ws is not ws:
                    break       # rausgeworfen oder in einem anderen Tab übernommen
                await raeume.bearbeiten(r, m, roh)
                if r.mitglieder.get(m.id) is not m:
                    break       # selbst verlassen
        except Abweisung as a:
            try:
                await ws.close(a.code, a.text[:120])
            except Exception:
                pass
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            if r.mitglieder.get(m.id) is m:
                await raeume.getrennt(r, m, ws)

    return raeume
