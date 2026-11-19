"""MCP-Server für die KIs der Entwickler (Zentrale 1.6.0, E88).

Spezifikation: seb-brain → Projekte/Spielebibliothek/Architektur/Multiplayer-und-MCP

Alle Entwickler bauen ihre Spiele mit Claude. Über diesen Server kann Claude das Entwickler-Handbuch lesen, die
Startvorlage holen, die eigenen Spiele ansehen, Entwürfe hochladen, die Prüfung und die Fehlerberichte abrufen.
**Veröffentlichen kann Claude nicht** – das macht der Entwickler selbst im Update-Fenster auf der Upload-Seite.

Läuft im Upload-Dienst (der darf als Einziger Spieldateien schreiben), erreichbar unter mcp.cuby0401.uk – OHNE
Cloudflare Access, weil eine KI keinen E-Mail-Code eingeben kann. Die Anmeldung macht dieser Server selbst:
  - Claude Code: Schlüssel je Entwickler, auf der Upload-Seite erstellt und widerrufen (Header „Authorization: Bearer …“)
  - Claude-App (claude.ai, Desktop): OAuth 2.1 mit PKCE und dynamischer Registrierung. Freigegeben wird auf der
    Upload-Seite (dort gelten Cloudflare Access UND das Upload-Passwort).
Gespeichert werden nur Hashes der Schlüssel (upload.db). Ein Schlüssel kann nur an die Spiele seines Entwicklers.

Andere KIs (ChatGPT …) sind nicht verboten, bekommen aber bei jeder Antwort einen Hinweis (Seb, 17.11.2026).
"""

import base64
import hashlib
import html.parser
import io
import json
import logging
import re
import secrets
import sqlite3
import time
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

from fastapi import Body, Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from . import games, versionen

log = logging.getLogger("savesvc.mcp")

PROTOKOLLE = ("2025-06-18", "2025-03-26", "2024-11-05")
ZUGRIFF_GILT = 3600                    # s: Zugriffs-Token der Claude-App
ERNEUERN_GILT = 30 * 86400             # s: Erneuerungs-Token
CODE_GILT = 300                        # s: Freigabe-Code
MCP_BODY_MAX = 30 * 1024 * 1024        # ein Upload über MCP (JSON mit Dateien)
DATEI_LESEN_MAX = 300 * 1024           # eine Datei über „dateien“ lesen
SCHLUESSEL_MAX = 10                    # Claude-Code-Schlüssel je Entwickler
CLIENTS_PRO_STUNDE = 200               # dynamische Registrierungen (alle zusammen)
CLIENTS_PRO_IP = 10                    # … und je IP-Adresse (1.6.2), damit einer allein die Grenze nicht für alle ausschöpft
# Rücksprung-Adressen der Claude-App (1.6.2). Claude Code meldet sich lokal (http://localhost:<port>/…).
CLAUDE_RUECKSPRUNG = {("claude.ai", "/api/mcp/auth_callback"), ("claude.com", "/api/mcp/auth_callback")}
HINWEIS_ANDERE_KI = ("Hinweis: Die Spielebibliothek ist für Claude gebaut und nur damit getestet. Mit einer anderen KI kann "
                     "manches anders laufen – bei Problemen bitte Claude (Claude Code oder die Claude-App) benutzen.")
PFAD_MUSTER = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.?(?:/|$))[A-Za-z0-9 ._()+\-/]{1,200}$")
TEXT_ENDUNGEN = {".html", ".htm", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".md"}


