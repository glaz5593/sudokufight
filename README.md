# סודוקו פייט (Sudoku Fight)

משחק סודוקו תחרותי בזמן אמת: 1–4 שחקנים, לוח אחד, וכולם פותרים במקביל.

| מה | איפה |
|---|---|
| אפיון מפורט | [docs/01-SPEC.md](docs/01-SPEC.md) |
| תוכנית עבודה בשלבים | [docs/02-WORK-PLAN.md](docs/02-WORK-PLAN.md) |
| עיצוב (קנבס) | https://claude.ai/artifact/Gi5UdFahu2WP7ECR5Z5pon · פרטים ב־[docs/03-DESIGN.md](docs/03-DESIGN.md) |
| האפיון המקורי | [docs/00-original-spec-v1.md](docs/00-original-spec-v1.md) |
| שחרור: הצ'קליסט עד TestFlight ו־Play Closed testing | [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) |
| שרת ה־Production | [docs/DEPLOY-PRODUCTION.md](docs/DEPLOY-PRODUCTION.md) |

## מבנה

```
packages/engine     חוקי המשחק, ניקוד, הסברים, מאגר הלוחות (TypeScript טהור, שעון ו־RNG מוזרקים)
packages/protocol   הממשק GameHost וטיפוסי ההודעות בין האפליקציה לשרת
apps/mobile         האפליקציה (Expo SDK 57, expo-router, Reanimated 4, Skia, Zustand)
apps/server         שרת זמן אמת (Node, Colyseus 0.18)
assets/             אווטרים ולוחות מקור
docs/               אפיון, תוכנית, עיצוב
```

החבילות המשותפות נצרכות ישירות מקוד המקור (`main` ו־`types` מצביעים על `src/index.ts`).

## דרישות

- Node 24 (ראו `.nvmrc`), npm 11.
- להתקנה: `npm install` בשורש. **לא** להתקין חבילות בלי גרסה: ה־latest ב־npm כבר עבר ל־TypeScript 7, Jest 30 ו־ESLint 10,
  והכלים כאן נעולים על TypeScript 6.0, Jest 29 ו־ESLint 9. באפליקציה מוסיפים חבילות רק עם `npx expo install` מתוך `apps/mobile`.
- אחרי כל שינוי תלויות: `npm ls react react-native` חייב להחזיר גרסה אחת של כל אחד.

## פקודות (מהשורש)

| פקודה | מה היא עושה |
|---|---|
| `npm test` | כל הבדיקות: engine, ‏protocol, ‏server, ‏admin ו־mobile |
| `npm run typecheck` | `tsc -b` על כל ה־workspaces |
| `npm run lint` | ESLint, כולל הכלל שאוסר `Date.now()`, ‏`Math.random()` וטיימרים בתוך המנוע |
| `npm run verify` | lint, ‏typecheck ובדיקות |
| `npm run server` | השרת בפיתוח (tsx watch), פורט 2567 |
| `npm run dev:lan` | השרת בפיתוח לטלפונים ב־Wi-Fi: מוצא את כתובת המחשב, טוען את המאגר המדורג אם חסר, ומדפיס מה לשים ב־`.env.local`. פירוט ב"טלפונים ב־Wi-Fi" |
| `npm run fake-client -- --create` | לקוח מזויף שמשחק דרך השרת כמו בוט. פירוט ב"לשחק מול לקוח מזויף" |
| `npm run seed` | נתוני דוגמה לאתר הניהול במסד של הפיתוח (PGlite): ‏300 התקנות, 80 משתמשים ו־150 משחקים מדורגים. טוען גם את המאגר המדורג. `-- --reset` מוחק קודם. לעצור את השרת לפני |
| `npm run db:seed-puzzles` | טוען לטבלת `puzzles` את המאגר המדורג מ־`packages/engine/data/puzzles.json`: רק לוחות עם `pool='ranked'` (אפיון, סעיף 20). בלי זה משחק מדורג לא מתחיל. אפשר להריץ שוב: הוא רק מעדכן. ב־PGlite לעצור את השרת לפני. מול Postgres של הייצור: עם `DATABASE_URL` (למשל דרך `fly proxy`) |
| `npm run admin:dev` | אתר הניהול בפיתוח (Vite) ב־`http://localhost:5174/admin/`. מפנה את `/admin/api` לשרת בפורט 2567, אז מריצים גם `npm run server` |
| `npm run admin:build` | בונה את אתר הניהול ל־`apps/admin/dist`. השרת מגיש אותו ב־`/admin` |
| `npm run mobile` | Metro לאפליקציה (Development Build) |
| `npm run android:reverse` | מפנה את פורטים 2567 ו־8081 מהטלפון או מהאמולטור למחשב |
| `npm run puzzles:import` | מייבא את `assets/puzzles/sudoku-bank-690.csv` אל `packages/engine/data/puzzles.json`, ומדפיס דוח |
| `npm run puzzles:generate -- --type hard --count 300` | מחולל לוחות. אפשר גם `--pool ranked` ו־`--seed 42` |
| `npm run licenses` | רישיונות של חבילות ה־Production באפליקציה ובשרת: כותב את `docs/store/LICENSES-REPORT.md` ואת הרשימה שמסך "רישיונות" מציג. מריצים אחרי כל שינוי בתלויות (`-- --check` רק בודק) |

