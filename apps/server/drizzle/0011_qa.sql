-- The QA module (docs/handoff/2026-10-23/qa-module/plan.md; src/qa): qa_runs (a test run of one app version,
-- opened from the catalog apps/server/data/qa-catalog.json) and qa_items (each task the run took, copied whole so a
-- later catalog never changes it, with its latest mark and its bug state). New tables only: nothing existing
-- changes, and the previous server version still runs on it.
CREATE TABLE "qa_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qa_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"position" integer NOT NULL,
	"category_id" text NOT NULL,
	"category_title" text NOT NULL,
	"subcategory_id" text NOT NULL,
	"subcategory_title" text NOT NULL,
	"task_id" text NOT NULL,
	"title" text NOT NULL,
	"steps" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"who" text NOT NULL,
	"source" text,
	"result" text DEFAULT 'untested' NOT NULL,
	"actual" text,
	"note" text,
	"tested_by" text,
	"tested_at" timestamp with time zone,
	"bug_status" text,
	"fix_note" text,
	"fixed_in" text,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	CONSTRAINT "qa_items_who_check" CHECK ("qa_items"."who" in ('claude', 'moshe', 'both')),
	CONSTRAINT "qa_items_result_check" CHECK ("qa_items"."result" in ('untested', 'pass', 'partial', 'fail')),
	CONSTRAINT "qa_items_bug_status_check" CHECK ("qa_items"."bug_status" in ('open', 'handled', 'verified', 'reopened'))
);
--> statement-breakpoint
CREATE TABLE "qa_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qa_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"app_version" text NOT NULL,
	"device" text,
	"platform" text,
	"engine_version" text NOT NULL,
	"catalog_version" integer NOT NULL,
	"filter" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "qa_runs_platform_check" CHECK ("qa_runs"."platform" in ('android', 'ios')),
	CONSTRAINT "qa_runs_status_check" CHECK ("qa_runs"."status" in ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "qa_items" ADD CONSTRAINT "qa_items_run_id_qa_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."qa_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qa_items_run_task_uq" ON "qa_items" USING btree ("run_id","task_id");--> statement-breakpoint
CREATE INDEX "qa_items_bug_idx" ON "qa_items" USING btree ("bug_status","tested_at") WHERE "qa_items"."bug_status" is not null;