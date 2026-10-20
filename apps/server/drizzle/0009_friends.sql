-- Playing with friends (1.0.4, docs/handoff/2026-10-19/friends-room.md §4, §7.1) [D81a]: the XP each seat earned
-- from a game on the server, so a friends game's XP (games.mode 'friends') can share practice's daily cap
-- (progress/practice.ts practiceXpUsedOn). Nullable, no default, no backfill: the previous server version still
-- runs on it, and the games stored before it keep null.
ALTER TABLE "game_players" ADD COLUMN "xp" integer;
