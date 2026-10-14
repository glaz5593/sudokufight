# הקמת Firebase לסודוקו פייט

המדריך הזה מחבר את האפליקציה ואת השרת ל־Firebase אמיתי, בפרויקט **"Sudoku Fight"** (תוכנית Spark, בחינם).

**בלי Firebase הכל כבר עובד במצב פיתוח:** חשבונות מקומיים בטלפון, עם התג "מצב פיתוח" בכל מסכי החשבון.
אחרי השלבים כאן האפליקציה עוברת ל־Firebase לבד, **בלי שינוי קוד**. צריך רק את שני קובצי ההגדרות, Project ID לשרת, ו־Development Build חדש.

| מה | איפה זה נגמר |
|---|---|
| `google-services.json` (Android) | `apps/mobile/config/firebase/` במחשב, ומשתנה קובץ `GOOGLE_SERVICES_JSON` ב־EAS |
| `GoogleService-Info.plist` (iOS) | `apps/mobile/config/firebase/` במחשב, ומשתנה קובץ `GOOGLE_SERVICE_INFO_PLIST` ב־EAS |
| ה־Project ID (למשל `sudoku-fight-1a2b3`) | `FIREBASE_PROJECT_ID` בשרת: `apps/server/.env`, ובסודות של Fly (`fly secrets set`) |
| ה־`apiKey` וה־`appId` של אפליקציית ה־Web "Sudoku Fight Admin" (סעיף 9א) | `FIREBASE_WEB_API_KEY` ו־`FIREBASE_WEB_APP_ID` בשרת: `apps/server/.env`, ובסודות של Fly |

השרת לא צריך service account ולא שום קובץ סודי. הוא בודק את החתימה של כל ID token מול המפתחות הציבוריים של Google, לפי ה־Project ID בלבד.

---

## 1. יצירת הפרויקט

