"""SQLite: Spielstände, Verlauf und Bestenliste."""

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

VERLAUF_MAX = 5          # alte Stände je (player, game, key)
DATEN_MAX = 256 * 1024   # Bytes JSON je Key
KEYS_MAX = 50            # Keys je Spieler und Spiel

SCHEMA = """
CREATE TABLE IF NOT EXISTS saves (
    player TEXT NOT NULL, game TEXT NOT NULL, key TEXT NOT NULL,
    data TEXT NOT NULL, save_version INTEGER NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (player, game, key)
);
CREATE TABLE IF NOT EXISTS save_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player TEXT NOT NULL, game TEXT NOT NULL, key TEXT NOT NULL,
    data TEXT, save_version INTEGER, saved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS save_history_wer ON save_history (player, game, key, id);
CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player TEXT NOT NULL, game TEXT NOT NULL, season INTEGER NOT NULL,
    score REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_liste ON scores (game, season, player, score);
-- Phase 10: Einstellungen je Spieler, Einstellungen je Spiel, Anfragen
CREATE TABLE IF NOT EXISTS einstellungen (player TEXT PRIMARY KEY, daten TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spiel_einstellungen (
    game TEXT PRIMARY KEY, versteckt INTEGER NOT NULL DEFAULT 0, hervorgehoben INTEGER NOT NULL DEFAULT 0,
    season INTEGER);
CREATE TABLE IF NOT EXISTS fehler (
    id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, meldung TEXT NOT NULL, quelle TEXT NOT NULL,
    zeile INTEGER NOT NULL, spalte INTEGER NOT NULL DEFAULT 0, stack TEXT, browser TEXT,
    anzahl INTEGER NOT NULL DEFAULT 1, erstes TEXT NOT NULL, letztes TEXT NOT NULL,
    UNIQUE (game, meldung, quelle, zeile));
-- Sicherheitsprotokoll (Zentrale 1.4.0): Not-Aus ein/aus, später weitere Ereignisse. Ein Jahr aufbewahrt.
CREATE TABLE IF NOT EXISTS sicherheit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL, art TEXT NOT NULL, wer TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS antraege (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, art TEXT NOT NULL, spiel TEXT, text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offen', antwort TEXT, erstellt TEXT NOT NULL, geaendert TEXT NOT NULL);
-- Stand vor einer Umwandlung auf eine höhere saveVersion – dauerhaft, für Rollbacks (E37)
CREATE TABLE IF NOT EXISTS save_vor_update (
    player TEXT NOT NULL, game TEXT NOT NULL, key TEXT NOT NULL, save_version INTEGER NOT NULL,
    data TEXT NOT NULL, gesichert TEXT NOT NULL, PRIMARY KEY (player, game, key, save_version));
-- Testergebnisse von Entwürfen (geöffnet, Migration ok/fehlgeschlagen) für die Prüfung vor dem Veröffentlichen
CREATE TABLE IF NOT EXISTS entwurf_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, player TEXT NOT NULL, art TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1, text TEXT, zeit TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS entwurf_tests_spiel ON entwurf_tests (game, zeit);
-- Zentrale 1.2.0: Spielzeit, Meldungen (Glocke), Erfolge, Spiel der Woche
CREATE TABLE IF NOT EXISTS spielzeit (
    player TEXT NOT NULL, game TEXT NOT NULL, sekunden INTEGER NOT NULL DEFAULT 0, sitzungen INTEGER NOT NULL DEFAULT 0,
    zuletzt TEXT, PRIMARY KEY (player, game));
CREATE TABLE IF NOT EXISTS meldungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT, an TEXT NOT NULL, text TEXT NOT NULL, link TEXT, zeit TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS meldungen_an ON meldungen (an, id);
CREATE TABLE IF NOT EXISTS meldungen_gelesen (player TEXT PRIMARY KEY, bis_id INTEGER NOT NULL);
-- Zentrale 1.2.1: Meldungen je Spieler archivieren oder löschen (auch solche an alle)
CREATE TABLE IF NOT EXISTS meldung_status (player TEXT NOT NULL, id INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (player, id));
-- Zentrale 1.2.1: getrennte Sitzungen (Anmeldungen, die der Spieler oder ein Admin beendet hat)
CREATE TABLE IF NOT EXISTS getrennte_sitzungen (player TEXT NOT NULL, sitzung INTEGER NOT NULL, zeit TEXT NOT NULL, von TEXT, PRIMARY KEY (player, sitzung));
-- Zentrale 1.3.0: Wächter schreibt hier alle 5 Minuten – merkt so, wenn die Datenbank schreibgeschützt ist
CREATE TABLE IF NOT EXISTS waechter_probe (id INTEGER PRIMARY KEY CHECK (id = 1), zeit TEXT NOT NULL);
-- Zentrale 1.3.0: Aufträge für den Auftragsdienst auf der NAS (Tests, Deploy nach Freigabe) und Zeitplan
CREATE TABLE IF NOT EXISTS auftraege (
    id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT NOT NULL, ziel TEXT NOT NULL, quelle TEXT NOT NULL, von TEXT,
    angelegt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'wartet', start TEXT, ende TEXT, zusammenfassung TEXT, log TEXT);
CREATE TABLE IF NOT EXISTS zeitplan (art TEXT NOT NULL, ziel TEXT NOT NULL, uhrzeit TEXT NOT NULL, zuletzt TEXT, PRIMARY KEY (art, ziel));
CREATE TABLE IF NOT EXISTS dienst_status (name TEXT PRIMARY KEY, wert TEXT, zeit TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS erfolge (
    player TEXT NOT NULL, game TEXT NOT NULL, erfolg TEXT NOT NULL, zeit TEXT NOT NULL, PRIMARY KEY (player, game, erfolg));
CREATE TABLE IF NOT EXISTS spiel_der_woche (
    id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, start TEXT NOT NULL, ende TEXT NOT NULL);
-- Anmeldungen: Gerät, Ort, IP je Cloudflare-Sitzung (E55)
CREATE TABLE IF NOT EXISTS anmeldungen (
    player TEXT NOT NULL, sitzung INTEGER NOT NULL, geraet TEXT NOT NULL, ip TEXT, ort TEXT,
    erste TEXT NOT NULL, letzte TEXT NOT NULL, PRIMARY KEY (player, sitzung, geraet));
-- Daumen hoch je Spieler und Spiel (Idee „Bewertung“, 05.11.2026)
CREATE TABLE IF NOT EXISTS daumen (
    player TEXT NOT NULL, game TEXT NOT NULL, zeit TEXT NOT NULL, PRIMARY KEY (player, game));
-- Zentrale 1.3.1: Bilder (Screenshots) an Anfragen – in der Datenbank, damit sie mit gesichert werden
CREATE TABLE IF NOT EXISTS antrag_bilder (
    id INTEGER PRIMARY KEY AUTOINCREMENT, antrag_id INTEGER NOT NULL, art TEXT NOT NULL, daten BLOB NOT NULL,
    von TEXT NOT NULL, erstellt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS antrag_bilder_antrag ON antrag_bilder (antrag_id, id);
"""