def jetzt_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Zugaenge:
    """Schlüssel (Claude Code), OAuth-Zugänge (Claude-App), registrierte Clients und Freigabe-Codes in upload.db."""

    def __init__(self, pfad: Path):
        self.pfad = pfad
        with self._v() as v:
            v.executescript("""
                CREATE TABLE IF NOT EXISTS mcp_zugang (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, art TEXT NOT NULL, name TEXT NOT NULL,
                    client_id TEXT, hash TEXT UNIQUE, ablauf REAL, erneuern_hash TEXT UNIQUE, erneuern_ablauf REAL,
                    erstellt TEXT NOT NULL, zuletzt TEXT, widerrufen TEXT);
                CREATE TABLE IF NOT EXISTS mcp_clients (
                    client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, erstellt TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS mcp_codes (
                    hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, player TEXT NOT NULL, redirect_uri TEXT NOT NULL,
                    challenge TEXT NOT NULL, ablauf REAL NOT NULL);
            """)
        self._zuletzt: dict[int, float] = {}

    @contextmanager
    def _v(self):
        v = sqlite3.connect(self.pfad, timeout=10, isolation_level=None)
        v.row_factory = sqlite3.Row
        try:
            yield v
        finally:
            v.close()

    # ---------- Schlüssel und Zugänge ----------

    def schluessel_neu(self, player: str, name: str) -> tuple[int, str]:
        with self._v() as v:
            n = v.execute("SELECT COUNT(*) FROM mcp_zugang WHERE player=? AND art='schluessel' AND widerrufen IS NULL",
                          (player,)).fetchone()[0]
            if n >= SCHLUESSEL_MAX:
                raise HTTPException(409, f"Höchstens {SCHLUESSEL_MAX} Schlüssel – bitte erst einen alten widerrufen.")
            token = "sbk_" + secrets.token_urlsafe(32)
            c = v.execute("INSERT INTO mcp_zugang (player, art, name, hash, erstellt) VALUES (?,?,?,?,?)",
                          (player, "schluessel", name, _hash(token), jetzt_iso()))
            return c.lastrowid, token

    def oauth_neu(self, player: str, client_id: str, name: str) -> dict:
        zugriff, erneuern = "sba_" + secrets.token_urlsafe(32), "sbr_" + secrets.token_urlsafe(32)
        with self._v() as v:
            v.execute("INSERT INTO mcp_zugang (player, art, name, client_id, hash, ablauf, erneuern_hash, erneuern_ablauf, erstellt) "
                      "VALUES (?,?,?,?,?,?,?,?,?)", (player, "oauth", name, client_id, _hash(zugriff), time.time() + ZUGRIFF_GILT,
                                                       _hash(erneuern), time.time() + ERNEUERN_GILT, jetzt_iso()))
        return {"access_token": zugriff, "token_type": "Bearer", "expires_in": ZUGRIFF_GILT, "refresh_token": erneuern, "scope": "spiele"}

    def erneuern(self, token: str, client_id: str, zugelassen=None) -> dict | None:
        """Erneuerungs-Token einlösen: beide Tokens werden ersetzt (das alte Erneuerungs-Token gilt nicht mehr)."""
        zugriff, erneuern = "sba_" + secrets.token_urlsafe(32), "sbr_" + secrets.token_urlsafe(32)
        with self._v() as v:
            z = v.execute("SELECT id, player FROM mcp_zugang WHERE erneuern_hash=? AND client_id=? AND widerrufen IS NULL AND erneuern_ablauf > ?",
                          (_hash(token), client_id, time.time())).fetchone()
            if not z or (zugelassen is not None and not zugelassen(z["player"])):
                return None
            v.execute("UPDATE mcp_zugang SET hash=?, ablauf=?, erneuern_hash=?, erneuern_ablauf=? WHERE id=?",
                      (_hash(zugriff), time.time() + ZUGRIFF_GILT, _hash(erneuern), time.time() + ERNEUERN_GILT, z["id"]))
        return {"access_token": zugriff, "token_type": "Bearer", "expires_in": ZUGRIFF_GILT, "refresh_token": erneuern, "scope": "spiele"}

    def pruefen(self, token: str) -> str | None:
        if not token or len(token) > 200:
            return None
        with self._v() as v:
            z = v.execute("SELECT id, player, ablauf FROM mcp_zugang WHERE hash=? AND widerrufen IS NULL", (_hash(token),)).fetchone()
            if not z or (z["ablauf"] is not None and z["ablauf"] < time.time()):
                return None
            if time.monotonic() - self._zuletzt.get(z["id"], -1e9) > 300:      # „zuletzt benutzt“ höchstens alle 5 Minuten
                self._zuletzt[z["id"]] = time.monotonic()
                v.execute("UPDATE mcp_zugang SET zuletzt=? WHERE id=?", (jetzt_iso(), z["id"]))
            return z["player"]

    def liste(self, player: str) -> list[dict]:
        with self._v() as v:
            zeilen = v.execute("SELECT id, art, name, erstellt, zuletzt, erneuern_ablauf FROM mcp_zugang WHERE player=? AND widerrufen IS NULL "
                               "ORDER BY id DESC", (player,)).fetchall()
        return [{"id": z["id"], "art": z["art"], "name": z["name"], "erstellt": z["erstellt"], "zuletzt": z["zuletzt"]}
                for z in zeilen if z["art"] == "schluessel" or (z["erneuern_ablauf"] or 0) > time.time()]

    def widerrufen(self, player: str, zugang_id: int) -> bool:
        with self._v() as v:
            return v.execute("UPDATE mcp_zugang SET widerrufen=? WHERE id=? AND player=? AND widerrufen IS NULL",
                             (jetzt_iso(), zugang_id, player)).rowcount > 0

    def alle_widerrufen(self, player: str) -> int:
        with self._v() as v:
            return v.execute("UPDATE mcp_zugang SET widerrufen=? WHERE player=? AND widerrufen IS NULL", (jetzt_iso(), player)).rowcount

    # ---------- OAuth: Clients und Codes ----------

    def client_neu(self, name: str, uris: list[str]) -> str:
        client_id = "sbc_" + secrets.token_urlsafe(16)
        with self._v() as v:
            v.execute("INSERT INTO mcp_clients (client_id, name, redirect_uris, erstellt) VALUES (?,?,?,?)",
                      (client_id, name, json.dumps(uris), jetzt_iso()))
            # alte, nie benutzte Registrierungen aufräumen (höchstens 1000 behalten)
            v.execute("DELETE FROM mcp_clients WHERE client_id NOT IN (SELECT client_id FROM mcp_clients ORDER BY erstellt DESC LIMIT 1000) "
                      "AND client_id NOT IN (SELECT client_id FROM mcp_zugang WHERE client_id IS NOT NULL)")
        return client_id

    def client(self, client_id: str) -> dict | None:
        with self._v() as v:
            z = v.execute("SELECT * FROM mcp_clients WHERE client_id=?", (client_id,)).fetchone()
        return {"client_id": z["client_id"], "name": z["name"], "redirect_uris": json.loads(z["redirect_uris"])} if z else None

    def code_neu(self, client_id: str, player: str, redirect_uri: str, challenge: str) -> str:
        code = secrets.token_urlsafe(32)
        with self._v() as v:
            v.execute("DELETE FROM mcp_codes WHERE ablauf < ?", (time.time(),))
            v.execute("INSERT INTO mcp_codes (hash, client_id, player, redirect_uri, challenge, ablauf) VALUES (?,?,?,?,?,?)",
                      (_hash(code), client_id, player, redirect_uri, challenge, time.time() + CODE_GILT))
        return code

    def code_einloesen(self, code: str, client_id: str, redirect_uri: str, verifier: str) -> str | None:
        with self._v() as v:
            z = v.execute("SELECT * FROM mcp_codes WHERE hash=?", (_hash(code or ""),)).fetchone()
            if z:
                v.execute("DELETE FROM mcp_codes WHERE hash=?", (z["hash"],))       # jeder Code nur einmal
        if not z or z["ablauf"] < time.time() or z["client_id"] != client_id or z["redirect_uri"] != redirect_uri:
            return None
        erwartet = base64.urlsafe_b64encode(hashlib.sha256((verifier or "").encode()).digest()).rstrip(b"=").decode()
        if not secrets.compare_digest(erwartet, z["challenge"]):
            return None
        return z["player"]


