import type { PageTexts } from '../links';

/**
 * A room link's page in Japanese (D113; links.ts ROOM_PAGE_TEXTS, `ja`): です/ます (docs/i18n/style/ja.md),
 * full-width punctuation, terms from docs/i18n/glossary.csv (ルーム, 対戦, 招待).
 *
 * `path` quotes the app: "新しい対戦" must equal home:modes.title and "コードで参加" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/ja/home.json (links.test.ts checks it), joined by → (left
 * to right). `privacy` is home:settings.privacy. The store badges' words are Google's and Apple's own Japanese
 * ("Google Play で手に入れよう", "App Store からダウンロード").
 */
export const ROOM_PAGE_TEXTS_JA: PageTexts = {
  brand: 'Sudoku Fight',
  languages: '言語',
  path: '新しい対戦 → コードで参加',
  title: 'ルーム{code}への招待 · Sudoku Fight',
  heading: 'Sudoku Fightの対戦に招待されました',
  codeLabel: 'ルームコード',
  open: 'アプリで開く',
  noApp: 'アプリをまだ入れていませんか？',
  googlePlay: 'Google Play で手に入れよう',
  appStore: 'App Store からダウンロード',
  typeCode:
    'アプリがあるのに開かなかった場合は、アプリを更新する（バージョン{version}以降が必要です）か、コードを入力してください：{path} → {code}。',
  testing: 'アプリはまだテスト中です。アプリがある場合：{path} → {code}。バージョン{version}以降が必要です。',
  testingHeading: 'コードで参加する',
  closedNote:
    'ルームがすでに閉じている場合はアプリでお知らせします。フレンドに新しいコードを頼むことができます。',
  privacy: 'プライバシーポリシー',
  badTitle: '無効なリンク · Sudoku Fight',
  badHeading: 'このリンクは不完全です',
  badText:
    'このリンクには有効なルームコードがありません。リンクを送ってくれたフレンドにルームコード（6桁の数字）を聞いてから、アプリで次の操作をしてください：{path}。',
};
