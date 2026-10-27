import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in German (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). du, lowercase (docs/i18n/style/de.md); terms from
 * docs/i18n/glossary.csv (Spiel, Gegner, Wertung, Ranglistenspiel, Raum, Meldung, Blockierung, Störung,
 * Reaktion, Etappe, Wiederholung, Training). The page opens with TRANSLATION_NOTICE_DE: the English version
 * prevails.
 *
 * App labels quoted here (they must equal the app's de strings): Einstellungen (home:settings.title),
 * Konto löschen (account:settings.deleteAccount), Blockierte Spieler (moderation:blocked.settingsRow),
 * Lizenzen (home:settings.licenses), „Deine letzten Gegner“ (progress:leaderboard.caption.friends),
 * „So wird gespielt“ (levels:tutorial.title); the report reasons beleidigender Name, Schummeln, Sonstiges
 * (moderation:report.reasons.offensiveName, .cheating, .other). Puzzles are Rätsel, as in home:gameType.note.solo.
 *
 * An account's suspension is "Sperre" / "sperren" here, as German terms of service say it; the board's cell
 * lock (also "Sperre" in the app) never appears in these pages.
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_DE =
  'Dies ist eine Übersetzung der englischen Fassung. Bei Abweichungen ist die englische Fassung maßgeblich.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_DE: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Sprache',
  contents: 'Inhalt',
  documents: 'Dokumente',
  updated: 'Zuletzt aktualisiert:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[Name des Betreibers]',
  draft:
    'Entwurf: Die Kontaktdaten sind auf dem Server noch nicht festgelegt (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_DE,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `de`): [what happens, what it carries]. */
export const EVENT_DETAILS_DE: Record<TelemetryEventName, [string, string]> = {
  app_open: ['Die App wird geöffnet', '—'],
  screen_view: ['Ein Bildschirm wird geöffnet', 'Der Name des Bildschirms (sein Routenmuster, ohne IDs)'],
  register_step: ['Ein Schritt der Registrierung wird geöffnet', 'Der Schritt'],
  register_complete: ['Die Registrierung wird abgeschlossen', '—'],
  game_start: [
    'Ein Spiel beginnt',
    'Modus, Spieltyp, Anzahl der Spieler und ob es ein Spiel mit Freunden ist',
  ],
  game_end: [
    'Ein Spiel endet',
    'Modus, Ergebnis, Punkte, Anzahl der Fehler, Dauer und ob es ein Spiel mit Freunden war',
  ],
  interference_sent: ['Du sendest eine Störung', 'Ihre Art und ihre Kosten'],
  reaction_sent: ['Du sendest eine Reaktion', 'Welches Emoji'],
  matchmaking_wait: [
    'Eine Suche nach Gegnern endet',
    'Die Wartezeit in Sekunden und ob ein Spiel gefunden wurde',
  ],
  reconnect: [
    'Erneute Verbindung nach einem Verbindungsabbruch',
    'Wie lange es gedauert hat und ob es geklappt hat',
  ],
  latency_sample: ['Eine Messung der Verbindungsqualität', 'Antwortzeiten des Netzwerks, in Millisekunden'],
  replay_open: ['Eine Wiederholung wird geöffnet', 'Der Modus des Spiels'],
  account_delete: ['Das Konto wird gelöscht', '—'],
  report_sent: ['Du meldest einen Spieler', 'Nur der Grund (nicht, wer gemeldet wurde, und nicht das Spiel)'],
  level_map_open: [
    'Die Karte des Etappentrainings wird geöffnet',
    'Die aktuelle Etappe und deine Gesamtzahl an Sternen',
  ],
  level_start: [
    'Eine Etappe beginnt',
    'Nummer und Version der Etappe, ihr Kapitel und ihre Art, die Nummer des Versuchs, deine bisher besten Sterne und ob es ein Schnellstart war',
  ],
  level_end: [
    'Eine Etappe endet',
    'Nummer, Version und Art der Etappe, die Sterne, deine besten Sterne davor, ihre Dauer, wie sie endete, die Anzahl der Fehler, das Ergebnis (Zeit, Runden, Vorsprung oder Punkte), das Level des Bots und die Nummer des Versuchs',
  ],
  level_quit: [
    'Eine Etappe wird mittendrin verlassen (zum Beispiel wurde die App geschlossen)',
    'Nummer und Version der Etappe und wie lange sie schon lief',
  ],
  chapter_gate: [
    'Ein Versuch am Tor zum nächsten Kapitel',
    'Das Kapitel hinter dem Tor, die Sterne im Kapitel und ob sich das Tor geöffnet hat',
  ],
  level_tutorial: [
    'Das „So wird gespielt“ einer Etappenart wird angezeigt',
    'Die Art und ob du es übersprungen hast',
  ],
  friends_room_open: [
    'Ein Raum zum Spielen mit Freunden wird geöffnet',
    'Der Spieltyp und wie der Raum geöffnet wurde',
  ],
  friends_room_join: [
    'Ein Versuch, dem Raum von Freunden beizutreten',
    'Wie (mit einem Code oder einem Link) und wie es endete (Erfolg oder warum es fehlschlug)',
  ],
  friends_invite_share: [
    'Der Link eines Raums wird geteilt',
    'Ob der Gastgeber oder ein Gast ihn geteilt hat (nicht der Code und nicht, mit wem)',
  ],
  friends_link_open: ['Ein Raumlink öffnet die App', 'Ob du angemeldet warst'],
  friends_room_start: [
    'Ein Spiel mit Freunden beginnt',
    'Die Anzahl der Spieler und wie viele Sekunden du im Raum gewartet hast',
  ],
  friends_room_close: [
    'Du scheidest aus einem Raum aus, bevor dessen Spiel beginnt',
    'Der Grund, wie viele Spieler im Raum waren und wie viele Sekunden du gewartet hast',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_DE) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_DE[name],
  ]);

