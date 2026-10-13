-- Our own avatars (spec §3.4, 2026-10-12): the first pack (av01–av51 without av36) is retired. Every
-- account that still holds one of its ids gets its replacement from LEGACY_AVATAR_MAP
-- (packages/protocol/src/account.ts): the same pairs (a server test compares them). Nothing else stores a bare
-- avatar id; whatever still holds an old one (a backup restored later) is read through normalizeAvatarId.
UPDATE "users" SET "avatar_id" = CASE "avatar_id"
	WHEN 'av01' THEN 'microphone'
	WHEN 'av02' THEN 'balloon'
	WHEN 'av03' THEN 'cassette'
	WHEN 'av04' THEN 'astronaut'
	WHEN 'av05' THEN 'sun'
	WHEN 'av06' THEN 'alarm-clock'
	WHEN 'av07' THEN 'lava-lamp'
	WHEN 'av08' THEN 'dana'
	WHEN 'av09' THEN 'sufganiya'
	WHEN 'av10' THEN 'boxing-glove'
	WHEN 'av11' THEN 'pencil'
	WHEN 'av12' THEN 'maya'
	WHEN 'av13' THEN 'cotton-candy'
	WHEN 'av14' THEN 'question-mark'
	WHEN 'av15' THEN 'ruthie'
	WHEN 'av16' THEN 'joystick'
	WHEN 'av17' THEN 'coffee-cup'
	WHEN 'av18' THEN 'comet'
	WHEN 'av19' THEN 'punk'
	WHEN 'av20' THEN 'omer'
	WHEN 'av21' THEN 'puzzle-cube'
	WHEN 'av22' THEN 'calculator'
	WHEN 'av23' THEN 'hourglass'
	WHEN 'av24' THEN 'pirate'
	WHEN 'av25' THEN 'paper-clip'
	WHEN 'av26' THEN 'cactus'
	WHEN 'av27' THEN 'wave'
	WHEN 'av28' THEN 'lightbulb'
	WHEN 'av29' THEN 'shadow'
	WHEN 'av30' THEN 'accordion'
	WHEN 'av31' THEN 'sudoku-board'
	WHEN 'av32' THEN 'noam'
	WHEN 'av33' THEN 'trophy'
	WHEN 'av34' THEN 'luchador'
	WHEN 'av35' THEN 'ido'
	WHEN 'av37' THEN 'magnet'
	WHEN 'av38' THEN 'chef'
	WHEN 'av39' THEN 'professor'
	WHEN 'av40' THEN 'furry-monster'
	WHEN 'av41' THEN 'panda'
	WHEN 'av42' THEN 'frog'
	WHEN 'av43' THEN 'mushroom'
	WHEN 'av44' THEN 'hatchling'
	WHEN 'av45' THEN 'pillow'
	WHEN 'av46' THEN 'cat'
	WHEN 'av47' THEN 'ice-cream'
	WHEN 'av48' THEN 'rabbit'
	WHEN 'av49' THEN 'owl'
	WHEN 'av50' THEN 'fox'
	WHEN 'av51' THEN 'moon'
END
WHERE "avatar_id" IN (
	'av01', 'av02', 'av03', 'av04', 'av05', 'av06', 'av07', 'av08', 'av09', 'av10',
	'av11', 'av12', 'av13', 'av14', 'av15', 'av16', 'av17', 'av18', 'av19', 'av20',
	'av21', 'av22', 'av23', 'av24', 'av25', 'av26', 'av27', 'av28', 'av29', 'av30',
	'av31', 'av32', 'av33', 'av34', 'av35', 'av37', 'av38', 'av39', 'av40', 'av41',
	'av42', 'av43', 'av44', 'av45', 'av46', 'av47', 'av48', 'av49', 'av50', 'av51'
);