## להריץ את האפליקציה בטלפון Android (Development Build)

האפליקציה דורשת Development Build, לא Expo Go (בגלל Firebase, ‏Skia ו־Colyseus).

1. **מקום בדיסק:** בנייה מקומית צריכה כמה GB. בונים ארכיטקטורה אחת, של הטלפון:
   ```
   cd apps/mobile
   npx expo prebuild --platform android
   cd android
   ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
   ```
   או בענן: `npx eas build --profile development --platform android`.
2. **התקנה:** מחברים את הטלפון ב־USB (עם USB debugging), ומריצים
   `adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
3. **שרת:** `npm run server`.
4. **חיבור:** `npm run android:reverse` (כך `localhost` בטלפון מגיע למחשב), ואז `npm run mobile` ופותחים את האפליקציה.
   בלי כבל: `npm run dev:lan` במקום `npm run server` (הסעיף הבא).
5. במסך "שלום" צריך לראות: "משבצת D5" (מה־engine), עיגול Skia, כפתור שקופץ (Reanimated), ו־"server RTT … ms".

### טלפונים ב־Wi-Fi: `npm run dev:lan`

לבדיקות בטלפונים בלי כבל, מהשורש:

```
npm run dev:lan -- --write-env    # הכתובת, המאגר המדורג, השרת, ו־apps/mobile/.env.local
npm run mobile -- --clear         # בחלון שני: Metro, אחרי כל שינוי ב־.env.local
```

- **מה הוא עושה:** מוצא את כתובת ה־IPv4 של ה־Wi-Fi או ה־Ethernet (לא WSL, מכונה וירטואלית או VPN), טוען את המאגר המדורג אם חסר, ומפעיל את `npm run server`.
  כשהשרת עונה, הוא מדפיס את הכתובת, את שלוש השורות ל־`apps/mobile/.env.local`, את אתר הניהול והסיסמה, פקודות ל־Windows Firewall ופקודות ל־`fake-client`.
- **אפשרויות:** ‏`--write-env` כותב את השורות ל־`.env.local` (הקובץ ב־gitignore). ‏`--ip 192.168.1.20` בוחר כתובת אחרת. ‏`--seed` מוסיף נתוני דוגמה לאתר הניהול.
  ‏`--no-server` רק מדפיס, כשהשרת כבר רץ בחלון אחר.
- **בדיקה מהטלפון:** פותחים בדפדפן של הטלפון את `http://<הכתובת>:2567/health`. אם אין תשובה, זה כמעט תמיד ה־Firewall: הפקודות המודפסות (PowerShell כמנהל) פותחות את הפורט רק ברשתות פרטיות. הסקריפט לא מריץ אותן בעצמו.
- עוצרים עם Ctrl+C: השרת נסגר, ותיקיית ה־PGlite משתחררת.

### חשבונות באפליקציה (שלב 8)

- **Firebase:** שמים את `google-services.json` ואת `GoogleService-Info.plist` של הפרויקט "Sudoku Fight" בתיקייה `apps/mobile/config/firebase/` (היא ב־gitignore), ובונים Development Build חדש.
  **המדריך המלא, צעד אחר צעד (קונסול, EAS, Crashlytics, מיילים בעברית, השרת ובדיקה): [`docs/FIREBASE-SETUP.md`](docs/FIREBASE-SETUP.md).**
  אין צורך לשנות קוד: `app.config.ts` מוסיף את Firebase רק כשהקבצים קיימים, והאפליקציה עוברת אליו לבד.
- **בלי הקבצים (מצב פיתוח):** חשבונות מקומיים בטלפון בלבד, עם התג "מצב פיתוח" בכל מסכי החשבון. לא נשלח מייל: "אימתתי" מסמן את המייל כמאומת.
  האפליקציה שולחת `dev:<uid>:<email>`, ושרת בייצור דוחה את זה.
- **אימות מייל [D22]:** נשלח בהרשמה, אבל לא חוסם התחברות או אימון. במסך הבית יש באנר עד שהמייל מאומת. משחק מדורג (שלב 9) ידרוש מייל מאומת: `accountConfig.verification` ב־`apps/mobile/src/config/account.ts`.
- **מחיקת חשבון:** סיסמה (reauthenticate), אחר כך `DELETE /v1/me` בשרת, ורק אז מחיקת המשתמש ב־Firebase. כך כישלון באמצע אף פעם לא משאיר בשרת פרופיל, שם ומייל בלי דרך להיכנס ולמחוק אותם. הפירוט ב־`deleteAccount` (`apps/mobile/src/auth/authStore.ts`).
- **אופליין:** אחרי ההתחברות הראשונה הפרופיל נשמר בטלפון, והאפליקציה נפתחת עליו גם בלי רשת (D24 לא אושרה: ההרשמה חובה, והאימון זמין גם אופליין).
- **תנאי השימוש ומדיניות הפרטיות (שלב 14):** הקישורים בהרשמה ובהגדרות ("מידע ומשפטי") פותחים את הדפים שהשרת מגיש ב־`/legal/privacy`, ‏`/legal/terms` ו־`/legal/delete-account`, בשפת האפליקציה (`apps/mobile/src/config/legal.ts`). `EXPO_PUBLIC_LEGAL_BASE_URL` מפנה אותם לאתר אחר. הטקסטים: `apps/server/src/legal`. בהגדרות יש גם מסך "רישיונות".

