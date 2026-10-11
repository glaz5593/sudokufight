<div dir="rtl">

# App Store: טקסטים, קטגוריה, דירוג גיל והערות לבודקים

שלב 14 בתוכנית העבודה, לפי אפיון סעיף 23. מה שמודבקים ב־App Store Connect, בעברית ובאנגלית.

- **שפות הדף:** ‏English (U.S.) כשפה הראשית, ו־Hebrew כשפה נוספת. השפה הראשית קובעת מה רואים במדינות שאין להן תרגום.
- **אייקון וצילומי מסך:** ב־`docs/store/ASSETS.md`.
- **פרטיות:** ‏`docs/store/APP-PRIVACY.md` (השאלון של App Privacy).
- **מספרי התווים** שבסוגריים נספרו בסקריפט. Apple סופרת תווים, אבל בשדה מילות המפתח היו דיווחים שהיא סופרת בתים בשפות שאינן לטיניות. אם השדה העברי נדחה, מורידים את המילים האחרונות.

> ⚠️ **לפני ההגשה:** לבדוק שהשם "Sudoku Fight" פנוי ב־App Store (שם אפליקציה ייחודי בכל החנות). חלופות: "Sudoku Fight: Live Duels", ‏"Sudoku Fight Arena".

## 1. שדות הדף

| שדה | מגבלה | English | עברית |
|---|---|---|---|
| Name | 30 | `Sudoku Fight` (12) | `סודוקו פייט` (11) |
| Subtitle | 30 | `Live multiplayer sudoku duels` (29) | `סודוקו תחרותי בזמן אמת` (22) |
| Keywords | 100 | `multiplayer,pvp,versus,duel,online,ranked,puzzle,logic,brain,numbers,battle,arena,race,league,live` (98) | `מרובה משתתפים,דו קרב,אונליין,מדורג,פאזל,היגיון,מספרים,חשיבה,תחרות,זירה,ליגה,מוח,קרב,אתגר` (88) |

**מילות מפתח:** פסיקים בלי רווחים. לא חוזרים על מילים מהשם או מהכותרת (Apple כבר מאנדקסת אותן), ולכן "sudoku" ו"fight" לא ברשימה. בלי שמות של אפליקציות אחרות.

### Promotional Text (עד 170, אפשר לשנות בלי גרסה חדשה)

- **English (144):** One board. Everyone solves. Only one wins. Race up to 3 rivals on the same sudoku in real time, send interferences and climb the ranked leagues.
- **עברית (121):** לוח אחד. כולם פותרים. רק אחד מנצח. מתחרים בזמן אמת עד 3 יריבים על אותו לוח סודוקו, שולחים הפרעות ומטפסים בליגות המדורגות.

### Description (עד 4,000)

**English (1,463):**

</div>

```
Sudoku Fight turns sudoku into a live competition. Up to 4 players solve the same board at the same moment: every correct digit you place is yours, and every point counts.

ONE BOARD, EVERYONE SOLVES
• All players work on the same board at once. Place a correct digit and the cell turns your color.
• Harder moves score more: a digit that needs a clever deduction is worth more than an easy one.
• Mistakes cost points, and the penalty grows with each one. Speed alone won't win.
• Lock a cell while you think, but only for a few seconds.

INTERFERENCES AND REACTIONS
• Spend points to hit a rival with fireworks, cats or a warp for 5 seconds.
• React with 😂 😱 😎 🤦 🔥 👀.

RANKED PLAY
• Ranked games for 2, 3 or 4 players, in three game types: fast, normal and hard.
• Matchmaking looks for opponents at your level and avoids rivals you just played.
• A rating for each game type, leagues, leaderboards and player cards with your stats.
• No opponents online? Practice against a bot while you wait.

LEARN FROM EVERY GAME
• Replay any ranked game move by move, with a logical explanation of each move.
• Your full game history and progress, with XP and levels.

PRACTICE ANYTIME
• Practice alone or against bots of different strengths, even offline.

FAIR PLAY
• The server checks every move, and ranked puzzles never ship inside the app.
• No ads. You can delete your account at any time from Settings.

In Hebrew and English. The board always reads left to right.
```

<div dir="rtl">

**עברית (1,196):**

