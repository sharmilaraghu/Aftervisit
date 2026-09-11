ALTER TABLE "follow_up_plans" ADD COLUMN "schedule_quotes" jsonb;--> statement-breakpoint
ALTER TABLE "follow_up_plans" ADD COLUMN "condition_summary" text;--> statement-breakpoint
ALTER TABLE "follow_up_plans" ADD COLUMN "condition_summary_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_up_plans" ADD COLUMN "condition_summary_call_id" text;--> statement-breakpoint
ALTER TABLE "plan_questions" ADD COLUMN "anchor_quote" text;--> statement-breakpoint
ALTER TABLE "plan_questions" ADD COLUMN "watch_point" text;