ALTER TABLE "visits" DROP CONSTRAINT "visits_status";--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_status" CHECK ("status" in ('waiting', 'seen', 'cancelled', 'no_show'));