import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Vietnamese (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). bạn for "you" (D122, docs/i18n/style/vi.md), "chúng tôi"
 * for "we" (the formal register a legal text needs); terms from docs/i18n/glossary.csv (trận đấu, đối thủ, điểm
 * xếp hạng, xếp hạng, phòng, báo cáo, chặn, đòn phá rối, biểu cảm, màn, chương, sao, xem lại, luyện tập, bảng,
 * cấp độ, XP). Unicode NFC, modern tone marks. The page opens with TRANSLATION_NOTICE_VI: the English version
 * prevails.
 *
 * App labels quoted here (they must equal the app's vi strings): Cài đặt (home:settings.title), Xóa tài khoản
 * (account:settings.deleteAccount), Người chơi bị chặn (moderation:blocked.settingsRow), Giấy phép
 * (home:settings.licenses), “Đối thủ gần đây của bạn” (progress:leaderboard.caption.friends), “Cách chơi”
 * (levels:tutorial.title); the report reasons tên phản cảm, gian lận, khác (moderation:report.reasons.offensiveName,
 * .cheating, .other), written in lower case inside sentences.
 *
 * Word choices: "trò chơi" is the app and its service, "trận đấu" one game played on a board (glossary); a puzzle
 * is "câu đố"; staged practice is "luyện tập theo màn"; an account's suspension is "đình chỉ" (khóa is the cell
 * lock in this app); a crash is "sự cố"; the stealth opponent is "đối thủ do máy điều khiển". "chặn" is only
 * blocking a player, so preventing cheating is "ngăn ngừa", and "phá rối" is only the interference, so disrupting
 * other players is "gây cản trở".
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_VI =
  'Đây là bản dịch của phiên bản tiếng Anh. Nếu có khác biệt, phiên bản tiếng Anh được ưu tiên áp dụng.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_VI: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Ngôn ngữ',
  contents: 'Mục lục',
  documents: 'Tài liệu',
  updated: 'Cập nhật lần cuối:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[tên bên vận hành]',
  draft:
    'Bản nháp: thông tin liên hệ chưa được thiết lập trên máy chủ (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_VI,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `vi`): [what happens, what it carries]. */
export const EVENT_DETAILS_VI: Record<TelemetryEventName, [string, string]> = {
  app_open: ['Ứng dụng được mở', '—'],
  screen_view: ['Một màn hình được mở', 'Tên của màn hình (mẫu đường dẫn của nó, không kèm ID)'],
  register_step: ['Một bước đăng ký được mở', 'Bước đó'],
  register_complete: ['Việc đăng ký hoàn tất', '—'],
  game_start: [
    'Một trận đấu bắt đầu',
    'Chế độ, loại trận đấu, số người chơi, và đó có phải là trận đấu với bạn bè hay không',
  ],
  game_end: [
    'Một trận đấu kết thúc',
    'Chế độ, kết quả, điểm, số lỗi, thời lượng, và đó có phải là trận đấu với bạn bè hay không',
  ],
  interference_sent: ['Bạn gửi một đòn phá rối', 'Loại đòn và chi phí của nó'],
  reaction_sent: ['Bạn gửi một biểu cảm', 'Emoji nào'],
  matchmaking_wait: ['Một lượt tìm đối thủ kết thúc', 'Số giây đã chờ, và có tìm được trận đấu hay không'],
  reconnect: ['Kết nối lại sau khi bị ngắt', 'Mất bao lâu, và có thành công hay không'],
  latency_sample: ['Một lần đo chất lượng kết nối', 'Thời gian phản hồi của mạng, tính bằng mili giây'],
  replay_open: ['Một phần xem lại được mở', 'Chế độ của trận đấu'],
  account_delete: ['Tài khoản bị xóa', '—'],
  report_sent: [
    'Bạn báo cáo một người chơi',
    'Chỉ lý do (không gồm người bị báo cáo, cũng không gồm trận đấu)',
  ],
  level_map_open: ['Bản đồ luyện tập theo màn được mở', 'Màn hiện tại và tổng số sao của bạn'],
  level_start: [
    'Một màn bắt đầu',
    'Số thứ tự và phiên bản của màn, chương và loại màn, số thứ tự của lần thử, số sao tốt nhất của bạn tính đến lúc đó, và đó có phải là một lần bắt đầu nhanh hay không',
  ],
  level_end: [
    'Một màn kết thúc',
    'Số thứ tự, phiên bản và loại của màn, số sao, số sao tốt nhất của bạn trước màn đó, thời lượng của màn, màn kết thúc như thế nào, số lỗi, kết quả (thời gian, số vị trí, khoảng cách dẫn trước hoặc điểm), cấp độ của bot và số thứ tự của lần thử',
  ],
  level_quit: [
    'Rời một màn khi đang chơi dở (ví dụ: ứng dụng bị đóng)',
    'Số thứ tự và phiên bản của màn, và màn đã diễn ra trong bao lâu',
  ],
  chapter_gate: [
    'Một lần thử vượt qua cổng sang chương tiếp theo',
    'Chương nằm sau cổng, số sao trong chương, và cổng có mở hay không',
  ],
  level_tutorial: [
    'Phần “Cách chơi” của một loại màn được hiển thị',
    'Loại màn, và bạn có bỏ qua phần đó hay không',
  ],
  friends_room_open: [
    'Một phòng để chơi với bạn bè được mở',
    'Loại trận đấu, và phòng được mở bằng cách nào',
  ],
  friends_room_join: [
    'Một lần thử tham gia phòng của bạn bè',
    'Bằng cách nào (mã hoặc liên kết), và kết quả ra sao (thành công, hoặc lý do thất bại)',
  ],
  friends_invite_share: [
    'Liên kết của một phòng được chia sẻ',
    'Người chia sẻ là chủ phòng hay khách (không gồm mã, cũng không gồm người nhận)',
  ],
  friends_link_open: ['Một liên kết phòng mở ứng dụng', 'Bạn có đang đăng nhập hay không'],
  friends_room_start: [
    'Một trận đấu với bạn bè bắt đầu',
    'Số người chơi, và bạn đã chờ trong phòng bao nhiêu giây',
  ],
  friends_room_close: [
    'Bạn rời khỏi một phòng trước khi trận đấu của phòng bắt đầu',
    'Lý do, có bao nhiêu người chơi trong phòng, và bạn đã chờ bao nhiêu giây',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_VI) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_VI[name],
  ]);

