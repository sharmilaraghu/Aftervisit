CREATE TABLE "consultation_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"author_name" text DEFAULT 'Dr Rao' NOT NULL,
	"body" text NOT NULL,
	"compile_status" text DEFAULT 'pending' NOT NULL,
	"compile_provider" text,
	"compile_model" text,
	"compile_raw" jsonb,
	"compile_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_compile_status" CHECK ("compile_status" in ('pending', 'compiled', 'refused')),
	CONSTRAINT "notes_compile_provider" CHECK ("compile_provider" is null or "compile_provider" in ('gemini', 'openai'))
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" bigserial NOT NULL,
	"patient_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"call_id" text,
	"slot_id" text,
	"rule_id" text NOT NULL,
	"rule_label" text NOT NULL,
	"urgent" boolean NOT NULL,
	"reason" text NOT NULL,
	"utterance" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"paused_plan" boolean DEFAULT false NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text,
	CONSTRAINT "esc_status" CHECK ("status" in ('open', 'acknowledged', 'resolved', 'dismissed')),
	CONSTRAINT "esc_resolution" CHECK ("resolution" is null or "resolution" in ('resumed', 'closed', 'contacted_patient', 'no_action'))
);
--> statement-breakpoint
CREATE TABLE "extracted_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"question_id" text NOT NULL,
	"status" text NOT NULL,
	"value_bool" boolean,
	"value_number" integer,
	"value_text" text,
	"raw_value" jsonb,
	"utterance" text,
	"utterance_offset_seconds" integer,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_status" CHECK ("status" in ('answered', 'unmappable', 'missing', 'refused')),
	CONSTRAINT "slots_scale_range" CHECK ("extracted_slots"."value_number" is null or ("extracted_slots"."value_number" >= 0 and "extracted_slots"."value_number" <= 10))
);
--> statement-breakpoint
CREATE TABLE "follow_up_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"note_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_plan_id" text,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"reason" text NOT NULL,
	"condition" text,
	"duration_days" integer DEFAULT 7 NOT NULL,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"local_time" text DEFAULT '10:00' NOT NULL,
	"time_scale" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"retry_delay_minutes" integer DEFAULT 120 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"red_flag_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"paused_by_escalation_id" text,
	"resumed_at" timestamp with time zone,
	"resumed_by" text,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_status" CHECK ("status" in ('awaiting_approval', 'active', 'paused', 'completed', 'cancelled')),
	CONSTRAINT "plans_cadence" CHECK ("cadence" in ('daily', 'every_other_day', 'weekly')),
	CONSTRAINT "plans_close_reason" CHECK ("close_reason" is null or "close_reason" in ('duration_elapsed', 'clinician_closed', 'patient_declined', 'superseded')),
	CONSTRAINT "plans_duration" CHECK ("follow_up_plans"."duration_days" > 0),
	CONSTRAINT "plans_time_scale" CHECK ("follow_up_plans"."time_scale" > 0),
	CONSTRAINT "plans_max_attempts" CHECK ("follow_up_plans"."max_attempts" > 0),
	CONSTRAINT "plans_local_time" CHECK ("local_time" ~ '^[0-2][0-9]:[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"age" smallint NOT NULL,
	"phone_e164" text NOT NULL,
	"timezone" text NOT NULL,
	"ai_call_consent" text DEFAULT 'unknown' NOT NULL,
	"ai_call_consent_at" timestamp with time zone,
	"ai_call_consent_source" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_phone_e164" CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "patients_age" CHECK ("patients"."age" >= 0 and "patients"."age" < 130),
	CONSTRAINT "patients_consent" CHECK ("ai_call_consent" in ('unknown', 'granted', 'declined')),
	CONSTRAINT "patients_consent_source" CHECK ("ai_call_consent_source" is null or "ai_call_consent_source" in ('registration', 'call'))
);
--> statement-breakpoint
CREATE TABLE "plan_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"question_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"prompt" text NOT NULL,
	"answer_type" text NOT NULL,
	"enum_values" jsonb,
	"required" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'default' NOT NULL,
	"guard_status" text DEFAULT 'pending' NOT NULL,
	"guard_findings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_answer_type" CHECK ("answer_type" in ('boolean', 'scale_0_10', 'enum', 'text')),
	CONSTRAINT "questions_guard_status" CHECK ("guard_status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "questions_source" CHECK ("source" in ('note', 'default', 'clinician', 'locked'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"occurrence" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"task" text,
	"calle_call_id" text,
	"dialed_at" timestamp with time zone,
	"calle_status" text,
	"calle_failure_code" text,
	"calle_failure_message" text,
	"result_status" text DEFAULT 'pending' NOT NULL,
	"structured_result" jsonb,
	"summary" text,
	"task_completed" boolean,
	"completion_confidence" jsonb,
	"evidence" jsonb,
	"transcript" jsonb,
	"calle_raw" jsonb,
	"transcript_guard_findings" jsonb,
	"refusal_reason" text,
	"refusal_detail" text,
	"skip_reason" text,
	"outcome" text,
	"retry_of_call_id" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_status" CHECK ("status" in ('scheduled', 'claimed', 'dialing', 'completed', 'failed', 'refused', 'skipped', 'cancelled')),
	CONSTRAINT "calls_calle_status" CHECK ("calle_status" is null or "calle_status" in ('queued', 'in_progress', 'completed', 'failed', 'canceled')),
	CONSTRAINT "calls_result_status" CHECK ("result_status" in ('pending', 'present', 'null_result')),
	CONSTRAINT "calls_outcome" CHECK ("outcome" is null or "outcome" in ('answered', 'no_answer', 'flagged', 'unmappable', 'refused')),
	CONSTRAINT "calls_skip_reason" CHECK ("skip_reason" is null or "skip_reason" in ('plan_paused', 'plan_closed', 'patient_archived')),
	CONSTRAINT "calls_occurrence" CHECK ("scheduled_calls"."occurrence" > 0),
	CONSTRAINT "calls_attempt" CHECK ("scheduled_calls"."attempt" > 0),
	CONSTRAINT "calls_result_consistency" CHECK (("structured_result" is not null) = ("result_status" = 'present'))
);
--> statement-breakpoint
CREATE TABLE "tick_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"lease" text DEFAULT 'global' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expanded" integer DEFAULT 0 NOT NULL,
	"claimed" integer DEFAULT 0 NOT NULL,
	"dialed" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL,
	"finished" integer DEFAULT 0 NOT NULL,
	"escalated" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "tick_trigger" CHECK ("trigger" in ('page', 'cron', 'poller', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_plan_id_follow_up_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."follow_up_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_call_id_scheduled_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."scheduled_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_slot_id_extracted_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."extracted_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_slots" ADD CONSTRAINT "extracted_slots_call_id_scheduled_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."scheduled_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_slots" ADD CONSTRAINT "extracted_slots_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_plans" ADD CONSTRAINT "follow_up_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_plans" ADD CONSTRAINT "follow_up_plans_note_id_consultation_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."consultation_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_questions" ADD CONSTRAINT "plan_questions_plan_id_follow_up_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."follow_up_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "scheduled_calls_plan_id_follow_up_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."follow_up_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "scheduled_calls_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notes_patient" ON "consultation_notes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_esc_dedupe" ON "escalations" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_queue" ON "escalations" USING btree ("urgent","raised_at") WHERE "escalations"."status" in ('open', 'acknowledged');--> statement-breakpoint
CREATE INDEX "idx_esc_patient" ON "escalations" USING btree ("patient_id","raised_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_slot" ON "extracted_slots" USING btree ("call_id","question_id");--> statement-breakpoint
CREATE INDEX "idx_slots_patient_q" ON "extracted_slots" USING btree ("patient_id","question_id","extracted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_live_plan_per_patient" ON "follow_up_plans" USING btree ("patient_id") WHERE "follow_up_plans"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "idx_plans_due_close" ON "follow_up_plans" USING btree ("ends_at") WHERE "follow_up_plans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_plans_patient" ON "follow_up_plans" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_patients_active" ON "patients" USING btree ("archived_at") WHERE "patients"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_patients_phone" ON "patients" USING btree ("phone_e164") WHERE "patients"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_q_slug" ON "plan_questions" USING btree ("plan_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_q_ordinal" ON "plan_questions" USING btree ("plan_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_call_slot" ON "scheduled_calls" USING btree ("plan_id","occurrence","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_call_idem" ON "scheduled_calls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_calle_call_id" ON "scheduled_calls" USING btree ("calle_call_id") WHERE "scheduled_calls"."calle_call_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_calls_due" ON "scheduled_calls" USING btree ("scheduled_for") WHERE "scheduled_calls"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "idx_calls_reconcile" ON "scheduled_calls" USING btree ("dialed_at") WHERE "scheduled_calls"."status" in ('claimed', 'dialing');--> statement-breakpoint
CREATE INDEX "idx_calls_patient_time" ON "scheduled_calls" USING btree ("patient_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_calls_plan_occ" ON "scheduled_calls" USING btree ("plan_id","occurrence");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tick_lease" ON "tick_runs" USING btree ("lease") WHERE "tick_runs"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "idx_tick_recent" ON "tick_runs" USING btree ("started_at");