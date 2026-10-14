import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalTexts } from './types';

/**
 * The privacy policy (spec §23, §27.1: "מדיניות הפרטיות מפרטת את האירועים"). It must match the code; when the
 * code changes what it collects, this changes too (legal.test.ts checks that every telemetry event is listed):
 * - the account: apps/server/src/accounts (users: email, display name, country, avatar), Firebase Auth (email and
 *   password, or "המשך עם Google": apps/mobile/src/auth/firebaseProvider.ts; the server reads only the token's uid,
 *   email and email_verified, never its name or picture claims);
 *   deletion: accounts/store.ts deleteUser (anonymized row, and the same anonymous name in its games' logs;
 *   ratings, games, events stay unlinked)
 * - games and progress: persistence/, progress/ (ratings, xp, achievements, puzzle and opponent history,
 *   practice_results), cheat_flags
 * - usage: apps/mobile/src/services/telemetry and analytics.ts → POST /v1/events (installs, app_events),
 *   and Firebase Analytics; crashes: services/crashlytics.ts (user id = our account id)
 * - IP addresses: only in memory, for rate limits (http/clientKey.ts, http/rateLimiter.ts)
 * - on the phone: practice.db, telemetry.db, the key-value store (installId, settings, cached profile, queues)
 * - processors: Firebase (Google), Fly.io (the server), Neon (the database: spec §17.1, docs/DEPLOY-PRODUCTION.md
 *   §2; with Fly's own Postgres instead, the "sharing" section changes), Sentry
 */

/** Each reported event and what it carries, per language: [what happens, what it carries]. */
export const EVENT_DETAILS: Record<TelemetryEventName, { he: [string, string]; en: [string, string] }> = {
  app_open: { he: ['פתיחת האפליקציה', '—'], en: ['The app opens', '—'] },
  screen_view: {
    he: ['כניסה למסך', 'שם המסך (תבנית הנתיב, בלי מזהים)'],
    en: ['A screen opens', 'The screen’s name (its route pattern, without ids)'],
  },
  register_step: { he: ['שלב בהרשמה נפתח', 'שם השלב'], en: ['A registration step opens', 'The step'] },
  register_complete: { he: ['ההרשמה הסתיימה', '—'], en: ['Registration is completed', '—'] },
  game_start: {
    he: ['משחק מתחיל', 'מצב המשחק, סוג המשחק ומספר השחקנים'],
    en: ['A game starts', 'Mode, game type and number of players'],
  },
  game_end: {
    he: ['משחק מסתיים', 'מצב המשחק, התוצאה, הניקוד, מספר הטעויות ומשך המשחק'],
    en: ['A game ends', 'Mode, result, score, number of mistakes and duration'],
  },
  interference_sent: {
    he: ['שליחת הפרעה', 'סוג ההפרעה ועלותה'],
    en: ['You send an interference', 'Its kind and cost'],
  },
  reaction_sent: { he: ['שליחת תגובה', 'איזה אימוג׳י'], en: ['You send a reaction', 'Which emoji'] },
  matchmaking_wait: {
    he: ['חיפוש יריבים הסתיים', 'זמן ההמתנה בשניות, ואם נמצא משחק'],
    en: ['A search for opponents ends', 'Seconds waited, and whether a game was found'],
  },
  reconnect: {
    he: ['חזרה אחרי ניתוק', 'כמה זמן זה לקח, והאם הצליח'],
    en: ['Reconnecting after a drop', 'How long it took, and whether it worked'],
  },
  latency_sample: {
    he: ['מדידת איכות החיבור', 'זמני תגובה של הרשת, באלפיות שנייה'],
    en: ['A connection-quality sample', 'Network response times, in milliseconds'],
  },
  replay_open: { he: ['פתיחת צפייה חוזרת (Replay)', 'מצב המשחק'], en: ['A replay opens', 'The game’s mode'] },
  account_delete: { he: ['מחיקת החשבון', '—'], en: ['The account is deleted', '—'] },
};

const eventRows = (lang: 'he' | 'en') =>
  (Object.keys(EVENT_DETAILS) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS[name][lang],
  ]);

