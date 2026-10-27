import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Simplified Chinese (D112, Moshe 2026-10-23): a translation of the English version (privacy.ts,
 * terms.ts, deleteAccount.ts, render.ts LEGAL_CHROME.en), section by section, with the same anchors, block shapes,
 * links, contact marks ({email}, {operator}), `code` marks and numbers (legal.test.ts `skeleton`). 你 throughout
 * (D122, docs/i18n/style/zh-Hans.md), full-width punctuation, half-width Western digits with no space next to
 * Chinese (D108), one space around a Latin word; a count that English writes as a word stays a Chinese numeral
 * here (一次, 三个), so no number is added to the skeleton.
 *
 * Terms from docs/i18n/glossary.csv: 对局 (one game), 游戏 / 本游戏 (the game itself), 对手, 排位对局, 积分, 练习,
 * 关卡, 关卡练习, 章, 星, 回放, 干扰, 表情 (reaction), 举报, 屏蔽, 房间, 格, 盘面, 错误, 等级, XP. The account is
 * 账号; the operator 运营者; an account's suspension is 暂停 (the board's cell lock, 锁定, never appears here);
 * "blocked words" are 违禁词, so they are not confused with blocking a player (屏蔽). "Country" is 国家/地区, as
 * mainland apps name the field; a country as a jurisdiction stays 国家.
 *
 * Words quoted from the app (they must equal the app's zh-Hans strings, apps/mobile/src/i18n/locales/zh-Hans):
 * - 设置 = home:settings.title
 * - 删除账号 = account:settings.deleteAccount
 * - 已屏蔽的玩家 = moderation:blocked.settingsRow
 * - 许可证 = home:settings.licenses
 * - “最近的对手” = progress:leaderboard.caption.friends (en "Your recent opponents"; quoted without "Your" (你),
 *   as the English quotes "recent opponents")
 * - “玩法说明” = levels:tutorial.title (event level_tutorial)
 * - 隐私政策 / 使用条款 = home:settings.privacy / home:settings.terms (by meaning)
 * - 对局类型 (game type, in the event table and practice results) = friends:gameType.title
 * - 排行榜 (leaderboards) = ui:nav.tabs.leaderboard
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_ZH_HANS = '本文为英文版本的译文。如两者存在差异，以英文版本为准。';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_ZH_HANS: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: '语言',
  contents: '目录',
  documents: '文档',
  updated: '最后更新：',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[运营者名称]',
  draft: '草稿：服务器上尚未设置联系方式（LEGAL_CONTACT_EMAIL、LEGAL_OPERATOR_NAME）。',
  translationNotice: TRANSLATION_NOTICE_ZH_HANS,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `zh-Hans`): [what happens, what it carries]. */