## השרת

- פיתוח: `npm run server`. ‏`GET http://localhost:2567/health` מחזיר את גרסאות ה־engine וה־protocol.
- ייצור: `npm run build -w @sudoku-fight/server` יוצר `apps/server/dist/index.cjs` (esbuild, עם ה־engine בפנים),
  ו־`npm run start:prod -w @sudoku-fight/server` מריץ אותו.
  ‏Colyseus, ‏Express, ‏PGlite ו־Sentry נשארים מחוץ לקובץ ונטענים מ־`node_modules`. ‏drizzle ו־postgres נמצאים בתוכו.
- **Sentry (שלב 14):** רק כש־`SENTRY_DSN` מוגדר. בלי מידע אישי, ובלי השפעה על השרת כש־Sentry לא זמין. הפירוט ב־`apps/server/src/monitoring/sentry.ts` וב־[`docs/DEPLOY-PRODUCTION.md`](docs/DEPLOY-PRODUCTION.md) סעיפים 3 ו־10.

### חשבונות (שלב 8)

- הנתיבים: `GET /v1/names/available?name=`, ‏`POST /v1/users`, ‏`GET`/`PATCH`/`DELETE /v1/me`.
  החוזה המלא, עם כל התשובות וקודי השגיאה, נמצא ב־`packages/protocol/src/account.ts`.
- כל קריאה מגיעה עם `Authorization: Bearer <Firebase ID token>`. השרת בודק את החתימה מול המפתחות הציבוריים של Google,
  לפי `FIREBASE_PROJECT_ID`. לא צריך service account או קובץ סודי.
- **בלי Firebase (פיתוח בלבד):** האפליקציה שולחת `dev:<uid>` (או `dev:<uid>:<email>`), והשרת מקבל את זה רק כש־`NODE_ENV` אינו `production`.
- רשימת המילים האסורות בשמות: `apps/server/data/blocked-words.json`. זו רשימה התחלתית, ואפשר להוסיף לה. ההסבר בתוך הקובץ.
- **חדרי משחק:** הלקוח שולח את ה־ID token ב־`client.auth.token` של ה־SDK, ולא באפשרויות ההצטרפות. החדר מזהה את השחקן לפי `users.id` והשם שבחשבון.
  בפיתוח, הצטרפות בלי token עדיין עובדת עם זהות פיתוח (`devUserId`, ‏`name`), בשביל ה־fake client.
- **אירועי שימוש:** כשמחוברים, כל קבוצת אירועים נשלחת עם ה־token, והשרת מקשר אותה לחשבון. אם ה־token לא מגיע תוך 2 שניות, הקבוצה נשלחת בלעדיו.
- **מחיקת חשבון:** ‏`DELETE /v1/me` דורש התחברות טרייה: ה־`auth_time` של ה־token לפני 5 דקות לכל היותר (`ACCOUNT_DELETE_MAX_AUTH_AGE_MS`).
  אחרת התשובה היא 401 `reauthRequired`: האפליקציה מבקשת שוב את הסיסמה, ושולחת token חדש (`getIdToken(true)`). רענון של ה־token לבד לא עוזר.
  ל־token פיתוח אין `auth_time`, והוא עובר רק מחוץ ל־production.
- החוזה בין האפליקציה לשרת נבדק מקצה לקצה ב־`apps/server/test/appAccounts.contract.test.ts`, עם ה־API client של האפליקציה עצמה.

```
curl 'http://localhost:2567/v1/names/available?name=Moshe'
curl -H 'authorization: Bearer dev:moshe:moshe@example.com' -H 'content-type: application/json'   -d '{"displayName":"Moshe","avatarId":"av07","country":"IL"}' http://localhost:2567/v1/users
curl -H 'authorization: Bearer dev:moshe' http://localhost:2567/v1/me
```

### Matchmaking (שלב 9)

- הלקוח מתחבר לחדר `matchmaking` עם `{ queueKey: 'fast-2p' }` ועם ה־token. רק חשבונות רשומים, ובלי זהות פיתוח.
  כל התורים פתוחים: 2, 3 ו־4 שחקנים, מ־`fast-2p` עד `hard-4p` (שלב 10). באפליקציה, השולחנות שמוצגים במסך "משחק חדש" הם `RANKED_TABLES_OPEN` ב־`apps/mobile/src/screens/home/homeModel.ts`.
