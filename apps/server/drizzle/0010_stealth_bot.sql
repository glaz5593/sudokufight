-- The stealth bot (docs/handoff/2026-10-19/stealth-bot.md §6, §7, §8) [D90-D99]: users.kind ('person' or
-- 'persona': a stealth bot's account), personas (what only the server knows of one), games.stealth (a seat was a
-- persona), each person's pace in a ranked game (game_players.pace_ms, pace_moves, pace_digits) [D96, D97a], and
-- server_settings (switches an admin turns without a restart: the stealth bot's on/off). Defaults and nulls only,
-- no backfill: every existing account is a person, every stored game is not stealth and has no pace, and the
-- previous server version still runs on it.
CREATE TABLE "personas" (
	"user_id" text PRIMARY KEY NOT NULL,
	"temperament" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personas_temperament_check" CHECK ("personas"."temperament" in ('quiet', 'normal', 'lively'))
);
--> statement-breakpoint
CREATE TABLE "server_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "pace_ms" integer;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "pace_moves" integer;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "pace_digits" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "stealth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_persona_idx" ON "users" USING btree ("id") WHERE "users"."kind" = 'persona';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_kind_check" CHECK ("users"."kind" in ('person', 'persona'));