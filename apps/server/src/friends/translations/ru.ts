import type { PageTexts } from '../links';

/**
 * A room link's page in Russian (D113; links.ts ROOM_PAGE_TEXTS, `ru`): ты, lowercase, and nothing that assumes
 * the reader's gender ("Тебя пригласили", "у того, кто тебя пригласил") (docs/i18n/style/ru.md); terms from
 * docs/i18n/glossary.csv (комната, партия, приглашение).
 *
 * `path` quotes the app: "Новая партия" must equal home:modes.title and "Войти по коду" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/ru/home.json (links.test.ts checks it), joined by → (left
 * to right). Google Play's badge is Google's own Russian ("Доступно в Google Play"); Apple's own Russian badge
 * says "Загрузите в App Store" (the formal Вы), so the link reads as an infinitive button instead (D122: never Вы).
 */
export const ROOM_PAGE_TEXTS_RU: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Язык',
  path: 'Новая партия → Войти по коду',
  title: 'Приглашение в комнату {code} · Sudoku Fight',
  heading: 'Тебя пригласили на партию в Sudoku Fight',
  codeLabel: 'Код комнаты',
  open: 'Открыть в приложении',
  noApp: 'Нет приложения?',
  googlePlay: 'Доступно в Google Play',
  appStore: 'Загрузить в App Store',
  typeCode:
    'Приложение установлено, но не открылось? Обнови его (нужна версия {version} или новее) или введи код: {path} → {code}.',
  testing:
    'Приложение ещё на тестировании. Если оно у тебя есть: {path} → {code}. Нужна версия {version} или новее.',
  testingHeading: 'Вход по коду',
  closedNote:
    'Если комната уже закрыта, приложение сообщит об этом, и можно будет попросить новый код у того, кто тебя пригласил.',
  privacy: 'Политика конфиденциальности',
  badTitle: 'Неверная ссылка · Sudoku Fight',
  badHeading: 'Эта ссылка неполная',
  badText:
    'В этой ссылке нет действительного кода комнаты. Попроси код комнаты (6 цифр) у того, кто прислал ссылку, а затем в приложении: {path}.',
};
