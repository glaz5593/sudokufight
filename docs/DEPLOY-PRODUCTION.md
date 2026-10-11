# פריסת שרת ה־Production ב־Fly.io (שלב 14)

המדריך הזה מקים את שרת המשחק שבודקי הבטא וגרסת החנות מתחברים אליו. הוא **אפליקציה נפרדת** מה־Staging:
מסד נתונים משלה, סודות משלה וכתובת משלה. האימג' הוא אותו אימג' (`Dockerfile`), וההגדרות ב־`fly.production.toml`.

| | Staging | Production |
|---|---|---|
| קובץ ההגדרות | `fly.toml` | `fly.production.toml` |
| שם האפליקציה ב־Fly | `sudoku-fight-staging` | `sudoku-fight-prod` |
| הכתובת | `https://sudoku-fight-staging.fly.dev` | `https://sudoku-fight-prod.fly.dev` |
| מי מתחבר | בניות `preview` (APK פנימי) | בניות `production` (TestFlight, ‏Play והחנויות) |
| `SENTRY_ENVIRONMENT` | `staging` | `production` |

ההקמה של Staging, ‏flyctl ו־Neon מוסברת ב־README ("פריסה ל־Fly.io (Staging)"). כאן רק מה ששונה או נוסף.
כל הפקודות מהשורש של הריפו, ב־Git Bash.

**מכונה אחת בדיוק, באזור `fra`.** ‏Colyseus מחזיק את החדרים ואת ה־Matchmaking בזיכרון של התהליך, ולכן שתי מכונות הן שני עולמות נפרדים.
בכל `fly deploy` יש `--ha=false`, ואף פעם לא `fly scale count 2`. כשצריך יותר כוח, מגדילים את המכונה (סעיף 10).

---

## 0. מה צריך לפני (משה)

- [ ] ‏flyctl מותקן, ו־`fly auth login` עם החשבון שלך.
- [ ] Firebase מוכן לפי [`docs/FIREBASE-SETUP.md`](FIREBASE-SETUP.md), כולל Analytics (סעיף 8א שם). צריך את ה־Project ID.
- [ ] חשבון Sentry (‏sentry.io, התוכנית החינמית מספיקה לבטא).
- [ ] חשבון Neon, או ההחלטה להשתמש ב־Postgres של Fly (סעיף 2).
- [ ] הוחלט אם יש דומיין משלך לשרת (למשל `api.<הדומיין>`). **כדאי להחליט לפני הבנייה הראשונה לחנות**: הכתובת נכנסת לתוך האפליקציה בזמן הבנייה, ושינוי שלה דורש גרסה חדשה בחנויות (סעיף 11).

## 1. האפליקציה ב־Fly

```
fly apps create sudoku-fight-prod
```

- אם השם תפוס: בוחרים שם אחר, ומעדכנים אותו **בשני מקומות**: `app` ב־`fly.production.toml`, ו־`EXPO_PUBLIC_SERVER_HOST` בפרופיל `production` של `apps/mobile/eas.json`.
- לא משתמשים ב־`fly launch`. הוא כותב `fly.toml` משלו, ודורס את של ה־Staging.

## 2. מסד הנתונים: Postgres עם גיבויים

**המלצה: Neon**, כמו ב־Staging, אבל **פרויקט נפרד**.

1. ב־https://console.neon.tech יוצרים פרויקט `sudoku-fight-prod`, באזור **AWS Europe Central 1 (Frankfurt)**.
2. ב־"Connect" מכבים את **Connection pooling**, ומעתיקים את ה־connection string. הוא מתחיל ב־`postgresql://` ונגמר ב־`?sslmode=require`.
   ‏Neon מוסיף היום בסוף גם `&channel_binding=require`: מוחקים את החלק הזה (ה־driver שלנו, postgres.js, לא משתמש בו, ושולח למסד כל פרמטר שהוא לא מכיר כהגדרה).
3. **גיבויים:** ב־Neon יש שחזור לנקודת זמן (Point-in-time restore). בתוכנית החינמית חלון השחזור קצר.
   לפני ההשקה כדאי לעבור לתוכנית בתשלום עם חלון של כמה ימים. לבדוק את המספרים העדכניים בדף התמחור של Neon.
