CREATE TABLE "visits" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"kind" text NOT NULL,
	"visit_date" date NOT NULL,
	"reported_symptoms" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"note_id" text,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_kind" CHECK ("kind" in ('consultation', 'post_op')),
	CONSTRAINT "visits_status" CHECK ("status" in ('waiting', 'seen', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_note_id_consultation_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."consultation_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_visits_waiting" ON "visits" USING btree ("visit_date","created_at") WHERE "visits"."status" = 'waiting';