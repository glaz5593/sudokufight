import type { LegalTexts } from './types';

/**
 * The terms of use (spec §3.2: accepted at registration; §23). They describe the game as built: display names
 * with a word filter and a 30-day rename rule [D20], fair play (cheat_flags, no automatic action in V1),
 * ratings and XP with no money value, no purchases and no ads, ranked games cut short by a server restart end
 * unrated (persistence endInterruptedGames). The governing-law clause is a default for Moshe to confirm.
 */
export const TERMS: LegalTexts = {
  he: {
    title: 'תנאי שימוש',
    lead: 'הכללים לשימוש בסודוקו פייט. השימוש במשחק פירושו הסכמה להם.',
    sections: [
      {
        id: 'acceptance',
        title: 'הסכמה',
        blocks: [
          'תנאים אלה חלים על השימוש באפליקציה סודוקו פייט ובשירותים שלה ("המשחק"), שמופעלים על ידי {operator} ("אנחנו"). בהרשמה או בשימוש במשחק אתם מסכימים להם ול[מדיניות הפרטיות](privacy).',
        ],
      },
      {
        id: 'eligibility',
        title: 'מי יכול לשחק',
        blocks: [
          'צריך להיות בני 13 לפחות, או בגיל המינימלי שנקבע בחוק במדינה שלכם אם הוא גבוה יותר. מתחת לגיל 18 צריך את הסכמת ההורים או האפוטרופוס.',
        ],
      },
      {
        id: 'account',
        title: 'החשבון',
        blocks: [
          {
            list: [
              'חשבון אחד לכל אדם, עם מייל שלכם.',
              'שמרו על הסיסמה (או על חשבון Google שאיתו אתם נכנסים). אתם אחראים לכל מה שנעשה בחשבון שלכם.',
              'אפשר למחוק את החשבון בכל רגע מתוך האפליקציה: הגדרות ← מחיקת חשבון.',
            ],
          },
        ],
      },
      {
        id: 'names',
        title: 'שם לתצוגה והתנהגות',
        blocks: [
          'השם לתצוגה, האווטאר והמדינה גלויים לכל השחקנים. אסור שהשם:',
          {
            list: [
              'יהיה פוגעני, גזעני, מיני, מאיים או מעליב;',
              'יתחזה לאדם אחר, לשחקן אחר או לצוות המשחק;',
              'יכלול פרטים אישיים (טלפון, כתובת), פרסומת או קישור.',
            ],
          },
          'שמות נבדקים אוטומטית מול רשימת מילים אסורות. אנחנו רשאים לשנות שם שמפר את הכללים, לבקש שם חדש, או להשעות חשבון.',
          'התגובות במשחק הן אימוג׳י מתוך רשימה קבועה. אפשר להשתיק יריב מתוך הכרטיס שלו במשחק.',
        ],
      },
      {
        id: 'fair-play',
        title: 'משחק הוגן',
        blocks: [
          'אסור:',
          {
            list: [
              'להשתמש בפותרי סודוקו, בבוטים, בסקריפטים, באוטומציה או באפליקציה ששונתה;',
              'להחזיק כמה חשבונות כדי להשפיע על הדירוג, לתאם תוצאות עם שחקן אחר, או להפסיד בכוונה;',
              'לנצל תקלות במקום לדווח עליהן;',
              'להעמיס על השרתים, לנסות לפרוץ אליהם או להפריע לשחקנים אחרים.',
            ],
          },
          'השרת מסמן משחקים חריגים לבדיקה. אם נמצא שהכללים הופרו, אנחנו רשאים לבטל תוצאות, לאפס דירוג או להשעות ולסגור חשבון.',
        ],
      },
      {
        id: 'virtual',
        title: 'דירוג, XP והישגים',
        blocks: [
          'לדירוג, ל־XP, לרמות ולהישגים אין ערך כספי, ואי אפשר להעביר או למכור אותם. אנחנו רשאים לשנות את הנוסחאות שלהם או לאפס אותם (למשל בתחילת עונה).',
          'המשחק בחינם. בגרסה הזאת אין בו רכישות ואין פרסומות.',
        ],
      },
      {
        id: 'service',
        title: 'זמינות השירות',
        blocks: [
          'משחקים מדורגים דורשים חיבור לאינטרנט. כשאין יריבים זמינים, המשחק עשוי להציע משחק מול בוט. אם השרת מופעל מחדש באמצע משחק מדורג, המשחק מסתיים בלי שינוי בדירוג.',
          'אנחנו רשאים לשנות, להשהות או להפסיק חלקים מהמשחק, ונשתדל להודיע מראש על שינוי מהותי.',
        ],
      },
      {
        id: 'ip',
        title: 'קניין רוחני',
        blocks: [
          'המשחק, העיצוב, הקוד, הצלילים והאווטרים שייכים לנו או למי שנתן לנו רישיון. אנחנו מעניקים לכם רישיון אישי, לא בלעדי ולא מסחרי להשתמש במשחק לפי תנאים אלה. רשימת הרישיונות של צד שלישי נמצאת באפליקציה: הגדרות ← רישיונות.',
        ],
      },
      {
        id: 'stores',
        title: 'חנויות האפליקציות',
        blocks: [
          'Apple ו־Google אינן צד לתנאים אלה ואינן אחראיות למשחק. אם הורדתם את המשחק מה־App Store, חל גם הסכם הרישיון הרגיל של Apple למשתמש הקצה (Standard EULA), ו־Apple והחברות הבנות שלה רשאיות לאכוף את התנאים האלה כצד שלישי מוטב.',
        ],
      },
      {
        id: 'disclaimer',
        title: 'אחריות',
        blocks: [
          'המשחק ניתן "כמות שהוא" (AS IS). ככל שהחוק מתיר, אנחנו לא נותנים אחריות שהוא יפעל בלי הפסקות או בלי תקלות, ולא נהיה אחראים לנזק עקיף, לאובדן נתונים או לאובדן דירוג. אין בתנאים אלה כדי לגרוע מזכויות שהחוק מקנה לכם ושאי אפשר לוותר עליהן.',
        ],
      },
      {
        id: 'termination',
        title: 'סיום',
        blocks: [
          'אתם יכולים להפסיק לשחק ולמחוק את החשבון בכל עת. אנחנו רשאים להשעות או לסגור חשבון שמפר את התנאים.',
        ],
      },
      {
        id: 'changes',
        title: 'שינויים בתנאים',
        blocks: [
          'כשהתנאים משתנים, נעדכן כאן את התאריך. על שינוי מהותי נודיע גם באפליקציה. המשך השימוש אחרי השינוי הוא הסכמה לתנאים החדשים.',
        ],
      },
      {
        id: 'law',
        title: 'הדין החל',
        blocks: [
          'על תנאים אלה חלים דיני מדינת ישראל, וסמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים במחוז תל אביב, אלא אם החוק במדינה שלכם מקנה לכם זכות אחרת שאי אפשר לוותר עליה.',
        ],
      },
      {
        id: 'contact',
        title: 'יצירת קשר',
        blocks: ['{operator} · {email}'],
      },
    ],
  },

  en: {
    title: 'Terms of Use',
    lead: 'The rules for using Sudoku Fight. Using the game means you accept them.',
    sections: [
      {
        id: 'acceptance',
        title: 'Acceptance',
        blocks: [
          'These terms apply to the Sudoku Fight app and its services ("the game"), operated by {operator} ("we"). By registering or using the game you accept them and the [Privacy Policy](privacy).',
        ],
      },
      {
        id: 'eligibility',
        title: 'Who can play',
        blocks: [
          'You must be at least 13, or the minimum age the law of your country sets if that is higher. Under 18, you need the consent of a parent or guardian.',
        ],
      },
      {
        id: 'account',
        title: 'Your account',
        blocks: [
          {
            list: [
              'One account per person, with your own email.',
              'Keep your password (or the Google account you sign in with) safe. You are responsible for everything done with your account.',
              'You can delete your account at any time in the app: Settings → Delete account.',
            ],
          },
        ],
      },
      {
        id: 'names',
        title: 'Display names and conduct',
        blocks: [
          'Your display name, avatar and country are visible to all players. A name must not:',
          {
            list: [
              'be offensive, racist, sexual, threatening or insulting;',
              'impersonate another person, another player or the game’s staff;',
              'contain personal details (a phone number, an address), advertising or a link.',
            ],
          },
          'Names are checked automatically against a list of blocked words. We may change a name that breaks these rules, ask for a new one, or suspend the account.',
          'Reactions in the game are emoji from a fixed list. You can mute an opponent from their card during a game.',
        ],
      },
      {
        id: 'fair-play',
        title: 'Fair play',
        blocks: [
          'You must not:',
          {
            list: [
              'use sudoku solvers, bots, scripts, automation or a modified app;',
              'keep several accounts to influence ratings, arrange results with another player, or lose on purpose;',
              'exploit bugs instead of reporting them;',
              'overload our servers, try to break into them, or disrupt other players.',
            ],
          },
          'The server flags unusual games for review. If the rules were broken, we may cancel results, reset ratings, or suspend and close the account.',
        ],
      },
      {
        id: 'virtual',
        title: 'Ratings, XP and achievements',
        blocks: [
          'Ratings, XP, levels and achievements have no monetary value, and can’t be transferred or sold. We may change how they are computed or reset them (for example, at the start of a season).',
          'The game is free. This version has no purchases and no ads.',
        ],
      },
      {
        id: 'service',
        title: 'Availability',
        blocks: [
          'Ranked games need an internet connection. When no opponents are available, the game may offer a game against a bot. If the server restarts during a ranked game, that game ends with no rating change.',
          'We may change, pause or stop parts of the game, and we will try to give notice of material changes.',
        ],
      },
      {
        id: 'ip',
        title: 'Intellectual property',
        blocks: [
          'The game, its design, code, sounds and avatars belong to us or to those who licensed them to us. We give you a personal, non-exclusive, non-commercial license to use the game under these terms. Third-party licenses are listed in the app: Settings → Licenses.',
        ],
      },
      {
        id: 'stores',
        title: 'App stores',
        blocks: [
          'Apple and Google are not parties to these terms and are not responsible for the game. If you downloaded the game from the App Store, Apple’s Standard End User License Agreement (EULA) also applies, and Apple and its subsidiaries may enforce these terms as third-party beneficiaries.',
        ],
      },
      {
        id: 'disclaimer',
        title: 'Disclaimer',
        blocks: [
          'The game is provided "as is". To the extent the law allows, we don’t warrant that it will work without interruption or errors, and we are not liable for indirect damage, lost data or lost ratings. Nothing in these terms limits rights the law gives you that cannot be waived.',
        ],
      },
      {
        id: 'termination',
        title: 'Ending',
        blocks: [
          'You can stop playing and delete your account at any time. We may suspend or close an account that breaks these terms.',
        ],
      },
      {
        id: 'changes',
        title: 'Changes to these terms',
        blocks: [
          'When these terms change, we update the date here. We will also announce material changes in the app. Using the game after a change means you accept the new terms.',
        ],
      },
      {
        id: 'law',
        title: 'Governing law',
        blocks: [
          'These terms are governed by the laws of the State of Israel, and the competent courts of the Tel Aviv district have exclusive jurisdiction, unless the law of your country gives you a right that cannot be waived.',
        ],
      },
      {
        id: 'contact',
        title: 'Contact',
        blocks: ['{operator} · {email}'],
      },
    ],
  },
};
