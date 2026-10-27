import type { PageTexts } from '../links';

/**
 * A room link's page in Thai (D113; links.ts ROOM_PAGE_TEXTS, `th`): friendly and neutral, never ครับ / ค่ะ
 * (D122, docs/i18n/style/th.md), คุณ for "you"; terms from docs/i18n/glossary.csv (ห้อง, เกม, คำเชิญ / เชิญ). No
 * full stop: a space ends a sentence, as Thai writes it; a space on each side of a placeholder.
 *
 * `path` quotes the app: "เกมใหม่" must equal home:modes.title and "เข้าด้วยรหัส" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/th/home.json (links.test.ts checks it; the same words as
 * friends:join.title), joined by → (left to right). "รหัสห้อง" is the room code's label (friends:code.title). The
 * store links are plain text, not badge images: "ดาวน์โหลดจาก Google Play" and "ดาวน์โหลดบน App Store" translate
 * the English link words (the official Thai badge wordings were not verified).
 */
export const ROOM_PAGE_TEXTS_TH: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'ภาษา',
  path: 'เกมใหม่ → เข้าด้วยรหัส',
  title: 'คำเชิญเข้าห้อง {code} · Sudoku Fight',
  heading: 'คุณได้รับเชิญให้เล่นเกม Sudoku Fight',
  codeLabel: 'รหัสห้อง',
  open: 'เปิดในแอป',
  noApp: 'ยังไม่มีแอปใช่ไหม?',
  googlePlay: 'ดาวน์โหลดจาก Google Play',
  appStore: 'ดาวน์โหลดบน App Store',
  typeCode:
    'มีแอปแล้วแต่แอปไม่เปิดใช่ไหม? อัปเดตแอป (ต้องใช้เวอร์ชัน {version} ขึ้นไป) หรือพิมพ์รหัส: {path} → {code}',
  testing: 'แอปยังอยู่ในช่วงทดสอบ หากคุณมีแอปแล้ว: {path} → {code} ต้องใช้เวอร์ชัน {version} ขึ้นไป',
  testingHeading: 'เข้าห้องด้วยรหัสนี้',
  closedNote: 'หากห้องปิดไปแล้ว แอปจะแจ้งให้คุณทราบ และคุณขอรหัสใหม่จากเพื่อนได้',
  privacy: 'นโยบายความเป็นส่วนตัว',
  badTitle: 'ลิงก์ใช้ไม่ได้ · Sudoku Fight',
  badHeading: 'ลิงก์นี้ไม่สมบูรณ์',
  badText:
    'ลิงก์นี้ไม่มีรหัสห้องที่ถูกต้อง ขอรหัสห้อง (ตัวเลข 6 หลัก) จากเพื่อนที่ส่งลิงก์มา จากนั้นในแอปไปที่ {path}',
};
