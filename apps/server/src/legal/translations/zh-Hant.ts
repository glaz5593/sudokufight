import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Traditional Chinese (D112, Moshe 2026-10-23): a translation of the English version
 * (privacy.ts, terms.ts, deleteAccount.ts, render.ts LEGAL_CHROME.en), section by section, with the same anchors,
 * block shapes, links, contact marks ({email}, {operator}), `code` marks and numbers (legal.test.ts `skeleton`).
 * Translated from English with Taiwan and Hong Kong usage, never converted from the Simplified Chinese version
 * (docs/i18n/style/zh-Hant.md). 你 throughout (D122), full-width punctuation and 「」 quotes, half-width Western
 * digits with no space next to Chinese (D108), one space around a Latin word, none around a placeholder; a count
 * that English writes as a word stays a Chinese numeral here (一次, 三種), so no number is added to the skeleton.
 *
 * Terms from docs/i18n/glossary.csv (zh-Hant): 對局 (one game), 遊戲 / 本遊戲 (the game itself), 對手, 排位對局,
 * 積分, 練習, 關卡, 關卡練習, 章, 星, 重播, 干擾, 表情 (reaction), 檢舉, 封鎖, 房間, 格, 盤面, 錯誤, 等級, XP.
 * Taiwan words: 帳號, 設定, 登入 / 登出, 註冊, 資料, 資訊, 網路, 伺服器, 記憶體, 資料庫, 裝置, 應用程式,
 * 解除安裝, 當機 (crash), 預設, IP 位址, 雜湊, 工作階段 (session), 佇列 (queue). The operator is 營運者; an
 * account's suspension is 停權 (the board's cell lock, 鎖定, never appears here); "blocked words" are 禁用字詞, so
 * they are not confused with blocking a player (封鎖); disrupting players is 妨礙 (干擾 is the game's
 * interference). "Country" is 國家/地區 for the profile field; a country as a jurisdiction stays 國家. The chapter
 * gate is 大門 (not 關口, which would read like 關卡).
 *
 * Words quoted from the app (they must equal the app's zh-Hant strings, apps/mobile/src/i18n/locales/zh-Hant):
 * - 設定 = home:settings.title
 * - 刪除帳號 = account:settings.deleteAccount
 * - 已封鎖的玩家 = moderation:blocked.settingsRow
 * - 授權 = home:settings.licenses
 * - 「最近的對手」 = progress:leaderboard.caption.friends (en "Your recent opponents"; quoted without "Your" (你的),
 *   as the English quotes "recent opponents")
 * - 「玩法說明」 = levels:tutorial.title (event level_tutorial)
 * - 隱私權政策 / 使用條款 = home:settings.privacy / home:settings.terms (by meaning)
 * - 對局類型 (game type, in the event table and practice results) = friends:gameType.title
 * - 排行榜 (leaderboards) = ui:nav.tabs.leaderboard
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_ZH_HANT = '本文件為英文版的翻譯。如兩者內容有所歧異，以英文版為準。';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_ZH_HANT: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: '語言',
  contents: '目錄',
  documents: '文件',
  updated: '最後更新：',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[營運者名稱]',
  draft: '草稿：伺服器上尚未設定聯絡資訊（LEGAL_CONTACT_EMAIL、LEGAL_OPERATOR_NAME）。',
  translationNotice: TRANSLATION_NOTICE_ZH_HANT,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, en): [what happens, what it carries]. */
