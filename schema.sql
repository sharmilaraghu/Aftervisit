--
-- AfterVisit -- the schema as it exists, dumped from the live database.
--
-- Reference only. This is NOT a migration and must never be applied as one.
-- The schema is owned by lib/db/schema.ts and changed with `pnpm run db:generate`
-- (AGENTS.md rule 11). Regenerate this file rather than editing it.
--
-- 9 tables. Every enum is a text column with a CHECK, never a Postgres enum,
-- so adding a value stays a migration rather than type surgery. NOT NULL is
-- shown on the column, so the NOT NULL pseudo-constraints Postgres 17 reports
-- separately are omitted.
--

-- ==========================================================================
-- patients  --  Who may be called, and whether they agreed to be.
-- ==========================================================================
CREATE TABLE patients (
  id                           text NOT NULL,
  name                         text NOT NULL,
  age                          smallint NOT NULL,
  phone_e164                   text NOT NULL,
  timezone                     text NOT NULL,
  ai_call_consent              text NOT NULL DEFAULT 'unknown'::text,
  ai_call_consent_at           timestamptz,
  ai_call_consent_source       text,
  archived_at                  timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  language                     text NOT NULL DEFAULT 'en-US'::text
);

ALTER TABLE patients ADD CONSTRAINT patients_pkey PRIMARY KEY (id);
ALTER TABLE patients ADD CONSTRAINT patients_consent_source CHECK (((ai_call_consent_source IS NULL) OR (ai_call_consent_source = ANY (ARRAY['registration'::text, 'call'::text]))));
ALTER TABLE patients ADD CONSTRAINT patients_consent CHECK ((ai_call_consent = ANY (ARRAY['unknown'::text, 'granted'::text, 'declined'::text])));
ALTER TABLE patients ADD CONSTRAINT patients_age CHECK (((age >= 0) AND (age < 130)));
ALTER TABLE patients ADD CONSTRAINT patients_phone_e164 CHECK ((phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text));
CREATE INDEX idx_patients_active ON public.patients USING btree (archived_at) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX uniq_patients_phone ON public.patients USING btree (phone_e164) WHERE (archived_at IS NULL);

-- ==========================================================================
-- consultation_notes  --  What the doctor wrote, and how the compiler read it.
-- ==========================================================================
CREATE TABLE consultation_notes (
  id                           text NOT NULL,
  patient_id                   text NOT NULL,
  author_name                  text NOT NULL DEFAULT 'Dr Rao'::text,
  body                         text NOT NULL,
  compile_status               text NOT NULL DEFAULT 'pending'::text,
  compile_provider             text,
  compile_model                text,
  compile_raw                  jsonb,
  compile_error                text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  escalation_note              text,
  amended_at                   timestamptz
);

ALTER TABLE consultation_notes ADD CONSTRAINT consultation_notes_pkey PRIMARY KEY (id);
ALTER TABLE consultation_notes ADD CONSTRAINT consultation_notes_patient_id_patients_id_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
ALTER TABLE consultation_notes ADD CONSTRAINT notes_compile_status CHECK ((compile_status = ANY (ARRAY['pending'::text, 'compiled'::text, 'refused'::text])));
ALTER TABLE consultation_notes ADD CONSTRAINT notes_compile_provider CHECK (((compile_provider IS NULL) OR (compile_provider = ANY (ARRAY['gemini'::text, 'openai'::text]))));
CREATE INDEX idx_notes_patient ON public.consultation_notes USING btree (patient_id, created_at);

