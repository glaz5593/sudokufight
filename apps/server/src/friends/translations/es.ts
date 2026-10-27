import type { PageTexts } from '../links';

/**
 * A room link's page in Spanish (D113; links.ts ROOM_PAGE_TEXTS, `es`): neutral Latin American Spanish, tú
 * (docs/i18n/style/es.md), terms from docs/i18n/glossary.csv (sala, partida, invitación).
 *
 * `path` quotes the app: "Nueva partida" must equal home:modes.title and "Usar código" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/es/home.json (links.test.ts checks it), joined by → (left
 * to right). The store badges' words are Google's and Apple's own Spanish ("Disponible en Google Play",
 * "Descárgalo en el App Store").
 */
export const ROOM_PAGE_TEXTS_ES: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Idioma',
  path: 'Nueva partida → Usar código',
  title: 'Invitación a la sala {code} · Sudoku Fight',
  heading: 'Tienes una invitación a una partida de Sudoku Fight',
  codeLabel: 'Código de sala',
  open: 'Abrir en la app',
  noApp: '¿No tienes la app?',
  googlePlay: 'Disponible en Google Play',
  appStore: 'Descárgalo en el App Store',
  typeCode:
    '¿Tienes la app y no se abrió? Actualízala (necesitas la versión {version} o posterior) o escribe el código: {path} → {code}.',
  testing:
    'La app todavía está en pruebas. Si la tienes: {path} → {code}. Necesitas la versión {version} o posterior.',
  testingHeading: 'Unirse con el código',
  closedNote:
    'Si la sala ya se cerró, la app te lo dirá, y puedes pedirle un código nuevo a quien te invitó.',
  privacy: 'Política de privacidad',
  badTitle: 'Enlace no válido · Sudoku Fight',
  badHeading: 'Este enlace está incompleto',
  badText:
    'Este enlace no tiene un código de sala válido. Pídele el código de sala (6 números) a quien te lo envió y luego, en la app: {path}.',
};
