<div dir="rtl">

# Google Play: טופס Data safety

שלב 14, אפיון סעיף 23. התשובות **לפי מה שהקוד אוסף בפועל**, כמו מדיניות הפרטיות (`/legal/privacy`) ו־`APP-PRIVACY.md` (שם גם טבלת המקורות בקוד).
התנאים המוקדמים זהים לאלה שב־`APP-PRIVACY.md`, סעיף 0, ועוד אחד ל־Android: **הרשאת `AD_ID` חסומה** (✅ בקוד: `app.config.ts`; לוודא בבנייה, `LISTING-GOOGLE.md`, "Advertising ID"). בלי זה, ‏"Device or other IDs" כולל גם את מזהה הפרסום, והתשובות משתנות.

**הגדרות של Google שחשובות כאן:**
- **"Collected"**: מידע שיוצא מהמכשיר אלינו או לספק שלנו. מה שנשאר במכשיר (משחקי אימון, הגדרות) לא נחשב.
- **"Shared"**: העברה **לצד שלישי**. ספקי שירות שמעבדים בשבילנו (Firebase, ‏Fly.io, ‏Neon, ‏Sentry) **לא נחשבים שיתוף**. גם מה ששחקן מפרסם בכוונה לשחקנים אחרים (השם לתצוגה) לא נחשב.
- **"Processed ephemerally"**: מידע שמשמש רק בזיכרון, לזמן קצר. כתובת ה־IP אצלנו היא כזו (הגבלת קצב), ולכן היא לא מוצהרת.

## 1. Data collection and security

| שאלה | תשובה | הערה |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | ‏HTTPS ו־WSS. בבניית Production צריך `EXPO_PUBLIC_SERVER_SECURE=true` (‏`fly.toml`: ‏`force_https`). ה־SDKs של Firebase תמיד ב־TLS |
| Which account creation methods does your app support? | **Username and password**, ו־**OAuth** | מייל וסיסמה (Firebase Auth), או "המשך עם Google" (רשות; מ־14.10.2026). אין התחברות בלי חשבון |
| Delete account URL | `https://<שרת ה־Production>/legal/delete-account?lang=en` | הדף מסביר את המחיקה באפליקציה, ומאפשר לבקש מחיקה במייל בלי האפליקציה |
| Can users request that some data is deleted without deleting the account? | **No** | (שאלה אופציונלית.) מחיקה חלקית אין. אפשר לשנות שם, אווטאר ומדינה |

> ⚠️ **מחיקה במייל (בלי האפליקציה)** היא תהליך ידני: היום אין בשרת כלי ניהול שמוחק חשבון. עד שיהיה (למשל פקודת `npm run` שקוראת ל־`deleteUser` לפי מייל), משה מוחק כך: את המשתמש ב־Firebase Console → Authentication, ואת השורה בשרת לפי אותם כללים של `accounts/store.ts` ‏`deleteUser`. הדף מבטיח מענה תוך 30 יום.

## 2. Data types

"Required" = השחקן לא יכול לוותר עליו (אין באפליקציה כיבוי של נתוני שימוש). "Optional" = אין כאן.

