import type { QaCatalog } from '@sudoku-fight/protocol';

/**
 * A small QA catalog for tests (the shipped one, apps/server/data/qa-catalog.json, has its own test): three
 * categories, six tasks, every `who`, each task with its subtitle.
 *
 *   friends   friends-room     friends-room-create (both), friends-room-join (claude)
 *             friends-invite   friends-invite-link (moshe)
 *   practice  practice-gates   practice-gate-open (claude), practice-stars (moshe)
 *   sound     sound-basics     sound-mute (moshe)
 *
 * A fresh copy each call: a test may change it.
 */
export function testQaCatalog(): QaCatalog {
  return {
    catalogVersion: 3,
    categories: [
      {
        id: 'friends',
        title: 'חברים',
        subcategories: [
          {
            id: 'friends-room',
            title: 'חדר עם חברים',
            tasks: [
              {
                id: 'friends-room-create',
                title: 'פתיחת חדר',
                subtitle: 'בדוק פתיחת חדר חדש מלשונית החברים',
                steps: ['פותחים את לשונית "חברים"', 'לוחצים על "פתח חדר"'],
                expected: ['נפתח חדר עם קוד בן 6 תווים', 'הקוד מוצג משמאל לימין'],
                who: 'both',
                source: 'FRIENDS-DEVICE-CHECKS בדיקה 7',
              },
              {
                id: 'friends-room-join',
                title: 'הצטרפות עם קוד',
                subtitle: 'בדוק הצטרפות לחדר עם הקוד מטלפון שני',
                steps: ['בטלפון השני מקלידים את הקוד'],
                expected: ['שני השחקנים רואים זה את זה בחדר'],
                who: 'claude',
              },
            ],
          },
          {
            id: 'friends-invite',
            title: 'הזמנה',
            tasks: [
              {
                id: 'friends-invite-link',
                title: 'קישור הזמנה',
                subtitle: 'בדוק שקישור הזמנה פותח את האפליקציה ישר בחדר',
                steps: ['שולחים את הקישור בוואטסאפ', 'פותחים אותו בטלפון השני'],
                expected: ['האפליקציה נפתחת ישר בחדר'],
                who: 'moshe',
              },
            ],
          },
        ],
      },
      {
        id: 'practice',
        title: 'אימון בשלבים',
        subcategories: [
          {
            id: 'practice-gates',
            title: 'שערים וכוכבים',
            tasks: [
              {
                id: 'practice-gate-open',
                title: 'שער נפתח',
                subtitle: 'בדוק שהשער לפרק הבא נפתח אחרי שלב הבוס',
                steps: ['מסיימים את שלב הבוס של פרק 1'],
                expected: ['השער לפרק 2 נפתח'],
                who: 'claude',
              },
              {
                id: 'practice-stars',
                title: 'כוכבים',
                subtitle: 'בדוק שסיום שלב בלי טעויות נותן 3 כוכבים',
                steps: ['מסיימים שלב בלי טעויות'],
                expected: ['מקבלים 3 כוכבים'],
                who: 'moshe',
              },
            ],
          },
        ],
      },
      {
        id: 'sound',
        title: 'צלילים',
        subcategories: [
          {
            id: 'sound-basics',
            title: 'בסיס',
            tasks: [
              {
                id: 'sound-mute',
                title: 'השתקה',
                subtitle: 'בדוק שהשתקה בהגדרות משתיקה את המשחק',
                steps: ['משתיקים בהגדרות'],
                expected: ['אין צליל במשחק'],
                who: 'moshe',
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The fixture's task ids in catalog order. */
export const TEST_QA_TASKS = [
  'friends-room-create',
  'friends-room-join',
  'friends-invite-link',
  'practice-gate-open',
  'practice-stars',
  'sound-mute',
] as const;