-- ==========================================================================
-- follow_up_plans  --  One episode of follow-up: its schedule, status, and how it ended.
-- ==========================================================================
CREATE TABLE follow_up_plans (
  id                           text NOT NULL,
  patient_id                   text NOT NULL,
  note_id                      text NOT NULL,
  version                      integer NOT NULL DEFAULT 1,
  supersedes_plan_id           text,
  status                       text NOT NULL DEFAULT 'awaiting_approval'::text,
  reason                       text NOT NULL,
  condition                    text,
  duration_days                integer NOT NULL DEFAULT 7,
  cadence                      text NOT NULL DEFAULT 'daily'::text,
  local_time                   text NOT NULL DEFAULT '10:00'::text,
  time_scale                   integer NOT NULL DEFAULT 1,
  max_attempts                 integer NOT NULL DEFAULT 3,
  retry_delay_minutes          integer NOT NULL DEFAULT 120,
  starts_at                    timestamptz,
  ends_at                      timestamptz,
  approved_at                  timestamptz,
  approved_by                  text,
  rules                        jsonb NOT NULL DEFAULT '[]'::jsonb,
  red_flag_terms               jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_schema                jsonb NOT NULL DEFAULT '{}'::jsonb,
  paused_at                    timestamptz,
  paused_reason                text,
  paused_by_escalation_id      text,
  resumed_at                   timestamptz,
  resumed_by                   text,
  closed_at                    timestamptz,
  close_reason                 text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  closing_summary              text
);

