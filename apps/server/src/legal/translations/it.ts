import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Italian (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). Italian, tu (docs/i18n/style/it.md); terms from
 * docs/i18n/glossary.csv (partita, avversario, punteggio = rating, punti = points of one game, classificata,
 * stanza, casella, griglia, segnalazione, blocco, disturbo, allenamento, fase, livello, replay, reazione).
 * Quotation marks «…» throughout, apostrophe ’, no space before a colon or a question mark. No word agrees with
 * the reader's gender (avere, nouns, or an impersonal turn instead of a participle with essere). The page opens
 * with TRANSLATION_NOTICE_IT: the English version prevails.
 *
 * App labels quoted here (they must equal the app's it strings): Impostazioni (home:settings.title),
 * Elimina account (account:settings.deleteAccount), Giocatori bloccati (moderation:blocked.settingsRow),
 * Licenze (home:settings.licenses), avversari recenti (progress:leaderboard.caption.friends, "I tuoi avversari
 * recenti"). Staged practice is «allenamento a fasi»; achievements are «traguardi» (progress:achievements.title)
 * and a stage’s spots «obiettivi» (levels:scale.spots_other), as in the app.
 *
 * A registration step is a "passaggio" here, never a "fase": fase is a stage of staged practice, in the same
 * events table. A crash or error report is a "rapporto", never a "segnalazione" (a report on a player).
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_IT =
  'Questa è una traduzione della versione inglese. In caso di discrepanze, prevale la versione inglese.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_IT: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Lingua',
  contents: 'Indice',
  documents: 'Documenti',
  updated: 'Ultimo aggiornamento:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[nome del gestore]',
  draft: 'Bozza: i recapiti non sono ancora impostati sul server (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_IT,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `it`): [what happens, what it carries]. */
export const EVENT_DETAILS_IT: Record<TelemetryEventName, [string, string]> = {
  app_open: ['L’app si apre', '—'],
  screen_view: [
    'Si apre una schermata',
    'Il nome della schermata (il suo modello di percorso, senza identificativi)',
  ],
  register_step: ['Si apre un passaggio della registrazione', 'Il passaggio'],
  register_complete: ['La registrazione è completata', '—'],
  game_start: [
    'Inizia una partita',
    'La modalità, il tipo di partita, il numero di giocatori e se è una partita con amici',
  ],
  game_end: [
    'Finisce una partita',
    'La modalità, il risultato, i punti, il numero di errori, la durata e se era una partita con amici',
  ],
  interference_sent: ['Invii un disturbo', 'Il suo tipo e il suo costo'],
  reaction_sent: ['Invii una reazione', 'Quale emoji'],
  matchmaking_wait: [
    'Termina una ricerca di avversari',
    'I secondi di attesa, e se è stata trovata una partita',
  ],
  reconnect: ['Riconnessione dopo un’interruzione', 'Quanto tempo ci è voluto, e se ha funzionato'],
  latency_sample: [
    'Una misurazione della qualità della connessione',
    'I tempi di risposta della rete, in millisecondi',
  ],
  replay_open: ['Si apre un replay', 'La modalità della partita'],
  account_delete: ['L’account viene eliminato', '—'],
  report_sent: ['Segnali un giocatore', 'Solo il motivo (non chi è stato segnalato, né la partita)'],
  level_map_open: ['Si apre la mappa dell’allenamento a fasi', 'La fase attuale e il tuo totale di stelle'],
  level_start: [
    'Inizia una fase',
    'Il numero e la versione della fase, il suo capitolo e il suo tipo, il numero del tentativo, le tue migliori stelle fino a quel momento, e se è stato un avvio rapido',
  ],
  level_end: [
    'Finisce una fase',
    'Il numero, la versione e il tipo della fase, le stelle, le tue migliori stelle prima di essa, la sua durata, come è finita, il numero di errori, il risultato (tempo, obiettivi, vantaggio o punti), il livello del bot e il numero del tentativo',
  ],
  level_quit: [
    'Una fase viene lasciata a metà (per esempio, l’app è stata chiusa)',
    'Il numero e la versione della fase, e da quanto tempo era in corso',
  ],
  chapter_gate: [
    'Un tentativo al cancello verso il capitolo successivo',
    'Il capitolo dietro il cancello, le stelle nel capitolo, e se il cancello si è aperto',
  ],
  level_tutorial: ['Viene mostrato il «come si gioca» di un tipo di fase', 'Il tipo, e se lo hai saltato'],
  friends_room_open: [
    'Viene aperta una stanza per giocare con gli amici',
    'Il tipo di partita, e come è stata aperta la stanza',
  ],
  friends_room_join: [
    'Un tentativo di entrare nella stanza di amici',
    'Come (con un codice o un link), e com’è andata a finire (riuscito, o perché non è riuscito)',
  ],
  friends_invite_share: [
    'Viene condiviso il link di una stanza',
    'Se l’ha condiviso l’host o un invitato (non il codice, né con chi)',
  ],
  friends_link_open: ['Il link di una stanza apre l’app', 'Se avevi effettuato l’accesso'],
  friends_room_start: [
    'Inizia una partita con amici',
    'Il numero di giocatori, e quanti secondi hai aspettato nella stanza',
  ],
  friends_room_close: [
    'Non sei più in una stanza prima che la sua partita inizi',
    'Il motivo, quanti giocatori c’erano nella stanza, e quanti secondi hai aspettato',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_IT) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_IT[name],
  ]);

export const PRIVACY_IT: LegalDoc = {
  title: 'Informativa sulla privacy',
  lead: 'Cosa raccoglie Sudoku Fight, perché, chi lo vede, per quanto tempo viene conservato e come eliminarlo.',
  sections: [
    {
      id: 'who',
      title: 'Chi siamo',
      blocks: [
        'Sudoku Fight («il gioco», «noi») è un gioco di sudoku competitivo in tempo reale gestito da {operator}.',
        'Per qualsiasi domanda sulla privacy e sui tuoi dati, scrivici a {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'In breve',
      blocks: [
        {
          list: [
            'Raccogliamo solo ciò che serve per far funzionare il gioco: i dati del tuo account, le tue partite e i dati di utilizzo che ci aiutano a capire come si gioca e a risolvere i problemi.',
            '**Niente pubblicità, e non vendiamo dati.** Non ti tracciamo su altre app o siti web.',
            'Il tuo nome visualizzato, l’avatar, il Paese, i punteggi e le statistiche sono visibili agli altri giocatori. La tua email non viene mai mostrata agli altri giocatori.',
            'Puoi eliminare il tuo account nell’app in qualsiasi momento: Impostazioni → Elimina account. Vedi la [pagina sull’eliminazione dell’account](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Dati dell’account',
      blocks: [
        'Quando ti registri conserviamo:',
        {
          list: [
            '**Email:** per accedere, verificare l’indirizzo, reimpostare la password e inviarti messaggi sull’account. Non inviamo email di marketing.',
            '**Password** (quando ti registri con email e password): è gestita da Firebase Authentication di Google. Non arriva mai ai nostri server e non possiamo vederla.',
            '**Accesso con Google (facoltativo):** puoi registrarti e accedere con il tuo account Google invece che con email e password. Firebase Authentication riceve allora da Google l’email del tuo account Google (verificata da Google) e il suo ID Google, e li conserva insieme al tuo accesso; noi conserviamo l’email come per qualsiasi account. Google fornisce a Firebase anche il tuo nome Google e la tua foto del profilo, che Firebase conserva insieme all’accesso. Il nostro server non li memorizza né li mostra: nell’arena compaiono solo il nome e l’avatar che scegli tu. Non riceviamo mai la tua password Google, né l’accesso a nient’altro del tuo account Google (contatti, email, file). Se preferisci, registrati con email e password.',
            '**Nome visualizzato, Paese e avatar:** li scegli tu e vengono mostrati agli altri giocatori. Il Paese lo selezioni tu (quello predefinito deriva dalle impostazioni di lingua e area geografica del tuo dispositivo). Non usiamo la posizione del tuo dispositivo.',
            '**Quando è stato creato l’account e quando è stato cambiato l’ultima volta il nome** (il nome si può cambiare una volta ogni 30 giorni).',
            '**Il nostro ID dell’account**, e il tuo ID di accesso Firebase (con l’accesso con Google, Firebase conserva anche l’ID del tuo account Google).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Partite e progressi',
      blocks: [
        {
          list: [
            '**Partite classificate** (conservate sul server): la griglia, ogni mossa con i suoi tempi, i disturbi e le reazioni che hai inviato, i tuoi punti, gli errori, il piazzamento, il punteggio prima e dopo, e come è finita la partita. Formano la tua cronologia, i replay e le statistiche.',
            '**Partite con amici** (in una stanza con un codice; conservate sul server come una partita classificata, ma senza punteggio): gli stessi dati, tranne il punteggio. Compaiono nella tua cronologia e nei replay, e i giocatori con cui hai giocato compaiono tra gli «avversari recenti». Il codice della stanza, chi è nella stanza e chi ne è stato rimosso vengono conservati solo nella memoria del server, fino alla chiusura della stanza.',
            '**Punteggi, XP, livello e traguardi.**',
            '**Quali griglie hai giocato, e contro chi:** così non ti capitano di continuo la stessa griglia o lo stesso avversario.',
            '**Il tuo ritmo:** alla fine di ogni partita classificata calcoliamo, in base alle tue mosse, il tuo tempo medio per mossa (tenendo conto di quanto era difficile ogni casella), e lo conserviamo con la partita, insieme al numero di mosse su cui è stato misurato. In base al ritmo, al tuo tasso di errori e ai tuoi risultati contro avversari controllati dal computer, impostiamo il ritmo di un avversario controllato dal computer quando non ci sono giocatori disponibili (vedi i [Termini di utilizzo](terms)). Il tuo ritmo non viene mostrato agli altri giocatori.',
            '**Risultati degli allenamenti** (in solitario o contro un bot), quando l’app li comunica per gli XP: modalità, tipo di partita, esito, numero di mosse corrette, quando è finito e gli XP ottenuti.',
            '**Allenamento a fasi:** quando l’app sincronizza i tuoi progressi con il tuo account (così li ritrovi anche su un nuovo telefono): le tue migliori stelle in ogni fase, quante volte l’hai giocata e quando è cambiato, e gli XP che le fasi ti hanno dato ogni giorno.',
            '**Fair play:** quando il ritmo delle mosse in una partita classificata è insolitamente veloce, viene conservata un’annotazione che una persona dovrà esaminare. Non succede nulla in automatico per questo motivo.',
            '**Segnalazioni e blocchi:** vedi «Segnalazioni e blocchi» più avanti.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Dati di utilizzo',
      blocks: [
        'Per capire come viene usato il gioco, l’app comunica degli eventi al nostro server. Ogni evento ha un proprio ID casuale e l’ora del tuo telefono; il server aggiunge l’ora in cui l’ha ricevuto.',
        'Ogni comunicazione contiene anche un **ID di installazione**: un numero casuale creato al primo avvio e conservato nell’app. Non si basa sui dati del tuo dispositivo, e scompare quando disinstalli l’app. Insieme a esso vengono inviati il sistema (iOS o Android) e la versione dell’app.',
        'Mentre l’accesso al tuo account è attivo, gli eventi e l’installazione sono collegati al tuo account. Senza connessione, gli eventi restano in attesa sul tuo telefono e vengono inviati più tardi.',
        'Gli eventi:',
        { table: { head: ['Evento', 'Quando', 'Cosa contiene'], rows: eventRows() } },
        'Gli stessi eventi vanno anche a **Google Analytics for Firebase**, che aggiunge un ID dell’installazione dell’app, dati del dispositivo e del sistema, dati di utilizzo (come la durata della sessione) e una posizione approssimativa (Paese e regione) che Google deduce dall’indirizzo IP. Lo abbiamo configurato senza funzionalità pubblicitarie: nessun ID pubblicitario e nessuna personalizzazione degli annunci.',
      ],
    },
    {
      id: 'crashes',
      title: 'Rapporti su arresti anomali ed errori',
      blocks: [
        {
          list: [
            '**Nell’app, Firebase Crashlytics di Google:** quando l’app si arresta in modo anomalo o incontra un errore, viene inviato un rapporto con i dettagli dell’errore, il modello del dispositivo, le versioni del sistema e dell’app, un ID di installazione di Crashlytics e, mentre l’accesso al tuo account è attivo, il nostro ID dell’account. Non la tua email né il tuo nome.',
            '**Sul server, Sentry:** quando il server incontra un errore, viene inviato un rapporto tecnico che lo riguarda, a volte con l’ID dell’account coinvolto. Nessuna email e nessuna password.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Indirizzo IP',
      blocks: [
        'Quando l’app si connette, il nostro server vede il tuo indirizzo IP. Lo usiamo **solo nella memoria del server**, per limitare la frequenza delle richieste e proteggerci da ondate di richieste, e non lo memorizziamo nel nostro database.',
        'Il nostro fornitore di hosting può conservare per un breve periodo i normali log di accesso.',
      ],
    },
    {
      id: 'device',
      title: 'Cosa resta solo sul tuo telefono',
      blocks: [
        {
          list: [
            'Le tue partite di allenamento e la loro cronologia.',
            'I tuoi progressi nell’allenamento a fasi: stelle, tentativi e i cancelli che hai aperto (una copia è conservata anche sul server: vedi «Partite e progressi»).',
            'Le tue impostazioni: suono, vibrazione, riduzione del movimento e lingua.',
            'Una copia del tuo profilo, così l’app si apre anche senza connessione.',
            'Le code di eventi e di risultati degli allenamenti non ancora inviati, e l’ID di installazione.',
            'Il tuo accesso (conservato da Firebase) e, con l’accesso con Google, l’account che hai scelto (conservato da Google Play Services finché non esci dall’account).',
          ],
        },
        'Tutto questo viene eliminato quando disinstalli l’app. Uscire dall’account elimina la copia del profilo. Eliminare l’account non elimina le partite di allenamento e i progressi nell’allenamento a fasi che si trovano sul tuo telefono: per eliminare anche quelli, disinstalla l’app.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Cosa non raccogliamo',
      blocks: [
        'Contatti, foto, microfono, fotocamera, posizione precisa, ID pubblicitari e dati di pagamento. Il gioco non ha una chat: le reazioni sono emoji di un elenco fisso.',
      ],
    },
    {
      id: 'public',
      title: 'Cosa vedono gli altri giocatori',
      blocks: [
        {
          list: [
            'Il tuo nome visualizzato, l’avatar, il Paese (come bandiera), i punteggi, il livello e i traguardi.',
            'Sulla tua scheda giocatore e nelle classifiche: numero di partite, percentuale di vittorie, serie, mossa migliore, media degli errori, risultati recenti, il disturbo che invii più spesso e la data di iscrizione (mese e anno).',
            'Durante una partita: i tuoi punti, gli errori, i disturbi e le reazioni, e se sei online.',
            'In una stanza per giocare con gli amici: chiunque abbia il suo codice o il suo link ed entri nella stanza vede il nome, l’avatar, la bandiera e il punteggio generale di tutti quelli che ci sono, e se sono nella stanza in quel momento. Il codice e il link di per sé non contengono informazioni personali.',
            'Replay e dettagli della partita: solo i giocatori di quella partita.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Segnalazioni e blocchi',
      blocks: [
        {
          list: [
            '**Segnalare un giocatore:** quando segnali qualcuno, conserviamo chi ha fatto la segnalazione, chi è stato segnalato, il motivo (nome offensivo, imbroglio o altro), la partita classificata se la segnalazione è partita da lì, e quando. Una segnalazione non contiene testo libero. Al giocatore segnalato non viene detto chi lo ha segnalato.',
            '**Bloccare un giocatore:** conserviamo i giocatori che hai bloccato e quando. Per effetto del blocco non finisci nella stessa partita con loro, e le loro reazioni non ti vengono mostrate. Nessuno riceve un avviso del blocco, e un blocco non nasconde nessuno dalle classifiche.',
            '**Gestione delle segnalazioni:** il gestore del gioco esamina ogni segnalazione entro 48 ore. Può sostituire un nome offensivo con uno temporaneo (al giocatore viene quindi chiesto di scegliere un nuovo nome), oppure sospendere un account dalle partite classificate e dalle modifiche all’account. Ogni intervento di questo tipo finisce in un registro interno, con l’indirizzo dell’amministratore che lo ha eseguito, e con il vecchio e il nuovo nome quando un nome è stato sostituito. Un nome sostituito in questo modo finisce in un elenco di nomi che nessuno può più scegliere (solo il nome, non collegato a nessun giocatore).',
            '**Un account sospeso che viene eliminato:** eliminare un account non revoca una sospensione. Quando un account sospeso viene eliminato, conserviamo un’impronta unidirezionale (un hash) del suo ID di accesso e del suo indirizzo email verificato, non l’ID o l’indirizzo stessi. Un nuovo account con lo stesso accesso parte sospeso finché un amministratore non lo esamina, e a quel punto l’impronta viene eliminata. Questo è un nostro legittimo interesse, e di ogni giocatore, al fair play.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Perché usiamo i dati',
      blocks: [
        {
          list: [
            '**Per far funzionare il gioco:** il tuo account, le partite, i punteggi, l’abbinamento con gli avversari, la cronologia e le classifiche. Questo è necessario per il nostro accordo con te (i Termini di utilizzo).',
            '**Sicurezza e fair play:** limiti di frequenza, individuazione di anomalie, prevenzione degli imbrogli e gestione di segnalazioni e blocchi. Questo è un nostro legittimo interesse, e di ogni giocatore.',
            '**Per migliorare il gioco:** per capire quali schermate e modalità vengono giocate, trovare problemi e correggere gli arresti anomali. Anche questo è un legittimo interesse, senza pubblicità e senza profili di marketing.',
            '**Email di servizio:** solo verifica dell’indirizzo e reimpostazione della password.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Con chi li condividiamo',
      blocks: [
        '**Non vendiamo** dati, e non li cediamo a inserzionisti o a data broker. I nostri fornitori di servizi li trattano solo per nostro conto:',
        {
          list: [
            '**Google (Firebase):** accesso (Authentication, compreso l’accesso con Google), rapporti sugli arresti anomali (Crashlytics) e dati di utilizzo (Analytics).',
            '**Fly.io:** hosting del server.',
            '**Neon:** il database (PostgreSQL).',
            '**Sentry:** rapporti sugli errori del server.',
          ],
        },
        'Comunicheremo i dati anche quando la legge lo richiede, o per proteggere il gioco e i suoi giocatori. Se il gioco passa a un altro proprietario, i dati passano con esso, e questa informativa continua ad applicarsi a essi.',
      ],
    },
    {
      id: 'transfers',
      title: 'Dove si trovano i dati',
      blocks: [
        'Il server e il database si trovano attualmente nell’Unione Europea (Francoforte, Germania). Google e Sentry possono trattare i dati anche negli Stati Uniti e in altri Paesi, con le proprie garanzie per i trasferimenti di dati (come le Clausole contrattuali standard dell’UE).',
      ],
    },
    {
      id: 'retention',
      title: 'Per quanto tempo li conserviamo',
      blocks: [
        {
          list: [
            '**Dati dell’account:** finché l’account esiste.',
            '**Quando elimini il tuo account:** la tua email, il Paese, l’avatar e il collegamento di accesso vengono eliminati subito, e il tuo nome visualizzato viene sostituito da un identificativo anonimo (il vecchio nome torna subito libero). Viene eliminato anche il tuo accesso Firebase, con ciò che aveva conservato da Google. Se accedevi con Google, l’app revoca anche l’accesso al tuo account Google che le era stato concesso.',
            '**Progressi nell’allenamento a fasi:** la copia sul server (le tue stelle in ogni fase e gli XP che le fasi ti hanno dato ogni giorno) viene eliminata insieme all’account. La copia sul tuo telefono resta finché non disinstalli l’app.',
            '**Cosa resta dopo l’eliminazione, in forma anonima:** partite classificate, punteggi, XP, risultati degli allenamenti, annotazioni di fair play, segnalazioni che hai inviato e dati di utilizzo. Non sono più collegati a te, ma le partite, i replay e le classifiche degli altri giocatori restano completi.',
            '**Segnalazioni, blocchi e registro degli amministratori:** un blocco viene conservato finché non lo revochi o non elimini il tuo account (allora vengono eliminati tutti i suoi blocchi, in entrambe le direzioni). Le segnalazioni e il registro degli interventi degli amministratori vengono conservati finché servono per gestire le segnalazioni e mantenere il gioco sicuro e leale; li esaminiamo periodicamente ed eliminiamo quelli vecchi. Quando un account viene eliminato, le segnalazioni aperte che lo riguardano vengono chiuse, e i suoi nomi vengono rimossi dal registro degli amministratori. Se era sospeso, resta solo l’impronta unidirezionale descritta sopra, finché non viene creato un nuovo account con lo stesso accesso o finché non la eliminiamo in una revisione periodica.',
            '**Dati di utilizzo:** conservati finché ci aiutano a capire come viene usato il gioco. Li esaminiamo periodicamente ed eliminiamo i dati vecchi.',
            '**Crashlytics:** Google conserva i rapporti sugli arresti anomali per un massimo di 90 giorni. **Analytics:** per il periodo di conservazione che abbiamo impostato in Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'I tuoi diritti',
      blocks: [
        'Puoi chiedere di vedere i tuoi dati, di correggerli (puoi cambiare nome, avatar e Paese nell’app), di eliminarli (elimina il tuo account nell’app) o di opporti al loro utilizzo. Scrivici a {email}, e ti risponderemo entro 30 giorni.',
        'Puoi anche presentare un reclamo all’Autorità per la protezione della privacy di Israele, o all’autorità per la protezione dei dati del tuo Paese.',
      ],
    },
    {
      id: 'children',
      title: 'Minori',
      blocks: [
        'Il gioco non è destinato ai minori di 13 anni, e non raccogliamo consapevolmente dati che li riguardano. Se veniamo a sapere che un minore di 13 anni ha aperto un account, lo elimineremo. Dove l’età minima è più alta, fino a quell’età serve il consenso di un genitore.',
      ],
    },
    {
      id: 'security',
      title: 'Sicurezza',
      blocks: [
        'Il traffico tra l’app e il server è crittografato (HTTPS e WSS). Le password sono gestite da Firebase e non vengono conservate da noi. L’accesso ai dati sul server è limitato al gestore del gioco. Nessun sistema è perfettamente sicuro, ma ci impegniamo in modo ragionevole per proteggere i tuoi dati.',
      ],
    },
    {
      id: 'changes',
      title: 'Modifiche a questa informativa',
      blocks: [
        'Quando questa informativa cambia, aggiorniamo qui la data. Annunceremo inoltre nell’app le modifiche sostanziali.',
      ],
    },
    {
      id: 'contact',
      title: 'Contatti',
      blocks: ['{operator} · {email}', 'Vedi anche i [Termini di utilizzo](terms).'],
    },
  ],
};

export const TERMS_IT: LegalDoc = {
  title: 'Termini di utilizzo',
  lead: 'Le regole per usare Sudoku Fight. Usando il gioco, le accetti.',
  sections: [
    {
      id: 'acceptance',
      title: 'Accettazione',
      blocks: [
        'Questi termini si applicano all’app Sudoku Fight e ai suoi servizi («il gioco»), gestiti da {operator} («noi»). Registrandoti o usando il gioco accetti questi termini e l’[Informativa sulla privacy](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Chi può giocare',
      blocks: [
        'Devi avere almeno 13 anni, o l’età minima stabilita dalla legge del tuo Paese se è più alta. Se hai meno di 18 anni, ti serve il consenso di un genitore o di un tutore.',
      ],
    },
    {
      id: 'account',
      title: 'Il tuo account',
      blocks: [
        {
          list: [
            'Un solo account per persona, con la tua email.',
            'Tieni al sicuro la tua password (o l’account Google con cui accedi). Sei responsabile di tutto ciò che viene fatto con il tuo account.',
            'Puoi eliminare il tuo account in qualsiasi momento nell’app: Impostazioni → Elimina account.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Nomi visualizzati e comportamento',
      blocks: [
        'Il tuo nome visualizzato, l’avatar e il Paese sono visibili a tutti i giocatori. Un nome non deve:',
        {
          list: [
            'essere offensivo, razzista, sessuale, minaccioso o insultante;',
            'impersonare un’altra persona, un altro giocatore o lo staff del gioco;',
            'contenere dati personali (un numero di telefono, un indirizzo), pubblicità o un link.',
          ],
        },
        'I nomi vengono controllati automaticamente con un elenco di parole vietate. Possiamo cambiare un nome che viola queste regole, chiederne uno nuovo o sospendere l’account.',
        'Le reazioni nel gioco sono emoji di un elenco fisso. Durante una partita puoi silenziare un avversario dalla sua scheda, bloccarlo o segnalarlo (sezione successiva).',
      ],
    },
    {
      id: 'reports',
      title: 'Segnalazioni e blocchi',
      blocks: [
        'Puoi segnalare un giocatore dalla sua scheda o dalla partita, con uno di tre motivi: nome offensivo, imbroglio o altro. **Esaminiamo ogni segnalazione entro 48 ore.**',
        'Se le regole sono state violate, possiamo sostituire il nome con uno temporaneo (al giocatore viene quindi chiesto di scegliere un nuovo nome, e la regola dei 30 giorni non si applica a questa scelta), sospendere l’account dalle partite classificate e dalle modifiche all’account finché la sospensione non viene revocata, oppure chiuderlo. Un nome sostituito in questo modo non può essere scelto di nuovo. Un account sospeso può comunque essere eliminato in qualsiasi momento, ma eliminarlo non revoca la sospensione: un nuovo account con lo stesso accesso parte sospeso finché non lo esaminiamo.',
        'Puoi anche bloccare un giocatore: non finirai nella stessa partita con quel giocatore, e le sue reazioni non ti verranno mostrate. Revoca un blocco in Impostazioni → Giocatori bloccati. Un blocco non nasconde nessuno dalle classifiche.',
        'Non segnalare senza motivo: le segnalazioni false ripetute violano questi termini.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Fair play',
      blocks: [
        'Non devi:',
        {
          list: [
            'usare risolutori di sudoku, bot, script, automazioni o un’app modificata;',
            'tenere più account per influenzare i punteggi, accordarti sui risultati con un altro giocatore o perdere di proposito;',
            'sfruttare i bug invece di segnalarli;',
            'sovraccaricare i nostri server, tentare di violarli o ostacolare gli altri giocatori.',
          ],
        },
        'Il server contrassegna le partite insolite per una verifica. Se le regole sono state violate, possiamo annullare i risultati, azzerare i punteggi, o sospendere e chiudere l’account.',
      ],
    },
    {
      id: 'virtual',
      title: 'Punteggi, XP e traguardi',
      blocks: [
        'Punteggi, XP, livelli e traguardi non hanno valore monetario, e non possono essere trasferiti o venduti. Possiamo cambiare il modo in cui vengono calcolati o azzerarli (per esempio, all’inizio di una stagione).',
        'Il gioco è gratuito. Questa versione non ha acquisti né pubblicità.',
      ],
    },
    {
      id: 'service',
      title: 'Disponibilità',
      blocks: [
        'Le partite classificate richiedono una connessione a internet. Quando non ci sono giocatori disponibili, il gioco può abbinarti a un avversario controllato dal computer che gioca a un ritmo simile al tuo. Queste partite contano per il tuo punteggio. Il gioco può anche offrire una partita di allenamento contro un bot, senza punteggio. Se il server si riavvia durante una partita classificata, quella partita finisce senza variazioni di punteggio.',
        'Possiamo modificare, sospendere o interrompere parti del gioco, e cercheremo di dare preavviso delle modifiche sostanziali.',
      ],
    },
    {
      id: 'ip',
      title: 'Proprietà intellettuale',
      blocks: [
        'Il gioco, il suo design, il codice, i suoni e gli avatar appartengono a noi o a chi ce li ha concessi in licenza. Ti concediamo una licenza personale, non esclusiva e non commerciale per usare il gioco secondo questi termini. Le licenze di terze parti sono elencate nell’app: Impostazioni → Licenze.',
      ],
    },
    {
      id: 'stores',
      title: 'Store delle app',
      blocks: [
        'Apple e Google non sono parti di questi termini e non sono responsabili del gioco. Se hai scaricato il gioco dall’App Store, si applica anche il Contratto di licenza standard con l’utente finale (EULA) di Apple, e Apple e le sue controllate possono far valere questi termini in qualità di terzi beneficiari.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Esclusione di garanzia',
      blocks: [
        'Il gioco è fornito «così com’è». Nei limiti consentiti dalla legge, non garantiamo che funzioni senza interruzioni o errori, e non siamo responsabili per danni indiretti, dati persi o punteggi persi. Nulla in questi termini limita i diritti che la legge ti riconosce e a cui non si può rinunciare.',
      ],
    },
    {
      id: 'termination',
      title: 'Cessazione',
      blocks: [
        'Puoi smettere di giocare ed eliminare il tuo account in qualsiasi momento. Possiamo sospendere o chiudere un account che viola questi termini.',
      ],
    },
    {
      id: 'changes',
      title: 'Modifiche a questi termini',
      blocks: [
        'Quando questi termini cambiano, aggiorniamo qui la data. Annunceremo inoltre nell’app le modifiche sostanziali. Usare il gioco dopo una modifica significa accettare i nuovi termini.',
      ],
    },
    {
      id: 'law',
      title: 'Legge applicabile',
      blocks: [
        'Questi termini sono regolati dalle leggi dello Stato di Israele, e i tribunali competenti del distretto di Tel Aviv hanno giurisdizione esclusiva, salvo che la legge del tuo Paese ti riconosca un diritto a cui non si può rinunciare.',
      ],
    },
    {
      id: 'contact',
      title: 'Contatti',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_IT: LegalDoc = {
  title: 'Elimina il tuo account',
  lead: 'Come eliminare il tuo account di Sudoku Fight e cosa succede ai tuoi dati.',
  sections: [
    {
      id: 'in-app',
      title: 'Nell’app (immediato)',
      blocks: [
        {
          list: [
            'Apri Sudoku Fight e vai in **Impostazioni**.',
            'Tocca **Elimina account** e conferma.',
            'Inserisci la tua password oppure, se accedi con Google, scegli di nuovo il tuo account Google. L’account viene eliminato subito, e l’app torna alla schermata di accesso.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Senza l’app',
      blocks: [
        'Scrivici a {email} **dall’indirizzo email del tuo account**, con l’oggetto «Elimina il mio account» e il tuo nome visualizzato. Verificheremo che la richiesta provenga dal titolare dell’account e lo elimineremo entro 30 giorni. Ti daremo conferma via email quando sarà fatto.',
      ],
    },
    {
      id: 'what',
      title: 'Cosa viene eliminato e cosa resta',
      blocks: [
        {
          list: [
            '**Eliminati subito:** la tua email, il Paese, l’avatar, il tuo accesso (anche in Firebase) e il collegamento tra il tuo account e le tue installazioni. Il tuo nome visualizzato viene sostituito da un identificativo anonimo e diventa libero per gli altri.',
            '**Conservati in forma anonima:** partite classificate, punteggi, XP, risultati degli allenamenti, annotazioni di fair play e dati di utilizzo. Non sono più collegati a te, ma le partite e le classifiche degli altri giocatori restano complete.',
            '**Sul tuo telefono:** le partite di allenamento che si trovano sul tuo telefono restano lì finché non disinstalli l’app.',
            '**Presso Google:** i rapporti sugli arresti anomali sono conservati per un massimo di 90 giorni, e i dati di Analytics per il periodo di conservazione impostato.',
          ],
        },
        'Maggiori informazioni nell’[Informativa sulla privacy](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_IT: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_IT,
  terms: TERMS_IT,
  'delete-account': DELETE_ACCOUNT_IT,
};