- ההודעות, הזמנים (טווח D6, ‏60 ש׳ עד Match-Timeout, ‏10 ש׳ לבדיקת מוכנות, ספירה של 3 ש׳) והזרימה המלאה: `packages/protocol/src/matchmaking.ts`.
- החוקים (טווח הדדי, הימנעות מיריבים חוזרים, איפוס ב־80%, הוגנות): `apps/server/src/matchmaking/matcher.ts`.
- כשנמצאה התאמה, השרת פותח חדר `game` מדורג ושומר מושב לכל שחקן. מי שלא מתחבר תוך 10 שניות לא מדורג (עדיין אין משחק),
  והאחרים חוזרים לראש התור. אחרי שכולם מחוברים, יציאה היא נטישה (D32).
- **ניתוק בספירה לאחור:** המושב נשמר כמו במשחק (D32). המשחק מתחיל ב־GO בלי השחקן, ה־grace שלו רץ מאז, והוא חוזר עם ה־reconnection token.
- **משחק מדורג אחד בכל פעם:** חשבון שכבר מחפש, או שהמשחק המדורג שלו עוד לא נגמר ונשמר, מקבל `alreadyQueued`.
- **הפעלה מחדש של השרת:** משחק שרץ כשהשרת נעצר אובד, כי הוא חי בזיכרון של החדר. בהפעלה הבאה, לפני שהשרת מקבל חיבורים,
  השורה שלו ב־`games` נסגרת עם `end_reason = 'serverRestart'`, בלי מקום ובלי שינוי דירוג. זה מניח תהליך שרת אחד לכל מסד נתונים (מכונה אחת ב־Fly.io).

### היסטוריה ו־Replay (שלב 11)

- `GET /v1/me/games?cursor=`: המשחקים של החשבון שנגמרו, מהחדש לישן, 20 בכל עמוד. `nextCursor` מבקש את העמוד הבא.
- `GET /v1/games/:id/replay`: המשחק ויומן האירועים המלא שלו, כולל הפתרון. רק למי ששיחק בו, ורק אחרי שנגמר (409 `notFinished` לפני כן).
  למי שלא שיחק בו התשובה היא 404, כמו למשחק שלא קיים.
- החוזה: `packages/protocol/src/history.ts`. האפליקציה ממזגת את המשחקים האלה עם האימונים שבמכשיר, ובונה את ה־Replay עם `replay()` של המנוע.

```
curl -H 'authorization: Bearer dev:moshe' http://localhost:2567/v1/me/games
curl -H 'authorization: Bearer dev:moshe' http://localhost:2567/v1/games/<id>/replay
```

### טבלת מובילים, כרטיס שחקן ו־XP (שלב 12)

- `GET /v1/leaderboard?tab=general|fast|normal|hard|friends&players=2|3|4&cursor=`: 50 בכל עמוד. דירוג שווה מקבל אותו מקום, והשורה שלי (`me`) מגיעה בכל עמוד.
  `players` נקרא רק באפשרות A (ברירת מחדל 2). בלשונית `friends` יש יריבים אחרונים וקישור ההזמנה (`INVITE_URL`).
- `GET /v1/players/:id`: כרטיס שחקן, רק נתונים ציבוריים. חשבון שנמחק מחזיר 404.
- `GET /v1/me/progress`: ה־XP, הרמה והליגה שלי.
- `POST /v1/me/practice-results`: תוצאות אימון מהטלפון (D41), עד 50 בכל בקשה. כל תוצאה נספרת פעם אחת, וה־XP של אימון מוגבל ביום (`PRACTICE_XP_DAILY_CAP`, ברירת מחדל 1500).
- ה־XP של משחק מדורג נכתב בסוף המשחק, באותה טרנזקציה של הדירוג.
- החוזה: `packages/protocol/src/progress.ts`. הקוד: `apps/server/src/progress`. ההישגים ממתינים לאישור: `docs/ACHIEVEMENTS-PROPOSAL.md`.

```
curl -H 'authorization: Bearer dev:moshe' 'http://localhost:2567/v1/leaderboard?tab=normal'
```

### לשחק מול לקוח מזויף (fake-client)

`apps/server/scripts/fake-client.ts` הוא שחקן שרץ ב־Node ומשחק דרך השרת כמו בוט: זמני חשיבה לפי הרמה וסוג המשחק, טעויות סבירות, תגובות והפרעות.
הוא פותר את הלוח בעצמו מהרמזים, כי השרת לא שולח את הפתרון באמצע משחק. הוא גם מודד RTT עם ping ו־pong.
בסוף הוא מדפיס סיכום: מקום, ניקוד, טעויות, ‏RTT ב־p50 וב־p95, וכמה זמן לקח לחזור לסנכרון אחרי ניתוק.

בחדר עם קוד הוא נכנס עם זהות פיתוח (`devUserId`, בלי token), ולכן הוא עובד רק מול שרת פיתוח. שרת ייצור דוחה אותה.

```
npm run server                                                # חלון 1: השרת בפורט 2567
npm run fake-client -- --create --name Fake1                  # חלון 2: יוצר חדר ומדפיס את הקוד שלו
npm run fake-client -- --code ABC123 --name Fake2 --level 4   # חלון 3: מצטרף לחדר עם הקוד
```

