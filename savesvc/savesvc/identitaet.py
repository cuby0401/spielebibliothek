"""Identität mit drei Schichten (Zentrale 1.5.0, E81/E82): UUID, Handle, Anzeigename.

Bis 1.4.1 war der Benutzername („seb“) zugleich Schlüssel in allen Tabellen und sichtbarer Name. Ab 1.5.0:
  - id      zufällige UUID, ändert sich nie – alle Tabellen verweisen darauf,
  - handle  eindeutiger, alle 30 Tage änderbarer Name (@seb), in Adressen und für Menschen,
  - anzeigename  frei, nicht eindeutig (schon seit 1.4.0).
Dazu eine fortlaufende Personennummer (P-0007) zum Nennen und Suchen im Admin-Bereich.

Die Umstellung (umstellen) ersetzt in jeder Personen-Spalte den Benutzernamen durch die UUID der Person – die Spalten
behalten ihren Namen (player, name, von …), damit nicht jede der vielen Schreibstellen doppelt schreiben muss. Die
Zuordnung ist eins zu eins und steht bei jeder Person (alt_name), deshalb ist sie exakt umkehrbar (zurueck – für den
Rückweg auf 1.4.1).

Sicherheitsnetz, alles in EINER Transaktion – schlägt irgendetwas fehl, bleibt die Datenbank, wie sie war:
  1. Sicherung der ganzen Datenbank vorher (Datei, vom Aufrufer angegeben).
  2. Je Tabelle Zeilenzahl und Prüfsumme über alle Zeilen vorher.
  3. Nachher: gleiche Zeilenzahl, und mit zurückgerechneten Namen exakt dieselbe Prüfsumme – Spielstände, Scores
     usw. sind also Byte für Byte unverändert, nur die Personen-Spalten tragen die UUID.
  4. Kein alter Benutzername mehr in einer Personen-Spalte, jeder Wert in einer Daten-Spalte gehört zu einer Person.
"""

import hashlib
import logging
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("savesvc.identitaet")

NAME = "uuid-1.5.0"
UUID_MUSTER = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

# Alle Spalten, in denen eine Person steht (Stand 1.4.1, vollständige Bestandsaufnahme 09.11.2026).
#   "daten": gehört einer Person (Spielstände, Anmeldungen, CRM …). Danach muss jeder Wert eine UUID sein. Namen ohne
#            Person (z. B. längst entfernte Konten) bekommen vorher eine archivierte Person, damit nichts verwaist.
#   "autor": wer etwas getan hat oder Empfänger mit Sonderwerten („übernahme“, „mac“, „users.yaml“, „*“ = an alle).
#            Bekannte Namen werden umgestellt, alles andere bleibt, wie es ist.
# Werte mit „~“ sind die Kennungen von „Ansicht als …“ (seb~spieler): umgestellt wird der Teil vor dem „~“.
SPALTEN: list[tuple[str, str, str]] = [
    ("personen", "name", "daten"),
    ("person_emails", "name", "daten"),
    ("person_rollen", "name", "daten"),
    ("person_notizen", "name", "daten"),
    ("person_ereignisse", "name", "daten"),
    ("anmeldungen", "player", "daten"),
    ("antraege", "player", "daten"),
    ("daumen", "player", "daten"),
    ("einstellungen", "player", "daten"),
    ("entwurf_tests", "player", "daten"),
    ("erfolge", "player", "daten"),
    ("getrennte_sitzungen", "player", "daten"),
    ("meldung_status", "player", "daten"),
    ("meldungen_gelesen", "player", "daten"),
    ("save_history", "player", "daten"),
    ("save_vor_update", "player", "daten"),
    ("saves", "player", "daten"),
    ("scores", "player", "daten"),
    ("spielzeit", "player", "daten"),
    ("meldungen", "an", "autor"),
    ("antraege", "beantwortet_von", "autor"),
    ("antrag_bilder", "von", "autor"),
    ("auftraege", "von", "autor"),
    ("crm_protokoll", "von", "autor"),
    ("crm_protokoll", "ziel", "autor"),
    ("getrennte_sitzungen", "von", "autor"),
    ("person_ereignisse", "von", "autor"),
    ("person_notizen", "von", "autor"),
    ("personen", "eingeladen_von", "autor"),
    ("sicherheit", "wer", "autor"),
]
TABELLEN = sorted({t for t, _, _ in SPALTEN})