1. נכנסים ל־[console.firebase.google.com](https://console.firebase.google.com) עם חשבון Google שלך (לא חשבון של עבודה אחרת).
2. **Create a project**. השם: `Sudoku Fight`.
3. Google Analytics: מדליקים (משלב 14 האפליקציה שולחת אליו אירועים). פרויקט שכבר נוצר בלי Analytics: סעיף 8א.
4. **Create project**, ומחכים שיסתיים.
5. רושמים את ה־**Project ID**: גלגל השיניים ליד "Project Overview" ← **Project settings** ← לשונית **General** ← השדה **Project ID**.
   זה לא תמיד בדיוק השם. לפעמים Firebase מוסיף לו סיומת, כמו `sudoku-fight-1a2b3`.

## 2. התחברות במייל וסיסמה

1. בתפריט: **Build** ← **Authentication** ← **Get started**.
2. לשונית **Sign-in method** ← **Email/Password**.
3. מדליקים את המתג הראשון, **Email/Password**. את השני, **Email link (passwordless sign-in)**, משאירים כבוי.
4. **Save**.
5. לשונית **Settings** ← **User actions**: משאירים את **Email enumeration protection** דלוק (ברירת המחדל).
   האפליקציה כבר מטפלת בזה: היא מציגה "מייל או סיסמה שגויים" בלי לגלות אם המייל רשום.
6. לשונית **Settings** ← **Password policy**: משאירים **כבוי** (ברירת המחדל), או מגדירים מינימום 8 תווים בלי שום דרישה נוספת.
   הכלל של האפליקציה הוא רק "לפחות 8 תווים" (החלטה של משה, 14.10.2026). מדיניות שדורשת גם אותיות גדולות, ספרות או סימנים תדחה סיסמאות שהאפליקציה מאשרת. אם זה קורה, השחקן רואה "הסיסמה חלשה מדי".

באפליקציה לא מדליקים ספקים אחרים (Google, Apple, טלפון). הם לא חלק משלב 8.
הספק Google נדלק רק בשביל הכניסה לאתר הניהול (סעיף 9א). באפליקציה אין כפתור Google, אבל זה אותו פרויקט: כתובת שנכנסה לאתר הניהול עם Google כבר רשומה בו, ולא תוכל להירשם באפליקציה עם מייל וסיסמה (פרטים בסעיף 9א).

## 3. מיילים בעברית: אימות מייל ואיפוס סיסמה (D22)

1. **Authentication** ← לשונית **Templates**.
2. בתחתית הדף, **Template language** ← **Hebrew**. זו השפה של כל המיילים שהפרויקט שולח.
3. **Email address verification** ← העיפרון:
   - **Sender name:** `סודוקו פייט`
   - **Subject:** למשל `אימות כתובת המייל שלך בסודוקו פייט`
   - **Message:** אפשר להשאיר את הנוסח העברי של Firebase. אם משנים, חייב להישאר בו הקישור `%LINK%`.
   - **Save**.
4. **Password reset** ← העיפרון: אותו שם שולח, ונושא כמו `איפוס הסיסמה שלך בסודוקו פייט`. **Save**.
5. כתובת השולח היא `noreply@<project-id>.firebaseapp.com`. דומיין משלך אפשר להוסיף אחר כך, לפני ההשקה.

בתוכנית Spark יש מכסה יומית למיילים של Firebase. לבדיקות ולבטא היא מספיקה.

## 4. אפליקציית Android ו־`google-services.json`

1. **Project Overview** ← **Add app** ← הסמל של Android.
2. **Android package name:** `com.mosheg.sudokufight`
   (חייב להיות זהה ל־`android.package` ב־`apps/mobile/app.json`).
3. **App nickname:** `Sudoku Fight Android`.
4. **Debug signing certificate SHA-1:** משאירים ריק. התחברות במייל וסיסמה לא צריכה אותו.
5. **Register app** ← **Download google-services.json**.
6. את שאר המסכים (הוספת ה־SDK ל־Gradle) מדלגים עם **Next** ו־**Continue to console**. ה־config plugins של Expo עושים את זה.

## 5. אפליקציית iOS ו־`GoogleService-Info.plist`

1. **Project Overview** ← **Add app** ← **iOS+** (הסמל של Apple).
2. **Apple bundle ID:** `com.mosheg.sudokufight`
   (חייב להיות זהה ל־`ios.bundleIdentifier` ב־`apps/mobile/app.json`).
3. **App nickname:** `Sudoku Fight iOS`. את **App Store ID** משאירים ריק.
4. **Register app** ← **Download GoogleService-Info.plist**.
5. את שאר המסכים מדלגים, כמו ב־Android.

## 6. הקבצים במחשב

שמים את שני הקבצים, **בדיוק בשמות האלה**, בתיקייה:

```
apps/mobile/config/firebase/google-services.json
apps/mobile/config/firebase/GoogleService-Info.plist
```

- שני השמות כבר ב־`.gitignore`. כדאי לבדוק: `git check-ignore -v apps/mobile/config/firebase/google-services.json` צריך להדפיס את השורה מ־`.gitignore`.
- `apps/mobile/app.config.ts` מוצא אותם לבד. הוא מוסיף את ה־plugins של React Native Firebase (app, auth, crashlytics, ומשלב 14 גם analytics) ואת `expo-build-properties` (‏static frameworks ב־iOS), ומסמן לאפליקציה `extra.firebase`.
- אפשר לשים רק את אחד הקבצים. אז רק הפלטפורמה ההיא עוברת ל־Firebase, והשנייה נשארת במצב פיתוח.

## 7. הקבצים ב־EAS (בנייה בענן)

קבצים שב־`.gitignore` לא עולים ל־EAS, ולכן מעלים אותם כמשתני סביבה מסוג קובץ.
פעם אחת מתקינים את הכלי ונכנסים: `npm install -g eas-cli`, ואז `eas login`. אחר כך, מתוך `apps/mobile`:

```
cd apps/mobile
eas env:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./config/firebase/google-services.json --visibility secret --environment development --environment preview --environment production
eas env:create --scope project --name GOOGLE_SERVICE_INFO_PLIST --type file --value ./config/firebase/GoogleService-Info.plist --visibility secret --environment development --environment preview --environment production
```

- אם `eas` שואל משהו במקום לקבל דגל: הסוג `file`, הנראוּת `secret`, והסביבות: שלושתן.
- בדיקה: `eas env:list --environment production` צריך להציג את שני המשתנים.
- **הגנה:** בנייה בפרופיל `production` ב־EAS **נכשלת** אם חסר הקובץ של הפלטפורמה שנבנית. ההודעה אומרת מה להעלות.
  כך אי אפשר לשלוח לחנות בטעות גרסה עם החשבונות המקומיים של מצב פיתוח.

## 8. Crashlytics

1. בתפריט: **Run** (או **Release & Monitor**) ← **Crashlytics**. אם השם בתפריט שונה, מחפשים "Crashlytics" בשורת החיפוש של הקונסול.
2. בוחרים את אפליקציית Android, ואחר כך את iOS, ולוחצים **Enable Crashlytics** אם הכפתור מופיע.
3. הלוח יכתוב שהוא מחכה לנתונים. זה תקין עד שגרסת release תדווח.
   האפליקציה אוספת רק ב־release (`preview` או `production`), לא ב־Development Build. כך דיבוג בטלפון לא ממלא את הלוח.
4. אין קובץ נוסף להוריד. ה־plugin של Crashlytics נכנס דרך `app.config.ts` יחד עם השאר.

## 8א. Analytics (שלב 14)

משלב 14, ‏`track()` שולח כל אירוע (אפיון 22) גם ל־Firebase Analytics, ולא רק לשרת שלנו (`apps/mobile/src/services/firebaseAnalytics.ts`).

1. **אם Analytics כבוי בפרויקט:** גלגל השיניים ← **Project settings** ← לשונית **Integrations** ← **Google Analytics** ← **Enable**.
   בוחרים חשבון Google Analytics (או יוצרים חדש, `Sudoku Fight`), ומיקום הנתונים.
2. **מורידים שוב את שני קובצי ההגדרות** (סעיפים 4 ו־5: ‏Project settings ← General ← האפליקציה ← הורדה), שמים אותם במקום הישנים,
   ו**מעלים אותם מחדש ל־EAS** (`eas env:update`, או מוחקים ויוצרים מחדש לפי סעיף 7). כך גם הקבצים כוללים את Analytics.
3. ב־Google Analytics (‏analytics.google.com) ← Admin ← **Data collection and modification** ← **Data collection**:
   **Google signals** כבוי. ב־**Data retention**: ‏2 חודשים מספיקים (ככה גם מדיניות הפרטיות פשוטה יותר).
4. **מה האפליקציה שולחת:** רק את האירועים של אפיון 22 ו־`screen_view` (תבנית המסך, למשל `/results/[id]`). שמות בכללים של GA4, בלי מיילים, שמות, מזהים או tokens.
   אין `setUserId`: הנתונים על האפליקציה, לא על אדם.
5. **מה כבוי** (`apps/mobile/firebase.json` ו־`app.config.ts`): איסוף עד שבניית release מדליקה אותו, ה־Advertising ID של Android (גם ההרשאה `AD_ID` יוצאת מה־manifest),
   ה־IDFA של iOS (בלי הודעת מעקב של Apple), התאמה אישית של פרסומות, ודיווח מסכים אוטומטי.
6. **האיסוף רק בבניות release** (`preview` ו־`production`), כמו Crashlytics. גם בניות `preview` מול ה־Staging נכנסות לאותו Analytics, כי הפרויקט אחד. בבטא זה בסדר.
7. **בדיקה:** בבניית `preview` בטלפון, פותחים כמה מסכים ומשחקים אימון אחד. אחרי כמה דקות ב־Firebase ← **Analytics** ← **Realtime** (או ב־GA4 ← Reports ← Realtime) רואים `app_open`, ‏`screen_view` ו־`game_start`.
   הדוחות הרגילים מתעדכנים רק אחרי כמה שעות.

## 9. השרת: `FIREBASE_PROJECT_ID`

- **במחשב:** ב־`apps/server/.env` (מעתיקים מ־`.env.example` אם עוד אין) מוסיפים:
  ```
  FIREBASE_PROJECT_ID=sudoku-fight-1a2b3
  ```
  עם ה־Project ID האמיתי מסעיף 1. בפיתוח השרת מקבל גם ID tokens של Firebase וגם `dev:<uid>`.
- **ב־Fly.io:** ‏`fly secrets set -a sudoku-fight-staging FIREBASE_PROJECT_ID=sudoku-fight-1a2b3` (המכונה עולה מחדש עם הערך).
  זה לא סוד, אבל הוא **לא** נכנס ל־`fly.toml`: ‏`apps/server/test/deploy.test.ts` בודק שאין בקובצי ה־Fly ערכים של פרויקט, ונכשל אם הוא שם.
  בשרת ה־Production (`fly.production.toml`) הוא נכנס עם שאר ההגדרות ב־`fly secrets set`, לפי [`docs/DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) סעיף 4.
- **בלי המשתנה:** שרת בייצור עולה עם אזהרה, ומסלולי החשבון עונים 503 `disabled`. גם הכניסה לחדרי משחק נחסמת.
- שרת בייצור (`NODE_ENV=production`, כמו ב־`Dockerfile` וב־`fly.toml`) **אף פעם** לא מקבל `dev:<uid>`, לא ב־HTTP ולא בחדרי המשחק.

## 9א. כניסה עם Google לאתר הניהול (Google sign-in for the admin site)

בשרתים האמיתיים (Staging ו־Production) נכנסים לאתר הניהול (`/admin`) **עם חשבון Google**, ורק החשבונות שברשימה `ADMIN_EMAILS` בשרת.
אין סיסמה לייצר ולשמור. הכניסה עוברת דרך אותו פרויקט Firebase של המשחק.

**מה זה עושה לחשבונות של האפליקציה.** כל חשבון Google שמסיים את החלון של Google ב־`/admin` נרשם כמשתמש בפרויקט (**Authentication** ← **Users**, עם הספק Google). גם חשבון שהשרת דוחה אחר כך.
ב־Firebase ברירת המחדל היא חשבון אחד לכל כתובת מייל, ובאפליקציה אין כפתור Google. לכן:
- כתובת שנכנסה לאתר הניהול **לא יכולה להירשם באפליקציה** עם מייל וסיסמה (`auth/email-already-in-use`). לחשבונות באפליקציה (בדיקות, חשבונות הדגמה) משתמשים בכתובות אחרות.
  למשל כינוי של Gmail עם `+`, כמו `you+sf1@gmail.com`: מבחינת Firebase זו כתובת אחרת, והמיילים מגיעים לאותה תיבה.
- ובכיוון ההפוך: חשבון של האפליקציה באותה כתובת, שהמייל שלו עוד לא אומת, יכול לאבד את הסיסמה שלו כשהכתובת נכנסת לאתר הניהול עם Google (Firebase סומך על Google בכתובות Gmail).
- משתמש מיותר (למשל מישהו שניסה להיכנס ל־`/admin` עם חשבון Google משלו) אפשר למחוק ב־**Authentication** ← **Users**. הוא נספר כמשתמש פעיל באותו חודש, ותו לא.

**1. מדליקים את Google כספק כניסה**
1. **Authentication** ← לשונית **Sign-in method** ← **Add new provider** ← **Google**.
2. מדליקים את המתג **Enable**.
3. **Project support email:** בוחרים את המייל שלך מהרשימה. Google מציג אותו במסך בחירת החשבון.
4. **Save**.

**2. מוסיפים אפליקציית Web בשם "Sudoku Fight Admin"**
1. גלגל השיניים ← **Project settings** ← לשונית **General** ← בתחתית, **Your apps** ← **Add app** ← הסמל של Web (`</>`).
2. **App nickname:** `Sudoku Fight Admin`.
3. **Also set up Firebase Hosting:** **לא** מסמנים. האתר רץ בשרת שלנו.
4. **Register app**. מופיע קטע קוד עם `firebaseConfig`. מעתיקים ממנו רק שני ערכים:
   - `apiKey` (מתחיל ב־`AIza`), שהוא `FIREBASE_WEB_API_KEY`.
   - `appId` (נראה כמו `1:<מספר>:web:<אותיות ומספרים>`), שהוא `FIREBASE_WEB_APP_ID`.
5. **Continue to console**. לא מתקינים SDK: הוא כבר באתר הניהול.

שני הערכים **לא סודיים**: הדפדפן של כל מי שפותח את דף הכניסה מקבל אותם. ובכל זאת הם **לא** נכנסים לריפו (הוא ציבורי).
הם נכנסים לסודות של Fly, ובמחשב ל־`apps/server/.env`. אפשר להדביק אותם ל־Claude, והוא מגדיר אותם.

**3. מאשרים את הכתובות של השרתים**
1. **Authentication** ← לשונית **Settings** ← **Authorized domains** ← **Add domain**.
2. מוסיפים את `sudoku-fight-staging.fly.dev`, ואחר כך את `sudoku-fight-prod.fly.dev`.
   ‏`localhost` כבר ברשימה, וכך הכניסה עובדת גם במחשב.
3. **כל כתובת חדשה של שרת נכנסת לכאן**: שם אחר לאפליקציה ב־Fly (כשהשם תפוס), או דומיין משלך (`api.<הדומיין>`). בלי זה הכניסה עם Google בכתובת החדשה נכשלת (`auth/unauthorized-domain`), ובשרת בלי סיסמה אין דרך אחרת להיכנס לאתר הניהול.

**4. השרת**
- **ב־Fly** ‏(Claude מגדיר, ב־`fly secrets set` לכל אחד מהשרתים):
  `FIREBASE_PROJECT_ID`, ‏`FIREBASE_WEB_API_KEY`, ‏`FIREBASE_WEB_APP_ID`, ו־`ADMIN_EMAILS`: הכתובות של חשבונות ה־Google שמותר להם להיכנס, מופרדות בפסיקים.
  כותבים כל כתובת **בדיוק כמו ש־Google מציג אותה** (גדולות או קטנות לא משנה). את הרשימה האמיתית לא כותבים באף קובץ בריפו.
  ‏Claude בודק שכל רשומה היא כתובת מייל לפני שהוא מגדיר. רשומה לא תקינה (למשל `a@gmail,com`) לא מפילה את השרת: היא מכבה רק את הכניסה עם Google, עם אזהרה בלוג.
- `ADMIN_SESSION_SECRET` (לא חובה, משה מגדיר בעצמו): בלעדיו נכנסים שוב עם Google אחרי כל פריסה. כשהכניסה היא רק עם Google, **הוא לבדו חותם על החיבורים** לאתר הניהול, ולכן הוא סוד: נוצר אקראית בחלון של משה, ערך אחר לכל שרת, ולא עובר בצ'אט (`docs/MOSHE-TODO.md` ‏D4).
- **במחשב** (לא חובה: בפיתוח סיסמת הפיתוח ממשיכה לעבוד): אותם ארבעה ב־`apps/server/.env`, למשל
  ```
  ADMIN_EMAILS=you@example.com
  ```
- סיסמה **לא חובה**. אם רוצים גם אותה: `ADMIN_PASSWORD` של 8 תווים לפחות (בייצור לא `sudoku-admin-dev`).
- **בלוג של ההפעלה** כתוב אילו שיטות כניסה דלוקות, למשל `admin site on (Google sign-in for 3 addresses)`. בלי הכתובות עצמן.
  אם רק חלק מההגדרות קיים, או שאחת מהן לא תקינה, השרת מזהיר `admin Google sign-in off: ...`, עם מה שחסר או לא תקין.

**5. בדיקה**
1. פותחים את `https://sudoku-fight-staging.fly.dev/admin` ← הכפתור של Google ← בוחרים חשבון שברשימה. האתר נפתח.
2. בלוג של השרת (`fly logs`): `admin sign-in: <הכתובת>`.
3. חשבון Google שלא ברשימה מקבל הודעה שהוא לא מורשה, ולא נכנס.

**אם משהו לא עובד:**
- החלון של Google נסגר מיד עם `auth/unauthorized-domain`: הכתובת של השרת לא ב־**Authorized domains** (שלב 3).
- `auth/operation-not-allowed`: הספק Google לא דלוק (שלב 1).
- `auth/web-storage-unsupported`: הדפדפן חוסם עוגיות ונתוני אתרים של צד שלישי (למשל בחלון גלישה בסתר), והחלון של Google צריך אותם. מאפשרים אותם לאתר הניהול, או נכנסים מחלון רגיל.
- הודעה שהחשבון לא מורשה (403 `notAllowed`) עם החשבון הנכון: הכתובת ב־`ADMIN_EMAILS` לא זהה לכתובת של חשבון ה־Google.
- 401 `invalidToken` עם `aud` או `iss` בהודעה: ה־`apiKey` שייך לפרויקט Firebase אחר מ־`FIREBASE_PROJECT_ID`.
- כפתור Google לא מופיע: בשרת חסרה אחת משלוש ההגדרות, או שאחת מהן לא תקינה. הלוג של ההפעלה אומר איזו.

## 10. Development Build חדש

React Native Firebase הוא קוד native. לכן ה־Development Build הקיים בטלפון **לא יכול** להשתמש בו, ואי אפשר לדלג על בנייה חדשה.

- **בענן (מומלץ, בגלל המקום בכונן C):**
  ```
  cd apps/mobile
  eas build --profile development --platform android
  ```
  ובשביל iOS: `--platform ios`.
- **במחשב:** כמו ב־README, אבל עם `--clean`, כי ההגדרות של ה־native השתנו:
  ```
  cd apps/mobile
  npx expo prebuild --platform android --clean
  cd android
  ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
  ```
- מתקינים את הבנייה החדשה בטלפון, ו**מפעילים מחדש את Metro** (`npm run mobile`). Metro קורא את `app.config.ts` רק כשהוא עולה.

אם שמים את הקבצים ומפעילים מחדש את Metro בלי לבנות מחדש, האפליקציה תנסה להשתמש ב־Firebase שלא קיים ב־native, וכל התחברות תיכשל בשגיאה. הפתרון: לבנות מחדש.

## 11. בדיקה שזה עובד

1. מריצים את השרת עם `FIREBASE_PROJECT_ID` (‏`npm run server`), ואת `npm run android:reverse` ו־`npm run mobile`.
2. פותחים את האפליקציה. **התג "מצב פיתוח" לא מופיע** במסך ההתחברות. אם הוא מופיע, הבנייה או Metro עדיין בלי Firebase.
3. נרשמים בטלפון: שלב 1 (שם, אווטר, מדינה), שלב 2 (מייל וסיסמה). מגיעים למסך הבית עם הכרטיס: דירוג 1200, זמני.
4. בקונסול: **Authentication** ← **Users**. המייל החדש מופיע.
5. בתיבת המייל: מייל אימות **בעברית**, משם השולח שהגדרת. לוחצים על הקישור, ובאפליקציה לוחצים "אימתתי". הבאנר במסך הבית נעלם.
6. באתר הניהול (`http://localhost:2567/admin`): **משתמשים**. המשתמש מופיע עם המייל, המדינה והדירוג.
7. עורכים אווטר באפליקציה, ורואים את השינוי באתר הניהול.
8. "שכחתי סיסמה" במסך ההתחברות: מגיע מייל איפוס בעברית.
9. מחיקת חשבון בהגדרות (עם הסיסמה): המשתמש נעלם מ־**Authentication** ← **Users**, ובאתר הניהול הוא מסומן "נמחק", בלי מייל.
   נרשמים מחדש עם אותו שם, וזה עובד.

**אם משהו לא עובד:**
- השרת עונה 401 עם `aud` או `iss` בהודעה: ה־`FIREBASE_PROJECT_ID` בשרת לא זהה ל־Project ID של הקבצים.
- 503 `unavailable`: השרת לא מצליח להגיע למפתחות של Google (רשת או חומת אש). האפליקציה לא מנתקת את השחקן בגלל זה.
- 503 `disabled`: שרת בייצור בלי `FIREBASE_PROJECT_ID`.

## 12. מה לא לעשות

- **לא** להכניס את `google-services.json` או את `GoogleService-Info.plist` ל־git. לפני כל commit בודקים ב־`git status` שהם לא שם.
- **לא** להעתיק קבצים, מפתחות או הגדרות מ־PureTrack או מכל פרויקט אחר. רק מהפרויקט "Sudoku Fight".
- **לא** להוריד service account (המפתח הפרטי של Admin SDK) ולא לשים אותו בשרת. השרת לא צריך אותו.
- **לא** לשים את ה־API key מתוך הקבצים בקוד, ב־`.env` או ב־`EXPO_PUBLIC_*`. הוא נכנס לבנייה דרך הקבצים בלבד.
  (ה־`apiKey` של אפליקציית ה־Web של אתר הניהול, סעיף 9א, נכנס רק להגדרות של השרת: `apps/server/.env` במחשב, והסודות של Fly.)
- **לא** לכתוב את הכתובות של `ADMIN_EMAILS` בקובץ בריפו, גם לא בדוגמה. בדוגמאות: `you@example.com`.
- **לא** להריץ שרת אמיתי בלי `NODE_ENV=production`. רק במצב ייצור השרת דוחה את `dev:<uid>`.
- **לא** להגיש לחנות בנייה שמופיע בה "מצב פיתוח". בנייה בפרופיל `production` ב־EAS כבר נכשלת אם חסר קובץ.
