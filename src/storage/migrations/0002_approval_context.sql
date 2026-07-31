ALTER TABLE "approvals" ADD COLUMN "approval_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "approval_message_id" bigint;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "source_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "source_message_id" bigint;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "requested_by_name" text;