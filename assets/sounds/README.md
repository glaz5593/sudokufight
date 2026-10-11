# צלילים

## מה יש כאן עכשיו: placeholder

הקבצים ב־`placeholder/` הם **צלילים זמניים שנוצרו בקוד**, כדי שהמשחק יישמע כבר בשלב 4.
הם לא הצלילים הסופיים, ו**צריך להחליף אותם** (תוכנית העבודה, שלב 4 ושלב 14).

- **רישיון:** אין. הם סונתזו מגלי סינוס, משולש ורעש, בסקריפט שבפרויקט. אין בהם חומר של צד שלישי, ולכן אין רישיון לבדוק.
- **איך נוצרו:** הסקריפט `apps/mobile/scripts/gen-placeholder-sounds.mjs`.
  להרצה מחדש (התוצאה זהה בכל הרצה):
  ```
  node apps/mobile/scripts/gen-placeholder-sounds.mjs
  ```
- **פורמט:** ‏WAV, מונו, ‏16 ביט, ‏22.05 kHz. כל קובץ קצר מ־0.4 שניות ושוקל פחות מ־20 KB.
  לכן גם צלילי ההפרעה (`hit_*`) קצרים כאן, אף שהקבצים הסופיים יהיו באורך של עד 5 שניות.
- **שמות הקבצים:** בדיוק לפי הטבלה ב־`docs/design/motion.md`, סעיף 8 (למשל `cell_select`, ‏`correct`, ‏`wrong`).

## מועמדים: `candidates/`

- **‏30 קבצי CC0, אחד לכל צליל**, באותו שם: `candidates/correct.wav` וכן הלאה. רובם מ־Kenney, וארבעה מ־OpenGameArt.
- **האפליקציה לא משמיעה אותם.** הם רק להאזנה, עד שמשה בוחר.
- **איך שומעים:** במסך הפיתוח `/dev/sounds` (בבית, בשורת הפיתוח: "צלילים"). לכל צליל: "נוכחי", "מועמד" והרטט שלו.
- **מאיפה כל קובץ, מה נעשה בו, והעוצמה שלו:** `candidates/SOURCES.md`. הרישיון והקרדיטים: `candidates/LICENSE.txt`.
- **הם לא נכנסים ל־release:** רק `apps/mobile/src/components/dev/soundCandidates.ts` טוען אותם, ורק מסך הפיתוח טוען את הקובץ הזה, מאחורי `__DEV__`. הבדיקה `startupGraph.test.ts` שומרת על זה.

## איך מקדמים מועמד שמשה בחר

דוגמה: המועמד של `correct`.

1. **מעבירים את הקובץ** מ־`candidates/` לתיקייה הזו:
   ```
   git mv assets/sounds/candidates/correct.wav assets/sounds/correct.wav
   ```
2. **מעדכנים את הנתיב** של הצליל ב־`SOUND_SOURCES`, בקובץ `apps/mobile/src/services/sfx.ts`:
   `placeholder/correct.wav` הופך ל־`correct.wav`.
3. **מוחקים את השורה של הצליל** מ־`apps/mobile/src/components/dev/soundCandidates.ts`.
   - בלי זה Metro נכשל, כי הקובץ כבר לא שם.
   - במסך `/dev/sounds`, הכפתור "נוכחי" משמיע מעכשיו את הצליל החדש, ו"מועמד" כבוי.
4. **מעבירים את הקרדיט:** את השורה של הצליל מ־`candidates/SOURCES.md` לרשימת הקרדיטים למטה, ואת המקור מ־`candidates/LICENSE.txt` אם הוא חדש שם.
5. **מוחקים את ה־placeholder** של אותו צליל: `placeholder/correct.wav`.
6. **מכיילים את העוצמה:** ב־`VOLUME`, בקובץ `sfx.ts`, מקשיבים במשחק עצמו.
   - נקודת התחלה: העמודה "מול ה־placeholder" ב־`SOURCES.md`.
   - למשל, מועמד חלש ב־6 dB צריך עוצמה כפולה (‎10^(6/20) ≈ 2) כדי להישמע כמו היום. עד 1.0 לכל היותר.
   - במסך `/dev/sounds`, המתג "עוצמה מלאה" עוזר לשמוע את הקובץ עצמו, בלי העוצמה של המשחק.
7. **מריצים את הבדיקות:** `npx jest apps/mobile/src --selectProjects mobile`.

**אפשרות מהירה יותר**, בלי לשנות קוד: מעתיקים את המועמד על ה־placeholder (`candidates/correct.wav` אל `placeholder/correct.wav`).
זה טוב לניסיון במשחק, אבל לא כמצב סופי: השם `placeholder/` יטעה, והבדיקה ב־`sfx.test.ts` מצפה שם לקבצים של 22.05 kHz בלבד, ולכן היא תיכשל.

**כשכל הצלילים קודמו:** מוחקים את `candidates/`, את `placeholder/` ואת `scripts/gen-placeholder-sounds.mjs`. ב־`soundCandidates.ts` נשארת רשימה ריקה (`{}`), כדי שמסך הפיתוח ימשיך לעבוד.

## איך מחליפים בצליל סופי ממקור אחר

1. שמים את הקובץ ב־`assets/sounds/` (לא ב־`placeholder/`), עם אותו שם: למשל `assets/sounds/correct.m4a`.
   - **רישיון CC0 בלבד.** לכל קובץ רושמים את כתובת המקור ואת היוצר ברשימת הקרדיטים, לבדיקת החנויות.
   - ‏`.m4a` (AAC), ‏`.mp3` או `.wav`, ‏44.1 kHz, מונו. בלי שקט בהתחלה, ושיא של ‎−1 dBFS לכל היותר.
   - **לא `.ogg`:** ‏iOS לא מנגן אותו.
2. מעדכנים את הנתיב של אותו צליל ב־`SOUND_SOURCES`, בקובץ `apps/mobile/src/services/sfx.ts`.
3. מריצים את הבדיקות: `npx jest apps/mobile/src/services --selectProjects mobile`.
4. כשכל הצלילים הוחלפו, מוחקים את התיקייה `placeholder/` ואת הסקריפט.

## קרדיטים של הצלילים הסופיים

עוד אין. כל צליל שמקודם מ־`candidates/` מוסיף כאן שורה: הצליל, המקור (חבילה או דף), הקובץ המקורי והיוצר.

הרשימה המלאה של האירועים, הצלילים והעוצמות: `docs/design/motion.md`, סעיפים 7 ו־8.
המיפוי בקוד, מאירוע לצליל ולרטט: `apps/mobile/src/services/feedback.ts`.
