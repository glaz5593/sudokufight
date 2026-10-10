CREATE TABLE "achievements" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"rule" jsonb NOT NULL,
	CONSTRAINT "achievements_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "app_events" (
	"id" text PRIMARY KEY NOT NULL,
	"install_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"t_client" timestamp with time zone NOT NULL,
	"t_server" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cheat_flags" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cheat_flags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"game_id" text,
	"reason" text NOT NULL,
	"value" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"game_id" text NOT NULL,
	"seq" integer NOT NULL,
	"t_ms" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "game_events_game_id_seq_pk" PRIMARY KEY("game_id","seq")
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" text NOT NULL,
	"user_id" text,
	"seat" smallint NOT NULL,
	"final_score" real,
	"mistakes" integer,
	"place" smallint,
	"status" text NOT NULL,
	"rating_key" text,
	"rating_before" real,
	"rating_after" real,
	CONSTRAINT "game_players_game_id_seat_pk" PRIMARY KEY("game_id","seat")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"game_type" text NOT NULL,
	"player_count" smallint NOT NULL,
	"puzzle_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "installs" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "opponent_history" (
	"user_id" text NOT NULL,
	"opponent_id" text NOT NULL,
	"game_type" text NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opponent_history_user_id_opponent_id_game_type_pk" PRIMARY KEY("user_id","opponent_id","game_type")
);
--> statement-breakpoint
CREATE TABLE "puzzle_history" (
	"user_id" text NOT NULL,
	"puzzle_id" text NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_history_user_id_puzzle_id_pk" PRIMARY KEY("user_id","puzzle_id")
);
--> statement-breakpoint
CREATE TABLE "puzzles" (
	"id" text PRIMARY KEY NOT NULL,
	"givens" char(81) NOT NULL,
	"solution" char(81) NOT NULL,
	"game_type" text NOT NULL,
	"techniques" text[] DEFAULT '{}'::text[] NOT NULL,
	"givens_count" smallint NOT NULL,
	"source" text NOT NULL,
	"pool" text NOT NULL,
	CONSTRAINT "puzzles_pool_check" CHECK ("puzzles"."pool" in ('offline', 'ranked'))
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"user_id" text NOT NULL,
	"rating_key" text NOT NULL,
	"rating" real NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"peak" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_user_id_rating_key_pk" PRIMARY KEY("user_id","rating_key")
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" text NOT NULL,
	"achievement_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"firebase_uid" text NOT NULL,
	"display_name" text NOT NULL,
	"display_name_changed_at" timestamp with time zone,
	"country" text,
	"avatar_id" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid")
);
--> statement-breakpoint
CREATE TABLE "xp" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_install_id_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "public"."installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheat_flags" ADD CONSTRAINT "cheat_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheat_flags" ADD CONSTRAINT "cheat_flags_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installs" ADD CONSTRAINT "installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opponent_history" ADD CONSTRAINT "opponent_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opponent_history" ADD CONSTRAINT "opponent_history_opponent_id_users_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_history" ADD CONSTRAINT "puzzle_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_history" ADD CONSTRAINT "puzzle_history_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp" ADD CONSTRAINT "xp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_events_install_t_idx" ON "app_events" USING btree ("install_id","t_client");--> statement-breakpoint
CREATE INDEX "app_events_name_t_server_idx" ON "app_events" USING btree ("name","t_server");--> statement-breakpoint
CREATE INDEX "app_events_t_server_idx" ON "app_events" USING btree ("t_server");--> statement-breakpoint
CREATE INDEX "cheat_flags_user_idx" ON "cheat_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cheat_flags_created_at_idx" ON "cheat_flags" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "game_players_user_idx" ON "game_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "games_started_at_idx" ON "games" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "games_mode_started_at_idx" ON "games" USING btree ("mode","started_at");--> statement-breakpoint
CREATE INDEX "installs_last_seen_idx" ON "installs" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "installs_first_seen_idx" ON "installs" USING btree ("first_seen");--> statement-breakpoint
CREATE INDEX "installs_user_idx" ON "installs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "puzzles_pool_type_idx" ON "puzzles" USING btree ("pool","game_type");--> statement-breakpoint
CREATE INDEX "ratings_key_rating_idx" ON "ratings" USING btree ("rating_key","rating" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_display_name_lower_uq" ON "users" USING btree (lower("display_name"));