**משחק מדורג (שלב 9):** ‏`--queue` נכנס עם חשבון ומחפש יריב בתור, כמו האפליקציה.

```
npm run db:seed-puzzles                                       # פעם אחת, כשהשרת עצור: מאגר הלוחות המדורגים
npm run fake-client -- --queue fast-2p --name Ana --speed 20  # חלון 2
npm run fake-client -- --queue fast-2p --name Ben --speed 20  # חלון 3: הם מוצאים זה את זה ומשחקים
```

- **החשבון:** ה־token הוא token פיתוח `dev:<id>` (ברירת המחדל של `--id` היא `fake-<name>`), או token אמיתי עם `--token`.
  בפעם הראשונה הוא נרשם ב־`POST /v1/users`, עם `--name`, ‏`--avatar av07` ו־`--country IL`.
- **מה הוא עושה:** מחפש, מתחבר לחדר כשנמצא יריב (D37: זה ה"מוכן"), סופר 3-2-1 ומשחק.
  בסוף הוא מדפיס את ההתאמה (היריב, זמן החיפוש והטווחים), את הדירוג לפי התוצאה, ואת הדירוג השמור לפני המשחק ואחריו (`GET /v1/me`).
- ‏`--keep-searching`: אחרי Match-Timeout (60 שניות) ממשיך לחפש, בלי תקרה לטווח.
- ‏`--no-show`: אחרי "נמצאו" לא מתחבר לחדר. ההתאמה מתבטלת, והשני חוזר לראש התור.
- ‏`--drop-in-countdown 2`: מתנתק בספירה לאחור, וחוזר אחרי 2 שניות.

**3–4 שחקנים (שלב 10):** התורים `fast-3p` עד `hard-4p` פתוחים. משחק מתחיל רק כשהקבוצה מלאה.

```
npm run fake-client -- --queue fast-4p --name Cyd --speed 20   # שני לקוחות כאלה ושני טלפונים בתור fast-4p
npm run fake-client -- --create --rated --players 4 --game-type normal --name Ana   # חדר פרטי מדורג ל־4
npm run fake-client -- --code ABC123 --account --name Ben       # מצטרף לחדר המדורג עם חשבון
```

- ‏`--account`: עם `--code` או `--create`, נכנס לחדר עם חשבון (ה־token), ולא עם זהות פיתוח. ‏`--token`, ‏`--avatar` ו־`--country` כמו ב־`--queue`.
- ‏`--rated` (עם `--create`): חדר מדורג. הלוח מהמאגר המדורג, הדירוג משתנה והמשחק נשמר. כל השחקנים צריכים `--account`.

- **מול האפליקציה:** יוצרים חדר עם `--create`, ומצטרפים אליו מהטלפון עם הקוד שהודפס. המשחק מתחיל כשכל השחקנים בפנים.
- **רמה ומהירות:** ‏`--level 1` עד `5` לפי טבלת הבוטים (ברירת המחדל 3). ‏`--speed 10` חושב פי 10 מהר מאדם.
  גם במהירות גבוהה הוא לא עובר את הגבלת הקצב של השרת.
- **תקלות לפי הזמנה** (בשניות מתחילת המשחק):
  - `--drop-after 10 --drop-for 5`: מנתק את החיבור וחוזר אחרי 5 שניות, עם ה־reconnection token.
  - `--leave-after 10`: יוצא ולא חוזר. אחרי ה־grace זו נטישה, והיריב מנצח.
  - `--surrender-after 10`: נכנע.
- **הגדרות לחדר** (רק עם `--create`): ‏`--game-type hard`, ‏`--players 3`, ‏`--grace 5`,
  ו־`--rules '{"thinkTimeMs":5000}'` לשאר הכללים שמותר לשנות בפיתוח.
- **‏200 דגימות RTT** (תנאי הסיום של שלב 7): ‏`--ping-every 500` במשחק של כשלוש דקות.
- **שרת אחר:** ‏`--url ws://192.168.1.20:2567`, או `wss://` מול שרת עם TLS.
- `--help` מציג את כל האפשרויות. ‏`--json` מדפיס את הסיכום כשורת JSON, ו־`--verbose` מדפיס גם כל מהלך.
- קוד היציאה: 0 כשהמשחק נגמר, כשיצא בכוונה, כשחיפוש בודד הגיע ל־Match-Timeout, או כשההתאמה בוטלה בגלל `--no-show`.
  ‏1 כשמשהו נכשל, ו־2 כשהארגומנטים שגויים.

הבדיקות שלו: ‏`apps/server/test/realtime.e2e.test.ts` מריץ את השרת האמיתי עם שני לקוחות מזויפים.
הן בודקות משחק מלא, ניתוק של שנייה וחזרה לסנכרון תוך 2 שניות, ניתוק שהרשת יוזמת, נטישה, ואת שורת הפקודה עצמה.

