# Änderungsprotokoll der Zentrale (Spielebibliothek)

Versionen der Bibliothek selbst – nicht der Spiele. Schema `MAJOR.MINOR.PATCH` wie bei den Spielen (E39):
**großes Update** (Umbau, Abläufe für Entwickler ändern sich), **kleines Update** (neue Funktionen), **Patch/Hotfix** (Fehler behoben).
Vor jedem Deploy: Nummer in `VERSION` erhöhen und hier einen Abschnitt ergänzen – `scripts/deploy.sh` prüft beides.
Zurück auf eine frühere Version: `scripts/deploy.sh --zurueck <version>`.

## 1.6.2 – 19.11.2026

Bots und Gruppen für Multiplayer, dazu zwei Sicherheitspunkte aus der Prüfung vor dem Live-Gang von 1.6.0 und ein Darstellungsfehler der
Lobby. Nach dem Schema eigentlich ein kleines Update – auf Wunsch des Admins trotzdem 1.6.2, weil Bots für das Testen von Multiplayer-Spielen
unverzichtbar sind. Konzept im Vault: `Projekte/Spielebibliothek/Architektur/Bots-und-Gruppen.md`.

- **Neu: Bots.** In der `game.json` `"multiplayer": {…, "bots": ["leicht", "mittel", "schwer"]}`, in den Regeln
  `bot(sicht, stufe, botId) → aktion oder null`. Der Bot bekommt nur seine Sicht, seine Aktion geht durch `zug()`. Der Host setzt Bots über
  „Bot hinzufügen“ in der Raum-Karte (oder `raum.botHinzufuegen(stufe)`), entfernt sie mit ✕. Bots rechnet der Browser des Hosts mit kurzer
  Denkzeit, auf der NAS läuft nichts. Ein Bot wird nie Host, nach einem Host-Wechsel ziehen die Bots beim neuen Host weiter. Lokal (ohne
  Bibliothek) gehen Bots auch mit einem einzigen Tab – so testen Entwickler allein.
- **Neu: Gruppen.** „Zusammen spielen“ auf der Startseite gründet eine Gruppe mit Beitrittslink `#/gruppe/CODE` (Einladen auch über die Glocke).
  Der Host sucht ein Spiel aus, alle in der Gruppe (und ihre Bots) wechseln automatisch in einen Raum dafür. Einzelspieler-Spiele und Spiele
  mit falscher Spielerzahl stehen ausgegraut mit Grund da. „Zurück zur Gruppe“ in der Raum-Karte, die Gruppe bleibt während des Spiels verbunden.
- **Vier gewinnt** hat Bots in drei Stufen (zufällig, gewinnen/blocken, 5 Züge vorausrechnen).
- **Handbuch:** Abschnitte „Bots“ und „Gruppen“ in Kapitel 9c, KI-Anleitung ergänzt. Neues Icon `bot`.

- **Sicherheit: Gesperrte verlieren den KI-Zugang.** Vor `/mcp` steht kein Cloudflare Access. Bisher behielt eine im CRM gesperrte
  oder archivierte Person ihren Claude-Code-Schlüssel bzw. ihr Claude-App-Token. Jetzt prüft der MCP-Server bei jeder Anfrage und
  beim Erneuern des Tokens, ob die Person noch zugelassen ist (steht im Export `users.yaml`). Wird die Sperre aufgehoben, gilt der
  Zugang wieder.
- **Sicherheit: Nur Rücksprung-Adressen von Claude.** Die Claude-App darf sich nur noch mit `https://claude.ai/api/mcp/auth_callback`
  bzw. `https://claude.com/api/mcp/auth_callback` registrieren, Claude Code mit `http://localhost`/`127.0.0.1`. Fremde Adressen,
  Benutzernamen in der Adresse und andere Ports werden abgelehnt. Registrierungen sind zusätzlich je IP-Adresse begrenzt
  (10 je Stunde), damit einer allein die Grenze nicht für alle ausschöpft.
- **Behoben: Weiße Fläche unter der Lobby.** Die Lobby stand im Spielrahmen (16:10, im dunklen Thema heller Hintergrund). Neu am
  Baustein `UI.buehne`: `.inhalt(an)` – der Rahmen ist dann so hoch wie sein Inhalt und hat keine eigene Fläche.
- **Tests:** 4 neue Tests in `test_mcp.py` (Sperre, Token-Erneuerung, Rücksprung-Adressen, Grenze je IP), 4 in `test_multiplayer.py`
  (Bots setzen/entfernen, Bot wird nie Host, Gruppe wählt Spiel samt Bots, Spielerzahl und Einladen), Bots in `scripts/gamesave-mp-test.js`,
  17 neue Prüfpunkte in `e2e-zentrale-1.6.mjs` (Lobby ohne leeren Rahmen, Gruppe mit Bot bis zum Zug des Bots). Testplan 1.6.2 mit 12 Tests.
  `e2e-zentrale-1.4-crm` prüft nur noch, dass ein Testplan erscheint (nicht mindestens 5 Tests).

## 1.6.1 – 17.11.2026

Kleines Update für Multiplayer nach den Antworten des ersten Multiplayer-Entwicklers (Zugzeiten, Bedenkzeit, Siegzähler im Raum).
Auf Wunsch des Admins ohne Handtests live, automatische Tests grün.

- **Neu: Zeitgeber** in `GameSave.multiplayer.spiel`: `frist(zustand) → {bis, aktion}`. Bei Ablauf führt der Host
  `zug(zustand, aktion, null)` aus (`von === null` = die Uhr). Den Zeitpunkt legt das Spiel im Zustand ab, deshalb läuft die Uhr nach
  einem Host-Wechsel weiter. Dieselbe Frist löst nur einmal aus.
- **Neu: Siegzähler über mehrere Runden:** `neu(spieler, optionen, vorher)` bekommt den bisherigen Zustand.
- **Korrigiert:** Ein sofortiges `spiel.neu()` direkt nach `await GameSave.multiplayer.spiel(…)` konnte vom übernommenen leeren
  Raumstand überschrieben werden. `spiel()` meldet sich jetzt erst fertig, wenn der Stand übernommen ist.