4. גיבוי ידני (מומלץ לפני כל פריסה עם מיגרציה חדשה, ופעם בשבוע בבטא). צריך `pg_dump` במחשב, בגרסה של השרת או חדשה ממנו:
   ```
   pg_dump --format=custom --file=backup-$(date +%Y%m%d).dump 'postgresql://…?sslmode=require'
   ```
   את הקובץ שומרים מחוץ לריפו. יש בו מיילים של שחקנים.

את הטבלאות לא יוצרים ידנית: השרת מריץ את המיגרציות (`apps/server/drizzle`) בכל הפעלה, לפני שהוא מקבל חיבורים.

**במקום Neon, ‏Postgres של Fly:**

```
fly postgres create --name sudoku-fight-prod-db --region fra --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
fly postgres attach sudoku-fight-prod-db --app sudoku-fight-prod
```

- ה־`attach` מגדיר את `DATABASE_URL` לבד, ומדפיס אותו **פעם אחת**. שומרים אותו במנהל הסיסמאות.
- הגיבוי שם הוא snapshot יומי של ה־volume (`fly volumes snapshots list`). זה מסד שאתה מנהל בעצמך, ולכן Neon עדיף.
- **מדיניות הפרטיות מציינת את Neon** כספק של מסד הנתונים (סעיף "עם מי המידע משותף", ‏`apps/server/src/legal/privacy.ts`). עם Postgres של Fly, מבקשים מ־Claude להסיר את Neon משם **לפני** שהכתובת נמסרת לחנויות.

## 3. Sentry לשרת

1. ב־Sentry: **Create Project** ← הפלטפורמה **Node.js** (או Express) ← השם `sudoku-fight-server`.
2. מעתיקים את ה־**DSN**: ‏Project Settings ← **Client Keys (DSN)**. הוא נראה כך: `https://<key>@<org>.ingest.sentry.io/<id>`.
3. **פרטיות**, ב־Project Settings ← **Security & Privacy**:
   - **Data Scrubber**: דלוק. **Use Default Scrubbers**: דלוק.
   - **Prevent Storing of IP Addresses**: דלוק.

   השרת כבר לא שולח מידע אישי: בלי headers, ‏cookies, גוף הבקשה, query string או כתובות IP, ומיילים ו־tokens נמחקים מההודעות (`apps/server/src/monitoring/redact.ts`). ההגדרות האלה הן שכבה שנייה.
4. **התראות:** ‏Alerts ← **Create Alert** ← "Issues" ← "A new issue is created", עם מייל אליך. אפשר לסנן ל־`environment:production`.
5. את אותו DSN אפשר לתת גם ל־Staging (‏`fly secrets set -a sudoku-fight-staging SENTRY_DSN=…`). הדיווחים מופרדים לפי environment.

## 4. הסודות

```
ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
echo "$ADMIN_PASSWORD"
fly secrets set -a sudoku-fight-prod --stage \
  DATABASE_URL='postgresql://…?sslmode=require' \
  ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  ADMIN_SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  FIREBASE_PROJECT_ID='sudoku-fight-1a2b3' \
  SENTRY_DSN='https://<key>@<org>.ingest.sentry.io/<id>' \
  INVITE_URL='https://<הדף או הקישור להזמנה>' \
  LEGAL_CONTACT_EMAIL='privacy@<הדומיין>' \
  LEGAL_OPERATOR_NAME='<השם שמופיע כמפעיל>'
fly secrets list -a sudoku-fight-prod
```

