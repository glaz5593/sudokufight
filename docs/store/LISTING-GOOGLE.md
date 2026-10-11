<div dir="rtl">

# Google Play: טקסטים, קטגוריה, דירוג תוכן וקהל יעד

שלב 14 בתוכנית העבודה, לפי אפיון סעיף 23. מה שמודבקים ב־Play Console, בעברית ובאנגלית.

- **שפות הדף:** ‏English (United States) – en-US כשפת ברירת המחדל, ו־Hebrew – iw-IL כתרגום.
- **אייקון 512, Feature graphic וצילומי מסך:** ב־`docs/store/ASSETS.md`.
- **Data safety:** ‏`docs/store/DATA-SAFETY.md`.
- **מספרי התווים** שבסוגריים נספרו בסקריפט.

## 1. Main store listing

| שדה | מגבלה | English | עברית |
|---|---|---|---|
| App name | 30 | `Sudoku Fight: Live PvP Sudoku` (29) | `סודוקו פייט: סודוקו תחרותי` (26) |
| Short description | 80 | `Race up to 3 rivals on the same sudoku board in real time. Ranked, live, fair.` (78) | `מתחרים עד 3 יריבים על אותו לוח סודוקו בזמן אמת. מדורג, חי והוגן.` (64) |
| Full description | 4,000 | אותו תיאור כמו ב־App Store (1,463) | אותו תיאור כמו ב־App Store (1,196) |

- **התיאור המלא:** מעתיקים מ־`docs/store/LISTING-APPLE.md`, סעיף 1 ("Description"). אותו טקסט מתאים לשתי החנויות.
- **מדיניות Play על מטא־דאטה:** בלי "#1", ‏"Best", ‏"Free" או אימוג׳י בשם ובתיאור הקצר, ובלי קריאה לפעולה כמו "Download now". האימוג׳י בתיאור המלא מותרים (הם התגובות של המשחק).
- **בשם יש "PvP Sudoku"** כדי שהחיפוש יבין מה זה. אם מעדיפים שם נקי: `Sudoku Fight` (12) / `סודוקו פייט` (11).

## 2. App category ו־Contact details

| שדה | ערך |
|---|---|
| App or game | **Game** |
| Category | **Puzzle** (חלופה: Board) |
| Tags | Sudoku, Multiplayer, Puzzle, Logic, Competitive (בוחרים מהרשימה של Play, עד 5) |
| Email | **חובה ומתפרסם.** תיבה ייעודית (לא המייל של משה בלי אישורו), אותה כמו `LEGAL_CONTACT_EMAIL` |
| Website | לא חובה |
| Phone | לא חובה. לא למלא |
| Privacy policy | `https://<שרת ה־Production>/legal/privacy?lang=en` |

## 3. App content (הצהרות)

| הצהרה | תשובה | הערה |
|---|---|---|
| Privacy policy | הכתובת למעלה | הדף מוגש מהשרת. להגדיר קודם `LEGAL_CONTACT_EMAIL` ו־`LEGAL_OPERATOR_NAME` |
| App access | **All or some functionality is restricted** | הוראות למטה, עם חשבון הדמו |
| Ads | **No, my app does not contain ads** | |
| Content rating | שאלון IARC, סעיף 4 | |
| Target audience and content | מגיל 13, סעיף 5 | |
| News app | No | |
| COVID-19 contact tracing | No | |
| Data safety | `docs/store/DATA-SAFETY.md` | |
| Government app | No | |
| Financial features | No | |
| Health | No | |
| Advertising ID | ראו למטה | |

### App access: הוראות לבודקי Google

- **Username:** `<demo1@הדומיין>` ‏(**placeholder**), ‏**Password:** `<סיסמה>`.
- **Any other information required to access your app (English):**

</div>

```
Sign in with the demo account (email verified). Practice (Home → Play → "Practice vs bot" or "Solo practice") works without other players and offline. Ranked games need a real opponent: if nobody is online, the search ends after about a minute and offers "Play a bot meanwhile". A second demo account for a ranked game on two devices: <demo2 email> / <password>. Account deletion: Settings → Delete account.
```

<div dir="rtl">

- את חשבונות הדמו מכינים כמו ב־`LISTING-APPLE.md`, סעיף 5 (שניהם עם מייל מאומת). אפשר להשתמש באותם חשבונות לשתי החנויות.

