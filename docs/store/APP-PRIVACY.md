<div dir="rtl">

# App Store: שאלון App Privacy ("תוויות הפרטיות")

שלב 14, אפיון סעיף 23. התשובות **לפי מה שהקוד אוסף בפועל**, כמו מדיניות הפרטיות (`apps/server/src/legal/privacy.ts`, מוגשת ב־`/legal/privacy`).
כשהקוד משנה את מה שהוא אוסף, מעדכנים את שלושתם: השאלון הזה, ‏`DATA-SAFETY.md` ומדיניות הפרטיות.

## 0. תנאים מוקדמים (התשובות נכונות רק אם הם מתקיימים)

1. ✅ **Firebase Analytics בלי פרסום** (בקוד): ‏`apps/mobile/firebase.json` מכבה את מזהה הפרסום, את SSAID ואת כל אותות הפרסום. ‏`app.config.ts` בונה בלי IDFA ב־iOS ובלי ההרשאה `AD_ID` ב־Android. ‏Analytics לא מקבל מזהה משתמש (`services/firebaseAnalytics.ts`), ואוסף רק בבניית Release. אין בקשת הרשאת מעקב (ATT).
2. **אין SDK של פרסום,** ו־Analytics לא מקושר ל־Google Ads או ל־AdMob ב־Firebase Console (לוודא בקונסול).
3. ✅ **‏Sentry בשרת בלי מידע אישי** (בקוד): בלי headers, ‏cookies, גוף בקשה, ‏query או כתובת IP, ומיילים וטוקנים מוסתרים (`apps/server/src/monitoring`).
4. **Data retention של Analytics** ב־Firebase Console: ‏2 חודשים (המינימום). מדיניות הפרטיות אומרת "לפי תקופת השמירה שהגדרנו".

## 1. מקורות המידע בקוד

| מקור | מה נאסף | איפה בקוד |
|---|---|---|
| חשבון | מייל, שם לתצוגה, מדינה, אווטאר, מזהה חשבון, uid של Firebase. **בכניסה עם Google** (רשות, מ־14.10.2026, ב־Android בלבד בינתיים): ‏Firebase Auth שומר גם את מזהה חשבון Google, ואת השם ואת הקישור לתמונה של חשבון Google. השרת שלנו לא שומר אותם ולא מציג אותם | `apps/server/src/accounts`, ‏Firebase Auth, ‏`apps/mobile/src/auth/firebaseProvider.ts` |
| משחקים | מהלכים עם זמנים, ניקוד, טעויות, מיקום, דירוג, XP, היסטוריית לוחות ויריבים, תוצאות אימון, ‏cheat_flags | `apps/server/src/persistence`, ‏`progress`, ‏`db/schema.ts` |
| אירועי שימוש | ‏`installId` אקראי, פלטפורמה, גרסה, 13 אירועים עם props (טבלה במדיניות) | `apps/mobile/src/services/telemetry`, ‏`POST /v1/events` |
| Firebase Analytics | אותם אירועים, ‏App Instance ID, פרטי מכשיר, מיקום משוער מה־IP | `apps/mobile/src/services/analytics.ts` ← ‏`firebaseAnalytics.ts`, ‏`ga4.ts` |
| Crashlytics | דוחות קריסה, דגם, מערכת, גרסה, מזהה חשבון (לא מייל) | `apps/mobile/src/services/crashlytics.ts` |
| Sentry (שרת) | פרטי שגיאה טכניים, לפעמים מזהה חשבון | `apps/server/src/monitoring` |
| כתובת IP | **בזיכרון בלבד**, להגבלת קצב. לא נשמרת | `apps/server/src/http/clientKey.ts`, ‏`rateLimiter.ts` |

## 2. התשובות, לפי סוג מידע

**"Linked to the user"** (מקושר לזהות): כמעט הכל כן, כי כשהשחקן מחובר, האירועים, ההתקנה והמשחקים נשמרים עם מזהה החשבון, ו־Crashlytics מקבל את מזהה החשבון.
**"Used for tracking"**: **לא, לאף סוג.** אין פרסום, אין שיתוף עם סוחרי מידע, ואין חיבור למידע של חברות אחרות.

