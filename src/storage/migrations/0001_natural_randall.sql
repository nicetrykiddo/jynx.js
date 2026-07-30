ALTER TABLE "approvals" ADD COLUMN "stage" text DEFAULT 'idea' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "task_id" integer;