```
סודוקו פייט הופך את הסודוקו לתחרות חיה. עד 4 שחקנים פותרים את אותו לוח באותו רגע: כל ספרה נכונה שאתם מניחים שייכת לכם, וכל נקודה קובעת.

לוח אחד, כולם פותרים
• כל השחקנים משחקים על אותו לוח בו־זמנית. ספרה נכונה צובעת את המשבצת בצבע שלכם.
• מהלך קשה שווה יותר: ספרה שדורשת הסקה חכמה שווה יותר מספרה קלה.
• טעות עולה בנקודות, והקנס גדל עם כל טעות. מהירות לבד לא מספיקה.
• נועלים משבצת בזמן שחושבים, אבל רק לכמה שניות.

הפרעות ותגובות
• משקיעים נקודות ושולחים ליריב זיקוקים, חתולים או עיוות מסך ל־5 שניות.
• מגיבים עם 😂 😱 😎 🤦 🔥 👀.

משחק מדורג
• משחקים מדורגים ל־2, ‏3 או 4 שחקנים, בשלושה סוגים: מהיר, רגיל וקשה.
• ה־Matchmaking מחפש יריבים ברמה שלכם, ונמנע מיריבים ששיחקתם מולם לאחרונה.
• דירוג לכל סוג משחק, ליגות, טבלאות מובילים וכרטיס שחקן עם הסטטיסטיקה שלכם.
• אין יריבים מחוברים? מתאמנים מול בוט בזמן ההמתנה.

לומדים מכל משחק
• צפייה חוזרת (Replay) בכל משחק מדורג, מהלך אחרי מהלך, עם הסבר לוגי לכל מהלך.
• כל היסטוריית המשחקים וההתקדמות שלכם, עם XP ורמות.

אימון בכל זמן
• מתאמנים לבד או מול בוטים בכמה רמות, גם בלי אינטרנט.

משחק הוגן
• השרת בודק כל מהלך, והלוחות המדורגים לא נמצאים בתוך האפליקציה.
• בלי פרסומות. אפשר למחוק את החשבון בכל רגע מההגדרות.

בעברית ובאנגלית. הלוח תמיד משמאל לימין.
```

- **"What's New"** בגרסה הראשונה: ‏`First release.` / ‏`גרסה ראשונה.`
- כל טענה בתיאור קיימת בקוד של V1. **לא להוסיף** חברים, עונות או רכישות לפני שהם קיימים (הנחיה 2.3.1: תיאור מדויק).

## 2. כתובות

| שדה | חובה? | ערך |
|---|---|---|
| Privacy Policy URL | **כן** | `https://<שרת ה־Production>/legal/privacy?lang=en` (עברית: `?lang=he`) |
| Support URL | **כן** | `https://<שרת ה־Production>/legal/privacy?lang=en#contact`. עדיף בהמשך דף תמיכה של המשחק |
| Marketing URL | לא | — |

- הדפים מוגשים מהשרת (`apps/server/src/legal`): ‏`/legal/privacy`, ‏`/legal/terms` ו־`/legal/delete-account`, בעברית (ברירת המחדל) ובאנגלית.
- **לפני שנותנים את הכתובות:** להגדיר בשרת `LEGAL_CONTACT_EMAIL` ו־`LEGAL_OPERATOR_NAME` (`fly secrets set`). בלעדיהם הדפים מציגים placeholder אדום ופס "טיוטה".
  **כתובת המייל של משה לא מתפרסמת בלי אישורו.** ההצעה: תיבה ייעודית, למשל `privacy@<הדומיין>` או `support@<הדומיין>`.
- **Copyright:** ‏`2026 <שם המפעיל>` (אותו שם כמו ב־`LEGAL_OPERATOR_NAME`).
- **License Agreement:** ה־EULA הרגיל של Apple. תנאי השימוש שלנו מפנים אליו (סעיף "חנויות האפליקציות").

## 3. קטגוריה

- **Primary:** ‏Games, ובתוכה **Puzzle** ו־**Board** (עד שתי תת־קטגוריות).
- **Secondary:** לא חובה. אם רוצים: ‏Games › Strategy, או בלי.

## 4. דירוג גיל (Age Rating)

השאלון החדש של Apple (2025, דירוגים 4+, ‏9+, ‏13+, ‏16+ ו־18+). **Apple מחשבת את הדירוג מהתשובות.** הניסוח בשאלון משתנה מדי פעם, אז עונים לפי המשמעות.

| נושא בשאלון | תשובה | למה |
|---|---|---|
| Parental Controls (בקרת הורים בתוך האפליקציה) | No | אין |
| Age Assurance (אימות גיל) | No | אין |
| Unrestricted Web Access | No | אין דפדפן באפליקציה. הקישורים לדפים המשפטיים נפתחים בדפדפן של המערכת |
| User-Generated Content | **Yes** | שם לתצוגה שהשחקן בוחר גלוי לאחרים (מסונן במילים אסורות). ראו `docs/store/UGC-PROPOSAL.md` |
| Messaging and Chat | No | אין צ׳אט ואין טקסט חופשי. התגובות הן 6 אימוג׳י קבועים |
| Advertising | No | אין פרסומות |
| Profanity or Crude Humor | None | שמות מסוננים. אין טקסט חופשי אחר |
| Horror / Fear Themes | None | — |
| Alcohol, Tobacco, or Drug Use or References | None | — |
| Medical or Treatment Information / Health or Wellness | None / No | — |
| Sexual Content or Nudity | None | — |
| Cartoon or Fantasy Violence | **None** | "Fight" הוא תחרות. ההפרעות (זיקוקים, חתולים, עיוות מסך) הן אפקטים חזותיים, בלי פגיעה בדמויות |
| Realistic / Prolonged Graphic Violence, Guns or Other Weapons | None | — |
| Simulated Gambling / Gambling | None / No | אין הימורים. הניקוד אינו כסף |
| Contests | No | אין פרסים |
| Loot Boxes | No | אין רכישות ואין תיבות |