| קטגוריה | סוג | Collected | Shared | Ephemeral | Required? | Purposes |
|---|---|---|---|---|---|---|
| Location | **Approximate location** | **Yes** | No | No | Required | Analytics. ‏Firebase Analytics מסיק מדינה ואזור מה־IP |
| Location | Precise location | No | | | | |
| Personal info | **Name** | **Yes** | No | No | Required | App functionality, Account management. השם לתצוגה (Google: "Name… or nickname"). בכניסה עם Google גם השם של חשבון Google, ש־Firebase Authentication שומר עם הכניסה (לא מוצג ולא בשימוש) |
| Personal info | **Email address** | **Yes** | No | No | Required | App functionality, Account management |
| Personal info | **User IDs** | **Yes** | No | No | Required | App functionality, Analytics, Account management. מזהה החשבון וה־uid של Firebase, ובכניסה עם Google גם מזהה חשבון Google (ב־Firebase) |
| Personal info | Address, Phone number, Race and ethnicity, Political or religious beliefs, Sexual orientation | No | | | | |
| Personal info | **Other info** | **Yes** | No | No | Required | App functionality. המדינה והאווטאר שהשחקן בוחר. בכניסה עם Google גם הקישור לתמונת הפרופיל של Google, ש־Firebase שומר עם הכניסה (קישור, לא התמונה) |
| Financial info | הכל | No | | | | אין רכישות |
| Health and fitness | הכל | No | | | | |
| Messages | Emails, SMS or MMS, Other in-app messages | No | | | | אין צ׳אט. התגובות הן 6 אימוג׳י קבועים: פעולה במשחק, לא הודעה |
| Photos and videos, Audio, Files and docs, Calendar, Contacts | הכל | No | | | | גם בכניסה עם Google: לא תמונות (רק הקישור, תחת Other info) ולא אנשי קשר |
| App activity | **App interactions** | **Yes** | No | No | Required | Analytics, App functionality. האירועים ו־`screen_view`, כולל ששת האירועים של אימון בשלבים (1.0.2: מספר השלב, הסוג, הכוכבים, הזמן, הסיבה לסיום; בלי מזהים), וששת האירועים של משחק עם חברים (1.0.4: סוג המשחק, הדרך, התוצאה, מספר השחקנים וזמן ההמתנה; בלי קוד החדר ובלי מזהים) |
| App activity | In-app search history, Installed apps | No | | | | |
| App activity | Other user-generated content | No | | | | השם לתצוגה מוצהר תחת Name |
| App activity | **Other actions** | **Yes** | No | No | Required | App functionality, Analytics, Fraud prevention, security, and compliance. מהלכים, משחקים, דירוג, XP, ‏cheat_flags. **דיווחים על שחקנים** (מי, על מי, אחת משלוש סיבות קבועות, המשחק, מתי) ו**חסימות** (את מי ומתי), אפיון 3.5. **ההתקדמות באימון בשלבים** (1.0.2): הכוכבים הטובים ביותר וכמה משחקים בכל שלב, שמסונכרנים לחשבון, וה־XP מהשלבים בכל יום. **משחקים עם חברים** (1.0.4): נשמרים כמו משחק מדורג, בלי דירוג, עם ה־XP של כל שחקן. **קצב** (הבוט הסמוי, D90): הזמן הממוצע למהלך שנגזר מכל משחק מדורג (`pace_ms`), לקצב של יריב ממוחשב |
| Web browsing | Web browsing history | No | | | | |
| App info and performance | **Crash logs** | **Yes** | No | No | Required | App functionality, Analytics. ‏Crashlytics |
| App info and performance | **Diagnostics** | **Yes** | No | No | Required | App functionality, Analytics. ‏`latency_sample`, ‏`reconnect`, דגם, מערכת וגרסה |
| App info and performance | Other app performance data | No | | | | נכלל ב־Diagnostics |
| Device or other IDs | **Device or other IDs** | **Yes** | No | No | Required | App functionality, Analytics, Fraud prevention, security, and compliance. ‏`installId`, ‏App Instance ID של Firebase, מזהה Crashlytics. **לא** Advertising ID |

## 3. מה מופיע בדף החנות (תצוגה מקדימה)

- **No data shared with third parties.**
- **Data collected:** Location, Personal info, App activity, App info and performance, Device or other IDs.
- **Security practices:** Data is encrypted in transit · You can request that data be deleted.

## 4. מתי לעדכן