| סוד | מה | בלעדיו |
|---|---|---|
| `DATABASE_URL` | ה־connection string מסעיף 2 (עם Postgres של Fly: כבר הוגדר) | השרת לא עולה |
| `ADMIN_PASSWORD` | הסיסמה לאתר הניהול, לפחות 12 תווים. **שומרים במנהל הסיסמאות** | אתר הניהול כבוי |
| `ADMIN_SESSION_SECRET` | 64 תווים אקראיים | כל הפעלה מחדש מוציאה אותך מאתר הניהול |
| `FIREBASE_PROJECT_ID` | ה־Project ID מ־Firebase. לא סוד, אבל נשמר כאן כדי ש־`fly.production.toml` יישאר בלי ערכים של פרויקט | חשבונות ומשחק מדורג כבויים (503) |
| `SENTRY_DSN` | מסעיף 3 | אין דיווחי שגיאות |
| `INVITE_URL` | הקישור של "הזמן חברים" בטבלת המובילים [D27] | הכפתור לא מוצג |
| `LEGAL_CONTACT_EMAIL`, ‏`LEGAL_OPERATOR_NAME` | כתובת הקשר והשם בדפים המשפטיים (`/legal/*`). **המייל שלך לא מתפרסם בלי החלטה שלך**: עדיף תיבה ייעודית | הדפים מציגים placeholder ופס "טיוטה" |

- **לא סודות, ולכן ב־`[env]` של `fly.production.toml`:** ‏`NODE_ENV=production`, ‏`TRUST_PROXY=1` (‏proxy אחד של Fly לפני השרת, לא `true`), ‏`RATING_OPTION` [D7], ‏`ADMIN_TZ` ו־`SENTRY_ENVIRONMENT=production`.
- `--stage` שומר בלי להפעיל מחדש. הפריסה בסעיף 5 מפעילה עם כולם.
- אף סוד לא נכנס לקובץ בריפו. `apps/server/test/deploy.test.ts` בודק שאין סודות ב־`fly.toml` וב־`fly.production.toml`.

## 5. פריסה

```
fly deploy --config fly.production.toml --ha=false
```

- הבנייה רצה בשרת הבנייה של Fly. לא צריך Docker במחשב.
- **אם יש git:** כדאי להוסיף `--env GIT_SHA=$(git rev-parse --short HEAD)`. כך ב־Sentry רואים מאיזה commit כל שגיאה.
  בלי זה שם הגרסה ב־Sentry הוא `sudoku-fight-server@0.1.0+deployment-…` (המזהה של הפריסה ב־Fly).
- **בכל פריסה המכונה מתחלפת**, ומשחקים שרצים באותו רגע נקטעים. הם נסגרים כ־`serverRestart`, בלי שינוי דירוג. לכן פורסים בשעות שקטות.

## 6. בדיקה אחרי פריסה

```
fly status -a sudoku-fight-prod
fly logs -a sudoku-fight-prod
curl https://sudoku-fight-prod.fly.dev/health
```

- ב־`fly status`: מכונה אחת, במצב `started`, והבדיקה של `/health` במצב `passing`.
- ב־`fly logs` (השורה המלאה):
  `[server] production, database Postgres, admin site on, Sentry on (production, sudoku-fight-server@0.1.0+…, traces 0.05)`
- ‏`/health` מחזיר `{"ok":true,"engine":"…","protocol":…}`. זו גם הבדיקה של Fly כל 15 שניות. היא עוברת רק אחרי שהמסד פתוח והמיגרציות רצו.
- **אזהרות שאסור לראות בלוג:** `accounts disabled` (חסר `FIREBASE_PROJECT_ID`), ‏`admin site disabled`, ‏`no ranked puzzles` (סעיף 7), ‏`LEGAL_CONTACT_EMAIL or LEGAL_OPERATOR_NAME is not set`.
- **Sentry עובד?** ב־Sentry ← Issues, עם הסינון `environment:production`. שגיאה ראשונה תופיע רק כשתקרה שגיאה אמיתית. כדי לבדוק מיד, שולחים הודעת בדיקה מתוך המכונה:
  ```
  fly ssh console -a sudoku-fight-prod
  ```
  ובתוך המכונה (שורה אחת):
  ```
  cd /app && node -e "const S=require('@sentry/node');S.init({dsn:process.env.SENTRY_DSN,environment:'production'});S.captureMessage('deploy check');S.flush(5000).then(()=>console.log('sent'))"
  exit
  ```
  תוך דקה ההודעה `deploy check` מופיעה ב־Issues. מסמנים אותה כ־Resolved.

