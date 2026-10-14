-- Moderation (spec §3.5; docs/store/UGC-PROPOSAL.md option A, approved 2026-10-12): player reports with
-- three fixed reasons (one open report per reporter, player and reason), blocks between players, the admins'
-- audit log, and two account flags for the admin's actions (a suspension, a name reset waiting for a new
-- name). Existing accounts start neither suspended nor reset.
CREATE TABLE "admin_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"reported_id" text NOT NULL,
	"reason" text NOT NULL,
	"game_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "player_reports_reason_check" CHECK ("player_reports"."reason" in ('offensiveName', 'cheating', 'other')),
	CONSTRAINT "player_reports_status_check" CHECK ("player_reports"."status" in ('open', 'resolved', 'dismissed')),
	CONSTRAINT "player_reports_not_self" CHECK ("player_reports"."reporter_id" <> "player_reports"."reported_id")
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_reset_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_reported_id_users_id_fk" FOREIGN KEY ("reported_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reports" ADD CONSTRAINT "player_reports_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_at_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_reports_open_uq" ON "player_reports" USING btree ("reporter_id","reported_id","reason") WHERE "player_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "player_reports_status_idx" ON "player_reports" USING btree ("status","reported_id","created_at");--> statement-breakpoint
CREATE INDEX "player_reports_reported_idx" ON "player_reports" USING btree ("reported_id","created_at");--> statement-breakpoint
CREATE INDEX "player_reports_reporter_idx" ON "player_reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");