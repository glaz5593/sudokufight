import type { PageTexts } from '../links';

/**
 * A room link's page in German (D113; links.ts ROOM_PAGE_TEXTS, `de`): du, lowercase (docs/i18n/style/de.md),
 * terms from docs/i18n/glossary.csv (Raum, Spiel, Einladung).
 *
 * `path` quotes the app: "Neues Spiel" must equal home:modes.title and "Code eingeben" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/de/home.json (links.test.ts checks it), joined by → (left
 * to right). The store badges' words are Google's and Apple's own German ("Jetzt bei Google Play",
 * "Laden im App Store").
 */
export const ROOM_PAGE_TEXTS_DE: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Sprache',
  path: 'Neues Spiel → Code eingeben',
  title: 'Einladung in Raum {code} · Sudoku Fight',
  heading: 'Du bist zu einem Spiel bei Sudoku Fight eingeladen',
  codeLabel: 'Raumcode',
  open: 'In der App öffnen',
  noApp: 'Du hast die App noch nicht?',
  googlePlay: 'Jetzt bei Google Play',
  appStore: 'Laden im App Store',
  typeCode:
    'Du hast die App, aber sie hat sich nicht geöffnet? Aktualisiere sie (du brauchst Version {version} oder neuer) oder gib den Code ein: {path} → {code}.',
  testing:
    'Die App ist noch in der Testphase. Wenn du sie hast: {path} → {code}. Du brauchst Version {version} oder neuer.',
  testingHeading: 'Mit dem Code beitreten',
  closedNote:
    'Wenn der Raum schon geschlossen ist, sagt dir die App Bescheid, und du kannst die Person, die dich eingeladen hat, um einen neuen Code bitten.',
  privacy: 'Datenschutzerklärung',
  badTitle: 'Ungültiger Link · Sudoku Fight',
  badHeading: 'Dieser Link ist unvollständig',
  badText:
    'Dieser Link enthält keinen gültigen Raumcode. Frag die Person, die ihn dir geschickt hat, nach dem Raumcode (6 Ziffern). Dann in der App: {path}.',
};
