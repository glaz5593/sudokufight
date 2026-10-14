-- Moderation, after review (spec §3.5): the names admins reset away, which nobody may take again; and the
-- one-way fingerprints of a suspended account's sign-in once it is deleted, so a new account with the same
-- sign-in starts suspended instead of the deletion lifting the suspension. Both start empty.
CREATE TABLE "retired_names" (
	"name_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspended_sign_ins" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"suspended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suspended_sign_ins" ADD CONSTRAINT "suspended_sign_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspended_sign_ins_user_idx" ON "suspended_sign_ins" USING btree ("user_id");