SCHEMA = """
CREATE TABLE IF NOT EXISTS migrationen (name TEXT PRIMARY KEY, zeit TEXT NOT NULL, info TEXT);
-- Alle Handles, auch frühere: frühere bleiben für die Person reserviert, alte Adressen leiten weiter (E82)
CREATE TABLE IF NOT EXISTS handles (
    handle TEXT PRIMARY KEY COLLATE NOCASE, person TEXT NOT NULL, seit TEXT NOT NULL, bis TEXT);
CREATE INDEX IF NOT EXISTS handles_person ON handles (person);
"""
NEUE_SPALTEN = {"id": "TEXT", "alt_name": "TEXT", "handle": "TEXT", "handle_seit": "TEXT", "nr": "INTEGER"}


class UmstellungFehlgeschlagen(RuntimeError):
    """Eine Prüfung schlug fehl – die Transaktion wurde zurückgerollt, die Datenbank ist unverändert."""


def jetzt() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _verbinden(pfad: Path) -> sqlite3.Connection:
    v = sqlite3.connect(pfad, timeout=30, isolation_level=None)
    v.row_factory = sqlite3.Row
    v.execute("PRAGMA busy_timeout=30000")
    return v


def _vorhanden(v, tabelle: str) -> bool:
    return v.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (tabelle,)).fetchone() is not None


def schema_ergaenzen(v) -> None:
    """Neue Tabellen und Spalten anlegen (idempotent, schadet 1.4.1 nicht: alle neuen Spalten dürfen leer sein)."""
    # Einzeln ausführen, NICHT executescript: das schließt eine laufende Transaktion stillschweigend ab – die
    # Umstellung wäre dann nicht mehr „alles oder nichts“ (vom Test am 09.11.2026 gefunden).
    for befehl in (b.strip() for b in SCHEMA.split(";")):
        if befehl and not befehl.startswith("--"):
            v.execute(befehl)
        elif befehl:
            v.execute("\n".join(z for z in befehl.splitlines() if not z.strip().startswith("--")))
    da ={z["name"] for z in v.execute("PRAGMA table_info(personen)")}
    for spalte, typ in NEUE_SPALTEN.items():
        if spalte not in da:
            v.execute(f"ALTER TABLE personen ADD COLUMN {spalte} {typ}")
    v.execute("CREATE UNIQUE INDEX IF NOT EXISTS personen_id ON personen (id)")
    v.execute("CREATE UNIQUE INDEX IF NOT EXISTS personen_nr ON personen (nr)")
    v.execute("CREATE UNIQUE INDEX IF NOT EXISTS personen_handle ON personen (handle COLLATE NOCASE)")


def umgestellt(pfad: Path) -> bool:
    v = _verbinden(pfad)
    try:
        return _vorhanden(v, "migrationen") and v.execute("SELECT 1 FROM migrationen WHERE name=?", (NAME,)).fetchone() is not None
    finally:
        v.close()


def _teile(wert):
    """„seb~spieler“ → („seb“, „~spieler“); „seb“ → („seb“, „“)."""
    if not isinstance(wert, str):
        return wert, ""
    basis, sep, rest = wert.partition("~")
    return basis, (sep + rest) if sep else ""


def _abbilden(wert, zuordnung: dict[str, str]):
    basis, rest = _teile(wert)
    return zuordnung[basis] + rest if isinstance(basis, str) and basis in zuordnung else wert


def _spalten_da(v) -> list[tuple[str, str, str]]:
    """Nur Tabellen/Spalten, die es in dieser Datenbank gibt (ältere Stände haben manche noch nicht)."""
    da = []
    for t, s, art in SPALTEN:
        if _vorhanden(v, t) and s in {z["name"] for z in v.execute(f"PRAGMA table_info({t})")}:
            da.append((t, s, art))
    return da


def _pruefsummen(v, spalten, zurueck: dict[str, str] | None = None) -> dict[str, tuple[int, str]]:
    """Je Tabelle (Zeilen, SHA-256 über alle Zeilen in rowid-Reihenfolge, nur die Spalten von 1.4.1). Mit „zurueck“
    werden die Personen-Spalten vorher zurückgerechnet – so lässt sich der Stand nach der Umstellung mit dem davor
    vergleichen."""
    personen_spalten: dict[str, set[str]] = {}
    for t, s, _ in spalten:
        personen_spalten.setdefault(t, set()).add(s)
    ergebnis = {}
    for t in sorted(personen_spalten):
        namen = [z["name"] for z in v.execute(f"PRAGMA table_info({t})") if not (t == "personen" and z["name"] in NEUE_SPALTEN)]
        h, n = hashlib.sha256(), 0
        for z in v.execute(f"SELECT {', '.join(namen)} FROM {t} ORDER BY rowid"):
            werte = [(_abbilden(z[k], zurueck) if zurueck and k in personen_spalten[t] else z[k]) for k in namen]
            h.update(repr(werte).encode())
            n += 1
        ergebnis[t] = (n, h.hexdigest())
    return ergebnis