## 7. מאגר הלוחות המדורג

משחק מדורג לא מתחיל בלי לוחות מהמאגר המדורג (`pool='ranked'`, אפיון 20). הם לא נמצאים באפליקציה, ונטענים פעם אחת למסד.
הסקריפט מריץ קודם את המיגרציות, ולכן אפשר להריץ אותו לפני הפריסה הראשונה או אחריה. מריצים אותו שוב אחרי כל שינוי במאגר: הוא רק מעדכן.

**עם Neon** (המסד נגיש מהאינטרנט, עם TLS):

```
DATABASE_URL='postgresql://…?sslmode=require' npm run db:seed-puzzles
```

**עם Postgres של Fly**, דרך `fly proxy`. חלון אחד:

```
fly proxy 15432:5432 -a sudoku-fight-prod-db
```

חלון שני. את המשתמש, הסיסמה ושם המסד לוקחים מה־`DATABASE_URL` ששמרת בסעיף 2, ומחליפים רק את הכתובת והפורט:

```
DATABASE_URL='postgres://<user>:<password>@localhost:15432/<db>?sslmode=disable' npm run db:seed-puzzles
```

- שכחת את ה־`DATABASE_URL`? `fly ssh console -a sudoku-fight-prod -C "printenv DATABASE_URL"`.
- הפלט אומר כמה לוחות נכתבו, וכמה יש לכל סוג (היעד: לפחות 2,000 לכל סוג, אפיון 20).
- אחר כך: `fly apps restart sudoku-fight-prod`, ובלוג לא מופיעה יותר האזהרה `no ranked puzzles`.

## 8. אתר הניהול והדפים המשפטיים

- **אתר הניהול:** https://sudoku-fight-prod.fly.dev/admin, עם ה־`ADMIN_PASSWORD` מסעיף 4. לצפייה בלבד (אפיון 27.3).
- **הדפים המשפטיים** (הכתובות שנכנסות לחנויות ולאפליקציה):
  - https://sudoku-fight-prod.fly.dev/legal/privacy (מדיניות פרטיות; ‏`?lang=en` לאנגלית)
  - https://sudoku-fight-prod.fly.dev/legal/terms (תנאי שימוש)
  - https://sudoku-fight-prod.fly.dev/legal/delete-account (מחיקת חשבון, לטופס של Google Play)
- אם עוברים לדומיין משלך (סעיף 11), הכתובות האלה משתנות גם בחנויות.

## 9. חזרה לגרסה קודמת (Rollback)

```
fly releases -a sudoku-fight-prod --image
fly deploy --config fly.production.toml --ha=false --image registry.fly.io/sudoku-fight-prod:deployment-<המזהה של הגרסה הטובה>
```

- `fly releases --image` מציג כל פריסה עם האימג' שלה. פורסים מחדש את האימג' של הגרסה האחרונה שעבדה. אין בנייה, וזה לוקח פחות מדקה.
- **המיגרציות הולכות רק קדימה.** אם הגרסה החדשה הוסיפה מיגרציה, קוד ישן בדרך כלל ממשיך לעבוד (המיגרציות כאן מוסיפות ולא מוחקות). אבל אם לא:
  משחזרים את המסד לנקודת זמן שלפני הפריסה (Neon: ‏Restore, או Branch מנקודת זמן), ורק אז פורסים את האימג' הישן.
- סוד שגוי: `fly secrets set -a sudoku-fight-prod <שם>=<ערך נכון>`. המכונה עולה מחדש עם הערך החדש.

## 10. ניטור ותחזוקה

| מה | איפה |
|---|---|
| שגיאות בשרת | Sentry ← Issues, ‏`environment:production`. מגיע מייל על כל issue חדש (סעיף 3) |
| הלוג החי | `fly logs -a sudoku-fight-prod` |
| מצב המכונה והבדיקות | `fly status -a sudoku-fight-prod`, וגם בלוח של Fly ← Monitoring |
| זיכרון, CPU וחיבורים | הלוח של Fly ← Metrics (‏Grafana) |
| קריסות באפליקציה | Firebase ← Crashlytics (רק מבניות release) |
| שימוש באפליקציה | אתר הניהול (סעיף 8), ו־Firebase ← Analytics |

