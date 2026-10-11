<div dir="rtl">

# רישיונות הנכסים: אווטרים, צלילים, גופנים ולוחות

שלב 14 ("בדיקת רישיונות: אווטרים, צלילים ולוחות"), אפיון סעיף 23 ("רישיונות… יש לבדוק את כולם לפני ההגשה").
רישיונות חבילות הקוד: ‏`docs/store/LICENSES-REPORT.md` (נוצר על ידי `npm run licenses`).

## סיכום

| נכס | מקור | רישיון | סטטוס | מה צריך ממשה |
|---|---|---|---|---|
| 50 אווטרים + av00 | חבילה "freebie" מהאפליקציה הקודמת | **לא ידוע** | 🔴 **חוסם הגשה** | למצוא את מקור החבילה ואת דף הרישיון שלה (סעיף 1) |
| 30 צלילים | נוצרו בקוד בפרויקט | אין צורך ברישיון | ✅ | להחליף בצלילים סופיים ב־CC0 (סעיף 2) |
| גופנים Rubik ו־Teko | Google Fonts | SIL OFL 1.1 | ✅ | כלום. הרישיון מוצג באפליקציה |
| 690 לוחות "מהיר" | האפליקציה הקודמת, כנראה Kaggle | **כנראה CC0** | 🟡 לאמת | לפתוח את דף המאגר ב־Kaggle ולוודא (סעיף 4) |
| ‏6,000 לוחות מדורגים + 600 לוחות אופליין (רגיל, קשה) | המחולל שלנו | שלנו | ✅ | כלום |
| אייקון ומסך פתיחה | נוצרו בקוד בפרויקט | שלנו | ✅ | ראו `docs/store/ASSETS.md` |

## 1. אווטרים 🔴

**מה יש:** ‏`assets/avatars/av01.svg` עד `av51.svg` (בלי av36), ו־`av00.svg` ("אין אווטאר"). הם הומרו מקובצי Android VectorDrawable של האפליקציה הקודמת (`com.moshe.glaz.sudoku`): ‏`assets-src/avatars/avatars_freebie_svg_0.xml` עד `_51.xml`.

**מה אפשר לקבוע מהקבצים עצמם:**
- **אין בהם מטא־דאטה, הערות, שם יוצר או רישיון.** קובצי VectorDrawable לא שומרים את אלה, וההמרה מ־SVG מוחקת אותם.
- **השם `avatars_freebie_svg_NN`** הוא שם הייצוא של חבילה. "Freebie" הוא הכינוי לחבילות חינמיות באתרים כמו Freepik, ‏Dribbble, ‏Behance, ‏UI8 ו־Figma Community. לכל אחד מהם תנאים אחרים.
- **שטח הציור** של 50 מתוך 52 הקבצים הוא 170.46×170.51 (או 170.45), עם ריבוע מעוגל ברקע: עיצוב אחיד של חבילה אחת, שיוצא מ־Illustrator. ‏`_0` (‏av00) נבנה ביד על אותו רקע: רק עיגול פשוט.
- **תאריך הקבצים:** 24.5.2022.
- **אפיון מקורי §33:** "אני אספק תמונות של אווטרים". כלומר, המקור אצל משה.

**מה משה צריך לבדוק:**
1. **מאיפה החבילה הורדה.** כדאי לחפש: בהיסטוריית ההורדות או במייל מ־2022, בתיקיות של הפרויקט הקודם (קובץ ZIP, ‏README, ‏`license.txt`), או בחיפוש תמונה של אחד האווטרים (Google Lens).
2. **בדף הרישיון של החבילה,** חמש שאלות:
   - מותר **שימוש מסחרי**? (גם משחק חינמי בחנות נחשב לרוב מסחרי)
   - מותר **בתוך אפליקציה**, ולא רק באתר או בעיצוב?
   - נדרש **קרדיט** (Attribution)? אם כן, באיזה נוסח ואיפה (למשל Freepik: ‏"Designed by Freepik", אלא אם יש מנוי Premium).
   - מותר **לשנות** (המרנו פורמט, והקבצים מוצגים בגדלים אחרים)?
   - מותר **להפיץ** אותם כחלק מהאפליקציה? (‏SVG בתוך האפליקציה אפשר לחלץ)
