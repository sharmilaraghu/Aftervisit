ALTER TABLE "scheduled_calls" DROP CONSTRAINT "calls_skip_reason";--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "plan_questions" ADD COLUMN "added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD COLUMN "answered_by" text;--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "calls_skip_reason" CHECK ("skip_reason" is null or "skip_reason" in ('plan_paused', 'plan_closed', 'patient_archived', 'too_late'));