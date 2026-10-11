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

## שלב א: החלטות פתוחות (משה). מתחילים עכשיו

הן משנות מה הבודקים רואים, וחלקן קשות לשינוי אחרי שיש שחקנים ודירוגים.

| ☐ | מה | איפה | הערה |
|---|---|---|---|
| ☐ | **"דווח על שחקן" ו"חסימה"** (הנחיה 1.2 של Apple, וגם מדיניות ה־UGC של Google Play) | [`store/UGC-PROPOSAL.md`](store/UGC-PROPOSAL.md) | גם בודקי TestFlight **חיצוניים** עוברים Beta App Review לפי אותן הנחיות. אם מאשרים, Claude מממש לפני ההגשה החיצונית |
| ☐ | **ההישגים** (ממתינים מאז שלב 12) | [`ACHIEVEMENTS-PROPOSAL.md`](ACHIEVEMENTS-PROPOSAL.md) | לאשר, לשנות, או להחליט שהבטא יוצאת בלעדיהם |
| ☐ | **ההחלטות שמסומנות "ממתינה לאישור"** (סותרות את המקור, ולכן נבנו לפי המקור): D1, ‏D14, ‏D18, ‏D24, ‏D26, ‏D34, ‏D35 | אפיון, סעיף 24 | לסמן ✓ על ההתנהגות של היום, או לאשר את ההצעה |
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
| ☐ | Email/Password, ומיילים בעברית (אימות ואיפוס) | 2, ‏3 |
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
| ☐ | **אווטרים ("freebie"): הרישיון לא ידוע, וזה חוסם הגשה.** למצוא את מקור החבילה ואת הרישיון, או להחליף בסט עם רישיון ברור | משה (Claude מחליף אחרי ההחלטה) | [`store/ASSET-LICENSES.md`](store/ASSET-LICENSES.md) סעיף 1 |
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
| ☐ | **אין התג "מצב פיתוח"** במסכי החשבון | `FIREBASE-SETUP.md` סעיף 11 |
| ☐ | הרשמה, מייל אימות בעברית, ‏"שכחתי סיסמה" | `FIREBASE-SETUP.md` סעיף 11 |
| ☐ | **משחק מדורג בין iPhone ל־Android** (2 שחקנים), והדירוג מתעדכן | [`STAGE9-10-DEVICE-CHECKS.md`](STAGE9-10-DEVICE-CHECKS.md) |
| ☐ | ניתוק וחזרה, מצב טיסה, מעבר לרקע | [`STAGE7-DEVICE-CHECKS.md`](STAGE7-DEVICE-CHECKS.md) |
| ☐ | Match-Timeout, ומשם "שחק מול בוט בינתיים" (זה מה שבודקי Apple יראו כשאין יריבים) | `LISTING-APPLE.md` סעיף 5 |
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

- ☐ רישיון האווטרים ברור, או שהוחלפו (שלב ה).
- ☐ הדפים המשפטיים בלי placeholder, והכתובות שלהם בשתי החנויות (שלב ו).
- ☐ החלטה על "דווח על שחקן" וחסימה, וממומשת אם אושרה (שלב א). לפני הגשה ל־App Store, ולפני Beta App Review.
- ☐ שרת Production בריא: ‏`/health` עובר, ‏Sentry מקבל, יש מאגר מדורג, ויש גיבוי למסד (שלב ד).
- ☐ הבנייה עם Firebase ובלי "מצב פיתוח", מול Production (שלבים ח–ט).
- ☐ משחק מדורג בין iOS ל־Android עבד מול Production (שלב ט).
- ☐ מחיקת חשבון עובדת מתוך האפליקציה (Apple 5.1.1(v), ‏Google Data safety) (שלב ט).
- ☐ חשבונות הדמו קיימים ומאומתים, והפרטים רק בקונסולות (שלב י).
- ☐ App Privacy ו־Data safety מולאו, ותואמים לקוד ולמדיניות הפרטיות (שלב ז).
- ☐ דירוג גיל (Apple) ו־IARC (Google) מולאו (שלב ז).
- ☐ אין בריפו סודות, keystore, קובצי Firebase או פרטי חשבון דמו (`git status`, ו־`apps/server/test/deploy.test.ts` לשרת).
- ☐ `npm run verify` עובר (lint, ‏typecheck, ‏i18n ובדיקות).

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
- להחליף אווטרים או צלילים כשיש קבצים עם רישיון.
- הגרסה `1.0.0` ב־`app.json`, ‏`extra.eas.projectId` אחרי `eas init`.
- לעדכן את כתובת השרת ב־`eas.json` ואת `app` ב־`fly.production.toml`, אם השם או הדומיין שונים.
- לעדכן את הטקסטים לחנויות אחרי שינויים, ואת הצ'קליסט הזה.