- **מה נשלח ל־Sentry:** שגיאות 500 בנתיבי ה־HTTP (לפי תבנית הנתיב, למשל `/v1/games/:id/replay`), שגיאות בחדרי המשחק וה־Matchmaking, ‏promise rejection שלא טופל (השרת ממשיך לרוץ), ו־exception שלא נתפס (הדיווח נשלח, ואז התהליך יוצא עם קוד 1 ו־Fly מעלה אותו מחדש).
  בנוסף, 5% מבקשות ה־HTTP נמדדות לביצועים (`SENTRY_TRACES_SAMPLE_RATE`). אף פעם לא `/health`, אתר הניהול, הדפים המשפטיים או המשחקים עצמם (WebSocket).
- **Sentry לא זמין?** השרת לא מושפע: השליחה ברקע, וכל כישלון שלה נבלע.
- **מכונה גדולה יותר** (כשהזיכרון מתקרב לתקרה): `fly scale memory 1024 -a sudoku-fight-prod`, או `fly scale vm shared-cpu-2x -a sudoku-fight-prod`. **לא** `fly scale count`.
  אם נוצרה בטעות מכונה שנייה: `fly scale count 1 -a sudoku-fight-prod`.
- **החלפת סיסמת הניהול:** `fly secrets set -a sudoku-fight-prod ADMIN_PASSWORD=…`.

## 11. הכתובת של השרת באפליקציה, לפי פרופיל EAS

הכתובת נכנסת לקוד כש־Metro בונה אותו (`EXPO_PUBLIC_*`, ‏`apps/mobile/src/config/server.ts`). לכן כל פרופיל ב־`apps/mobile/eas.json` מגדיר אותה ב־`env` שלו:

| פרופיל | לשם מה | השרת |
|---|---|---|
| `development` | Development Build במחשב שלך | מה שב־`apps/mobile/.env.local` (‏Metro במחשב) |
| `preview` | APK פנימי לבדיקות מהירות | `sudoku-fight-staging.fly.dev`, פורט 443, ‏`SECURE=true` |
| `production` | TestFlight, ‏Play Closed testing והחנויות | `sudoku-fight-prod.fly.dev`, פורט 443, ‏`SECURE=true` |

- **הגנה:** בנייה בפרופיל `production` ב־EAS **נכשלת** אם הכתובת היא `localhost`, כתובת ברשת המקומית, placeholder, או בלי `SECURE=true` (`apps/mobile/app.config.ts`). כמו ההגנה של Firebase.
- **דומיין משלך** (מומלץ לפני הבנייה הראשונה לחנות, כי אז הכתובת לא תלויה בשם האפליקציה ב־Fly):
  ```
  fly certs add api.<הדומיין> -a sudoku-fight-prod
  ```
  ‏Fly מדפיס את רשומות ה־DNS (‏A/AAAA, או CNAME) להוסיף אצל רשם הדומיין. כשהתעודה מוכנה (`fly certs show api.<הדומיין> -a sudoku-fight-prod`),
  מעדכנים את `EXPO_PUBLIC_SERVER_HOST` בפרופיל `production`, ובונים מחדש.

## 12. מה לא לעשות

- **לא** `fly scale count 2`, ולא `fly deploy` בלי `--ha=false`.
- **לא** `fly deploy` בלי `--config fly.production.toml` כשמתכוונים ל־Production: בלי הדגל הפריסה הולכת ל־Staging.
- **לא** להכניס סודות, `.env`, ‏keystore או קובצי Firebase לריפו. ה־`.dockerignore` כבר מוציא אותם מהאימג'.
- **לא** להעתיק הגדרות, מפתחות או קבצים מ־PureTrack או מכל פרויקט אחר.
- **לא** להריץ `npm run seed` (נתוני הדוגמה) מול מסד ה־Production. רק `db:seed-puzzles`.
