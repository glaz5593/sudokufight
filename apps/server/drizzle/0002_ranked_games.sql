ALTER TABLE "puzzle_history" DROP CONSTRAINT "puzzle_history_user_id_puzzle_id_pk";--> statement-breakpoint
ALTER TABLE "puzzle_history" ADD CONSTRAINT "puzzle_history_user_id_puzzle_id_played_at_pk" PRIMARY KEY("user_id","puzzle_id","played_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cheat_flags_game_user_reason_uq" ON "cheat_flags" USING btree ("game_id","user_id","reason");