### Advertising ID

- **התשובה: No.** האפליקציה לא משתמשת ב־Advertising ID.
- **בקוד (✅):** ‏Firebase Analytics מוסיף בדרך כלל את ההרשאה `com.google.android.gms.permission.AD_ID`. ‏`apps/mobile/app.config.ts` חוסם אותה (`blockedPermissions`), ו־`apps/mobile/firebase.json` מכבה את איסוף מזהה הפרסום ואת אותות הפרסום.
- **לבדוק בבנייה הראשונה:** ב־Play Console ← App bundle explorer ← Permissions, ש־`AD_ID` לא מופיעה. אם היא מופיעה, התשובה "No" לא נכונה. אז או מתקנים, או עונים "Yes" עם המטרה "Analytics", ומעדכנים את `DATA-SAFETY.md` ואת מדיניות הפרטיות.

## 4. Content rating (שאלון IARC)

- **Email:** אותה תיבה של יצירת הקשר. **Category:** ‏**Game**.

| שאלה (בקיצור) | תשובה | למה |
|---|---|---|
| Violence (כולל cartoon / fantasy) | **No** | ההפרעות הן אפקטים (זיקוקים, חתולים, עיוות מסך). אין פגיעה בדמויות |
| Fear / Horror | No | |
| Sexuality / Nudity | No | |
| Language (profanity, crude humor) | No | שמות לתצוגה מסוננים במילים אסורות. אין טקסט חופשי אחר |
| Controlled substances (drugs, alcohol, tobacco) | No | |
| Gambling (real or simulated) | No | אין הימורים. הניקוד אינו כסף |
| Crude humor | No | |
| **Users can interact or exchange content** | **Yes** | משחק אונליין: השם לתצוגה, האווטאר והמדינה גלויים, ויש 6 תגובות אימוג׳י קבועות. **אין צ׳אט**, אין טקסט חופשי ואין קול |
| Shares user's location with other users | **No** | המדינה נבחרת על ידי השחקן. האפליקציה לא משתמשת במיקום המכשיר |
| Allows purchase of digital goods | No | |
| Unrestricted internet access (browser, search) | No | |
| Promotes / contains NFTs or blockchain rewards | No | |

- **הדירוג הצפוי:** ‏PEGI 3, ‏ESRB Everyone, ‏USK 0, ועם התגית **"Users Interact"**.

## 5. Target audience and content

| שאלה | תשובה | למה |
|---|---|---|
| Target age groups | **13–15, ‏16–17, ‏18+** | המשחק לא מכוון לילדים, ומדיניות הפרטיות קובעת מגיל 13. **לא לסמן קבוצות מתחת ל־13:** זה מכניס את האפליקציה ל־Families Policy, עם דרישות נוספות על SDKs ועל נתונים |
| Could the store listing unintentionally appeal to children? | **No** | סודוקו תחרותי עם דירוג. שימו לב: האווטרים המצוירים וההפרעה "חתולים" עלולים להיראות ילדותיים. לא לשים אותם במרכז הצילום הראשון, ולא להשתמש בניסוח שפונה לילדים |
| Ads | No ads | |

## 6. Closed testing: חשבון אישי חדש

- **בחשבון Play Console אישי שנפתח אחרי 13.11.2023:** לפני Production חובה **Closed testing עם לפחות 12 בודקים** שמצטרפים **ונשארים 14 יום רצופים** (אפיון סעיף 23). רק אחר כך אפשר לבקש גישה ל־Production, ו־Google שואלת על הבדיקה.
- **Track:** ‏Closed testing → Alpha. **בודקים:** רשימת מיילים (Google Groups או רשימה ב־Console). כל בודק מצטרף דרך קישור ההצטרפות, ומתקין מ־Play.
- **כדאי לגייס 15–20 בודקים**, כי מי שעוזב באמצע מוריד את המספר. לבקש מהם לשחק משחקים מדורגים כמה פעמים בשבוע, כדי שיהיה למה לענות על שאלות Google (מה נבדק, מה תוקן).
- **"Release notes" לבודקים (English):** `First closed test. Play ranked games with other testers, try interferences and reactions, and tell us what feels unfair or confusing.`
- **חשבון ארגון (D-U-N-S)** לא מחויב בדרישת 12 הבודקים, אבל ההרשמה לוקחת זמן (אפיון סעיף 23).

</div>
