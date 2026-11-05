"""Spiel aus einer ZIP-Datei sicher installieren (Phase 6b, ersetzt File Browser – E19).

Schutz gegen präparierte ZIPs:
- keine absoluten Pfade, kein "..", keine Backslashes, keine Laufwerksbuchstaben (Zip-Slip)
- keine Symlinks
- Grenzen für Dateianzahl, Einzeldatei und entpackte Gesamtgröße; die Größe wird beim Entpacken
  tatsächlich gezählt, nicht den Angaben im ZIP geglaubt (ZIP-Bombe)
- nicht erlaubte Dateitypen und versteckte Dateien werden übersprungen und gemeldet
  (Caddy würde sie ohnehin nicht ausliefern)

Installiert wird erst in einen versteckten Nachbarordner, dann atomar umbenannt:
Spieler sehen nie eine Mischung aus alter und neuer Version.
"""

import os
import re
import secrets
import shutil
import stat
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

# muss zur Whitelist in der Caddyfile passen
ERLAUBT = re.compile(
    r"\.(html?|m?js|css|json|png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf|otf|wasm|txt|glb|gltf|bin)$",
    re.IGNORECASE,
)
MAX_DATEIEN = 3000
MAX_EINZELDATEI = 100 * 1024 * 1024
MAX_GESAMT = 300 * 1024 * 1024
BLOCK = 1024 * 1024


class UngueltigesZip(Exception):
    pass


@dataclass
class Ergebnis:
    dateien: int = 0
    bytes: int = 0
    uebersprungen: list[str] = field(default_factory=list)


def _teile(name: str) -> tuple[str, ...]:
    if not name or "\\" in name or name.startswith("/") or "\x00" in name:
        raise UngueltigesZip(f"unzulässiger Pfad im ZIP: {name!r}")
    teile = PurePosixPath(name).parts
    if any(t in ("..", "") for t in teile) or (teile and ":" in teile[0]):
        raise UngueltigesZip(f"unzulässiger Pfad im ZIP: {name!r}")
    return teile


def _ist_symlink(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


def _wurzel(eintraege: list[tuple[tuple[str, ...], zipfile.ZipInfo]]) -> int:
    """Wie viele führende Pfadteile abgeschnitten werden: 0 = index.html liegt oben,
    1 = alles steckt in einem einzigen Ordner (typisch beim Zippen eines Ordners)."""
    dateien = [t for t, i in eintraege if not i.is_dir()]
    if ("index.html",) in dateien:
        return 0
    oben = {t[0] for t, _ in eintraege}
    if len(oben) == 1 and (next(iter(oben)), "index.html") in dateien:
        return 1
    raise UngueltigesZip("index.html fehlt – sie muss im ZIP ganz oben liegen (oder in genau einem Ordner)")


def installieren(zip_pfad: Path, ziel: Path, wegraeumen=None) -> Ergebnis:
    """Entpackt zip_pfad nach ziel (ersetzt einen vorhandenen Ordner atomar).
    wegraeumen(): verschiebt einen vorhandenen ziel-Ordner (z. B. ins Versionsarchiv) – sonst wird er gelöscht."""
    try:
        z = zipfile.ZipFile(zip_pfad)
    except (zipfile.BadZipFile, OSError):
        raise UngueltigesZip("keine gültige ZIP-Datei") from None

    with z:
        infos = z.infolist()
        if len(infos) > MAX_DATEIEN:
            raise UngueltigesZip(f"zu viele Einträge (max. {MAX_DATEIEN})")
        eintraege = []
        for info in infos:
            teile = _teile(info.filename)
            if _ist_symlink(info):
                raise UngueltigesZip(f"Symlinks sind nicht erlaubt: {info.filename}")
            if teile[0] == "__MACOSX":
                continue
            eintraege.append((teile, info))
        if not eintraege:
            raise UngueltigesZip("ZIP ist leer")
        if sum(i.file_size for _, i in eintraege) > MAX_GESAMT:
            raise UngueltigesZip(f"entpackt größer als {MAX_GESAMT // 1024 // 1024} MB")
        abschneiden = _wurzel(eintraege)

        ergebnis = Ergebnis()
        eltern = ziel.parent
        eltern.mkdir(parents=True, exist_ok=True)
        neu = eltern / f".neu-{ziel.name}-{secrets.token_hex(4)}"
        neu.mkdir(mode=0o770)
        try:
            for teile, info in eintraege:
                rest = teile[abschneiden:]
                if not rest or info.is_dir():
                    continue
                if any(t.startswith(".") for t in rest) or not ERLAUBT.search(rest[-1]):
                    ergebnis.uebersprungen.append("/".join(rest))
                    continue
                pfad = neu.joinpath(*rest)
                # Gürtel und Hosenträger: Ziel muss innerhalb von "neu" liegen
                if not pfad.resolve().is_relative_to(neu.resolve()):
                    raise UngueltigesZip(f"unzulässiger Pfad im ZIP: {info.filename}")
                pfad.parent.mkdir(parents=True, exist_ok=True, mode=0o770)
                geschrieben = 0
                with z.open(info) as quelle, open(os.open(pfad, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o660), "wb") as aus:
                    while block := quelle.read(BLOCK):
                        geschrieben += len(block)
                        ergebnis.bytes += len(block)
                        if geschrieben > MAX_EINZELDATEI or ergebnis.bytes > MAX_GESAMT:
                            raise UngueltigesZip("entpackt zu groß (ZIP-Bombe?)")
                        aus.write(block)
                ergebnis.dateien += 1
            if not (neu / "index.html").is_file():
                raise UngueltigesZip("index.html fehlt")
            # Rechte unabhängig von der umask setzen: Gruppenbits bilden die ACL-Maske
            for wurzel, ordner, dateien in os.walk(neu):
                os.chmod(wurzel, 0o770)
                for d in dateien:
                    os.chmod(os.path.join(wurzel, d), 0o660)

            # atomar austauschen
            alt = None
            if ziel.exists():
                if wegraeumen:
                    wegraeumen()
                else:
                    alt = eltern / f".alt-{ziel.name}-{secrets.token_hex(4)}"
                    ziel.rename(alt)
            neu.rename(ziel)
            if alt:
                shutil.rmtree(alt, ignore_errors=True)
            return ergebnis
        except zipfile.BadZipFile:  # z. B. CRC-Fehler beim Entpacken
            shutil.rmtree(neu, ignore_errors=True)
            raise UngueltigesZip("ZIP-Datei ist beschädigt") from None
        except BaseException:
            shutil.rmtree(neu, ignore_errors=True)
            raise
