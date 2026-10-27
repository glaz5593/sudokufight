import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Dutch (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). je/jij, lowercase (docs/i18n/style/nl.md); terms from
 * docs/i18n/glossary.csv (spel, tegenstander, rating, ranked, kamer, melding/melden, blokkering/blokkeren,
 * verstoring, reactie, etappe, hoofdstuk, herhaling, oefenen, niveau, ster). The page opens with
 * TRANSLATION_NOTICE_NL: the English version prevails.
 *
 * App labels quoted here (they must equal the app's nl strings): Instellingen (home:settings.title),
 * Account verwijderen (account:settings.deleteAccount), Geblokkeerde spelers (moderation:blocked.settingsRow),
 * Licenties (home:settings.licenses), “Je recente tegenstanders” (progress:leaderboard.caption.friends),
 * “Zo speel je” (levels:tutorial.title); the report reasons aanstootgevende naam, valsspelen, anders
 * (moderation:report.reasons.offensiveName, .cheating, .other).
 *
 * The operator ({operator}) is "de exploitant"; an admin who handles reports is "een beheerder". Fair play is
 * "eerlijk spel" throughout. "Sign-in" (what Firebase keeps) is "inloggegevens"; uninstalling the app is
 * "de app verwijderen", as Android and iOS say it in Dutch.
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_NL =
  'Dit is een vertaling van de Engelse versie. Als ze van elkaar verschillen, is de Engelse versie leidend.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_NL: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Taal',
  contents: 'Inhoud',
  documents: 'Documenten',
  updated: 'Laatst bijgewerkt:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[naam van de exploitant]',
  draft:
    'Concept: de contactgegevens zijn nog niet ingesteld op de server (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_NL,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `nl`): [what happens, what it carries]. */
export const EVENT_DETAILS_NL: Record<TelemetryEventName, [string, string]> = {
  app_open: ['De app wordt geopend', '—'],
  screen_view: ['Een scherm wordt geopend', 'De naam van het scherm (het routepatroon, zonder ID’s)'],
  register_step: ['Een stap van de registratie wordt geopend', 'De stap'],
  register_complete: ['De registratie is voltooid', '—'],
  game_start: ['Een spel begint', 'Modus, speltype, aantal spelers, en of het een spel met vrienden is'],
  game_end: [
    'Een spel eindigt',
    'Modus, resultaat, score, aantal fouten, duur, en of het een spel met vrienden was',
  ],
  interference_sent: ['Je stuurt een verstoring', 'De soort en de kosten ervan'],
  reaction_sent: ['Je stuurt een reactie', 'Welke emoji'],
  matchmaking_wait: [
    'Een zoektocht naar tegenstanders eindigt',
    'Hoeveel seconden je hebt gewacht, en of er een spel is gevonden',
  ],
  reconnect: ['Opnieuw verbinden nadat de verbinding is weggevallen', 'Hoe lang het duurde, en of het lukte'],
  latency_sample: [
    'Een meting van de verbindingskwaliteit',
    'Reactietijden van het netwerk, in milliseconden',
  ],
  replay_open: ['Een herhaling wordt geopend', 'De modus van het spel'],
  account_delete: ['Het account wordt verwijderd', '—'],
  report_sent: ['Je meldt een speler', 'Alleen de reden (niet wie er is gemeld, en ook niet het spel)'],
  level_map_open: [
    'De kaart van oefenen in etappes wordt geopend',
    'De huidige etappe en je totale aantal sterren',
  ],
  level_start: [
    'Een etappe begint',
    'Het nummer en de versie van de etappe, het hoofdstuk en de soort, het nummer van de poging, je beste sterren tot dan toe, en of het een snelle start was',
  ],
  level_end: [
    'Een etappe eindigt',
    'Het nummer, de versie en de soort van de etappe, de sterren, je beste sterren daarvóór, de duur, hoe ze eindigde, het aantal fouten, het resultaat (tijd, plekken, voorsprong of punten), het niveau van de bot en het nummer van de poging',
  ],
  level_quit: [
    'Een etappe wordt halverwege verlaten (bijvoorbeeld omdat de app werd gesloten)',
    'Het nummer en de versie van de etappe, en hoe lang ze al bezig was',
  ],
  chapter_gate: [
    'Een poging bij de poort naar het volgende hoofdstuk',
    'Het hoofdstuk achter de poort, de sterren in het hoofdstuk, en of de poort openging',
  ],
  level_tutorial: [
    'De uitleg “Zo speel je” van een soort etappe wordt getoond',
    'De soort, en of je de uitleg hebt overgeslagen',
  ],
  friends_room_open: [
    'Er wordt een kamer geopend om met vrienden te spelen',
    'Het speltype, en hoe de kamer is geopend',
  ],
  friends_room_join: [
    'Een poging om deel te nemen aan een kamer met vrienden',
    'Hoe (met een code of een link), en hoe het afliep (gelukt, of waarom het mislukte)',
  ],
  friends_invite_share: [
    'De link van een kamer wordt gedeeld',
    'Of de host of een gast die heeft gedeeld (niet de code, en ook niet met wie)',
  ],
  friends_link_open: ['Een kamerlink opent de app', 'Of je was ingelogd'],
  friends_room_start: [
    'Een spel met vrienden begint',
    'Het aantal spelers, en hoeveel seconden je in de kamer hebt gewacht',
  ],
  friends_room_close: [
    'Je zit niet meer in een kamer voordat het spel daarin begint',
    'De reden, hoeveel spelers er in de kamer waren, en hoeveel seconden je hebt gewacht',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_NL) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_NL[name],
  ]);