export const EVENT_DETAILS_ZH_HANT: Record<TelemetryEventName, [string, string]> = {
  app_open: ['開啟應用程式', '—'],
  screen_view: ['開啟某個畫面', '畫面名稱（其路由格式，不含識別碼）'],
  register_step: ['開啟註冊的某個步驟', '是哪一個步驟'],
  register_complete: ['完成註冊', '—'],
  game_start: ['對局開始', '模式、對局類型、玩家人數，以及是否為與好友的對局'],
  game_end: ['對局結束', '模式、結果、得分、錯誤次數、時長，以及是否為與好友的對局'],
  interference_sent: ['你發送一次干擾', '干擾的種類和花費'],
  reaction_sent: ['你發送一個表情', '是哪一個表情符號'],
  matchmaking_wait: ['一次尋找對手結束', '等待的秒數，以及是否找到對局'],
  reconnect: ['斷線後重新連線', '花了多久時間，以及是否成功'],
  latency_sample: ['一次連線品質取樣', '網路回應時間，以毫秒計'],
  replay_open: ['開啟重播', '該對局的模式'],
  account_delete: ['帳號被刪除', '—'],
  report_sent: ['你檢舉一名玩家', '僅限檢舉原因（不含被檢舉的是誰，也不含是哪一場對局）'],
  level_map_open: ['開啟關卡練習的地圖', '目前的關卡，以及你的星星總數'],
  level_start: [
    '關卡開始',
    '關卡的編號和版本、所屬的章和種類、這是第幾次嘗試、你到目前為止最好的星數，以及是否為快速開始',
  ],
  level_end: [
    '關卡結束',
    '關卡的編號、版本和種類、星數、你在這之前最好的星數、關卡的時長、關卡如何結束、錯誤次數、成績（時間、位置、領先差距或分數）、機器人的等級，以及這是第幾次嘗試',
  ],
  level_quit: ['中途離開關卡（例如應用程式被關閉）', '關卡的編號和版本，以及關卡已進行了多久'],
  chapter_gate: ['嘗試通過通往下一章的大門', '大門後方的章、該章中的星數，以及大門是否開啟'],
  level_tutorial: ['顯示某種關卡的「玩法說明」', '關卡種類，以及你是否略過說明'],
  friends_room_open: ['開啟一個與好友對局的房間', '對局類型，以及房間是如何開啟的'],
  friends_room_join: ['嘗試加入好友的房間', '加入方式（代碼或連結），以及結果如何（成功，或失敗的原因）'],
  friends_invite_share: ['分享房間的連結', '分享的是房主還是訪客（不含代碼，也不含分享給誰）'],
  friends_link_open: ['房間連結開啟了應用程式', '你當時是否已登入帳號'],
  friends_room_start: ['與好友的對局開始', '玩家人數，以及你在房間中等了幾秒'],
  friends_room_close: ['對局開始前你已離開房間', '原因、房間中有幾名玩家，以及你等了幾秒'],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_ZH_HANT) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_ZH_HANT[name],
  ]);

