# מועמדים לצלילים הסופיים

שלב "צלילים סופיים וכיול עוצמות" בתוכנית העבודה.
לכל אחד מ־30 הצלילים בטבלה של `docs/design/motion.md`, סעיף 8, יש כאן **קובץ מועמד אחד**, בשם של הצליל.

**האפליקציה עדיין משמיעה את ה־placeholders.** משה שומע, בוחר, ומקדם מועמד לפי `assets/sounds/README.md`.

## איך שומעים

- מסך הפיתוח `/dev/sounds`. מגיעים אליו מהבית, בשורת הפיתוח: "צלילים".
- לכל צליל יש שלושה כפתורים: "נוכחי" (מה שהאפליקציה משמיעה היום), "מועמד", והרטט שהצליל מגיע איתו במשחק.
- הצלילים מתנגנים בעוצמה שלהם במשחק (`sfx.ts`). מתג "עוצמה מלאה" מנגן ב־1.0, לכיול.
- במסך הזה הצלילים נשמעים גם במצב שקט וגם כשההגדרה "צליל" כבויה. רק עוצמת המכשיר קובעת.
- המסך והקבצים קיימים רק ב־Development Build. גרסת ה־release לא כוללת אותם (`startupGraph.test.ts` בודק).

## רישיון

- **הכל CC0 1.0.** הקרדיטים ונוסח הרישיון: `LICENSE.txt` בתיקייה הזו.
- 26 קבצים מ־7 חבילות של Kenney.
- 4 קבצים מ־OpenGameArt, כל אחד בדף שמסומן CC0: זיקוקים, חתולים, צחקוק והקשת אצבעות. ל־Kenney אין צלילים כאלה.
- שאר החבילות שנבדקו ולא נבחר מהן: Casino Audio, ‏Voiceover Pack ו־Voiceover Pack: Fighter.

## פורמט ועיבוד

- **‏WAV, ‏16 ביט, מונו, ‏44.1 kHz.** החבילות של Kenney מגיעות ב־OGG, ו־iOS לא מנגן OGG. לכן הקבצים פוענחו (Web Audio של Chrome) ונשמרו כ־WAV.
- **הגודל:** 1.36 MB לכל 30 הקבצים. החבילות עצמן לא נכנסו לפרויקט.
- מה נעשה לכל קובץ:
  1. השקט בהתחלה הוסר (מתחת ל־‎−50 dBFS), וגם הזנב השקט בסוף (60 dB מתחת לשיא).
  2. כשהמקור ארוך מהמותר בסעיף 8, נלקח קטע או קיצור, עם דעיכה בסוף (עמודת "עיבוד").
  3. **עוצמה אחידה:** היעד ‎−10.0 dB, במדידה "לרמקול של טלפון": חלון של 50 ms, אחרי מסנן שמוריד את מה שמתחת ל־150 Hz ומוסיף 4 dB מעל 1.7 kHz. השיא אף פעם לא עובר ‎−1 dBFS.
- היעד ‎−10.0 dB נבחר כי זה בערך החציון של ה־placeholders באותה מדידה. כך ההשוואה ביניהם הוגנת: צליל חזק יותר נשמע "טוב יותר" רק בגלל העוצמה.
- **צליל קצר מאוד** (טיק, קליק, הקשת אצבעות) מגיע לשיא לפני שהוא מגיע ליעד, ולכן הוא שקט יותר. בטבלה הוא מסומן "(שיא)".

## הטבלה

- **עוצמה:** המדידה שלמעלה, אחרי העיבוד.
- **מול ה־placeholder:** בכמה dB המועמד חזק (+) או חלש (−) מהצליל של היום, באותה עוצמה ב־`sfx.ts`. כשמקדמים מועמד, זה הכיוון לכיול.