export const PRIVACY: LegalTexts = {
  he: {
    title: 'מדיניות פרטיות',
    lead: 'מה סודוקו פייט אוסף, למה, מי רואה את זה, כמה זמן זה נשמר, ואיך מוחקים.',
    sections: [
      {
        id: 'who',
        title: 'מי אנחנו',
        blocks: [
          'סודוקו פייט ("המשחק", "אנחנו") הוא משחק סודוקו תחרותי בזמן אמת, שמופעל על ידי {operator}.',
          'בכל שאלה על פרטיות ועל המידע שלכם אפשר לכתוב אלינו: {email}.',
        ],
      },
      {
        id: 'summary',
        title: 'בקצרה',
        blocks: [
          {
            list: [
              'אנחנו אוספים רק מה שצריך כדי להפעיל את המשחק: פרטי החשבון, המשחקים שלכם, ונתוני שימוש שעוזרים לנו להבין איך משחקים ולתקן תקלות.',
              '**אין פרסומות, ואנחנו לא מוכרים מידע.** אנחנו לא עוקבים אחריכם באפליקציות ובאתרים אחרים.',
              'השם לתצוגה, האווטאר, המדינה, הדירוג והסטטיסטיקה שלכם גלויים לשחקנים אחרים. המייל לא גלוי לאף שחקן.',
              'אפשר למחוק את החשבון מתוך האפליקציה בכל רגע: הגדרות ← מחיקת חשבון. פרטים ב[דף מחיקת החשבון](delete-account).',
            ],
          },
        ],
      },
      {
        id: 'account',
        title: 'פרטי החשבון',
        blocks: [
          'כשנרשמים אנחנו שומרים:',
          {
            list: [
              '**מייל:** לכניסה, לאימות הכתובת, לאיפוס סיסמה ולהודעות על החשבון. אנחנו לא שולחים דיוור שיווקי.',
              '**סיסמה** (כשנרשמים עם מייל וסיסמה): מטופלת על ידי Firebase Authentication של Google. היא לא מגיעה לשרתים שלנו, ואנחנו לא יכולים לראות אותה.',
              '**כניסה עם Google (רשות):** אפשר להירשם ולהיכנס עם חשבון Google במקום מייל וסיסמה. אז Firebase Authentication מקבל מ־Google את המייל של החשבון (מאומת על ידי Google) ואת המזהה שלו ב־Google, ושומר אותם עם הכניסה, ואנחנו שומרים את המייל כמו בכל חשבון. Google מוסרת ל־Firebase גם את השם ואת תמונת הפרופיל שלכם ב־Google, ו־Firebase שומר אותם עם הכניסה. השרת שלנו לא שומר אותם ולא מציג אותם: בזירה מופיעים רק השם והאווטאר שאתם בוחרים. אנחנו לא מקבלים את הסיסמה של Google, ולא גישה לשום מידע אחר בחשבון (אנשי קשר, מיילים, קבצים). מי שלא רוצה, נרשם עם מייל וסיסמה.',
              '**שם לתצוגה, מדינה ואווטאר:** אתם בוחרים אותם, והם מוצגים לשחקנים אחרים. המדינה נבחרת על ידיכם (ברירת המחדל לפי הגדרות השפה והאזור של המכשיר). אנחנו לא משתמשים במיקום של המכשיר.',
              '**מועד יצירת החשבון ומועד שינוי השם האחרון** (שם אפשר לשנות פעם ב־30 יום).',
              '**מזהה החשבון** אצלנו, ומזהה הכניסה של Firebase (ובכניסה עם Google, Firebase שומר גם את מזהה חשבון Google).',
            ],
          },
        ],
      },
      {
        id: 'games',
        title: 'משחקים והתקדמות',
        blocks: [
          {
            list: [
              '**משחקים מדורגים** (נשמרים בשרת): הלוח, כל מהלך עם הזמן שלו, ההפרעות והתגובות ששלחתם, הניקוד, הטעויות, המיקום, הדירוג לפני המשחק ואחריו, ואיך המשחק הסתיים. מהם נבנים ההיסטוריה, הצפייה החוזרת (Replay) והסטטיסטיקה.',
              '**דירוגים, XP, רמה והישגים.**',
              '**אילו לוחות שיחקתם ומול מי:** כדי לא לתת לכם את אותו לוח או את אותו יריב שוב ושוב.',
              '**תוצאות של משחקי אימון** (לבד או מול בוט), כשהאפליקציה מדווחת אותן בשביל ה־XP: מצב המשחק, הסוג, התוצאה, מספר המהלכים הנכונים, מתי הסתיים, וכמה XP הוא נתן.',
              '**משחק הוגן:** כשקצב המהלכים במשחק מדורג מהיר באופן חריג, נשמרת רשומה לבדיקה של אדם. אין על סמך זה פעולה אוטומטית.',
            ],
          },
        ],
      },
      {
        id: 'usage',
        title: 'נתוני שימוש',
        blocks: [
          'כדי להבין איך משתמשים במשחק, האפליקציה מדווחת לשרת שלנו על אירועים. כל אירוע כולל מזהה אקראי משלו ואת השעה בטלפון, והשרת מוסיף את השעה שבה קיבל אותו.',
          'כל דיווח כולל גם **מזהה התקנה**: מספר אקראי שנוצר בהפעלה הראשונה ונשמר באפליקציה. הוא לא מבוסס על פרטי המכשיר, ונמחק כשמסירים את האפליקציה. יחד איתו נשלחים סוג המערכת (iOS או Android) וגרסת האפליקציה.',
          'כשאתם מחוברים לחשבון, האירועים וההתקנה משויכים לחשבון. כשאין חיבור לאינטרנט, האירועים ממתינים בטלפון ונשלחים אחר כך.',
          'האירועים:',
          { table: { head: ['אירוע', 'מתי', 'מה הוא כולל'], rows: eventRows('he') } },
          'אותם אירועים נשלחים גם ל־**Google Analytics for Firebase**. הוא מוסיף מזהה של התקנת האפליקציה, פרטי מכשיר ומערכת, נתוני שימוש (למשל משך השימוש), ומיקום משוער (מדינה ואזור) שגוגל מסיקה מכתובת ה־IP. הגדרנו אותו בלי תכונות פרסום: בלי מזהה פרסום, ובלי התאמת מודעות.',
        ],
      },
      {
        id: 'crashes',
        title: 'דוחות קריסה ותקלות',
        blocks: [
          {
            list: [
              '**באפליקציה, Firebase Crashlytics של Google:** כשהאפליקציה קורסת או נתקלת בשגיאה נשלח דוח עם פרטי השגיאה, דגם המכשיר, גרסת המערכת וגרסת האפליקציה, מזהה של התקנת Crashlytics, ומזהה החשבון שלנו כשאתם מחוברים. לא המייל ולא השם.',
              '**בשרת, Sentry:** כשהשרת נתקל בשגיאה נשלח דוח טכני עליה, ולפעמים עם מזהה החשבון שהיה מעורב. בלי מיילים ובלי סיסמאות.',
            ],
          },
        ],
      },
      {
        id: 'ip',
        title: 'כתובת IP',
        blocks: [
          'כשהאפליקציה מתחברת, השרת שלנו רואה את כתובת ה־IP. אנחנו משתמשים בה **רק בזיכרון של השרת**, להגבלת קצב ולהגנה מפני הצפה, ולא שומרים אותה במסד הנתונים.',
          'ספק האחסון של השרת עשוי לשמור יומני גישה רגילים לזמן קצר.',
        ],
      },
      {
        id: 'device',
        title: 'מה נשמר רק בטלפון שלכם',
        blocks: [
          {
            list: [
              'משחקי האימון שלכם וההיסטוריה שלהם.',
              'ההגדרות: צליל, רטט, הפחתת תנועה ושפה.',
              'עותק של הפרופיל, כדי שהאפליקציה תיפתח גם בלי חיבור.',
              'תורים של אירועים ושל תוצאות אימון שעוד לא נשלחו, ומזהה ההתקנה.',
              'החיבור לחשבון (נשמר על ידי Firebase), ובכניסה עם Google גם החשבון שנבחר (נשמר על ידי Google Play Services עד ההתנתקות).',
            ],
          },
          'כל אלה נמחקים כשמסירים את האפליקציה. התנתקות מוחקת את עותק הפרופיל. מחיקת החשבון לא מוחקת את משחקי האימון שבטלפון: כדי למחוק גם אותם, מסירים את האפליקציה.',
        ],
      },
      {
        id: 'not-collected',
        title: 'מה אנחנו לא אוספים',
        blocks: [
          'אנשי קשר, תמונות, מיקרופון, מצלמה, מיקום מדויק, מזהה פרסום ופרטי תשלום. במשחק אין צ׳אט: התגובות הן אימוג׳י מתוך רשימה קבועה.',
        ],
      },
      {
        id: 'public',
        title: 'מה שחקנים אחרים רואים',
        blocks: [
          {
            list: [
              'השם לתצוגה, האווטאר, המדינה (כדגל), הדירוגים, הרמה וההישגים.',
              'בכרטיס השחקן ובטבלת המובילים: מספר המשחקים, אחוז הניצחונות, רצפים, המהלך הטוב ביותר, ממוצע טעויות, תוצאות אחרונות, ההפרעה שאתם שולחים הכי הרבה, ומתי הצטרפתם (חודש ושנה).',
              'במהלך משחק: הניקוד, הטעויות, ההפרעות והתגובות שלכם, והאם אתם מחוברים.',
              'צפייה חוזרת ופרטי משחק: רק לשחקנים שהשתתפו באותו משחק.',
            ],
          },
        ],
      },
      {
        id: 'use',
        title: 'למה אנחנו משתמשים במידע',
        blocks: [
          {
            list: [
              '**להפעיל את המשחק:** חשבון, משחקים, דירוג, Matchmaking, היסטוריה וטבלת מובילים. זה הבסיס להסכם בינינו (תנאי השימוש).',
              '**אבטחה ומשחק הוגן:** הגבלת קצב, זיהוי חריגות ומניעת רמאות. זה האינטרס הלגיטימי שלנו ושל כל השחקנים.',
              '**לשפר את המשחק:** להבין באילו מסכים ובאילו מצבים משחקים, למצוא תקלות ולתקן קריסות. גם זה אינטרס לגיטימי, ונעשה בלי פרסום ובלי פרופיל שיווקי.',
              '**הודעות שירות במייל:** אימות כתובת ואיפוס סיסמה בלבד.',
            ],
          },
        ],
      },
      {
        id: 'sharing',
        title: 'עם מי המידע משותף',
        blocks: [
          'אנחנו **לא מוכרים** מידע, ולא מעבירים אותו למפרסמים או לסוחרי מידע. ספקי השירות שלנו מעבדים אותו בשבילנו בלבד:',
          {
            list: [
              '**Google (Firebase):** כניסה לחשבון (Authentication, כולל הכניסה עם Google), דוחות קריסה (Crashlytics) ונתוני שימוש (Analytics).',
              '**Fly.io:** אחסון השרת.',
              '**Neon:** מסד הנתונים (PostgreSQL).',
              '**Sentry:** דוחות על תקלות בשרת.',
            ],
          },
          'נמסור מידע גם אם החוק מחייב אותנו, או כדי להגן על המשחק ועל השחקנים. אם המשחק יועבר לבעלים אחרים, המידע יעבור איתו, ומדיניות זו תמשיך לחול עליו.',
        ],
      },
      {
        id: 'transfers',
        title: 'איפה המידע נמצא',
        blocks: [
          'השרת ומסד הנתונים נמצאים כרגע באיחוד האירופי (פרנקפורט, גרמניה). Google ו־Sentry עשויים לעבד מידע גם בארצות הברית ובמדינות אחרות, לפי מנגנוני ההגנה שלהם להעברת מידע (כמו הסעיפים החוזיים התקניים של האיחוד האירופי).',
        ],
      },
      {
        id: 'retention',
        title: 'כמה זמן המידע נשמר',
        blocks: [
          {
            list: [
              '**פרטי החשבון:** כל עוד החשבון קיים.',
              '**כשמוחקים את החשבון:** המייל, המדינה, האווטאר והקישור לכניסה נמחקים מיד, והשם לתצוגה מוחלף במזהה אנונימי (השם הישן מתפנה מיד). גם הכניסה ב־Firebase נמחקת, ואיתה מה שנשמר בה מ־Google. מי שנכנס עם Google: האפליקציה גם מבטלת את הגישה שקיבלה לחשבון Google.',
              '**מה נשאר אחרי מחיקה, באופן אנונימי:** משחקים מדורגים, דירוגים, XP, תוצאות אימון, רשומות משחק הוגן ונתוני שימוש. הם כבר לא מקושרים אליכם, אבל המשחקים, הצפייה החוזרת והטבלאות של השחקנים האחרים נשארים שלמים.',
              '**נתוני שימוש:** נשמרים כל עוד הם עוזרים לנו להבין את השימוש במשחק. אנחנו בודקים אותם מדי פעם ומוחקים את הישנים.',
              '**Crashlytics:** ‏Google שומרת דוחות קריסה עד 90 יום. **Analytics:** לפי תקופת השמירה שהגדרנו ב־Firebase.',
            ],
          },
        ],
      },
      {
        id: 'rights',
        title: 'הזכויות שלכם',
        blocks: [
          'אתם יכולים לבקש לראות את המידע שלכם, לתקן אותו (את השם, האווטאר והמדינה אפשר לשנות באפליקציה), למחוק אותו (מחיקת חשבון באפליקציה), או להתנגד לשימוש בו. כתבו אלינו ל־{email}, ונענה תוך 30 יום.',
          'אפשר גם להגיש תלונה לרשות להגנת הפרטיות בישראל, או לרשות הגנת המידע במדינה שלכם.',
        ],
      },
      {
        id: 'children',
        title: 'ילדים',
        blocks: [
          'המשחק לא מיועד לילדים מתחת לגיל 13, ואנחנו לא אוספים ביודעין מידע עליהם. אם נגלה שילד מתחת לגיל 13 פתח חשבון, נמחק אותו. במדינות שבהן הגיל המינימלי גבוה יותר, צריך את אישור ההורים עד אותו גיל.',
        ],
      },
      {
        id: 'security',
        title: 'אבטחה',
        blocks: [
          'התקשורת בין האפליקציה לשרת מוצפנת (HTTPS ו־WSS). הסיסמאות מטופלות על ידי Firebase ולא נשמרות אצלנו. הגישה לנתונים בשרת מוגבלת למפעיל המשחק. שום מערכת לא מאובטחת לגמרי, אבל אנחנו עושים מאמץ סביר להגן על המידע.',
        ],
      },
      {
        id: 'changes',
        title: 'שינויים במדיניות',
        blocks: ['כשהמדיניות משתנה, נעדכן כאן את התאריך. על שינוי מהותי נודיע גם באפליקציה.'],
      },
      {
        id: 'contact',
        title: 'יצירת קשר',
        blocks: ['{operator} · {email}', 'ראו גם את [תנאי השימוש](terms).'],
      },
    ],
  },

  en: {
    title: 'Privacy Policy',
    lead: 'What Sudoku Fight collects, why, who sees it, how long it is kept, and how to delete it.',
    sections: [
      {
        id: 'who',
        title: 'Who we are',
        blocks: [
          'Sudoku Fight ("the game", "we") is a real-time competitive sudoku game operated by {operator}.',
          'For any question about privacy and your data, write to us at {email}.',
        ],
      },
      {
        id: 'summary',
        title: 'In short',
        blocks: [
          {
            list: [
              'We collect only what is needed to run the game: your account details, your games, and usage data that helps us understand how the game is played and fix problems.',
              '**No ads, and we don’t sell data.** We don’t track you across other apps or websites.',
              'Your display name, avatar, country, ratings and stats are visible to other players. Your email is never shown to other players.',
              'You can delete your account in the app at any time: Settings → Delete account. See the [account deletion page](delete-account).',
            ],
          },
        ],
      },
      {
        id: 'account',
        title: 'Account details',
        blocks: [
          'When you register we keep:',
          {
            list: [
              '**Email:** to sign in, verify the address, reset your password and send account messages. We don’t send marketing email.',
              '**Password** (when you sign up with email and password): handled by Google’s Firebase Authentication. It never reaches our servers, and we can’t see it.',
              '**Sign in with Google (optional):** you can sign up and sign in with your Google account instead of an email and password. Firebase Authentication then receives from Google your Google account’s email (verified by Google) and its Google id, and keeps them with your sign-in; we keep the email as with any account. Google also gives Firebase your Google name and profile photo, which Firebase keeps with the sign-in. Our server doesn’t store or show them: in the arena only the name and avatar you choose appear. We never get your Google password, or access to anything else in your Google account (contacts, email, files). If you prefer, sign up with email and password.',
              '**Display name, country and avatar:** you choose them, and they are shown to other players. You pick the country yourself (the default comes from your device’s language and region settings). We don’t use your device’s location.',
              '**When the account was created and when the name last changed** (a name can change once in 30 days).',
              '**Our account id**, and your Firebase sign-in id (with Google sign-in, Firebase also keeps your Google account id).',
            ],
          },
        ],
      },
      {
        id: 'games',
        title: 'Games and progress',
        blocks: [
          {
            list: [
              '**Ranked games** (kept on the server): the board, every move with its timing, the interferences and reactions you sent, your score, mistakes, place, rating before and after, and how the game ended. They make your history, replays and stats.',
              '**Ratings, XP, level and achievements.**',
              '**Which puzzles you played, and against whom:** so you don’t get the same puzzle or opponent again and again.',
              '**Practice results** (solo or against a bot), when the app reports them for XP: mode, game type, outcome, number of correct moves, when it ended, and the XP it earned.',
              '**Fair play:** when the pace of moves in a ranked game is unusually fast, a record is kept for a person to review. Nothing happens automatically because of it.',
            ],
          },
        ],
      },
      {
        id: 'usage',
        title: 'Usage data',
        blocks: [
          'To understand how the game is used, the app reports events to our server. Each event has its own random id and the time on your phone; the server adds the time it received it.',
          'Every report also carries an **install id**: a random number made on the first launch and kept in the app. It is not based on your device’s details, and it is gone when you uninstall the app. With it go the system (iOS or Android) and the app’s version.',
          'While you are signed in, events and the install are linked to your account. Without a connection, events wait on your phone and are sent later.',
          'The events:',
          { table: { head: ['Event', 'When', 'What it carries'], rows: eventRows('en') } },
          'The same events also go to **Google Analytics for Firebase**, which adds an id of the app installation, device and system details, usage data (such as session length), and an approximate location (country and region) that Google infers from the IP address. We set it up without advertising features: no advertising id, and no ad personalization.',
        ],
      },
      {
        id: 'crashes',
        title: 'Crash and error reports',
        blocks: [
          {
            list: [
              '**In the app, Google’s Firebase Crashlytics:** when the app crashes or meets an error, a report goes out with the error’s details, the device model, the system and app versions, a Crashlytics installation id, and our account id while you are signed in. Not your email or name.',
              '**On the server, Sentry:** when the server meets an error, a technical report about it goes out, sometimes with the id of the account involved. No emails and no passwords.',
            ],
          },
        ],
      },
      {
        id: 'ip',
        title: 'IP address',
        blocks: [
          'When the app connects, our server sees your IP address. We use it **only in the server’s memory**, to limit request rates and protect against floods, and we don’t store it in our database.',
          'Our hosting provider may keep ordinary access logs for a short time.',
        ],
      },
      {
        id: 'device',
        title: 'What stays on your phone only',
        blocks: [
          {
            list: [
              'Your practice games and their history.',
              'Your settings: sound, haptics, reduced motion and language.',
              'A copy of your profile, so the app opens without a connection.',
              'Queues of events and practice results not sent yet, and the install id.',
              'Your sign-in (kept by Firebase), and with Google sign-in the account you chose (kept by Google Play services until you sign out).',
            ],
          },
          'All of these are deleted when you uninstall the app. Signing out deletes the profile copy. Deleting your account does not delete the practice games on your phone: to delete those too, uninstall the app.',
        ],
      },
      {
        id: 'not-collected',
        title: 'What we don’t collect',
        blocks: [
          'Contacts, photos, microphone, camera, precise location, advertising ids and payment details. The game has no chat: reactions are emoji from a fixed list.',
        ],
      },
      {
        id: 'public',
        title: 'What other players see',
        blocks: [
          {
            list: [
              'Your display name, avatar, country (as a flag), ratings, level and achievements.',
              'On your player card and the leaderboards: number of games, win rate, streaks, best move, average mistakes, recent results, the interference you send most, and when you joined (month and year).',
              'During a game: your score, mistakes, interferences and reactions, and whether you are online.',
              'Replays and game details: only the players of that game.',
            ],
          },
        ],
      },
      {
        id: 'use',
        title: 'Why we use the data',
        blocks: [
          {
            list: [
              '**To run the game:** your account, games, ratings, matchmaking, history and leaderboards. This is needed for our agreement with you (the Terms of Use).',
              '**Security and fair play:** rate limits, spotting anomalies and preventing cheating. This is our legitimate interest, and every player’s.',
              '**To improve the game:** to learn which screens and modes are played, find problems and fix crashes. Also a legitimate interest, with no advertising and no marketing profile.',
              '**Service email:** address verification and password reset only.',
            ],
          },
        ],
      },
      {
        id: 'sharing',
        title: 'Who we share it with',
        blocks: [
          'We **don’t sell** data, and we don’t pass it to advertisers or data brokers. Our service providers process it for us only:',
          {
            list: [
              '**Google (Firebase):** sign-in (Authentication, including sign-in with Google), crash reports (Crashlytics) and usage data (Analytics).',
              '**Fly.io:** hosting for the server.',
              '**Neon:** the database (PostgreSQL).',
              '**Sentry:** reports of server errors.',
            ],
          },
          'We will also disclose data when the law requires it, or to protect the game and its players. If the game passes to another owner, the data goes with it, and this policy keeps applying to it.',
        ],
      },
      {
        id: 'transfers',
        title: 'Where the data is',
        blocks: [
          'The server and the database are currently in the European Union (Frankfurt, Germany). Google and Sentry may also process data in the United States and other countries, under their own safeguards for data transfers (such as the EU Standard Contractual Clauses).',
        ],
      },
      {
        id: 'retention',
        title: 'How long we keep it',
        blocks: [
          {
            list: [
              '**Account details:** as long as the account exists.',
              '**When you delete your account:** your email, country, avatar and sign-in link are deleted at once, and your display name is replaced by an anonymous id (the old name is free again at once). Your Firebase sign-in is deleted too, with what it kept from Google. If you signed in with Google, the app also revokes the access it was given to your Google account.',
              '**What stays after deletion, anonymously:** ranked games, ratings, XP, practice results, fair-play records and usage data. They are no longer linked to you, but other players’ games, replays and leaderboards stay whole.',
              '**Usage data:** kept while it helps us understand how the game is used. We review it from time to time and delete old data.',
              '**Crashlytics:** Google keeps crash reports for up to 90 days. **Analytics:** for the retention period we set in Firebase.',
            ],
          },
        ],
      },
      {
        id: 'rights',
        title: 'Your rights',
        blocks: [
          'You can ask to see your data, correct it (you can change your name, avatar and country in the app), delete it (delete your account in the app), or object to its use. Write to us at {email}, and we will answer within 30 days.',
          'You can also complain to Israel’s Privacy Protection Authority, or to the data protection authority of your country.',
        ],
      },
      {
        id: 'children',
        title: 'Children',
        blocks: [
          'The game is not meant for children under 13, and we don’t knowingly collect data about them. If we learn that a child under 13 opened an account, we will delete it. Where the minimum age is higher, a parent’s consent is needed up to that age.',
        ],
      },
      {
        id: 'security',
        title: 'Security',
        blocks: [
          'Traffic between the app and the server is encrypted (HTTPS and WSS). Passwords are handled by Firebase and are not stored by us. Access to the data on the server is limited to the game’s operator. No system is perfectly secure, but we make reasonable efforts to protect your data.',
        ],
      },
      {
        id: 'changes',
        title: 'Changes to this policy',
        blocks: [
          'When this policy changes, we update the date here. We will also announce material changes in the app.',
        ],
      },
      {
        id: 'contact',
        title: 'Contact',
        blocks: ['{operator} · {email}', 'See also the [Terms of Use](terms).'],
      },
    ],
  },
};
