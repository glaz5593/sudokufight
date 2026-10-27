# צ'קליסט שחרור: מעכשיו ועד TestFlight ו־Play Closed testing (שלב 14)

הרשימה המלאה, לפי הסדר, מהמצב היום ועד שבודקי בטא משחקים משחקים מדורגים בשתי הפלטפורמות.
המקור: תוכנית העבודה, שלב 14, ואפיון סעיף 23.

**תנאי ה"סיום" של שלב 14:**
1. בודקי הבטא משחקים משחקים מדורגים **ב־iOS וב־Android** (מול שרת ה־Production).
2. תנאי ה־Closed testing מתקיימים: **לפחות 12 בודקים, 14 יום רצופים** (חשבון Play אישי חדש).

**איך קוראים את הרשימה:**
- **מי:** ‏**משה** (חשבונות, החלטות, קונסולות, טלפונים) או **Claude** (קוד ומסמכים, אחרי בקשה ממך).
- ☐ לסמן, ✓ נעשה. השלבים מסודרים לפי מה שחוסם את מה. כמה מהם לוקחים ימים או שבועות בלי עבודה שלך (D-U-N-S, אימות זהות ב־Google, ‏14 הימים), ולכן **מתחילים אותם מיד**.
- הפקודות מהשורש של הריפו, ב־Git Bash, אלא אם כתוב `cd apps/mobile`.

---

## מה כבר מוכן בקוד (שלב 14)

