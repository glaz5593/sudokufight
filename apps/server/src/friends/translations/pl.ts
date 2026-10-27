import type { PageTexts } from '../links';

/**
 * A room link's page in Polish (D113; links.ts ROOM_PAGE_TEXTS, `pl`): ty, lowercase, and nothing that assumes the
 * reader's gender ("Masz zaproszenie", "osobę, która cię zaprosiła") (docs/i18n/style/pl.md); terms from
 * docs/i18n/glossary.csv (pokój, partia, zaproszenie).
 *
 * `path` quotes the app: "Nowa partia" must equal home:modes.title and "Dołącz z kodem" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/pl/home.json (links.test.ts checks it), joined by → (left
 * to right). The store badges' words are Google's and Apple's own Polish ("Pobierz z Google Play",
 * "Pobierz z App Store").
 */
export const ROOM_PAGE_TEXTS_PL: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Język',
  path: 'Nowa partia → Dołącz z kodem',
  title: 'Zaproszenie do pokoju {code} · Sudoku Fight',
  heading: 'Masz zaproszenie do partii w Sudoku Fight',
  codeLabel: 'Kod pokoju',
  open: 'Otwórz w aplikacji',
  noApp: 'Nie masz aplikacji?',
  googlePlay: 'Pobierz z Google Play',
  appStore: 'Pobierz z App Store',
  typeCode:
    'Masz aplikację, ale się nie otworzyła? Zaktualizuj ją (potrzebujesz wersji {version} lub nowszej) albo wpisz kod: {path} → {code}.',
  testing:
    'Aplikacja jest jeszcze w fazie testów. Jeśli ją masz: {path} → {code}. Potrzebujesz wersji {version} lub nowszej.',
  testingHeading: 'Dołącz za pomocą kodu',
  closedNote:
    'Jeśli pokój jest już zamknięty, aplikacja ci o tym powie, a o nowy kod możesz poprosić osobę, która cię zaprosiła.',
  privacy: 'Polityka prywatności',
  badTitle: 'Nieprawidłowy link · Sudoku Fight',
  badHeading: 'Ten link jest niekompletny',
  badText:
    'Ten link nie zawiera prawidłowego kodu pokoju. Poproś osobę, która go wysłała, o kod pokoju (6 cyfr), a potem w aplikacji: {path}.',
};