‏`apps/server/test/ranked.e2e.test.ts` בודק את תנאי הסיום של שלב 9 עם לקוחות מזויפים ב־`--queue`, בזמנים מקוצרים:
שני שחקנים מוצאים זה את זה, משחקים, והדירוג במסד משתנה בדיוק לפי הנוסחה; הטווח מתרחב כל 5 שניות; יריבים חדשים מקבלים עדיפות;
Match-Timeout אחרי 60 שניות; ‏no-show; אותו זוג מקבל לוח אחר; ניתוק בספירה לאחור; הפעלה מחדש של השרת; ובאפשרות A מתעדכן `normal-2p` ולא `normal`.

‏`apps/server/test/fourPlayers.e2e.test.ts` בודק את תנאי הסיום של שלב 10:
- **חדר מדורג של 4 לקוחות מזויפים:** אחד נכנע (D36), ואחד יוצא ולא חוזר (נטישה בסוף ה־grace). המיקום מלא: שני הפעילים לפי הניקוד, ואחריהם מי שיצאו לפי סדר היציאה.
  מי שיצא ראשון אחרון. ברגע הנטישה נחשב סוף ה־grace. המשבצות של מי שנכנע נשארות בצבע שלו, והדירוג במסד משתנה בדיוק לפי Elo זוגי ל־4 (‏`K_pair = 32/3`, כפול בדירוג זמני).
- **משחק של 3 דרך התור `fast-3p`:** שלושה לקוחות `--queue` נמצאים, משחקים, והדירוג במסד הוא של המנוע ל־3 שחקנים.

## אתר הניהול

אתר לצפייה בלבד: התקנות, משתמשים, משחקים ומסכים (אפיון, סעיף 27). השרת מגיש אותו ב־`/admin`, וה־API שלו נמצא ב־`/admin/api`.

### להריץ מקומית עם נתוני דוגמה

מהשורש, לפי הסדר:

```
npm run seed            # נתוני דוגמה: 300 התקנות, 80 משתמשים, 150 משחקים מדורגים (פעם אחת מספיקה)
npm run admin:build     # בונה את האתר ל־apps/admin/dist (פעם אחת, ושוב אחרי כל שינוי באתר)
npm run server          # השרת בפורט 2567
```

ואז פותחים את http://localhost:2567/admin ונכנסים עם סיסמת הפיתוח **`sudoku-admin-dev`**. עוצרים את השרת עם Ctrl+C.

- **נתוני הדוגמה** נשמרים ב־`apps/server/.data/pglite`, שלא נכנס ל־git. ‏`npm run seed -- --reset` מוחק אותם ויוצר חדשים, למשל כדי ש"היום" יהיה היום.
  ‏`rm -rf apps/server/.data` מפנה כ־70MB, והתיקייה נוצרת מחדש בהפעלה הבאה.
- **פיתוח של האתר עצמו:** ‏`npm run server` בחלון אחד ו־`npm run admin:dev` בחלון שני. פותחים את http://localhost:5174/admin/, והשינויים מופיעים מיד.
- **את `npm run seed` מריצים כשהשרת עצור.** תיקיית PGlite פתוחה לתהליך אחד בלבד. אם השרת רץ, ה־seed מסרב ואומר מי מחזיק אותה.

### בדיקה מהירה עם curl (ב־Git Bash, כשהשרת רץ)

```
curl http://localhost:2567/health
curl -c jar.txt -H 'content-type: application/json' -d '{"password":"sudoku-admin-dev"}' http://localhost:2567/admin/api/login
curl -b jar.txt 'http://localhost:2567/admin/api/overview?days=7'
curl -b jar.txt 'http://localhost:2567/admin/api/screens?days=30'
```

הכניסה מחזירה 204. בלי ה־cookie, כל נתיב ב־`/admin/api` מחזיר 401. ב־PowerShell ‏`curl` הוא כינוי ל־`Invoke-WebRequest`, ולכן עדיף Git Bash.

### בייצור: מה חייבים להגדיר

הסודות נכנסים להגדרות של השרת (ב־Fly.io: `fly secrets set`), ולא לקובץ ב־git. כל הערכים מוסברים ב־`apps/server/.env.example`.
ב־Fly.io, ‏`NODE_ENV` ו־`TRUST_PROXY` כבר נמצאים ב־`fly.toml`, כי הם לא סודות (ראו "פריסה ל־Fly.io" למטה).

