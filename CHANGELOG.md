# Änderungsprotokoll der Zentrale (Spielebibliothek)

Versionen der Bibliothek selbst – nicht der Spiele. Schema `MAJOR.MINOR.PATCH` wie bei den Spielen (E39):
**großes Update** (Umbau, Abläufe für Entwickler ändern sich), **kleines Update** (neue Funktionen), **Patch/Hotfix** (Fehler behoben).
Vor jedem Deploy: Nummer in `VERSION` erhöhen und hier einen Abschnitt ergänzen – `scripts/deploy.sh` prüft beides.
Zurück auf eine frühere Version: `scripts/deploy.sh --zurueck <version>`.

## 1.1.1 – 05.11.2026

- **Behoben:** Testspiele (Spike, Böse, Bestenlisten-Vorlage …) erscheinen nicht mehr unter „Meine Spiele“ – verwaltet werden sie nur im Admin-Panel.
- **Geändert:** „Ansicht als Spieler/Entwickler“ beginnt bei jedem Start mit leerem Konto (Spielstände, Einstellungen, Zwischenspeicher).

## 1.1.0 – 05.11.2026

- **Neu:** Die Zentrale ist versioniert. Deploy nur mit neuer Nummer, Tests vorher, Datenbank-Sicherung und Archiv des alten Stands vorher, Rückweg mit `--zurueck`.
- **Neu:** Entwickler können eigene Spiele offline nehmen (Meine Spiele), z. B. bei vielen Fehlern. Admins können es ebenfalls.
- **Neu:** „Update hochladen“ an jedem Spiel auf der Upload-Seite legt den Ordner fest. Ein neuer Ordnername wird vorher nachgefragt.
- **Neu:** Hilfe-Center mit den Reitern „Spielen“ und „Spiele entwickeln“, Fußzeile mit Hilfe, Handbuch, Fehler melden und Version. Das Handbuch ist nicht mehr im Kontextmenü.
- **Behoben:** Das Admin-Panel zählte Testspiele als Spiele (7 statt 4).
- **Behoben:** Das Testspiel „Sandbox-Spike“ zeigt seine Ergebnisse jetzt selbst an. Bisher tat das nur die Testseite `/spike/`, in der Bibliothek blieb „läuft …“ stehen. Wird mit `--examples` ausgeliefert.

## 1.0.0 – 05.11.2026

Erster versionierter Stand. Er umfasst alles bis hierher:
- Bibliothek, Spiele auf eigenem Origin, GameSave mit `localStorage`-Ersatz, Bestenliste mit Seasons und Spalten
- ZIP-Upload, Härtung, Backup
- Kontextmenü, Anträge, Admin-Panel, „Ansicht als …“
- Entwürfe, Versionen der Spiele, Fehlerberichte
- Zwischenspeicher bei Sitzungsablauf
- „Was ist neu“, Daumen hoch
- Versionierung der Spiele mit Update-Fenster, Prüfung und Rollback samt Spielständen
- Hilfe und Entwickler-Handbuch, Startvorlage, Testspiele
