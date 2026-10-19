-- Staged practice (1.0.2, spec §5.3.7, §15) [D55, D57]: each level's best as the phone reports it (PUT
-- /v1/me/levels), kept at the max ever sent, and the level XP paid on each UTC day (it shares practice's daily cap).
-- Two new tables, both empty; no existing table changes, so the previous server version still runs on it.
CREATE TABLE "level_xp_days" (
	"user_id" text NOT NULL,
	"day" integer NOT NULL,
	"xp" integer NOT NULL,
	CONSTRAINT "level_xp_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "user_levels" (
	"user_id" text NOT NULL,
	"level_id" text NOT NULL,
	"best_stars" smallint NOT NULL,
	"plays" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_levels_user_id_level_id_pk" PRIMARY KEY("user_id","level_id"),
	CONSTRAINT "user_levels_level_id_check" CHECK ("user_levels"."level_id" ~ '^L[0-9]{3,4}$'),
	CONSTRAINT "user_levels_best_stars_check" CHECK ("user_levels"."best_stars" between 0 and 3),
	CONSTRAINT "user_levels_plays_check" CHECK ("user_levels"."plays" >= 0)
);
--> statement-breakpoint
ALTER TABLE "level_xp_days" ADD CONSTRAINT "level_xp_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_levels" ADD CONSTRAINT "user_levels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;