| משתנה | מה | בלעדיו |
|---|---|---|
| `NODE_ENV=production` | מצב ייצור: cookie עם Secure, ובלי סיסמת הפיתוח | השרת חושב שהוא בפיתוח |
| `DATABASE_URL` | ‏`postgres://…` של מסד Postgres | השרת לא עולה |
| `ADMIN_PASSWORD` | הסיסמה לאתר הניהול: לפחות 12 תווים, ולא `sudoku-admin-dev` | האתר כבוי (503) |
| `ADMIN_SESSION_SECRET` | לפחות 32 תווים אקראיים: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | כל הפעלה מחדש מוציאה את המנהל |
| `TRUST_PROXY=1` | ב־Fly.io יש proxy אחד לפני השרת. **לא `true`.** | כל המשתמשים נספרים ככתובת אחת, והגבלת הקצב חוסמת אותם |
| `FIREBASE_PROJECT_ID` | ה־Project ID של Firebase (לא סוד) | החשבונות כבויים (503 `disabled`), ואירועי השימוש נשמרים בלי משתמש |
| `LEGAL_CONTACT_EMAIL`, ‏`LEGAL_OPERATOR_NAME` | פרטי הקשר ושם המפעיל בדפים המשפטיים `/legal/…` (שלב 14). לא המייל הפרטי של משה בלי אישורו | הדפים מציגים placeholder אדום ופס "טיוטה". אסור לתת את הכתובות לחנויות כך |
| `SENTRY_DSN` | דיווחי שגיאות ל־Sentry (שלב 14). ‏`SENTRY_ENVIRONMENT` ב־`fly.toml` אומר אם זה staging או production | אין דיווחי שגיאות, רק הלוג |

האתר עובד רק ב־HTTPS בייצור, כי ה־cookie מסומן Secure.

### תקלות נפוצות

- **"The PGlite folder … is open in another process"**: שרת אחר או `npm run seed` מחזיקים את התיקייה. עוצרים אותם.
  אם אין תהליך כזה, מוחקים את `apps/server/.data/pglite.lock`.
- **`EADDRINUSE :::2567`**: שרת אחר כבר רץ בפורט 2567. עוצרים אותו.
- **‏"The admin site is not built"**: מריצים `npm run admin:build`, ואחר כך מפעילים מחדש את השרת.
- **‏503 `disabled`**: אין `ADMIN_PASSWORD`, היא קצרה מ־12 תווים, או שהיא סיסמת הפיתוח בייצור. הסיבה מודפסת בהפעלת השרת.

### בדיקות

```
npx jest --selectProjects server protocol admin
```

הבדיקה המלאה, מהאפליקציה עד האתר, נמצאת ב־`apps/server/test/adminSite.e2e.test.ts`. היא מריצה את השרת האמיתי, שולחת קבוצת אירועים, נכנסת עם הסיסמה וקוראת את הסקירה, ההתקנות והמסכים.
החלק של האתר רץ רק אחרי `npm run admin:build`. בלי זה הוא מדולג, עם הודעה.

## פריסה ל־Fly.io (Staging)

השרת רץ ב־Fly.io על **מכונה אחת באזור `fra`** (פרנקפורט). ההגדרות נמצאות ב־`fly.toml`, והאימג' נבנה מה־`Dockerfile` שבשורש.
המסד הוא Postgres ב־Neon (אפיון, סעיף 17.1), גם הוא בפרנקפורט.

**למה מכונה אחת בדיוק:** ‏Colyseus מחזיק את החדרים ואת ה־Matchmaking בזיכרון של התהליך, ולכן שתי מכונות הן שני עולמות נפרדים.
מכאן ה־`--ha=false` בכל `fly deploy`. אף פעם לא `fly scale count 2`.

**מה עובד ב־Staging עד שלב 8:** ‏`/health`, ‏`POST /v1/events`, אתר הניהול וחדר ה־echo.
הצטרפות למשחק: במצב ייצור השרת מקבל רק ID token של חשבון Firebase חי (שלב 8), ורק כש־`FIREBASE_PROJECT_ID` מוגדר. זהות פיתוח ו־`dev:<uid>` נדחים.
הלוחות כבר מוכנים: בייצור השרת לוקח לוחות רק מהמאגר המדורג, ויש בו 2000 לוחות לכל סוג משחק (`packages/engine/data/puzzles.json`).

### הקמה (פעם אחת)

מהשורש, ב־Git Bash. רק ההתקנה של flyctl נעשית ב־PowerShell.

1. **flyctl:** ב־PowerShell מריצים `iwr https://fly.io/install.ps1 -useb | iex`, ואז פותחים חלון חדש.
2. **כניסה:** `fly auth login`. נפתח דפדפן.
3. **האפליקציה, בלי פריסה:**
   ```
   fly apps create sudoku-fight-staging
   ```
   - אם השם תפוס, בוחרים שם אחר ומעדכנים את `app` ב־`fly.toml`. הכתובת תהיה `https://<השם>.fly.dev`.
   - לא משתמשים ב־`fly launch`: הוא כותב `fly.toml` משלו ומציע מסד ושתי מכונות. ה־`fly.toml` כאן כבר מוכן.
4. **מסד הנתונים (Neon):**
   - ב־https://console.neon.tech יוצרים פרויקט `sudoku-fight-staging` באזור **AWS Europe Central 1 (Frankfurt)**.
   - ב־"Connect" מכבים את **Connection pooling**, ומעתיקים את ה־connection string. הוא מתחיל ב־`postgresql://` ונגמר ב־`?sslmode=require`.
   - את הטבלאות לא יוצרים ידנית: השרת מריץ את המיגרציות (`apps/server/drizzle`) בכל הפעלה.
