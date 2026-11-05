"""SQLite: Spielstände, Verlauf und Bestenliste."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
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
"""


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

    def score_eintragen(self, player: str, game: str, season: int, score: float) -> None:
        with self.verbindung() as v:
            v.execute("INSERT INTO scores (player, game, season, score, created_at) VALUES (?,?,?,?,?)",
                      (player, game, season, score, jetzt()))

    def bestenliste(self, game: str, season: int, aufsteigend: bool, limit: int) -> list[dict]:
        """Bester Score je Spieler, sortiert. Bei Gleichstand gewinnt, wer ihn zuerst erreicht hat."""
        best = "MIN" if aufsteigend else "MAX"
        richtung = "ASC" if aufsteigend else "DESC"
        with self.verbindung() as v:
            zeilen = v.execute(
                f"""SELECT s.player, s.score, MIN(s.created_at) AS erreicht
                    FROM scores s
                    JOIN (SELECT player, {best}(score) AS bester FROM scores
                          WHERE game=? AND season=? GROUP BY player) b
                      ON s.player = b.player AND s.score = b.bester
                    WHERE s.game=? AND s.season=?
                    GROUP BY s.player, s.score
                    ORDER BY s.score {richtung}, erreicht ASC
                    LIMIT ?""",
                (game, season, game, season, limit),
            ).fetchall()
        return [{"rank": i + 1, "player": z["player"], "score": z["score"], "at": z["erreicht"]}
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