def umstellen(pfad: Path, sicherung: Path, _nach_umstellung=None) -> dict:
    """Datenbank auf UUIDs umstellen (einmalig, idempotent). Vorher Sicherung nach „sicherung“. → Bericht.
    Wirft UmstellungFehlgeschlagen, wenn eine Prüfung scheitert – dann ist nichts verändert.
    _nach_umstellung: nur für Tests (Fehler mitten in der Transaktion auslösen)."""
    if umgestellt(pfad):
        return {"umgestellt": False, "grund": "schon umgestellt"}
    # 1. Sicherung – vor jeder Änderung, auch vor dem Schema
    sicherung.parent.mkdir(parents=True, exist_ok=True)
    quelle, kopie = sqlite3.connect(pfad), sqlite3.connect(sicherung)
    try:
        quelle.backup(kopie)
    finally:
        kopie.close()
        quelle.close()

    v = _verbinden(pfad)
    try:
        v.execute("BEGIN IMMEDIATE")
        try:
            bericht = _umstellen_in(v, _nach_umstellung)
            v.execute("INSERT INTO migrationen (name, zeit, info) VALUES (?,?,?)", (NAME, jetzt(), repr(bericht)))
            v.execute("COMMIT")
        except BaseException:
            v.execute("ROLLBACK")
            raise
    finally:
        v.close()
    log.info("Identität auf UUID umgestellt: %s", bericht)
    return {"umgestellt": True, **bericht}


def _umstellen_in(v, _nach_umstellung) -> dict:
    schema_ergaenzen(v)
    spalten = _spalten_da(v)

    # Personen ohne Eintrag, aber mit Daten (z. B. früher entfernte Konten): archivierte Person anlegen, damit
    # ihre Spielstände eine UUID bekommen statt zu verwaisen.
    bekannt = {z["name"] for z in v.execute("SELECT name FROM personen")}
    verwaist: set[str] = set()
    for t, s, art in spalten:
        if art != "daten":
            continue
        for (wert,) in v.execute(f"SELECT DISTINCT {s} FROM {t} WHERE {s} IS NOT NULL"):
            basis, _ = _teile(wert)
            if basis not in bekannt:
                verwaist.add(basis)
    for name in sorted(verwaist):
        v.execute("INSERT INTO personen (name, status, eingeladen_von, angelegt, geaendert) VALUES (?, 'archiviert', 'umstellung', ?, ?)",
                  (name, jetzt(), jetzt()))

    # IDs, Handles und Nummern vergeben. Wer schon eine ID hat (Umstellung nach einem Rückweg wiederholt), behält sie.
    personen = v.execute("SELECT rowid, name, id, nr, handle, handle_seit, angelegt FROM personen ORDER BY angelegt, name").fetchall()
    naechste = (v.execute("SELECT MAX(nr) FROM personen").fetchone()[0] or 0) + 1
    zuordnung: dict[str, str] = {}
    for p in personen:
        pid = p["id"] or str(uuid.uuid4())
        nr = p["nr"]
        if nr is None:
            nr, naechste = naechste, naechste + 1
        handle = p["handle"] or p["name"]
        # handle_seit = Zeitpunkt der letzten ÄNDERUNG – bleibt leer, bis jemand sein Handle zum ersten Mal ändert
        v.execute("UPDATE personen SET id=?, alt_name=?, nr=?, handle=? WHERE rowid=?", (pid, p["name"], nr, handle, p["rowid"]))
        v.execute("INSERT OR IGNORE INTO handles (handle, person, seit) VALUES (?,?,?)", (handle, pid, p["angelegt"]))
        zuordnung[p["name"]] = pid

    # 2. Prüfsummen vorher (nach dem Anlegen der verwaisten Personen – die gehören zum Ausgangsstand dazu)
    vorher = _pruefsummen(v, spalten)

    # 3. Umstellen: je Spalte jeden bekannten Namen (auch mit „~…“) durch die UUID ersetzen
    geaendert = 0
    for t, s, _ in spalten:
        for (wert,) in v.execute(f"SELECT DISTINCT {s} FROM {t} WHERE {s} IS NOT NULL").fetchall():
            neu = _abbilden(wert, zuordnung)
            if neu != wert:
                geaendert += v.execute(f"UPDATE {t} SET {s}=? WHERE {s}=?", (neu, wert)).rowcount
    if _nach_umstellung:
        _nach_umstellung(v)

    # 4. Prüfen
    rueck = {pid: name for name, pid in zuordnung.items()}
    nachher = _pruefsummen(v, spalten, zurueck=rueck)
    for t in vorher:
        if vorher[t] != nachher[t]:
            raise UmstellungFehlgeschlagen(f"{t}: vorher {vorher[t][0]} Zeilen, nachher {nachher[t][0]} – Prüfsumme weicht ab")
    ids = set(zuordnung.values())
    for t, s, art in spalten:
        for (wert,) in v.execute(f"SELECT DISTINCT {s} FROM {t} WHERE {s} IS NOT NULL"):
            basis, _ = _teile(wert)
            if basis in zuordnung:
                raise UmstellungFehlgeschlagen(f"{t}.{s}: alter Benutzername {basis!r} steht noch drin")
            if art == "daten" and basis not in ids:
                raise UmstellungFehlgeschlagen(f"{t}.{s}: {wert!r} gehört zu keiner Person")
    zeilen = sum(n for n, _ in vorher.values())
    return {"personen": len(zuordnung), "verwaist": sorted(verwaist), "geaenderte_werte": geaendert, "zeilen_geprueft": zeilen}