export const PRIVACY_NL: LegalDoc = {
  title: 'Privacybeleid',
  lead: 'Wat Sudoku Fight verzamelt, waarom, wie het ziet, hoe lang het wordt bewaard en hoe je het verwijdert.',
  sections: [
    {
      id: 'who',
      title: 'Wie we zijn',
      blocks: [
        'Sudoku Fight (“het spel”, “we”) is een competitief sudokuspel in realtime, geëxploiteerd door {operator}.',
        'Voor elke vraag over privacy en je gegevens kun je ons mailen op {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'In het kort',
      blocks: [
        {
          list: [
            'We verzamelen alleen wat nodig is om het spel te laten draaien: je accountgegevens, je spellen en gebruiksgegevens die ons helpen te begrijpen hoe het spel wordt gespeeld en problemen op te lossen.',
            '**Geen advertenties, en we verkopen geen gegevens.** We volgen je niet in andere apps of op andere websites.',
            'Je weergavenaam, avatar, land, ratings en statistieken zijn zichtbaar voor andere spelers. Je e-mailadres wordt nooit aan andere spelers getoond.',
            'Je kunt je account op elk moment in de app verwijderen: Instellingen → Account verwijderen. Zie de [pagina over het verwijderen van je account](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Accountgegevens',
      blocks: [
        'Als je je registreert, bewaren we:',
        {
          list: [
            '**E-mailadres:** om in te loggen, het adres te verifiëren, je wachtwoord opnieuw in te stellen en berichten over je account te sturen. We sturen geen marketingmails.',
            '**Wachtwoord** (als je je registreert met e-mailadres en wachtwoord): wordt verwerkt door Firebase Authentication van Google. Het komt nooit op onze servers, en wij kunnen het niet zien.',
            '**Inloggen met Google (optioneel):** je kunt je registreren en inloggen met je Google-account in plaats van met een e-mailadres en wachtwoord. Firebase Authentication ontvangt dan van Google het e-mailadres van je Google-account (geverifieerd door Google) en de Google-ID ervan, en bewaart die bij je inloggegevens; wij bewaren het e-mailadres zoals bij elk account. Google geeft Firebase ook je Google-naam en profielfoto, die Firebase bij de inloggegevens bewaart. Onze server slaat die niet op en toont ze niet: in de arena verschijnen alleen de naam en avatar die jij kiest. We krijgen nooit je Google-wachtwoord, en ook geen toegang tot iets anders in je Google-account (contacten, e-mail, bestanden). Heb je dat liever, registreer je dan met e-mailadres en wachtwoord.',
            '**Weergavenaam, land en avatar:** die kies je zelf, en ze worden aan andere spelers getoond. Het land kies je zelf (de standaardwaarde komt uit de taal- en regio-instellingen van je apparaat). We gebruiken de locatie van je apparaat niet.',
            '**Wanneer het account is aangemaakt en wanneer de naam voor het laatst is gewijzigd** (een naam kan één keer per 30 dagen worden gewijzigd).',
            '**Onze account-ID**, en je inlog-ID bij Firebase (bij inloggen met Google bewaart Firebase ook de ID van je Google-account).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Spellen en voortgang',
      blocks: [
        {
          list: [
            '**Ranked spellen** (bewaard op de server): het bord, elke zet met de timing ervan, de verstoringen en reacties die je hebt gestuurd, je score, fouten, plaats, rating ervoor en erna, en hoe het spel eindigde. Daaruit bestaan je geschiedenis, herhalingen en statistieken.',
            '**Spellen met vrienden** (in een kamer met een code; bewaard op de server zoals een ranked spel, maar zonder rating): dezelfde gegevens, behalve de rating. Ze verschijnen in je geschiedenis en herhalingen, en de spelers met wie je hebt gespeeld, verschijnen onder “Je recente tegenstanders”. De kamercode, wie er in de kamer is en wie eruit is verwijderd, worden alleen in het geheugen van de server bewaard, tot de kamer sluit.',
            '**Ratings, XP, niveau en prestaties.**',
            '**Welke puzzels je hebt gespeeld, en tegen wie:** zodat je niet steeds dezelfde puzzel of tegenstander krijgt.',
            '**Je tempo:** aan het einde van elk ranked spel berekenen we uit je zetten je gemiddelde tijd per zet (rekening houdend met hoe moeilijk elk vakje was), en bewaren we die bij het spel, met het aantal zetten waarop die is gemeten. Op basis daarvan, van je foutpercentage en van je resultaten tegen computergestuurde tegenstanders stellen we het tempo in van een computergestuurde tegenstander als er geen spelers beschikbaar zijn (zie de [Gebruiksvoorwaarden](terms)). Je tempo wordt niet aan andere spelers getoond.',
            '**Oefenresultaten** (solo of tegen een bot), als de app ze voor XP doorgeeft: modus, speltype, uitkomst, aantal juiste zetten, wanneer het spel eindigde, en de XP die het opleverde.',
            '**Oefenen in etappes:** als de app je voortgang met je account synchroniseert (zodat die ook op een nieuwe telefoon terugkomt): je beste sterren per etappe, hoe vaak je die hebt gespeeld en wanneer dat veranderde, en de XP die de etappes per dag opleverden.',
            '**Eerlijk spel:** als het tempo van de zetten in een ranked spel ongewoon hoog is, wordt dat vastgelegd zodat een mens het kan beoordelen. Daardoor gebeurt er niets automatisch.',
            '**Meldingen en blokkeringen:** zie “Meldingen en blokkeringen” hieronder.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Gebruiksgegevens',
      blocks: [
        'Om te begrijpen hoe het spel wordt gebruikt, stuurt de app gebeurtenissen naar onze server. Elke gebeurtenis heeft een eigen willekeurige ID en de tijd op je telefoon; de server voegt de tijd toe waarop hij die heeft ontvangen.',
        'Bij elke verzending gaat ook een **installatie-ID** mee: een willekeurig getal dat bij de eerste start wordt gemaakt en in de app wordt bewaard. Het is niet gebaseerd op de gegevens van je apparaat, en het verdwijnt als je de app verwijdert. Samen daarmee gaan het systeem (iOS of Android) en de versie van de app mee.',
        'Terwijl je bent ingelogd, worden gebeurtenissen en de installatie aan je account gekoppeld. Zonder verbinding wachten gebeurtenissen op je telefoon en worden ze later verstuurd.',
        'De gebeurtenissen:',
        { table: { head: ['Gebeurtenis', 'Wanneer', 'Wat het bevat'], rows: eventRows() } },
        'Dezelfde gebeurtenissen gaan ook naar **Google Analytics for Firebase**, dat een ID van de app-installatie toevoegt, gegevens over apparaat en systeem, gebruiksgegevens (zoals de duur van een sessie) en een geschatte locatie (land en regio) die Google afleidt uit het IP-adres. We hebben het ingesteld zonder advertentiefuncties: geen advertentie-ID en geen gepersonaliseerde advertenties.',
      ],
    },
    {
      id: 'crashes',
      title: 'Crash- en foutrapporten',
      blocks: [
        {
          list: [
            '**In de app, Firebase Crashlytics van Google:** als de app crasht of een fout tegenkomt, wordt er een rapport verstuurd met de details van de fout, het model van het apparaat, de versies van het systeem en de app, een installatie-ID van Crashlytics en, terwijl je bent ingelogd, onze account-ID. Niet je e-mailadres of naam.',
            '**Op de server, Sentry:** als de server een fout tegenkomt, wordt er een technisch rapport over verstuurd, soms met de ID van het betrokken account. Geen e-mailadressen en geen wachtwoorden.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'IP-adres',
      blocks: [
        'Als de app verbinding maakt, ziet onze server je IP-adres. We gebruiken het **alleen in het geheugen van de server**, om het aantal verzoeken te beperken en ons te beschermen tegen overspoeling, en we slaan het niet op in onze database.',
        'Onze hostingprovider kan gewone toegangslogs korte tijd bewaren.',
      ],
    },
    {
      id: 'device',
      title: 'Wat alleen op je telefoon blijft',
      blocks: [
        {
          list: [
            'Je oefenspellen en hun geschiedenis.',
            'Je voortgang in oefenen in etappes: sterren, pogingen en de poorten die je hebt geopend (er wordt ook een kopie op de server bewaard: zie “Spellen en voortgang”).',
            'Je instellingen: geluid, trillingen, minder beweging en taal.',
            'Een kopie van je profiel, zodat de app ook zonder verbinding opent.',
            'Wachtrijen van gebeurtenissen en oefenresultaten die nog niet zijn verstuurd, en de installatie-ID.',
            'Je inloggegevens (bewaard door Firebase), en bij inloggen met Google het account dat je hebt gekozen (bewaard door Google Play-services tot je uitlogt).',
          ],
        },
        'Dit alles wordt gewist als je de app verwijdert. Uitloggen wist de kopie van je profiel. Als je je account verwijdert, worden de oefenspellen en de voortgang in oefenen in etappes op je telefoon niet gewist: om die ook te wissen, verwijder je de app.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Wat we niet verzamelen',
      blocks: [
        'Contacten, foto’s, microfoon, camera, precieze locatie, advertentie-ID’s en betaalgegevens. Het spel heeft geen chat: reacties zijn emoji uit een vaste lijst.',
      ],
    },
    {
      id: 'public',
      title: 'Wat andere spelers zien',
      blocks: [
        {
          list: [
            'Je weergavenaam, avatar, land (als vlag), ratings, niveau en prestaties.',
            'Op je spelerskaart en de ranglijsten: aantal spellen, winstpercentage, reeksen, beste zet, gemiddeld aantal fouten, recente resultaten, de verstoring die je het vaakst stuurt, en wanneer je bent begonnen (maand en jaar).',
            'Tijdens een spel: je score, fouten, verstoringen en reacties, en of je online bent.',
            'In een kamer om met vrienden te spelen: iedereen die de code of link heeft en de kamer binnengaat, ziet van iedereen in de kamer de naam, avatar, vlag en algemene rating, en of die op dat moment in de kamer is. De code en de link zelf bevatten geen persoonsgegevens.',
            'Herhalingen en details van een spel: alleen de spelers van dat spel.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Meldingen en blokkeringen',
      blocks: [
        {
          list: [
            '**Een speler melden:** als je iemand meldt, bewaren we wie de melding deed, over wie, de reden (aanstootgevende naam, valsspelen of anders), het ranked spel als de melding daaruit kwam, en wanneer. Een melding bevat geen vrije tekst. De gemelde speler krijgt niet te horen wie de melding heeft gedaan.',
            '**Blokkeren:** we bewaren welke spelers je hebt geblokkeerd en wanneer. Daardoor kom je niet met hen in hetzelfde spel, en worden hun reacties niet aan jou getoond. Niemand krijgt te horen dat die is geblokkeerd, en een blokkering verbergt niemand op de ranglijsten.',
            '**Meldingen afhandelen:** de exploitant van het spel beoordeelt elke melding binnen 48 uur. De exploitant kan een aanstootgevende naam vervangen door een tijdelijke (de speler wordt dan gevraagd een nieuwe naam te kiezen), of een account schorsen voor ranked spellen en accountwijzigingen. Elke zulke actie wordt vastgelegd in een intern logboek, met het adres van de beheerder die haar uitvoerde, en met de oude en de nieuwe naam als een naam werd vervangen. Een naam die zo is vervangen, komt op een lijst van namen die niemand meer mag kiezen (alleen de naam, aan geen enkele speler gekoppeld).',
            '**Een geschorst account dat wordt verwijderd:** het verwijderen van een account heft een schorsing niet op. Als een geschorst account wordt verwijderd, bewaren we een onomkeerbare vingerafdruk (een hash) van de inlog-ID en van het geverifieerde e-mailadres, niet de ID of het adres zelf. Een nieuw account met dezelfde inloggegevens begint geschorst tot een beheerder het beoordeelt, en de vingerafdruk wordt dan verwijderd. Dit is ons gerechtvaardigd belang, en dat van elke speler, bij eerlijk spel.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Waarom we de gegevens gebruiken',
      blocks: [
        {
          list: [
            '**Om het spel te laten draaien:** je account, spellen, ratings, matchmaking, geschiedenis en ranglijsten. Dit is nodig voor onze overeenkomst met jou (de Gebruiksvoorwaarden).',
            '**Beveiliging en eerlijk spel:** limieten op het aantal verzoeken, afwijkingen opsporen, valsspelen voorkomen, en meldingen en blokkeringen afhandelen. Dit is ons gerechtvaardigd belang, en dat van elke speler.',
            '**Om het spel te verbeteren:** om te leren welke schermen en modi worden gespeeld, problemen te vinden en crashes te verhelpen. Ook een gerechtvaardigd belang, zonder advertenties en zonder marketingprofiel.',
            '**Servicemails:** alleen voor het verifiëren van het adres en het opnieuw instellen van het wachtwoord.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Met wie we ze delen',
      blocks: [
        'We **verkopen geen** gegevens, en we geven ze niet door aan adverteerders of databrokers. Onze dienstverleners verwerken ze uitsluitend voor ons:',
        {
          list: [
            '**Google (Firebase):** inloggen (Authentication, inclusief inloggen met Google), crashrapporten (Crashlytics) en gebruiksgegevens (Analytics).',
            '**Fly.io:** hosting van de server.',
            '**Neon:** de database (PostgreSQL).',
            '**Sentry:** rapporten van serverfouten.',
          ],
        },
        'We geven gegevens ook vrij als de wet dat vereist, of om het spel en de spelers te beschermen. Als het spel overgaat naar een andere eigenaar, gaan de gegevens mee, en blijft dit beleid erop van toepassing.',
      ],
    },
    {
      id: 'transfers',
      title: 'Waar de gegevens zijn',
      blocks: [
        'De server en de database staan momenteel in de Europese Unie (Frankfurt, Duitsland). Google en Sentry kunnen gegevens ook verwerken in de Verenigde Staten en andere landen, met hun eigen waarborgen voor de doorgifte van gegevens (zoals de modelcontractbepalingen van de EU).',
      ],
    },
    {
      id: 'retention',
      title: 'Hoe lang we ze bewaren',
      blocks: [
        {
          list: [
            '**Accountgegevens:** zolang het account bestaat.',
            '**Als je je account verwijdert:** je e-mailadres, land, avatar en de koppeling met je inloggegevens worden direct verwijderd, en je weergavenaam wordt vervangen door een anonieme ID (de oude naam is direct weer vrij). Je inloggegevens bij Firebase worden ook verwijderd, met wat Firebase van Google had bewaard. Als je met Google inlogde, trekt de app ook de toegang in die ze tot je Google-account had gekregen.',
            '**Voortgang in oefenen in etappes:** de kopie op de server (je sterren per etappe, en de XP die de etappes per dag opleverden) wordt samen met het account verwijderd. De kopie op je telefoon blijft tot je de app verwijdert.',
            '**Wat na verwijdering anoniem blijft:** ranked spellen, ratings, XP, oefenresultaten, gegevens over eerlijk spel, meldingen die je hebt gedaan en gebruiksgegevens. Ze zijn niet meer aan jou gekoppeld, maar de spellen, herhalingen en ranglijsten van andere spelers blijven compleet.',
            '**Meldingen, blokkeringen en het beheerderslogboek:** een blokkering wordt bewaard tot je die opheft of je account verwijdert (dan verdwijnen al zijn blokkeringen, in beide richtingen). Meldingen en het logboek van beheerdersacties worden bewaard zolang ze nodig zijn om meldingen af te handelen en het spel veilig en eerlijk te houden; we controleren ze af en toe en verwijderen oude. Als een account wordt verwijderd, worden openstaande meldingen erover gesloten, en worden de namen ervan uit het beheerderslogboek verwijderd. Als het geschorst was, blijft alleen de hierboven beschreven onomkeerbare vingerafdruk over, tot er een nieuw account met dezelfde inloggegevens wordt aangemaakt of tot we die bij een periodieke controle verwijderen.',
            '**Gebruiksgegevens:** bewaard zolang ze ons helpen te begrijpen hoe het spel wordt gebruikt. We controleren ze af en toe en verwijderen oude gegevens.',
            '**Crashlytics:** Google bewaart crashrapporten tot 90 dagen. **Analytics:** gedurende de bewaartermijn die we in Firebase hebben ingesteld.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Je rechten',
      blocks: [
        'Je kunt vragen om je gegevens in te zien, te corrigeren (je naam, avatar en land kun je in de app wijzigen), te verwijderen (verwijder je account in de app) of bezwaar te maken tegen het gebruik ervan. Mail ons op {email}, dan antwoorden we binnen 30 dagen.',
        'Je kunt ook een klacht indienen bij de Israëlische toezichthouder voor privacybescherming (Privacy Protection Authority), of bij de gegevensbeschermingsautoriteit van je land.',
      ],
    },
    {
      id: 'children',
      title: 'Kinderen',
      blocks: [
        'Het spel is niet bedoeld voor kinderen jonger dan 13, en we verzamelen niet bewust gegevens over hen. Als we ontdekken dat een kind jonger dan 13 een account heeft geopend, verwijderen we dat. Waar de minimumleeftijd hoger is, is tot die leeftijd toestemming van een ouder nodig.',
      ],
    },
    {
      id: 'security',
      title: 'Beveiliging',
      blocks: [
        'Het verkeer tussen de app en de server is versleuteld (HTTPS en WSS). Wachtwoorden worden verwerkt door Firebase en niet door ons opgeslagen. Toegang tot de gegevens op de server is beperkt tot de exploitant van het spel. Geen enkel systeem is volkomen veilig, maar we doen redelijke inspanningen om je gegevens te beschermen.',
      ],
    },
    {
      id: 'changes',
      title: 'Wijzigingen in dit beleid',
      blocks: [
        'Als dit beleid verandert, passen we de datum hier aan. Belangrijke wijzigingen kondigen we ook aan in de app.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: ['{operator} · {email}', 'Zie ook de [Gebruiksvoorwaarden](terms).'],
    },
  ],
};

export const TERMS_NL: LegalDoc = {
  title: 'Gebruiksvoorwaarden',
  lead: 'De regels voor het gebruik van Sudoku Fight. Als je het spel gebruikt, ga je ermee akkoord.',
  sections: [
    {
      id: 'acceptance',
      title: 'Aanvaarding',
      blocks: [
        'Deze voorwaarden gelden voor de app Sudoku Fight en de bijbehorende diensten (“het spel”), geëxploiteerd door {operator} (“we”). Door je te registreren of het spel te gebruiken, aanvaard je deze voorwaarden en het [Privacybeleid](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Wie mag spelen',
      blocks: [
        'Je moet minstens 13 jaar oud zijn, of de minimumleeftijd hebben die de wet van je land vastlegt als die hoger is. Ben je jonger dan 18, dan heb je toestemming nodig van een ouder of voogd.',
      ],
    },
    {
      id: 'account',
      title: 'Je account',
      blocks: [
        {
          list: [
            'Eén account per persoon, met je eigen e-mailadres.',
            'Houd je wachtwoord (of het Google-account waarmee je inlogt) veilig. Je bent verantwoordelijk voor alles wat er met je account gebeurt.',
            'Je kunt je account op elk moment in de app verwijderen: Instellingen → Account verwijderen.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Weergavenamen en gedrag',
      blocks: [
        'Je weergavenaam, avatar en land zijn zichtbaar voor alle spelers. Een naam mag niet:',
        {
          list: [
            'aanstootgevend, racistisch, seksueel, bedreigend of beledigend zijn;',
            'zich uitgeven voor een andere persoon, een andere speler of medewerkers van het spel;',
            'persoonsgegevens (een telefoonnummer, een adres), reclame of een link bevatten.',
          ],
        },
        'Namen worden automatisch gecontroleerd aan de hand van een lijst met verboden woorden. We kunnen een naam die deze regels overtreedt wijzigen, om een nieuwe naam vragen of het account schorsen.',
        'Reacties in het spel zijn emoji uit een vaste lijst. Tijdens een spel kun je een tegenstander via de spelerskaart dempen, blokkeren of melden (volgende sectie).',
      ],
    },
    {
      id: 'reports',
      title: 'Melden en blokkeren',
      blocks: [
        'Je kunt een speler melden via de spelerskaart of vanuit het spel, met een van drie redenen: aanstootgevende naam, valsspelen of anders. **We beoordelen elke melding binnen 48 uur.**',
        'Als de regels zijn overtreden, kunnen we de naam vervangen door een tijdelijke (de speler wordt dan gevraagd een nieuwe naam te kiezen, en de regel van 30 dagen geldt niet voor die keuze), het account schorsen voor ranked spellen en accountwijzigingen tot de schorsing wordt opgeheven, of het account sluiten. Een naam die zo is vervangen, kan niet opnieuw worden gekozen. Een geschorst account kan nog steeds op elk moment worden verwijderd, maar het verwijderen heft de schorsing niet op: een nieuw account met dezelfde inloggegevens begint geschorst tot we het beoordelen.',
        'Je kunt een speler ook blokkeren: je komt dan niet met die speler in hetzelfde spel, en de reacties van die speler worden niet aan je getoond. Een blokkering hef je op via Instellingen → Geblokkeerde spelers. Een blokkering verbergt niemand op de ranglijsten.',
        'Meld niet zonder reden: herhaalde valse meldingen zijn in strijd met deze voorwaarden.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Eerlijk spel',
      blocks: [
        'Je mag niet:',
        {
          list: [
            'sudokuoplossers, bots, scripts, automatisering of een aangepaste app gebruiken;',
            'meerdere accounts aanhouden om ratings te beïnvloeden, uitslagen afspreken met een andere speler, of met opzet verliezen;',
            'bugs misbruiken in plaats van ze te melden;',
            'onze servers overbelasten, proberen erin in te breken, of andere spelers hinderen.',
          ],
        },
        'De server markeert ongewone spellen voor controle. Als de regels zijn overtreden, kunnen we resultaten ongeldig verklaren, ratings resetten, of het account schorsen en sluiten.',
      ],
    },
    {
      id: 'virtual',
      title: 'Ratings, XP en prestaties',
      blocks: [
        'Ratings, XP, niveaus en prestaties hebben geen geldwaarde, en kunnen niet worden overgedragen of verkocht. We kunnen wijzigen hoe ze worden berekend, of ze resetten (bijvoorbeeld aan het begin van een seizoen).',
        'Het spel is gratis. Deze versie heeft geen aankopen en geen advertenties.',
      ],
    },
    {
      id: 'service',
      title: 'Beschikbaarheid',
      blocks: [
        'Voor ranked spellen is een internetverbinding nodig. Als er geen spelers beschikbaar zijn, kun je worden gekoppeld aan een computergestuurde tegenstander die in een tempo speelt dat lijkt op het jouwe. Zulke spellen tellen mee voor je rating. Het spel kan ook een oefenspel tegen een bot aanbieden, zonder rating. Als de server tijdens een ranked spel opnieuw opstart, eindigt dat spel zonder dat je rating verandert.',
        'We kunnen onderdelen van het spel wijzigen, onderbreken of stopzetten, en we proberen belangrijke wijzigingen vooraf aan te kondigen.',
      ],
    },
    {
      id: 'ip',
      title: 'Intellectueel eigendom',
      blocks: [
        'Het spel, het ontwerp, de code, de geluiden en de avatars zijn van ons of van wie ons er een licentie voor heeft gegeven. We geven je een persoonlijke, niet-exclusieve, niet-commerciële licentie om het spel onder deze voorwaarden te gebruiken. Licenties van derden staan in de app: Instellingen → Licenties.',
      ],
    },
    {
      id: 'stores',
      title: 'Appwinkels',
      blocks: [
        'Apple en Google zijn geen partij bij deze voorwaarden en zijn niet verantwoordelijk voor het spel. Als je het spel uit de App Store hebt gedownload, geldt ook de standaard-licentieovereenkomst voor eindgebruikers (EULA) van Apple, en kunnen Apple en haar dochterondernemingen deze voorwaarden als derde-begunstigden afdwingen.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Uitsluiting van aansprakelijkheid',
      blocks: [
        'Het spel wordt aangeboden “zoals het is”. Voor zover de wet dat toestaat, garanderen we niet dat het zonder onderbrekingen of fouten werkt, en zijn we niet aansprakelijk voor indirecte schade, verloren gegevens of verloren ratings. Niets in deze voorwaarden beperkt rechten die de wet je geeft en waarvan geen afstand kan worden gedaan.',
      ],
    },
    {
      id: 'termination',
      title: 'Beëindiging',
      blocks: [
        'Je kunt op elk moment stoppen met spelen en je account verwijderen. We kunnen een account dat deze voorwaarden overtreedt schorsen of sluiten.',
      ],
    },
    {
      id: 'changes',
      title: 'Wijzigingen in deze voorwaarden',
      blocks: [
        'Als deze voorwaarden veranderen, passen we de datum hier aan. Belangrijke wijzigingen kondigen we ook aan in de app. Als je het spel na een wijziging blijft gebruiken, aanvaard je de nieuwe voorwaarden.',
      ],
    },
    {
      id: 'law',
      title: 'Toepasselijk recht',
      blocks: [
        'Op deze voorwaarden is het recht van de Staat Israël van toepassing, en de bevoegde rechtbanken van het district Tel Aviv zijn exclusief bevoegd, tenzij de wet van je land je een recht geeft waarvan geen afstand kan worden gedaan.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_NL: LegalDoc = {
  title: 'Je account verwijderen',
  lead: 'Hoe je je account bij Sudoku Fight verwijdert, en wat er met je gegevens gebeurt.',
  sections: [
    {
      id: 'in-app',
      title: 'In de app (direct)',
      blocks: [
        {
          list: [
            'Open Sudoku Fight en ga naar **Instellingen**.',
            'Tik op **Account verwijderen** en bevestig.',
            'Voer je wachtwoord in, of kies opnieuw je Google-account als je met Google inlogt. Het account wordt direct verwijderd, en de app gaat terug naar het inlogscherm.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Zonder de app',
      blocks: [
        'Mail ons op {email} **vanaf het e-mailadres van je account**, met als onderwerp “Mijn account verwijderen” en met je weergavenaam. We controleren of het verzoek van de eigenaar van het account komt, en verwijderen het account binnen 30 dagen. Zodra dat is gebeurd, bevestigen we het per e-mail.',
      ],
    },
    {
      id: 'what',
      title: 'Wat wordt verwijderd en wat blijft',
      blocks: [
        {
          list: [
            '**Direct verwijderd:** je e-mailadres, land, avatar, je inloggegevens (ook bij Firebase), en de koppeling tussen je account en je installaties. Je weergavenaam wordt vervangen door een anonieme ID en is vrij voor anderen.',
            '**Anoniem bewaard:** ranked spellen, ratings, XP, oefenresultaten, gegevens over eerlijk spel en gebruiksgegevens. Ze zijn niet meer aan jou gekoppeld, maar de spellen en ranglijsten van andere spelers blijven compleet.',
            '**Op je telefoon:** de oefenspellen op je telefoon blijven daar tot je de app verwijdert.',
            '**Bij Google:** crashrapporten worden tot 90 dagen bewaard, en gegevens van Analytics gedurende de ingestelde bewaartermijn.',
          ],
        },
        'Meer in het [Privacybeleid](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_NL: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_NL,
  terms: TERMS_NL,
  'delete-account': DELETE_ACCOUNT_NL,
};