- **Vier gewinnt:** 30 Sekunden Zugzeit (danach ist der andere dran) und Siegzähler.
- **Handbuch:** Abschnitt „Zeitgeber“, Siegzähler, Hinweis, dass der Host den ganzen Zustand kennt. KI-Anleitung ergänzt.
- **Doku:** LAN-Adresse der NAS durch einen Platzhalter ersetzt (Repo ist öffentlich).
- **Tests:** `scripts/gamesave-mp-test.js` (zwei nachgestellte Tabs: Zeitgeber, Host-Wechsel, Siegzähler), läuft in `deploy.sh` mit.

## 1.6.0 – 17.11.2026

Kleines Update mit zwei großen Neuerungen für Entwickler: Multiplayer und der MCP-Server für Claude (E88). Anlass: Die Spiele eines Entwicklers
sind alle Multiplayer. Kommt vor den Tickets (die werden 1.7.0). Plan im Vault: `Projekte/Spielebibliothek/Architektur/Multiplayer-und-MCP.md`.

- **Neu: Multiplayer.** Spiele mit `"multiplayer": {"min": 2, "max": 4}` in der `game.json` starten mit einer Lobby: Raum erstellen,
  mit Raumcode beitreten, offene Räume. Neben dem Spiel steht die Raum-Karte: Code, Einladungslink, Mitspieler über die Glocke
  einladen, Spielerliste mit Host und Zuschauern, Host weitergeben, Rauswerfen, Raum verlassen. Neu laden führt in denselben Raum,
  eine kurz verlorene Verbindung wird von selbst wiederhergestellt.
- **Neu: `GameSave.multiplayer`.** Die Regeln laufen im Browser des Hosts (Weg A, Seb 17.11.): `spiel({neu, zug, sicht}, {zeigen, fehler})`
  prüft die Züge beim Host, legt den Stand im Raum ab und schickt jedem Spieler nur seine Sicht. Geht der Host, übernimmt ein anderer
  mit genau diesem Stand. Darunter `raum()` mit `senden`, `beiNachricht`, `standSichern`, `beiHostwerden`. Lokal spielen zwei Tabs
  gegeneinander, im Entwurf darf man gegen sich selbst spielen. Auf der NAS läuft kein Code der Entwickler.
- **Neu: Beispielspiel „Vier gewinnt“** (`examples/vier-gewinnt`) und die Multiplayer-Vorlage im Handbuch.
- **Neu: MCP-Server für Claude** unter `mcp.cuby0401.uk`: Claude liest das Handbuch, holt die Vorlage, sieht die eigenen Spiele und
  ihre Dateien, lädt Entwürfe hoch und liest Prüfung und Fehlerberichte. Veröffentlichen bleibt beim Entwickler. Anmeldung für
  Claude Code mit Schlüssel (Upload-Seite → „KI-Zugang (Claude)“, widerrufbar), für die Claude-App über OAuth mit Freigabe-Seite
  (Access + Upload-Passwort). Andere KIs bekommen einen Hinweis.
- **Neu im Handbuch:** Kapitel 9c „Multiplayer“ und 9d „Claude direkt verbinden (MCP)“, Prompt-Block mit Multiplayer-Regeln.
- **Einrichtung (Seb):** Tunnel-Route `mcp.cuby0401.uk` → `http://caddy:8080` ohne Access-Anwendung, für den Testserver
  `test-mcp.cuby0401.uk` → `http://<NAS_LAN>:18188`. Siehe `docs/betrieb.md`.
- **Testserver:** Speicher-Dienst und Caddy bekommen dort die Gruppe des Upload-Dienstes, sonst waren neu hochgeladene Entwürfe nicht
  lesbar (live regeln das die ACLs).
- **Tests:** `test_multiplayer.py` (11), `test_mcp.py` (6), Ende-zu-Ende `scripts/e2e-zentrale-1.6.mjs` (zwei Tabs spielen Vier gewinnt,
  Host-Wechsel, Rauswerfen, MCP-Schlüssel, Freigabe der Claude-App).

## 1.5.0 – 13.11.2026

Kleines Update mit großem Umbau im Hintergrund: Identität mit drei Schichten und das komplette CRM (E80–E82). Die Tickets folgen in 1.6.0.
Plan im Vault: `Projekte/Spielebibliothek/Architektur/Identitaet-und-CRM-1.5.0.md`.

- **Neu: neues Design** (E85–E87, seit 13.11. in 1.5.0 statt später als 2.0.0): Alle Seiten (Bibliothek, Konto, Admin-Panel, Upload, Tester-Panel, Hilfe, Handbuch) sind aus denselben Bausteinen gebaut, Richtung „Klar“ mit Akzent Blau. Startseite in Reihen (Weiterspielen, Favoriten, Neu, Spiel der Woche, Alle Spiele) mit Suche und Kategorien, eigene Dialoge statt Browser-Fenster, eine Art Meldung, Icons statt Emojis. Neu unter Einstellungen → Aussehen: Thema (automatisch, hell, dunkel), sechs Farben, Abstände und Kachelgröße, gespeichert pro Konto auf allen Geräten, ohne weißes Aufblitzen beim Laden. Unter Einstellungen → Startseite: Reihenfolge und Sichtbarkeit der Bereiche. Wächter `ui-pruefen.mjs` und `kontrast-pruefen.mjs` laufen bei jedem Deploy, Ende-zu-Ende `e2e-bausteine.mjs`.
- **Geändert (Seb, 13.11.):** Im Profil stehen Spielzeit, gespielte und eigene Spiele und Erfolge jetzt klein mit in der Profilkarte statt in eigenen Kacheln darunter (spart Platz, die Spielzeit bricht nicht mehr um). Dafür neu: `UI.kennzahl({kompakt: true})`.
- **Geändert (Sebs Test, 13.11.):** „Alle Spiele“ steht nicht mehr unter Einstellungen → Startseite (man konnte es abhaken, es wirkte aber nicht). Es steht immer ganz unten auf der Startseite, auch wenn ältere Einstellungen es verschoben oder ausgeblendet hatten.