3. **אם נדרש קרדיט:** מוסיפים שורה למסך "רישיונות" באפליקציה (חצי שעה עבודה) ולתיאור בחנות אם הרישיון דורש.

**אם אי אפשר לאמת (החלופה):**
- **הדרישה המקורית (§33):** "אני אספק תמונות של אווטרים".
- **ההצעה:** להחליף את 50 האווטרים בסט שהרישיון שלו ברור: סט שמשה מזמין ממעצב (בבעלות מלאה), או סט ב־CC0.
- **למה:** בלי רישיון מאומת, החנויות עלולות להסיר את האפליקציה בעקבות תלונת זכויות יוצרים, ולא נוכל להוכיח שמותר לנו.
- **אפשרויות ב־CC0 (לבדוק את הרישיון בדף של כל סט לפני שימוש):** ‏Open Peeps (‏Pablo Stanley), וסגנונות CC0 של DiceBear, כמו Lorelei ו־Notionists.
- **בקוד ההחלפה פשוטה:** אותם שמות קבצים (`av01.svg`…), אותם מזהים, ובלי מיגרציה. החשבונות הקיימים שומרים את המספר שבחרו.

## 2. צלילים ✅ (זמניים)

**מה יש:** ‏30 קובצי WAV ב־`assets/sounds/placeholder/`. **כולם נוצרו בקוד** על ידי `apps/mobile/scripts/gen-placeholder-sounds.mjs`, מגלי סינוס, משולש ורעש. אין בהם חומר של צד שלישי, ולכן **אין רישיון לבדוק** (`assets/sounds/README.md`).

**הצלילים הסופיים: CC0 בלבד** (`docs/design/motion.md` §8). לכל קובץ רושמים מקור ויוצר ב־`assets/sounds/CREDITS.md`.

