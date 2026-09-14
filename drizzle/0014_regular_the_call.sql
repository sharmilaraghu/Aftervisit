ALTER TABLE "scheduled_calls" DROP CONSTRAINT "calls_skip_reason";--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD COLUMN "kind" text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "calls_kind" CHECK ("scheduled_calls"."kind" in ('planned', 'try'));--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "calls_skip_reason" CHECK ("skip_reason" is null or "skip_reason" in ('plan_paused', 'plan_closed', 'patient_archived', 'too_late', 'clinician_skipped'));