5. **הסודות:**
   ```
   ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
   echo "$ADMIN_PASSWORD"
   fly secrets set --stage \
     DATABASE_URL='postgresql://…?sslmode=require' \
     ADMIN_PASSWORD="$ADMIN_PASSWORD" \
     ADMIN_SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
   fly secrets list
   ```
   - את הסיסמה שמודפסת שומרים במנהל הסיסמאות. איתה נכנסים לאתר הניהול.
   - את `DATABASE_URL` מדביקים מ־Neon, בתוך גרשיים בודדים.
   - ‏`NODE_ENV=production` ו־`TRUST_PROXY=1` לא נכנסים לסודות: הם כבר ב־`[env]` של `fly.toml`.
     הטבלה "בייצור: מה חייבים להגדיר" למעלה מסבירה כל ערך.

**במקום Neon, ‏Postgres של Fly:** אחרי שלב 3 מריצים את שתי הפקודות האלה, ומדלגים על `DATABASE_URL` בשלב 5. ה־`attach` מגדיר אותו לבד.

```
fly postgres create --name sudoku-fight-staging-db --region fra --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
fly postgres attach sudoku-fight-staging-db --app sudoku-fight-staging
```

### פריסה

```
fly deploy --ha=false
```

- הבנייה רצה בשרת הבנייה של Fly, ולכן לא צריך Docker במחשב. בפעם הראשונה זה לוקח כמה דקות.
- בלי `--ha=false`, הפריסה הראשונה יוצרת שתי מכונות.
- כל פריסה מחליפה את המכונה, ומשחקים שרצים באותו רגע מתנתקים. ב־Staging זה בסדר.

### בדיקה אחרי פריסה

```
fly status
fly logs
curl https://sudoku-fight-staging.fly.dev/health
```

- ב־`fly status`: מכונה אחת במצב `started`, והבדיקה של `/health` במצב `passing`.
- ב־`fly logs`: ‏`[server] production, database Postgres, admin site on`.
- ‏`/health` מחזיר `{"ok":true,"engine":"…","protocol":…}`.
- אתר הניהול: https://sudoku-fight-staging.fly.dev/admin, עם ה־`ADMIN_PASSWORD` משלב 5.
  אם מתקבל 503 `disabled`, הסיבה מודפסת ב־`fly logs`.

### לחבר את האפליקציה לשרת

ב־`apps/mobile/.env.local`:

```
EXPO_PUBLIC_SERVER_HOST=sudoku-fight-staging.fly.dev
EXPO_PUBLIC_SERVER_PORT=443
EXPO_PUBLIC_SERVER_SECURE=true
```

- משתני `EXPO_PUBLIC_*` נכנסים לקוד כש־Metro בונה אותו. לכן מפעילים מחדש עם ניקוי: `cd apps/mobile && npx expo start --clear`.
- לא צריך `adb reverse` ולא כבל: הטלפון מגיע לשרת דרך האינטרנט.
- בבנייה ב־EAS, אותם שלושה ערכים נכנסים ל־`env` של הפרופיל ב־`eas.json`.

### פקודות שימושיות

| פקודה | מה היא עושה |
|---|---|
| `fly deploy --ha=false` | פורסת את הקוד הנוכחי |
| `fly logs` | לוגים בזמן אמת |
| `fly status` | מצב המכונה והבדיקות |
| `fly secrets set ADMIN_PASSWORD=…` | מחליפה סוד. המכונה עולה מחדש |
| `fly ssh console` | פותחת מעטפת בתוך המכונה |
| `fly scale count 1` | מתקנת, אם נוצרה בטעות מכונה שנייה |

### מה יש באימג'

- **בסיס:** ‏`node:24-slim`, והשרת רץ כמשתמש `node` (לא root).
- **בפנים:** ‏`apps/server/dist/index.cjs`, המיגרציות, אתר הניהול (נבנה בתוך האימג'), מאגר הלוחות, ו־`node_modules` של הייצור בלבד (כ־95 חבילות).
- **מה לא נכנס:** ‏`apps/mobile`, ‏`.env`, ‏`.data`, קובצי Firebase ו־keystore. ‏`.dockerignore` היא רשימה של מה **כן** נכנס, וכל השאר בחוץ.
- **הגודל המשוער:** כ־300MB לא דחוס, וכ־100MB דחוס.
- **בדיקה בלי Docker:** ‏`apps/server/test/deploy.test.ts` משווה את ה־`Dockerfile`, את ה־`.dockerignore` ואת ה־`fly.toml` לקוד.

לבנות ולהריץ מקומית (לא חובה, ודורש Docker ומקום בדיסק):

```
docker build -t sudoku-fight-server .
docker run --rm -p 2567:2567 -e PGLITE_DIR=memory -e ADMIN_PASSWORD=local-docker-check sudoku-fight-server
```

בלי `DATABASE_URL`, ‏`PGLITE_DIR=memory` מריץ את המסד בזיכרון, ושום דבר לא נשמר. ‏`ADMIN_PASSWORD` צריכה לפחות 12 תווים.