| צליל | מקור | קובץ מקורי | עיבוד | אורך (ms) | עוצמה (dB) | מול ה־placeholder (dB) |
|---|---|---|---|---|---|---|
| `cell_select` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `select_002.ogg` | הגברה ‎0.0 dB (שיא) | 40 | ‎−15.8 | ‎−0.9 |
| `cell_denied` | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactGeneric_light_000.ogg` | הגברה ‎+0.2 dB (שיא) | 138 | ‎−16.7 | ‎−4.2 |
| `cell_release` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `back_002.ogg` | הגברה ‎0.0 dB (שיא) | 68 | ‎−16.1 | ‎−10.7 |
| `correct` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `confirmation_002.ogg` | עד 0.5 ש׳, דעיכה 80 ms, הגברה ‎−3.4 dB | 500 | ‎−10.0 | ‎−2.1 |
| `count_tick` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `tick_002.ogg` | הגברה ‎+0.2 dB (שיא) | 20 | ‎−16.8 | ‎−3.2 |
| `wrong` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `error_007.ogg` | הגברה ‎−0.1 dB (שיא) | 192 | ‎−10.6 | ‎−1.6 |
| `lock_tick` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `tick_004.ogg` | הגברה ‎−0.1 dB (שיא) | 52 | ‎−12.2 | ‎+5.9 |
| `arsenal_open` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `maximize_008.ogg` | הגברה ‎−2.1 dB | 224 | ‎−10.0 | ‎+0.2 |
| `interfere_whoosh` | [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) | `knifeSlice.ogg` | עד 0.5 ש׳, דעיכה 80 ms, הגברה ‎+0.3 dB | 408 | ‎−10.0 | ‎−1.6 |
| `interfere_launch` | [Kenney Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `explosionCrunch_002.ogg` | עד 0.6 ש׳, דעיכה 250 ms, הגברה ‎0.0 dB (שיא) | 600 | ‎−11.3 | ‎+1.9 |
| `hit_fireworks` | [OpenGameArt, rubberduck](https://opengameart.org/content/25-cc0-bang-firework-sfx) | `fw_04.ogg` | דעיכה 300 ms, הגברה ‎−0.9 dB (שיא) | 2244 | ‎−18.1 | ‎−5.6 |
| `hit_cats` | [OpenGameArt, Kerzoven](https://opengameart.org/content/cat-purr-meow) | `cat_mewfood.wav` | דעיכה 100 ms, הגברה ‎+2.5 dB | 1125 | ‎−10.0 | ‎−3.8 |
| `hit_warp` | [Kenney Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `engineCircular_002.ogg` | קטע 0–2.5 ש׳, כניסה 150 ms, דעיכה 300 ms, הגברה ‎+0.1 dB (שיא) | 2500 | ‎−11.5 | ‎−2.3 |
| `react_laugh` | [OpenGameArt, Nocturnal_Vanguard (AuraVoice)](https://opengameart.org/content/group-giggling) | `group_giggling.ogg` | קטע 0.08–0.72 ש׳, דעיכה 80 ms, הגברה ‎+1.9 dB | 640 | ‎−10.0 | ‎+1.3 |
| `react_scream` | [Kenney Digital Audio](https://kenney.nl/assets/digital-audio) | `highDown.ogg` | הגברה ‎−5.6 dB | 426 | ‎−10.0 | ‎−2.7 |
| `react_cool` | [OpenGameArt, Vinrax](https://opengameart.org/content/snap-of-the-fingers-sounds) | `snap_of_the_fingers3.wav` | הגברה ‎+0.4 dB (שיא) | 104 | ‎−21.6 | ‎−11.6 |
| `react_facepalm` | [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) | `bookClose.ogg` | הגברה ‎−1.1 dB (שיא) | 231 | ‎−14.1 | ‎−0.7 |
| `react_fire` | [Kenney Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `thrusterFire_004.ogg` | קטע 0.2–0.9 ש׳, כניסה 120 ms, דעיכה 350 ms, הגברה ‎+2.9 dB (שיא) | 700 | ‎−16.4 | ‎−3.1 |
| `react_eyes` | [Kenney Digital Audio](https://kenney.nl/assets/digital-audio) | `phaseJump1.ogg` | הגברה ‎+2.8 dB | 373 | ‎−10.0 | ‎−3.3 |
| `react_pop` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `drop_002.ogg` | הגברה ‎+0.1 dB (שיא) | 188 | ‎−14.0 | ‎−2.6 |
| `match_found` | [Kenney Music Jingles (Steel)](https://kenney.nl/assets/music-jingles) | `jingles_STEEL08.ogg` | עד 0.7 ש׳, דעיכה 150 ms, הגברה ‎+0.7 dB | 700 | ‎−10.0 | ‎−2.5 |
| `countdown_beat` | [Kenney Music Jingles (Hit)](https://kenney.nl/assets/music-jingles) | `jingles_HIT07.ogg` | הגברה ‎+3.4 dB (שיא) | 252 | ‎−11.3 | ‎+2.6 |
| `go` | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactBell_heavy_000.ogg` | עד 1.5 ש׳, דעיכה 200 ms, הגברה ‎+0.1 dB (שיא) | 1480 | ‎−15.3 | ‎−5.3 |
| `win` | [Kenney Music Jingles (Steel)](https://kenney.nl/assets/music-jingles) | `jingles_STEEL10.ogg` | דעיכה 100 ms, הגברה ‎+0.3 dB (שיא) | 909 | ‎−10.4 | ‎−1.0 |
| `lose` | [Kenney Music Jingles (Steel)](https://kenney.nl/assets/music-jingles) | `jingles_STEEL11.ogg` | דעיכה 100 ms, הגברה ‎−0.3 dB (שיא) | 825 | ‎−10.5 | ‎−1.6 |
| `lead_take` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `maximize_009.ogg` | הגברה ‎−3.9 dB | 222 | ‎−10.0 | ‎−3.4 |
| `lead_lose` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `minimize_009.ogg` | הגברה ‎−3.9 dB | 206 | ‎−10.0 | ‎−3.2 |
| `disconnect` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `minimize_006.ogg` | הגברה ‎−1.0 dB | 370 | ‎−10.0 | ‎−3.3 |
| `reconnect` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | `maximize_006.ogg` | הגברה ‎−1.0 dB | 380 | ‎−10.0 | ‎−3.5 |
| `ui_tap` | [Kenney UI Audio](https://kenney.nl/assets/ui-audio) | `click2.ogg` | הגברה ‎+1.3 dB (שיא) | 53 | ‎−19.3 | ‎−3.6 |

## למה כל אחד, ומה החלופה

החלופה היא קובץ אחר מאותם מקורות (CC0). היא **לא** הועתקה לפרויקט: אם משה רוצה לשמוע אותה, מכינים אותה באותו עיבוד.

| צליל | למה הוא | החלופה, אם הוא לא טוב |
|---|---|---|
| `cell_select` | טיק יבש, 40 ms | Interface Sounds ‏`select_001` |
| `cell_denied` | נקישה עמומה וקצרה. התדרים האמצעיים שלה נשמעים גם ברמקול של טלפון | Impact Sounds ‏`impactWood_light_000` (נקישת עץ) |
| `cell_release` | טיק "חזרה" רך, 68 ms | Interface Sounds ‏`back_004` |
| `correct` | "דינג" בהיר: קפיצה של אוקטבה, D5 ואז D6 | Interface Sounds ‏`confirmation_001` |
| `count_tick` | טיק של 20 ms. נשמע גם בעוצמה 0.3 | Interface Sounds ‏`click_002` (רך יותר, ושקט ב־3.5 dB) |
| `wrong` | זמזום נמוך, 192 ms. ברור גם ברמקול של טלפון | Interface Sounds ‏`error_008` (רך יותר, ושקט ב־8 dB) |
| `lock_tick` | טיק של 52 ms, כמו שעון | Interface Sounds ‏`tick_002` |
| `arsenal_open` | החלקה נמוכה ועולה, C4 עד G4 | Interface Sounds ‏`maximize_007` (גבוה יותר) |
| `interfere_whoosh` | "ווש" של אוויר: רעש, בלי צלצול של מתכת | RPG Audio ‏`cloth1` (רך יותר, של בד) |
| `interfere_launch` | פיצוץ "פריך", מקוצר ל־0.6 שניות | Impact Sounds ‏`impactPunch_medium_000` (חבטה) |
| `hit_fireworks` | הקלטה של זיקוקים אמיתיים: פיצוצים ופצפוצים, 2.2 שניות | מאותו דף: `fw_loop.ogg` (לופ של 15 שניות, לוקחים ממנו קטע) |
| `hit_cats` | שני "מיאו" אמיתיים | OpenGameArt, ‏"Kitten Mew" של AntumDeluge ‏(`kitten_mew-1.wav`) |
| `hit_warp` | זמזום של מנוע עם תנודה של בערך 9 פעמים בשנייה. קטע של 2.5 שניות | Digital Audio ‏`laser4` (שתי "יריות" לייזר מתעקלות) |
| `react_laugh` | צחקוק: 0.64 השניות הראשונות של ההקלטה | Music Jingles ‏`PIZZI16` (פיציקטו קופצני) |
| `react_scream` | "אאאה" סינתטי שיורד מ־F#6 ל־G#4. תחליף: לא מצאתי התנשפות ב־CC0 | Sci-fi Sounds ‏`laserRetro_002` |
| `react_cool` | הקשת אצבעות | Music Jingles ‏`NES03` (מנגינת 8 ביט קצרה) |
| `react_facepalm` | טפיחה רכה ושטוחה (ספר שנסגר) | RPG Audio ‏`bookPlace1` |
| `react_fire` | להבה של מנוע, 0.7 שניות שעולות ודועכות ("פוווש") | RPG Audio ‏`knifeSlice2` ("ווש") |
| `react_eyes` | "בוינג" קטן שעולה, F3 עד G#4 | Interface Sounds ‏`question_002` |
| `react_pop` | פופ רך, 188 ms | Interface Sounds ‏`drop_003` |
| `match_found` | שני צלילים עולים של תוף פלדה, D4 ואז E4 | Music Jingles ‏`PIZZI08` (אותם צלילים, בפיציקטו) |
| `countdown_beat` | מכת תוף קצרה, 0.25 שניות | Impact Sounds ‏`impactPunch_medium_000` |
| `go` | מכה של פעמון כבד, קרובה לגונג. בלי קהל מריע | Impact Sounds ‏`impactBell_heavy_001` (ארוך ונמוך יותר) |
| `win` | ריצה עולה של תוף פלדה: D-E-F#-G | Music Jingles ‏`PIZZI10` (אותה מנגינה, בפיציקטו) |
| `lose` | אותה ריצה, בירידה: G-F#-E-D | Music Jingles ‏`PIZZI11` (אותה מנגינה, בפיציקטו) |
| `lead_take` | "סוויש" קצר שעולה, C#6 עד G#6 | Interface Sounds ‏`maximize_007` |
| `lead_lose` | הראי שלו: יורד, G6 עד D6 | Interface Sounds ‏`minimize_007` |
| `disconnect` | צלילים יורדים, D5 עד C#4 | Music Jingles ‏`PIZZI09` (E4 ואז D4) |
| `reconnect` | הראי שלו: עולים, C4 עד D5 | Music Jingles ‏`PIZZI08` (D4 ואז E4) |
| `ui_tap` | קליק רך, 53 ms | Interface Sounds ‏`click_001` |

## מה כדאי לדעת לפני שבוחרים

- **הבחירה נעשתה לפי מדידות, לא לפי האזנה:** אורך, עוצמה, כמה מהצליל נמצא בתדרים שרמקול של טלפון משמיע, וכיוון הצליל (עולה או יורד). האוזניים של משה מכריעות.
- **צלילים שהם תחליף, ולא בדיוק מה שהטבלה בסעיף 8 מבקשת:**
  - `react_scream`: לא מצאתי התנשפות ב־CC0. זה צליל סינתטי יורד.
  - `go`: מכה של פעמון כבד, בלי "קהל מריע".
  - `hit_warp`: זמזום של מנוע עם תנודה (בערך 9 פעמים בשנייה), לא סינתיסייזר מתנודד.
  - `react_fire`: קטע של 0.7 שניות מלהבת מנוע.
  - `hit_cats`: שני "מיאו" אמיתיים, בלי ריצה.
- **אורכי ההפרעות:** ‏`hit_fireworks` (2.2 ש׳), ‏`hit_cats` (1.1 ש׳) ו־`hit_warp` (2.5 ש׳) קצרים מ־5 השניות של ההפרעה. הם מתנגנים פעם אחת, בתחילתה.
- **רחוקים מה־placeholder בעוצמה** (4 dB או יותר). אם הם נבחרים, כנראה צריך לכייל להם את העוצמה ב־`sfx.ts`:
  - `react_cool`: חלש ב־‎11.6 dB (מוגבל בשיא: אי אפשר להגביר את הקובץ עצמו).
  - `cell_release`: חלש ב־‎10.7 dB (מוגבל בשיא: אי אפשר להגביר את הקובץ עצמו).
  - `hit_fireworks`: חלש ב־‎5.6 dB (מוגבל בשיא: אי אפשר להגביר את הקובץ עצמו).
  - `go`: חלש ב־‎5.3 dB (מוגבל בשיא: אי אפשר להגביר את הקובץ עצמו).
  - `cell_denied`: חלש ב־‎4.2 dB (מוגבל בשיא: אי אפשר להגביר את הקובץ עצמו).
  - `lock_tick`: חזק ב־‎5.9 dB.
- טיקים וקליקים שקטים מהשאר מטבעם (מסומנים "(שיא)" בטבלה). זה בסדר: גם העוצמות שלהם ב־`sfx.ts` נמוכות (0.3 עד 0.5).
- **משפחה אחת:** רוב צלילי הממשק מ־Kenney Interface Sounds. ניצחון, הפסד ו"נמצא משחק" מאותה סדרה של תופי פלדה (Music Jingles): הניצחון עולה D-E-F#-G, וההפסד הוא אותה מנגינה בירידה.