export const PRIVACY_DE: LegalDoc = {
  title: 'Datenschutzerklärung',
  lead: 'Was Sudoku Fight erhebt, warum, wer es sieht, wie lange es gespeichert wird und wie du es löschst.',
  sections: [
    {
      id: 'who',
      title: 'Wer wir sind',
      blocks: [
        'Sudoku Fight („das Spiel“, „wir“) ist ein kompetitives Sudoku-Spiel in Echtzeit, das von {operator} betrieben wird.',
        'Wenn du Fragen zum Datenschutz und zu deinen Daten hast, schreib uns an {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'Kurz gesagt',
      blocks: [
        {
          list: [
            'Wir erheben nur, was für den Betrieb des Spiels nötig ist: deine Kontodaten, deine Spiele und Nutzungsdaten, die uns helfen zu verstehen, wie das Spiel gespielt wird, und Probleme zu beheben.',
            '**Keine Werbung, und wir verkaufen keine Daten.** Wir verfolgen dich nicht über andere Apps oder Websites hinweg.',
            'Dein Anzeigename, dein Avatar, dein Land, deine Wertungen und deine Statistiken sind für andere Spieler sichtbar. Deine E-Mail-Adresse wird anderen Spielern nie angezeigt.',
            'Du kannst dein Konto jederzeit in der App löschen: Einstellungen → Konto löschen. Siehe die [Seite zur Kontolöschung](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Kontodaten',
      blocks: [
        'Wenn du dich registrierst, speichern wir:',
        {
          list: [
            '**E-Mail-Adresse:** um dich anzumelden, die Adresse zu bestätigen, dein Passwort zurückzusetzen und dir Nachrichten zu deinem Konto zu senden. Wir senden keine Marketing-E-Mails.',
            '**Passwort** (wenn du dich mit E-Mail-Adresse und Passwort registrierst): wird von Firebase Authentication von Google verarbeitet. Es erreicht nie unsere Server, und wir können es nicht sehen.',
            '**Anmeldung mit Google (optional):** Du kannst dich mit deinem Google-Konto statt mit einer E-Mail-Adresse und einem Passwort registrieren und anmelden. Firebase Authentication erhält dann von Google die E-Mail-Adresse deines Google-Kontos (von Google bestätigt) und dessen Google-ID und speichert sie mit deiner Anmeldung; wir speichern die E-Mail-Adresse wie bei jedem Konto. Google übermittelt Firebase außerdem deinen Google-Namen und dein Google-Profilfoto, die Firebase mit der Anmeldung speichert. Unser Server speichert sie nicht und zeigt sie nicht an: In der Arena erscheinen nur der Name und der Avatar, die du wählst. Wir erhalten nie dein Google-Passwort oder Zugriff auf irgendetwas anderes in deinem Google-Konto (Kontakte, E-Mails, Dateien). Wenn dir das lieber ist, registriere dich mit E-Mail-Adresse und Passwort.',
            '**Anzeigename, Land und Avatar:** Du wählst sie, und sie werden anderen Spielern angezeigt. Das Land wählst du selbst aus (die Voreinstellung ergibt sich aus den Sprach- und Regionseinstellungen deines Geräts). Den Standort deines Geräts verwenden wir nicht.',
            '**Wann das Konto erstellt und wann der Name zuletzt geändert wurde** (ein Name kann einmal innerhalb von 30 Tagen geändert werden).',
            '**Unsere Konto-ID** und deine Firebase-Anmelde-ID (bei der Anmeldung mit Google speichert Firebase auch die ID deines Google-Kontos).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Spiele und Fortschritt',
      blocks: [
        {
          list: [
            '**Ranglistenspiele** (auf dem Server gespeichert): das Spielfeld, jeder Zug mit seinem Zeitpunkt, die Störungen und Reaktionen, die du gesendet hast, deine Punkte, Fehler, Platzierung, Wertung vorher und nachher und wie das Spiel endete. Daraus entstehen dein Verlauf, deine Wiederholungen und deine Statistiken.',
            '**Spiele mit Freunden** (in einem Raum mit Code; auf dem Server gespeichert wie ein Ranglistenspiel, aber ohne Wertung): dieselben Angaben, mit Ausnahme der Wertung. Sie erscheinen in deinem Verlauf und deinen Wiederholungen, und die Spieler, mit denen du gespielt hast, erscheinen unter „Deine letzten Gegner“. Der Code des Raums, wer im Raum ist und wer daraus entfernt wurde, werden nur im Arbeitsspeicher des Servers gespeichert, bis der Raum geschlossen wird.',
            '**Wertungen, XP, Level und Erfolge.**',
            '**Welche Rätsel du gespielt hast und gegen wen:** damit du nicht immer wieder dasselbe Rätsel oder denselben Gegner bekommst.',
            '**Dein Tempo:** Am Ende jedes Ranglistenspiels ermitteln wir aus deinen Zügen deine durchschnittliche Zeit pro Zug (unter Berücksichtigung dessen, wie schwierig jedes Feld war) und speichern sie mit dem Spiel, zusammen mit der Anzahl der Züge, anhand derer sie gemessen wurde. Daraus, aus deiner Fehlerquote und aus deinen Ergebnissen gegen computergesteuerte Gegner legen wir das Tempo eines computergesteuerten Gegners fest, wenn keine Spieler verfügbar sind (siehe die [Nutzungsbedingungen](terms)). Dein Tempo wird anderen Spielern nicht angezeigt.',
            '**Trainingsergebnisse** (allein oder gegen einen Bot), wenn die App sie für XP übermittelt: Modus, Spieltyp, Ergebnis, Anzahl der richtigen Züge, wann es endete und die XP, die es eingebracht hat.',
            '**Etappentraining:** wenn die App deinen Fortschritt mit deinem Konto synchronisiert (damit er auch auf einem neuen Smartphone zurückkommt): deine besten Sterne in jeder Etappe, wie oft du sie gespielt hast und wann sich das geändert hat, und die XP, die die Etappen an jedem Tag gebracht haben.',
            '**Fairplay:** Wenn das Tempo der Züge in einem Ranglistenspiel ungewöhnlich hoch ist, wird ein Eintrag gespeichert, den ein Mensch prüft. Aufgrund dieses Eintrags geschieht nichts automatisch.',
            '**Meldungen und Blockierungen:** siehe „Meldungen und Blockierungen“ weiter unten.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Nutzungsdaten',
      blocks: [
        'Um zu verstehen, wie das Spiel genutzt wird, übermittelt die App Ereignisse an unseren Server. Jedes Ereignis hat eine eigene zufällige ID und die Uhrzeit auf deinem Smartphone; der Server fügt die Uhrzeit hinzu, zu der er es empfangen hat.',
        'Jede Übermittlung enthält außerdem eine **Installations-ID**: eine Zufallszahl, die beim ersten Start erzeugt und in der App gespeichert wird. Sie beruht nicht auf den Daten deines Geräts und verschwindet, wenn du die App deinstallierst. Mit ihr werden das System (iOS oder Android) und die Version der App übermittelt.',
        'Solange du angemeldet bist, werden Ereignisse und die Installation mit deinem Konto verknüpft. Ohne Verbindung warten Ereignisse auf deinem Smartphone und werden später gesendet.',
        'Die Ereignisse:',
        { table: { head: ['Ereignis', 'Wann', 'Was es enthält'], rows: eventRows() } },
        'Dieselben Ereignisse gehen auch an **Google Analytics for Firebase**, das eine ID der App-Installation, Geräte- und Systemdaten, Nutzungsdaten (etwa die Sitzungsdauer) und einen ungefähren Standort (Land und Region) hinzufügt, den Google aus der IP-Adresse ableitet. Wir haben es ohne Werbefunktionen eingerichtet: keine Werbe-ID und keine personalisierte Werbung.',
      ],
    },
    {
      id: 'crashes',
      title: 'Absturz- und Fehlerberichte',
      blocks: [
        {
          list: [
            '**In der App, Firebase Crashlytics von Google:** Wenn die App abstürzt oder auf einen Fehler stößt, wird ein Bericht gesendet, mit den Details des Fehlers, dem Gerätemodell, den Versionen von System und App, einer Crashlytics-Installations-ID und unserer Konto-ID, solange du angemeldet bist. Nicht deine E-Mail-Adresse oder dein Name.',
            '**Auf dem Server, Sentry:** Wenn der Server auf einen Fehler stößt, wird ein technischer Bericht darüber gesendet, manchmal mit der ID des betroffenen Kontos. Keine E-Mail-Adressen und keine Passwörter.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'IP-Adresse',
      blocks: [
        'Wenn die App eine Verbindung herstellt, sieht unser Server deine IP-Adresse. Wir verwenden sie **nur im Arbeitsspeicher des Servers**, um die Häufigkeit von Anfragen zu begrenzen und vor Anfragefluten zu schützen, und wir speichern sie nicht in unserer Datenbank.',
        'Unser Hosting-Anbieter kann gewöhnliche Zugriffsprotokolle für kurze Zeit speichern.',
      ],
    },
    {
      id: 'device',
      title: 'Was nur auf deinem Smartphone bleibt',
      blocks: [
        {
          list: [
            'Deine Trainingsspiele und ihr Verlauf.',
            'Dein Fortschritt im Etappentraining: Sterne, Versuche und die Tore, die du geöffnet hast (eine Kopie wird auch auf dem Server gespeichert: siehe „Spiele und Fortschritt“).',
            'Deine Einstellungen: Ton, Vibration, reduzierte Bewegung und Sprache.',
            'Eine Kopie deines Profils, damit sich die App ohne Verbindung öffnet.',
            'Warteschlangen mit noch nicht gesendeten Ereignissen und Trainingsergebnissen sowie die Installations-ID.',
            'Deine Anmeldung (von Firebase gespeichert) und bei der Anmeldung mit Google das Konto, das du gewählt hast (von den Google Play-Diensten gespeichert, bis du dich abmeldest).',
          ],
        },
        'All das wird gelöscht, wenn du die App deinstallierst. Beim Abmelden wird die Profilkopie gelöscht. Das Löschen deines Kontos löscht nicht die Trainingsspiele und den Fortschritt im Etappentraining auf deinem Smartphone: Um auch diese zu löschen, deinstalliere die App.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Was wir nicht erheben',
      blocks: [
        'Kontakte, Fotos, Mikrofon, Kamera, genauer Standort, Werbe-IDs und Zahlungsdaten. Das Spiel hat keinen Chat: Reaktionen sind Emojis aus einer festen Liste.',
      ],
    },
    {
      id: 'public',
      title: 'Was andere Spieler sehen',
      blocks: [
        {
          list: [
            'Dein Anzeigename, dein Avatar, dein Land (als Flagge), deine Wertungen, dein Level und deine Erfolge.',
            'Auf deiner Spielerkarte und in den Bestenlisten: Anzahl der Spiele, Siegquote, Serien, bester Zug, durchschnittliche Fehler, letzte Ergebnisse, die Störung, die du am häufigsten sendest, und wann du beigetreten bist (Monat und Jahr).',
            'Während eines Spiels: deine Punkte, Fehler, Störungen und Reaktionen und ob du online bist.',
            'In einem Raum zum Spielen mit Freunden: Wer dessen Code oder Link hat und den Raum betritt, sieht Namen, Avatar, Flagge und allgemeine Wertung aller, die darin sind, und ob sie gerade im Raum sind. Der Code und der Link selbst enthalten keine personenbezogenen Daten.',
            'Wiederholungen und Spieldetails: nur die Spieler des jeweiligen Spiels.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Meldungen und Blockierungen',
      blocks: [
        {
          list: [
            '**Einen Spieler melden:** Wenn du jemanden meldest, speichern wir, wer gemeldet hat, wen, den Grund (beleidigender Name, Schummeln oder Sonstiges), das Ranglistenspiel, wenn die Meldung aus einem solchen kam, und wann. Eine Meldung enthält keinen Freitext. Dem gemeldeten Spieler wird nicht mitgeteilt, wer ihn gemeldet hat.',
            '**Blockieren:** Wir speichern die Spieler, die du blockiert hast, und wann. Dadurch wirst du nicht mit ihnen in dasselbe Spiel gesetzt, und ihre Reaktionen werden dir nicht angezeigt. Niemand erfährt, dass er blockiert wurde, und eine Blockierung blendet niemanden aus den Bestenlisten aus.',
            '**Bearbeitung von Meldungen:** Der Betreiber des Spiels prüft jede Meldung innerhalb von 48 Stunden. Er kann einen beleidigenden Namen durch einen vorläufigen ersetzen (der Spieler wird dann gebeten, einen neuen Namen zu wählen) oder ein Konto für Ranglistenspiele und Kontoänderungen sperren. Jede solche Maßnahme wird in einem internen Protokoll festgehalten, mit der Adresse des Administrators, der sie vorgenommen hat, und mit dem alten und dem neuen Namen, wenn ein Name ersetzt wurde. Ein auf diese Weise ersetzter Name kommt auf eine Liste von Namen, die niemand erneut wählen darf (nur der Name, mit keinem Spieler verknüpft).',
            '**Ein gesperrtes Konto, das gelöscht wird:** Das Löschen eines Kontos hebt eine Sperre nicht auf. Wenn ein gesperrtes Konto gelöscht wird, speichern wir einen Einweg-Fingerabdruck (einen Hash) seiner Anmelde-ID und seiner bestätigten E-Mail-Adresse, nicht die ID oder die Adresse selbst. Ein neues Konto mit derselben Anmeldung beginnt gesperrt, bis ein Administrator es prüft, und der Fingerabdruck wird dann gelöscht. Das ist unser berechtigtes Interesse und das jedes Spielers an Fairplay.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Wofür wir die Daten verwenden',
      blocks: [
        {
          list: [
            '**Um das Spiel zu betreiben:** dein Konto, deine Spiele, Wertungen, Matchmaking, Verlauf und Bestenlisten. Das ist für unsere Vereinbarung mit dir (die Nutzungsbedingungen) erforderlich.',
            '**Sicherheit und Fairplay:** Begrenzung der Anfragehäufigkeit, Erkennen von Auffälligkeiten, Verhindern von Schummeln und Bearbeitung von Meldungen und Blockierungen. Das ist unser berechtigtes Interesse und das jedes Spielers.',
            '**Um das Spiel zu verbessern:** um zu erfahren, welche Bildschirme und Modi gespielt werden, Probleme zu finden und Abstürze zu beheben. Ebenfalls ein berechtigtes Interesse, ohne Werbung und ohne Marketingprofil.',
            '**Service-E-Mails:** nur Bestätigung der Adresse und Zurücksetzen des Passworts.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'An wen wir sie weitergeben',
      blocks: [
        'Wir **verkaufen keine** Daten, und wir geben sie nicht an Werbetreibende oder Datenhändler weiter. Unsere Dienstleister verarbeiten sie ausschließlich für uns:',
        {
          list: [
            '**Google (Firebase):** Anmeldung (Authentication, einschließlich der Anmeldung mit Google), Absturzberichte (Crashlytics) und Nutzungsdaten (Analytics).',
            '**Fly.io:** Hosting des Servers.',
            '**Neon:** die Datenbank (PostgreSQL).',
            '**Sentry:** Berichte über Serverfehler.',
          ],
        },
        'Wir legen Daten auch offen, wenn das Gesetz es verlangt, oder um das Spiel und seine Spieler zu schützen. Wenn das Spiel auf einen anderen Eigentümer übergeht, gehen die Daten mit über, und diese Erklärung gilt weiterhin für sie.',
      ],
    },
    {
      id: 'transfers',
      title: 'Wo die Daten sind',
      blocks: [
        'Der Server und die Datenbank befinden sich derzeit in der Europäischen Union (Frankfurt, Deutschland). Google und Sentry können Daten auch in den Vereinigten Staaten und in anderen Ländern verarbeiten, auf Grundlage ihrer eigenen Garantien für Datenübermittlungen (etwa der Standardvertragsklauseln der EU).',
      ],
    },
    {
      id: 'retention',
      title: 'Wie lange wir sie speichern',
      blocks: [
        {
          list: [
            '**Kontodaten:** solange das Konto besteht.',
            '**Wenn du dein Konto löschst:** Deine E-Mail-Adresse, dein Land, dein Avatar und die Verknüpfung zur Anmeldung werden sofort gelöscht, und dein Anzeigename wird durch eine anonyme ID ersetzt (der alte Name ist sofort wieder frei). Auch deine Firebase-Anmeldung wird gelöscht, mit dem, was sie von Google gespeichert hatte. Wenn du dich mit Google angemeldet hast, widerruft die App außerdem den Zugriff, der ihr auf dein Google-Konto gewährt wurde.',
            '**Fortschritt im Etappentraining:** Die Kopie auf dem Server (deine Sterne in jeder Etappe und die XP, die die Etappen an jedem Tag gebracht haben) wird mit dem Konto gelöscht. Die Kopie auf deinem Smartphone bleibt, bis du die App deinstallierst.',
            '**Was nach der Löschung anonym bleibt:** Ranglistenspiele, Wertungen, XP, Trainingsergebnisse, Fairplay-Einträge, von dir gesendete Meldungen und Nutzungsdaten. Sie sind nicht mehr mit dir verknüpft, aber die Spiele, Wiederholungen und Bestenlisten anderer Spieler bleiben vollständig.',
            '**Meldungen, Blockierungen und das Administrationsprotokoll:** Eine Blockierung bleibt gespeichert, bis du sie aufhebst oder dein Konto löschst (dann werden alle seine Blockierungen gelöscht, in beide Richtungen). Meldungen und das Protokoll der Administratormaßnahmen werden gespeichert, solange sie nötig sind, um Meldungen zu bearbeiten und das Spiel sicher und fair zu halten; wir überprüfen sie von Zeit zu Zeit und löschen alte. Wenn ein Konto gelöscht wird, werden offene Meldungen über dieses Konto geschlossen, und seine Namen werden aus dem Administrationsprotokoll entfernt. Wenn es gesperrt war, bleibt nur der oben beschriebene Einweg-Fingerabdruck, bis ein neues Konto mit derselben Anmeldung erstellt wird oder wir ihn bei einer regelmäßigen Überprüfung löschen.',
            '**Nutzungsdaten:** werden gespeichert, solange sie uns helfen zu verstehen, wie das Spiel genutzt wird. Wir überprüfen sie von Zeit zu Zeit und löschen alte Daten.',
            '**Crashlytics:** Google speichert Absturzberichte bis zu 90 Tage. **Analytics:** für die Aufbewahrungsdauer, die wir in Firebase festgelegt haben.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Deine Rechte',
      blocks: [
        'Du kannst verlangen, deine Daten einzusehen, sie zu berichtigen (deinen Namen, deinen Avatar und dein Land kannst du in der App ändern), sie zu löschen (indem du dein Konto in der App löschst) oder ihrer Verwendung zu widersprechen. Schreib uns an {email}, und wir antworten innerhalb von 30 Tagen.',
        'Du kannst dich auch bei der israelischen Datenschutzbehörde oder bei der Datenschutzaufsichtsbehörde deines Landes beschweren.',
      ],
    },
    {
      id: 'children',
      title: 'Kinder',
      blocks: [
        'Das Spiel ist nicht für Kinder unter 13 Jahren gedacht, und wir erheben nicht wissentlich Daten über sie. Wenn wir erfahren, dass ein Kind unter 13 Jahren ein Konto eröffnet hat, löschen wir es. Wo das Mindestalter höher ist, ist bis zu diesem Alter die Einwilligung eines Elternteils erforderlich.',
      ],
    },
    {
      id: 'security',
      title: 'Sicherheit',
      blocks: [
        'Der Datenverkehr zwischen der App und dem Server ist verschlüsselt (HTTPS und WSS). Passwörter werden von Firebase verarbeitet und nicht von uns gespeichert. Der Zugriff auf die Daten auf dem Server ist auf den Betreiber des Spiels beschränkt. Kein System ist vollkommen sicher, aber wir unternehmen angemessene Anstrengungen, um deine Daten zu schützen.',
      ],
    },
    {
      id: 'changes',
      title: 'Änderungen dieser Erklärung',
      blocks: [
        'Wenn sich diese Erklärung ändert, aktualisieren wir hier das Datum. Wesentliche Änderungen kündigen wir außerdem in der App an.',
      ],
    },
    {
      id: 'contact',
      title: 'Kontakt',
      blocks: ['{operator} · {email}', 'Siehe auch die [Nutzungsbedingungen](terms).'],
    },
  ],
};

export const TERMS_DE: LegalDoc = {
  title: 'Nutzungsbedingungen',
  lead: 'Die Regeln für die Nutzung von Sudoku Fight. Wenn du das Spiel nutzt, akzeptierst du sie.',
  sections: [
    {
      id: 'acceptance',
      title: 'Zustimmung',
      blocks: [
        'Diese Bedingungen gelten für die App Sudoku Fight und ihre Dienste („das Spiel“), die von {operator} („wir“) betrieben werden. Indem du dich registrierst oder das Spiel nutzt, akzeptierst du sie und die [Datenschutzerklärung](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Wer spielen darf',
      blocks: [
        'Du musst mindestens 13 Jahre alt sein oder das Mindestalter erreicht haben, das das Recht deines Landes festlegt, falls dieses höher ist. Unter 18 Jahren brauchst du die Einwilligung eines Elternteils oder einer erziehungsberechtigten Person.',
      ],
    },
    {
      id: 'account',
      title: 'Dein Konto',
      blocks: [
        {
          list: [
            'Ein Konto pro Person, mit deiner eigenen E-Mail-Adresse.',
            'Halte dein Passwort (oder das Google-Konto, mit dem du dich anmeldest) sicher. Du bist für alles verantwortlich, was mit deinem Konto geschieht.',
            'Du kannst dein Konto jederzeit in der App löschen: Einstellungen → Konto löschen.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Anzeigenamen und Verhalten',
      blocks: [
        'Dein Anzeigename, dein Avatar und dein Land sind für alle Spieler sichtbar. Ein Name darf nicht:',
        {
          list: [
            'anstößig, rassistisch, sexuell, bedrohlich oder beleidigend sein;',
            'eine andere Person, einen anderen Spieler oder das Personal des Spiels nachahmen;',
            'personenbezogene Daten (eine Telefonnummer, eine Adresse), Werbung oder einen Link enthalten.',
          ],
        },
        'Namen werden automatisch mit einer Liste unzulässiger Wörter abgeglichen. Wir können einen Namen, der gegen diese Regeln verstößt, ändern, einen neuen verlangen oder das Konto sperren.',
        'Reaktionen im Spiel sind Emojis aus einer festen Liste. Du kannst einen Gegner während eines Spiels über dessen Karte stummschalten, blockieren oder melden (nächster Abschnitt).',
      ],
    },
    {
      id: 'reports',
      title: 'Melden und Blockieren',
      blocks: [
        'Du kannst einen Spieler über dessen Karte oder aus dem Spiel heraus melden, mit einem von drei Gründen: beleidigender Name, Schummeln oder Sonstiges. **Wir prüfen jede Meldung innerhalb von 48 Stunden.**',
        'Wenn gegen die Regeln verstoßen wurde, können wir den Namen durch einen vorläufigen ersetzen (der Spieler wird dann gebeten, einen neuen Namen zu wählen, und die 30-Tage-Regel gilt für diese Wahl nicht), das Konto für Ranglistenspiele und Kontoänderungen sperren, bis die Sperre aufgehoben wird, oder es schließen. Ein auf diese Weise ersetzter Name kann nicht erneut gewählt werden. Ein gesperrtes Konto kann trotzdem jederzeit gelöscht werden, aber das Löschen hebt die Sperre nicht auf: Ein neues Konto mit derselben Anmeldung beginnt gesperrt, bis wir es prüfen.',
        'Du kannst einen Spieler auch blockieren: Du wirst nicht mit dieser Person in dasselbe Spiel gesetzt, und ihre Reaktionen werden dir nicht angezeigt. Eine Blockierung hebst du unter Einstellungen → Blockierte Spieler auf. Eine Blockierung blendet niemanden aus den Bestenlisten aus.',
        'Melde niemanden ohne Grund: Wiederholte falsche Meldungen verstoßen gegen diese Bedingungen.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Fairplay',
      blocks: [
        'Du darfst nicht:',
        {
          list: [
            'Sudoku-Löser, Bots, Skripte, Automatisierung oder eine veränderte App verwenden;',
            'mehrere Konten führen, um Wertungen zu beeinflussen, Ergebnisse mit einem anderen Spieler absprechen oder absichtlich verlieren;',
            'Programmfehler ausnutzen, statt sie zu melden;',
            'unsere Server überlasten, versuchen, in sie einzudringen, oder andere Spieler stören.',
          ],
        },
        'Der Server markiert ungewöhnliche Spiele zur Prüfung. Wenn gegen die Regeln verstoßen wurde, können wir Ergebnisse annullieren, Wertungen zurücksetzen oder das Konto sperren und schließen.',
      ],
    },
    {
      id: 'virtual',
      title: 'Wertungen, XP und Erfolge',
      blocks: [
        'Wertungen, XP, Level und Erfolge haben keinen Geldwert und können weder übertragen noch verkauft werden. Wir können ändern, wie sie berechnet werden, oder sie zurücksetzen (zum Beispiel zu Beginn einer Saison).',
        'Das Spiel ist kostenlos. Diese Version enthält keine Käufe und keine Werbung.',
      ],
    },
    {
      id: 'service',
      title: 'Verfügbarkeit',
      blocks: [
        'Ranglistenspiele erfordern eine Internetverbindung. Wenn keine Spieler verfügbar sind, kann es sein, dass du einem computergesteuerten Gegner zugeteilt wirst, der in einem ähnlichen Tempo wie du spielt. Solche Spiele zählen für deine Wertung. Das Spiel kann dir außerdem ein Trainingsspiel gegen einen Bot anbieten, ohne Wertung. Wenn der Server während eines Ranglistenspiels neu startet, endet dieses Spiel ohne Änderung der Wertung.',
        'Wir können Teile des Spiels ändern, pausieren oder einstellen, und wir werden versuchen, wesentliche Änderungen vorher anzukündigen.',
      ],
    },
    {
      id: 'ip',
      title: 'Geistiges Eigentum',
      blocks: [
        'Das Spiel, sein Design, sein Code, seine Sounds und seine Avatare gehören uns oder denen, die sie uns lizenziert haben. Wir gewähren dir eine persönliche, nicht ausschließliche, nicht kommerzielle Lizenz, das Spiel gemäß diesen Bedingungen zu nutzen. Lizenzen Dritter sind in der App aufgeführt: Einstellungen → Lizenzen.',
      ],
    },
    {
      id: 'stores',
      title: 'App-Stores',
      blocks: [
        'Apple und Google sind nicht Parteien dieser Bedingungen und nicht für das Spiel verantwortlich. Wenn du das Spiel aus dem App Store heruntergeladen hast, gilt außerdem der Standard-Endbenutzer-Lizenzvertrag von Apple (EULA), und Apple und seine Tochtergesellschaften können diese Bedingungen als begünstigte Dritte durchsetzen.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Haftungsausschluss',
      blocks: [
        'Das Spiel wird „wie besehen“ bereitgestellt. Soweit gesetzlich zulässig, garantieren wir nicht, dass es ohne Unterbrechungen oder Fehler funktioniert, und wir haften nicht für indirekte Schäden, verlorene Daten oder verlorene Wertungen. Nichts in diesen Bedingungen schränkt Rechte ein, die dir das Gesetz gewährt und auf die nicht verzichtet werden kann.',
      ],
    },
    {
      id: 'termination',
      title: 'Beendigung',
      blocks: [
        'Du kannst jederzeit aufhören zu spielen und dein Konto löschen. Wir können ein Konto, das gegen diese Bedingungen verstößt, sperren oder schließen.',
      ],
    },
    {
      id: 'changes',
      title: 'Änderungen dieser Bedingungen',
      blocks: [
        'Wenn sich diese Bedingungen ändern, aktualisieren wir hier das Datum. Wesentliche Änderungen kündigen wir außerdem in der App an. Wenn du das Spiel nach einer Änderung nutzt, akzeptierst du die neuen Bedingungen.',
      ],
    },
    {
      id: 'law',
      title: 'Anwendbares Recht',
      blocks: [
        'Diese Bedingungen unterliegen dem Recht des Staates Israel, und ausschließlicher Gerichtsstand sind die zuständigen Gerichte des Bezirks Tel Aviv, es sei denn, das Recht deines Landes gewährt dir ein Recht, auf das nicht verzichtet werden kann.',
      ],
    },
    {
      id: 'contact',
      title: 'Kontakt',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_DE: LegalDoc = {
  title: 'Dein Konto löschen',
  lead: 'Wie du dein Konto bei Sudoku Fight löschst und was mit deinen Daten passiert.',
  sections: [
    {
      id: 'in-app',
      title: 'In der App (sofort)',
      blocks: [
        {
          list: [
            'Öffne Sudoku Fight und geh zu **Einstellungen**.',
            'Tippe auf **Konto löschen** und bestätige.',
            'Gib dein Passwort ein oder wähle, wenn du dich mit Google anmeldest, dein Google-Konto erneut aus. Das Konto wird sofort gelöscht, und die App kehrt zum Anmeldebildschirm zurück.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Ohne die App',
      blocks: [
        'Schreib uns an {email} **von der E-Mail-Adresse deines Kontos**, mit dem Betreff „Mein Konto löschen“ und deinem Anzeigenamen. Wir stellen sicher, dass die Anfrage von der Inhaberin oder dem Inhaber des Kontos stammt, und löschen es innerhalb von 30 Tagen. Sobald das erledigt ist, bestätigen wir es dir per E-Mail.',
      ],
    },
    {
      id: 'what',
      title: 'Was gelöscht wird und was bleibt',
      blocks: [
        {
          list: [
            '**Sofort gelöscht:** deine E-Mail-Adresse, dein Land, dein Avatar, deine Anmeldung (auch bei Firebase) und die Verknüpfung zwischen deinem Konto und deinen Installationen. Dein Anzeigename wird durch eine anonyme ID ersetzt und ist für andere frei.',
            '**Anonym gespeichert:** Ranglistenspiele, Wertungen, XP, Trainingsergebnisse, Fairplay-Einträge und Nutzungsdaten. Sie sind nicht mehr mit dir verknüpft, aber die Spiele und Bestenlisten anderer Spieler bleiben vollständig.',
            '**Auf deinem Smartphone:** Die Trainingsspiele auf deinem Smartphone bleiben dort, bis du die App deinstallierst.',
            '**Bei Google:** Absturzberichte werden bis zu 90 Tage gespeichert, Analytics-Daten für die festgelegte Aufbewahrungsdauer.',
          ],
        },
        'Mehr dazu in der [Datenschutzerklärung](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_DE: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_DE,
  terms: TERMS_DE,
  'delete-account': DELETE_ACCOUNT_DE,
};
