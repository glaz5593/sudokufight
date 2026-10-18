-- Puzzles that left the bank file (spec §20) [D43]: db:seed-puzzles marks them retired instead of deleting them,
-- since stored games and play histories point at them. A retired puzzle is never picked for a new game.
ALTER TABLE "puzzles" ADD COLUMN "retired_at" timestamp with time zone;
