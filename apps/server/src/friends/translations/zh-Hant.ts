import type { PageTexts } from '../links';

/**
 * A room link's page in Traditional Chinese (D113; links.ts ROOM_PAGE_TEXTS, `zh-Hant`), translated from English
 * with Taiwan and Hong Kong usage, never converted from Simplified Chinese (docs/i18n/style/zh-Hant.md): 你 (D122),
 * full-width punctuation, no space between Chinese and a digit or a placeholder, one space around a Latin word;
 * terms from docs/i18n/glossary.csv (房間, 對局, 邀請); the app is 應用程式, the code is 代碼 (房間代碼).
 *
 * `path` quotes the app: "新對局" must equal home:modes.title and "用代碼加入" must equal home:modes.friends.join
 * in apps/mobile/src/i18n/locales/zh-Hant/home.json (links.test.ts checks it), joined by → (left to right).
 * `testingHeading` is the same words as home:modes.friends.join (and friends:join.title). `codeLabel` "房間代碼"
 * is the room code as the app names it (friends:join.codeLabel starts with it). `privacy` is home:settings.privacy.
 * The store badges' words are Google's and Apple's own Traditional Chinese (Taiwan) badges
 * ("下載應用程式，請到 Google Play", "在 App Store 下載").
 */
export const ROOM_PAGE_TEXTS_ZH_HANT: PageTexts = {
  brand: 'Sudoku Fight',
  languages: '語言',
  path: '新對局 → 用代碼加入',
  title: '邀請你加入房間{code} · Sudoku Fight',
  heading: '你受邀參加一場 Sudoku Fight 對局',
  codeLabel: '房間代碼',
  open: '在應用程式中開啟',
  noApp: '還沒有這個應用程式嗎？',
  googlePlay: '下載應用程式，請到 Google Play',
  appStore: '在 App Store 下載',
  typeCode:
    '已經有這個應用程式，但它沒有開啟？請更新應用程式（需要{version}或以上版本），或輸入代碼：{path} → {code}。',
  testing: '應用程式仍在測試中。如果你已經安裝：{path} → {code}。需要{version}或以上版本。',
  testingHeading: '用代碼加入',
  closedNote: '如果房間已經關閉，應用程式會告訴你，你可以向好友要一組新的代碼。',
  privacy: '隱私權政策',
  badTitle: '連結無效 · Sudoku Fight',
  badHeading: '這個連結不完整',
  badText:
    '這個連結中沒有有效的房間代碼。請向傳送連結的好友索取房間代碼（6位數字），然後在應用程式中：{path}。',
};
