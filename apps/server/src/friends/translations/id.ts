import type { PageTexts } from '../links';

/**
 * A room link's page in Indonesian (D113; links.ts ROOM_PAGE_TEXTS, `id`): kamu (docs/i18n/style/id.md), terms
 * from docs/i18n/glossary.csv (room, pertandingan, undangan / mengundang).
 *
 * `path` quotes the app: "Pertandingan baru" must equal home:modes.title and "Masukkan kode" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/id/home.json (links.test.ts checks it), joined by → (left
 * to right). The store links are plain text, not badge images: "Unduh di App Store" is Apple's Indonesian badge
 * wording; "Dapatkan di Google Play" translates "Get it on Google Play" (Google's Indonesian badge may read
 * "Temukan di Google Play": not verified).
 */
export const ROOM_PAGE_TEXTS_ID: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Bahasa',
  path: 'Pertandingan baru → Masukkan kode',
  title: 'Undangan ke room {code} · Sudoku Fight',
  heading: 'Kamu diundang ke pertandingan Sudoku Fight',
  codeLabel: 'Kode room',
  open: 'Buka di aplikasi',
  noApp: 'Belum punya aplikasinya?',
  googlePlay: 'Dapatkan di Google Play',
  appStore: 'Unduh di App Store',
  typeCode:
    'Sudah punya aplikasinya, tapi tidak terbuka? Perbarui aplikasinya (kamu butuh versi {version} atau yang lebih baru), atau ketik kodenya: {path} → {code}.',
  testing:
    'Aplikasi ini masih dalam uji coba. Kalau kamu sudah memilikinya: {path} → {code}. Kamu butuh versi {version} atau yang lebih baru.',
  testingHeading: 'Gabung dengan kode ini',
  closedNote:
    'Kalau room itu sudah ditutup, aplikasi akan memberitahumu, dan kamu bisa meminta kode baru ke temanmu.',
  privacy: 'Kebijakan privasi',
  badTitle: 'Tautan rusak · Sudoku Fight',
  badHeading: 'Tautan ini tidak lengkap',
  badText:
    'Tautan ini tidak berisi kode room yang valid. Minta kode room (6 angka) ke teman yang mengirimnya, lalu di aplikasi: {path}.',
};
