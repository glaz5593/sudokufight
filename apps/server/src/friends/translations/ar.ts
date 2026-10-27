import type { PageTexts } from '../links';

/**
 * The room link's page in Arabic (links.ts ROOM_PAGE_TEXTS; D113): Modern Standard Arabic, right to left
 * (legal/languages.ts pageDir), neutral wording (D122: docs/i18n/style/ar.md), the terms of
 * docs/i18n/glossary.csv (مباراة, غرفة, رمز, دعوة).
 *
 * `path` quotes the app, joined by the arrow that points the way Arabic reads (←), and must stay equal to the
 * app's ar strings (links.test.ts reads apps/mobile/src/i18n/locales/ar/home.json):
 * - مباراة جديدة = home:modes.title
 * - انضم برمز = home:modes.friends.join
 * Also by meaning: رمز الغرفة = friends:code.title, سياسة الخصوصية = home:settings.privacy.
 *
 * Wired into links.ts ROOM_PAGE_TEXTS, with 'ar' in LINK_LANGS.
 */
export const ROOM_PAGE_TEXTS_AR: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'اللغة',
  path: 'مباراة جديدة ← انضم برمز',
  title: 'دعوة إلى الغرفة {code} · Sudoku Fight',
  heading: 'تلقيت دعوة إلى مباراة في Sudoku Fight',
  codeLabel: 'رمز الغرفة',
  open: 'فتح في التطبيق',
  noApp: 'ليس لديك التطبيق؟',
  googlePlay: 'التنزيل من Google Play',
  appStore: 'التنزيل من App Store',
  typeCode:
    'التطبيق مثبت لديك ولم يفتح؟ يمكنك تحديثه (يلزم الإصدار {version} أو أحدث)، أو كتابة الرمز: {path} ← {code}.',
  testing:
    'التطبيق لا يزال قيد الاختبار. إذا كان مثبتًا لديك: {path} ← {code}. يلزم الإصدار {version} أو أحدث.',
  testingHeading: 'الانضمام بالرمز',
  closedNote: 'إذا كانت الغرفة مغلقة بالفعل، فسيخبرك التطبيق بذلك، ويمكنك طلب رمز جديد من صديقك.',
  privacy: 'سياسة الخصوصية',
  badTitle: 'رابط غير صالح · Sudoku Fight',
  badHeading: 'هذا الرابط غير مكتمل',
  badText:
    'لا يحتوي هذا الرابط على رمز غرفة صالح. يمكنك طلب رمز الغرفة (6 أرقام) من الصديق الذي أرسله، ثم في التطبيق: {path}.',
};
