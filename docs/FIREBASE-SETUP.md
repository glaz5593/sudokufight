# הקמת Firebase לסודוקו פייט

המדריך הזה מחבר את האפליקציה ואת השרת ל־Firebase אמיתי, בפרויקט **"Sudoku Fight"** (תוכנית Spark, בחינם).

**בלי Firebase הכל כבר עובד במצב פיתוח:** חשבונות מקומיים בטלפון, עם התג "מצב פיתוח" בכל מסכי החשבון.
אחרי השלבים כאן האפליקציה עוברת ל־Firebase לבד, **בלי שינוי קוד**. צריך רק את שני קובצי ההגדרות, Project ID לשרת, ו־Development Build חדש.

| מה | איפה זה נגמר |
|---|---|
| `google-services.json` (Android) | `apps/mobile/config/firebase/` במחשב, ומשתנה קובץ `GOOGLE_SERVICES_JSON` ב־EAS |
| `GoogleService-Info.plist` (iOS) | `apps/mobile/config/firebase/` במחשב, ומשתנה קובץ `GOOGLE_SERVICE_INFO_PLIST` ב־EAS |
| ה־Project ID (למשל `sudoku-fight-1a2b3`) | `FIREBASE_PROJECT_ID` בשרת: `apps/server/.env`, ו־`fly.toml` |

השרת לא צריך service account ולא שום קובץ סודי. הוא בודק את החתימה של כל ID token מול המפתחות הציבוריים של Google, לפי ה־Project ID בלבד.

---

## 1. יצירת הפרויקט

1. נכנסים ל־[console.firebase.google.com](https://console.firebase.google.com) עם חשבון Google שלך (לא חשבון של עבודה אחרת).
2. **Create a project**. השם: `Sudoku Fight`.
3. Google Analytics: אפשר לכבות בשלב הזה. Analytics יתחבר בשלב 14.
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

לא מדליקים עכשיו ספקים אחרים (Google, Apple, טלפון). הם לא חלק משלב 8.

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
- `apps/mobile/app.config.ts` מוצא אותם לבד. הוא מוסיף את ה־plugins של React Native Firebase (app, auth, crashlytics) ואת `expo-build-properties` (‏static frameworks ב־iOS), ומסמן לאפליקציה `extra.firebase`.
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

## 9. השרת: `FIREBASE_PROJECT_ID`

- **במחשב:** ב־`apps/server/.env` (מעתיקים מ־`.env.example` אם עוד אין) מוסיפים:
  ```
  FIREBASE_PROJECT_ID=sudoku-fight-1a2b3
  ```
  עם ה־Project ID האמיתי מסעיף 1. בפיתוח השרת מקבל גם ID tokens של Firebase וגם `dev:<uid>`.
- **ב־Fly.io:** ב־`fly.toml`, בתוך `[env]`, מוסיפים `FIREBASE_PROJECT_ID = "sudoku-fight-1a2b3"`, ואז `fly deploy --ha=false`.
  זה לא סוד. לא צריך `fly secrets`.
- **בלי המשתנה:** שרת בייצור עולה עם אזהרה, ומסלולי החשבון עונים 503 `disabled`. גם הכניסה לחדרי משחק נחסמת.
- שרת בייצור (`NODE_ENV=production`, כמו ב־`Dockerfile` וב־`fly.toml`) **אף פעם** לא מקבל `dev:<uid>`, לא ב־HTTP ולא בחדרי המשחק.

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
- **לא** להריץ שרת אמיתי בלי `NODE_ENV=production`. רק במצב ייצור השרת דוחה את `dev:<uid>`.
- **לא** להגיש לחנות בנייה שמופיע בה "מצב פיתוח". בנייה בפרופיל `production` ב־EAS כבר נכשלת אם חסר קובץ.
