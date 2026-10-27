import type { PageTexts } from '../links';

/**
 * A room link's page in Vietnamese (D113; links.ts ROOM_PAGE_TEXTS, `vi`): bạn (D122, docs/i18n/style/vi.md),
 * terms from docs/i18n/glossary.csv (phòng, trận đấu, lời mời / mời). Unicode NFC, modern tone marks. A friend is
 * "người bạn" where plain "bạn" (you) would be ambiguous.
 *
 * `path` quotes the app: "Trận mới" must equal home:modes.title and "Vào bằng mã" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/vi/home.json (links.test.ts checks it), joined by →
 * (left to right). "Mã phòng" is the room code's label (glossary: phòng). The store links are plain text, not
 * badge images: "Tải về trên Google Play" and "Tải về trên App Store" translate the English link words (the
 * official Vietnamese badge wordings were not verified).
 */
export const ROOM_PAGE_TEXTS_VI: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Ngôn ngữ',
  path: 'Trận mới → Vào bằng mã',
  title: 'Lời mời vào phòng {code} · Sudoku Fight',
  heading: 'Bạn được mời vào một trận đấu Sudoku Fight',
  codeLabel: 'Mã phòng',
  open: 'Mở trong ứng dụng',
  noApp: 'Bạn chưa có ứng dụng?',
  googlePlay: 'Tải về trên Google Play',
  appStore: 'Tải về trên App Store',
  typeCode:
    'Đã có ứng dụng nhưng ứng dụng không mở? Hãy cập nhật ứng dụng (bạn cần phiên bản {version} trở lên), hoặc nhập mã: {path} → {code}.',
  testing:
    'Ứng dụng vẫn đang trong giai đoạn thử nghiệm. Nếu bạn đã có ứng dụng: {path} → {code}. Bạn cần phiên bản {version} trở lên.',
  testingHeading: 'Vào phòng bằng mã này',
  closedNote: 'Nếu phòng đã đóng, ứng dụng sẽ cho bạn biết, và bạn có thể xin mã mới từ người bạn của mình.',
  privacy: 'Chính sách quyền riêng tư',
  badTitle: 'Liên kết bị lỗi · Sudoku Fight',
  badHeading: 'Liên kết này không đầy đủ',
  badText:
    'Liên kết này không có mã phòng hợp lệ. Hãy xin mã phòng (6 chữ số) từ người bạn đã gửi liên kết, rồi trong ứng dụng: {path}.',
};
