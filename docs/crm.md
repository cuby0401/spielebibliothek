# CRM – Personen, Rollen, Einladungen (Zentrale 1.4.0, ausgebaut in 1.5.0)

Entscheidungen im Vault: E67 (Cloudflare Access bleibt, nur mit Einladung), E68 (CRM statt `users.yaml`).

## Was wo liegt

- **Personen** stehen in der Datenbank (`saves.db`, Tabellen `personen`, `person_emails`, `person_rollen`,
  `person_notizen`, `person_ereignisse`, `crm_protokoll`) – Code: `savesvc/savesvc/crm.py`, Endpunkte: `personen.py`.
- **`config/users.yaml`** ist nur noch ein **Export**: alle, die gerade hinein dürfen (eingeladen, aktiv, verwarnt).
  Der Upload-Dienst (eigener Container) liest ihn, und er ist der Rückweg bei `deploy.sh --zurueck` auf eine Version vor 1.4.0.
  Von Hand ergänzte Einträge werden beim nächsten Lesen als neue Person übernommen; entfernen geht nur im Admin-Panel.
- **Übernahme:** Beim ersten Start von 1.4.0 werden alle Einträge aus `users.yaml` übernommen
  (Rollen: `ADMINS` → admin, eigener Spieleordner → entwickler, alle → spieler). Vorher liegt eine Kopie in
  `data/backup/users-vor-crm-<Zeit>.yaml`.

## Identität (1.5.0, E81/E82)

Jede Person hat drei Schichten:

| | Beispiel | |
|---|---|---|
| **ID** | UUID | zufällig, ändert sich nie. Alle Tabellen verweisen darauf (Spalten `player`, `name`, `von` …). Verlässt den Server nie. |
| **Handle** | `@paul` | eindeutig, in Adressen und neben dem Anzeigenamen. Alle 30 Tage änderbar (ab der letzten Änderung; der Admin ohne Frist). Frühere Handles bleiben für die Person reserviert und leiten weiter (Tabelle `handles`). |
| **Anzeigename** | „Phil 🚀“ | frei, nicht eindeutig. |

Dazu die **Personennummer** `P-0007` (fortlaufend, nur im Admin-Bereich) und der **Spieleordner** (`personen.alt_name`): der erste
Benutzername, ändert sich nie. Spiel-IDs (`paul/Dino_Park`), der Upload-Dienst, `users.yaml` und die Ergebnisse des Tester-Panels
arbeiten mit dem Spieleordner.

- **Umstellung** (`savesvc/identitaet.py`): beim ersten Start von 1.5.0, einmalig, in einer Transaktion. Vorher Sicherung
  `data/backup/vor-uuid-<Tag>.db`, danach Prüfung (Zeilenzahl, Prüfsumme jeder Tabelle, kein alter Name übrig). Scheitert etwas,
  bleibt die Datenbank unverändert und der Dienst startet nicht. Stand abfragen: `python -m savesvc identitaet-status`.
- **Rückweg:** `scripts/deploy.sh --zurueck 1.4.1` stellt die Datenbank vorher automatisch zurück (`identitaet-zurueck`).
- **Innen UUID, außen Handle:** Eine Schicht in `app.py` übersetzt Handles in Adressen (`/api/profil/…`, `/api/admin/personen/…`, auch
  `P-0007`) und `?player=` in die UUID und jede UUID in JSON-Antworten in das aktuelle Handle – auch in Texten. Gelöschte Personen
  erscheinen als „gelöschte Person“ – auch im Admin-Bereich (Liste, Karte, Prüfprotokoll, Auskunft: `identitaet.anonymisieren`
  ersetzt Handle, frühere Handles und Ordnernamen). Spiele-Adressen behalten den Ordnernamen.
- **Spiele** bekommen über `GameSave.player()` das Handle, nie die UUID.
- **Tests:** `tests/test_identitaet.py` (Umstellung, Rückweg, keine UUID nach außen), `test_handle.py`, `test_zugriff.py` (fremde IDs).
  Die ganze Sammlung läuft standardmäßig mit UUIDs, mit `TEST_IDENTITAET_UUID=0` wie in 1.4.1.

## CRM-Oberfläche (1.5.0)

Admin-Panel → **CRM**: Suche nach Nummer, Name, Handle (auch früheren) oder E-Mail, Enter bei einem Treffer öffnet die Karte.
Kacheln und Filter nach Rolle, Status und „seit 30 Tagen nicht da“. Die **Personenkarte** zeigt alles auf einen Blick, leere Blöcke
fehlen: Stammdaten, Notizen, Login-E-Mails, Rollen, Status und Maßnahmen, eigene Spiele, gespielte Spiele, Anfragen (gestellt und als
Entwickler bekommen), Anmeldungen, Sicherheitsprotokoll, Zeitleiste, Prüfprotokoll.