| קטגוריה ב־Apple | סוג | נאסף? | מקושר? | Tracking? | מטרות | מה זה אצלנו |
|---|---|---|---|---|---|---|
| Contact Info | **Email Address** | **כן** | כן | לא | App Functionality | כניסה (במייל וסיסמה, או עם Google), אימות, איפוס סיסמה |
| Contact Info | Name | **לא, עד שתהיה כניסה עם Google ב־iOS. אז: כן** | כן | לא | App Functionality | השם לתצוגה הוא כינוי (ראו User ID). בכניסה עם Google, ‏Firebase Authentication שומר את השם של חשבון Google עם הכניסה (אנחנו לא משתמשים בו ולא מציגים אותו), ולכן ברגע שהכפתור מגיע ל־iOS מסמנים כאן כן |
| Contact Info | Phone, Physical Address, Other | לא | — | — | — | |
| Health & Fitness | הכל | לא | — | — | — | |
| Financial Info | הכל | לא | — | — | — | אין רכישות |
| Location | Precise Location | לא | — | — | — | |
| Location | **Coarse Location** | **כן** | **לא** (ראו הערה) | לא | Analytics | ‏Firebase Analytics מסיק מדינה ואזור מכתובת ה־IP. (המדינה שבפרופיל נבחרת ידנית: ראו Other User Content) |
| Sensitive Info | — | לא | — | — | — | |
| Contacts | — | לא | — | — | — | |
| User Content | Emails or Text Messages, Photos or Videos, Audio, Customer Support | לא | — | — | — | אין צ׳אט. תמיכה במייל, מחוץ לאפליקציה |
| User Content | **Gameplay Content** | **כן** | כן | לא | App Functionality | משחקים מדורגים, מהלכים, Replay, תוצאות אימון, דירוג ו־XP |
| User Content | **Other User Content** | **כן** | כן | לא | App Functionality | המדינה והאווטאר שהשחקן בוחר, גלויים לאחרים |
| Browsing / Search History | — | לא | — | — | — | |
| Identifiers | **User ID** | **כן** | כן | לא | App Functionality, Analytics | מזהה החשבון, ה־uid של Firebase, והשם לתצוגה (screen name) |
| Identifiers | **Device ID** | **כן** | כן | לא | App Functionality, Analytics | ‏`installId` שלנו, ‏App Instance ID של Firebase, מזהה ההתקנה של Crashlytics. **לא IDFA** |
| Purchases | — | לא | — | — | — | |
| Usage Data | **Product Interaction** | **כן** | כן | לא | Analytics | ‏`app_open`, ‏`screen_view` ושאר האירועים |
| Usage Data | Advertising Data | לא | — | — | — | |
| Usage Data | Other Usage Data | לא | — | — | — | הכל נכלל ב־Product Interaction |
| Diagnostics | **Crash Data** | **כן** | כן | לא | App Functionality | ‏Crashlytics (אפליקציה), ‏Sentry (שרת) |
| Diagnostics | **Performance Data** | **כן** | כן | לא | App Functionality, Analytics | ‏`latency_sample`, ‏`reconnect` |
| Diagnostics | **Other Diagnostic Data** | **כן** | כן | לא | App Functionality | דגם, גרסת מערכת וגרסת אפליקציה בדוחות הקריסה. בטבלת ההתקנות: הפלטפורמה וגרסת האפליקציה בלבד |
| Surroundings, Body | — | לא | — | — | — | |
| Other Data | — | לא | — | — | — | |

**הערות:**
- **כתובת IP** לא מופיעה בשאלון כסוג נפרד. השרת שלנו משתמש בה רק בזיכרון (הגבלת קצב), ולכן היא לא "נאספת". המיקום המשוער ש־Firebase מסיק ממנה מוצהר תחת Coarse Location.
- **Coarse Location מוצהר בזהירות.** אם משה מחליט לכבות ב־Firebase את איסוף האזור (Google Signals / granular location), אפשר להסיר אותו. לא להסיר בלי שינוי כזה.
- **Coarse Location לא מקושר:** הוא מגיע רק מ־Firebase Analytics, ו־Analytics לא מקבל מזהה משתמש ולא מחובר לנתונים שלנו. אם בעתיד מוסיפים `setUserId` או ייצוא ל־BigQuery שמצליב עם החשבונות, משנים לLinked. (סימון "Linked" גם עכשיו הוא בחירה זהירה ומותרת.)
- **Product Interaction מקושר:** אף ש־Analytics לא מקבל את מזהה החשבון, השרת שלנו שומר את אותם אירועים עם המזהה. לכן "Linked".

## 3. בתוך האפליקציה

- **Privacy manifest (‏`PrivacyInfo.xcprivacy`):** ‏Expo ו־React Native Firebase מוסיפים אחד בבנייה, עם "required reason APIs". אחרי בניית EAS הראשונה: Xcode → Archive → ‏**Generate Privacy Report**, ולוודא שאין בו סוגי מידע שלא מופיעים כאן.
- **ATT (App Tracking Transparency):** לא מבקשים. אין מעקב.
- **מחיקת חשבון** (הנחיה 5.1.1(v)): הגדרות → מחיקת חשבון. מוחקת את החשבון בשרת ואת הכניסה ב־Firebase. אחרי המחיקה נשארים רק נתונים אנונימיים (המדיניות, סעיף "כמה זמן המידע נשמר"). מי שנכנס עם Google מאשר עם חשבון Google במקום סיסמה, והאפליקציה מבטלת את הגישה שקיבלה ממנו.
- **כניסה עם Google ו־Sign in with Apple** (הנחיה 4.8): היום הכפתור של Google קיים רק ב־Android. כשמוסיפים אותו ל־iOS, ‏**Sign in with Apple חובה באותה גרסה** (אפיון 23), ומעדכנים כאן את Name (למעלה) ואת המקור "חשבון".
- **קישור למדיניות:** בהרשמה (תיבת האישור) ובהגדרות → "מידע ומשפטי".

</div>