- **הדירוג הצפוי:** 4+. אם התשובה על User-Generated Content מעלה אותו (למשל ל־9+), מקבלים את זה.
- **Made for Kids:** לא. המשחק לא מכוון לילדים (מדיניות הפרטיות: מגיל 13). לא מסמנים את הקטגוריה Kids.

## 5. App Review Information (מידע לבודקי Apple)

| שדה | ערך |
|---|---|
| Sign-in required | **Yes** |
| User name | `<demo1@הדומיין>` ‏(**placeholder**: משה יוצר) |
| Password | `<סיסמה>` ‏(**placeholder**) |
| Contact | שם, טלפון ומייל של משה (לא מתפרסמים, רק לצוות הבדיקה) |

**איך מכינים את חשבונות הדמו (לפני ההגשה):**
1. נרשמים באפליקציה, מול שרת ה־Production, עם שני חשבונות: `demo1` ו־`demo2`. סיסמה חזקה, וכתובות מייל שמשה יכול לקבל בהן מייל.
2. **מאמתים את המייל של שני החשבונות.** משחק מדורג דורש מייל מאומת (`accountConfig.verification.requiredForRanked`).
3. משחקים משחק מדורג אחד בין שני החשבונות, ומשחק אימון אחד. כך יש לבודק היסטוריה, Replay וטבלת מובילים.
4. לא מוחקים את החשבונות ולא משנים את הסיסמה כל עוד הגרסה בבדיקה. הבודק עלול למחוק את החשבון כדי לבדוק את המחיקה: אז יוצרים אותו מחדש לפני ההגשה הבאה.

**Notes (באנגלית, להדביק כמו שזה):**

</div>

```
Sudoku Fight is a real-time competitive sudoku game: 1 to 4 players solve the same board at the same time.

Demo account: <demo1 email> / <password>. Its email is verified, so ranked play is available.

How to try it:
1. Sign in with the demo account.
2. Practice works without other players: Home → Play → "Practice vs bot" (or "Solo practice"). It also works offline.
3. Ranked play (Home → Play → "Ranked · 2 players") needs a real opponent. If no other player is online, the search ends after about a minute with "No opponent at your level yet": tap "Play a bot meanwhile" to play a game against a bot right away. To see a ranked game between two people, sign in on a second device with the second demo account (<demo2 email> / <password>) and start the same search on both.
4. Replay with explanations: History → any game → Replay.

Account deletion (Guideline 5.1.1(v)): Settings → Delete account → confirm → enter the password. It deletes the account on our server and the Firebase sign-in at once.
Privacy policy and terms of use: Settings → About and legal (also on the registration screen).

User-generated content: the only user-generated content is the display name. Names are checked against a blocked-words list on the server when they are chosen or changed. There is no chat; in-game reactions are 6 fixed emoji, and an opponent's reactions can be muted from their card.

The app has no ads, no in-app purchases, and does not track users.
```

<div dir="rtl">

- **אם מוסיפים "דווח על שחקן" ו"חסימה"** (`docs/store/UGC-PROPOSAL.md`), מעדכנים את הפסקה על User-generated content בהתאם.
- **התפריטים בהערות** (Home → Play, ‏"Practice vs bot" וכו') צריכים להתאים לשמות באפליקציה באנגלית. לבדוק מול הבנייה לפני ההדבקה.
- **Sign in with Apple לא נדרש** (הנחיה 4.8): הכניסה היא חשבון משלנו, מייל וסיסמה, בלי Google ובלי רשת חברתית. אם מוסיפים התחברות כזו, מוסיפים גם Sign in with Apple (אפיון סעיף 23).

## 6. Export Compliance (הצפנה)

- האפליקציה משתמשת רק בהצפנה סטנדרטית של המערכת (HTTPS ו־WSS). זה פטור.
- ✅ **בקוד:** ‏`app.json` כולל ‏`"ios": { "config": { "usesNonExemptEncryption": false } }`, שנכנס ל־Info.plist כ־`ITSAppUsesNonExemptEncryption = NO`. לכן App Store Connect לא שואל על הצפנה בכל בנייה (`appConfig.test.ts` בודק שזה נשאר).
- אם בעתיד מוסיפים הצפנה משלנו (לא ה־TLS של המערכת), משנים ל־`true` ועונים על השאלון.

## 7. TestFlight

- **בודקים פנימיים** (עד 100, חברי הצוות ב־App Store Connect): בלי בדיקה של Apple.
- **בודקים חיצוניים** (עד 10,000, בהזמנה או בקישור ציבורי): הבנייה הראשונה עוברת **Beta App Review**, שבודק לפי אותן הנחיות. צריך בשבילו: "What to Test", מייל לפידבק, ואותם פרטי חשבון דמו והערות כמו למעלה.
- **What to Test (English):** `Play ranked games with other testers (2, 3 or 4 players), try interferences and reactions, and check the replay and history. Practice against bots works offline. Please report anything that feels unfair or confusing.`

</div>
