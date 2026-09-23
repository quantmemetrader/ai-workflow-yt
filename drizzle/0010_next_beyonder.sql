CREATE TYPE "public"."spend_state" AS ENUM('draft', 'awaiting_approval', 'approved', 'rejected', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."journal_state" AS ENUM('draft', 'posted', 'void');--> statement-breakpoint
CREATE TYPE "public"."contract_state" AS ENUM('draft', 'in_review', 'sent', 'signed', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."application_stage" AS ENUM('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."leave_state" AS ENUM('requested', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "actuals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"centre_id" text,
	"period" text NOT NULL,
	"amount_micros" bigint DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"entered_by" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"centre_id" text NOT NULL,
	"period" text NOT NULL,
	"amount_micros" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centres" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text DEFAULT 'department' NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"decider_id" text NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_micros" bigint NOT NULL,
	"centre_id" text,
	"state" "spend_state" DEFAULT 'draft' NOT NULL,
	"approvals_needed" bigint DEFAULT 1 NOT NULL,
	"requested_by" text NOT NULL,
	"needed_by" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"file_id" text,
	"title" text NOT NULL,
	"supplier" text,
	"document_date" text,
	"amount_micros" bigint,
	"currency" text DEFAULT 'HKD' NOT NULL,
	"note" text,
	"entered_at" timestamp with time zone,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text,
	"period" text NOT NULL,
	"entry_date" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"state" "journal_state" DEFAULT 'draft' NOT NULL,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "checklist_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"checklist_id" text NOT NULL,
	"subject" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ran_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_checklists" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clause_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"clause" text NOT NULL,
	"template_text" text,
	"contract_text" text,
	"explanation" text DEFAULT '' NOT NULL,
	"departure" text DEFAULT 'changed' NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"template_id" text,
	"title" text NOT NULL,
	"counterparty" text,
	"body" text DEFAULT '' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "contract_state" DEFAULT 'draft' NOT NULL,
	"signed_on" text,
	"expires_on" text,
	"file_id" text,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'agreement' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"requisition_id" text NOT NULL,
	"stage" "application_stage" DEFAULT 'applied' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"source" text DEFAULT 'direct' NOT NULL,
	"notes" text,
	"file_id" text,
	"consent_at" timestamp with time zone,
	"retain_until" text,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"employee_no" text,
	"job_title" text,
	"department" text,
	"manager_id" text,
	"started_on" text,
	"ended_on" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"kind" text DEFAULT 'annual' NOT NULL,
	"entitlement_days" real DEFAULT 0 NOT NULL,
	"carried_days" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'annual' NOT NULL,
	"start_on" text NOT NULL,
	"end_on" text NOT NULL,
	"days" real DEFAULT 1 NOT NULL,
	"reason" text,
	"state" "leave_state" DEFAULT 'requested' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"due_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"department" text,
	"headcount" integer DEFAULT 1 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"opened_by" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_centre_id_cost_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_centre_id_cost_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_decisions" ADD CONSTRAINT "spend_decisions_request_id_spend_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."spend_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_decisions" ADD CONSTRAINT "spend_decisions_decider_id_users_id_fk" FOREIGN KEY ("decider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_requests" ADD CONSTRAINT "spend_requests_centre_id_cost_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_requests" ADD CONSTRAINT "spend_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_checklist_id_compliance_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."compliance_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_ran_by_users_id_fk" FOREIGN KEY ("ran_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_findings" ADD CONSTRAINT "clause_findings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_findings" ADD CONSTRAINT "clause_findings_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_records" ADD CONSTRAINT "employee_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_records" ADD CONSTRAINT "employee_records_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actuals_period_idx" ON "actuals" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_idx" ON "budget_lines" USING btree ("centre_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centres_idx" ON "cost_centres" USING btree ("tenant_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_decisions_idx" ON "spend_decisions" USING btree ("request_id","decider_id");--> statement-breakpoint
CREATE INDEX "spend_requests_idx" ON "spend_requests" USING btree ("tenant_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_idx" ON "accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "documents_idx" ON "documents" USING btree ("tenant_id","entered_at");--> statement-breakpoint
CREATE INDEX "journal_entries_idx" ON "journal_entries" USING btree ("tenant_id","period","state");--> statement-breakpoint
CREATE INDEX "journal_lines_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "checklist_runs_idx" ON "checklist_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "checklists_idx" ON "compliance_checklists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "clause_findings_idx" ON "clause_findings" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_idx" ON "contracts" USING btree ("tenant_id","state","expires_on");--> statement-breakpoint
CREATE INDEX "templates_idx" ON "templates" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_idx" ON "applications" USING btree ("candidate_id","requisition_id");--> statement-breakpoint
CREATE INDEX "candidates_idx" ON "candidates" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_records_idx" ON "employee_records" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_idx" ON "leave_balances" USING btree ("tenant_id","user_id","year","kind");--> statement-breakpoint
CREATE INDEX "leave_requests_idx" ON "leave_requests" USING btree ("tenant_id","state","start_on");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_idx" ON "onboarding_tasks" USING btree ("tenant_id","user_id","done");--> statement-breakpoint
CREATE INDEX "requisitions_idx" ON "requisitions" USING btree ("tenant_id","state");