CREATE TYPE "public"."change_kind" AS ENUM('create', 'update', 'metadata', 'restore', 'delete', 'unarchive');--> statement-breakpoint
CREATE TYPE "public"."change_state" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('hivatkozik', 'szarmazik', 'epit_ra', 'helyettesiti');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('draft', 'pending', 'changes_requested', 'approved');--> statement-breakpoint
CREATE TYPE "public"."reviewer_end_reason" AS ENUM('replaced', 'removed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."space_role" AS ENUM('author', 'space_manager');--> statement-breakpoint
CREATE TYPE "public"."space_type" AS ENUM('general', 'team', 'project');--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('user', 'system_admin');--> statement-breakpoint
CREATE TABLE "allowlist" (
	"email" text PRIMARY KEY NOT NULL,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "allowlist_email_lower" CHECK ("allowlist"."email" = lower("allowlist"."email"))
);
--> statement-breakpoint
CREATE TABLE "change_request_reviewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_decision",
	"reason" text,
	"decided_at" timestamp with time zone,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "reviewer_end_reason",
	CONSTRAINT "crr_reject_needs_reason" CHECK ("change_request_reviewers"."decision" IS DISTINCT FROM 'rejected' OR ("change_request_reviewers"."reason" IS NOT NULL AND btrim("change_request_reviewers"."reason") <> '')),
	CONSTRAINT "crr_decision_decided_at" CHECK (("change_request_reviewers"."decision" IS NULL) = ("change_request_reviewers"."decided_at" IS NULL)),
	CONSTRAINT "crr_end_consistent" CHECK (("change_request_reviewers"."ended_at" IS NULL) = ("change_request_reviewers"."end_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" "change_kind" NOT NULL,
	"base_revision_id" uuid,
	"proposed_revision_id" uuid,
	"proposed_review_due_at" timestamp with time zone,
	"initiator_id" uuid NOT NULL,
	"message" text,
	"state" "change_state" DEFAULT 'pending' NOT NULL,
	"iteration" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "cr_proposal_rules" CHECK ((
    ("change_requests"."kind" IN ('delete','unarchive') AND "change_requests"."proposed_revision_id" IS NULL)
    OR ("change_requests"."kind" NOT IN ('delete','unarchive') AND ("change_requests"."state" NOT IN ('pending','approved') OR "change_requests"."proposed_revision_id" IS NOT NULL))
  )),
	CONSTRAINT "cr_due_rules" CHECK (("change_requests"."kind" IN ('delete','unarchive')) = ("change_requests"."proposed_review_due_at" IS NULL)),
	CONSTRAINT "cr_state_fields" CHECK (("change_requests"."state" = 'pending') = ("change_requests"."decided_at" IS NULL) AND ("change_requests"."state" = 'approved') = ("change_requests"."iteration" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_collab_state" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"pending_contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"last_edit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_kinds" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" "link_type" NOT NULL,
	"anchor_text" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "document_links_no_self" CHECK ("document_links"."from_id" <> "document_links"."to_id")
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"author_id" uuid NOT NULL,
	"contributors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"message" text,
	"restored_from_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_doc_id_uq" UNIQUE("document_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"document_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "document_tags_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tag_text" text DEFAULT '' NOT NULL,
	"review_state" "review_state" DEFAULT 'draft' NOT NULL,
	"approved_revision_id" uuid,
	"iteration" integer DEFAULT 0 NOT NULL,
	"review_due_at" timestamp with time zone,
	"freshness_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_approved_has_revision" CHECK ("documents"."review_state" <> 'approved' OR "documents"."approved_revision_id" IS NOT NULL),
	CONSTRAINT "documents_iteration_nonneg" CHECK ("documents"."iteration" >= 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"space_id" uuid,
	"document_id" uuid,
	"change_request_id" uuid,
	"actor_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_actor_required" CHECK ("events"."actor_id" IS NOT NULL OR "events"."type" IN (
    'review_due_soon','review_due','review_reminder','review_stalled',
    'allowlist_added','allowlist_removed','user_pseudonymized','retention_purge')),
	CONSTRAINT "events_document_has_space" CHECK ("events"."document_id" IS NULL OR "events"."space_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_document_id_pk" PRIMARY KEY("user_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "membership_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"via_document_id" uuid,
	"message" text,
	"state" "request_state" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" bigint NOT NULL,
	"category" text NOT NULL,
	"read_at" timestamp with time zone,
	"email_due" boolean DEFAULT false NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_category_ck" CHECK ("notifications"."category" IN (
    'review_request','review_stalled','reviewer_vacated','own_request','changes_requested','review_due',
    'mention','comment','followed_change','link_replaced','link_removed_by_target','member_added',
    'membership_request','membership_decision','space_request','space_request_decision'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" "bytea" PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "space_role" NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"proposed_manager_id" uuid NOT NULL,
	"state" "request_state" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_space_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "space_type" NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "spaces_closed_only_project" CHECK ("spaces"."closed_at" IS NULL OR "spaces"."type" = 'project')
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_document_id_pk" PRIMARY KEY("user_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_space_colors" (
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"color" text NOT NULL,
	CONSTRAINT "user_space_colors_user_id_space_id_pk" PRIMARY KEY("user_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_sub" text,
	"email" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"system_role" "system_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"pseudonymized_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "allowlist" ADD CONSTRAINT "allowlist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_reviewers" ADD CONSTRAINT "change_request_reviewers_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_reviewers" ADD CONSTRAINT "change_request_reviewers_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collab_state" ADD CONSTRAINT "document_collab_state_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_from_id_documents_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_to_id_documents_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_document_kinds_key_fk" FOREIGN KEY ("kind") REFERENCES "public"."document_kinds"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_requests" ADD CONSTRAINT "space_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_requests" ADD CONSTRAINT "space_requests_proposed_manager_id_users_id_fk" FOREIGN KEY ("proposed_manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_requests" ADD CONSTRAINT "space_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_requests" ADD CONSTRAINT "space_requests_created_space_id_spaces_id_fk" FOREIGN KEY ("created_space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_space_colors" ADD CONSTRAINT "user_space_colors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_space_colors" ADD CONSTRAINT "user_space_colors_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crr_change_request_idx" ON "change_request_reviewers" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "crr_reviewer_pending_idx" ON "change_request_reviewers" USING btree ("reviewer_id") WHERE "change_request_reviewers"."decision" IS NULL AND "change_request_reviewers"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "change_requests_doc_idx" ON "change_requests" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "change_requests_initiator_idx" ON "change_requests" USING btree ("initiator_id","state");--> statement-breakpoint
CREATE INDEX "change_requests_proposed_rev_idx" ON "change_requests" USING btree ("proposed_revision_id") WHERE "change_requests"."proposed_revision_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "change_requests_base_rev_idx" ON "change_requests" USING btree ("base_revision_id") WHERE "change_requests"."base_revision_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "comments_document_idx" ON "comments" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_deleted_idx" ON "comments" USING btree ("deleted_at") WHERE "comments"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_links_from_idx" ON "document_links" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "document_links_to_idx" ON "document_links" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "document_revisions_doc_idx" ON "document_revisions" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_tags_tag_idx" ON "document_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_space_slug_uq" ON "documents" USING btree ("space_id","slug");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_review_due_idx" ON "documents" USING btree ("review_due_at") WHERE "documents"."review_due_at" IS NOT NULL AND "documents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "events_document_idx" ON "events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "events_space_idx" ON "events" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "events_actor_idx" ON "events" USING btree ("actor_id","created_at") WHERE "events"."actor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_created_brin" ON "events" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_digest_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."email_due" AND "notifications"."emailed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "notifications_created_brin" ON "notifications" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_name_lower_uq" ON "spaces" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "subscriptions_document_idx" ON "subscriptions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_normalized_uq" ON "tags" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_sub_uq" ON "users" USING btree ("oidc_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));