export const EVENT_DETAILS_ZH_HANS: Record<TelemetryEventName, [string, string]> = {
  app_open: ['打开应用', '—'],
  screen_view: ['打开一个界面', '界面的名称（其路由模式，不含 ID）'],
  register_step: ['打开注册流程中的一个步骤', '该步骤'],
  register_complete: ['完成注册', '—'],
  game_start: ['对局开始', '模式、对局类型、玩家人数，以及是否为与好友的对局'],
  game_end: ['对局结束', '模式、结果、得分、错误次数、时长，以及是否为与好友的对局'],
  interference_sent: ['你发送干扰', '干扰的种类和花费'],
  reaction_sent: ['你发送表情', '是哪个 emoji'],
  matchmaking_wait: ['一次寻找对手结束', '等待的秒数，以及是否找到了对局'],
  reconnect: ['断线后重新连接', '耗时多久，以及是否成功'],
  latency_sample: ['一次连接质量采样', '网络响应时间，以毫秒计'],
  replay_open: ['打开回放', '对局的模式'],
  account_delete: ['账号被删除', '—'],
  report_sent: ['你举报一名玩家', '仅举报原因（不含被举报的是谁，也不含对局）'],
  level_map_open: ['打开关卡练习地图', '当前关卡和你的星星总数'],
  level_start: [
    '关卡开始',
    '关卡的编号和版本、所属的章和类型、第几次尝试、你此前的最佳星数，以及是否为快速开始',
  ],
  level_end: [
    '关卡结束',
    '关卡的编号、版本和类型、星数、你在此之前的最佳星数、时长、结束方式、错误次数、成绩（时间、位置、领先分差或分数）、机器人的等级，以及第几次尝试',
  ],
  level_quit: ['中途离开关卡（例如应用被关闭）', '关卡的编号和版本，以及已进行了多长时间'],
  chapter_gate: ['尝试通过通往下一章的关口', '关口后面的章、该章中的星数，以及关口是否打开'],
  level_tutorial: ['显示某类关卡的“玩法说明”', '关卡类型，以及你是否跳过了它'],
  friends_room_open: ['开设一个与好友对局的房间', '对局类型，以及房间是如何开设的'],
  friends_room_join: ['尝试加入好友的房间', '方式（房间码或链接），以及结果（成功，或失败的原因）'],
  friends_invite_share: ['分享房间的链接', '分享者是房主还是受邀玩家（不含房间码，也不含分享给了谁）'],
  friends_link_open: ['房间链接打开了应用', '你当时是否已登录'],
  friends_room_start: ['与好友的对局开始', '玩家人数，以及你在房间里等待了多少秒'],
  friends_room_close: ['对局开始前你离开了房间', '原因、房间里有多少名玩家，以及你等待了多少秒'],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_ZH_HANS) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_ZH_HANS[name],
  ]);