def zurueck(pfad: Path, sicherung: Path) -> dict:
    """Rückweg auf 1.4.1: UUIDs wieder durch die alten Benutzernamen ersetzen (exakt umgekehrt, gleiche Prüfungen).
    Die neuen Spalten (id, handle, nr …) bleiben stehen – 1.4.1 stören sie nicht, und eine spätere erneute Umstellung
    vergibt dieselben IDs und Nummern."""
    if not umgestellt(pfad):
        return {"zurueck": False, "grund": "nicht umgestellt"}
    sicherung.parent.mkdir(parents=True, exist_ok=True)
    quelle, kopie = sqlite3.connect(pfad), sqlite3.connect(sicherung)
    try:
        quelle.backup(kopie)
    finally:
        kopie.close()
        quelle.close()
    v = _verbinden(pfad)
    try:
        v.execute("BEGIN IMMEDIATE")
        try:
            spalten = _spalten_da(v)
            rueck = {z["id"]: z["alt_name"] for z in v.execute("SELECT id, alt_name FROM personen WHERE id IS NOT NULL")}
            if any(not a for a in rueck.values()):
                raise UmstellungFehlgeschlagen("Person ohne alten Benutzernamen – Rückweg nicht eindeutig")
            # Handles, die es in 1.5.0 neu gab, gehen verloren – 1.4.1 kennt nur den alten Namen
            erwartet = _pruefsummen(v, spalten, zurueck=rueck)
            for t, s, _ in spalten:
                for (wert,) in v.execute(f"SELECT DISTINCT {s} FROM {t} WHERE {s} IS NOT NULL").fetchall():
                    alt = _abbilden(wert, rueck)
                    if alt != wert:
                        v.execute(f"UPDATE {t} SET {s}=? WHERE {s}=?", (alt, wert))
            if _pruefsummen(v, spalten) != erwartet:
                raise UmstellungFehlgeschlagen("Rückweg: Prüfsumme weicht ab")
            v.execute("DELETE FROM migrationen WHERE name=?", (NAME,))
            v.execute("COMMIT")
        except BaseException:
            v.execute("ROLLBACK")
            raise
    finally:
        v.close()
    log.info("Identität zurück auf Benutzernamen (Rückweg auf 1.4.1): %d Personen", len(rueck))
    return {"zurueck": True, "personen": len(rueck)}