# ---------- Handbuch als Text ----------

class _HandbuchText(html.parser.HTMLParser):
    """Handbuch-HTML → schlichter Text mit Überschriften (##), Listen (-) und Code-Blöcken (```), je Kapitel (h2 mit id)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.kapitel: list[dict] = []
        self.teile: list[str] = []
        self.in_main = 0
        self.ueberspringen = 0
        self.pre = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "nav"):
            self.ueberspringen += 1
        if tag == "main":
            self.in_main += 1
        if tag == "h2":
            self.kapitel.append({"id": a.get("id") or str(len(self.kapitel) + 1), "titel": "", "teile": []})
            self.teile = self.kapitel[-1]["teile"]
            self._titel = True
            self.teile.append("\n## ")
        elif tag == "h3":
            self.teile.append("\n\n### ")
        elif tag == "pre":
            self.pre = True
            self.teile.append("\n```\n")
        elif tag == "li":
            self.teile.append("\n- ")
        elif tag in ("p", "div", "tr", "dt"):
            self.teile.append("\n")
        elif tag == "br":
            self.teile.append("\n")
        elif tag == "code" and not self.pre:
            self.teile.append("`")
        elif tag in ("td", "th"):
            self.teile.append(" | ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav"):
            self.ueberspringen = max(0, self.ueberspringen - 1)
        if tag == "h2":
            self._titel = False
            self.teile.append("\n")
        elif tag == "pre":
            self.pre = False
            self.teile.append("\n```\n")
        elif tag == "code" and not self.pre:
            self.teile.append("`")
        elif tag in ("p", "ul", "ol", "table", "h3"):
            self.teile.append("\n")

    def handle_data(self, data):
        if self.ueberspringen or not self.kapitel:
            return
        if not self.pre:
            data = re.sub(r"\s+", " ", data)
        self.teile.append(data)
        if getattr(self, "_titel", False):
            self.kapitel[-1]["titel"] += data


def handbuch_kapitel(pfad: Path) -> list[dict]:
    p = _HandbuchText()
    p.feed(pfad.read_text(encoding="utf-8"))
    ergebnis = []
    for k in p.kapitel:
        text = re.sub(r"\n{3,}", "\n\n", "".join(k["teile"])).strip()
        text = re.sub(r"[ \t]+\n", "\n", text)
        ergebnis.append({"id": k["id"], "titel": k["titel"].strip(), "text": text})
    return ergebnis


# ---------- Werkzeuge ----------

WERKZEUGE = [
    {"name": "handbuch", "title": "Entwickler-Handbuch lesen",
     "description": "Liest das Entwickler-Handbuch der Spielebibliothek. Ohne Kapitel: Inhaltsverzeichnis. Vor dem ersten Spiel "
                    "unbedingt lesen – besonders „regeln“, „gamesave“, „gamejson“ und für Spiele mit mehreren Spielern „multiplayer“. "
                    "kapitel=\"alles\" liefert das ganze Handbuch.",
     "inputSchema": {"type": "object", "properties": {"kapitel": {"type": "string", "description": "Kapitel-ID (z. B. multiplayer), Nummer oder „alles“"}}},
     "annotations": {"readOnlyHint": True}},
    {"name": "vorlage", "title": "Startvorlage holen",
     "description": "Liefert die Dateien der Startvorlage (index.html, game.json, KI-Anweisung). art=\"multiplayer\" liefert das "
                    "Multiplayer-Beispiel „Vier gewinnt“ (Regeln laufen beim Host, GameSave.multiplayer.spiel).",
     "inputSchema": {"type": "object", "properties": {"art": {"type": "string", "enum": ["einzelspieler", "multiplayer"]}}},
     "annotations": {"readOnlyHint": True}},
    {"name": "meine_spiele", "title": "Meine Spiele",
     "description": "Listet die Spiele des angemeldeten Entwicklers: Ordnername, Titel, veröffentlichte Version, ob ein Entwurf da ist, "
                    "Speicher. Den Ordnernamen braucht man für alle anderen Werkzeuge.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}},
    {"name": "dateien", "title": "Dateien eines Spiels ansehen",
     "description": "Ohne pfad: Liste aller Dateien eines eigenen Spiels. Mit pfad: Inhalt einer Textdatei (höchstens 300 KB). "
                    "stand=\"entwurf\" (Standard, falls vorhanden) oder \"live\" (veröffentlichte Version).",
     "inputSchema": {"type": "object", "required": ["ordner"], "properties": {
         "ordner": {"type": "string"}, "stand": {"type": "string", "enum": ["entwurf", "live"]}, "pfad": {"type": "string"}}},
     "annotations": {"readOnlyHint": True}},
    {"name": "hochladen", "title": "Entwurf hochladen",
     "description": "Lädt ein Spiel als ENTWURF hoch (nie direkt live). dateien: Liste aus {pfad, inhalt}; Bilder und andere "
                    "Binärdateien mit base64=true. modus=\"ersetzen\" (Standard): der Entwurf besteht genau aus diesen Dateien. "
                    "modus=\"ergaenzen\": nur die genannten Dateien ändern, der Rest bleibt wie im bisherigen Entwurf bzw. in der "
                    "Live-Version; loeschen entfernt Dateien. aenderung: ein Satz, was neu ist (steht später im Update-Fenster). "
                    "Danach bekommt der Entwickler zwei Links: zum Testen in der Bibliothek und zum Veröffentlichen. "
                    "Veröffentlichen kann nur der Entwickler selbst – sag ihm das.",
     "inputSchema": {"type": "object", "required": ["ordner", "dateien", "aenderung"], "properties": {
         "ordner": {"type": "string", "description": "Ordnername des Spiels (a–z, 0–9, . _ -). Gleicher Name = Update, neuer Name = neues Spiel"},
         "dateien": {"type": "array", "items": {"type": "object", "required": ["pfad", "inhalt"], "properties": {
             "pfad": {"type": "string"}, "inhalt": {"type": "string"}, "base64": {"type": "boolean"}}}},
         "aenderung": {"type": "string", "description": "Was ist neu? Ein kurzer Satz für die Spieler"},
         "modus": {"type": "string", "enum": ["ersetzen", "ergaenzen"]},
         "loeschen": {"type": "array", "items": {"type": "string"}}}},
     "annotations": {"destructiveHint": False, "idempotentHint": False}},
    {"name": "pruefung", "title": "Prüfung des Entwurfs",
     "description": "Zeigt die Prüfung vor dem Veröffentlichen (Fehler, Warnungen, ob der Entwurf schon getestet wurde) und die Links "
                    "zum Testen und Veröffentlichen.",
     "inputSchema": {"type": "object", "required": ["ordner"], "properties": {"ordner": {"type": "string"}}},
     "annotations": {"readOnlyHint": True}},
    {"name": "fehlerberichte", "title": "Fehlerberichte",
     "description": "JavaScript-Fehler, die beim Spielen der eigenen Spiele (auch der Entwürfe) aufgetreten sind – mit Datei, Zeile und Stacktrace.",
     "inputSchema": {"type": "object", "properties": {"ordner": {"type": "string"}}}, "annotations": {"readOnlyHint": True}},
]

ANLEITUNG = ("Spielebibliothek: Browser-Spiele der Kollegen auf Sebs NAS. Arbeitsweise: 1) handbuch lesen (Inhaltsverzeichnis, "
             "dann die nötigen Kapitel; für Spiele mit mehreren Spielern das Kapitel „multiplayer“). 2) vorlage holen und darauf "
             "aufbauen. 3) hochladen – landet immer als Entwurf. 4) Dem Entwickler den Test-Link geben; nach dem Testen pruefung "
             "und fehlerberichte ansehen. 5) Veröffentlichen macht der Entwickler selbst über den Link zur Upload-Seite.")


class McpFehler(Exception):
    def __init__(self, text: str):
        super().__init__(text)
        self.text = text


def registrieren(app: FastAPI, e, store, zugaenge: Zugaenge, spieler, angemeldet, *, spiele_von, entwurf_installieren,
                 pruefung, ordnerpfad, speicher, handbuch_dir: Path, mcp_url: str, upload_url: str, games_url: str,
                 zugelassen=None) -> None:
    """zugelassen(player) → False, wenn die Person im CRM gesperrt oder archiviert ist (1.6.2): Sie steht dann nicht mehr in
    users.yaml. Ohne diese Prüfung behielte sie über einen Schlüssel den Zugang, denn vor /mcp steht kein Cloudflare Access."""
    zugelassen = zugelassen or (lambda player: True)
    mcp_url, upload_url, games_url = mcp_url.rstrip("/"), upload_url.rstrip("/"), games_url.rstrip("/")
    sitzungen: dict[str, bool] = {}            # Mcp-Session-Id → ist Claude?
    registrierungen: list[tuple[float, str]] = []   # (Zeit, IP)

    def links(player: str, ordner: str) -> dict:
        return {"testen": f"{games_url}/#/entwurf/{player}/{ordner}", "veroeffentlichen": f"{upload_url}/#spiel-{ordner}"}

    # ---------- Werkzeuge ausführen ----------

    def w_handbuch(player: str, a: dict) -> Any:
        datei = handbuch_dir / "index.html"
        if not datei.is_file():
            raise McpFehler("Handbuch nicht gefunden – bitte Seb Bescheid geben.")
        kapitel = handbuch_kapitel(datei)
        wahl = str(a.get("kapitel") or "").strip().lower()
        if not wahl:
            return "Entwickler-Handbuch – Kapitel (mit kapitel=<id> lesen, „alles“ für alles):\n" + "\n".join(
                f"- {k['id']}: {k['titel']}" for k in kapitel)
        if wahl == "alles":
            return "\n\n".join(k["text"] for k in kapitel)
        for k in kapitel:
            nummer = k["titel"].split(".", 1)[0].strip().lower()
            if wahl in (k["id"].lower(), nummer) or wahl in k["titel"].lower():
                return k["text"]
        raise McpFehler(f"Kapitel „{wahl}“ gibt es nicht. Vorhanden: " + ", ".join(k["id"] for k in kapitel))

    def w_vorlage(player: str, a: dict) -> Any:
        name = "multiplayer-vorlage.zip" if a.get("art") == "multiplayer" else "startvorlage.zip"
        datei = handbuch_dir / name
        if not datei.is_file():
            raise McpFehler("Vorlage nicht gefunden – bitte Seb Bescheid geben.")
        teile = []
        with zipfile.ZipFile(datei) as z:
            for info in z.infolist():
                if info.is_dir() or info.file_size > 200 * 1024:
                    continue
                pfad = info.filename.split("/", 1)[-1]
                try:
                    teile.append(f"===== {pfad} =====\n{z.read(info).decode('utf-8')}")
                except UnicodeDecodeError:
                    teile.append(f"===== {pfad} ===== (Binärdatei, {info.file_size} Bytes)")
        return "\n\n".join(teile)

    def w_meine_spiele(player: str, a: dict) -> Any:
        return [{"ordner": s["ordner"], "titel": s["title"], "version": s["version"], "entwurf": bool(s["entwurf"]),
                 "veroeffentlicht": bool(s["live"]), "warnung": s["warning"],
                 "speicherBytes": sum(s["speicher"].values()), **links(player, s["ordner"])} for s in spiele_von(player)]

    def spielordner(player: str, a: dict, stand: str | None = None) -> Path:
        ordner = str(a.get("ordner") or "")
        try:
            live = ordnerpfad(player, ordner)
        except HTTPException as f:
            raise McpFehler(str(f.detail)) from None
        entw = versionen.entwurf(live.parent, ordner)
        stand = stand or a.get("stand") or ("entwurf" if entw.is_dir() else "live")
        ziel = entw if stand == "entwurf" else live
        if not ziel.is_dir():
            raise McpFehler(f"„{ordner}“ hat keinen {'Entwurf' if stand == 'entwurf' else 'veröffentlichten Stand'}. meine_spiele zeigt, was da ist.")
        return ziel

    def w_dateien(player: str, a: dict) -> Any:
        ziel = spielordner(player, a)
        pfad = a.get("pfad")
        if not pfad:
            return [{"pfad": str(p.relative_to(ziel)), "bytes": p.stat().st_size}
                    for p in sorted(ziel.rglob("*")) if p.is_file() and not any(t.startswith(".") for t in p.relative_to(ziel).parts)][:2000]
        if not isinstance(pfad, str) or not PFAD_MUSTER.match(pfad):
            raise McpFehler("Ungültiger Pfad.")
        datei = (ziel / pfad).resolve()
        if not datei.is_relative_to(ziel.resolve()) or not datei.is_file() or datei.name.startswith("."):
            raise McpFehler(f"Datei {pfad} gibt es nicht.")
        if datei.suffix.lower() not in TEXT_ENDUNGEN:
            raise McpFehler("Nur Textdateien lassen sich lesen (html, js, css, json, svg, txt, md).")
        if datei.stat().st_size > DATEI_LESEN_MAX:
            raise McpFehler("Datei zu groß zum Lesen (höchstens 300 KB).")
        return datei.read_text(encoding="utf-8", errors="replace")

    def w_hochladen(player: str, a: dict) -> Any:
        ordner = str(a.get("ordner") or "")
        try:
            live = ordnerpfad(player, ordner)
        except HTTPException as f:
            raise McpFehler(str(f.detail)) from None
        dateien, loeschen = a.get("dateien"), a.get("loeschen") or []
        aenderung = a.get("aenderung")
        if not isinstance(dateien, list) or not isinstance(loeschen, list):
            raise McpFehler("dateien und loeschen müssen Listen sein.")
        if not isinstance(aenderung, str) or not aenderung.strip():
            raise McpFehler("aenderung fehlt: ein kurzer Satz, was neu ist.")
        inhalt: dict[str, bytes] = {}
        if a.get("modus") == "ergaenzen":
            entw = versionen.entwurf(live.parent, ordner)
            basis = entw if entw.is_dir() else live
            if not basis.is_dir():
                raise McpFehler(f"„{ordner}“ gibt es noch nicht – zum Anlegen modus=\"ersetzen\" nehmen.")
            for p in basis.rglob("*"):
                rel = p.relative_to(basis)
                if p.is_file() and not any(t.startswith(".") for t in rel.parts):
                    inhalt[rel.as_posix()] = p.read_bytes()
        for d in dateien:
            if not isinstance(d, dict) or not isinstance(d.get("pfad"), str) or not isinstance(d.get("inhalt"), str):
                raise McpFehler("Jede Datei braucht pfad und inhalt (Text).")
            pfad = d["pfad"].strip()
            if pfad.startswith("./"):
                pfad = pfad[2:]
            if not PFAD_MUSTER.match(pfad):
                raise McpFehler(f"Ungültiger Pfad: {d['pfad']}")
            try:
                inhalt[pfad] = base64.b64decode(d["inhalt"], validate=True) if d.get("base64") else d["inhalt"].encode("utf-8")
            except ValueError:
                raise McpFehler(f"{pfad}: base64 ungültig.") from None
        for pfad in loeschen:
            inhalt.pop(str(pfad), None)
        if "index.html" not in inhalt:
            raise McpFehler("index.html fehlt – jedes Spiel braucht eine index.html im obersten Ordner.")
        puffer = io.BytesIO()
        with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
            for pfad, daten in sorted(inhalt.items()):
                z.writestr(pfad, daten)
        puffer.seek(0)
        try:
            ergebnis = entwurf_installieren(player, ordner, puffer, aenderung.strip(), " (über Claude)")
        except HTTPException as f:
            raise McpFehler(str(f.detail)) from None
        try:
            pr = pruefung(player, ordner)
            punkte = [f"{p['stufe']}: {p['text']}" for p in pr["punkte"]]
        except HTTPException:
            punkte = []
        return {"entwurf": True, "dateien": ergebnis["dateien"], "bytes": ergebnis["bytes"],
                "uebersprungen": ergebnis["uebersprungen"], "pruefung": punkte, **links(player, ordner),
                "naechsterSchritt": "Dem Entwickler den Link „testen“ geben. Veröffentlichen macht er selbst über den Link „veroeffentlichen“."}

    def w_pruefung(player: str, a: dict) -> Any:
        ordner = str(a.get("ordner") or "")
        try:
            pr = pruefung(player, ordner)
        except HTTPException as f:
            raise McpFehler(str(f.detail)) from None
        return {"ordner": ordner, "version": pr["version"], "erstveroeffentlichung": pr["erstveroeffentlichung"],
                "fehler": pr["fehler"], "warnungen": pr["warnungen"],
                "punkte": [f"{p['stufe']}: {p['text']}" for p in pr["punkte"]], **links(player, ordner)}

    def w_fehlerberichte(player: str, a: dict) -> Any:
        from urllib.parse import quote
        ordner = a.get("ordner")
        try:
            liste = speicher("GET", f"/intern/fehler/{quote(player)}" + (f"?ordner={quote(str(ordner))}" if ordner else ""))
        except HTTPException as f:
            raise McpFehler(f"Fehlerberichte gerade nicht abrufbar ({f.detail}).") from None
        return liste or "Keine Fehlerberichte."

    AUSFUEHREN = {"handbuch": w_handbuch, "vorlage": w_vorlage, "meine_spiele": w_meine_spiele, "dateien": w_dateien,
                  "hochladen": w_hochladen, "pruefung": w_pruefung, "fehlerberichte": w_fehlerberichte}

    # ---------- JSON-RPC ----------

    def antwort(player: str, n: dict, ist_claude: bool, neue_sitzung: list) -> dict | None:
        mid, methode, params = n.get("id"), n.get("method"), n.get("params") or {}
        if "id" not in n:                      # Benachrichtigung (z. B. notifications/initialized)
            return None
        ok = lambda ergebnis: {"jsonrpc": "2.0", "id": mid, "result": ergebnis}
        if methode == "initialize":
            client = (params.get("clientInfo") or {}).get("name") or ""
            claude = bool(re.search(r"claude", str(client), re.I))
            sitzung = secrets.token_urlsafe(24)
            if len(sitzungen) > 5000:
                sitzungen.clear()
            sitzungen[sitzung] = claude
            neue_sitzung.append(sitzung)
            if not claude:
                log.info("MCP: andere KI angemeldet (%s) – Hinweis wird angezeigt", str(client)[:60])
            gewuenscht = params.get("protocolVersion")
            return ok({"protocolVersion": gewuenscht if gewuenscht in PROTOKOLLE else PROTOKOLLE[0],
                       "capabilities": {"tools": {"listChanged": False}},
                       "serverInfo": {"name": "spielebibliothek", "title": "Spielebibliothek", "version": "1.6.0"},
                       "instructions": ANLEITUNG if claude else HINWEIS_ANDERE_KI + "\n\n" + ANLEITUNG})
        if methode == "ping":
            return ok({})
        if methode == "tools/list":
            return ok({"tools": WERKZEUGE})
        if methode == "tools/call":
            name, argumente = params.get("name"), params.get("arguments") or {}
            f = AUSFUEHREN.get(name)
            if not f or not isinstance(argumente, dict):
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"Unbekanntes Werkzeug: {name}"}}
            inhalt = [] if ist_claude else [{"type": "text", "text": HINWEIS_ANDERE_KI}]
            try:
                ergebnis = f(player, argumente)
                text = ergebnis if isinstance(ergebnis, str) else json.dumps(ergebnis, ensure_ascii=False, indent=1)
                return ok({"content": inhalt + [{"type": "text", "text": text}], "isError": False})
            except McpFehler as fehler:
                return ok({"content": inhalt + [{"type": "text", "text": fehler.text}], "isError": True})
            except Exception:
                log.exception("MCP-Werkzeug %s fehlgeschlagen", name)
                return ok({"content": inhalt + [{"type": "text", "text": "Interner Fehler – bitte Seb Bescheid geben."}], "isError": True})
        if methode in ("resources/list", "prompts/list"):
            return ok({methode.split("/")[0]: []})
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Methode {methode} gibt es nicht"}}

    def nicht_angemeldet() -> Response:
        return JSONResponse({"error": "invalid_token", "error_description": "Bitte mit einem Schlüssel oder über die Claude-App anmelden."},
                            status_code=401, headers={"WWW-Authenticate": f'Bearer resource_metadata="{mcp_url}/.well-known/oauth-protected-resource"'})

    @app.post("/mcp")
    def mcp_anfrage(request: Request, body: Any = Body(None)):
        laenge = request.headers.get("content-length")
        if laenge and laenge.isdigit() and int(laenge) > MCP_BODY_MAX:
            return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Anfrage zu groß (höchstens 30 MB)"}}, 413)
        kopf = request.headers.get("authorization", "")
        player = zugaenge.pruefen(kopf[7:].strip()) if kopf[:7].lower() == "bearer " else None
        if not player or not store.vorhanden(player) or not zugelassen(player):
            return nicht_angemeldet()
        if body is None or not isinstance(body, (dict, list)):
            return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Kein gültiges JSON-RPC"}}, 400)
        ist_claude = sitzungen.get(request.headers.get("mcp-session-id", ""), True)
        neue_sitzung: list[str] = []
        nachrichten = body if isinstance(body, list) else [body]
        antworten = [a for a in (antwort(player, n, ist_claude, neue_sitzung) for n in nachrichten if isinstance(n, dict)) if a]
        koepfe = {"Mcp-Session-Id": neue_sitzung[0]} if neue_sitzung else {}
        if not antworten:
            return Response(status_code=202, headers=koepfe)
        return JSONResponse(antworten if isinstance(body, list) else antworten[0], headers=koepfe)

    @app.get("/mcp")
    def mcp_get():
        return Response(status_code=405, headers={"Allow": "POST"})

    @app.delete("/mcp")
    def mcp_ende(request: Request):
        sitzungen.pop(request.headers.get("mcp-session-id", ""), None)
        return Response(status_code=204)

    # ---------- OAuth 2.1 für die Claude-App ----------

    @app.get("/.well-known/oauth-protected-resource")
    @app.get("/.well-known/oauth-protected-resource/mcp")
    def ressource():
        return {"resource": f"{mcp_url}/mcp", "authorization_servers": [mcp_url], "bearer_methods_supported": ["header"],
                "scopes_supported": ["spiele"], "resource_name": "Spielebibliothek"}

    @app.get("/.well-known/oauth-authorization-server")
    @app.get("/.well-known/oauth-authorization-server/mcp")
    def server_info():
        return {"issuer": mcp_url, "authorization_endpoint": f"{upload_url}/upload/mcp-freigabe.html",
                "token_endpoint": f"{mcp_url}/oauth/token", "registration_endpoint": f"{mcp_url}/oauth/register",
                "response_types_supported": ["code"], "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": ["none"],
                "scopes_supported": ["spiele"]}

    def uri_ok(uri: Any) -> bool:
        if not isinstance(uri, str) or len(uri) > 500:
            return False
        try:
            t = urlsplit(uri)
            t.port                                    # wirft bei kaputtem Port
        except ValueError:
            return False
        if t.username or t.password or t.fragment:
            return False
        # Nur Claude (1.6.2): die Claude-App auf claude.ai/claude.com, Claude Code lokal auf diesem Rechner
        return ((t.scheme == "https" and (t.hostname, t.path) in CLAUDE_RUECKSPRUNG and t.port in (None, 443))
                or (t.scheme == "http" and t.hostname in ("localhost", "127.0.0.1")))

    @app.post("/oauth/register", status_code=201)
    def registrieren_(request: Request, body: dict = Body(...)):
        jetzt_ = time.time()
        while registrierungen and jetzt_ - registrierungen[0][0] > 3600:
            registrierungen.pop(0)
        # Hinter dem Cloudflare-Tunnel steht die echte Adresse im Kopf Cf-Connecting-Ip
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
        if len(registrierungen) >= CLIENTS_PRO_STUNDE or sum(1 for _, i in registrierungen if i == ip) >= CLIENTS_PRO_IP:
            raise HTTPException(429, "zu viele Registrierungen – später noch einmal")
        uris = body.get("redirect_uris")
        if not isinstance(uris, list) or not 1 <= len(uris) <= 5 or not all(uri_ok(u) for u in uris):
            return JSONResponse({"error": "invalid_redirect_uri"}, 400)
        name = str(body.get("client_name") or "KI-Anwendung")[:80]
        registrierungen.append((jetzt_, ip))
        client_id = zugaenge.client_neu(name, uris)
        return {"client_id": client_id, "client_name": name, "redirect_uris": uris, "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]}

    @app.post("/oauth/token")
    def token(grant_type: str = Form(...), code: str = Form(""), redirect_uri: str = Form(""), client_id: str = Form(""),
              code_verifier: str = Form(""), refresh_token: str = Form("")):
        fehler = lambda art: JSONResponse({"error": art}, 400, headers={"Cache-Control": "no-store"})
        client = zugaenge.client(client_id) if client_id else None
        if not client:
            return fehler("invalid_client")
        if grant_type == "authorization_code":
            player = zugaenge.code_einloesen(code, client_id, redirect_uri, code_verifier)
            if not player or not store.vorhanden(player) or not zugelassen(player):
                return fehler("invalid_grant")
            store.ereignis(player, f"KI-Zugang verbunden: {client['name']}")
            return JSONResponse(zugaenge.oauth_neu(player, client_id, client["name"]), headers={"Cache-Control": "no-store"})
        if grant_type == "refresh_token":
            neu = zugaenge.erneuern(refresh_token, client_id, zugelassen)
            return JSONResponse(neu, headers={"Cache-Control": "no-store"}) if neu else fehler("invalid_grant")
        return fehler("unsupported_grant_type")

    # ---------- Upload-Seite: Freigabe für die Claude-App, Schlüssel für Claude Code ----------

    def client_pruefen(client_id: Any, redirect_uri: Any) -> dict:
        client = zugaenge.client(client_id) if isinstance(client_id, str) else None
        if not client or redirect_uri not in client["redirect_uris"]:
            raise HTTPException(400, "Unbekannte Anwendung oder Rücksprung-Adresse – bitte die Verbindung in der KI neu starten.")
        return client

    def weiter(redirect_uri: str, werte: dict) -> str:
        return redirect_uri + ("&" if "?" in redirect_uri else "?") + urlencode({k: v for k, v in werte.items() if v})

    @app.get("/api/upload/mcp/anfrage")
    def anfrage_zeigen(client_id: str = "", redirect_uri: str = "", player: str = Depends(spieler)):
        client = client_pruefen(client_id, redirect_uri)
        return {"name": client["name"], "ziel": urlsplit(redirect_uri).netloc}

    @app.post("/api/upload/mcp/freigeben")
    def freigeben(player: str = Depends(angemeldet), body: dict = Body(...)):
        redirect_uri = body.get("redirect_uri")
        client = client_pruefen(body.get("client_id"), redirect_uri)
        state = body.get("state") if isinstance(body.get("state"), str) else None
        if body.get("erlauben") is not True:
            return {"weiter": weiter(redirect_uri, {"error": "access_denied", "state": state})}
        challenge, methode = body.get("code_challenge"), body.get("code_challenge_method")
        if not isinstance(challenge, str) or not 43 <= len(challenge) <= 128 or methode != "S256":
            return {"weiter": weiter(redirect_uri, {"error": "invalid_request", "error_description": "PKCE (S256) fehlt", "state": state})}
        code = zugaenge.code_neu(client["client_id"], player, redirect_uri, challenge)
        store.ereignis(player, f"KI-Zugang freigegeben: {client['name']}")
        return {"weiter": weiter(redirect_uri, {"code": code, "state": state, "iss": mcp_url})}

    @app.get("/api/upload/mcp/zugaenge")
    def zugaenge_liste(player: str = Depends(angemeldet)):
        return {"zugaenge": zugaenge.liste(player), "adresse": f"{mcp_url}/mcp"}

    @app.post("/api/upload/mcp/zugaenge", status_code=201)
    def schluessel_erstellen(player: str = Depends(angemeldet), body: dict = Body(...)):
        name = str(body.get("name") or "").strip()[:60] or "Claude Code"
        zid, token_ = zugaenge.schluessel_neu(player, name)
        store.ereignis(player, f"KI-Schlüssel erstellt: {name}")
        return {"id": zid, "schluessel": token_, "adresse": f"{mcp_url}/mcp",
                "befehl": f'claude mcp add --transport http spielebibliothek {mcp_url}/mcp --header "Authorization: Bearer {token_}"'}

    @app.delete("/api/upload/mcp/zugaenge/{zugang_id}", status_code=204)
    def zugang_widerrufen(zugang_id: int, player: str = Depends(angemeldet)):
        if not zugaenge.widerrufen(player, zugang_id):
            raise HTTPException(404, "Zugang nicht gefunden")
        store.ereignis(player, "KI-Zugang widerrufen")