export const PRIVACY_ZH_HANS: LegalDoc = {
  title: '隐私政策',
  lead: 'Sudoku Fight 收集哪些信息、为何收集、谁能看到、保存多久，以及如何删除。',
  sections: [
    {
      id: 'who',
      title: '我们是谁',
      blocks: [
        'Sudoku Fight（以下称“本游戏”或“我们”）是一款由{operator}运营的实时竞技数独游戏。',
        '如对隐私和你的数据有任何疑问，请发送邮件至{email}与我们联系。',
      ],
    },
    {
      id: 'summary',
      title: '概要',
      blocks: [
        {
          list: [
            '我们只收集运行本游戏所需的信息：你的账号信息、你的对局，以及帮助我们了解本游戏如何被使用并解决问题的使用数据。',
            '**没有广告，我们也不出售数据。**我们不会在其他应用或网站上追踪你。',
            '你的显示名称、头像、国家/地区、积分和统计数据对其他玩家可见。你的电子邮箱绝不会向其他玩家显示。',
            '你可以随时在应用内删除账号：设置 → 删除账号。请参阅[账号删除页面](delete-account)。',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: '账号信息',
      blocks: [
        '你注册时，我们会保存：',
        {
          list: [
            '**电子邮箱：**用于登录、验证邮箱地址、重置密码以及发送账号相关消息。我们不发送营销邮件。',
            '**密码**（使用电子邮箱和密码注册时）：由 Google 的 Firebase Authentication 处理。密码绝不会到达我们的服务器，我们也无法看到它。',
            '**使用 Google 登录（可选）：**你可以使用 Google 账号注册和登录，而不使用电子邮箱和密码。此时，Firebase Authentication 会从 Google 收到你 Google 账号的电子邮箱（已由 Google 验证）及其 Google ID，并将它们与你的登录信息一起保存；与任何账号一样，我们会保存该电子邮箱。Google 还会向 Firebase 提供你的 Google 名称和个人资料照片，Firebase 会将它们与登录信息一起保存。我们的服务器不会存储或显示它们：在竞技场中只会显示你自己选择的名称和头像。我们绝不会获得你的 Google 密码，也无法访问你 Google 账号中的任何其他内容（联系人、邮件、文件）。如果你愿意，也可以使用电子邮箱和密码注册。',
            '**显示名称、国家/地区和头像：**由你选择，并会向其他玩家显示。国家/地区由你自己选择（默认值来自你设备的语言和地区设置）。我们不使用你设备的位置信息。',
            '**账号的创建时间和名称的最近一次修改时间**（名称每30天只能修改一次）。',
            '**我们的账号 ID**，以及你的 Firebase 登录 ID（使用 Google 登录时，Firebase 还会保存你的 Google 账号 ID）。',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: '对局和进度',
      blocks: [
        {
          list: [
            '**排位对局**（保存在服务器上）：盘面、每一步及其时间、你发送的干扰和表情、你的得分、错误、名次、对局前后的积分，以及对局的结束方式。它们构成你的历史记录、回放和统计数据。',
            '**与好友的对局**（在使用房间码的房间中进行；与排位对局一样保存在服务器上，但不计积分）：保存的内容相同，积分除外。它们会出现在你的历史记录和回放中，与你一起玩过的玩家会出现在“最近的对手”中。房间码、房间里有谁以及谁被移出了房间，仅保存在服务器的内存中，直到房间关闭。',
            '**积分、XP、等级和成就。**',
            '**你玩过哪些题目，以及与谁对战：**这样你就不会一次又一次地遇到同一道题目或同一个对手。',
            '**你的节奏：**每局排位对局结束时，我们会根据你的走法计算出你每一步的平均用时（并考虑每个格的难度），将其与该对局一起保存，同时保存计算所依据的步数。当没有可匹配的玩家时，我们会根据你的节奏、你的错误率以及你与电脑控制的对手对战的结果，来设定电脑控制的对手的节奏（参见[使用条款](terms)）。你的节奏不会向其他玩家显示。',
            '**练习成绩**（单人或与机器人对战），在应用为获得 XP 而上报时保存：模式、对局类型、结果、正确步数、结束时间，以及获得的 XP。',
            '**关卡练习：**当应用将你的进度同步到你的账号时（这样换了新手机也能恢复）：你在每个关卡的最佳星数、你玩该关卡的次数及其变化时间，以及各关卡每天给你的 XP。',
            '**公平竞技：**当某局排位对局中的落子速度异常快时，会保留一条记录，供人工审核。不会因此自动采取任何措施。',
            '**举报和屏蔽：**参见下文“举报和屏蔽”。',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: '使用数据',
      blocks: [
        '为了解本游戏的使用情况，应用会向我们的服务器上报事件。每个事件都有自己的随机 ID 和你手机上的时间；服务器会加上它收到该事件的时间。',
        '每次上报还会附带一个**安装 ID**：首次启动时生成并保存在应用中的随机数。它不基于你设备的信息，卸载应用后即消失。与它一同上报的还有系统（iOS 或 Android）和应用的版本。',
        '在你登录期间，事件和安装会与你的账号关联。没有网络连接时，事件会暂存在你的手机上，稍后再发送。',
        '这些事件：',
        { table: { head: ['事件', '触发时机', '包含的内容'], rows: eventRows() } },
        '同样的事件也会发送到 **Google Analytics for Firebase**，它会加上一个应用安装 ID、设备和系统信息、使用数据（例如会话时长），以及 Google 根据 IP 地址推断出的大致位置（国家和地区）。我们在设置时没有启用广告功能：没有广告 ID，也没有个性化广告。',
      ],
    },
    {
      id: 'crashes',
      title: '崩溃和错误报告',
      blocks: [
        {
          list: [
            '**应用内，Google 的 Firebase Crashlytics：**当应用崩溃或遇到错误时，会发送一份报告，其中包含错误的详情、设备型号、系统和应用的版本、一个 Crashlytics 安装 ID，以及在你登录期间我们的账号 ID。不包含你的电子邮箱或名称。',
            '**服务器端，Sentry：**当服务器遇到错误时，会发送一份相关的技术报告，有时附带所涉及账号的 ID。不包含电子邮箱，也不包含密码。',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'IP 地址',
      blocks: [
        '应用连接时，我们的服务器会看到你的 IP 地址。我们**仅在服务器的内存中**使用它，用于限制请求频率和防范流量攻击，不会将其存储在我们的数据库中。',
        '我们的托管服务提供商可能会在短时间内保留常规的访问日志。',
      ],
    },
    {
      id: 'device',
      title: '仅保存在你手机上的内容',
      blocks: [
        {
          list: [
            '你的练习对局及其历史记录。',
            '你的关卡练习进度：星数、尝试次数以及你打开的关口（服务器上也保存一份副本：参见“对局和进度”）。',
            '你的设置：声音、触感反馈、减弱动态效果和语言。',
            '你的个人资料副本，以便应用在没有网络连接时也能打开。',
            '尚未发送的事件和练习成绩的队列，以及安装 ID。',
            '你的登录信息（由 Firebase 保存），以及使用 Google 登录时你选择的账号（由 Google Play 服务保存，直到你退出登录）。',
          ],
        },
        '卸载应用后，以上所有内容都会被删除。退出登录会删除个人资料副本。删除账号不会删除你手机上的练习对局和关卡练习进度：如需一并删除，请卸载应用。',
      ],
    },
    {
      id: 'not-collected',
      title: '我们不收集的内容',
      blocks: [
        '联系人、照片、麦克风、摄像头、精确位置、广告 ID 和支付信息。本游戏没有聊天功能：表情是从固定列表中选择的 emoji。',
      ],
    },
    {
      id: 'public',
      title: '其他玩家能看到的内容',
      blocks: [
        {
          list: [
            '你的显示名称、头像、国家/地区（以旗帜显示）、积分、等级和成就。',
            '在你的玩家卡片和排行榜上：对局数、胜率、连胜记录、最佳一步、平均错误数、近期成绩、你最常发送的干扰，以及你的加入时间（年和月）。',
            '对局中：你的得分、错误、干扰和表情，以及你是否在线。',
            '在与好友对局的房间中：任何拥有房间码或链接并进入房间的人，都能看到房间里每个人的名称、头像、旗帜和综合积分，以及他们此刻是否在房间里。房间码和链接本身不包含任何个人信息。',
            '回放和对局详情：仅该对局的玩家可见。',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: '举报和屏蔽',
      blocks: [
        {
          list: [
            '**举报玩家：**当你举报某人时，我们会保存举报人、被举报人、原因（冒犯性名称、作弊或其他）、举报来自排位对局时的该对局，以及举报时间。举报没有自由填写的文字。被举报的玩家不会被告知是谁举报了他们。',
            '**屏蔽：**我们会保存你屏蔽的玩家以及屏蔽时间。因此，你不会与他们被分到同一局对局中，他们的表情也不会向你显示。任何人都不会被告知自己被屏蔽，屏蔽也不会让任何人从排行榜中隐藏。',
            '**处理举报：**游戏运营者会在48小时内审核每一条举报。运营者可能会将冒犯性名称替换为临时名称（随后会要求该玩家选择新名称），或暂停账号参与排位对局和修改账号信息。每项此类操作都会记入内部日志，并附上执行操作的管理员的地址，以及名称被替换时的新旧名称。以这种方式被替换的名称会被列入任何人都不能再选用的名称列表（仅名称本身，不与任何玩家关联）。',
            '**被删除的已暂停账号：**删除账号并不会解除暂停。当已暂停的账号被删除时，我们会保留其登录 ID 和已验证电子邮箱地址的单向指纹（哈希值），而不是 ID 或地址本身。使用相同登录方式的新账号一开始就处于暂停状态，直到管理员对其进行审核，之后该指纹即被删除。这是出于我们以及每位玩家在公平竞技方面的正当利益。',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: '我们为何使用这些数据',
      blocks: [
        {
          list: [
            '**运行本游戏：**你的账号、对局、积分、匹配、历史记录和排行榜。这是履行我们与你之间的协议（使用条款）所必需的。',
            '**安全和公平竞技：**限制请求频率、发现异常、防止作弊，以及处理举报和屏蔽。这是我们以及每位玩家的正当利益。',
            '**改进本游戏：**了解哪些界面和模式被使用、发现问题并修复崩溃。这同样属于正当利益，不涉及广告，也不建立营销画像。',
            '**服务邮件：**仅用于验证邮箱地址和重置密码。',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: '我们与谁共享数据',
      blocks: [
        '我们**不出售**数据，也不会将数据提供给广告商或数据经纪商。我们的服务提供商仅代表我们处理这些数据：',
        {
          list: [
            '**Google（Firebase）：**登录（Authentication，包括使用 Google 登录）、崩溃报告（Crashlytics）和使用数据（Analytics）。',
            '**Fly.io：**服务器托管。',
            '**Neon：**数据库（PostgreSQL）。',
            '**Sentry：**服务器错误报告。',
          ],
        },
        '在法律要求时，或为了保护本游戏及其玩家，我们也会披露数据。如果本游戏转归其他所有者，数据将随之转移，本政策将继续适用于这些数据。',
      ],
    },
    {
      id: 'transfers',
      title: '数据存放在哪里',
      blocks: [
        '服务器和数据库目前位于欧盟（德国法兰克福）。Google 和 Sentry 也可能在美国及其他国家处理数据，并采用其各自的数据传输保障措施（例如欧盟标准合同条款）。',
      ],
    },
    {
      id: 'retention',
      title: '我们保存数据多久',
      blocks: [
        {
          list: [
            '**账号信息：**在账号存续期间保存。',
            '**你删除账号时：**你的电子邮箱、国家/地区、头像和登录关联会立即删除，你的显示名称会被替换为匿名 ID（旧名称会立即释放，可供他人使用）。你的 Firebase 登录信息也会一并删除，包括它从 Google 获得并保存的信息。如果你曾使用 Google 登录，应用还会撤销此前获得的对你 Google 账号的访问权限。',
            '**关卡练习进度：**服务器上的副本（你在每个关卡的星数，以及各关卡每天给你的 XP）会随账号一起删除。你手机上的副本会一直保留，直到你卸载应用。',
            '**删除后以匿名方式保留的内容：**排位对局、积分、XP、练习成绩、公平竞技记录、你发送的举报和使用数据。这些内容不再与你关联，但其他玩家的对局、回放和排行榜会保持完整。',
            '**举报、屏蔽和管理日志：**屏蔽会一直保留，直到你解除屏蔽或删除账号（届时该账号的所有屏蔽都会删除，双向皆然）。举报和管理操作日志会在处理举报、维护游戏安全与公平所需的期间内保留；我们会定期审查并删除旧的记录。账号被删除时，针对该账号的未处理举报会被关闭，其名称会从管理日志中移除。如果该账号曾被暂停，则只保留上文所述的单向指纹，直到有人使用相同登录方式创建新账号，或我们在定期审查中将其删除。',
            '**使用数据：**在有助于我们了解游戏使用情况的期间内保留。我们会定期审查并删除旧的数据。',
            '**Crashlytics：**Google 会将崩溃报告保留最多90天。**Analytics：**按照我们在 Firebase 中设置的保留期限保留。',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: '你的权利',
      blocks: [
        '你可以要求查看你的数据、更正数据（你可以在应用中更改名称、头像和国家/地区）、删除数据（在应用中删除账号），或反对对数据的使用。请发送邮件至{email}，我们将在30天内回复。',
        '你也可以向以色列隐私保护局，或你所在国家的数据保护机构投诉。',
      ],
    },
    {
      id: 'children',
      title: '儿童',
      blocks: [
        '本游戏不面向13岁以下的儿童，我们不会在知情的情况下收集有关他们的数据。如果我们得知有13岁以下的儿童开设了账号，我们会将其删除。在最低年龄更高的地方，未达到该年龄者需要获得父母的同意。',
      ],
    },
    {
      id: 'security',
      title: '安全',
      blocks: [
        '应用与服务器之间的通信经过加密（HTTPS 和 WSS）。密码由 Firebase 处理，我们不会存储。服务器上数据的访问权限仅限于游戏运营者。没有任何系统是绝对安全的，但我们会尽合理努力保护你的数据。',
      ],
    },
    {
      id: 'changes',
      title: '本政策的变更',
      blocks: ['本政策变更时，我们会更新此处的日期。对于重大变更，我们还会在应用内发布通知。'],
    },
    {
      id: 'contact',
      title: '联系我们',
      blocks: ['{operator} · {email}', '另请参阅[使用条款](terms)。'],
    },
  ],
};

export const TERMS_ZH_HANS: LegalDoc = {
  title: '使用条款',
  lead: '使用 Sudoku Fight 的规则。使用本游戏即表示你接受这些规则。',
  sections: [
    {
      id: 'acceptance',
      title: '接受条款',
      blocks: [
        '本条款适用于由{operator}（“我们”）运营的 Sudoku Fight 应用及其服务（“本游戏”）。注册或使用本游戏，即表示你接受本条款和[隐私政策](privacy)。',
      ],
    },
    {
      id: 'eligibility',
      title: '谁可以玩',
      blocks: [
        '你必须年满13岁；如果你所在国家的法律规定的最低年龄更高，则须达到该年龄。未满18岁者需要获得父母或监护人的同意。',
      ],
    },
    {
      id: 'account',
      title: '你的账号',
      blocks: [
        {
          list: [
            '每人一个账号，使用你自己的电子邮箱。',
            '请妥善保管你的密码（或你用于登录的 Google 账号）。你须对使用你的账号进行的一切行为负责。',
            '你可以随时在应用内删除账号：设置 → 删除账号。',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: '显示名称和行为规范',
      blocks: [
        '你的显示名称、头像和国家/地区对所有玩家可见。名称不得：',
        {
          list: [
            '含有冒犯、种族歧视、色情、威胁或侮辱性内容；',
            '冒充他人、其他玩家或本游戏的工作人员；',
            '包含个人信息（电话号码、地址）、广告或链接。',
          ],
        },
        '名称会自动与违禁词列表进行比对。对于违反这些规则的名称，我们可能会更改名称、要求设置新名称，或暂停账号。',
        '游戏中的表情是从固定列表中选择的 emoji。在对局中，你可以通过对手的卡片将其静音、屏蔽或举报（见下一节）。',
      ],
    },
    {
      id: 'reports',
      title: '举报和屏蔽',
      blocks: [
        '你可以从玩家的卡片或从对局中举报玩家，并选择以下三个原因之一：冒犯性名称、作弊或其他。**我们会在48小时内审核每一条举报。**',
        '如果规则被违反，我们可能会将名称替换为临时名称（随后会要求该玩家选择新名称，且这次选择不受30天规则的限制）、暂停该账号参与排位对局和修改账号信息直至暂停被解除，或关闭该账号。以这种方式被替换的名称不能再次被选用。被暂停的账号仍可随时删除，但删除账号并不会解除暂停：使用相同登录方式的新账号一开始就处于暂停状态，直到我们对其进行审核。',
        '你也可以屏蔽玩家：你不会与其被分到同一局对局中，其表情也不会向你显示。要解除屏蔽，请前往“设置 → 已屏蔽的玩家”。屏蔽不会让任何人从排行榜中隐藏。',
        '请勿无故举报：多次虚假举报即违反本条款。',
      ],
    },
    {
      id: 'fair-play',
      title: '公平竞技',
      blocks: [
        '你不得：',
        {
          list: [
            '使用数独求解器、机器人、脚本、自动化工具或经过修改的应用；',
            '持有多个账号以影响积分、与其他玩家串通安排结果，或故意输掉对局；',
            '利用漏洞而不报告；',
            '使我们的服务器超载、试图入侵服务器，或干扰其他玩家。',
          ],
        },
        '服务器会标记异常的对局以供审核。如果规则被违反，我们可能会取消成绩、重置积分，或暂停并关闭账号。',
      ],
    },
    {
      id: 'virtual',
      title: '积分、XP 和成就',
      blocks: [
        '积分、XP、等级和成就不具有任何货币价值，不能转让或出售。我们可能会更改其计算方式或将其重置（例如在赛季开始时）。',
        '本游戏免费。此版本没有任何购买项目，也没有广告。',
      ],
    },
    {
      id: 'service',
      title: '服务可用性',
      blocks: [
        '排位对局需要网络连接。当没有可匹配的玩家时，你可能会与一名电脑控制的对手匹配，其节奏与你相近。此类对局计入你的积分。本游戏也可能提供与机器人进行的练习对局，不计积分。如果服务器在排位对局进行中重启，该对局将结束，积分不变。',
        '我们可能会更改、暂停或停止本游戏的部分内容；对于重大变更，我们会尽量提前通知。',
      ],
    },
    {
      id: 'ip',
      title: '知识产权',
      blocks: [
        '本游戏及其设计、代码、音效和头像归我们或授权我们使用的相关方所有。我们授予你一项个人的、非独占的、非商业性的许可，允许你依据本条款使用本游戏。第三方许可列于应用内：设置 → 许可证。',
      ],
    },
    {
      id: 'stores',
      title: '应用商店',
      blocks: [
        'Apple 和 Google 不是本条款的当事方，也不对本游戏负责。如果你从 App Store 下载了本游戏，Apple 的标准最终用户许可协议（EULA）同样适用，Apple 及其子公司可作为第三方受益人执行本条款。',
      ],
    },
    {
      id: 'disclaimer',
      title: '免责声明',
      blocks: [
        '本游戏按“现状”提供。在法律允许的范围内，我们不保证本游戏能够不间断或无错误地运行，也不对间接损失、数据丢失或积分损失承担责任。本条款中的任何内容均不限制法律赋予你的、不可放弃的权利。',
      ],
    },
    {
      id: 'termination',
      title: '终止',
      blocks: ['你可以随时停止游戏并删除账号。对于违反本条款的账号，我们可能会将其暂停或关闭。'],
    },
    {
      id: 'changes',
      title: '本条款的变更',
      blocks: [
        '本条款变更时，我们会更新此处的日期。对于重大变更，我们还会在应用内发布通知。变更后继续使用本游戏，即表示你接受新的条款。',
      ],
    },
    {
      id: 'law',
      title: '适用法律',
      blocks: [
        '本条款受以色列国法律管辖，特拉维夫地区的主管法院拥有专属管辖权，除非你所在国家的法律赋予你不可放弃的权利。',
      ],
    },
    {
      id: 'contact',
      title: '联系我们',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_ZH_HANS: LegalDoc = {
  title: '删除账号',
  lead: '如何删除你的 Sudoku Fight 账号，以及你的数据会怎样处理。',
  sections: [
    {
      id: 'in-app',
      title: '在应用内删除（立即生效）',
      blocks: [
        {
          list: [
            '打开 Sudoku Fight，进入**设置**。',
            '点按**删除账号**，然后确认。',
            '输入你的密码；如果你使用 Google 登录，则再次选择你的 Google 账号。账号会立即删除，应用会返回登录界面。',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: '不通过应用删除',
      blocks: [
        '请**使用你账号的电子邮箱地址**发送邮件至{email}，邮件主题为“删除我的账号”，并注明你的显示名称。我们会确认请求来自账号的所有者，并在30天内删除该账号。删除完成后，我们会通过电子邮件确认。',
      ],
    },
    {
      id: 'what',
      title: '删除的内容和保留的内容',
      blocks: [
        {
          list: [
            '**立即删除：**你的电子邮箱、国家/地区、头像、你的登录信息（包括 Firebase 中的），以及你的账号与你的安装之间的关联。你的显示名称会被替换为匿名 ID，并可供他人使用。',
            '**匿名保留：**排位对局、积分、XP、练习成绩、公平竞技记录和使用数据。这些内容不再与你关联，但其他玩家的对局和排行榜会保持完整。',
            '**你的手机上：**你手机上的练习对局会一直保留，直到你卸载应用。',
            '**Google 方面：**崩溃报告最多保留90天，Analytics 数据按所设置的保留期限保留。',
          ],
        },
        '更多信息请参阅[隐私政策](privacy)。',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_ZH_HANS: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_ZH_HANS,
  terms: TERMS_ZH_HANS,
  'delete-account': DELETE_ACCOUNT_ZH_HANS,
};