| ✓ | מה | איפה |
|---|---|---|
| ✓ | `track()` שולח כל אירוע גם ל־Firebase Analytics: חוקי GA4, בלי מידע אישי, איסוף רק ב־release, בלי IDFA ובלי הרשאת `AD_ID` | `apps/mobile/src/services/firebaseAnalytics.ts`, ‏`ga4.ts`, ‏`apps/mobile/firebase.json`, ‏`app.config.ts` |
| ✓ | Sentry לשרת: רק עם `SENTRY_DSN`, בלי מידע אישי, שגיאות HTTP, חדרים ו־process | `apps/server/src/monitoring/` |
| ✓ | פרופילי EAS: ‏`development`, ‏`preview` (APK מול Staging), ‏`production` (App Bundle מול Production) | `apps/mobile/eas.json` |
| ✓ | הגנות בבנייה לחנות: בלי Firebase, או עם שרת לא נגיש (`localhost`, כתובת מקומית, בלי TLS), בניית `production` ב־EAS נכשלת | `apps/mobile/app.config.ts` |
| ✓ | אפליקציית Production נפרדת ב־Fly, והמדריך | `fly.production.toml`, ‏[`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) |
| ✓ | הדפים המשפטיים בשרת: פרטיות, תנאי שימוש, מחיקת חשבון | `apps/server/src/legal`, ‏`/legal/*` |
| ✓ | באפליקציה: "מידע ומשפטי" בהגדרות (פרטיות, תנאים), ומסך "רישיונות" (גופנים וחבילות). ‏`npm run licenses` מעדכן אותו | `apps/mobile/src/config/legal.ts`, ‏`app/licenses.tsx`, ‏`scripts/licenses.mjs` |
| ✓ | אייקון (iOS, ‏Android אדפטיבי ו־Themed), מסך פתיחה, ואייקון 512 ו־Feature graphic ל־Play | `apps/mobile/assets/brand/`, ‏[`store/ASSETS.md`](store/ASSETS.md) |
| ✓ | iOS: ‏`ITSAppUsesNonExemptEncryption = NO`, והאפליקציה תמיד במצב כהה (`UIUserInterfaceStyle = Dark`) | `apps/mobile/app.json` |
| ✓ | טקסטים וטפסים לחנויות, נכסים, רישיונות, הצעת "דווח על שחקן" | [`docs/store/`](store/) |
| ✓ | מאגר מדורג: 2,000 לוחות לכל סוג | `packages/engine/data/puzzles.json` |

---

## גרסה 1.0.2 (אימון בשלבים): השרת לפני ה־APK

אימון בשלבים (אפיון 5.3, תוכנית העבודה שלב 14א). הסדר לפי `docs/handoff/2026-10-15/staged-practice/dev-plan.md` סעיף 6.
**שום קומפילציה, commit, דיפלוי או APK בלי אישור של משה.**

| ☐ | # | מה | מי | איפה |
|---|---|---|---|---|
| ☐ | 1 | כל שלבי המשנה מוזגו, ו־`npm run verify` עובר (כולל `levels:validate`, ובדיקות הקצה־לקצה של אימון לבד, אימון מול בוט ומדורג בלי שינוי) | Claude | |
| ☐ | 2 | ‏`ENGINE_VERSION` מ־0.2.0 ל־0.3.0, פעם אחת. ‏`PROTOCOL_VERSION` נשאר 1: שום הודעה חדשה ברשת | Claude | `packages/engine/src/index.ts` |
| ☐ | 3 | ‏`npm run version:bump`: הגרסה 1.0.2 (בנייה 10002) | Claude | [`BUILD-APK.md`](BUILD-APK.md), "גרסה" |
| ☐ | 4 | commit, רק כשמשה מבקש | Claude | |
| ☐ | 5 | **השרת קודם, ל־Staging:** `fly deploy --ha=false`. ה־migration ‏0008 (`user_levels`, ‏`level_xp_days`) רץ לבד כשהשרת עולה. **בלי `db:seed-puzzles`:** המאגר המדורג לא השתנה. בודקים: `/health` מחזיר `"engine":"0.3.0"`, דף "שלבים" נפתח באתר הניהול, ושמירה ושחזור של כוכבים (`PUT` ו־`GET /v1/me/levels`) | Claude, באישור של משה | README, "פריסה ל־Fly.io (Staging)" |
| ☐ | 6 | **רק אחריו, APK ‏1.0.2 מול Staging:** `npm run apk` (במחשב הזה: ABI אחד, כי המקום בכונן C מוגבל) או EAS `preview`. משה עובר על הבדיקות במכשיר | Claude בונה, באישור; משה בודק | [`BUILD-APK.md`](BUILD-APK.md), ‏[`LEVELS-DEVICE-CHECKS.md`](LEVELS-DEVICE-CHECKS.md) |
| ☐ | 7 | **שרת Production:** `fly deploy --config fly.production.toml --ha=false`, ואותה בדיקה כמו בצעד 5 | Claude, באישור של משה | [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיפים 5–6 |
| ☐ | 8 | **רק אחריו, האפליקציה ל־Production:** `npm run apk -- --server production`, או `eas build --profile production` ו־`eas submit` לחנויות | משה | שלבים ח, יא ו־יב למטה |
| ☐ | 9 | **חזרה לאחור בטוחה:** ה־migration ‏0008 רק מוסיף שתי טבלאות, ולכן השרת של 1.0.1 רץ עליו כמו שהוא, בלי שחזור של המסד | | `DEPLOY-PRODUCTION.md` סעיף 9 |

**למה השרת קודם:**
- **אפליקציה 1.0.2 מול שרת ישן:** `GET` ו־`PUT /v1/me/levels` עונים 404, והאפליקציה מסמנת "לא נתמך". הכוכבים נשמרים בטלפון (`levels.db`), וה־XP והסנכרון מחכים לשרת החדש.
  - אירועי השלבים נשלחים בחבילה נפרדת. שרת ישן דוחה אותה, והם אובדים, אבל שאר האירועים מגיעים. לכן בלי שרת חדש, דף "שלבים" באתר הניהול חסר את הימים הראשונים.
- **אפליקציה 1.0.1 מול שרת חדש:** רק תוספות. שום דבר לא משתנה בשבילה.
- **וכך גם בעתיד: קודם השרת, בכל פעם שמספר השלבים גדל (פרקים חדשים), נוסף סוג שלב, או נוסף שדה או ערך לאירועי השלבים.** שרת ישן מדלג בסנכרון על שלב שהוא לא מכיר (`unknown`, והטלפון שולח אותו שוב לשרת חדש). אבל חבילת אירועים שיש בה מספר שלב, סוג או ערך שהוא לא מכיר, הוא דוחה כולה (400).

## גרסה 1.0.4 (משחק עם חברים): השרת לפני ה־APK, ובנייה מלאה

משחק עם חברים (אפיון 5.4, תוכנית העבודה שלב 14ג). **שום קומפילציה, commit, דיפלוי או APK בלי אישור של משה.**

| ☐ | # | מה | מי | איפה |
|---|---|---|---|---|
| ☐ | 1 | `npm run verify` עובר, כולל `friendsHost.contract.test.ts`, ובלי שינוי בבדיקות של `GameRoom` ושל המדורג | Claude | |
| ☐ | 2 | ‏`npm run version:bump`: הגרסה 1.0.4. ‏`PROTOCOL_VERSION` נשאר 1 | Claude, באישור של משה | [`BUILD-APK.md`](BUILD-APK.md), "גרסה" |
| ☐ | 3 | commit, רק כשמשה מבקש | Claude | |
| ☐ | 4 | **השרת קודם, ל־Staging:** `fly deploy --ha=false`. ה־migration ‏0009 (`game_players.xp`) רץ לבד. בודקים: `/r/123456` מציג את הדף, `/.well-known/assetlinks.json` מחזיר JSON, ודף "חדרים" נפתח באתר הניהול | Claude, באישור של משה | [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיף 4א |
| ☐ | 5 | **רק אחריו, APK ‏1.0.4 מול Staging. בנייה מלאה (native):** App Links ו־`expo-clipboard`. במחשב הזה: ABI אחד, כי המקום בכונן C מוגבל, או EAS `preview` (אז צריך את B8) | Claude בונה, באישור; משה בודק בשני טלפונים | [`BUILD-APK.md`](BUILD-APK.md), ‏[`FRIENDS-DEVICE-CHECKS.md`](FRIENDS-DEVICE-CHECKS.md) |
| ☐ | 6 | **ה־SHA-256 של מפתח EAS** ב־`ANDROID_APP_LINK_SHA256`, לפני APK מהענן ולפני החנות. אחרי F7 גם של Play App Signing | משה שולח, Claude מגדיר | [`MOSHE-TODO.md`](MOSHE-TODO.md) B8 |
| ☐ | 7 | **שרת Production** (עם `ANDROID_APP_LINK_SHA256` **בלי** מפתח הבדיקות), ורק אחריו האפליקציה ל־Production | Claude ומשה, באישור | `DEPLOY-PRODUCTION.md` סעיפים 4א, 5–6 |
| ☐ | 8 | **חזרה לאחור בטוחה:** 0009 רק מוסיף עמודה ריקה, ולכן השרת של 1.0.3 רץ עליו כמו שהוא | | `DEPLOY-PRODUCTION.md` סעיף 9 |

- **אפליקציה ישנה מול שרת חדש:** לא רואה את הפיצ'ר. הקישור נפתח אצלה בדפדפן, בדף שאומר "צריך גרסה 1.0.4 ומעלה". **אפליקציה 1.0.4 מול שרת ישן:** "האפשרות הזו עוד לא זמינה."
- **הבוט הסמוי** (שלב 14ד): שרת בלבד, migration ‏0010, **כבוי**. בלי APK. מדליקים ב־staging רק כשמשה אומר.

## גרסה 1.1.0 (19 שפות): בדיקת התרגומים, השרת, ובנייה מלאה

פרויקט השפות (אפיון סעיפים 22–23, ‏D101–D124; התוכנית: `docs/handoff/2026-10-23/localization/plan.md`, סעיף 8). **שום קומפילציה, commit, דיפלוי או APK בלי אישור של משה.**

| ☐ | # | מה | מי | איפה |
|---|---|---|---|---|
| ✓ | 1 | `npm run verify` עובר. בתוכו `npm run i18n:check`, שבודק את העברית ואת האנגלית בכל כלל, ואת השפות הפעילות (`apps/mobile/src/i18n/enabled-languages.json`) רק במה ששובר אותן במסך. מה שעוד לא תורגם בהן הוא אזהרה, כי שם מוצגת אנגלית עד שלב התרגום (D120) | Claude | |
| ✓ | 2 | **`npm run i18n:release` עובר בלי שגיאות. הוא חוסם כל בנייה לחנות, לא רק את 1.1.0** (D120). הוא בודק כל תיקיית שפה בקפדנות: מפתח חסר, צורת ריבוי חסרה, מציין מקום או תג שונה מהאנגלית, תו בידוד שלא נסגר, וערך שזהה לאנגלית בלי סיבה. מחרוזת חדשה שנכתבה רק בעברית ובאנגלית צריכה קודם שלב תרגום | Claude | השורש של הריפו |
| ☐ | 3 | **השרת קודם, ל־Staging:** דף ההזמנה בכל השפות, הדפים המשפטיים המתורגמים (D112) והשם הזמני בשפת הצופה. שרת ישן מציג עברית לקוד שפה שהוא לא מכיר. בודקים: `/r/123456?lang=de` ו־`/legal/privacy?lang=de` נפתחים (בגרמנית כשיש תרגום, ואחרת באנגלית), ו־`?lang=he` ו־`?lang=en` בדיוק כמו קודם | Claude, באישור של משה | [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיף 4א |
| ☐ | 4 | **APK ראשון אחרי שלב 0 (בנייה מלאה):** ‏`app.json` השתנה (תוסף השפות `plugins/withAppLocales.js`, המודול `modules/app-locale` של D103, ובלי `supportsRTL`), ולכן `npm run apk` בונה את `android/` מחדש. במחשב הזה: ABI אחד, כי המקום בכונן C מוגבל (D118) | Claude בונה, באישור | [`BUILD-APK.md`](BUILD-APK.md) |
| ☐ | 5 | **בדיקת המשאבים ב־APK הראשון** (`aapt2` מ־`%LOCALAPPDATA%\Android\Sdk\build-tools\<גרסה>\`): **(א)** `aapt2 dump configurations <apk>` מראה עשרות שפות, ובהן `iw`, ‏`in`, ‏`zh-rCN`, ‏`zh-rTW` ו־`pt`: התרגומים של הספריות לעברית, לאינדונזית, לסינית ולפורטוגזית לא סוננו (סיכון 5 בתוכנית). **(ב)** `aapt2 dump xmltree --file res/xml/locales_config.xml <apk>` מראה בדיוק את השפות הפעילות. **(ג)** `aapt2 dump xmltree --file AndroidManifest.xml <apk>` מראה `android:localeConfig` על `<application>` | Claude | ‏0יא בתוכנית |
| ☐ | 6 | **הבדיקות בטלפון** (D117: אחרי שלב 0 עם השפות המדומות, אחרי ערבית, ואחר כך לכל מנה של 2–3 שפות) | משה | [`LOCALIZATION-DEVICE-CHECKS.md`](LOCALIZATION-DEVICE-CHECKS.md) |
| ☐ | 7 | **דפי החנות ב־17 השפות:** כל שדה בגבול שלו, השם לפי D115א, ומילות מפתח שנבחרו בשפה עצמה | Claude כותב, משה מדביק | [`store/locales/README.md`](store/locales/README.md) |
| ☐ | 8 | **השורה "בעברית ובאנגלית" (D115ב):** ‏"In Hebrew and English" בתיאור האנגלי ו"בעברית ובאנגלית" בתיאור העברי הופכים ל"זמין ב־19 שפות" (בשפה של כל תיאור), **רק בגרסה שבה כל 19 השפות יוצאות.** בגרסה עם פחות שפות לא נוגעים בשורה | Claude, ומשה מדביק | [`store/LISTING-APPLE.md`](store/LISTING-APPLE.md) סעיף 1 (אותו תיאור משמש את Google Play) |
| ☐ | 9 | **Firebase (D113):** בקונסולה, Authentication ← Templates: שם השולח `Sudoku Fight`. האפליקציה שולחת את השפה שלה לפני מייל אימות ואיפוס סיסמה. לבדוק שמייל לשחקן באנגלית יוצא באנגלית (לא נבדק אם Firebase מתרגם תבנית ששונתה בקונסולה) | משה | [`FIREBASE-SETUP.md`](FIREBASE-SETUP.md) סעיף 3 |
| ✓ | 10 | ‏`npm run version:bump -- minor`: הגרסה 1.1.0, רק בסוף (D118). **נעשה ב־25.10.2026:** 1.0.4 ← 1.1.0, ‏build 10100 | Claude, באישור של משה | [`BUILD-APK.md`](BUILD-APK.md), "גרסה" |
| ☐ | 11 | commit, רק כשמשה מבקש | Claude | |

- **שפה חדשה, גם אחרי 1.1.0:** הקוד שלה נכנס ל־`apps/mobile/src/i18n/enabled-languages.json`, ומשם לבורר, לבדיקת התרגומים ולרשימת השפות של המערכת (אנדרואיד ו־iOS). זה שינוי native, ולכן בנייה מלאה: `npm run apk` מזהה אותו לבד, כי הרשימה נכנסת לחישוב של `appJsonFiles`.
- **אפליקציה 1.0.4 מול השרת החדש:** אין שינוי. הקישורים שלה לדפים המשפטיים שולחים רק `?lang=he` או `?lang=en`, והם עובדים כמו קודם.

---

## שלב א: החלטות פתוחות (משה). מתחילים עכשיו

הן משנות מה הבודקים רואים, וחלקן קשות לשינוי אחרי שיש שחקנים ודירוגים.

| ☐ | מה | איפה | הערה |
|---|---|---|---|
| ☐ | **"דווח על שחקן" ו"חסימה"** (הנחיה 1.2 של Apple, וגם מדיניות ה־UGC של Google Play) | [`store/UGC-PROPOSAL.md`](store/UGC-PROPOSAL.md) | גם בודקי TestFlight **חיצוניים** עוברים Beta App Review לפי אותן הנחיות. אם מאשרים, Claude מממש לפני ההגשה החיצונית |
| ☐ | **ההישגים** (ממתינים מאז שלב 12) | [`ACHIEVEMENTS-PROPOSAL.md`](ACHIEVEMENTS-PROPOSAL.md) | לאשר, לשנות, או להחליט שהבטא יוצאת בלעדיהם |
| ☐ | **ההחלטות שמסומנות "ממתינה לאישור"** (סותרות את המקור, ולכן נבנו לפי המקור): D1, ‏D24, ‏D26, ‏D34, ‏D35 (‏D14 נסגרה ב־15.10.2026: הקנס = הנקודות שהוחמצו. ‏D18 בוטלה ב־17.10.2026: אין גרירה, D45) | אפיון, סעיף 24 | לסמן ✓ על ההתנהגות של היום, או לאשר את ההצעה |
| ☐ | **החלטות שקשה לשנות אחרי השקה:** D7 (אפשרות דירוג), ‏D23 (דירוג התחלתי), ‏D31 (נוסחת הדירוג), ‏D38 (מספרי ה־Gamification), ‏D41 | אפיון, סעיף 24 | D7 נכנס ל־`RATING_OPTION` ב־`fly.production.toml` |
| ☐ | **שאר הטבלה (D2–D41 שעדיין ☐)** | אפיון, סעיף 24 | מה שמסומן ☐ נבנה לפי ברירת המחדל. מעבר אחד על הטבלה, ✓ או שינוי |
| ☐ | **היקף V1** [D39]: משחק פרטי עם קוד כבר ב־V1? | אפיון, סעיפים 24–25 | |
| ☐ | **השם בחנויות** ("Sudoku Fight" או עם "PvP Sudoku") | [`store/LISTING-GOOGLE.md`](store/LISTING-GOOGLE.md) סעיף 1, ‏[`store/LISTING-APPLE.md`](store/LISTING-APPLE.md) | |
| ☐ | **המייל ושם המפעיל בדפים המשפטיים** (`LEGAL_CONTACT_EMAIL`, ‏`LEGAL_OPERATOR_NAME`) | `LISTING-APPLE.md` סעיף 2 | המייל שלך לא מתפרסם בלי החלטה שלך. מומלץ תיבה ייעודית |
| ☐ | **דומיין לשרת** (`api.<הדומיין>`), או להישאר עם `sudoku-fight-prod.fly.dev` | [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיף 11 | הכתובת נכנסת לבנייה. להחליט **לפני** הבנייה הראשונה לחנות |
| ☐ | **"פתוח למשה"** ב־QA (נוסחים ועיצוב) | [`QA-CHECKLIST.md`](QA-CHECKLIST.md#פתוח-למשה) | לא חוסם בטא, אבל עדיף לפני הצילומים לחנות |

## שלב ב: חשבונות (משה). מתחילים עכשיו, במקביל

| ☐ | מה | איפה | הערה |
|---|---|---|---|
| ☐ | **Apple Developer Program** (‏99$ לשנה) | https://developer.apple.com/programs/enroll/ | **אישי:** מהיר, עם Apple ID ואימות זהות. **חברה:** צריך מספר **D-U-N-S** (חינם, מ־Dun & Bradstreet), וזה יכול לקחת **שבועות**. השם שמופיע בחנות הוא שם החשבון |
| ☐ | **Google Play Console** (‏25$ פעם אחת) | https://play.google.com/console/signup | **אישי:** אימות זהות, טלפון ומכשיר Android (יכול לקחת ימים), ואז חובת **12 בודקים × 14 יום** לפני Production. **ארגון:** ‏D-U-N-S, בלי חובת הבודקים |
| ☐ | **Expo** (חינם) | https://expo.dev/signup | בשביל EAS Build ו־EAS Submit |
| ☐ | **Sentry** (חינם לבטא) | https://sentry.io/signup/ | [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיף 3 |
| ☐ | **Neon** לפרויקט Production (או Postgres של Fly) | https://console.neon.tech | `DEPLOY-PRODUCTION.md` סעיף 2 |
| ☐ | **ריפו git** (GitHub, פרטי) ו־commit ראשון | | ‏EAS Build מעלה את הקוד מ־git. לבדוק לפני: `git status` לא מציג `google-services.json`, ‏`GoogleService-Info.plist`, ‏`.env` או keystore (הם ב־`.gitignore`). Commit רק כשאתה מבקש |

## שלב ג: Firebase (משה)

הכל ב־[`docs/FIREBASE-SETUP.md`](FIREBASE-SETUP.md). בקצרה:

| ☐ | מה | סעיף ב־FIREBASE-SETUP |
|---|---|---|
| ☐ | פרויקט "Sudoku Fight", **עם Google Analytics** | 1, ‏8א |
| ☐ | Email/Password, ומיילים בעברית (אימות ואיפוס). מ־1.1.0: שם השולח `Sudoku Fight`, והמייל בשפת האפליקציה (D113, למעלה "גרסה 1.1.0") | 2, ‏3 |
| ☐ | אפליקציות Android ו־iOS (`com.mosheg.sudokufight`), ושני קובצי ההגדרות | 4, ‏5, ‏6 |
| ☐ | הקבצים ב־EAS, בשלוש הסביבות (`development`, ‏`preview`, ‏`production`) | 7 |
| ☐ | Crashlytics מופעל | 8 |
| ☐ | ב־Google Analytics: ‏Google signals כבוי, ‏Data retention של 2 חודשים | 8א |
| ☐ | **לא** לקשר את Firebase ל־Google Ads או ל־AdMob (תוויות הפרטיות מניחות שאין) | [`store/APP-PRIVACY.md`](store/APP-PRIVACY.md) סעיף 0 |

## שלב ד: השרתים (משה, עם המדריך)

| ☐ | מה | איפה |
|---|---|---|
| ☐ | **Production:** אפליקציה, מסד עם גיבויים, Sentry, סודות, פריסה | [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיפים 1–6 |
| ☐ | **המאגר המדורג ב־Production** (`npm run db:seed-puzzles` מול המסד), ובלוג אין `no ranked puzzles` | `DEPLOY-PRODUCTION.md` סעיף 7 |
| ☐ | בלוג של Production: ‏`Sentry on (production, …)`, ובלי `accounts disabled`, ‏`admin site disabled` או אזהרת `LEGAL_…` | `DEPLOY-PRODUCTION.md` סעיף 6 |
| ☐ | הודעת בדיקה מגיעה ל־Sentry, ויש התראה במייל | `DEPLOY-PRODUCTION.md` סעיפים 3, ‏6 |
| ☐ | **Staging מעודכן** לקוד הנוכחי (בניות `preview` מדברות איתו): `fly deploy --ha=false`, ‏`SENTRY_DSN` גם שם, ומאגר מדורג גם במסד שלו | README, "פריסה ל־Fly.io (Staging)" |
| ☐ | אתר הניהול נפתח ב־`https://sudoku-fight-prod.fly.dev/admin` | `DEPLOY-PRODUCTION.md` סעיף 8 |

## שלב ה: רישיונות ותוכן

| ☐ | מה | מי | איפה |
|---|---|---|---|
| ✓ | **אווטרים:** הוחלפו ב־101 דמויות משלנו (`packages/avatars`, 12.10.2026). חבילת ה־"freebie" כבר לא באפליקציה, ואין רישיון לבדוק | | [`store/ASSET-LICENSES.md`](store/ASSET-LICENSES.md) סעיף 1 |
| ☐ | צלילים סופיים ב־CC0: לבחור מ־30 המועמדים ב־`/dev/sounds` ולקדם, עם מקור ויוצר בקרדיטים של `assets/sounds/README.md` (הזמניים שנוצרו בקוד מותרים לבטא) | משה בוחר, Claude מכניס | `ASSET-LICENSES.md` סעיף 2 |
| ☐ | ‏690 הלוחות מ־Kaggle: לאמת את הרישיון בדף המאגר | משה | `ASSET-LICENSES.md` סעיף 4 |
| ✓ | הלוחות המדורגים (6,000) והאופליין שלנו: נוצרו במחולל | | `ASSET-LICENSES.md` |
| ✓ | גופנים (Rubik, ‏Teko): ‏SIL OFL 1.1 | | `ASSET-LICENSES.md` |
| ☐ | חבילות צד שלישי: לעבור על "מסומנות לבדיקה" ו"דורשות תשומת לב" | משה | [`store/LICENSES-REPORT.md`](store/LICENSES-REPORT.md) |

## שלב ו: הדפים המשפטיים

| ☐ | מה | מי | איפה |
|---|---|---|---|
| ☐ | `LEGAL_CONTACT_EMAIL` ו־`LEGAL_OPERATOR_NAME` בסודות של Production (וגם ב־Staging) | משה | `DEPLOY-PRODUCTION.md` סעיף 4 |
| ☐ | שלושת הדפים נפתחים בעברית ובאנגלית, **בלי פס "טיוטה" ובלי placeholder אדום** | משה | `/legal/privacy`, ‏`/legal/terms`, ‏`/legal/delete-account` (‏`?lang=en`) |
| ☐ | מדיניות הפרטיות מזכירה את Firebase Analytics, ‏Crashlytics ו־Sentry, ותואמת לטפסים | משה קורא | `apps/server/src/legal/privacy.ts`, ‏[`store/APP-PRIVACY.md`](store/APP-PRIVACY.md), ‏[`store/DATA-SAFETY.md`](store/DATA-SAFETY.md) |
| ☐ | באפליקציה: הקישורים בהרשמה ובהגדרות פותחים את הדפים של Production (הם נבנים מכתובת השרת של הפרופיל) | משה, בבנייה מ־שלב ח | `apps/mobile/src/config/legal.ts` |

## שלב ז: נכסים, דפי החנות וטפסים (משה, עם הטקסטים המוכנים)

**App Store Connect** (https://appstoreconnect.apple.com):

| ☐ | מה | איפה |
|---|---|---|
| ☐ | ‏My Apps ← **+** ← New App: הפלטפורמה iOS, השם, השפה הראשית, ה־Bundle ID ‏`com.mosheg.sudokufight`, ו־SKU (למשל `sudoku-fight`) | אם ה־Bundle ID עוד לא קיים, ‏EAS יוצר אותו בבנייה הראשונה (שלב ח), ואז חוזרים לכאן |
| ☐ | טקסטים, קטגוריה (Games › Puzzle, ‏Board), כתובות (Privacy, ‏Support) | [`store/LISTING-APPLE.md`](store/LISTING-APPLE.md) סעיפים 1–3 |
| ☐ | **דירוג גיל** (השאלון) | `LISTING-APPLE.md` סעיף 4 |
| ☐ | **App Privacy** (תוויות הפרטיות) | [`store/APP-PRIVACY.md`](store/APP-PRIVACY.md) |
| ☐ | אייקון וצילומי מסך (iPhone) | [`store/ASSETS.md`](store/ASSETS.md) |
| ✓ | **Sign in with Apple: לא נדרש.** הכניסה היא מייל וסיסמה בלבד (Firebase Auth). אם יום אחד מוסיפים התחברות עם Google או עם רשת חברתית, חובה להוסיף גם Sign in with Apple (הנחיה 4.8, אפיון סעיף 23) | `LISTING-APPLE.md` סעיף 5 |
| ✓ | Export Compliance: הצפנה סטנדרטית בלבד (פטור). ‏`usesNonExemptEncryption: false` כבר ב־`app.json`, ולכן השאלה לא חוזרת בכל בנייה | `LISTING-APPLE.md` סעיף 6 |

**Google Play Console** (https://play.google.com/console):

| ☐ | מה | איפה |
|---|---|---|
| ☐ | Create app: השם, שפת ברירת המחדל, הסוג **Game**, חינמי, וההצהרות בדף היצירה | [`store/LISTING-GOOGLE.md`](store/LISTING-GOOGLE.md) |
| ☐ | Main store listing: טקסטים, אייקון 512, ‏Feature graphic, צילומי מסך | `LISTING-GOOGLE.md` סעיף 1, ‏`store/ASSETS.md` |
| ☐ | App content: מדיניות פרטיות, ‏Ads (אין), ‏App access (חשבון הדמו, שלב י), ‏**Advertising ID** (לא משתמשים: ההרשאה חסומה בקוד), ‏Content rating (IARC), ‏Target audience | `LISTING-GOOGLE.md` סעיפים 3–5 |
| ☐ | **Data safety**, כולל כתובת מחיקת החשבון (`/legal/delete-account`) | [`store/DATA-SAFETY.md`](store/DATA-SAFETY.md) |
| ✓ | Target API level: ‏React Native 0.86 בונה עם `targetSdk 36` (מ־31.8.2026 Play דורש 36 ומעלה לאפליקציות חדשות ולעדכונים). לוודא אחרי ההעלאה: Play Console ← App bundle explorer | |

## שלב ח: בנייה ב־EAS

**פעם אחת (משה):**

```
npm install -g eas-cli
eas login
cd apps/mobile
eas init
```

- `eas init` מקשר את הפרויקט ל־Expo. אם הוא מבקש להוסיף את `extra.eas.projectId` ידנית (כי יש `app.config.ts`), שולחים ל־Claude את המזהה, והוא מוסיף אותו ל־`app.json`.
- **חתימה: EAS מנהל אותה.** בבנייה הראשונה עונים "כן" ליצירת keystore ל־Android ולתעודות של Apple. הם נשמרים בשרתים של EAS, **לא בריפו**.
  **אף פעם** לא keystore, תעודה או קובץ חתימה מ־PureTrack או מפרויקט אחר (CLAUDE.md). ‏Google Play App Signing מחזיק את מפתח החתימה של האפליקציה, ו־EAS את מפתח ההעלאה.
  גיבוי מומלץ: `eas credentials` ← Android ← production ← Download keystore, למנהל הסיסמאות (לא לריפו).
- **מספרי הגרסה:** ‏`appVersionSource: remote`. ה־versionCode וה־buildNumber נשמרים ב־EAS ועולים לבד בכל בניית `production` (`autoIncrement`).
  אם EAS שואל על הערך ההתחלתי: ‏1. הגרסה שמוצגת למשתמש (`0.1.0`) היא ב־`app.json`. לפני השקה אפשר לבקש מ־Claude להעלות ל־`1.0.0`.
- **השרת לפי פרופיל** (`eas.json`): ‏`preview` מול Staging, ‏`production` מול `sudoku-fight-prod.fly.dev`. אם שם האפליקציה ב־Fly או הדומיין שונים, מעדכנים את `EXPO_PUBLIC_SERVER_HOST` בפרופיל `production`.

**כל גרסה (משה):**

| ☐ | מה | פקודה (מתוך `apps/mobile`) |
|---|---|---|
| ☐ | (לא חובה) APK לבדיקה מהירה מול Staging, מותקן מהקישור או מ־QR | `eas build --profile preview --platform android` |
| ☐ | בניית iOS לחנות | `eas build --profile production --platform ios` |
| ☐ | בניית Android לחנות (App Bundle) | `eas build --profile production --platform android` |

- בנייה בפרופיל `production` **נכשלת בכוונה** אם חסר קובץ Firebase של הפלטפורמה ב־EAS, או אם השרת בפרופיל הוא `localhost`, כתובת מקומית או בלי `SECURE=true`. ההודעה אומרת מה לתקן.
- אם `eas build` שואל על EAS Update (‏`expo-updates` מותקן בשביל ההפעלה מחדש אחרי החלפת שפה): עונים "לא". אין עדכונים באוויר ב־V1.

## שלב ט: QA על בנייה אמיתית (משה)

על בנייה מ־שלב ח (release), מול Production, בשני טלפונים, ‏Android ו־iPhone:

| ☐ | מה | איפה |
|---|---|---|
| ☐ | הצ'קליסט של המסכים: לפחות הזרימות העיקריות בעברית ובאנגלית | [`QA-CHECKLIST.md`](QA-CHECKLIST.md) |
| ☐ | **מ־1.1.0, כל שפה בגרסה:** המסלול הקבוע של המסכים, משחק חי, מסך הריבוי, ושפת המערכת (באנדרואיד 13 ומעלה: "שפות אפליקציה"). ב־iPhone הראשון: אין לולאה של הפעלות מחדש | [`LOCALIZATION-DEVICE-CHECKS.md`](LOCALIZATION-DEVICE-CHECKS.md) |
| ☐ | **אין התג "מצב פיתוח"** במסכי החשבון | `FIREBASE-SETUP.md` סעיף 11 |
| ☐ | הרשמה, מייל אימות בעברית, ‏"שכחתי סיסמה" | `FIREBASE-SETUP.md` סעיף 11 |
| ☐ | **משחק מדורג בין iPhone ל־Android** (2 שחקנים), והדירוג מתעדכן בבית בלי הפעלה מחדש | [`STAGE9-10-DEVICE-CHECKS.md`](STAGE9-10-DEVICE-CHECKS.md) |
| ☐ | ניתוק וחזרה, מצב טיסה, מעבר לרקע | [`STAGE7-DEVICE-CHECKS.md`](STAGE7-DEVICE-CHECKS.md) |
| ☐ | **הפרעות** (D44–D47): "הפרעה" בכרטיס של יריב ואז סוג בחלון, החשכת הלוח, שלושת הסוגים החדשים, ובלי הפרעות מול בוט. **השרת עודכן לפני הבנייה:** בלי זה כל משחק נשאר עם שלושת הסוגים הישנים | [`STAGE7-DEVICE-CHECKS.md`](STAGE7-DEVICE-CHECKS.md) בדיקה 6 |
| ☐ | **אימון בשלבים** (1.0.2): פרק שלם במצב טיסה, שערים, "שוב", שיחת טלפון באמצע שלב (D65), סנכרון ו־XP. **השרת עודכן לפני הבנייה** (למעלה, "גרסה 1.0.2") | [`LEVELS-DEVICE-CHECKS.md`](LEVELS-DEVICE-CHECKS.md) |
| ☐ | "מצא יריב" בלי שחקנים אחרים: מיד "כרגע אין שחקנים אחרים שמחפשים משחק כזה" עם "שחק מול בוט בינתיים" (זה מה שבודקי Apple יראו קודם), ואחרי דקה Match-Timeout עם אותו כפתור | `LISTING-APPLE.md` סעיף 5 |
| ☐ | פתיחה בפחות מ־2 שניות ו־55fps (רק ב־release) | [`PERF.md`](PERF.md) |
| ☐ | **מחיקת חשבון** עובדת מול Production: המשתמש נעלם מ־Firebase, ובאתר הניהול הוא "נמחק" | `FIREBASE-SETUP.md` סעיף 11 |
| ☐ | **Firebase Analytics:** ‏`app_open`, ‏`screen_view`, ‏`game_start` מופיעים ב־Realtime | `FIREBASE-SETUP.md` סעיף 8א |
| ☐ | **Crashlytics:** האפליקציה מופיעה כמחוברת | `FIREBASE-SETUP.md` סעיף 8 |
| ☐ | **Sentry:** אין issues חדשים של Production אחרי סבב הבדיקות (או שיש, ונבדקו) | `DEPLOY-PRODUCTION.md` סעיף 10 |
| ☐ | הדפים המשפטיים נפתחים מההגדרות ומההרשמה | שלב ו |

## שלב י: חשבונות דמו לבודקי Apple ו־Google (משה)

1. ☐ **באפליקציה של Production** (בנייה מ־שלב ח, לא Development Build) נרשמים עם שני חשבונות: `demo1` ו־`demo2`. מייל שאתה מקבל בו, וסיסמה חזקה.
2. ☐ מאמתים את המייל של שניהם (משחק מדורג דורש מייל מאומת).
3. ☐ משחקים משחק מדורג אחד ביניהם, ומשחק אימון אחד. כך יש לבודק היסטוריה, ‏Replay וטבלת מובילים.
4. ☐ הפרטים נכנסים **רק** ל־App Store Connect (‏App Review Information, ו־Test Information של TestFlight) ול־Play Console (‏App content ← App access). **לא לריפו, ולא לשום קובץ בו.**
5. ☐ ההערות לבודקים (כולל "אפשר לשחק מול בוט כשאין יריבים"): להדביק מ־[`store/LISTING-APPLE.md`](store/LISTING-APPLE.md) סעיף 5, ולוודא שהתפריטים בטקסט תואמים לבנייה באנגלית.
6. ☐ לא מוחקים את החשבונות ולא מחליפים סיסמה כל עוד גרסה בבדיקה. אם בודק מחק חשבון (כדי לבדוק את המחיקה), יוצרים אותו מחדש לפני ההגשה הבאה.

## שלב יא: TestFlight (משה)

| ☐ | מה | פקודה / איפה |
|---|---|---|
| ☐ | העלאה ל־App Store Connect | `cd apps/mobile && eas submit --profile production --platform ios --latest` |
| ☐ | בפעם הראשונה ‏EAS מבקש להתחבר ל־Apple, או מפתח API של App Store Connect. **הוא נשמר ב־EAS, לא בריפו** | |
| ☐ | העיבוד ב־Apple (‏10–30 דקות), ואז Export Compliance אם נשאל | App Store Connect ← TestFlight |
| ☐ | **קבוצה פנימית** (עד 100, משתמשי App Store Connect): בלי בדיקה של Apple. מוסיפים ומתקינים מאפליקציית TestFlight | TestFlight ← Internal Testing |
| ☐ | **קבוצה חיצונית** (עד 10,000, במייל או בקישור ציבורי): ממלאים Test Information (מייל לפידבק, ‏What to Test, חשבון הדמו), ושולחים ל־**Beta App Review** | `LISTING-APPLE.md` סעיף 7. לפני זה: ההחלטה על UGC (שלב א) |
| ☐ | בודקים חיצוניים מתקינים ומשחקים משחקים מדורגים | |

- בנייה ב־TestFlight פגה אחרי 90 יום. בנייה חדשה מעלים באותה דרך.

## שלב יב: Google Play: ‏Internal testing ← Closed testing ← בקשת Production (משה)

| ☐ | מה | איפה / פקודה |
|---|---|---|
| ☐ | **ההעלאה הראשונה ידנית** (‏Google לא מקבל את הבנייה הראשונה של אפליקציה דרך ה־API): מורידים את ה־`.aab` מדף הבנייה ב־expo.dev, ומעלים | Play Console ← Test and release ← Testing ← **Internal testing** ← Create new release. מאשרים את Play App Signing |
| ☐ | בודקים פנימיים (את עצמך ועוד כמה) מתקינים מ־Play ובודקים | Internal testing ← Testers |
| ☐ | **מפתח Service Account** בשביל `eas submit` (פעם אחת): לפי https://github.com/expo/fyi/blob/main/creating-google-service-account.md. מעלים אותו ל־EAS: `eas credentials` ← Android ← Google Service Account. **לא לריפו** (גם `**/service-account*.json` ב־`.gitignore`) | Google Cloud, ‏Play Console ← Users and permissions |
| ☐ | מהבנייה השנייה: `eas submit --profile production --platform android --latest`. היא עולה ל־Internal testing כטיוטה (`track: internal`, ‏`releaseStatus: draft` ב־`eas.json`), ומשם מפרסמים או מקדמים | `cd apps/mobile` |
| ☐ | **Closed testing:** יוצרים track (‏Alpha), מקדמים אליו את הגרסה, ובוחרים מדינות (לפחות ישראל) | Testing ← Closed testing |
| ☐ | **בודקים: לפחות 12, ועדיף 15–20** (מי שעוזב באמצע לא נספר). רשימת מיילים או Google Group | Closed testing ← Testers. ‏[`store/LISTING-GOOGLE.md`](store/LISTING-GOOGLE.md) סעיף 6 |
| ☐ | שולחים לבודקים את **קישור ההצטרפות**. כל אחד: מצטרף, מתקין מ־Play, **ונשאר מצטרף 14 יום רצופים** | |
| ☐ | **יום 0:** רושמים את התאריך שבו ה־12 הצטרף. **יום 14:** בודקים ב־Dashboard שהתנאי מתקיים | Play Console ← Dashboard |
| ☐ | בזמן הזה: לפחות כמה משחקים מדורגים בין בודקי Android ובודקי iPhone, ופידבק. ‏Google שואלת על זה בבקשה | |
| ☐ | **Apply for production**, ועונים על השאלון (מי בדק, מה נמצא, מה תוקן) | Dashboard ← Apply for production |

## שלב יג: Go / No-go לפני כל הגשה

**חוסמים. כולם חייבים להיות ✓:**

- ✓ רישיון האווטרים ברור, או שהוחלפו (שלב ה): הוחלפו בדמויות שלנו.
- ☐ הדפים המשפטיים בלי placeholder, והכתובות שלהם בשתי החנויות (שלב ו).
- ☐ החלטה על "דווח על שחקן" וחסימה, וממומשת אם אושרה (שלב א). לפני הגשה ל־App Store, ולפני Beta App Review.
- ☐ שרת Production בריא: ‏`/health` עובר, ‏Sentry מקבל, יש מאגר מדורג, ויש גיבוי למסד (שלב ד).
- ☐ שרת Production כבר בגרסה של הבנייה, או חדש ממנה: **קודם השרת, ורק אחר כך האפליקציה** (מ־1.0.2: `/health` מחזיר `"engine":"0.3.0"`, למעלה "גרסה 1.0.2". מ־1.0.3: `"engine":"0.4.0"`, ‏`docs/02-WORK-PLAN.md` שלב 14ב).
- ☐ הבנייה עם Firebase ובלי "מצב פיתוח", מול Production (שלבים ח–ט).
- ☐ משחק מדורג בין iOS ל־Android עבד מול Production (שלב ט).
- ☐ מחיקת חשבון עובדת מתוך האפליקציה (Apple 5.1.1(v), ‏Google Data safety) (שלב ט).
- ☐ חשבונות הדמו קיימים ומאומתים, והפרטים רק בקונסולות (שלב י).
- ☐ App Privacy ו־Data safety מולאו, ותואמים לקוד ולמדיניות הפרטיות (שלב ז).
- ☐ דירוג גיל (Apple) ו־IARC (Google) מולאו (שלב ז).
- ☐ אין בריפו סודות, keystore, קובצי Firebase או פרטי חשבון דמו (`git status`, ו־`apps/server/test/deploy.test.ts` לשרת).
- ☐ `npm run verify` עובר (lint, ‏typecheck, ‏i18n ובדיקות).
- ☐ `npm run i18n:release` עובר: אין מפתח, צורת ריבוי או מציין מקום חסרים באף שפה (D120, מ־1.1.0).
- ☐ מ־1.1.0: השרת כבר עם הטקסטים של כל השפות בגרסה (דף ההזמנה והדפים המשפטיים), ושורת "בעברית ובאנגלית" בתיאורים תואמת למספר השפות שיוצאות (D115ב).

**לא חוסמים לבטא, כן לפני השקה (שלב 15):**

- ☐ צלילים סופיים (CC0).
- ☐ ההישגים (אם אושרו).
- ☐ כל השורות ב־`QA-CHECKLIST.md` מסומנות ב־Android וב־iOS.
- ☐ גרסה `1.0.0` ב־`app.json`.
- ☐ תוכנית בתשלום ב־Neon (חלון שחזור של ימים), אם עדיין בחינמית.
- ☐ דומיין משלך לשרת ולמיילים של Firebase.

---

## מה Claude יכול לעשות כשתבקש

- לממש את "דווח על שחקן" וחסימה, או את ההישגים, אחרי שתאשר את ההצעות.
- להחליף צלילים כשיש קבצים עם רישיון.
- הגרסה `1.0.0` ב־`app.json`, ‏`extra.eas.projectId` אחרי `eas init`.
- לעדכן את כתובת השרת ב־`eas.json` ואת `app` ב־`fly.production.toml`, אם השם או הדומיין שונים.
- לעדכן את הטקסטים לחנויות אחרי שינויים, ואת הצ'קליסט הזה.
