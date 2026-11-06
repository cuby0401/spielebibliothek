# CRM – Personen, Rollen, Einladungen (Zentrale 1.4.0)

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

## Rollen und Status

| Rolle | bedeutet |
|---|---|
| spieler | spielen (haben alle) |
| entwickler | Upload-Konto und „Meine Spiele“. Rolle geben legt das Upload-Konto an (Passwort einmal angezeigt), Rolle nehmen entfernt es – die Spiele bleiben |
| admin | Admin-Panel. Die Namen in `ADMINS` (compose.yaml) sind Notfall-Admins und bleiben immer Admin |
| tester | für Testkonten (Phase 3) |

Status: **eingeladen** → bei der ersten Anmeldung **aktiv**. **verwarnt** (Meldung mit Grund in der Glocke, Zugang bleibt),
**gesperrt** (sofort kein Zugang zu Bibliothek und Upload, optional bis Datum, mit Grund), **archiviert**
(„löschen“: kein Zugang, Name, Geburtstag, E-Mails, Notizen und Rollen werden gelöscht, nur der Benutzername bleibt an
Spielständen und Spielen).

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
- Niemand kann sich selbst sperren, archivieren oder die Admin-Rolle nehmen.
- Auskunft (DSGVO Art. 15): auf der Seite der Person „Auskunft (Export)“ – JSON mit allem, was gespeichert ist.
- Erst einmal nur Erwachsene. Bei Minderjährigen bräuchte es die Einwilligung der Eltern (DSGVO Art. 8) – noch nicht gebaut.