ALTER TABLE follow_up_plans ADD CONSTRAINT follow_up_plans_pkey PRIMARY KEY (id);
ALTER TABLE follow_up_plans ADD CONSTRAINT follow_up_plans_patient_id_patients_id_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
ALTER TABLE follow_up_plans ADD CONSTRAINT follow_up_plans_note_id_consultation_notes_id_fk FOREIGN KEY (note_id) REFERENCES consultation_notes(id) ON DELETE RESTRICT;
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_status CHECK ((status = ANY (ARRAY['awaiting_approval'::text, 'active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_cadence CHECK ((cadence = ANY (ARRAY['daily'::text, 'every_other_day'::text, 'weekly'::text])));
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_close_reason CHECK (((close_reason IS NULL) OR (close_reason = ANY (ARRAY['duration_elapsed'::text, 'clinician_closed'::text, 'patient_declined'::text, 'superseded'::text]))));
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_duration CHECK ((duration_days > 0));
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_time_scale CHECK ((time_scale > 0));
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_max_attempts CHECK ((max_attempts > 0));
ALTER TABLE follow_up_plans ADD CONSTRAINT plans_local_time CHECK ((local_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text));
CREATE INDEX idx_plans_due_close ON public.follow_up_plans USING btree (ends_at) WHERE (status = 'active'::text);
CREATE INDEX idx_plans_patient ON public.follow_up_plans USING btree (patient_id, created_at);
CREATE UNIQUE INDEX uniq_live_plan_per_patient ON public.follow_up_plans USING btree (patient_id) WHERE (status = ANY (ARRAY['active'::text, 'paused'::text]));

-- ==========================================================================
-- plan_questions  --  What the agent asks, in order, with the guard's verdict on each.
-- ==========================================================================
CREATE TABLE plan_questions (
  id                           text NOT NULL,
  plan_id                      text NOT NULL,
  question_id                  text NOT NULL,
  ordinal                      double precision NOT NULL,
  prompt                       text NOT NULL,
  answer_type                  text NOT NULL,
  enum_values                  jsonb,
  required                     boolean NOT NULL DEFAULT true,
  source                       text NOT NULL DEFAULT 'default'::text,
  guard_status                 text NOT NULL DEFAULT 'pending'::text,
  guard_findings               jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  last_compile_at              timestamptz,
  added_at                     timestamptz
);

ALTER TABLE plan_questions ADD CONSTRAINT plan_questions_pkey PRIMARY KEY (id);
ALTER TABLE plan_questions ADD CONSTRAINT plan_questions_plan_id_follow_up_plans_id_fk FOREIGN KEY (plan_id) REFERENCES follow_up_plans(id) ON DELETE CASCADE;
ALTER TABLE plan_questions ADD CONSTRAINT questions_answer_type CHECK ((answer_type = ANY (ARRAY['boolean'::text, 'scale_0_10'::text, 'enum'::text, 'text'::text])));
ALTER TABLE plan_questions ADD CONSTRAINT questions_guard_status CHECK ((guard_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE plan_questions ADD CONSTRAINT questions_source CHECK ((source = ANY (ARRAY['note'::text, 'default'::text, 'clinician'::text, 'locked'::text])));
CREATE UNIQUE INDEX uniq_q_ordinal ON public.plan_questions USING btree (plan_id, ordinal);
CREATE UNIQUE INDEX uniq_q_slug ON public.plan_questions USING btree (plan_id, question_id);

-- ==========================================================================
-- scheduled_calls  --  One row per (plan, occurrence, attempt). Written before the dial.
-- ==========================================================================
CREATE TABLE scheduled_calls (
  id                           text NOT NULL,
  plan_id                      text NOT NULL,
  patient_id                   text NOT NULL,
  occurrence                   integer NOT NULL,
  attempt                      integer NOT NULL DEFAULT 1,
  idempotency_key              text NOT NULL,
  scheduled_for                timestamptz NOT NULL,
  status                       text NOT NULL DEFAULT 'scheduled'::text,
  claimed_at                   timestamptz,
  claimed_by                   text,
  task                         text,
  calle_call_id                text,
  dialed_at                    timestamptz,
  calle_status                 text,
  calle_failure_code           text,
  calle_failure_message        text,
  result_status                text NOT NULL DEFAULT 'pending'::text,
  structured_result            jsonb,
  summary                      text,
  task_completed               boolean,
  completion_confidence        jsonb,
  evidence                     jsonb,
  transcript                   jsonb,
  calle_raw                    jsonb,
  transcript_guard_findings    jsonb,
  refusal_reason               text,
  refusal_detail               text,
  skip_reason                  text,
  outcome                      text,
  retry_of_call_id             text,
  finished_at                  timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  answered_by                  text
);

ALTER TABLE scheduled_calls ADD CONSTRAINT scheduled_calls_pkey PRIMARY KEY (id);
ALTER TABLE scheduled_calls ADD CONSTRAINT scheduled_calls_plan_id_follow_up_plans_id_fk FOREIGN KEY (plan_id) REFERENCES follow_up_plans(id) ON DELETE RESTRICT;
ALTER TABLE scheduled_calls ADD CONSTRAINT scheduled_calls_patient_id_patients_id_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_result_status CHECK ((result_status = ANY (ARRAY['pending'::text, 'present'::text, 'null_result'::text])));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_calle_status CHECK (((calle_status IS NULL) OR (calle_status = ANY (ARRAY['queued'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'canceled'::text]))));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_skip_reason CHECK (((skip_reason IS NULL) OR (skip_reason = ANY (ARRAY['plan_paused'::text, 'plan_closed'::text, 'patient_archived'::text, 'too_late'::text]))));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_result_consistency CHECK (((structured_result IS NOT NULL) = (result_status = 'present'::text)));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_status CHECK ((status = ANY (ARRAY['scheduled'::text, 'claimed'::text, 'dialing'::text, 'completed'::text, 'failed'::text, 'refused'::text, 'skipped'::text, 'cancelled'::text])));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_attempt CHECK ((attempt > 0));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_outcome CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['answered'::text, 'no_answer'::text, 'flagged'::text, 'unmappable'::text, 'refused'::text]))));
ALTER TABLE scheduled_calls ADD CONSTRAINT calls_occurrence CHECK ((occurrence > 0));
CREATE INDEX idx_calls_due ON public.scheduled_calls USING btree (scheduled_for) WHERE (status = 'scheduled'::text);
CREATE INDEX idx_calls_patient_time ON public.scheduled_calls USING btree (patient_id, scheduled_for);
CREATE INDEX idx_calls_plan_occ ON public.scheduled_calls USING btree (plan_id, occurrence);
CREATE INDEX idx_calls_reconcile ON public.scheduled_calls USING btree (dialed_at) WHERE (status = ANY (ARRAY['claimed'::text, 'dialing'::text]));
CREATE UNIQUE INDEX uniq_call_idem ON public.scheduled_calls USING btree (idempotency_key);
CREATE UNIQUE INDEX uniq_call_slot ON public.scheduled_calls USING btree (plan_id, occurrence, attempt);
CREATE UNIQUE INDEX uniq_calle_call_id ON public.scheduled_calls USING btree (calle_call_id) WHERE (calle_call_id IS NOT NULL);

-- ==========================================================================
-- extracted_slots  --  CALL-E's structuredResult mapped to typed answers.
-- ==========================================================================
CREATE TABLE extracted_slots (
  id                           text NOT NULL,
  call_id                      text NOT NULL,
  patient_id                   text NOT NULL,
  question_id                  text NOT NULL,
  status                       text NOT NULL,
  value_bool                   boolean,
  value_number                 integer,
  value_text                   text,
  raw_value                    jsonb,
  utterance                    text,
  utterance_offset_seconds     integer,
  extracted_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE extracted_slots ADD CONSTRAINT extracted_slots_pkey PRIMARY KEY (id);
ALTER TABLE extracted_slots ADD CONSTRAINT extracted_slots_call_id_scheduled_calls_id_fk FOREIGN KEY (call_id) REFERENCES scheduled_calls(id) ON DELETE CASCADE;
ALTER TABLE extracted_slots ADD CONSTRAINT extracted_slots_patient_id_patients_id_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
ALTER TABLE extracted_slots ADD CONSTRAINT slots_scale_range CHECK (((value_number IS NULL) OR ((value_number >= 0) AND (value_number <= 10))));
ALTER TABLE extracted_slots ADD CONSTRAINT slots_status CHECK ((status = ANY (ARRAY['answered'::text, 'unmappable'::text, 'missing'::text, 'refused'::text])));
CREATE INDEX idx_slots_patient_q ON public.extracted_slots USING btree (patient_id, question_id, extracted_at);
CREATE UNIQUE INDEX uniq_slot ON public.extracted_slots USING btree (call_id, question_id);

-- ==========================================================================
-- call_triage  --  The model's reading of a finished call.
-- ==========================================================================
CREATE TABLE call_triage (
  id                           text NOT NULL,
  call_id                      text NOT NULL,
  patient_id                   text NOT NULL,
  plan_id                      text NOT NULL,
  status                       text NOT NULL,
  verdict                      text NOT NULL,
  reason                       text NOT NULL,
  summary                      text,
  key_terms                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_concerns             jsonb NOT NULL DEFAULT '[]'::jsonb,
  quote                        text,
  provider                     text,
  model                        text,
  raw                          jsonb,
  error                        text,
  created_at                   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE call_triage ADD CONSTRAINT call_triage_pkey PRIMARY KEY (id);
ALTER TABLE call_triage ADD CONSTRAINT call_triage_patient_id_patients_id_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
ALTER TABLE call_triage ADD CONSTRAINT call_triage_plan_id_follow_up_plans_id_fk FOREIGN KEY (plan_id) REFERENCES follow_up_plans(id) ON DELETE RESTRICT;
ALTER TABLE call_triage ADD CONSTRAINT call_triage_call_id_scheduled_calls_id_fk FOREIGN KEY (call_id) REFERENCES scheduled_calls(id) ON DELETE CASCADE;
ALTER TABLE call_triage ADD CONSTRAINT triage_verdict CHECK ((verdict = ANY (ARRAY['severe'::text, 'escalate'::text, 'low'::text])));
ALTER TABLE call_triage ADD CONSTRAINT triage_status CHECK ((status = ANY (ARRAY['ok'::text, 'unavailable'::text, 'error'::text, 'unparseable'::text])));
ALTER TABLE call_triage ADD CONSTRAINT triage_provider CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['gemini'::text, 'openai'::text]))));
CREATE INDEX idx_triage_patient ON public.call_triage USING btree (patient_id, created_at);
CREATE UNIQUE INDEX uniq_triage_call ON public.call_triage USING btree (call_id);