**Sicherheitsprotokoll je Person:** abgelehnte Zugriffe (403) und Rate-Limits (429) – je Person, Art und Adresse höchstens einmal
pro Minute –, Anmeldeversuche Gesperrter, getrennte Sitzungen, blockierte Uploads, falsche Upload-Passwörter und Sperren im
Upload-Dienst, Admin-Maßnahmen aus dem Prüfprotokoll. Aufbewahrung wie das Sicherheitsprotokoll des Not-Aus (ein Jahr).


| Rolle | bedeutet |
|---|---|
| spieler | spielen (haben alle) |
| entwickler | Upload-Konto und „Meine Spiele“. Rolle geben legt das Upload-Konto an (Passwort einmal angezeigt), Rolle nehmen entfernt es – die Spiele bleiben |
| admin | Admin-Panel. Die Namen in `ADMINS` (compose.yaml) sind Notfall-Admins und bleiben immer Admin |
| tester | für Testkonten (Phase 3) |

Status: **eingeladen** → bei der ersten Anmeldung **aktiv**. **verwarnt** (Meldung mit Grund in der Glocke, Zugang bleibt),
**gesperrt** (sofort kein Zugang zu Bibliothek und Upload, optional bis Datum, mit Grund), **archiviert**
(kein Zugang, Upload-Konto entfernt, aus der normalen Liste – alle Daten bleiben, **„Wiederherstellen“** holt die Person
zurück, als aktiv bzw. eingeladen, Entwickler bekommen ein neues Upload-Passwort). Erst aus „archiviert“ geht
**„Endgültig löschen (anonymisieren)“** → **gelöscht**: Name, Geburtstag, E-Mails, Notizen und Rollen weg, nur der
Benutzername bleibt an Spielständen und Spielen. Nicht rückgängig zu machen (seit 08.11.2026, vorher war Archivieren
gleich Löschen).

Gesperrte stehen weiter in der Cloudflare-Richtlinie, bis am Mac `python3 scripts/cloudflare.py abgleichen --entfernen`
läuft – hinein kommen sie trotzdem nicht, die Bibliothek lehnt sie ab („Konto gesperrt: …“).

## Jemanden einladen

1. Admin-Panel → **Personen** → „Person einladen“: E-Mail, Benutzername (bleibt für immer), Rollen.
2. Am Mac: `python3 scripts/cloudflare.py abgleichen` – trägt die E-Mail in „Kollegen“ (und bei Entwicklern in „Entwickler“) ein.
3. Auf der Seite der Person: **Einladung senden**. Mit eingerichtetem Cloudflare-Abgleich geht das erst, wenn die E-Mail in
   Cloudflare steht; ohne Abgleich fragt das Panel „trotzdem senden?“.
4. Meldet sich die Person an, wird sie „aktiv“.

## E-Mail-Versand einrichten (einmalig, Seb)

In `/volume1/docker/spielebibliothek/.env` auf der NAS (Modus 600) die Daten eines vorhandenen Postfachs eintragen:

```
SMTP_HOST=smtp.beispiel.de
SMTP_PORT=587
SMTP_VERSCHLUESSELUNG=starttls      # oder ssl (Port 465)
SMTP_BENUTZER=postfach@beispiel.de
SMTP_PASSWORT=…                     # am besten ein App-Passwort nur für die Bibliothek
SMTP_ABSENDER=postfach@beispiel.de
```

Danach `docker compose up -d savesvc`. Das Passwort steht nirgends sonst – nicht im Git, nicht im Log, nicht in Fehlermeldungen.

## Sicherheit

- Alle `/api/admin/personen…`-Endpunkte nur für Admins. Notizen, Verwarnungen, Zeitleiste und Protokoll erscheinen in keiner
  anderen Antwort (Test: `tests/test_crm.py`).
- Jede Änderung → `crm_protokoll` (wer, was, wann, vorher/nachher), wird nie gelöscht. Admin-Panel → Personen → „Prüfprotokoll“.
- Niemand kann sich selbst sperren, archivieren, löschen oder die Admin-Rolle nehmen.
- Auskunft (DSGVO Art. 15): auf der Seite der Person „Auskunft (Export)“ – JSON mit allem, was gespeichert ist.
- Erst einmal nur Erwachsene. Bei Minderjährigen bräuchte es die Einwilligung der Eltern (DSGVO Art. 8) – noch nicht gebaut.