# Simulierte Rollen („Ansicht als …“, E27) speichern unter „seb~spieler“ bzw. „seb~entwickler“.
# Echte Benutzernamen enthalten nie „~“. Diese Bedingung hält die Simulation aus allen Statistiken heraus.
ECHT = "instr(player, '~') = 0"


class ZuGross(Exception):
    pass


def jetzt() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Datenbank:
    def __init__(self, pfad: Path):
        self.pfad = pfad
        pfad.parent.mkdir(parents=True, exist_ok=True)
        with self.verbindung() as v:
            v.execute("PRAGMA journal_mode=WAL")
            v.executescript(SCHEMA)
            # Schema-Erweiterungen bestehender Datenbanken
            spalten = {z["name"] for z in v.execute("PRAGMA table_info(scores)")}
            if "werte" not in spalten:
                v.execute("ALTER TABLE scores ADD COLUMN werte TEXT")
            se = {z["name"] for z in v.execute("PRAGMA table_info(spiel_einstellungen)")}
            if "testspiel" not in se:
                v.execute("ALTER TABLE spiel_einstellungen ADD COLUMN testspiel INTEGER NOT NULL DEFAULT 0")
            if "wichtig" not in {z["name"] for z in v.execute("PRAGMA table_info(meldungen)")}:
                v.execute("ALTER TABLE meldungen ADD COLUMN wichtig INTEGER NOT NULL DEFAULT 0")
            if "offline" not in se:   # E40: Entwickler nimmt sein Spiel vorübergehend offline
                v.execute("ALTER TABLE spiel_einstellungen ADD COLUMN offline INTEGER NOT NULL DEFAULT 0")
                v.execute("ALTER TABLE spiel_einstellungen ADD COLUMN offline_grund TEXT")
                v.execute("ALTER TABLE spiel_einstellungen ADD COLUMN offline_seit TEXT")
            if "beantwortet_von" not in {z["name"] for z in v.execute("PRAGMA table_info(antraege)")}:
                v.execute("ALTER TABLE antraege ADD COLUMN beantwortet_von TEXT")   # 1.3.0: Entwickler beantworten Spiel-Anfragen

    @contextmanager
    def verbindung(self):
        v = sqlite3.connect(self.pfad, timeout=10, isolation_level=None)
        v.row_factory = sqlite3.Row
        v.execute("PRAGMA busy_timeout=10000")
        try:
            yield v
        finally:
            v.close()

    # --- Spielstände ---

    def laden(self, player: str, game: str, key: str):
        with self.verbindung() as v:
            z = v.execute(
                "SELECT data, save_version, updated_at FROM saves WHERE player=? AND game=? AND key=?",
                (player, game, key),
            ).fetchone()
        if not z:
            return None
        return {"data": json.loads(z["data"]), "version": z["save_version"], "updatedAt": z["updated_at"]}

    def keys(self, player: str, game: str) -> list[str]:
        with self.verbindung() as v:
            return [z["key"] for z in v.execute(
                "SELECT key FROM saves WHERE player=? AND game=? ORDER BY key", (player, game))]

    def _in_verlauf(self, v, player, game, key):
        alt = v.execute(
            "SELECT data, save_version FROM saves WHERE player=? AND game=? AND key=?", (player, game, key)
        ).fetchone()
        if alt:
            v.execute(
                "INSERT INTO save_history (player, game, key, data, save_version, saved_at) VALUES (?,?,?,?,?,?)",
                (player, game, key, alt["data"], alt["save_version"], jetzt()),
            )
            # nur die letzten VERLAUF_MAX behalten
            v.execute(
                """DELETE FROM save_history WHERE player=? AND game=? AND key=? AND id NOT IN (
                       SELECT id FROM save_history WHERE player=? AND game=? AND key=? ORDER BY id DESC LIMIT ?)""",
                (player, game, key, player, game, key, VERLAUF_MAX),
            )
        return alt is not None

    def speichern(self, player: str, game: str, key: str, data, save_version: int) -> dict:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(text.encode("utf-8")) > DATEN_MAX:
            raise ZuGross(f"Spielstand größer als {DATEN_MAX // 1024} KB")
        zeit = jetzt()
        with self.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            try:
                alt = v.execute("SELECT data, save_version FROM saves WHERE player=? AND game=? AND key=?",
                                (player, game, key)).fetchone()
                if alt and alt["save_version"] < save_version:
                    # Umwandlung auf eine neue saveVersion: alten Stand dauerhaft aufheben (Rollback, E37)
                    v.execute("INSERT OR IGNORE INTO save_vor_update (player, game, key, save_version, data, gesichert) "
                              "VALUES (?,?,?,?,?,?)", (player, game, key, alt["save_version"], alt["data"], zeit))
                vorhanden = self._in_verlauf(v, player, game, key)
                if not vorhanden:
                    anzahl = v.execute(
                        "SELECT COUNT(*) FROM saves WHERE player=? AND game=?", (player, game)
                    ).fetchone()[0]
                    if anzahl >= KEYS_MAX:
                        raise ZuGross(f"mehr als {KEYS_MAX} Spielstände für dieses Spiel")
                v.execute(
                    """INSERT INTO saves (player, game, key, data, save_version, updated_at) VALUES (?,?,?,?,?,?)
                       ON CONFLICT (player, game, key) DO UPDATE SET
                         data=excluded.data, save_version=excluded.save_version, updated_at=excluded.updated_at""",
                    (player, game, key, text, save_version, zeit),
                )
                v.execute("COMMIT")
            except BaseException:
                v.execute("ROLLBACK")
                raise
        return {"version": save_version, "updatedAt": zeit}

    def loeschen(self, player: str, game: str, key: str) -> bool:
        with self.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            try:
                vorhanden = self._in_verlauf(v, player, game, key)
                v.execute("DELETE FROM saves WHERE player=? AND game=? AND key=?", (player, game, key))
                v.execute("COMMIT")
            except BaseException:
                v.execute("ROLLBACK")
                raise
        return vorhanden

    # --- Bestenliste ---

    def score_eintragen(self, player: str, game: str, season: int, score: float, werte: dict | None = None) -> None:
        with self.verbindung() as v:
            v.execute("INSERT INTO scores (player, game, season, score, created_at, werte) VALUES (?,?,?,?,?,?)",
                      (player, game, season, score, jetzt(),
                       json.dumps(werte, ensure_ascii=False, separators=(",", ":")) if werte else None))

    def bestenliste(self, game: str, season: int, aufsteigend: bool, limit: int) -> list[dict]:
        """Bester Score je Spieler, sortiert. Bei Gleichstand gewinnt, wer ihn zuerst erreicht hat – in derselben Sekunde
        der frühere Eintrag (id), nicht der Name (fiel mit UUIDs auf, 1.5.0)."""
        richtung = "ASC" if aufsteigend else "DESC"
        with self.verbindung() as v:
            # je Spieler der beste Eintrag (bei Gleichstand der früheste) – mit seinen Zusatzwerten
            zeilen = v.execute(
                f"""SELECT player, score, created_at AS erreicht, werte, id FROM (
                        SELECT player, score, created_at, werte, id,
                               ROW_NUMBER() OVER (PARTITION BY player ORDER BY score {richtung}, created_at ASC, id ASC) AS nr
                        FROM scores WHERE game=? AND season=?)
                    WHERE nr = 1
                    ORDER BY score {richtung}, erreicht ASC, id ASC
                    LIMIT ?""",
                (game, season, limit),
            ).fetchall()
        return [{"rank": i + 1, "player": z["player"], "score": z["score"], "at": z["erreicht"],
                 "werte": json.loads(z["werte"]) if z["werte"] else {}}
                for i, z in enumerate(zeilen)]

    def seasons(self, game: str) -> list[int]:
        with self.verbindung() as v:
            return [z[0] for z in v.execute(
                "SELECT DISTINCT season FROM scores WHERE game=? ORDER BY season", (game,))]

    def bestenliste_loeschen(self, game: str, season: int | None) -> int:
        with self.verbindung() as v:
            if season is None:
                return v.execute("DELETE FROM scores WHERE game=?", (game,)).rowcount
            return v.execute("DELETE FROM scores WHERE game=? AND season=?", (game, season)).rowcount

    # --- Rollback über eine saveVersion-Grenze (E37) ---

    def spielstaende_zurueckholen(self, game: str, bis_save_version: int) -> dict:
        """Alle Spielstände eines Spiels, die neuer als bis_save_version sind, auf den letzten Stand mit
        saveVersion <= bis_save_version zurücksetzen. Der aktuelle Stand landet im Verlauf."""
        zurueck = ohne = 0
        with self.verbindung() as v:
            zeilen = v.execute("SELECT player, key FROM saves WHERE game=? AND save_version > ?",
                               (game, bis_save_version)).fetchall()
        for z in zeilen:
            with self.verbindung() as v:
                alt = v.execute(
                    "SELECT data, save_version FROM save_vor_update WHERE player=? AND game=? AND key=? AND save_version <= ? "
                    "ORDER BY save_version DESC LIMIT 1", (z["player"], game, z["key"], bis_save_version)).fetchone() \
                    or v.execute(
                    "SELECT data, save_version FROM save_history WHERE player=? AND game=? AND key=? AND save_version <= ? "
                    "AND data IS NOT NULL ORDER BY id DESC LIMIT 1", (z["player"], game, z["key"], bis_save_version)).fetchone()
                if not alt:
                    ohne += 1
                    continue
                v.execute("BEGIN IMMEDIATE")
                self._in_verlauf(v, z["player"], game, z["key"])
                v.execute("UPDATE saves SET data=?, save_version=?, updated_at=? WHERE player=? AND game=? AND key=?",
                          (alt["data"], alt["save_version"], jetzt(), z["player"], game, z["key"]))
                v.execute("COMMIT")
                zurueck += 1
        return {"zurueckgeholt": zurueck, "ohneAltenStand": ohne}

    # --- Entwürfe: Testergebnisse ---

    def entwurf_test(self, game: str, player: str, art: str, ok: bool, text: str | None) -> None:
        with self.verbindung() as v:
            v.execute("INSERT INTO entwurf_tests (game, player, art, ok, text, zeit) VALUES (?,?,?,?,?,?)",
                      (game, player, art, int(ok), (text or "")[:300], jetzt()))
            v.execute("DELETE FROM entwurf_tests WHERE game=? AND id NOT IN "
                      "(SELECT id FROM entwurf_tests WHERE game=? ORDER BY id DESC LIMIT 200)", (game, game))

    def entwurf_tests(self, game: str, seit: str) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                "SELECT player, art, ok, text, zeit FROM entwurf_tests WHERE game=? AND zeit >= ? ORDER BY id", (game, seit))]

    def entwurf_zuruecksetzen(self, game: str) -> None:
        """Neuer Entwurf hochgeladen, veröffentlicht oder verworfen: Test-Spielstände und Testergebnisse weg,
        damit der nächste Test wieder mit einer frischen Kopie des echten Spielstands beginnt."""
        with self.verbindung() as v:
            v.execute("DELETE FROM saves WHERE game=?", (game,))
            v.execute("DELETE FROM save_history WHERE game=?", (game,))
            v.execute("DELETE FROM entwurf_tests WHERE game=?", (game,))
            v.execute("DELETE FROM save_vor_update WHERE game=?", (game,))
            v.execute("DELETE FROM erfolge WHERE game=?", (game,))

    def fehler_seit(self, game: str, seit: str) -> int:
        with self.verbindung() as v:
            return v.execute("SELECT COALESCE(SUM(anzahl), 0) FROM fehler WHERE game=? AND letztes >= ?", (game, seit)).fetchone()[0]

    # --- Spielzeit (Zentrale 1.2.0) ---

    def spielzeit_dazu(self, player: str, game: str, sekunden: int, neue_sitzung: bool) -> None:
        with self.verbindung() as v:
            v.execute("""INSERT INTO spielzeit (player, game, sekunden, sitzungen, zuletzt) VALUES (?,?,?,?,?)
                         ON CONFLICT (player, game) DO UPDATE SET sekunden=sekunden+excluded.sekunden,
                           sitzungen=sitzungen+excluded.sitzungen, zuletzt=excluded.zuletzt""",
                      (player, game, sekunden, int(neue_sitzung), jetzt()))

    def spielzeit_je_spiel(self) -> dict[str, dict]:
        with self.verbindung() as v:
            return {z["game"]: {"sekunden": z["s"], "spieler": z["n"], "sitzungen": z["t"]} for z in v.execute(
                f"SELECT game, SUM(sekunden) AS s, COUNT(*) AS n, SUM(sitzungen) AS t FROM spielzeit WHERE {ECHT} GROUP BY game")}

    def spielzeit_von(self, player: str) -> dict[str, dict]:
        with self.verbindung() as v:
            return {z["game"]: {"sekunden": z["sekunden"], "sitzungen": z["sitzungen"], "zuletzt": z["zuletzt"]}
                    for z in v.execute("SELECT * FROM spielzeit WHERE player=?", (player,))}

    # --- Meldungen / Glocke (Zentrale 1.2.0) ---

    def melden(self, an: str, text: str, link: str | None = None, wichtig: bool = False) -> None:
        """an = Spielername oder "*" (alle). wichtig = rote, wackelnde Glocke und Einblendung (Fehler, Anfragen)."""
        with self.verbindung() as v:
            v.execute("INSERT INTO meldungen (an, text, link, zeit, wichtig) VALUES (?,?,?,?,?)", (an, text[:300], link, jetzt(), int(wichtig)))
            v.execute("DELETE FROM meldungen WHERE id NOT IN (SELECT id FROM meldungen ORDER BY id DESC LIMIT 5000)")

    def meldungen(self, player: str, limit: int = 30, archiv: bool = False) -> dict:
        """Eingang (ohne archivierte/gelöschte) oder Archiv. Ungelesen zählt nur im Eingang."""
        filtern = ("AND id IN (SELECT id FROM meldung_status WHERE player=? AND status='archiv')" if archiv
                   else "AND id NOT IN (SELECT id FROM meldung_status WHERE player=?)")
        with self.verbindung() as v:
            z = v.execute("SELECT bis_id FROM meldungen_gelesen WHERE player=?", (player,)).fetchone()
            bis = z["bis_id"] if z else 0
            liste = [dict(r) for r in v.execute(
                f"SELECT id, text, link, zeit, wichtig FROM meldungen WHERE an IN (?, '*') {filtern} ORDER BY id DESC LIMIT ?",
                (player, player, limit))]
            eingang = "AND id NOT IN (SELECT id FROM meldung_status WHERE player=?)"
            neu = v.execute(f"SELECT COUNT(*) FROM meldungen WHERE an IN (?, '*') AND id > ? {eingang}", (player, bis, player)).fetchone()[0]
            wichtig = v.execute(f"SELECT COUNT(*) FROM meldungen WHERE an IN (?, '*') AND id > ? AND wichtig=1 {eingang}",
                                (player, bis, player)).fetchone()[0]
        for m in liste:
            m["neu"] = m["id"] > bis and not archiv
            m["wichtig"] = bool(m["wichtig"])
            m["text"] = re.sub(r"^[^\w„\"(]+\s*", "", m["text"])   # alte Meldungen mit Emoji am Anfang (vor 1.2.1)
        return {"ungelesen": neu, "wichtigUngelesen": wichtig, "liste": liste}

    def meldung_ablegen(self, player: str, meldung_id: int | None, status: str) -> int:
        """status 'archiv' oder 'geloescht'. meldung_id None = alle aus dem Eingang archivieren."""
        with self.verbindung() as v:
            if meldung_id is None:
                return v.execute("""INSERT OR IGNORE INTO meldung_status (player, id, status)
                                    SELECT ?, id, 'archiv' FROM meldungen WHERE an IN (?, '*')""", (player, player)).rowcount
            if not v.execute("SELECT 1 FROM meldungen WHERE id=? AND an IN (?, '*')", (meldung_id, player)).fetchone():
                return 0
            return v.execute("""INSERT INTO meldung_status (player, id, status) VALUES (?,?,?)
                                ON CONFLICT (player, id) DO UPDATE SET status=excluded.status""", (player, meldung_id, status)).rowcount

    def meldung_zurueck(self, player: str, meldung_id: int) -> None:
        with self.verbindung() as v:
            v.execute("DELETE FROM meldung_status WHERE player=? AND id=? AND status='archiv'", (player, meldung_id))

    # --- Getrennte Sitzungen (Zentrale 1.2.1) ---

    def sitzung_trennen(self, player: str, sitzung: int, von: str) -> None:
        with self.verbindung() as v:
            v.execute("INSERT OR IGNORE INTO getrennte_sitzungen (player, sitzung, zeit, von) VALUES (?,?,?,?)", (player, sitzung, jetzt(), von))

    def getrennte_sitzungen(self) -> set[tuple[str, int]]:
        with self.verbindung() as v:
            return {(z["player"], z["sitzung"]) for z in v.execute("SELECT player, sitzung FROM getrennte_sitzungen")}

    def melden_favoriten(self, game: str, text: str, link: str | None = None) -> int:
        """Meldung an alle echten Spieler, die das Spiel als Favorit markiert haben (Updates, Zentrale 1.2.0)."""
        n = 0
        with self.verbindung() as v:
            for z in v.execute(f"SELECT player, daten FROM einstellungen WHERE {ECHT}").fetchall():
                try:
                    fav = json.loads(z["daten"]).get("favoriten") or []
                except ValueError:
                    continue
                if game in fav:
                    v.execute("INSERT INTO meldungen (an, text, link, zeit) VALUES (?,?,?,?)", (z["player"], text[:300], link, jetzt()))
                    n += 1
        return n

    def wichtig_kuerzlich(self, an: str, link: str, minuten: int = 60) -> bool:
        """Gab es für diesen Empfänger und Link schon eine wichtige Meldung? (gegen Meldungsfluten bei vielen Fehlern)"""
        grenze = (datetime.now(timezone.utc) - timedelta(minutes=minuten)).isoformat(timespec="seconds")
        with self.verbindung() as v:
            return v.execute("SELECT 1 FROM meldungen WHERE an=? AND link=? AND wichtig=1 AND zeit > ? LIMIT 1",
                             (an, link, grenze)).fetchone() is not None

    def meldungen_gelesen(self, player: str) -> None:
        with self.verbindung() as v:
            hoechste = v.execute("SELECT COALESCE(MAX(id), 0) FROM meldungen").fetchone()[0]
            v.execute("INSERT INTO meldungen_gelesen (player, bis_id) VALUES (?,?) ON CONFLICT (player) DO UPDATE SET bis_id=excluded.bis_id",
                      (player, hoechste))

    # --- Erfolge (Zentrale 1.2.0) ---

    def erfolg_freischalten(self, player: str, game: str, erfolg: str) -> bool:
        with self.verbindung() as v:
            return v.execute("INSERT OR IGNORE INTO erfolge (player, game, erfolg, zeit) VALUES (?,?,?,?)",
                             (player, game, erfolg, jetzt())).rowcount > 0

    def erfolge_von(self, player: str, game: str | None = None) -> list[dict]:
        with self.verbindung() as v:
            sql, werte = "SELECT game, erfolg, zeit FROM erfolge WHERE player=?", [player]
            if game:
                sql += " AND game=?"; werte.append(game)
            return [dict(z) for z in v.execute(sql + " ORDER BY zeit", werte)]

    # --- Spiel der Woche (Zentrale 1.2.0) ---

    def sdw_setzen(self, game: str, start: str, ende: str) -> None:
        with self.verbindung() as v:
            v.execute("UPDATE spiel_der_woche SET ende=? WHERE ende > ?", (start, start))   # laufendes beenden
            v.execute("INSERT INTO spiel_der_woche (game, start, ende) VALUES (?,?,?)", (game, start, ende))

    def sdw_beenden(self) -> None:
        with self.verbindung() as v:
            v.execute("UPDATE spiel_der_woche SET ende=? WHERE ende > ?", (jetzt(), jetzt()))

    def sdw_aktuell(self) -> dict | None:
        t = jetzt()
        with self.verbindung() as v:
            z = v.execute("SELECT * FROM spiel_der_woche WHERE start <= ? AND ende > ? ORDER BY id DESC LIMIT 1", (t, t)).fetchone()
        return dict(z) if z else None

    def bestenliste_zeitraum(self, game: str, von: str, bis: str, aufsteigend: bool, limit: int) -> list[dict]:
        """Bester Eintrag je Spieler in einem Zeitraum (Spiel der Woche) – unabhängig von Seasons."""
        richtung = "ASC" if aufsteigend else "DESC"
        with self.verbindung() as v:
            zeilen = v.execute(
                f"""SELECT player, score, created_at AS erreicht, werte, id FROM (
                        SELECT player, score, created_at, werte, id,
                               ROW_NUMBER() OVER (PARTITION BY player ORDER BY score {richtung}, created_at ASC, id ASC) AS nr
                        FROM scores WHERE game=? AND created_at >= ? AND created_at < ?)
                    WHERE nr = 1 ORDER BY score {richtung}, erreicht ASC, id ASC LIMIT ?""",
                (game, von, bis, limit)).fetchall()
        return [{"rank": i + 1, "player": z["player"], "score": z["score"], "at": z["erreicht"],
                 "werte": json.loads(z["werte"]) if z["werte"] else {}} for i, z in enumerate(zeilen)]

    def antrag(self, antrag_id: int) -> dict | None:
        with self.verbindung() as v:
            z = v.execute("SELECT * FROM antraege WHERE id=?", (antrag_id,)).fetchone()
        return dict(z) if z else None

    # --- Anmeldungen (E55) ---

    ANMELDUNGEN_MAX = 100

    def anmeldung(self, player: str, sitzung: int, geraet: str, ip: str | None, ort: str | None) -> None:
        with self.verbindung() as v:
            v.execute("""INSERT INTO anmeldungen (player, sitzung, geraet, ip, ort, erste, letzte) VALUES (?,?,?,?,?,?,?)
                         ON CONFLICT (player, sitzung, geraet) DO UPDATE SET letzte=excluded.letzte,
                           ip=COALESCE(excluded.ip, ip), ort=COALESCE(excluded.ort, ort)""",
                      (player, sitzung, geraet, ip, ort, jetzt(), jetzt()))
            v.execute("""DELETE FROM anmeldungen WHERE player=? AND rowid NOT IN (
                             SELECT rowid FROM anmeldungen WHERE player=? ORDER BY letzte DESC LIMIT ?)""",
                      (player, player, self.ANMELDUNGEN_MAX))

    def anmeldungen(self, player: str | None = None, limit: int = 100) -> list[dict]:
        with self.verbindung() as v:
            sql = "SELECT * FROM anmeldungen" + (" WHERE player=?" if player else "") + " ORDER BY letzte DESC LIMIT ?"
            return [dict(z) for z in v.execute(sql, ((player, limit) if player else (limit,)))]

    # --- Simulation („Ansicht als …“) ---

    def konto_leeren(self, player: str) -> int:
        """Alle Daten eines simulierten Kontos löschen. Nur für IDs mit „~“ – echte Konten nie."""
        if "~" not in player:
            raise ValueError("nur simulierte Konten")
        with self.verbindung() as v:
            n = v.execute("DELETE FROM saves WHERE player=?", (player,)).rowcount
            for tabelle in ("save_history", "save_vor_update", "einstellungen", "daumen", "entwurf_tests",
                            "spielzeit", "erfolge", "meldungen_gelesen", "meldung_status"):
                v.execute(f"DELETE FROM {tabelle} WHERE player=?", (player,))
            v.execute("DELETE FROM meldungen WHERE an=?", (player,))
        return n

    # --- Daumen hoch ---

    def daumen_setzen(self, player: str, game: str, an: bool) -> None:
        with self.verbindung() as v:
            if an:
                v.execute("INSERT OR IGNORE INTO daumen (player, game, zeit) VALUES (?,?,?)", (player, game, jetzt()))
            else:
                v.execute("DELETE FROM daumen WHERE player=? AND game=?", (player, game))

    def daumen_zahlen(self) -> dict[str, int]:
        with self.verbindung() as v:
            return dict(v.execute("SELECT game, COUNT(*) FROM daumen GROUP BY game").fetchall())

    def meine_daumen(self, player: str) -> set[str]:
        with self.verbindung() as v:
            return {z[0] for z in v.execute("SELECT game FROM daumen WHERE player=?", (player,))}

    # --- Einstellungen je Spieler ---

    def einstellungen(self, player: str) -> dict:
        with self.verbindung() as v:
            z = v.execute("SELECT daten FROM einstellungen WHERE player=?", (player,)).fetchone()
        return json.loads(z["daten"]) if z else {}

    def einstellungen_setzen(self, player: str, daten: dict) -> None:
        with self.verbindung() as v:
            v.execute("INSERT INTO einstellungen (player, daten) VALUES (?,?) ON CONFLICT (player) DO UPDATE SET daten=excluded.daten",
                      (player, json.dumps(daten, ensure_ascii=False, separators=(",", ":"))))

    # --- Einstellungen je Spiel (Sichtbarkeit, Season) ---

    def spiel_einstellungen(self) -> dict[str, dict]:
        with self.verbindung() as v:
            return {z["game"]: {"versteckt": bool(z["versteckt"]), "hervorgehoben": bool(z["hervorgehoben"]), "season": z["season"],
                                "testspiel": bool(z["testspiel"]), "offline": bool(z["offline"]),
                                "offlineGrund": z["offline_grund"], "offlineSeit": z["offline_seit"]}
                    for z in v.execute("SELECT * FROM spiel_einstellungen")}

    def spiel_setzen(self, game: str, **felder) -> None:
        erlaubt = {"versteckt", "hervorgehoben", "season", "testspiel", "offline", "offline_grund", "offline_seit"}
        felder = {k: v for k, v in felder.items() if k in erlaubt}
        if not felder:
            return
        with self.verbindung() as v:
            v.execute("INSERT OR IGNORE INTO spiel_einstellungen (game) VALUES (?)", (game,))
            for k, wert in felder.items():
                v.execute(f"UPDATE spiel_einstellungen SET {k}=? WHERE game=?", (wert, game))

    def season_override(self, game: str) -> int | None:
        with self.verbindung() as v:
            z = v.execute("SELECT season FROM spiel_einstellungen WHERE game=?", (game,)).fetchone()
        return z["season"] if z else None

    # --- Auswertungen ---

    def meine_spielstaende(self, player: str) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                "SELECT game, key, length(data) AS bytes, save_version AS version, updated_at AS updatedAt "
                "FROM saves WHERE player=? ORDER BY game, key", (player,))]

    def spielstaende_loeschen(self, player: str, game: str) -> int:
        """Alle Spielstände eines Spielers für ein Spiel – jeder alte Stand landet im Verlauf."""
        n = 0
        for key in self.keys(player, game):
            n += self.loeschen(player, game, key)
        return n

    def zuletzt_gespielt(self, player: str) -> dict[str, str]:
        with self.verbindung() as v:
            return {z["game"]: z["zeit"] for z in v.execute(
                """SELECT game, MAX(zeit) AS zeit FROM (
                       SELECT game, updated_at AS zeit FROM saves WHERE player=?
                       UNION ALL SELECT game, created_at FROM scores WHERE player=?) GROUP BY game""", (player, player))}

    def spiel_statistik(self) -> dict[str, dict]:
        """Je Spiel: Anzahl Spieler, zuletzt gespielt, Bestenlisten-Einträge (alle Seasons)."""
        with self.verbindung() as v:
            zeilen = v.execute(
                """SELECT game, COUNT(DISTINCT player) AS spieler, MAX(zeit) AS zuletzt FROM (
                       SELECT game, player, updated_at AS zeit FROM saves WHERE {ECHT}
                       UNION ALL SELECT game, player, created_at FROM scores WHERE {ECHT}) GROUP BY game""".format(ECHT=ECHT)).fetchall()
            eintraege = dict(v.execute(f"SELECT game, COUNT(*) FROM scores WHERE {ECHT} GROUP BY game").fetchall())
        return {z["game"]: {"spieler": z["spieler"], "zuletzt": z["zuletzt"], "scores": eintraege.get(z["game"], 0)}
                for z in zeilen}

    def letzte_aktivitaet(self, limit: int = 25) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                """SELECT player, game, MAX(zeit) AS zeit FROM (
                       SELECT player, game, updated_at AS zeit FROM saves WHERE {ECHT}
                       UNION ALL SELECT player, game, created_at FROM scores WHERE {ECHT})
                   GROUP BY player, game ORDER BY zeit DESC LIMIT ?""".format(ECHT=ECHT), (limit,))]

    def schreibtest(self) -> None:
        """Für den Wächter: einmal wirklich schreiben (Lesen allein merkt keinen Schreibschutz, siehe 06.11.2026)."""
        with self.verbindung() as v:
            v.execute("INSERT INTO waechter_probe (id, zeit) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET zeit=excluded.zeit", (jetzt(),))

    # --- Aufträge und Zeitplan (Zentrale 1.3.0) ---

    AUFTRAG_MAX_LAUFZEIT = timedelta(hours=2)

    def auftrag_anlegen(self, art: str, ziel: str, quelle: str, von: str | None) -> int | None:
        """None, wenn derselbe Auftrag schon wartet oder läuft."""
        with self.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            if v.execute("SELECT 1 FROM auftraege WHERE art=? AND ziel=? AND status IN ('wartet','laeuft')", (art, ziel)).fetchone():
                v.execute("COMMIT")
                return None
            aid = v.execute("INSERT INTO auftraege (art, ziel, quelle, von, angelegt) VALUES (?,?,?,?,?)",
                            (art, ziel, quelle, von, jetzt())).lastrowid
            v.execute("COMMIT")
            return aid

    def auftraege_holen(self, ausser: set[tuple[str, str]] | None = None) -> list[dict]:
        """Für den Auftragsdienst: wartende Aufträge übernehmen (→ läuft). Hängengebliebene werden abgeschlossen.
        ausser (1.4.1): (art, ziel), die liegen bleiben – die übernimmt der Mac (scripts/auftraege-mac.py)."""
        grenze = (datetime.now(timezone.utc) - self.AUFTRAG_MAX_LAUFZEIT).isoformat(timespec="seconds")
        with self.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            v.execute("UPDATE auftraege SET status='fehler', ende=?, zusammenfassung='abgebrochen (keine Rückmeldung nach 2 h)' "
                      "WHERE status='laeuft' AND start < ?", (jetzt(), grenze))
            liste = [dict(z) for z in v.execute("SELECT id, art, ziel FROM auftraege WHERE status='wartet' ORDER BY id")
                     if (z["art"], z["ziel"]) not in (ausser or set())]
            for z in liste:
                v.execute("UPDATE auftraege SET status='laeuft', start=? WHERE id=?", (jetzt(), z["id"]))
            v.execute("COMMIT")
        return liste

    def auftrag_fertig(self, auftrag_id: int | None, status: str, zusammenfassung: str, log: str,
                       art: str | None = None, ziel: str | None = None, start: str | None = None) -> int:
        """Ergebnis eintragen. Ohne ID wird ein neuer Eintrag angelegt (z. B. Live-Deploy nach Freigabe)."""
        log = log[-20000:]
        with self.verbindung() as v:
            if auftrag_id is None:
                return v.execute("INSERT INTO auftraege (art, ziel, quelle, angelegt, status, start, ende, zusammenfassung, log) "
                                 "VALUES (?,?,?,?,?,?,?,?,?)", (art, ziel, "dienst", jetzt(), status, start or jetzt(), jetzt(),
                                                                zusammenfassung, log)).lastrowid
            v.execute("UPDATE auftraege SET status=?, ende=?, zusammenfassung=?, log=? WHERE id=?",
                      (status, jetzt(), zusammenfassung, log, auftrag_id))
            return auftrag_id

    def auftraege(self, limit: int = 30) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                "SELECT id, art, ziel, quelle, von, angelegt, status, start, ende, zusammenfassung FROM auftraege ORDER BY id DESC LIMIT ?",
                (limit,))]

    def auftrag(self, auftrag_id: int) -> dict | None:
        with self.verbindung() as v:
            z = v.execute("SELECT * FROM auftraege WHERE id=?", (auftrag_id,)).fetchone()
        return dict(z) if z else None

    def zeitplan(self) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute("SELECT * FROM zeitplan ORDER BY art, ziel")]

    def zeitplan_setzen(self, art: str, ziel: str, uhrzeit: str | None) -> None:
        with self.verbindung() as v:
            if uhrzeit:
                v.execute("INSERT INTO zeitplan (art, ziel, uhrzeit) VALUES (?,?,?) ON CONFLICT (art, ziel) DO UPDATE SET uhrzeit=excluded.uhrzeit",
                          (art, ziel, uhrzeit))
            else:
                v.execute("DELETE FROM zeitplan WHERE art=? AND ziel=?", (art, ziel))

    def zeitplan_faellig(self, heute: str, uhrzeit: str) -> list[dict]:
        """Einträge, deren Uhrzeit heute erreicht ist und die heute noch nicht dran waren – werden dabei als erledigt markiert."""
        with self.verbindung() as v:
            v.execute("BEGIN IMMEDIATE")
            liste = [dict(z) for z in v.execute("SELECT * FROM zeitplan WHERE uhrzeit <= ? AND (zuletzt IS NULL OR zuletzt < ?)",
                                                (uhrzeit, heute))]
            for z in liste:
                v.execute("UPDATE zeitplan SET zuletzt=? WHERE art=? AND ziel=?", (heute, z["art"], z["ziel"]))
            v.execute("COMMIT")
        return liste

    def aufgaben_der_kopie_leeren(self) -> int:
        """Testserver (1.4.1, Nachtest 09.11.): Die Probe ist eine Kopie der Live-Daten – samt Aufgaben-Verlauf der
        Live-Bibliothek und dessen roten Glocken. Im Testserver sah es dadurch ständig so aus, als brächen die
        Ende-zu-Ende-Tests ab. Einmal je frischer Kopie: Verlauf, Meldungen dazu und Lebenszeichen des NAS-Dienstes weg."""
        with self.verbindung() as v:
            n = v.execute("DELETE FROM auftraege").rowcount
            v.execute("DELETE FROM meldungen WHERE link='/admin/#aufgaben'")
            v.execute("DELETE FROM dienst_status WHERE name IN ('auftragsdienst', 'mac')")
        return n

    def dienst_setzen(self, name: str, wert: str) -> None:
        with self.verbindung() as v:
            v.execute("INSERT INTO dienst_status (name, wert, zeit) VALUES (?,?,?) ON CONFLICT (name) DO UPDATE SET wert=excluded.wert, zeit=excluded.zeit",
                      (name, wert, jetzt()))

    def dienst(self, name: str) -> dict | None:
        with self.verbindung() as v:
            z = v.execute("SELECT * FROM dienst_status WHERE name=?", (name,)).fetchone()
        return dict(z) if z else None

    def zaehlen(self) -> dict:
        with self.verbindung() as v:
            return {t: v.execute(f"SELECT COUNT(*) FROM {t} WHERE {ECHT}").fetchone()[0]
                    for t in ("saves", "save_history", "scores", "antraege")}

    # --- Spielstände (Admin) ---

    def spielstaende(self, player: str | None, game: str | None) -> list[dict]:
        bedingung, werte = [], []
        if player:
            bedingung.append("player=?"); werte.append(player)
        if game:
            bedingung.append("game=?"); werte.append(game)
        if not player:
            bedingung.append(ECHT)   # Simulation nur, wenn ausdrücklich danach gefiltert wird
        wo = ("WHERE " + " AND ".join(bedingung)) if bedingung else ""
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                f"SELECT player, game, key, length(data) AS bytes, save_version AS version, updated_at AS updatedAt "
                f"FROM saves {wo} ORDER BY updated_at DESC LIMIT 500", werte)]

    def verlauf_mit_daten(self, player: str, game: str, key: str) -> list[dict]:
        with self.verbindung() as v:
            return [{**dict(z), "data": json.loads(z["data"])} for z in v.execute(
                "SELECT id, data, save_version AS version, saved_at AS savedAt FROM save_history "
                "WHERE player=? AND game=? AND key=? ORDER BY id DESC", (player, game, key))]

    def scores_liste(self, game: str, season: int | None) -> list[dict]:
        with self.verbindung() as v:
            zeilen = v.execute(
                "SELECT id, player, season, score, werte, created_at AS zeit FROM scores WHERE game=? "
                + ("AND season=? " if season else "") + "ORDER BY created_at DESC LIMIT 500",
                (game, season) if season else (game,)).fetchall()
        return [{**dict(z), "werte": json.loads(z["werte"]) if z["werte"] else {}} for z in zeilen]

    def score_loeschen(self, score_id: int) -> bool:
        with self.verbindung() as v:
            return v.execute("DELETE FROM scores WHERE id=?", (score_id,)).rowcount > 0

    # --- Sicherheitsprotokoll (Zentrale 1.4.0) ---

    SICHERHEIT_TAGE = 365

    def sicherheit_eintragen(self, art: str, wer: str | None, text: str) -> None:
        grenze = (datetime.now(timezone.utc) - timedelta(days=self.SICHERHEIT_TAGE)).isoformat(timespec="seconds")
        with self.verbindung() as v:
            v.execute("INSERT INTO sicherheit (zeit, art, wer, text) VALUES (?,?,?,?)", (jetzt(), art[:40], (wer or "")[:60], text[:1000]))
            v.execute("DELETE FROM sicherheit WHERE zeit < ?", (grenze,))

    def sicherheit_von(self, wer: str, anzahl: int = 100) -> list[dict]:
        """Sicherheitsprotokoll einer Person (1.5.0): eigene Einträge und getrennte Sitzungen."""
        with self.verbindung() as v:
            z = [dict(x) for x in v.execute("SELECT zeit, art, wer, text FROM sicherheit WHERE wer=? ORDER BY id DESC LIMIT ?", (wer, anzahl))]
            z += [{"zeit": x["zeit"], "art": "getrennt", "wer": wer, "text": f"Anmeldung getrennt (Sitzung {x['sitzung']}) durch {x['von']}"}
                  for x in v.execute("SELECT * FROM getrennte_sitzungen WHERE player=? ORDER BY zeit DESC LIMIT ?", (wer, anzahl))]
        return z

    def sicherheit_liste(self, anzahl: int = 200) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute("SELECT * FROM sicherheit ORDER BY id DESC LIMIT ?", (anzahl,))]

    # --- Fehlerberichte (gebündelt, ohne Spielerdaten) ---

    FEHLER_MAX_JE_SPIEL = 200

    def fehler_melden(self, game: str, meldung: str, quelle: str, zeile: int, spalte: int, stack: str | None, browser: str) -> bool:
        """Liefert True, wenn diese Fehlerart neu ist (für die Glocke des Entwicklers)."""
        zeit = jetzt()
        with self.verbindung() as v:
            neu = v.execute("SELECT 1 FROM fehler WHERE game=? AND meldung=? AND quelle=? AND zeile=?",
                            (game, meldung, quelle, zeile)).fetchone() is None
            v.execute(
                """INSERT INTO fehler (game, meldung, quelle, zeile, spalte, stack, browser, erstes, letztes)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (game, meldung, quelle, zeile) DO UPDATE SET
                     anzahl = anzahl + 1, letztes = excluded.letztes, stack = excluded.stack, browser = excluded.browser""",
                (game, meldung, quelle, zeile, spalte, stack, browser, zeit, zeit))
            v.execute("""DELETE FROM fehler WHERE game=? AND id NOT IN (
                             SELECT id FROM fehler WHERE game=? ORDER BY letztes DESC LIMIT ?)""",
                      (game, game, self.FEHLER_MAX_JE_SPIEL))
        return neu

    def fehler_nummer(self, game: str, meldung: str, quelle: str, zeile: int) -> int | None:
        """Nummer eines Fehlerberichts – die Bibliothek zeigt sie dem Spieler, damit er sie Seb nennen kann."""
        with self.verbindung() as v:
            z = v.execute("SELECT id FROM fehler WHERE game=? AND meldung=? AND quelle=? AND zeile=?",
                          (game, meldung, quelle, zeile)).fetchone()
        return z["id"] if z else None

    def fehler_liste(self, spiele: list[str] | None = None) -> list[dict]:
        with self.verbindung() as v:
            if spiele is None:
                zeilen = v.execute("SELECT * FROM fehler ORDER BY letztes DESC LIMIT 500").fetchall()
            else:
                if not spiele:
                    return []
                frage = ",".join("?" * len(spiele))
                zeilen = v.execute(f"SELECT * FROM fehler WHERE game IN ({frage}) ORDER BY letztes DESC LIMIT 500", spiele).fetchall()
        return [dict(z) for z in zeilen]

    def fehler_zahlen(self) -> dict[str, dict]:
        """Je Spiel: Fehlerarten, Vorkommen gesamt, Arten der letzten 24 h, zuletzt."""
        grenze = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")
        with self.verbindung() as v:
            return {z["game"]: {"arten": z["arten"], "anzahl": z["anzahl"], "arten24h": z["arten24h"], "zuletzt": z["zuletzt"]}
                    for z in v.execute(
                        """SELECT game, COUNT(*) AS arten, SUM(anzahl) AS anzahl, MAX(letztes) AS zuletzt,
                                  SUM(CASE WHEN letztes > ? THEN 1 ELSE 0 END) AS arten24h
                           FROM fehler GROUP BY game""", (grenze,))}

    def fehler_eintrag(self, fehler_id: int) -> dict | None:
        with self.verbindung() as v:
            z = v.execute("SELECT * FROM fehler WHERE id=?", (fehler_id,)).fetchone()
        return dict(z) if z else None

    def fehler_loeschen(self, fehler_id: int) -> bool:
        with self.verbindung() as v:
            return v.execute("DELETE FROM fehler WHERE id=?", (fehler_id,)).rowcount > 0

    # --- Spielstände in einen Entwurf kopieren ---

    def spielstaende_kopieren(self, player: str, von: str, nach: str) -> int:
        """Kopiert die Spielstände eines Spielers – nur wenn das Ziel für ihn noch leer ist."""
        with self.verbindung() as v:
            if v.execute("SELECT 1 FROM saves WHERE player=? AND game=? LIMIT 1", (player, nach)).fetchone():
                return 0
            return v.execute(
                "INSERT INTO saves (player, game, key, data, save_version, updated_at) "
                "SELECT player, ?, key, data, save_version, ? FROM saves WHERE player=? AND game=?",
                (nach, jetzt(), player, von)).rowcount

    # --- Anfragen ---

    def antrag_anlegen(self, player: str, art: str, spiel: str | None, text: str) -> int:
        with self.verbindung() as v:
            return v.execute("INSERT INTO antraege (player, art, spiel, text, erstellt, geaendert) VALUES (?,?,?,?,?,?)",
                             (player, art, spiel, text, jetzt(), jetzt())).lastrowid

    def antraege(self, player: str | None = None) -> list[dict]:
        with self.verbindung() as v:
            if player:
                return [dict(z) for z in v.execute("SELECT * FROM antraege WHERE player=? ORDER BY id DESC", (player,))]
            return [dict(z) for z in v.execute(
                "SELECT * FROM antraege ORDER BY CASE status WHEN 'offen' THEN 0 ELSE 1 END, id DESC")]

    def antrag_bild_anlegen(self, antrag_id: int, art: str, daten: bytes, von: str, maximal: int) -> int | None:
        """None = schon `maximal` Bilder an dieser Anfrage."""
        with self.verbindung() as v:
            if v.execute("SELECT COUNT(*) FROM antrag_bilder WHERE antrag_id=?", (antrag_id,)).fetchone()[0] >= maximal:
                return None
            return v.execute("INSERT INTO antrag_bilder (antrag_id, art, daten, von, erstellt) VALUES (?,?,?,?,?)",
                             (antrag_id, art, daten, von, jetzt())).lastrowid

    def antrag_bilder(self, antrag_id: int) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                "SELECT id, art, length(daten) AS bytes, von, erstellt FROM antrag_bilder WHERE antrag_id=? ORDER BY id", (antrag_id,))]

    def antrag_bild_zahlen(self) -> dict[int, int]:
        with self.verbindung() as v:
            return {z[0]: z[1] for z in v.execute("SELECT antrag_id, COUNT(*) FROM antrag_bilder GROUP BY antrag_id")}

    def antrag_bild(self, antrag_id: int, bild_id: int) -> tuple[str, bytes] | None:
        with self.verbindung() as v:
            z = v.execute("SELECT art, daten FROM antrag_bilder WHERE id=? AND antrag_id=?", (bild_id, antrag_id)).fetchone()
        return (z["art"], bytes(z["daten"])) if z else None

    def antrag_bild_loeschen(self, antrag_id: int, bild_id: int) -> bool:
        with self.verbindung() as v:
            return v.execute("DELETE FROM antrag_bilder WHERE id=? AND antrag_id=?", (bild_id, antrag_id)).rowcount > 0

    def antrag_bearbeiten(self, antrag_id: int, status: str, antwort: str | None, von: str | None = None) -> bool:
        with self.verbindung() as v:
            return v.execute("UPDATE antraege SET status=?, antwort=?, geaendert=?, beantwortet_von=? WHERE id=?",
                             (status, antwort, jetzt(), von, antrag_id)).rowcount > 0

    # --- Admin ---

    def verlauf(self, player: str, game: str, key: str) -> list[dict]:
        with self.verbindung() as v:
            return [dict(z) for z in v.execute(
                "SELECT id, save_version, saved_at, length(data) AS bytes FROM save_history "
                "WHERE player=? AND game=? AND key=? ORDER BY id DESC", (player, game, key))]

    def wiederherstellen(self, verlauf_id: int) -> dict:
        with self.verbindung() as v:
            z = v.execute("SELECT * FROM save_history WHERE id=?", (verlauf_id,)).fetchone()
        if not z:
            raise KeyError(verlauf_id)
        self.speichern(z["player"], z["game"], z["key"], json.loads(z["data"]), z["save_version"])
        return dict(player=z["player"], game=z["game"], key=z["key"])

    def sichern(self, ziel: Path) -> None:
        """Konsistente Kopie über die SQLite-Backup-API."""
        ziel.parent.mkdir(parents=True, exist_ok=True)
        tmp = ziel.with_suffix(ziel.suffix + ".tmp")
        quelle = sqlite3.connect(self.pfad)
        kopie = sqlite3.connect(tmp)
        try:
            quelle.backup(kopie)
        finally:
            kopie.close()
            quelle.close()
        tmp.replace(ziel)