-- ==========================================================================
-- escalations  --  Work queued for a human.
-- ==========================================================================
CREATE TABLE escalations (
  id                           text NOT NULL,
  ref                          bigint NOT NULL DEFAULT nextval('escalations_ref_seq'::regclass),
  patient_id                   text NOT NULL,
  plan_id                      text NOT NULL,
  call_id                      text,
  slot_id                      text,
  rule_id                      text NOT NULL,
  rule_label                   text NOT NULL,
  urgent                       boolean NOT NULL,
  reason                       text NOT NULL,
  utterance                    text,
  dedupe_key                   text NOT NULL,
  status                       text NOT NULL DEFAULT 'open'::text,
  paused_plan                  boolean NOT NULL DEFAULT false,
  raised_at                    timestamptz NOT NULL DEFAULT now(),
  resolved_at                  timestamptz,
  resolved_by                  text,
  resolution                   text,
  severity                     text,
  summary                      text,
  triage_id                    text,
  acknowledged_at              timestamptz,
  acknowledged_by              text,
  resolution_note              text,
  floor_hits                   jsonb
);

ALTER TABLE escalations ADD CONSTRAINT escalations_pkey PRIMARY KEY (id);
ALTER TABLE escalations ADD CONSTRAINT escalations_call_id_scheduled_calls_id_fk FOREIGN KEY (call_id) REFERENCES scheduled_calls(id) ON DELETE SET NULL;
ALTER TABLE escalations ADD CONSTRAINT escalations_plan_id_follow_up_plans_id_fk FOREIGN KEY (plan_id) REFERENCES follow_up_plans(id) ON DELETE RESTRICT;
ALTER TABLE escalations ADD CONSTRAINT escalations_patient_id_patients_id_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT;
ALTER TABLE escalations ADD CONSTRAINT escalations_slot_id_extracted_slots_id_fk FOREIGN KEY (slot_id) REFERENCES extracted_slots(id) ON DELETE SET NULL;
ALTER TABLE escalations ADD CONSTRAINT esc_status CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text, 'dismissed'::text])));
ALTER TABLE escalations ADD CONSTRAINT esc_resolution CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['resumed'::text, 'closed'::text, 'contacted_patient'::text, 'no_action'::text]))));
CREATE INDEX idx_esc_patient ON public.escalations USING btree (patient_id, raised_at);
CREATE INDEX idx_queue ON public.escalations USING btree (urgent, raised_at) WHERE (status = ANY (ARRAY['open'::text, 'acknowledged'::text]));
CREATE UNIQUE INDEX uniq_esc_dedupe ON public.escalations USING btree (dedupe_key);

