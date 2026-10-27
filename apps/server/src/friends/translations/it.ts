import type { PageTexts } from '../links';

/**
 * A room link's page in Italian (D113; links.ts ROOM_PAGE_TEXTS, `it`): tu (docs/i18n/style/it.md), terms from
 * docs/i18n/glossary.csv (stanza, partita, invito). No space before a colon or a question mark; apostrophe ’.
 * No word agrees with the reader's gender ("Hai un invito", not "Sei stato invitato"), nor with the friend's
 * ("chi ti ha invitato", "chi te l’ha inviato").
 *
 * `path` quotes the app: "Nuova partita" must equal home:modes.title and "Usa un codice" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/it/home.json (links.test.ts checks it), joined by → (left
 * to right). The store badges' words are Google's and Apple's own Italian ("Disponibile su Google Play",
 * "Scarica su App Store").
 */
export const ROOM_PAGE_TEXTS_IT: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Lingua',
  path: 'Nuova partita → Usa un codice',
  title: 'Invito alla stanza {code} · Sudoku Fight',
  heading: 'Hai un invito per una partita di Sudoku Fight',
  codeLabel: 'Codice della stanza',
  open: 'Apri nell’app',
  noApp: 'Non hai l’app?',
  googlePlay: 'Disponibile su Google Play',
  appStore: 'Scarica su App Store',
  typeCode:
    'Hai l’app e non si è aperta? Aggiornala (ti serve la versione {version} o successiva), oppure digita il codice: {path} → {code}.',
  testing:
    'L’app è ancora in test. Se ce l’hai: {path} → {code}. Ti serve la versione {version} o successiva.',
  testingHeading: 'Entra con il codice',
  closedNote:
    'Se la stanza è già stata chiusa, l’app te lo dirà e potrai chiedere un nuovo codice a chi ti ha invitato.',
  privacy: 'Informativa sulla privacy',
  badTitle: 'Link non valido · Sudoku Fight',
  badHeading: 'Questo link è incompleto',
  badText:
    'Questo link non contiene un codice della stanza valido. Chiedi il codice della stanza (6 cifre) a chi te l’ha inviato, poi, nell’app: {path}.',
};
