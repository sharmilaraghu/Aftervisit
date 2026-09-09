CREATE TABLE "call_triage" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"summary" text,
	"key_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quote" text,
	"provider" text,
	"model" text,
	"raw" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_status" CHECK ("status" in ('ok', 'unavailable', 'error', 'unparseable')),
	CONSTRAINT "triage_verdict" CHECK ("verdict" in ('severe', 'escalate', 'low')),
	CONSTRAINT "triage_provider" CHECK ("provider" is null or "provider" in ('gemini', 'openai'))
);
--> statement-breakpoint
ALTER TABLE "plan_questions" ALTER COLUMN "ordinal" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD COLUMN "escalation_note" text;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD COLUMN "amended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "triage_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "plan_questions" ADD COLUMN "last_compile_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_triage" ADD CONSTRAINT "call_triage_call_id_scheduled_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."scheduled_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_triage" ADD CONSTRAINT "call_triage_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_triage" ADD CONSTRAINT "call_triage_plan_id_follow_up_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."follow_up_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_triage_call" ON "call_triage" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "idx_triage_patient" ON "call_triage" USING btree ("patient_id","created_at");