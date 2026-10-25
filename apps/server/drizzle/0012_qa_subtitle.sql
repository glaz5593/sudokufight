-- The QA module (docs/handoff/2026-10-23/qa-module/plan.md; src/qa): qa_items.subtitle, the one sentence under a
-- task's title ("בדוק …"), copied from the catalog when a run opens like the rest of the task. A nullable column
-- only, no backfill: the items of the runs opened before it keep null (the admin screen shows just the title), and
-- the previous server version still runs on it.
ALTER TABLE "qa_items" ADD COLUMN "subtitle" text;