export const PRIVACY_ZH_HANT: LegalDoc = {
  title: '隱私權政策',
  lead: 'Sudoku Fight 會收集哪些資料、為什麼收集、誰看得到、保存多久，以及如何刪除。',
  sections: [
    {
      id: 'who',
      title: '我們是誰',
      blocks: [
        'Sudoku Fight（「本遊戲」、「我們」）是一款即時競技數獨遊戲，由{operator}營運。',
        '關於隱私和你的資料，如有任何問題，請寫信到{email}與我們聯絡。',
      ],
    },
    {
      id: 'summary',
      title: '簡而言之',
      blocks: [
        {
          list: [
            '我們只收集營運本遊戲所需的資料：你的帳號資料、你的對局，以及能幫助我們了解遊戲玩法並修正問題的使用資料。',
            '**沒有廣告，我們也不販售資料。**我們不會在其他應用程式或網站上追蹤你。',
            '你的顯示名稱、頭像、國家/地區、積分和統計資料會向其他玩家顯示。你的電子郵件絕不會向其他玩家顯示。',
            '你可以隨時在應用程式中刪除帳號：設定 → 刪除帳號。請參閱[帳號刪除頁面](delete-account)。',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: '帳號資料',
      blocks: [
        '你註冊時，我們會保存：',
        {
          list: [
            '**電子郵件：**用於登入、驗證地址、重設密碼及寄送帳號相關訊息。我們不會寄送行銷郵件。',
            '**密碼**（以電子郵件和密碼註冊時）：由 Google 的 Firebase Authentication 處理。密碼絕不會傳到我們的伺服器，我們也看不到。',
            '**使用 Google 帳號登入（選用）：**你可以用 Google 帳號註冊及登入，而不使用電子郵件和密碼。此時 Firebase Authentication 會從 Google 取得你 Google 帳號的電子郵件（已由 Google 驗證）及其 Google ID，並與你的登入資料一併保存；我們則和任何帳號一樣保存該電子郵件。Google 也會向 Firebase 提供你的 Google 名稱和個人資料相片，Firebase 會將其與登入資料一併保存。我們的伺服器不會儲存或顯示這些資料：在競技場中只會出現你自己選擇的名稱和頭像。我們絕不會取得你的 Google 密碼，也無法存取你 Google 帳號中的任何其他內容（聯絡人、電子郵件、檔案）。如果你願意，也可以改用電子郵件和密碼註冊。',
            '**顯示名稱、國家/地區和頭像：**由你自己選擇，並會向其他玩家顯示。國家/地區由你自己挑選（預設值來自你裝置的語言和地區設定）。我們不會使用你裝置的位置資訊。',
            '**帳號建立的時間，以及名稱上次變更的時間**（名稱每30天只能變更一次）。',
            '**我們的帳號 ID**，以及你的 Firebase 登入 ID（使用 Google 登入時，Firebase 也會保存你的 Google 帳號 ID）。',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: '對局與進度',
      blocks: [
        {
          list: [
            '**排位對局**（保存在伺服器上）：盤面、每一步及其時間、你發送的干擾和表情、你的得分、錯誤、名次、對局前後的積分，以及對局如何結束。這些資料構成你的紀錄、重播和統計資料。',
            '**與好友的對局**（在使用代碼的房間中進行；和排位對局一樣保存在伺服器上，但不計積分）：保存的資料相同，只是沒有積分。這些對局會出現在你的紀錄和重播中，與你同場的玩家會出現在「最近的對手」之下。房間的代碼、誰在房間裡，以及誰被移出房間，只保存在伺服器的記憶體中，直到房間關閉為止。',
            '**積分、XP、等級和成就。**',
            '**你玩過哪些題目，以及對手是誰：**這樣你就不會一再遇到相同的題目或對手。',
            '**你的節奏：**每場排位對局結束時，我們會根據你的每一步，算出你每一步的平均用時（並考量每一格的難度），並將其與該場對局一起保存，同時記下計算所依據的步數。當沒有玩家可配對時，我們會根據你的節奏、你的錯誤率，以及你對電腦控制對手的戰績，來設定電腦控制對手的節奏（請參閱[使用條款](terms)）。你的節奏不會向其他玩家顯示。',
            '**練習成績**（單人或對機器人），在應用程式為了 XP 回報時：模式、對局類型、結果、正確步數、結束時間，以及獲得的 XP。',
            '**關卡練習：**當應用程式將你的進度同步到你的帳號時（這樣換了新手機也能找回）：你在每個關卡的最佳星數、你玩過幾次以及這些資料何時變更，還有每天從關卡獲得的 XP。',
            '**公平競賽：**當排位對局中的操作速度異常快時，會留下一筆紀錄，供人工審查。系統不會因此自動採取任何行動。',
            '**檢舉與封鎖：**請參閱下方的「檢舉與封鎖」。',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: '使用資料',
      blocks: [
        '為了了解本遊戲的使用情形，應用程式會向我們的伺服器回報事件。每個事件都有各自的隨機 ID，以及你手機上的時間；伺服器會加上收到事件的時間。',
        '每次回報也會附帶一個**安裝 ID**：這是應用程式首次啟動時產生、並保存在應用程式中的隨機數字。它不是根據你裝置的資訊產生的，解除安裝應用程式後就會消失。一併傳送的還有作業系統（iOS 或 Android）和應用程式的版本。',
        '你登入期間，事件和該次安裝會與你的帳號連結。沒有連線時，事件會先保留在你的手機上，稍後再傳送。',
        '事件如下：',
        { table: { head: ['事件', '時機', '包含的內容'], rows: eventRows() } },
        '相同的事件也會傳送到 **Google Analytics for Firebase**，它會加上應用程式安裝的 ID、裝置和系統資訊、使用資料（例如工作階段長度），以及 Google 根據 IP 位址推斷的大略位置（國家和地區）。我們在設定時未啟用廣告功能：沒有廣告 ID，也沒有個人化廣告。',
      ],
    },
    {
      id: 'crashes',
      title: '當機與錯誤報告',
      blocks: [
        {
          list: [
            '**應用程式中，Google 的 Firebase Crashlytics：**當應用程式當機或發生錯誤時，會傳送一份報告，內容包括錯誤的詳細資訊、裝置型號、系統和應用程式版本、Crashlytics 安裝 ID，以及你登入期間我們的帳號 ID。不包括你的電子郵件或名稱。',
            '**伺服器上，Sentry：**當伺服器發生錯誤時，會傳送一份相關的技術報告，有時會附帶相關帳號的 ID。不包含電子郵件，也不包含密碼。',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'IP 位址',
      blocks: [
        '應用程式連線時，我們的伺服器會看到你的 IP 位址。我們**只在伺服器的記憶體中**使用它，用來限制請求頻率並防範大量請求攻擊，不會將它儲存在我們的資料庫中。',
        '我們的主機服務供應商可能會短期保留一般的存取記錄。',
      ],
    },
    {
      id: 'device',
      title: '只保留在你手機上的資料',
      blocks: [
        {
          list: [
            '你的練習對局及其紀錄。',
            '你的關卡練習進度：星數、嘗試次數，以及你打開的大門（伺服器上也保留一份副本：請參閱「對局與進度」）。',
            '你的設定：音效、震動回饋、減少動態效果和語言。',
            '你的個人檔案副本，讓應用程式在沒有連線時也能開啟。',
            '尚未傳送的事件和練習成績佇列，以及安裝 ID。',
            '你的登入狀態（由 Firebase 保存），以及使用 Google 登入時你所選擇的帳號（由 Google Play 服務保存，直到你登出為止）。',
          ],
        },
        '解除安裝應用程式時，以上資料都會被刪除。登出會刪除個人檔案副本。刪除帳號不會刪除你手機上的練習對局和關卡練習進度：如果也要刪除這些資料，請解除安裝應用程式。',
      ],
    },
    {
      id: 'not-collected',
      title: '我們不收集的資料',
      blocks: [
        '聯絡人、相片、麥克風、相機、精確位置、廣告 ID 和付款資訊。本遊戲沒有聊天功能：表情是從固定清單中選擇的表情符號。',
      ],
    },
    {
      id: 'public',
      title: '其他玩家看得到的資料',
      blocks: [
        {
          list: [
            '你的顯示名稱、頭像、國家/地區（以國旗顯示）、積分、等級和成就。',
            '在你的玩家卡片和排行榜上：對局數、勝率、連勝紀錄、最佳一步、平均錯誤次數、近期戰績、你最常發送的干擾，以及你加入的時間（月份和年份）。',
            '對局進行中：你的得分、錯誤、干擾和表情，以及你是否在線上。',
            '在與好友對局的房間中：任何擁有房間代碼或連結並進入房間的人，都能看到房間內每個人的名稱、頭像、國旗和綜合積分，以及他們目前是否在房間裡。代碼和連結本身不帶有任何個人資訊。',
            '重播和對局詳情：僅限該場對局的玩家查看。',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: '檢舉與封鎖',
      blocks: [
        {
          list: [
            '**檢舉玩家：**當你檢舉某人時，我們會保存檢舉人、被檢舉人、原因（冒犯性名稱、作弊或其他）、檢舉若來自某場排位對局則包含該場對局，以及檢舉時間。檢舉不含自由輸入的文字。被檢舉的玩家不會得知是誰檢舉了他們。',
            '**封鎖：**我們會保存你封鎖了哪些玩家，以及封鎖的時間。因此，你不會被分配到與他們同一場對局，他們的表情也不會顯示給你。沒有人會被告知自己遭到封鎖，而且封鎖不會讓任何人從排行榜上隱藏。',
            '**處理檢舉：**本遊戲的營運者會在48小時內審查每一則檢舉。營運者可以將冒犯性的名稱替換為臨時名稱（該玩家之後會被要求選擇新名稱），或將帳號停權，使其無法參加排位對局及變更帳號。每一項此類處置都會記入內部記錄，並附上執行該處置之管理員的地址；名稱遭替換時，也會記下新舊名稱。以此方式被替換的名稱會列入一份任何人都不得再選用的名稱清單（僅名稱本身，不與任何玩家連結）。',
            '**遭停權的帳號被刪除時：**刪除帳號不會解除停權。遭停權的帳號被刪除時，我們會保存其登入 ID 及其已驗證電子郵件地址的單向指紋（雜湊值），而不是 ID 或地址本身。使用相同登入方式的新帳號在建立時即處於停權狀態，直到管理員審查為止，屆時該指紋會被刪除。這是基於我們以及每一位玩家對公平競賽的正當利益。',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: '我們為何使用這些資料',
      blocks: [
        {
          list: [
            '**營運本遊戲：**你的帳號、對局、積分、配對、紀錄和排行榜。這是履行我們與你之間的協議（使用條款）所必需的。',
            '**安全與公平競賽：**請求頻率限制、偵測異常、防止作弊，以及處理檢舉和封鎖。這是基於我們以及每一位玩家的正當利益。',
            '**改善本遊戲：**了解哪些畫面和模式被使用、找出問題並修正當機。這同樣是正當利益，且不涉及任何廣告，也不建立行銷剖析資料。',
            '**服務郵件：**僅限地址驗證和密碼重設。',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: '我們與誰分享資料',
      blocks: [
        '我們**不販售**資料，也不會將資料提供給廣告商或資料仲介。我們的服務供應商僅代表我們處理資料：',
        {
          list: [
            '**Google（Firebase）：**登入（Authentication，包括使用 Google 登入）、當機報告（Crashlytics）和使用資料（Analytics）。',
            '**Fly.io：**伺服器的主機服務。',
            '**Neon：**資料庫（PostgreSQL）。',
            '**Sentry：**伺服器錯誤報告。',
          ],
        },
        '在法律要求時，或為了保護本遊戲及其玩家，我們也會揭露資料。如果本遊戲轉讓給其他擁有者，資料將隨之轉移，且本政策將繼續適用於這些資料。',
      ],
    },
    {
      id: 'transfers',
      title: '資料存放在哪裡',
      blocks: [
        '伺服器和資料庫目前位於歐盟（德國法蘭克福）。Google 和 Sentry 也可能在美國及其他國家處理資料，並適用其各自的資料傳輸保護措施（例如歐盟標準契約條款）。',
      ],
    },
    {
      id: 'retention',
      title: '我們保存多久',
      blocks: [
        {
          list: [
            '**帳號資料：**只要帳號存在就會保存。',
            '**刪除帳號時：**你的電子郵件、國家/地區、頭像和登入連結會立即刪除，你的顯示名稱會被替換為匿名 ID（原本的名稱會立即開放再次選用）。你的 Firebase 登入資料也會一併刪除，包括其從 Google 保存的資料。如果你曾使用 Google 登入，應用程式也會撤銷其對你 Google 帳號的存取權。',
            '**關卡練習進度：**伺服器上的副本（你在每個關卡的星數，以及每天從關卡獲得的 XP）會隨帳號一併刪除。你手機上的副本會保留到你解除安裝應用程式為止。',
            '**刪除後以匿名方式保留的資料：**排位對局、積分、XP、練習成績、公平競賽紀錄、你送出的檢舉和使用資料。這些資料不再與你連結，但其他玩家的對局、重播和排行榜仍保持完整。',
            '**檢舉、封鎖和管理員記錄：**封鎖會保留到你解除封鎖或刪除帳號為止（屆時該帳號的所有封鎖都會刪除，雙向皆然）。檢舉和管理員操作記錄會在處理檢舉、維護遊戲安全與公平所需的期間內保留；我們會定期審查並刪除舊的記錄。帳號被刪除時，與其相關的未結檢舉會被結案，其名稱也會從管理員記錄中移除。如果該帳號曾遭停權，只會保留上述的單向指紋，直到有人以相同登入方式建立新帳號，或我們在定期審查中將其刪除為止。',
            '**使用資料：**在有助於我們了解遊戲使用情形的期間內保留。我們會定期審查並刪除舊的資料。',
            '**Crashlytics：**Google 最多保留當機報告90天。**Analytics：**依我們在 Firebase 中設定的保留期限保留。',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: '你的權利',
      blocks: [
        '你可以要求查看你的資料、更正資料（你可以在應用程式中變更名稱、頭像和國家/地區）、刪除資料（在應用程式中刪除帳號），或反對資料的使用。請寫信到{email}與我們聯絡，我們會在30天內回覆。',
        '你也可以向以色列隱私保護局，或你所在國家的資料保護機關提出申訴。',
      ],
    },
    {
      id: 'children',
      title: '兒童',
      blocks: [
        '本遊戲並非為未滿13歲的兒童設計，我們也不會在知情的情況下收集與他們有關的資料。如果我們得知有未滿13歲的兒童開設了帳號，我們會將該帳號刪除。若當地規定的最低年齡更高，則在達到該年齡之前須取得父母的同意。',
      ],
    },
    {
      id: 'security',
      title: '安全性',
      blocks: [
        '應用程式和伺服器之間的傳輸經過加密（HTTPS 和 WSS）。密碼由 Firebase 處理，我們不會儲存。伺服器上資料的存取權僅限於本遊戲的營運者。沒有任何系統是絕對安全的，但我們會盡合理的努力保護你的資料。',
      ],
    },
    {
      id: 'changes',
      title: '本政策的變更',
      blocks: ['本政策變更時，我們會更新此處的日期。重大變更也會在應用程式中公告。'],
    },
    {
      id: 'contact',
      title: '聯絡我們',
      blocks: ['{operator} · {email}', '另請參閱[使用條款](terms)。'],
    },
  ],
};

export const TERMS_ZH_HANT: LegalDoc = {
  title: '使用條款',
  lead: '使用 Sudoku Fight 的規則。使用本遊戲即表示你接受這些規則。',
  sections: [
    {
      id: 'acceptance',
      title: '接受條款',
      blocks: [
        '本條款適用於 Sudoku Fight 應用程式及其服務（「本遊戲」），由{operator}（「我們」）營運。註冊或使用本遊戲，即表示你接受本條款及[隱私權政策](privacy)。',
      ],
    },
    {
      id: 'eligibility',
      title: '誰可以玩',
      blocks: [
        '你必須年滿13歲；若你所在國家的法律規定的最低年齡更高，則須達到該年齡。未滿18歲者須取得父母或監護人的同意。',
      ],
    },
    {
      id: 'account',
      title: '你的帳號',
      blocks: [
        {
          list: [
            '每人一個帳號，並使用你自己的電子郵件。',
            '請妥善保管你的密碼（或你用來登入的 Google 帳號）。你須為使用你的帳號所進行的一切行為負責。',
            '你可以隨時在應用程式中刪除帳號：設定 → 刪除帳號。',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: '顯示名稱與行為規範',
      blocks: [
        '你的顯示名稱、頭像和國家/地區對所有玩家可見。名稱不得：',
        {
          list: [
            '具冒犯性、種族歧視、色情、威脅或侮辱意味；',
            '冒充他人、其他玩家或本遊戲的工作人員；',
            '包含個人資訊（電話號碼、地址）、廣告或連結。',
          ],
        },
        '名稱會自動與一份禁用字詞清單進行比對。對於違反這些規則的名稱，我們可以變更該名稱、要求提供新名稱，或將帳號停權。',
        '遊戲中的表情是從固定清單中選擇的表情符號。在對局中，你可以從對手的卡片將其設為靜音、封鎖對方，或檢舉對方（見下一節）。',
      ],
    },
    {
      id: 'reports',
      title: '檢舉與封鎖',
      blocks: [
        '你可以從玩家的卡片或從對局中檢舉玩家，並從三種原因中選擇一種：冒犯性名稱、作弊或其他。**我們會在48小時內審查每一則檢舉。**',
        '若有違反規則的情形，我們可以將名稱替換為臨時名稱（該玩家之後會被要求選擇新名稱，且這次選擇不受30天規則限制）、將帳號停權，使其無法參加排位對局及變更帳號，直到停權解除為止，或關閉該帳號。以此方式被替換的名稱不能再被選用。遭停權的帳號仍可隨時刪除，但刪除帳號不會解除停權：使用相同登入方式的新帳號在建立時即處於停權狀態，直到我們審查為止。',
        '你也可以封鎖玩家：你不會被分配到與對方同一場對局，對方的表情也不會顯示給你。你可以在「設定 → 已封鎖的玩家」中解除封鎖。封鎖不會讓任何人從排行榜上隱藏。',
        '請勿無故檢舉：一再提出不實檢舉即違反本條款。',
      ],
    },
    {
      id: 'fair-play',
      title: '公平競賽',
      blocks: [
        '你不得：',
        {
          list: [
            '使用數獨解題程式、機器人、腳本、自動化工具或經過修改的應用程式；',
            '擁有多個帳號以影響積分、與其他玩家串通對局結果，或故意輸掉；',
            '利用程式錯誤而不回報；',
            '使我們的伺服器超載、嘗試入侵伺服器，或妨礙其他玩家。',
          ],
        },
        '伺服器會標記異常的對局以供審查。若有違反規則的情形，我們可以取消成績、重設積分，或將帳號停權及關閉。',
      ],
    },
    {
      id: 'virtual',
      title: '積分、XP 與成就',
      blocks: [
        '積分、XP、等級和成就不具任何金錢價值，也不能轉讓或出售。我們可以變更其計算方式或將其重設（例如在賽季開始時）。',
        '本遊戲免費。此版本沒有任何購買項目，也沒有廣告。',
      ],
    },
    {
      id: 'service',
      title: '服務可用性',
      blocks: [
        '排位對局需要網路連線。沒有玩家可配對時，你可能會被配對到一個以與你相近的節奏進行遊戲的電腦控制對手。這類對局會計入你的積分。本遊戲也可能提供與機器人進行的練習對局，不計積分。若伺服器在排位對局進行中重新啟動，該場對局將會結束，且積分不會變動。',
        '我們可以變更、暫停或停止本遊戲的部分內容，並會盡量就重大變更事先通知。',
      ],
    },
    {
      id: 'ip',
      title: '智慧財產權',
      blocks: [
        '本遊戲及其設計、程式碼、音效和頭像歸我們或授權給我們的權利人所有。我們依本條款授予你個人、非專屬、非商業性的授權，以使用本遊戲。第三方授權列於應用程式中：設定 → 授權。',
      ],
    },
    {
      id: 'stores',
      title: '應用程式商店',
      blocks: [
        'Apple 和 Google 並非本條款的當事人，也不對本遊戲負責。如果你是從 App Store 下載本遊戲，Apple 的標準終端使用者授權合約（EULA）也同樣適用，且 Apple 及其子公司得以第三方受益人的身分執行本條款。',
      ],
    },
    {
      id: 'disclaimer',
      title: '免責聲明',
      blocks: [
        '本遊戲依「現狀」提供。在法律允許的範圍內，我們不保證本遊戲會不中斷或無錯誤地運作，對於間接損害、資料遺失或積分損失，我們也不承擔責任。本條款中的任何內容，均不限制法律賦予你且不得拋棄的權利。',
      ],
    },
    {
      id: 'termination',
      title: '終止',
      blocks: ['你可以隨時停止遊玩並刪除帳號。對於違反本條款的帳號，我們可以將其停權或關閉。'],
    },
    {
      id: 'changes',
      title: '本條款的變更',
      blocks: [
        '本條款變更時，我們會更新此處的日期。重大變更也會在應用程式中公告。變更後繼續使用本遊戲，即表示你接受新的條款。',
      ],
    },
    {
      id: 'law',
      title: '準據法',
      blocks: [
        '本條款受以色列國法律管轄，並由特拉維夫地區的管轄法院專屬管轄，但你所在國家的法律賦予你不得拋棄之權利者，不在此限。',
      ],
    },
    {
      id: 'contact',
      title: '聯絡我們',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_ZH_HANT: LegalDoc = {
  title: '刪除帳號',
  lead: '如何刪除你的 Sudoku Fight 帳號，以及你的資料會如何處理。',
  sections: [
    {
      id: 'in-app',
      title: '在應用程式中（立即生效）',
      blocks: [
        {
          list: [
            '開啟 Sudoku Fight，前往**設定**。',
            '點選**刪除帳號**並確認。',
            '輸入你的密碼；如果你使用 Google 登入，請再次選擇你的 Google 帳號。帳號會立即刪除，應用程式會回到登入畫面。',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: '不使用應用程式',
      blocks: [
        '請**使用你帳號的電子郵件地址**寫信到{email}，主旨為「刪除我的帳號」，並附上你的顯示名稱。我們會確認請求來自帳號擁有者，並在30天內刪除帳號。完成後，我們會以電子郵件確認。',
      ],
    },
    {
      id: 'what',
      title: '哪些資料會被刪除、哪些會保留',
      blocks: [
        {
          list: [
            '**立即刪除：**你的電子郵件、國家/地區、頭像、你的登入資料（包括 Firebase 中的登入資料），以及你的帳號與各次安裝之間的連結。你的顯示名稱會被替換為匿名 ID，並開放給其他人使用。',
            '**匿名保留：**排位對局、積分、XP、練習成績、公平競賽紀錄和使用資料。這些資料不再與你連結，但其他玩家的對局和排行榜仍保持完整。',
            '**你的手機上：**你手機上的練習對局會保留到你解除安裝應用程式為止。',
            '**Google 方面：**當機報告最多保留90天，Analytics 資料則依所設定的保留期限保留。',
          ],
        },
        '詳情請參閱[隱私權政策](privacy)。',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_ZH_HANT: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_ZH_HANT,
  terms: TERMS_ZH_HANT,
  'delete-account': DELETE_ACCOUNT_ZH_HANT,
};
