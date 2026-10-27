import type { PageTexts } from '../links';

/**
 * A room link's page in Korean (D113; links.ts ROOM_PAGE_TEXTS, `ko`): 존댓말 in the friendly 해요체
 * (docs/i18n/style/ko.md), half-width Western punctuation, terms from docs/i18n/glossary.csv (방, 게임, 초대).
 * No particle directly after a placeholder: "{version} 이상", and {path} only after a colon or before an arrow.
 *
 * `path` quotes the app: "새 게임" must equal home:modes.title and "코드로 참가" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/ko/home.json (links.test.ts checks it), joined by → (left
 * to right). `privacy` is home:settings.privacy. The store links use the wording of Google's and Apple's own Korean
 * badges ("Google Play에서 다운로드", "App Store에서 다운로드").
 */
export const ROOM_PAGE_TEXTS_KO: PageTexts = {
  brand: 'Sudoku Fight',
  languages: '언어',
  path: '새 게임 → 코드로 참가',
  title: '방 {code} 초대 · Sudoku Fight',
  heading: 'Sudoku Fight 게임에 초대받았어요',
  codeLabel: '방 코드',
  open: '앱에서 열기',
  noApp: '앱이 없나요?',
  googlePlay: 'Google Play에서 다운로드',
  appStore: 'App Store에서 다운로드',
  typeCode:
    '앱이 있는데 열리지 않았나요? 앱을 업데이트하거나(버전 {version} 이상이 필요해요), 코드를 입력하세요: {path} → {code}.',
  testing: '앱은 아직 테스트 중이에요. 앱이 있다면: {path} → {code}. 버전 {version} 이상이 필요해요.',
  testingHeading: '코드로 참가하기',
  closedNote: '방이 이미 닫혔다면 앱이 알려 줄 거예요. 친구에게 새 코드를 달라고 하면 돼요.',
  privacy: '개인정보 처리방침',
  badTitle: '잘못된 링크 · Sudoku Fight',
  badHeading: '이 링크는 완전하지 않아요',
  badText:
    '이 링크에는 올바른 방 코드가 없어요. 링크를 보낸 친구에게 방 코드(숫자 6자리)를 물어본 다음, 앱에서 입력하세요: {path}.',
};