# ---------- Laufzeit: Übersetzen zwischen UUID, Handle und Spieleordner (Schritt 2) ----------
#
# Innen ist „player“ die UUID. Nach außen (Browser) gehen Handles: Die Antwort-Schicht in app.py übersetzt jede
# Personen-UUID in jeder JSON-Antwort ins aktuelle Handle – auch in Texten („… hat dich überholt“). Herein kommen
# Personen nur an wenigen Stellen über die Adresse (/api/profil/<handle>, /api/admin/personen/<handle>), dort wird
# das Handle (auch ein früheres) in die UUID übersetzt.
# Spieleordner (spiele/paul/…) heißen nach dem ersten Benutzernamen und ändern sich nie (E82) = alt_name.
#
# Solange die Datenbank nicht umgestellt ist (oder im Upload-Dienst, der keine Personen kennt), gibt jede Funktion
# den Namen unverändert zurück – dann verhält sich alles wie in 1.4.1.

UUID_IN_TEXT = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


class Register:
    def __init__(self, pfad: Path):
        self.pfad = pfad
        self._aktiv = False

    def aktiv(self) -> bool:
        if not self._aktiv:      # einmal umgestellt, bleibt es (der Rückweg läuft nur bei gestopptem Dienst)
            self._aktiv = umgestellt(self.pfad)
        return self._aktiv

    def karten(self) -> dict:
        """Frisch aus der Datenbank – wenige Dutzend Zeilen, kein Zwischenspeicher, der veralten könnte."""
        v = _verbinden(self.pfad)
        try:
            zu_handle, zu_ordner, zu_id = {}, {}, {}
            for z in v.execute("SELECT id, handle, alt_name FROM personen WHERE id IS NOT NULL"):
                zu_handle[z["id"]] = z["handle"]
                zu_ordner[z["id"]] = z["alt_name"]
                zu_id[z["alt_name"].lower()] = z["id"]
            for z in v.execute("SELECT handle, person FROM handles"):         # frühere Handles leiten weiter
                zu_id.setdefault(z["handle"].lower(), z["person"])
            for pid, h in zu_handle.items():                                   # aktuelle Handles haben Vorrang
                zu_id[h.lower()] = pid
            return {"handle": zu_handle, "ordner": zu_ordner, "id": zu_id}
        finally:
            v.close()

    def id_von(self, name: str | None) -> str | None:
        """Handle (auch ein früheres), Ordnername oder UUID → UUID der Person. Unbekannt → None."""
        if not name or not self.aktiv():
            return name
        basis, rest = _teile(name)
        k = self.karten()
        if basis in k["handle"]:
            return name
        pid = k["id"].get(str(basis).lower())
        return pid + rest if pid else None

    def handle(self, pid: str) -> str:
        if not pid or not self.aktiv():
            return pid
        basis, rest = _teile(pid)
        h = self.karten()["handle"].get(basis)
        return h + rest if h else pid

    def ordner(self, pid: str) -> str:
        """Name des Spieleordners einer Person (= erster Benutzername)."""
        if not pid or not self.aktiv():
            return pid
        basis, rest = _teile(pid)
        o = self.karten()["ordner"].get(basis)
        return o + rest if o else pid

    def id_von_ordner(self, ordner: str) -> str:
        """Spieleordner → UUID des Besitzers (unbekannte Ordner wie Testspiele bleiben, wie sie sind)."""
        if not ordner or not self.aktiv():
            return ordner
        for pid, o in self.karten()["ordner"].items():
            if o == ordner:
                return pid
        return ordner

    def nach_aussen(self, wert, karten: dict | None = None):
        """Jede Personen-UUID (auch in Schlüsseln und mitten in Texten) durch das aktuelle Handle ersetzen."""
        if not self.aktiv():
            return wert
        k = (karten or self.karten())["handle"]
        if not k:
            return wert

        def text(s: str) -> str:
            return UUID_IN_TEXT.sub(lambda m: k.get(m.group(0), m.group(0)), s) if "-" in s else s

        def gehen(w):
            if isinstance(w, str):
                return text(w)
            if isinstance(w, list):
                return [gehen(x) for x in w]
            if isinstance(w, dict):
                return {(text(a) if isinstance(a, str) else a): gehen(b) for a, b in w.items()}
            return w
        return gehen(wert)


REGISTER: Register | None = None      # setzt app.erstellen; im Upload-Dienst bleibt es leer


def id_von(name):
    return REGISTER.id_von(name) if REGISTER else name


def handle(pid):
    return REGISTER.handle(pid) if REGISTER else pid


def ordner(pid):
    return REGISTER.ordner(pid) if REGISTER else pid


def id_von_ordner(o):
    return REGISTER.id_von_ordner(o) if REGISTER else o
