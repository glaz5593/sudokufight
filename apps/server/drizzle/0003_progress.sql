-- Stage 12 (progress). game_players.best_move_points is filled when a game ends from now on; games stored
-- earlier keep null (no backfill: their game_events could give it, but the player card counts from here).
CREATE TABLE "practice_results" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"game_type" text NOT NULL,
	"outcome" text NOT NULL,
	"correct" smallint NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"xp" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_results_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "practice_results_mode_check" CHECK ("practice_results"."mode" in ('solo', 'bot'))
);
--> statement-breakpoint
DROP INDEX "ratings_key_rating_idx";--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "best_move_points" real;--> statement-breakpoint
ALTER TABLE "practice_results" ADD CONSTRAINT "practice_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_results_user_ended_idx" ON "practice_results" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX "ratings_board_idx" ON "ratings" USING btree ("rating_key","rating" DESC NULLS LAST,"user_id") WHERE "ratings"."games" > 0;--> statement-breakpoint
CREATE INDEX "ratings_general_idx" ON "ratings" USING btree ("rating" DESC NULLS LAST,"user_id") WHERE "ratings"."games" > 0;--> statement-breakpoint
CREATE INDEX "users_deleted_idx" ON "users" USING btree ("id") WHERE "users"."deleted_at" is not null;