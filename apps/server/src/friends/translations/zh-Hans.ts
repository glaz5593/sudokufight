import type { PageTexts } from '../links';

/**
 * A room link's page in Simplified Chinese (D113; links.ts ROOM_PAGE_TEXTS, `zh-Hans`): 你 (D122,
 * docs/i18n/style/zh-Hans.md), full-width punctuation, no space between Chinese and a digit or a placeholder, one
 * space around a Latin word; terms from docs/i18n/glossary.csv (房间, 对局, 邀请), the code is 房间码.
 *
 * `path` quotes the app: "新对局" must equal home:modes.title and "输入房间码加入" must equal home:modes.friends.join in
 * apps/mobile/src/i18n/locales/zh-Hans/home.json (links.test.ts checks it), joined by → (left to right).
 * `testingHeading` is the same words as home:modes.friends.join (and friends:join.title). `privacy` is
 * home:settings.privacy. The store badges' words are Google's and Apple's own Simplified Chinese
 * ("下载应用，请到 Google Play", "在 App Store 下载").
 */
export const ROOM_PAGE_TEXTS_ZH_HANS: PageTexts = {
  brand: 'Sudoku Fight',
  languages: '语言',
  path: '新对局 → 输入房间码加入',
  title: '邀请你加入房间{code} · Sudoku Fight',
  heading: '你受邀参加一局 Sudoku Fight 对局',
  codeLabel: '房间码',
  open: '在应用中打开',
  noApp: '还没有这个应用？',
  googlePlay: '下载应用，请到 Google Play',
  appStore: '在 App Store 下载',
  typeCode:
    '已经有这个应用，但它没有打开？请更新应用（需要{version}或更高版本），或输入房间码：{path} → {code}。',
  testing: '应用仍在测试中。如果你已经安装：{path} → {code}。需要{version}或更高版本。',
  testingHeading: '输入房间码加入',
  closedNote: '如果房间已经关闭，应用会告诉你，你可以向好友要一个新的房间码。',
  privacy: '隐私政策',
  badTitle: '链接无效 · Sudoku Fight',
  badHeading: '此链接不完整',
  badText: '此链接中没有有效的房间码。请向发送链接的好友索要房间码（6位数字），然后在应用中：{path}。',
};
