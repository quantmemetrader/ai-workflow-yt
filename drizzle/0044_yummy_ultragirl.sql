CREATE TABLE "accounting_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"period" text NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"note" text,
	"reopened_at" timestamp with time zone,
	"reopened_by" text,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "builtin_key" text;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_periods_period_idx" ON "accounting_periods" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_builtin_idx" ON "templates" USING btree ("tenant_id","builtin_key");