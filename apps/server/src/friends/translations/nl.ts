import type { PageTexts } from '../links';

/**
 * A room link's page in Dutch (D113; links.ts ROOM_PAGE_TEXTS, `nl`): je/jij, lowercase (docs/i18n/style/nl.md),
 * terms from docs/i18n/glossary.csv (kamer, spel, uitnodiging).
 *
 * `path` quotes the app: "Nieuw spel" must equal home:modes.title and "Code invoeren" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/nl/home.json (links.test.ts checks it), joined by → (left
 * to right). The store badges' words are Google's and Apple's own Dutch ("Ontdek het op Google Play",
 * "Download in de App Store"). The friend who sent the link is "de persoon die …", so no gender is assumed.
 */
export const ROOM_PAGE_TEXTS_NL: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Taal',
  path: 'Nieuw spel → Code invoeren',
  title: 'Uitnodiging voor kamer {code} · Sudoku Fight',
  heading: 'Je bent uitgenodigd voor een spel Sudoku Fight',
  codeLabel: 'Kamercode',
  open: 'Openen in de app',
  noApp: 'Heb je de app nog niet?',
  googlePlay: 'Ontdek het op Google Play',
  appStore: 'Download in de App Store',
  typeCode:
    'Heb je de app al, maar ging die niet open? Werk hem bij (je hebt versie {version} of hoger nodig), of typ de code: {path} → {code}.',
  testing:
    'De app wordt nog getest. Als je hem al hebt: {path} → {code}. Je hebt versie {version} of hoger nodig.',
  testingHeading: 'Meedoen met de code',
  closedNote:
    'Als de kamer al gesloten is, laat de app je dat weten, en kun je de persoon die je heeft uitgenodigd om een nieuwe code vragen.',
  privacy: 'Privacybeleid',
  badTitle: 'Ongeldige link · Sudoku Fight',
  badHeading: 'Deze link is onvolledig',
  badText:
    'Deze link bevat geen geldige kamercode. Vraag de persoon die hem heeft gestuurd om de kamercode (6 cijfers), en ga dan in de app naar: {path}.',
};
