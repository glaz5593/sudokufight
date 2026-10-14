import type { LegalTexts } from './types';

/**
 * How to delete an account (spec §3.3, §23). Apple wants deletion inside the app (Settings → מחיקת חשבון,
 * auth/authStore.ts deleteAccount); Google Play's Data safety form also wants a web page that says how to ask
 * for it without the app. What is deleted and what stays: accounts/store.ts deleteUser.
 */
export const DELETE_ACCOUNT: LegalTexts = {
  he: {
    title: 'מחיקת חשבון',
    lead: 'איך מוחקים את חשבון סודוקו פייט, ומה קורה למידע.',
    sections: [
      {
        id: 'in-app',
        title: 'מתוך האפליקציה (מיידי)',
        blocks: [
          {
            list: [
              'פותחים את סודוקו פייט ונכנסים ל**הגדרות**.',
              'לוחצים **מחיקת חשבון**, ומאשרים.',
              'מקלידים את הסיסמה, או, מי שנכנס עם Google, בוחרים שוב את חשבון Google. החשבון נמחק מיד, והאפליקציה חוזרת למסך הכניסה.',
            ],
            ordered: true,
          },
        ],
      },
      {
        id: 'by-email',
        title: 'בלי האפליקציה',
        blocks: [
          'כתבו אלינו ל־{email} **מהמייל של החשבון**, עם הנושא "מחיקת חשבון" והשם לתצוגה. נוודא שהבקשה הגיעה מבעל החשבון, ונמחק אותו תוך 30 יום. נאשר במייל כשהמחיקה הושלמה.',
        ],
      },
      {
        id: 'what',
        title: 'מה נמחק ומה נשאר',
        blocks: [
          {
            list: [
              '**נמחק מיד:** המייל, המדינה, האווטאר, הכניסה לחשבון (גם ב־Firebase), והקישור בין החשבון להתקנות שלכם. השם לתצוגה מוחלף במזהה אנונימי ומתפנה לאחרים.',
              '**נשאר באופן אנונימי:** משחקים מדורגים, דירוגים, XP, תוצאות אימון, רשומות משחק הוגן ונתוני שימוש. הם כבר לא מקושרים אליכם, אבל המשחקים והטבלאות של שחקנים אחרים נשארים שלמים.',
              '**בטלפון:** משחקי האימון שבטלפון נשארים עד שמסירים את האפליקציה.',
              '**אצל Google:** דוחות קריסה נשמרים עד 90 יום, ונתוני Analytics לפי תקופת השמירה שהוגדרה.',
            ],
          },
          'פרטים נוספים ב[מדיניות הפרטיות](privacy).',
        ],
      },
    ],
  },

  en: {
    title: 'Delete your account',
    lead: 'How to delete your Sudoku Fight account, and what happens to your data.',
    sections: [
      {
        id: 'in-app',
        title: 'In the app (immediate)',
        blocks: [
          {
            list: [
              'Open Sudoku Fight and go to **Settings**.',
              'Tap **Delete account**, and confirm.',
              'Enter your password, or, if you sign in with Google, choose your Google account again. The account is deleted at once, and the app goes back to the sign-in screen.',
            ],
            ordered: true,
          },
        ],
      },
      {
        id: 'by-email',
        title: 'Without the app',
        blocks: [
          'Write to us at {email} **from your account’s email address**, with the subject "Delete my account" and your display name. We will make sure the request comes from the account’s owner, and delete it within 30 days. We will confirm by email once it is done.',
        ],
      },
      {
        id: 'what',
        title: 'What is deleted and what stays',
        blocks: [
          {
            list: [
              '**Deleted at once:** your email, country, avatar, your sign-in (in Firebase too), and the link between your account and your installs. Your display name is replaced by an anonymous id and is free for others.',
              '**Kept anonymously:** ranked games, ratings, XP, practice results, fair-play records and usage data. They are no longer linked to you, but other players’ games and leaderboards stay whole.',
              '**On your phone:** the practice games on your phone stay until you uninstall the app.',
              '**At Google:** crash reports are kept for up to 90 days, and Analytics data for the retention period set.',
            ],
          },
          'More in the [Privacy Policy](privacy).',
        ],
      },
    ],
  },
};