- **Neu: Identität mit UUID, Handle und Anzeigename** (E81). Jede Person hat eine zufällige, unveränderliche ID, auf die alles verweist (Spielstände, Bestenlisten, Erfolge, Anfragen, CRM, Protokolle). Nach außen erscheint sie nie: Überall steht das Handle (`@paul`) bzw. der Anzeigename. Dazu eine Personennummer `P-0007` für den Admin-Bereich.
- **Umstellung beim ersten Start**, einmalig und in einer Transaktion: vorher Sicherung (`data/backup/vor-uuid-<Tag>.db`), danach Prüfung von Zeilenzahl und Prüfsumme jeder Tabelle. Scheitert etwas, bleibt die Datenbank unverändert und der Dienst startet nicht. `deploy.sh --zurueck` auf eine Version vor 1.5.0 stellt vorher automatisch zurück. Probelauf auf einer Kopie der Live-Daten (09.11.): 6 Personen, 1.009 Zeilen, Prüfsummen gleich, Rückweg identisch.
- **Neu: Handle ändern** (E82) unter Profil → „Handle“, alle 30 Tage (ab der letzten Änderung; wer noch nie geändert hat, sofort). Frühere Handles bleiben für die Person reserviert und alte Profil-Links leiten weiter. Spielstände, Spiele, Erfolge und Plätze bleiben. Der Admin ändert ohne Frist. Spieleordner und Spiel-IDs behalten den ersten Namen.
- **Neu: CRM** im Admin-Panel (Reiter „CRM“ statt „Personen“, nach dem Klick-Muster): Suche nach Nummer, Name, Handle (auch früheren) oder E-Mail, Enter öffnet bei einem Treffer die Karte. Kacheln und Filter nach Rolle, Status und „seit 30 Tagen nicht da“. Die **Personenkarte** zeigt alles auf einen Blick, leere Blöcke fehlen: Stammdaten, Notizen, E-Mails, Rollen, Maßnahmen, eigene und gespielte Spiele, Anfragen in beide Richtungen, Anmeldungen, Sicherheitsprotokoll, Zeitleiste.
- **Neu: volles Sicherheitsprotokoll je Person**: abgelehnte Zugriffe und Rate-Limits (je Person, Art und Adresse höchstens einmal pro Minute), Anmeldeversuche Gesperrter, getrennte Sitzungen, blockierte Uploads, falsche Upload-Passwörter und Sperren, Admin-Maßnahmen.
- **Neu:** Endgültig gelöschte Personen erscheinen überall als „gelöschte Person“ (vorher stand der Benutzername weiter in Bestenlisten), auch im Admin-Bereich: Liste, Personenkarte, Prüfprotokoll und Auskunft zeigen weder Handle noch frühere Handles noch Spieleordner. Erreichbar nur noch über die Nummer, das Handle bleibt für niemanden frei (Seb, 10.11.).
- **Neu:** Die Upload-Seite zeigt oben das aktuelle Handle (beim Drüberfahren den Spieleordner) statt des ersten Namens.
- **Geändert (Sebs Test, 10.11.):** Alle Seiten nutzen die volle Fensterbreite (Bibliothek, Konto, Admin-Panel, Tester-Panel, Upload). Nur Hilfe und Handbuch bleiben zum Lesen schmal (einzelne Anfragen seit 13.11. ebenfalls breit). Die Personenkarte im CRM legt ihre Blöcke als Mauerwerk: jeder Block in die gerade kürzeste Spalte, keine Lücken mehr unter kurzen Blöcken, die Spaltenzahl richtet sich nach der Fensterbreite. Stammdaten kompakt nebeneinander, Eingabefelder füllen ihren Block. Ein leeres Geburtsdatum zeigt in Safari nicht mehr grau das heutige Datum.
- **Geändert (Sebs Test, 10.11.):** CRM-Suche klein oben rechts neben der Überschrift, ohne Autofokus (vorher sprang der Cursor hinein und Safari bot sofort E-Mail-Adressen an).
- **Behoben:** Testserver: Skripte und Stile bekamen bei jedem Bau dieselbe Adresse (`?v=__VERSION__`). Safari mischte dadurch alte und neue Dateien („Can't find variable: anzeige“, alte Breite). Jetzt eigene Kennung je Bau wie live.
- **Geändert (Sebs Test, 10.11.):** Fehler der Bibliothek stehen in der Admin-Übersicht nur noch als rote Zeile („1 Fehler in der Bibliothek · zuletzt … · Ansehen →“). Die Liste mit Fundort, Stacktrace und „Erledigt“ öffnet sich in einem eigenen Fenster. Vorher stand die Tabelle mitten in der Übersicht und klebte ohne Abstand an den Kacheln.
- **Neu:** Bei Anfragen und in der Bestenliste (beim Drüberfahren) steht das Handle neben dem Anzeigenamen – Anzeigenamen sind nicht eindeutig.
- **Geändert:** Der Zwischenspeicher im Browser (noch nicht übertragene Spielstände) gehört zum Konto statt zum Namen und übersteht Handle-Änderungen. Vorhandene Zwischenspeicher bleiben gültig.
- **Geändert:** Der Testserver startet nach einem NAS-Neustart von selbst wieder (`--restart unless-stopped`; am 09.11. blieb er nach dem NAS-Update aus).
- **Behoben:** Bestenliste: Bei Gleichstand in derselben Sekunde entschied der Name statt der Reihenfolge.
- **Behoben:** Admin-Panel → Letzte Anmeldungen: Die Spalte „Spieler“ war seit 1.4.1 leer.
- **Behoben:** `scripts/e2e-alle.sh` zeigte bei einem Absturz ohne Prüfpunkt nichts an.
- **Behoben:** CRM: Die Kachel „aktiv in 30 Tagen“ zeigte alle Personen, auch nie angemeldete. Jetzt filtert sie, dazu gibt es den Filter „aktiv in 30 Tagen“ bei den Status-Filtern.
- **Behoben:** Ein alter Link mit früherem Handle (`#/profil/<altes Handle>`) öffnete das eigene Profil schmal und ohne Konto-Leiste. Jetzt leitet er auf die aktuelle Adresse um.
- **Tests:** `test_identitaet.py` (Umstellung, Rückweg, Fehler mittendrin, keine UUID in irgendeiner Antwort – Gegenprobe ohne Übersetzung rot), `test_handle.py`, `test_zugriff.py` (fremde IDs an jedem Admin-Endpunkt, Gegenprobe rot), Bridge-Test für den Zwischenspeicher, Ende-zu-Ende `scripts/e2e-zentrale-1.5.mjs`. Die ganze Sammlung läuft mit UUIDs im Hintergrund, mit `TEST_IDENTITAET_UUID=0` wie in 1.4.1.

## 1.4.1 – 09.11.2026

Kleines Update nach dem ersten Testdurchgang mit dem Tester-Panel: Tester-Panel aufräumen, „Dabei seit“ korrigieren, schnellere Ende-zu-Ende-Tests, NAS entlasten.

- **Behoben:** „Dabei seit“ im Profil und im CRM zeigte bei allen übernommenen Personen den Zeitpunkt der Übernahme (erster Start von 1.4.0). Jetzt steht dort die früheste bekannte Aktivität (Anmeldung, Spielstand, Rangliste, Erfolg, Anfrage, Daumen), die erste Anmeldung ebenso. Wird beim ersten Start von 1.4.1 einmal nachgeholt, nur für übernommene Personen (danach sind sie Seb zugeschrieben).
- **Neu:** Tester-Panel mit drei Reitern (Sebs Notiz vom 08.11.): „Offen“ ist die Startseite und zeigt nur, was noch zu testen ist, Nachtests eingeschlossen. Eingetragene Tests wandern nach „Abgelehnt“ bzw. „Bestanden“ (Archiv, eingeklappt). Dort steht der ganze Verlauf: wer wann geprüft hat, mit Begründung und Fotos, auch ältere Einträge vor einem Nachtest. Neu eintragen geht dort weiterhin.
- **Neu:** Fotos an Testergebnissen: bis zu 5 Bilder je Eintrag (Datei wählen oder Screenshot mit Strg/⌘+V), im Browser verkleinert, in der Ergebnis-Datenbank außerhalb der Probe-Daten. Sehen darf sie, wer den Test sieht, anfügen nur, wer eingetragen hat.
- **Geändert (NAS entlasten):** Ende-zu-Ende-Tests laufen auf dem Mac, wenn Docker Desktop läuft. Teststand und Chrome stehen dann auf dem Mac, die NAS rechnet nichts. Ohne Docker Desktop wie bisher auf der NAS. Erzwingen mit `E2E_ORT=mac|nas`.
- **Neu (nach dem ersten Nachtest, 09.11.):** Aufträge auf dem Mac (`scripts/auftraege-mac.py`, per launchd alle 20 s, einrichten mit `scripts/auftraege-mac-einrichten.sh`). Läuft Docker Desktop, meldet der Mac „bereit“ und übernimmt Unit- und Ende-zu-Ende-Tests aus dem Admin-Panel der Live-Bibliothek UND des Testservers (dort blieb „Jetzt starten“ vorher ewig auf „wartet“, weil niemand ausführte). Unit-Tests ca. 15 s statt 8 Min., Ende-zu-Ende ca. 3 statt 10 Min. Der Auftragsdienst der NAS lässt diese Aufträge liegen, solange der Mac sich meldet. `deploy.sh --probe` legt den Ende-zu-Ende-Auftrag im Testserver an, wenn der Mac bereit ist, sonst wie bisher in der Live-Bibliothek. `scripts/e2e-mac-hintergrund.sh` entfällt.
- **Neu:** Anzeigename in der Bibliothek: oben rechts, an den Spielen („von …“), in Bestenlisten, beim Spiel der Woche und in Anfragen steht der Anzeigename, wenn einer gesetzt ist. Admin-Panel und Protokolle bleiben beim Benutzernamen.
- **Neu:** CRM: „Angelegt am“ kann der Admin in den Stammdaten korrigieren (für Personen ohne jede Aktivität kennt die Bibliothek nur den Tag der Umstellung). Übernommene Personen stehen als „angelegt von seb“ statt „von übernahme“. Die erste Anmeldung ist nie später als die erste Aktivität.
- **Behoben:** Profil: „dabei seit“ mit vollem Datum statt nur Monat. „Spiele“ heißt jetzt „gespielt“ (gespielte Spiele, egal von wem), eigene Spiele zählen extra, die Tabelle zeigt, von wem ein Spiel ist.
- **Behoben:** Tester-Panel: Hatte der Admin noch Admin-Tests offen, aber für alle Tester war nichts mehr offen, stand unten „null“. Ging beim Eintragen mit Fotos ein Foto schief, entstand beim erneuten Klick derselbe Eintrag mehrfach. Jetzt werden nur die fehlenden Fotos nachgeladen.
- **Behoben:** Admin-Panel → Aufgaben sprang beim Selbst-Aktualisieren (alle 15 s, solange etwas läuft) nach oben und klappte offene Logs zu. Dazu stapelten sich die Zeitgeber bei jedem Klick. Jetzt bleibt die Stelle, und solange ein Log offen ist, wird nicht neu geladen.
- **Geändert (schnellere Tests):** Die Ende-zu-Ende-Tests warten nach jedem Seitenwechsel nicht mehr fest 2,5–6,5 s, sondern bis die Seite geladen ist und sich nichts mehr ändert. Die volle Runde braucht auf dem Mac etwa 2:35 Min. (vorher etwa 10 Min. auf der NAS bzw. 5:40 auf dem Mac).
- **Behoben:** Testserver: Die Kopie der Live-Daten brachte den Aufgaben-Verlauf der Live-Bibliothek samt roter Glocken mit, es sah ständig so aus, als brächen die Ende-zu-Ende-Tests ab. Einmal je frischer Kopie wird dieser Verlauf jetzt geleert.
- **Behoben:** Personen-Liste: „Zuletzt aktiv“ zählte auch Upload-Ereignisse, die der Admin auslöst (Upload-Konto angelegt, neues Passwort, gelöscht). Wer sich nie angemeldet hatte, stand dann mit Datum statt „noch nie angemeldet“ da.
- **Behoben (zweiter Nachtest 09.11.):** Admin-Panel: „null“ in der Personen-Liste und unter dem Namen einer Person. Aufgaben-Reiter flackerte beim Selbst-Aktualisieren, jetzt wird nur die Tabelle „Letzte Läufe“ erneuert und nur bei Änderungen, mit Fortschritt des laufenden Ende-zu-Ende-Laufs („Test 3/8“). Aufträge auf dem Mac liefen als gedrosselter Hintergrundprozess (bis 40 statt 3 Minuten), jetzt als normaler Prozess (Einrichtung neu ausführen). „Ende-zu-Ende / Live-Stand“ im Testserver blieb auf „wartet“, jetzt übernimmt der Mac auch ältere Stände (Teststand dann auf der NAS). Zwei Ende-zu-Ende-Runden auf dem Mac warten aufeinander.
- **Behoben (Durchsicht 09.11.):** Mac-Dienst: Er nimmt nur noch einen Auftrag nach dem anderen an (vorher alle auf einmal; brach er ab, blieben die übrigen ewig auf „läuft“). Kommt ein Ergebnis wegen einer Verbindungsstörung nicht an, wird es beim nächsten Lauf nachgemeldet statt verworfen. Während eines Laufs meldet er sich alle 20 s als „beschäftigt“ (vorher galt er nach 90 s als weg, und die NAS übernahm neue Aufträge doch selbst). Im Testserver werden hängengebliebene Läufe nach 2 Stunden abgeschlossen. Betrifft nur das Skript auf dem Mac, nicht den Testserver.
- **Testplan:** `tests/manuell/1.4.1.json`, 20 Tests (12 nur für Seb). Nach den Nachtests (09.11.): 5 Tests neu zu testen, 11 neue.

## 1.4.0 – 06.11.2026

**Großer Umbau der Benutzerverwaltung: CRM** (E67/E68). Anleitung: `docs/crm.md`.

- **Neu:** Reiter „Personen“ im Admin-Panel statt „Benutzer“. Personen haben Stammdaten (Anzeigename, Vor- und Nachname, Geburtstag, alles freiwillig), mehrere Login-E-Mails, Rollen (Spieler, Entwickler, Admin, Tester) und einen Status (eingeladen, aktiv, verwarnt, gesperrt, archiviert). Liste mit Suche und Filtern, eigene Seite je Person mit Zeitleiste (Anmeldungen, Anträge, Uploads, Maßnahmen), Notizen nur für Admins und Anmeldungen.
- **Neu:** Verwarnen (die Person bekommt den Grund rot in die Glocke), Sperren (sofort, für Bibliothek und Upload, optional bis Datum, die Person sieht den Grund), Entsperren, Archivieren (persönliche Angaben werden gelöscht, nur der Benutzername bleibt an Spielständen und Spielen), Auskunft als Export.
- **Neu:** Einladen nur mit Einladung. Nach dem Cloudflare-Abgleich am Mac verschickt das Panel die Einladungsmail über ein vorhandenes Postfach (SMTP, in der `.env`). Bei der ersten Anmeldung wird die Person „aktiv“.
- **Neu:** Prüfprotokoll: Jede Änderung an Personen mit wer, was, wann, vorher und nachher.
- **Neu:** „Meine Angaben“ im eigenen Profil: Anzeigename, Name und Geburtstag selbst pflegen, Datenschutzhinweis bestätigen. Neuer Hilfe-Abschnitt „Deine Daten“.
- **Geändert:** Rollen werden im CRM ausdrücklich vergeben. Die Entwickler-Rolle legt das Upload-Konto an bzw. entfernt es. `ADMINS` bleibt als Notfall-Admin.
- **Geändert:** `config/users.yaml` ist nur noch ein Export aus dem CRM (für den Upload-Dienst und als Rückweg). Beim ersten Start werden alle Einträge übernommen, die Datei vorher gesichert (`data/backup/users-vor-crm-…`).
- **Behoben:** Der Auftragsdienst spielte nach dem direkten Deploy von 1.3.1 die alte Freigabe 1.3.0 wieder live ein. Er spielt jetzt nie eine ältere oder gleich alte Version ein, zurück geht nur von Hand (`deploy.sh --zurueck`).
- **Behoben:** Nach dem Zurückspringen auf 1.3.0 und wieder auf 1.3.1 tat „Spielen“ bei einem Tester nichts. Die wieder eingespielten Dateien trugen ihr altes Datum, das älter war als das der zuvor ausgelieferten. Der Browser bekam deshalb „unverändert“ (304) und behielt die `index.html` von 1.3.0, die nicht zum neuen `app.js` passte. Beim Einspielen und beim Zurückspringen bekommen die Dateien jetzt die aktuelle Uhrzeit (`tar -m` in `scripts/nas-deploy.sh` und `deploy.sh --zurueck`).
- **Neu: Konto-Bereich** (wie auf professionellen Webseiten): Ein Klick auf den eigenen Namen (mit Initialen-Bild) öffnet direkt das Profil, das Aufklappmenü fällt weg. Links (auf dem Handy oben) die Leiste: Profil, Meine Spiele (Entwickler), Meine Spielstände, Anfragen, Einstellungen, Sicherheit, darunter Admin-Panel (Admins) und Abmelden. Das Profil hat einen Kopf mit Bild, Anzeigename, Rollen und „dabei seit“; Spielzeit, Spiele und Erfolge stehen klein in der Ecke. Spielstände und Anmeldungen sind eigene Seiten („Sicherheit“). Admins haben oben zusätzlich „Admin“. Auf dem Handy bleibt das Konto immer erreichbar.
- **Geändert:** „Anträge“ heißen jetzt überall „Anfragen“ (Vorstufe zu den Tickets, E71).
- **Neu: Not-Aus** (E72): Admin-Panel → Übersicht → „Not-Aus“ sperrt sofort alle Daten (Speicher- und Upload-Dienst antworten 503) und stoppt innerhalb einer Minute den Tunnel. Aufheben nur am Mac (`scripts/deploy.sh --notaus-aus`), auslösen auch dort (`--notaus`). Solange er an ist, wird nichts eingespielt. Ein- und Ausschalten stehen im neuen Sicherheitsprotokoll (ein Jahr). Anleitung: `docs/betrieb.md`.
- **Neu: Tester-Panel und Testserver** (E76): Die Probe ist jetzt zugleich der Testserver unter `https://test.cuby0401.uk` (`test-play`, `test-upload`), geschützt durch die Access-Anwendung „Spielebibliothek Test“ und mit echter Anmeldung – nicht mehr über Tailscale und nicht mehr automatisch als `seb`. Unter `/tester/` stehen die Tests der Version mit genauen Schritten; Tester tragen „Hat geklappt“ oder „Hat nicht geklappt“ mit Begründung ein. Den Testplan schreibt Claude ins Repo (`tests/manuell/<Version>.json`), die Ergebnisse überstehen Neubauten der Probe (`/volume1/docker/spielebibliothek-tests`). Im Admin-Panel der Probe stehen sie bei „Für Live freigeben“, offene oder fehlgeschlagene Tests lösen eine Warnung aus. Live: Konto-Leiste „Tester-Panel ↗“ für die Rolle Tester, nach jedem Probe-Bau eine Glocke für die Tester.
- **Neu:** Fehler der Bibliothek selbst werden gemeldet, nicht mehr nur Fehler in Spielen. Der Spieler sieht „Da ist leider etwas schiefgelaufen … nenne die Fehler-Nr. …“, Admins bekommen eine rote Glocke. Die Fehler stehen ganz oben in der Admin-Übersicht, mit Datei, Zeile, Seite, Version und Stacktrace (`lib/bridge.js`, `POST /api/fehler-zentrale`).
- **Neu:** Passt eine Seite im Browser nicht zur Version, die live läuft, holt sie sich einmal frisch und lädt neu, höchstens einmal je Live-Stand. Das fängt auch andere Cache-Probleme ab als das vom 07.11.
- **Behoben:** In der Probe erschienen unter „Anmeldungen“ mehrere Geräte mit derselben IP, obwohl es keine Anmeldung gab. Die Probe hat keine Cloudflare-Anmeldung, gespeichert wurde die interne Docker-Adresse. Solche Einträge heißen jetzt „Probe/Teststand – keine echte Anmeldung“ und zeigen keine IP.
- **Nachbesserung nach dem Test auf dem Testserver (08.11.2026):**
  - **Behoben:** Handy: Kopfzeile und Initialen-Kreis ragten über den rechten Rand, die ganze Seite wurde dadurch breiter und verkleinert. Die Knöpfe rutschen jetzt bei Bedarf in eine zweite Zeile, lange IP-Adressen brechen um.
  - **Behoben:** Wurde die Rolle Entwickler entzogen, blieb der Haken stehen und ließ sich nicht neu vergeben. Grund: Der Spieleordner (die Spiele bleiben) zählte weiter als Entwickler. Mit CRM zählt jetzt nur noch die Rolle. Wer beim Umstieg schon einen Ordner hat, bekommt sie bei der Übernahme.
  - **Behoben:** Meldungen im Admin-Panel (z. B. „E-Mail-Versand ist nicht eingerichtet“ bei „Einladung senden“) kamen oben außer Sicht an. Sie kleben jetzt oben im Fenster, Erfolge verschwinden nach 8 s.
  - **Geändert:** Not-Aus: Auch Hilfe, Handbuch, Startseite und Spieldateien sind sofort weg. Caddy liefert nur noch eine Seite „Not-Aus aktiv“ (Caddy darf dafür `config/` durchqueren, aber nichts lesen).
  - **Geändert:** Archivieren ist jetzt rückgängig zu machen (Sebs Nachtest): Die Person verschwindet aus der Liste und kommt nicht mehr hinein, alle Daten bleiben, „Wiederherstellen“ holt sie zurück (Entwickler mit neuem Upload-Passwort). „Endgültig löschen (anonymisieren)“ ist ein eigener Schritt, nur aus „archiviert“, neuer Status „gelöscht“. Dabei werden jetzt auch die Inhalte in Zeitleiste und Prüfprotokoll geleert, vorher stand dort noch die E-Mail.
  - **Behoben:** Entsperren und „Verwarnung aufheben“ setzten auch Personen, die sich nie angemeldet haben, auf „aktiv“ statt „eingeladen“.
  - **Testplan:** ein Test pro neuer Funktion, mit genauen Schritten (33 statt 15), nur Neues aus 1.4.0.
  - **Geändert:** Alle Meldungen (Bibliothek, Konto, Admin-, Tester- und Upload-Seite) erscheinen als Pop-up oben in der Mitte des Fensters, egal wo man gerade ist. Erfolge verschwinden nach 8 s, Fehler bleiben rot bis zum Klick (Sebs zweiter Nachtest: Meldungen standen oben auf der Seite und fielen nicht auf, z. B. die Ablehnung eines Geburtstags in der Zukunft).
  - **Geändert:** Der Kalender beim Geburtstag lässt keine Tage nach heute mehr zu (der Server lehnte sie schon vorher ab).
  - **Geändert:** Tester-Panel: Tests mit `"nurAdmin": true` (CRM, Upload, Not-Aus) sieht nur der Admin, und zwar ganz oben unter „Nur für dich als Admin“. Andere Tester sehen sie nicht, zählen sie nicht mit und können dafür nichts eintragen. Vorher sahen andere Tester auch die 17 „Nur Seb“-Tests.
  - **Neu:** `TESTER` (compose): Wer bei der Übernahme ins CRM die Rolle Tester bekommt.
  - **Neu:** Tester-Panel: Ergebnisse gelten für die ganze Version, auch über neue Commits hinweg. Geänderte Tests bekommen im Testplan `neuAb` und stehen danach wieder auf offen, mit dem Hinweis „Bitte neu testen“.
- **Tests:** `tests/test_crm.py` (Übernahme mit gleichen Rechten, Sichtbarkeit der Admin-Felder, Sperre mit Ablauf, Protokoll, Mail ohne Zugangsdaten in Fehlern), `test_fehler_der_bibliothek`, `test_notaus*`, `test_auftragsdienst_notaus.py`, `test_tester.py`, Ende-zu-Ende `scripts/e2e-zentrale-1.4-crm.mjs`.

## 1.3.1 – 06.11.2026

Bugfix-Update (Seb, 06.11.2026): Anträge leichter finden und öffnen, Bilder an Anträgen, Fehler eines Testers beim Entwurf-Testen.

- **Behoben (Antrag #3):** Nach „Testen“ auf der Upload-Seite führte der Zurück-Knopf in die Spieleübersicht, und man musste „Spiel hochladen“ neu öffnen. Jetzt öffnet „Testen“ den Entwurf im selben Tab. „← Zurück zum Hochladen“ und der Link im gelben Entwurf-Hinweis führen direkt zum Spiel auf der Upload-Seite (dort hervorgehoben), wo man veröffentlicht.
- **Neu:** Jeder Antrag hat eine eigene Seite (`#/antrag/<Nummer>`) mit Text, Bildern, Status und Antwortfeld. Ein Klick auf die Meldung in der Glocke öffnet sie direkt, ebenso „Öffnen“ in „Anträge“, „Meine Spiele“ und im Admin-Panel. Sehen dürfen nur Antragsteller, zuständiger Entwickler und Admin.
- **Neu:** Bilder an Anträgen (bis zu 5, PNG/JPG/WebP): beim Stellen „Bild anfügen“ oder Screenshot mit Strg/⌘+V einfügen, später auch in der Antragsseite. Die Seite verkleinert große Fotos vorher (max. 1600 px). Der Server prüft die Bildart an den Bytes und erlaubt kein SVG. Die Bilder liegen in der Datenbank und werden mitgesichert.
- **Geändert:** Anträge zu den eigenen Spielen sind leichter zu finden. Unter „Anträge“ stehen sie oben („An dich“), unter „Meine Spiele“ gibt es oben einen Hinweis auf offene Anträge und in der Tabelle die Spalte „Anträge“.
- **Hinweis:** Meldungen in der Glocke von vor 1.3.1 führen weiter auf die alten Seiten.

## 1.3.0 – 06.11.2026

- **Neu:** Cloudflare-Abgleich. Das Admin-Panel (Reiter Benutzer) zeigt, wer in den Richtlinien „Kollegen“/„Entwickler“ fehlt oder zu viel ist. Der Server bekommt dafür höchstens einen Nur-Lese-Schlüssel. Geschrieben wird nur vom Mac mit `scripts/cloudflare.py abgleichen`: Schlüssel im Schlüsselbund, Anzeige und Bestätigung, Sicherung vorher, Gegenprobe danach. Siehe `docs/cloudflare-abgleich.md`.
- **Neu:** „noch nie angemeldet“ in der Benutzerliste, wenn jemand weder angemeldet war noch gespielt oder hochgeladen hat. Der typische Fall, wenn der E-Mail-Code nicht ankommt.
- **Geändert:** Der Wächter schreibt jetzt bei jedem Lauf in die Datenbank und in die Upload-Datenbank (`/intern/gesund`) und prüft, ob der Spieleordner beschreibbar ist. Ein Schreibschutz wie am 06.11.2026 (Fehler 500) wird so nach spätestens 5 Minuten gemeldet.
- **Neu:** Auftragsdienst auf der NAS (`scripts/auftragsdienst.py`, Cron-Job jede Minute, einrichten mit `sh scripts/auftragsdienst-einrichten.sh`). Er führt nur fest eingebaute Aufgaben aus, kein Container bekommt Zugriff auf Docker.
- **Neu:** „Für Live freigeben“ in der Probe spielt die Version automatisch live ein, innerhalb einer Minute. `deploy.sh --probe` legt dafür den unveränderten Stand (`release.tar`) in der Probe ab. Das Einspielen übernimmt `scripts/nas-deploy.sh`, das jetzt auch `deploy.sh` nutzt. `deploy.sh` holt den Git-Tag nach.
- **Neu:** Reiter „Aufgaben“ im Admin-Panel: Unit- und Ende-zu-Ende-Tests für Live-Stand oder Probe per Knopf oder täglich zu einer Uhrzeit, mit Verlauf und Log. Bei Fehlern gibt es eine rote Glocke und eine Meldung an Home Assistant. Die Ende-zu-Ende-Tests laufen dafür auf der NAS mit Chrome im Container (`scripts/e2e-nas.sh`). Der Wächter meldet, wenn der Auftragsdienst stehen bleibt.
- **Geändert:** Anträge zu einem Spiel (Fehler, Wunsch, Sonstiges) gehen an dessen Entwickler, nicht mehr an den Admin. Er sieht sie unter „Meine Spiele“ pro Spiel (offen und geschlossen) und beantwortet sie dort. Im Admin-Panel stehen sie nur noch eingeklappt zur Info, ohne Glocke und ohne Zahl.
- **Geändert:** „Ansicht als …“ beenden führt zurück an die Stelle im Admin-Panel, an der die Ansicht gestartet wurde.
- **Tests:** neuer Ende-zu-Ende-Test `scripts/e2e-zentrale-1.3-steckbrief.mjs` (Beschreibung und Vorschaubild, „noch nie angemeldet“, Cloudflare-Hinweis). `E2E_TESTS="…" sh scripts/e2e-alle.sh` führt einzelne Tests aus.

## 1.2.1 – 06.11.2026

Als Bugfix-Update ohne Probe eingespielt (Seb, 06.11.2026). Enthält neben den Fixes auch die neuen Funktionen, die zuerst als 1.3.0 geplant waren.

- **Geändert:** „Mein Profil“ ist die zentrale Seite mit Spielen, Spielständen und Anmeldungen. „Meine Spielstände“ und „Meine Anmeldungen“ sind aus dem Kontextmenü entfernt, die alten Adressen leiten aufs Profil um.
- **Neu:** Anmeldungen trennen, einzeln oder „alle anderen Geräte“. Das Gerät wird beim nächsten Klick abgemeldet, der Fortschritt landet vorher im Zwischenspeicher. Admins können Anmeldungen aller Benutzer trennen.
- **Neu:** Meldungen in der Glocke archivieren, löschen oder alle archivieren. Archivierte lassen sich zurückholen.
- **Geändert:** Glocke und Daumen als schlichte Symbole statt Emojis, Meldungstexte ohne Emojis.
- **Geändert:** Größen in passender Einheit (B, KB, MB, GB, TB, PB) statt immer MB.
- **Behoben:** Das Profil zählte Testspiele (Spike) als gespielte Spiele.
- **Behoben:** „Zuletzt aktiv“ im Admin-Panel (Benutzer) zählte nur Spielstände und Scores. Jetzt zählen auch Anmeldungen und Uploads, sonst stand bei Entwicklern, die nur hochladen, und bei Spielern, die sich nur umsehen, „–“.
- **Neu:** Steckbrief auf der Upload-Seite: Titel, Beschreibung (Text unter dem Spiel) und Vorschaubild (PNG/JPG/WebP, max. 2 MB) direkt einstellen. Gilt sofort ohne neue Version, übersteht Updates und hat Vorrang vor der `game.json`. Beschrieben im Handbuch, Abschnitt 8b.
- **Geändert:** Die Hilfe verweist auf „Mein Profil → Spielstände“ statt auf „Meine Spielstände“.
- **Tests:** E2E-Skripte warten bis zu 15 s auf Chrome und beenden Chrome auch bei Abbruch. Neuer Test `scripts/e2e-zentrale-1.3.mjs`.

## 1.2.0 – 05.11.2026

Enthält auch 1.1.1, das nicht einzeln ausgeliefert wurde.

- **Neu:** Speichergrenze je Entwickler, Standard 1 GB (`UPLOAD_KONTINGENT_MB`), mit Anzeige auf der Upload-Seite. Das Admin-Panel warnt, wenn auf der NAS wenig Platz frei ist.
- **Neu:** Spielzeit wird gemessen, solange der Tab sichtbar ist. Dazu die Sortierung „meistgespielt“, „du: …“ auf der Kachel, die Spielzeit unter „Meine Spielstände“, „Meine Spiele“ und im Admin-Panel.
- **Neu:** Glocke in der Taskleiste, für alle mit eigenen Meldungen:
  - Antrag beantwortet
  - neues Spiel (an alle)
  - Updates nur von Spielen, die du als Favorit hast
  - „… hat dich überholt“
  - Erfolge
  - Spiel der Woche
- **Neu:** Wichtige Meldungen machen die Glocke rot und lassen sie wackeln, dazu eine einmalige Einblendung:
  - neuer Fehler in deinem Spiel (höchstens eine Meldung je Spiel und Stunde)
  - ein Spieler meldet einen Fehler in deinem Spiel
  - neuer Antrag (für Admins)
- **Neu:** Wächter. Er prüft alle 5 Minuten Datenbank, Upload-Dienst, Caddy, die Erreichbarkeit über Cloudflare, den Speicher und die Backup-Kopie. Er meldet an Home Assistant (Lebenszeichen, Probleme, neue Anträge) und zeigt den Status im Admin-Panel. Einrichtung: `docs/home-assistant.md`.
- **Neu:** `scripts/deploy.sh --gruendlich` fährt vor dem Deploy alle Ende-zu-Ende-Tests und „Böse“ im Teststand durch. Einzeln: `scripts/e2e-alle.sh`.
- **Neu:** Probe-Zentrale. `scripts/deploy.sh --probe` setzt eine Kopie mit den echten Spielen und Daten auf, nur über Tailscale erreichbar, mit orangem Band.
  - Dort testen, dann im Admin-Panel der Probe „Für Live freigeben“.
  - `scripts/deploy.sh` spielt nur freigegebene Commits live ein. Notfall: `--ohne-probe`.
- **Neu:** „Meine Anmeldungen“ (Menü) zeigt Gerät, Ort, IP, Anmeldezeit und letzte Aktivität je Sitzung. Im Admin-Panel unter Benutzer stehen alle.
- **Neu:** Speicher je Spiel auf der Upload-Seite (live, Entwurf, ältere Versionen, Anteil am Kontingent).
- **Neu:** Suche und Kategorien (`"tags"` in der `game.json`) in der Übersicht.
- **Neu:** Erfolge (`"erfolge"` in der `game.json`, `GameSave.erfolg(id)`). Sie erscheinen neben dem Spiel, als Einblendung und auf der Profilseite. Die Profilseite (Menü → Mein Profil, Klick auf Namen in der Bestenliste) zeigt Spielzeit, Erfolge und Plätze.
- **Neu:** Spiel der Woche (Admin-Panel → Spiele). Es gibt ein Banner, eine Meldung an alle und eine eigene Wochen-Bestenliste.
- **Neu:** 👍 auch auf den Kacheln der Übersicht. Bei eigenen Spielen steht deutlich „eigenes Spiel“ dabei, statt den Knopf nur auszugrauen.
- **Geändert:** Startvorlage, Prompt-Block, Handbuch und Hilfe sind ergänzt. Die Prüfung vor dem Veröffentlichen gibt Hinweise zu Kategorien und Erfolgen.

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