- כל הוספה של SDK (פרסום, תשלומים, צ׳אט, התחברות עם Facebook או עם Apple) או של אירוע אנליטיקס עם מידע חדש. (התחברות עם Google כבר כלולה למעלה, מ־14.10.2026.)
- ~~הוספת "דווח על שחקן"~~ **נעשה (14.10.2026, אפיון 3.5):** דיווחים וחסימות נשמרים בשרת, ונכנסו ל־"Other actions" (למעלה). אין בהם טקסט חופשי, ולכן "Other user-generated content" נשאר No. אם יתווסף לדיווח טקסט חופשי, לסמן גם אותו.
  - **שמירה:** חסימה עד שמבטלים אותה או מוחקים את החשבון. דיווחים ויומן פעולות המנהלים כל עוד הם נחוצים לטיפול, עם בדיקה ומחיקה של ישנים (כמו במדיניות). במחיקת חשבון: החסימות שלו נמחקות, דיווחים פתוחים עליו נסגרים, והשמות שלו יוצאים מהיומן.
  - **חשבון מושעה שנמחק:** נשארות רק טביעות חד־כיווניות (Hash) של מזהה הכניסה ושל המייל המאומת, כדי שחשבון חדש עם אותה כניסה יתחיל מושעה (Fraud prevention). זה לא המייל עצמו, ולכן "Data deletion" נשאר נכון; המדיניות מפרטת את זה. שם שמנהל איפס נשמר ברשימת שמות אסורים, בלי קישור לשחקן.
  - האירוע `report_sent` נושא את הסיבה בלבד (נכלל ב־"App interactions").
- ~~אימון בשלבים~~ **נעשה (1.0.2, אפיון 5.3):** ההתקדמות (הכוכבים הטובים ביותר וכמה משחקים בכל שלב, וה־XP מהשלבים בכל יום: `user_levels`, ‏`level_xp_days`) נכנסה ל־"Other actions", וששת האירועים החדשים ל־"App interactions" (מספר השלב, לא מזהה). אין בהם סוג מידע חדש.
  - **שמירה ומחיקה:** העותק בשרת נמחק עם החשבון (`accounts/store.ts` ‏`deleteUser`). העותק בטלפון (`levels.db`) נשאר עד שמסירים את האפליקציה, כמו משחקי האימון, ולכן הוא לא "Collected". ה־XP שהשלבים נתנו נשאר, אנונימי, כמו כל XP.
- ~~משחק עם חברים~~ **נעשה (1.0.4, אפיון 5.4):** המשחקים נכנסו ל־"Other actions" (כמו משחק מדורג, בלי דירוג), וששת האירועים החדשים ל־"App interactions" (בלי קוד החדר ובלי מזהים). קוד החדר, מי בחדר ומי הוצא ממנו נשמרים רק בזיכרון של השרת, עד שהחדר נסגר. אין בהם סוג מידע חדש.
- ~~בוט סמוי~~ **נעשה (D90–D93, משה 20.10.2026; בשרת בלבד, נבנה כבוי):** בסוף כל משחק מדורג השרת שומר את הקצב של השחקן (הזמן הממוצע למהלך ומספר המהלכים שנמדדו: `pace_ms`, ‏`pace_moves` ב־`game_players`), כדי לקבוע את הקצב של יריב ממוחשב כשאין שחקנים. הוא נגזר מהמהלכים, ולכן נכנס ל־"Other actions" (App functionality). אין סוג מידע חדש, אין אירוע חדש, והמטרות לא משתנות.
  - **הדמויות** (`users.kind = 'persona'`) הן חשבונות של השרת, לא משתמשים: בלי מייל, בלי כניסה ובלי טלמטריה. לא נאסף עליהן מידע של אדם.
  - **הגילוי:** שורה בתנאי השימוש (סעיף "זמינות השירות"), והסבר מלא לבודקים (`LISTING-GOOGLE.md`, ‏"App access"). מדיניות הפרטיות מתארת את הקצב.
- כיבוי Analytics, או הוספת מתג "שתף נתוני שימוש": משנה את "Required" ל־"Optional".

</div>