**הצעות לכל צליל** (לא הורדתי כלום). ‏Kenney.nl: כל החבילות שלו ב־**CC0**, בלי חובת קרדיט, ‏[kenney.nl/assets](https://kenney.nl/assets) ← category Audio. **שמות הקבצים הם הצעה:** לשמוע כמה קבצים סמוכים בחבילה ולבחור. ‏Kenney מספק `.ogg`, ולכן ממירים ל־`.m4a` (‏ffmpeg) ומקצרים לאורך שבטבלה.

| צליל (`assets/sounds/`) | מה צריך | הצעה ראשונה | חלופה |
|---|---|---|---|
| `cell_select` | טיק עץ קצר, עד 60ms | Kenney **Impact Sounds**: ‏`impactWood_light_000` | Kenney **Interface Sounds**: ‏`tick_001` |
| `cell_denied` | "טאק" עמום, עד 150ms | Interface Sounds: ‏`error_004` (בעוצמה נמוכה) | Impact Sounds: ‏`impactSoft_medium_000` |
| `cell_release` | טיק הפוך ורך, עד 150ms | Interface Sounds: ‏`drop_001` | Interface Sounds: ‏`minimize_003` |
| `correct` | "דינג" עולה עם צלצול מטבע, 300–500ms | Interface Sounds: ‏`confirmation_001` | Kenney **RPG Audio**: ‏`handleCoins` (כשכבה שנייה) |
| `count_tick` | טיק זעיר, עד 30ms | Interface Sounds: ‏`tick_004` (חתוך) | Interface Sounds: ‏`click_002` |
| `wrong` | זמזום נמוך, ‏120–200ms | Interface Sounds: ‏`error_006` | Kenney **Digital Audio**: ‏`lowDown` (חתוך) |
| `lock_tick` | תקתוק שעון שקט | Interface Sounds: ‏`tick_002` | — |
| `arsenal_open` | מגירה נפתחת, עד 250ms | Interface Sounds: ‏`open_001` | Interface Sounds: ‏`maximize_006` |
| `interfere_whoosh` | "ווש" בגרירה, ‏300–500ms | Freesound, ‏CC0: חיפוש "whoosh short" | Kenney **Sci-Fi Sounds**: ‏`thrusterFire_000` (חתוך) |
| `interfere_launch` | פיצוץ קטן בנחיתה, ‏300–600ms | Sci-Fi Sounds: ‏`explosionCrunch_000` | Impact Sounds: ‏`impactPunch_medium_000` |
| `hit_fireworks` | פצפוצים וזיקוקים, **עד 5 שניות**, דעיכה בסוף | Freesound, ‏CC0: ‏"fireworks crackle" | כמה `explosionCrunch_00x` של Sci-Fi Sounds ברצף |
| `hit_cats` | יללות וריצה, **עד 5 שניות** | Freesound, ‏CC0: ‏"cat meow" + ‏"small footsteps" | (אין חתולים אצל Kenney) |
| `hit_warp` | "וובל" סינתטי, **עד 5 שניות** | Digital Audio: ‏`phaserDown3` או `spaceTrash1`, בלולאה | Sci-Fi Sounds: ‏`spaceEngine_000` |
| `react_laugh` | צחקוק, עד 800ms | Freesound, ‏CC0: ‏"chuckle" | — |
| `react_scream` | התנשפות, עד 800ms | Freesound, ‏CC0: ‏"gasp" | — |
| `react_cool` | נקישת אצבעות, עד 800ms | Freesound, ‏CC0: ‏"finger snap" | Interface Sounds: ‏`click_005` |
| `react_facepalm` | טפיחה רכה, עד 800ms | Impact Sounds: ‏`impactSoft_heavy_000` | Freesound, ‏CC0: ‏"face slap" |
| `react_fire` | "ווש" של להבה, עד 800ms | Sci-Fi Sounds: ‏`thrusterFire_001` (חתוך) | Freesound, ‏CC0: ‏"fire whoosh" |
| `react_eyes` | "הממ" סקרן, או "בוינג", עד 800ms | Interface Sounds: ‏`question_001` | Digital Audio: ‏`pepSound1` |
| `react_pop` | פופ רך, עד 200ms | Interface Sounds: ‏`pluck_001` | Interface Sounds: ‏`drop_002` |
| `match_found` | צלצול של שני תווים, עד 700ms | Digital Audio: ‏`twoTone1` | Interface Sounds: ‏`confirmation_002` |
| `countdown_beat` | מכת תוף, עד 400ms | Freesound, ‏CC0: ‏"taiko hit" או "kick drum one shot" | Impact Sounds: ‏`impactPunch_heavy_000` |
| `go` | גונג עם תרועה קצרה, עד 1.5 שניות | Impact Sounds: ‏`impactBell_heavy_000` + ‏Freesound, ‏CC0: ‏"crowd cheer short" | Kenney Voiceover: הקריינות "go" או "fight", אם יש |
| `win` | פנפרה קצרה, עד 2 שניות | Kenney **Music Jingles**: אחד מ־`jingles_NES00`…`16` | Music Jingles: ‏`jingles_SAX..` |
| `lose` | אקורד יורד, עד 1.5 שניות | Music Jingles: אחד יורד מ־`jingles_PIZZI..` | Digital Audio: ‏`lowThreeTone` |
| `lead_take` | "סוויש" עולה, עד 400ms | Digital Audio: ‏`phaserUp3` | Interface Sounds: ‏`maximize_002` |
| `lead_lose` | "סוויש" יורד, עד 400ms | Digital Audio: ‏`phaserDown2` | Interface Sounds: ‏`minimize_002` |
| `disconnect` | שני צלילים יורדים, עד 600ms | Digital Audio: ‏`highDown` | Digital Audio: ‏`twoTone2` |
| `reconnect` | שני צלילים עולים, עד 600ms | Digital Audio: ‏`highUp` | Digital Audio: ‏`twoTone1` |
| `ui_tap` | קליק רך, עד 80ms | Interface Sounds: ‏`click_001` | Kenney **UI Audio**: ‏`click1` |

**ב־Freesound.org:** מסננים לפי License: **Creative Commons 0** בלבד. קבצים ב־CC BY דורשים קרדיט, וב־CC BY-NC אסור להשתמש במשחק בחנות.
**כשמחליפים:** לפי `assets/sounds/README.md` (אותם שמות, ‏`SOUND_SOURCES` ב־`apps/mobile/src/services/sfx.ts`, והבדיקות).

## 3. גופנים ✅

| גופן | זכויות יוצרים | רישיון | איפה |
|---|---|---|---|
| Rubik (400, 500, 600, 700) | Copyright 2015 The Rubik Project Authors | SIL Open Font License 1.1 | `@expo-google-fonts/rubik`, מוטמע דרך `expo-font` |
| Teko (500, 600) | Copyright 2023 The Teko Project Authors | SIL Open Font License 1.1 | `@expo-google-fonts/teko` |

- **‏OFL 1.1 מתיר** להטמיע את הגופן באפליקציה ולהפיץ אותה, גם מסחרית.
- **התנאים:** לצרף את הודעת זכויות היוצרים ואת הרישיון (✅ במסך "רישיונות" באפליקציה, מילה במילה מ־`LICENSE_FONT`), לא למכור את הגופן לבדו, ולא לקרוא בשם המקורי לגרסה ששונתה (לא שינינו).
- **החבילות `@expo-google-fonts/*`** עצמן ב־MIT (הקוד שטוען את הגופן).
- **אתר הניהול** טוען Rubik מ־Google Fonts. זה שימוש באתר, באותו רישיון.

## 4. מאגר הלוחות

### 4.1 ‏690 הלוחות של "מהיר" 🟡
- **הקובץ:** ‏`assets/puzzles/sudoku-bank-690.csv`. התוכן זהה ל־`assets-src/sudoku.csv` מהאפליקציה הקודמת.
- **מה רואים בקבצים:** הלוח הראשון (`004300209005009001…`) והשני (`040100050107003960…`) זהים, לפי מה שאני זוכר, לשתי השורות הראשונות של המאגר **"1 million Sudoku games"** של **Kyubyong Park** ב־Kaggle (שם הקובץ שם `sudoku.csv`, עם העמודות `quizzes,solutions`). מספרי הרמזים (30–36, רובם 33–34) מתאימים לאופי של אותו מאגר.
  **זו השערה ולא בדיקה.** לא פתחתי את Kaggle.
- **לפי מה שזכור לי, הרישיון של אותו מאגר ב־Kaggle הוא CC0 (Public Domain).** אם כן, מותר כל שימוש, בלי קרדיט.
- **מה משה צריך לבדוק:**
  1. לפתוח את דף המאגר ב־Kaggle (חיפוש "1 million Sudoku games", ‏Kyubyong Park), ולראות את שדה **License**.
  2. להשוות את 3 השורות הראשונות של `sudoku.csv` שם לשורות הראשונות של `assets-src/sudoku.csv`.
  3. אם זה המקור וה־License הוא CC0: לרשום את זה כאן, ולהוסיף בהמשך שורת קרדיט (רשות) במסך "רישיונות".
- **החלופה, אם המקור לא מאומת או שהרישיון לא מתיר:**
  - **הדרישה המקורית (§31):** "אני אספק טבלאות Excel עם אלפי משחקים. המערכת צריכה להשתמש במאגר".
  - **ההצעה:** להחליף את 690 הלוחות בלוחות "מהיר" מהמחולל שלנו. כבר יש 2,000 כאלה במאגר המדורג, והפקודה `npm run puzzles:generate` מייצרת עוד, באותו דירוג. קובצי ה־Excel של משה ייכנסו כשיגיעו, דרך `npm run puzzles:import`.
  - **למה:** ‏690 הלוחות נמצאים בתוך האפליקציה ומופצים בחנות. בלי רישיון מאומת, זה הנכס היחיד ממאגר חיצוני שמופץ.
  - **הערה:** בהרבה מדינות לוח סודוקו בודד הוא כנראה עובדה מתמטית ולא יצירה מוגנת, אבל אוסף שלם עשוי להיות מוגן כמאגר מידע. לכן כדאי לא להסתמך על זה.

### 4.2 הלוחות שנוצרו במחולל ✅
- **‏6,000 לוחות מדורגים** (2,000 לכל סוג: מהיר, רגיל, קשה) ו־**600 לוחות אופליין** (300 רגיל, 300 קשה).
- נוצרו במחולל של המנוע (`packages/engine`, ‏`npm run puzzles:generate`), ובשדה `source` של כל לוח רשום `generator:<seed>`. בדקתי בקובץ `packages/engine/data/puzzles.json`.
- **הם שלנו.** אין רישיון של צד שלישי.

</div>