-- ==========================================================================
-- tick_runs  --  One scheduler pass, under a lease.
-- ==========================================================================
CREATE TABLE tick_runs (
  id                           text NOT NULL,
  trigger                      text NOT NULL,
  lease                        text NOT NULL DEFAULT 'global'::text,
  started_at                   timestamptz NOT NULL DEFAULT now(),
  finished_at                  timestamptz,
  expanded                     integer NOT NULL DEFAULT 0,
  claimed                      integer NOT NULL DEFAULT 0,
  dialed                       integer NOT NULL DEFAULT 0,
  refused                      integer NOT NULL DEFAULT 0,
  finished                     integer NOT NULL DEFAULT 0,
  escalated                    integer NOT NULL DEFAULT 0,
  error                        text,
  retired                      integer NOT NULL DEFAULT 0
);

ALTER TABLE tick_runs ADD CONSTRAINT tick_runs_pkey PRIMARY KEY (id);
ALTER TABLE tick_runs ADD CONSTRAINT tick_trigger CHECK ((trigger = ANY (ARRAY['page'::text, 'cron'::text, 'poller'::text, 'manual'::text])));
CREATE INDEX idx_tick_recent ON public.tick_runs USING btree (started_at);
CREATE UNIQUE INDEX uniq_tick_lease ON public.tick_runs USING btree (lease) WHERE (finished_at IS NULL);

