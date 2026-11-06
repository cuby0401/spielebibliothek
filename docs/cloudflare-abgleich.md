# Cloudflare-Abgleich (Zentrale 1.3.0)

Cloudflare verschickt den E-Mail-Code **nur an Adressen, die in einer Access-Richtlinie stehen** – bei allen anderen zeigt
es trotzdem „Code wurde gesendet“. Steht eine Adresse falsch in „Kollegen“, kommt der Code nie an (so am 06.11.2026 bei Emil).
Der Abgleich sorgt dafür, dass die Richtlinien **„Kollegen“** (alle Benutzer) und **„Entwickler“** (alle mit Upload-Konto)
genau zur Benutzerliste der Bibliothek passen.

## Warum zwei Schlüssel – und warum die NAS nie schreibt

Cloudflare hat für Access-Richtlinien nur **ein** Schreibrecht: *Access: Apps and Policies – Edit*. Ein Schlüssel damit
kann **jede** Anwendung und Richtlinie des Kontos ändern, also den Schutz der ganzen Bibliothek abschalten. Ein engeres
Recht gibt es nicht. Deshalb:

| | Nur-Lese-Schlüssel | Schreib-Schlüssel |
|---|---|---|
| Recht | Access: Apps and Policies – **Read** | Access: Apps and Policies – **Edit** |
| Liegt | NAS, `/volume1/games/data/cloudflare-lesen.token`, nur für den Speicher-Dienst lesbar (Modus 600) | nur im **macOS-Schlüsselbund** |
| Wofür | Admin-Panel zeigt: wer fehlt in Cloudflare, wer ist zu viel | `scripts/cloudflare.py abgleichen` |
| Wenn er in falsche Hände gerät | man sieht die Richtlinien – ändern kann man nichts | gefährlich → Ablaufdatum setzen, sofort widerrufen |

Beides ist **freiwillig**. Ohne Schlüssel zeigt das Admin-Panel „Cloudflare-Abgleich nicht eingerichtet“ und man trägt
E-Mails wie bisher im Dashboard ein.

## Einrichten

### 1. Konto-ID eintragen (nicht geheim)

Cloudflare-Dashboard → rechts auf der Kontoübersicht „Konto-ID“ kopieren (32 Zeichen). Auf der NAS in
`/volume1/docker/spielebibliothek/.env` eine Zeile ergänzen und neu starten (oder beim nächsten Deploy):

```
CF_ACCOUNT_ID=<konto-id>
```

### 2. Nur-Lese-Schlüssel (für das Admin-Panel)

1. Dashboard → **Account verwalten → API-Token des Kontos** → *Token erstellen* → *Benutzerdefiniertes Token*.
2. Name: `spielebibliothek-lesen`. Berechtigung: **Konto · Access: Apps and Policies · Lesen**. Sonst nichts.
3. Kontoressourcen: nur dieses Konto. Optional: IP-Filter, Ablaufdatum.
4. Am Mac: `python3 scripts/cloudflare.py lesetoken` – fragt verdeckt nach dem Schlüssel, probiert ihn aus und legt ihn
   über `docker exec` direkt im Container ab (er steht dabei in keiner Befehlszeile und keiner Datei auf dem Mac).

### 3. Schreib-Schlüssel (nur Mac)

1. Wie oben, Name `spielebibliothek-schreiben`, Berechtigung **Konto · Access: Apps and Policies · Bearbeiten**.
   **Ablaufdatum setzen** (z. B. 1 Jahr). Am sichersten: nur bei Bedarf anlegen und danach wieder löschen.
2. In den Schlüsselbund (fragt verdeckt, nichts landet in der Shell-History):
   ```
   security add-generic-password -s spielebibliothek-cloudflare -a schreiben -w
   ```
3. Entfernen: `security delete-generic-password -s spielebibliothek-cloudflare -a schreiben` und im Dashboard widerrufen.

## Benutzen

```sh
python3 scripts/cloudflare.py pruefen                 # nur anzeigen
python3 scripts/cloudflare.py abgleichen              # fehlende E-Mails eintragen (fragt nach „ja“)
python3 scripts/cloudflare.py abgleichen --entfernen  # auch Ehemalige herausnehmen (Admins nie)
python3 scripts/cloudflare.py wiederherstellen <datei>  # auf eine Sicherung zurück
```

Ablauf beim Schreiben:

1. Soll-Stand per `docker exec … python -m savesvc cloudflare-soll` von der NAS (Benutzerliste + Upload-Konten).
2. Richtlinien **nach Namen** suchen – genau eine pro Name, sonst Abbruch.
3. Abbruch, wenn eine Richtlinie nicht „allow“ ist oder unter „Einschließen“ etwas anderes als E-Mails steht
   (z. B. „Jeder“, ganze Domains, IP-Bereiche). Solche Richtlinien bitte von Hand pflegen.
4. Anzeige aller Änderungen, Bestätigung mit **ja**. Mehr als 3 Entfernungen auf einmal nur mit `--viele`.
   Admins (`ADMINS`, also seb) werden nie entfernt, eine Richtlinie wird nie leer.
5. Sicherung der Richtlinie als JSON unter `~/Library/Application Support/spielebibliothek/cloudflare/` (Modus 600).
6. Schreiben: alle Felder unverändert zurück, nur die E-Mail-Liste neu.
7. **Gegenprobe**: neu lesen – stehen genau die erwarteten E-Mails drin, und ist sonst nichts anders? Wenn nicht: laute
   Meldung mit dem Befehl zum Zurücksetzen.

Wer entfernt wird, bleibt bis zum Ablauf seiner Sitzung angemeldet. Sofort raus: Zero Trust → Zugriffssteuerungen →
Benutzer → Sitzung widerrufen (oder im Admin-Panel „Trennen“).

## Im Admin-Panel

Reiter **Benutzer**: Spalte „Cloudflare“ (✓ / fehlt in Kollegen / fehlt in Entwickler) und darüber eine Liste aller
Abweichungen. Der Stand wird höchstens alle 5 Minuten neu gelesen. Unabhängig davon zeigt die Spalte „Zuletzt aktiv“
**„noch nie angemeldet“**, wenn jemand weder angemeldet war noch gespielt oder hochgeladen hat – der typische Fall, wenn
der Code nicht ankommt.
