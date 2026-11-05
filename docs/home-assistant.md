# Home Assistant: Wächter und Anträge (Zentrale 1.2.0)

Der Speicher-Dienst schickt an einen Home-Assistant-Webhook:

| `art` | wann | was HA tun soll |
|---|---|---|
| `lebenszeichen` | alle 5 Minuten (mit `ok` und `probleme`) | Timer neu starten – läuft er ab, ist die Zentrale weg |
| `problem` | sobald ein neues Problem auftaucht (Upload-Dienst, Caddy, Tunnel/Cloudflare, Speicher, Backup-Kopie) | Push aufs Handy |
| `wieder_ok` | wenn alles wieder läuft | Push aufs Handy |
| `antrag` | bei jedem neuen Antrag | Push aufs Handy |

## 1. In Home Assistant

**Timer anlegen:** Einstellungen → Geräte & Dienste → Helfer → „Timer“:
- Name „Spielebibliothek Lebenszeichen“
- Dauer 00:15:00
- Entität `timer.spielebibliothek_lebenszeichen`

**Zwei Automationen anlegen:** Einstellungen → Automationen → neu → ⋮ → „In YAML bearbeiten“.
- `notify.mobile_app_DEIN_HANDY` ersetzen durch den Namen deines Handys. Den findest du unter Entwicklerwerkzeuge → Aktionen, Suche nach „mobile_app“.
- `spielebibliothek-HIER-ZUFALLSWORT` ersetzen durch ein langes Zufallswort, z. B. aus `openssl rand -hex 16`.

```yaml
alias: Spielebibliothek – Meldungen
mode: queued
triggers:
  - trigger: webhook
    webhook_id: spielebibliothek-HIER-ZUFALLSWORT
    allowed_methods: [POST]
    local_only: true
actions:
  - choose:
      - conditions: "{{ trigger.json.art == 'lebenszeichen' }}"
        sequence:
          - action: timer.start
            target:
              entity_id: timer.spielebibliothek_lebenszeichen
    default:
      - action: notify.mobile_app_DEIN_HANDY
        data:
          title: "{{ 'Neuer Antrag' if trigger.json.art == 'antrag' else 'Spielebibliothek' }}"
          message: "{{ trigger.json.text }}"
```

```yaml
alias: Spielebibliothek – kein Lebenszeichen
triggers:
  - trigger: event
    event_type: timer.finished
    event_data:
      entity_id: timer.spielebibliothek_lebenszeichen
actions:
  - action: notify.mobile_app_DEIN_HANDY
    data:
      title: Spielebibliothek antwortet nicht
      message: Seit 15 Minuten kein Lebenszeichen vom Speicher-Dienst – NAS und Docker prüfen.
```

## 2. Auf der NAS

In `/volume1/docker/spielebibliothek/.env` eintragen (IP bzw. Name von Home Assistant im LAN):

```
HA_WEBHOOK_URL=http://<HA-IP>:8123/api/webhook/spielebibliothek-HIER-ZUFALLSWORT
```

Danach `docker compose up -d savesvc` im Stack-Ordner, oder einfach beim nächsten Deploy.

## Prüfen

- **Nach etwa einer Minute:** Im Admin-Panel → Übersicht → „Wächter“ steht „✓ Alles in Ordnung“ und „Home Assistant bekommt …“. In HA läuft der Timer.
- **Test-Push:** einen Antrag stellen → Push „Neuer Antrag“.
- **Ausfall-Test:** `docker stop spielebibliothek-savesvc` → nach 15 Minuten Push „antwortet nicht“. Danach `docker start spielebibliothek-savesvc`.

`local_only: true` heißt: Der Webhook nimmt nur Anfragen aus dem LAN an. Die NAS ist im LAN, das Internet kommt nicht heran.
