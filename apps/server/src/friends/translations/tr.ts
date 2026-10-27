import type { PageTexts } from '../links';

/**
 * A room link's page in Turkish (D113; links.ts ROOM_PAGE_TEXTS, `tr`): sen (docs/i18n/style/tr.md), terms from
 * docs/i18n/glossary.csv (oda, maç, davet). The brand is never inflected: "Sudoku Fight oyununda".
 *
 * `path` quotes the app: "Yeni maç" must equal home:modes.title and "Kodla katıl" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/tr/home.json (links.test.ts checks it), joined by → (left
 * to right). The store links speak sen like the rest of the page ("Google Play’den indir", "App Store’dan
 * indir"), not the stores' own badge wording, which addresses the reader as siz. `codeLabel` and `testingHeading`
 * are the app's own words too: "Oda kodu" (friends:code.title), "Kodla katıl" (home:modes.friends.join); `privacy`
 * is the app's link, "Gizlilik politikası" (home:settings.privacy).
 */
export const ROOM_PAGE_TEXTS_TR: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Dil',
  path: 'Yeni maç → Kodla katıl',
  title: '{code} kodlu odaya davet · Sudoku Fight',
  heading: 'Sudoku Fight oyununda bir maça davet edildin',
  codeLabel: 'Oda kodu',
  open: 'Uygulamada aç',
  noApp: 'Uygulama sende yok mu?',
  googlePlay: 'Google Play’den indir',
  appStore: 'App Store’dan indir',
  typeCode:
    'Uygulama sende var ama açılmadı mı? Uygulamayı güncelle (sürüm {version} ya da daha yenisi gerekiyor) veya kodu yaz: {path} → {code}.',
  testing:
    'Uygulama henüz test sürecinde. Sende varsa: {path} → {code}. Sürüm {version} ya da daha yenisi gerekiyor.',
  testingHeading: 'Kodla katıl',
  closedNote: 'Oda çoktan kapandıysa uygulama bunu sana söyler; arkadaşından yeni bir kod isteyebilirsin.',
  privacy: 'Gizlilik politikası',
  badTitle: 'Bozuk bağlantı · Sudoku Fight',
  badHeading: 'Bu bağlantı eksik',
  badText:
    'Bu bağlantıda geçerli bir oda kodu yok. Bağlantıyı gönderen arkadaşından oda kodunu (6 haneli) iste, sonra uygulamada: {path}.',
};