export const PRIVACY_VI: LegalDoc = {
  title: 'Chính sách quyền riêng tư',
  lead: 'Những gì Sudoku Fight thu thập, vì sao, ai thấy được, được lưu giữ trong bao lâu, và cách xóa.',
  sections: [
    {
      id: 'who',
      title: 'Chúng tôi là ai',
      blocks: [
        'Sudoku Fight (“trò chơi”, “chúng tôi”) là một trò chơi sudoku thi đấu theo thời gian thực, do {operator} vận hành.',
        'Nếu có bất kỳ câu hỏi nào về quyền riêng tư và dữ liệu của bạn, hãy viết cho chúng tôi tại {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'Tóm tắt',
      blocks: [
        {
          list: [
            'Chúng tôi chỉ thu thập những gì cần thiết để vận hành trò chơi: thông tin tài khoản của bạn, các trận đấu của bạn, và dữ liệu sử dụng giúp chúng tôi hiểu trò chơi được chơi như thế nào và khắc phục sự cố.',
            '**Không có quảng cáo, và chúng tôi không bán dữ liệu.** Chúng tôi không theo dõi bạn trên các ứng dụng hay trang web khác.',
            'Tên hiển thị, ảnh đại diện, quốc gia, điểm xếp hạng và thống kê của bạn được hiển thị cho người chơi khác. Email của bạn không bao giờ được hiển thị cho người chơi khác.',
            'Bạn có thể xóa tài khoản trong ứng dụng bất cứ lúc nào: Cài đặt → Xóa tài khoản. Xem [trang xóa tài khoản](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Thông tin tài khoản',
      blocks: [
        'Khi bạn đăng ký, chúng tôi lưu giữ:',
        {
          list: [
            '**Email:** để đăng nhập, xác minh địa chỉ, đặt lại mật khẩu và gửi thông báo về tài khoản. Chúng tôi không gửi email tiếp thị.',
            '**Mật khẩu** (khi bạn đăng ký bằng email và mật khẩu): do Firebase Authentication của Google xử lý. Mật khẩu không bao giờ đến máy chủ của chúng tôi, và chúng tôi không thể xem được.',
            '**Đăng nhập bằng Google (không bắt buộc):** bạn có thể đăng ký và đăng nhập bằng tài khoản Google thay cho email và mật khẩu. Khi đó, Firebase Authentication nhận từ Google email của tài khoản Google của bạn (đã được Google xác minh) và ID Google của tài khoản đó, rồi lưu chúng cùng thông tin đăng nhập của bạn; chúng tôi lưu email như với mọi tài khoản. Google cũng cung cấp cho Firebase tên Google và ảnh hồ sơ của bạn, và Firebase lưu chúng cùng thông tin đăng nhập. Máy chủ của chúng tôi không lưu trữ và không hiển thị chúng: trong đấu trường chỉ hiện tên và ảnh đại diện mà bạn chọn. Chúng tôi không bao giờ nhận mật khẩu Google của bạn, cũng không có quyền truy cập vào bất cứ thứ gì khác trong tài khoản Google của bạn (danh bạ, email, tệp). Nếu muốn, bạn có thể đăng ký bằng email và mật khẩu.',
            '**Tên hiển thị, quốc gia và ảnh đại diện:** bạn chọn chúng, và chúng được hiển thị cho người chơi khác. Quốc gia do chính bạn chọn (giá trị mặc định lấy từ cài đặt ngôn ngữ và khu vực của thiết bị). Chúng tôi không sử dụng vị trí của thiết bị.',
            '**Thời điểm tài khoản được tạo và thời điểm tên được đổi lần gần nhất** (tên chỉ có thể đổi một lần trong 30 ngày).',
            '**ID tài khoản của chúng tôi**, và ID đăng nhập Firebase của bạn (khi đăng nhập bằng Google, Firebase cũng lưu ID tài khoản Google của bạn).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Trận đấu và tiến trình',
      blocks: [
        {
          list: [
            '**Trận đấu xếp hạng** (lưu trên máy chủ): bảng, mọi nước đi kèm thời điểm của nó, các đòn phá rối và biểu cảm bạn đã gửi, điểm, số lỗi, thứ hạng, điểm xếp hạng trước và sau trận của bạn, và trận đấu kết thúc như thế nào. Từ đó tạo nên lịch sử, phần xem lại và thống kê của bạn.',
            '**Trận đấu với bạn bè** (trong một phòng có mã; được lưu trên máy chủ như trận đấu xếp hạng, nhưng không có điểm xếp hạng): cùng các thông tin đó, trừ điểm xếp hạng. Chúng xuất hiện trong lịch sử và phần xem lại của bạn, và những người chơi đã chơi cùng bạn xuất hiện trong mục “Đối thủ gần đây của bạn”. Mã phòng, ai đang ở trong phòng và ai đã bị đưa ra khỏi phòng chỉ được giữ trong bộ nhớ của máy chủ, cho đến khi phòng đóng.',
            '**Điểm xếp hạng, XP, cấp độ và thành tích.**',
            '**Bạn đã chơi những câu đố nào, và với ai:** để bạn không gặp lại cùng một câu đố hay cùng một đối thủ hết lần này đến lần khác.',
            '**Nhịp độ của bạn:** khi mỗi trận đấu xếp hạng kết thúc, chúng tôi tính từ các nước đi của bạn thời gian trung bình bạn dùng cho mỗi nước đi (có tính đến độ khó của từng ô), và lưu nó cùng trận đấu, kèm số nước đi đã được dùng để đo. Dựa vào nhịp độ đó, tỷ lệ lỗi của bạn và kết quả của bạn khi đấu với các đối thủ do máy điều khiển, chúng tôi đặt nhịp độ cho một đối thủ do máy điều khiển khi không có người chơi nào sẵn sàng (xem [Điều khoản sử dụng](terms)). Nhịp độ của bạn không được hiển thị cho người chơi khác.',
            '**Kết quả luyện tập** (chơi một mình hoặc đấu với bot), khi ứng dụng gửi chúng để tính XP: chế độ, loại trận đấu, kết quả, số nước đi đúng, thời điểm kết thúc, và lượng XP nhận được.',
            '**Luyện tập theo màn:** khi ứng dụng đồng bộ tiến trình của bạn vào tài khoản (để tiến trình cũng quay lại trên điện thoại mới): số sao tốt nhất của bạn ở mỗi màn, số lần bạn đã chơi màn đó và thời điểm điều đó thay đổi, và lượng XP mà các màn đã mang lại mỗi ngày.',
            '**Chơi công bằng:** khi nhịp độ nước đi trong một trận đấu xếp hạng nhanh bất thường, một bản ghi được lưu lại để một người xem xét. Không có gì xảy ra tự động vì bản ghi đó.',
            '**Báo cáo và chặn:** xem mục “Báo cáo và chặn” bên dưới.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Dữ liệu sử dụng',
      blocks: [
        'Để hiểu trò chơi được sử dụng như thế nào, ứng dụng gửi các sự kiện đến máy chủ của chúng tôi. Mỗi sự kiện có ID ngẫu nhiên riêng và thời gian trên điện thoại của bạn; máy chủ thêm thời điểm nhận được sự kiện đó.',
        'Mỗi lần gửi cũng kèm một **ID cài đặt**: một số ngẫu nhiên được tạo ở lần khởi chạy đầu tiên và lưu trong ứng dụng. ID này không dựa trên thông tin thiết bị của bạn, và sẽ mất khi bạn gỡ cài đặt ứng dụng. Gửi kèm theo nó là hệ điều hành (iOS hoặc Android) và phiên bản của ứng dụng.',
        'Khi bạn đã đăng nhập, các sự kiện và bản cài đặt được liên kết với tài khoản của bạn. Khi không có kết nối, các sự kiện chờ trên điện thoại của bạn và được gửi sau.',
        'Các sự kiện:',
        { table: { head: ['Sự kiện', 'Khi nào', 'Nội dung kèm theo'], rows: eventRows() } },
        'Các sự kiện này cũng được gửi đến **Google Analytics for Firebase**, công cụ này thêm một ID của bản cài đặt ứng dụng, thông tin thiết bị và hệ điều hành, dữ liệu sử dụng (chẳng hạn thời lượng phiên), và vị trí gần đúng (quốc gia và khu vực) mà Google suy ra từ địa chỉ IP. Chúng tôi thiết lập công cụ này không kèm các tính năng quảng cáo: không có ID quảng cáo, và không cá nhân hóa quảng cáo.',
      ],
    },
    {
      id: 'crashes',
      title: 'Báo cáo sự cố và lỗi',
      blocks: [
        {
          list: [
            '**Trong ứng dụng, Firebase Crashlytics của Google:** khi ứng dụng gặp sự cố hoặc gặp lỗi, một báo cáo được gửi đi kèm chi tiết về lỗi, mẫu thiết bị, phiên bản hệ điều hành và phiên bản ứng dụng, một ID cài đặt Crashlytics, và ID tài khoản của chúng tôi khi bạn đã đăng nhập. Không có email hay tên của bạn.',
            '**Trên máy chủ, Sentry:** khi máy chủ gặp lỗi, một báo cáo kỹ thuật về lỗi đó được gửi đi, đôi khi kèm ID của tài khoản liên quan. Không có email và không có mật khẩu.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Địa chỉ IP',
      blocks: [
        'Khi ứng dụng kết nối, máy chủ của chúng tôi thấy địa chỉ IP của bạn. Chúng tôi sử dụng địa chỉ này **chỉ trong bộ nhớ của máy chủ**, để giới hạn tần suất yêu cầu và bảo vệ khỏi các đợt tấn công gây quá tải, và chúng tôi không lưu địa chỉ này vào cơ sở dữ liệu.',
        'Nhà cung cấp dịch vụ lưu trữ máy chủ của chúng tôi có thể giữ nhật ký truy cập thông thường trong một thời gian ngắn.',
      ],
    },
    {
      id: 'device',
      title: 'Những gì chỉ lưu trên điện thoại của bạn',
      blocks: [
        {
          list: [
            'Các trận luyện tập của bạn và lịch sử của chúng.',
            'Tiến trình luyện tập theo màn của bạn: số sao, số lần thử và các cổng bạn đã mở (một bản sao cũng được lưu trên máy chủ: xem “Trận đấu và tiến trình”).',
            'Cài đặt của bạn: âm thanh, rung, giảm chuyển động và ngôn ngữ.',
            'Một bản sao hồ sơ của bạn, để ứng dụng mở được mà không cần kết nối.',
            'Hàng đợi các sự kiện và kết quả luyện tập chưa được gửi, và ID cài đặt.',
            'Thông tin đăng nhập của bạn (do Firebase lưu giữ), và khi đăng nhập bằng Google thì cả tài khoản bạn đã chọn (do Dịch vụ Google Play lưu giữ cho đến khi bạn đăng xuất).',
          ],
        },
        'Tất cả những thứ này bị xóa khi bạn gỡ cài đặt ứng dụng. Đăng xuất sẽ xóa bản sao hồ sơ. Xóa tài khoản không xóa các trận luyện tập và tiến trình luyện tập theo màn trên điện thoại của bạn: để xóa cả những thứ đó, hãy gỡ cài đặt ứng dụng.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Những gì chúng tôi không thu thập',
      blocks: [
        'Danh bạ, ảnh, micrô, máy ảnh, vị trí chính xác, ID quảng cáo và thông tin thanh toán. Trò chơi không có tính năng trò chuyện: biểu cảm là emoji từ một danh sách cố định.',
      ],
    },
    {
      id: 'public',
      title: 'Những gì người chơi khác thấy',
      blocks: [
        {
          list: [
            'Tên hiển thị, ảnh đại diện, quốc gia (dưới dạng lá cờ), điểm xếp hạng, cấp độ và thành tích của bạn.',
            'Trên thẻ người chơi của bạn và các bảng xếp hạng: số trận đấu, tỷ lệ thắng, chuỗi trận, nước đi hay nhất, số lỗi trung bình, kết quả gần đây, đòn phá rối bạn gửi nhiều nhất, và thời điểm bạn tham gia (tháng và năm).',
            'Trong một trận đấu: điểm, số lỗi, các đòn phá rối và biểu cảm của bạn, và bạn có đang trực tuyến hay không.',
            'Trong một phòng chơi với bạn bè: bất kỳ ai có mã hoặc liên kết của phòng và vào phòng đều thấy tên, ảnh đại diện, lá cờ và điểm xếp hạng chung của mọi người trong phòng, và họ có đang ở trong phòng lúc này hay không. Bản thân mã và liên kết không chứa thông tin cá nhân nào.',
            'Phần xem lại và chi tiết trận đấu: chỉ những người chơi của trận đấu đó.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Báo cáo và chặn',
      blocks: [
        {
          list: [
            '**Báo cáo người chơi:** khi bạn báo cáo ai đó, chúng tôi lưu ai đã báo cáo, báo cáo ai, lý do (tên phản cảm, gian lận hoặc khác), trận đấu xếp hạng nếu báo cáo được gửi từ một trận như vậy, và thời điểm. Báo cáo không có phần văn bản tự do. Người chơi bị báo cáo không được cho biết ai đã báo cáo họ.',
            '**Chặn:** chúng tôi lưu những người chơi bạn đã chặn và thời điểm chặn. Nhờ đó, bạn không bị xếp vào cùng một trận đấu với họ, và biểu cảm của họ không được hiển thị cho bạn. Không ai được thông báo rằng họ đã bị chặn, và việc chặn không ẩn ai khỏi các bảng xếp hạng.',
            '**Xử lý báo cáo:** bên vận hành trò chơi xem xét mọi báo cáo trong vòng 48 giờ. Bên vận hành có thể thay một tên phản cảm bằng một tên tạm thời (khi đó người chơi được yêu cầu chọn tên mới), hoặc đình chỉ một tài khoản khỏi các trận đấu xếp hạng và khỏi việc thay đổi tài khoản. Mỗi hành động như vậy được ghi vào một nhật ký nội bộ, kèm địa chỉ của quản trị viên đã thực hiện, và kèm tên cũ và tên mới khi một tên bị thay. Tên bị thay theo cách này được đưa vào danh sách những tên không ai được chọn lại (chỉ có tên, không liên kết với người chơi nào).',
            '**Xóa một tài khoản đang bị đình chỉ:** việc xóa tài khoản không gỡ bỏ lệnh đình chỉ. Khi một tài khoản đang bị đình chỉ bị xóa, chúng tôi giữ một dấu vân tay một chiều (một mã băm, hash) của ID đăng nhập và của địa chỉ email đã xác minh của tài khoản đó, chứ không giữ chính ID hay địa chỉ đó. Một tài khoản mới với cùng thông tin đăng nhập sẽ bắt đầu ở trạng thái bị đình chỉ cho đến khi quản trị viên xem xét nó, và khi đó dấu vân tay sẽ bị xóa. Đây là lợi ích chính đáng của chúng tôi, và của mọi người chơi, đối với việc chơi công bằng.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Vì sao chúng tôi sử dụng dữ liệu',
      blocks: [
        {
          list: [
            '**Để vận hành trò chơi:** tài khoản, trận đấu, điểm xếp hạng, ghép trận, lịch sử và bảng xếp hạng của bạn. Điều này cần thiết cho thỏa thuận giữa chúng tôi và bạn (Điều khoản sử dụng).',
            '**Bảo mật và chơi công bằng:** giới hạn tần suất, phát hiện bất thường, ngăn ngừa gian lận, và xử lý báo cáo và việc chặn. Đây là lợi ích chính đáng của chúng tôi, và của mọi người chơi.',
            '**Để cải thiện trò chơi:** để biết những màn hình và chế độ nào được chơi, tìm ra sự cố và khắc phục lỗi khiến ứng dụng bị dừng đột ngột. Đây cũng là một lợi ích chính đáng, không có quảng cáo và không có hồ sơ tiếp thị.',
            '**Email dịch vụ:** chỉ để xác minh địa chỉ và đặt lại mật khẩu.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Chúng tôi chia sẻ dữ liệu với ai',
      blocks: [
        'Chúng tôi **không bán** dữ liệu, và không chuyển dữ liệu cho bên quảng cáo hay các nhà môi giới dữ liệu. Các nhà cung cấp dịch vụ của chúng tôi chỉ xử lý dữ liệu cho chúng tôi:',
        {
          list: [
            '**Google (Firebase):** đăng nhập (Authentication, bao gồm đăng nhập bằng Google), báo cáo sự cố (Crashlytics) và dữ liệu sử dụng (Analytics).',
            '**Fly.io:** lưu trữ máy chủ.',
            '**Neon:** cơ sở dữ liệu (PostgreSQL).',
            '**Sentry:** báo cáo lỗi của máy chủ.',
          ],
        },
        'Chúng tôi cũng sẽ tiết lộ dữ liệu khi pháp luật yêu cầu, hoặc để bảo vệ trò chơi và người chơi. Nếu trò chơi được chuyển cho một chủ sở hữu khác, dữ liệu sẽ được chuyển theo, và chính sách này tiếp tục áp dụng cho dữ liệu đó.',
      ],
    },
    {
      id: 'transfers',
      title: 'Dữ liệu được lưu ở đâu',
      blocks: [
        'Máy chủ và cơ sở dữ liệu hiện đặt tại Liên minh châu Âu (Frankfurt, Đức). Google và Sentry cũng có thể xử lý dữ liệu tại Hoa Kỳ và các quốc gia khác, theo các biện pháp bảo vệ của riêng họ đối với việc chuyển dữ liệu (chẳng hạn các Điều khoản hợp đồng tiêu chuẩn của EU).',
      ],
    },
    {
      id: 'retention',
      title: 'Chúng tôi lưu giữ dữ liệu trong bao lâu',
      blocks: [
        {
          list: [
            '**Thông tin tài khoản:** chừng nào tài khoản còn tồn tại.',
            '**Khi bạn xóa tài khoản:** email, quốc gia, ảnh đại diện và liên kết đăng nhập của bạn bị xóa ngay lập tức, và tên hiển thị của bạn được thay bằng một ID ẩn danh (tên cũ được giải phóng ngay lập tức). Thông tin đăng nhập Firebase của bạn cũng bị xóa, cùng những gì nó đã lưu từ Google. Nếu bạn đăng nhập bằng Google, ứng dụng cũng thu hồi quyền truy cập mà nó đã được cấp vào tài khoản Google của bạn.',
            '**Tiến trình luyện tập theo màn:** bản sao trên máy chủ (số sao của bạn ở mỗi màn, và lượng XP mà các màn đã mang lại mỗi ngày) bị xóa cùng tài khoản. Bản sao trên điện thoại của bạn vẫn còn cho đến khi bạn gỡ cài đặt ứng dụng.',
            '**Những gì còn lại sau khi xóa, ở dạng ẩn danh:** trận đấu xếp hạng, điểm xếp hạng, XP, kết quả luyện tập, bản ghi chơi công bằng, các báo cáo bạn đã gửi và dữ liệu sử dụng. Chúng không còn liên kết với bạn, nhưng các trận đấu, phần xem lại và bảng xếp hạng của người chơi khác vẫn được giữ nguyên vẹn.',
            '**Báo cáo, việc chặn và nhật ký quản trị:** một lượt chặn được giữ cho đến khi bạn bỏ chặn hoặc xóa tài khoản (khi đó mọi lượt chặn của tài khoản bị xóa, theo cả hai chiều). Báo cáo và nhật ký các hành động của quản trị viên được giữ chừng nào chúng còn cần thiết để xử lý báo cáo và giữ cho trò chơi an toàn và công bằng; thỉnh thoảng chúng tôi xem xét và xóa những mục cũ. Khi một tài khoản bị xóa, các báo cáo đang mở về tài khoản đó được đóng lại, và các tên của tài khoản đó được xóa khỏi nhật ký quản trị. Nếu tài khoản đó đang bị đình chỉ, chỉ còn lại dấu vân tay một chiều đã mô tả ở trên, cho đến khi một tài khoản mới với cùng thông tin đăng nhập được tạo hoặc chúng tôi xóa nó trong một lần xem xét định kỳ.',
            '**Dữ liệu sử dụng:** được giữ chừng nào còn giúp chúng tôi hiểu trò chơi được sử dụng như thế nào. Thỉnh thoảng chúng tôi xem xét và xóa dữ liệu cũ.',
            '**Crashlytics:** Google giữ báo cáo sự cố tối đa 90 ngày. **Analytics:** theo thời hạn lưu giữ mà chúng tôi đã đặt trong Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Quyền của bạn',
      blocks: [
        'Bạn có thể yêu cầu xem dữ liệu của mình, chỉnh sửa dữ liệu (bạn có thể đổi tên, ảnh đại diện và quốc gia trong ứng dụng), xóa dữ liệu (xóa tài khoản trong ứng dụng), hoặc phản đối việc sử dụng dữ liệu đó. Hãy viết cho chúng tôi tại {email}, và chúng tôi sẽ trả lời trong vòng 30 ngày.',
        'Bạn cũng có thể khiếu nại với Cơ quan Bảo vệ Quyền riêng tư của Israel, hoặc với cơ quan bảo vệ dữ liệu tại quốc gia của bạn.',
      ],
    },
    {
      id: 'children',
      title: 'Trẻ em',
      blocks: [
        'Trò chơi không dành cho trẻ em dưới 13 tuổi, và chúng tôi không cố ý thu thập dữ liệu về các em. Nếu biết được rằng một trẻ dưới 13 tuổi đã mở tài khoản, chúng tôi sẽ xóa tài khoản đó. Ở những nơi có độ tuổi tối thiểu cao hơn, cần có sự đồng ý của cha mẹ cho đến độ tuổi đó.',
      ],
    },
    {
      id: 'security',
      title: 'Bảo mật',
      blocks: [
        'Dữ liệu truyền giữa ứng dụng và máy chủ được mã hóa (HTTPS và WSS). Mật khẩu do Firebase xử lý và không được chúng tôi lưu trữ. Quyền truy cập dữ liệu trên máy chủ chỉ giới hạn cho bên vận hành trò chơi. Không có hệ thống nào an toàn tuyệt đối, nhưng chúng tôi nỗ lực hợp lý để bảo vệ dữ liệu của bạn.',
      ],
    },
    {
      id: 'changes',
      title: 'Thay đổi chính sách này',
      blocks: [
        'Khi chính sách này thay đổi, chúng tôi cập nhật ngày ở đây. Chúng tôi cũng sẽ thông báo các thay đổi quan trọng trong ứng dụng.',
      ],
    },
    {
      id: 'contact',
      title: 'Liên hệ',
      blocks: ['{operator} · {email}', 'Xem thêm [Điều khoản sử dụng](terms).'],
    },
  ],
};

export const TERMS_VI: LegalDoc = {
  title: 'Điều khoản sử dụng',
  lead: 'Các quy tắc sử dụng Sudoku Fight. Sử dụng trò chơi nghĩa là bạn chấp nhận các quy tắc này.',
  sections: [
    {
      id: 'acceptance',
      title: 'Chấp nhận',
      blocks: [
        'Các điều khoản này áp dụng cho ứng dụng Sudoku Fight và các dịch vụ của ứng dụng (“trò chơi”), do {operator} (“chúng tôi”) vận hành. Khi đăng ký hoặc sử dụng trò chơi, bạn chấp nhận các điều khoản này và [Chính sách quyền riêng tư](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Ai có thể chơi',
      blocks: [
        'Bạn phải từ 13 tuổi trở lên, hoặc từ độ tuổi tối thiểu do pháp luật nước bạn quy định nếu độ tuổi đó cao hơn. Nếu dưới 18 tuổi, bạn cần có sự đồng ý của cha mẹ hoặc người giám hộ.',
      ],
    },
    {
      id: 'account',
      title: 'Tài khoản của bạn',
      blocks: [
        {
          list: [
            'Mỗi người một tài khoản, với email của chính bạn.',
            'Hãy giữ an toàn mật khẩu của bạn (hoặc tài khoản Google bạn dùng để đăng nhập). Bạn chịu trách nhiệm về mọi việc được thực hiện bằng tài khoản của bạn.',
            'Bạn có thể xóa tài khoản bất cứ lúc nào trong ứng dụng: Cài đặt → Xóa tài khoản.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Tên hiển thị và cách cư xử',
      blocks: [
        'Tên hiển thị, ảnh đại diện và quốc gia của bạn được hiển thị cho mọi người chơi. Tên không được:',
        {
          list: [
            'mang tính xúc phạm, phân biệt chủng tộc, khiêu dâm, đe dọa hoặc lăng mạ;',
            'mạo danh người khác, người chơi khác hoặc nhân viên của trò chơi;',
            'chứa thông tin cá nhân (số điện thoại, địa chỉ), quảng cáo hoặc đường liên kết.',
          ],
        },
        'Tên được kiểm tra tự động theo một danh sách từ bị cấm. Chúng tôi có thể đổi một tên vi phạm các quy tắc này, yêu cầu một tên mới, hoặc đình chỉ tài khoản.',
        'Biểu cảm trong trò chơi là emoji từ một danh sách cố định. Trong trận đấu, bạn có thể tắt tiếng một đối thủ từ thẻ của họ, chặn họ, hoặc báo cáo họ (mục tiếp theo).',
      ],
    },
    {
      id: 'reports',
      title: 'Báo cáo và chặn',
      blocks: [
        'Bạn có thể báo cáo một người chơi từ thẻ của họ hoặc từ trận đấu, với một trong ba lý do: tên phản cảm, gian lận hoặc khác. **Chúng tôi xem xét mọi báo cáo trong vòng 48 giờ.**',
        'Nếu các quy tắc bị vi phạm, chúng tôi có thể thay tên bằng một tên tạm thời (khi đó người chơi được yêu cầu chọn tên mới, và quy tắc 30 ngày không áp dụng cho lần chọn đó), đình chỉ tài khoản khỏi các trận đấu xếp hạng và khỏi việc thay đổi tài khoản cho đến khi lệnh đình chỉ được gỡ bỏ, hoặc đóng tài khoản. Tên bị thay theo cách này không thể được chọn lại. Tài khoản đang bị đình chỉ vẫn có thể được xóa bất cứ lúc nào, nhưng việc xóa không gỡ bỏ lệnh đình chỉ: một tài khoản mới với cùng thông tin đăng nhập sẽ bắt đầu ở trạng thái bị đình chỉ cho đến khi chúng tôi xem xét nó.',
        'Bạn cũng có thể chặn một người chơi: bạn sẽ không bị xếp vào cùng một trận đấu với họ, và biểu cảm của họ sẽ không được hiển thị cho bạn. Bỏ chặn trong Cài đặt → Người chơi bị chặn. Việc chặn không ẩn ai khỏi các bảng xếp hạng.',
        'Đừng báo cáo vô cớ: báo cáo sai nhiều lần là vi phạm các điều khoản này.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Chơi công bằng',
      blocks: [
        'Bạn không được:',
        {
          list: [
            'sử dụng công cụ giải sudoku, bot, script, công cụ tự động hóa hoặc ứng dụng đã bị chỉnh sửa;',
            'giữ nhiều tài khoản để tác động đến điểm xếp hạng, dàn xếp kết quả với người chơi khác, hoặc cố tình thua;',
            'lợi dụng lỗi thay vì báo cáo lỗi;',
            'làm quá tải máy chủ của chúng tôi, cố gắng xâm nhập vào máy chủ, hoặc gây cản trở cho người chơi khác.',
          ],
        },
        'Máy chủ đánh dấu các trận đấu bất thường để xem xét. Nếu các quy tắc bị vi phạm, chúng tôi có thể hủy kết quả, đặt lại điểm xếp hạng, hoặc đình chỉ và đóng tài khoản.',
      ],
    },
    {
      id: 'virtual',
      title: 'Điểm xếp hạng, XP và thành tích',
      blocks: [
        'Điểm xếp hạng, XP, cấp độ và thành tích không có giá trị tiền tệ, và không thể chuyển nhượng hay bán. Chúng tôi có thể thay đổi cách tính hoặc đặt lại chúng (ví dụ: khi bắt đầu một mùa giải).',
        'Trò chơi miễn phí. Phiên bản này không có giao dịch mua và không có quảng cáo.',
      ],
    },
    {
      id: 'service',
      title: 'Tính khả dụng',
      blocks: [
        'Trận đấu xếp hạng cần có kết nối Internet. Khi không có người chơi nào sẵn sàng, bạn có thể được ghép với một đối thủ do máy điều khiển, chơi với nhịp độ tương tự bạn. Những trận đấu như vậy được tính vào điểm xếp hạng của bạn. Trò chơi cũng có thể đề xuất một trận luyện tập với bot, không tính điểm xếp hạng. Nếu máy chủ khởi động lại trong một trận đấu xếp hạng, trận đấu đó kết thúc mà không thay đổi điểm xếp hạng.',
        'Chúng tôi có thể thay đổi, tạm dừng hoặc ngừng các phần của trò chơi, và chúng tôi sẽ cố gắng thông báo trước về những thay đổi quan trọng.',
      ],
    },
    {
      id: 'ip',
      title: 'Sở hữu trí tuệ',
      blocks: [
        'Trò chơi, thiết kế, mã nguồn, âm thanh và ảnh đại diện của trò chơi thuộc về chúng tôi hoặc những bên đã cấp phép cho chúng tôi. Chúng tôi cấp cho bạn một giấy phép cá nhân, không độc quyền, phi thương mại để sử dụng trò chơi theo các điều khoản này. Giấy phép của bên thứ ba được liệt kê trong ứng dụng: Cài đặt → Giấy phép.',
      ],
    },
    {
      id: 'stores',
      title: 'Cửa hàng ứng dụng',
      blocks: [
        'Apple và Google không phải là các bên của các điều khoản này và không chịu trách nhiệm về trò chơi. Nếu bạn tải trò chơi từ App Store, Thỏa thuận cấp phép người dùng cuối tiêu chuẩn (EULA) của Apple cũng được áp dụng, và Apple cùng các công ty con của Apple có thể thực thi các điều khoản này với tư cách là bên thứ ba thụ hưởng.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Tuyên bố miễn trừ trách nhiệm',
      blocks: [
        'Trò chơi được cung cấp “nguyên trạng”. Trong phạm vi pháp luật cho phép, chúng tôi không bảo đảm rằng trò chơi sẽ hoạt động không gián đoạn hay không có lỗi, và chúng tôi không chịu trách nhiệm đối với thiệt hại gián tiếp, mất dữ liệu hoặc mất điểm xếp hạng. Không điều nào trong các điều khoản này hạn chế những quyền mà pháp luật trao cho bạn và không thể từ bỏ.',
      ],
    },
    {
      id: 'termination',
      title: 'Chấm dứt',
      blocks: [
        'Bạn có thể ngừng chơi và xóa tài khoản bất cứ lúc nào. Chúng tôi có thể đình chỉ hoặc đóng một tài khoản vi phạm các điều khoản này.',
      ],
    },
    {
      id: 'changes',
      title: 'Thay đổi các điều khoản này',
      blocks: [
        'Khi các điều khoản này thay đổi, chúng tôi cập nhật ngày ở đây. Chúng tôi cũng sẽ thông báo các thay đổi quan trọng trong ứng dụng. Việc sử dụng trò chơi sau một thay đổi nghĩa là bạn chấp nhận các điều khoản mới.',
      ],
    },
    {
      id: 'law',
      title: 'Luật điều chỉnh',
      blocks: [
        'Các điều khoản này được điều chỉnh bởi pháp luật của Nhà nước Israel, và các tòa án có thẩm quyền của quận Tel Aviv có thẩm quyền xét xử độc quyền, trừ khi pháp luật nước bạn trao cho bạn một quyền không thể từ bỏ.',
      ],
    },
    {
      id: 'contact',
      title: 'Liên hệ',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_VI: LegalDoc = {
  title: 'Xóa tài khoản của bạn',
  lead: 'Cách xóa tài khoản Sudoku Fight của bạn, và điều gì xảy ra với dữ liệu của bạn.',
  sections: [
    {
      id: 'in-app',
      title: 'Trong ứng dụng (ngay lập tức)',
      blocks: [
        {
          list: [
            'Mở Sudoku Fight và vào **Cài đặt**.',
            'Chạm vào **Xóa tài khoản**, rồi xác nhận.',
            'Nhập mật khẩu của bạn, hoặc, nếu bạn đăng nhập bằng Google, hãy chọn lại tài khoản Google của bạn. Tài khoản bị xóa ngay lập tức, và ứng dụng quay về màn hình đăng nhập.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Không cần ứng dụng',
      blocks: [
        'Hãy viết cho chúng tôi tại {email} **từ địa chỉ email của tài khoản**, với tiêu đề “Xóa tài khoản của tôi” và tên hiển thị của bạn. Chúng tôi sẽ xác minh rằng yêu cầu đến từ chủ sở hữu tài khoản, và xóa tài khoản trong vòng 30 ngày. Chúng tôi sẽ xác nhận qua email khi đã hoàn tất.',
      ],
    },
    {
      id: 'what',
      title: 'Những gì bị xóa và những gì được giữ lại',
      blocks: [
        {
          list: [
            '**Bị xóa ngay lập tức:** email, quốc gia, ảnh đại diện, thông tin đăng nhập của bạn (cả trong Firebase), và liên kết giữa tài khoản của bạn với các bản cài đặt của bạn. Tên hiển thị của bạn được thay bằng một ID ẩn danh và người khác có thể sử dụng tên đó.',
            '**Được giữ lại ở dạng ẩn danh:** trận đấu xếp hạng, điểm xếp hạng, XP, kết quả luyện tập, bản ghi chơi công bằng và dữ liệu sử dụng. Chúng không còn liên kết với bạn, nhưng các trận đấu và bảng xếp hạng của người chơi khác vẫn được giữ nguyên vẹn.',
            '**Trên điện thoại của bạn:** các trận luyện tập trên điện thoại của bạn vẫn còn cho đến khi bạn gỡ cài đặt ứng dụng.',
            '**Tại Google:** báo cáo sự cố được giữ tối đa 90 ngày, và dữ liệu Analytics được giữ theo thời hạn lưu giữ đã đặt.',
          ],
        },
        'Xem thêm trong [Chính sách quyền riêng tư](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_VI: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_VI,
  terms: TERMS_VI,
  'delete-account': DELETE_ACCOUNT_VI,
};
