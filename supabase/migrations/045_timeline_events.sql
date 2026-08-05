-- Phase 2 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 045_timeline_events
--
-- Genuinely new table, not a duplicate of an existing one — see
-- docs/PHASE2_UNIFIED_TIMELINE_SPEC.md §1 for why crm.flow_run_events,
-- crm.automation_logs, crm.messages and public.audit_events each cannot
-- carry this. The timeline stores a pointer and a summary for every
-- event, never a second copy of the content (message bodies stay in
-- crm.messages, orders in public.orders, etc.).
--
-- PARTITIONING (decision C4, see docs/PHASE2_CANONICAL_PLAN.md §3) —
-- this table is UNPARTITIONED at creation. That decision revises the
-- original design doc's "partition now, at creation" recommendation,
-- which was sized against a hypothetical 100-brand/100M-event YALI OS
-- future. This repo's own locked decision (CLAUDE.md: "No multi-tenant
-- scaffolding... Laddoos is the only account") means that scale isn't
-- what Phase 2A is actually building toward yet.
--
-- To keep a future conversion to monthly RANGE partitioning on
-- occurred_at CHEAP without paying partitioning's operational cost now,
-- two constraint shapes below are DELIBERATELY composite rather than
-- single-column, because Postgres requires every unique constraint on a
-- partitioned table to include the partition key:
--   - PRIMARY KEY (id, occurred_at) instead of PRIMARY KEY (id)
--   - UNIQUE (account_id, dedupe_key, occurred_at) instead of
--     UNIQUE (account_id, dedupe_key)
-- Both enforce the identical practical guarantee as their single-column
-- originals (id is generated via gen_random_uuid() and is already
-- globally unique in practice; a genuine webhook retry of the same
-- event always carries the same occurred_at, since that column means
-- "when it happened in the world", not "when we processed it" —
-- recorded_at is the latter). Neither composite constraint changes
-- application behaviour today; both exist only to make a future
-- partition conversion a rename-swap instead of a schema rewrite.
--
-- CONSEQUENCE for future migrations: because the primary key is
-- composite, a bare `REFERENCES timeline_events(id)` foreign key from
-- another table is NOT valid (id alone carries no unique constraint,
-- by design — a bare UNIQUE(id) would itself block the future partition
-- conversion this decision exists to protect). A future table that
-- needs referential integrity against a specific event must declare a
-- composite FK: FOREIGN KEY (event_id, event_occurred_at) REFERENCES
-- timeline_events(id, occurred_at). A table that only needs to record
-- an event id for display/audit — not enforce integrity — should do
-- what identity_evidence.source_event_id (044) already does: store the
-- UUID with no FK at all.
--
-- REVISIT TRIGGER for the partitioning decision itself: convert to
-- monthly RANGE partitioning when timeline_events exceeds 5 million
-- rows, or when a second brand/tenant/account is onboarded — whichever
-- comes first. Both are concrete and checkable, not vague future scale.
-- ============================================================

CREATE TABLE IF NOT EXISTS timeline_event_types (
  event_type          TEXT PRIMARY KEY,
  domain              TEXT NOT NULL,
  default_visibility  TEXT NOT NULL DEFAULT 'team'
                        CHECK (default_visibility IN ('team','restricted','sensitive','system')),
  is_customer_action   BOOLEAN NOT NULL DEFAULT false,
  is_meaningful        BOOLEAN NOT NULL DEFAULT false,
  description          TEXT NOT NULL
);

COMMENT ON TABLE timeline_event_types IS
  'The known vocabulary of timeline_events.event_type values, FK-enforced '
  'rather than a CHECK constraint so a future channel can add its own '
  'event types without an ALTER TABLE on timeline_events itself. Seeded '
  'here with only the types Phase 2A (Instagram -> Website -> Timeline) '
  'actually writes; Phase 2B/2C add their own rows in their own '
  'migrations when those channels exist. See '
  'docs/PHASE2_UNIFIED_TIMELINE_SPEC.md §4.';

INSERT INTO timeline_event_types (event_type, domain, default_visibility, is_customer_action, is_meaningful, description) VALUES
  ('message.inbound',  'message', 'team', true,  true,  'Inbound Instagram DM from the customer.'),
  ('message.outbound', 'message', 'team', false, true,  'Outbound Instagram DM to the customer, agent or bot sent.'),
  ('web.visit',           'web', 'team', true,  true,  'First page load of an anonymous or identified web session.'),
  ('web.page_view',       'web', 'team', true,  false, 'A subsequent page view within an existing web session.'),
  ('web.chat_started',    'web', 'team', true,  true,  'Website chat widget opened and a first message sent.'),
  ('web.chat_turn',       'web', 'team', true,  true,  'A message within an existing website chat session.'),
  ('web.form_submitted',  'web', 'team', true,  true,  'A form (e.g. lead capture) submitted on the website.'),
  ('campaign.click',          'campaign', 'team', true,  true,  'Click on an ad or tracked link, prior to token resolution.'),
  ('campaign.token_issued',   'campaign', 'team', false, false, 'A continuation token was issued.'),
  ('campaign.token_redeemed', 'campaign', 'team', false, true,  'A continuation token was successfully resolved.'),
  ('campaign.token_rejected', 'campaign', 'team', false, false, 'A continuation token resolution attempt failed (expired, revoked, invalid, exhausted).'),
  ('identity.handle_observed',    'identity', 'system', false, false, 'A new identity_handles row was recorded.'),
  ('identity.linked',             'identity', 'system', false, false, 'A handle was linked to a contact.'),
  ('identity.rejected',           'identity', 'system', false, false, 'A proposed identity link was rejected by a customer or an agent.'),
  ('identity.verification_sent',  'identity', 'system', false, false, 'A verification challenge was sent for a handle.'),
  ('identity.verified',           'identity', 'system', false, false, 'A handle passed a verification challenge.'),
  ('system.correction', 'system', 'system', false, false, 'A correction to an earlier event. Never edits the original row.')
ON CONFLICT (event_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS timeline_events (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Tenancy. account_id drives RLS; tenant/brand are denormalised so
  -- brain-side joins and the cross-tenant guard need no extra lookup —
  -- unchanged from the reviewed design. NOT NULL is deliberate: an event
  -- with no tenant/brand has no brain-side identity path at all. The
  -- workspace_brand_map (037) row this depends on is a one-time manual
  -- seed step per docs/PHASE1_DEPLOYMENT_RUNBOOK.md; local verification
  -- of this migration seeds a test mapping rather than relaxing this
  -- constraint — see the verification script, not this file.
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  brand_id          UUID NOT NULL,

  -- Identity. handle_id is the IMMUTABLE fact ("this browser did this").
  -- contact_id / customer_id are RESOLVED and may change on merge/split.
  -- This split is what makes the table append-only AND late-bindable —
  -- see docs/PHASE2_UNIFIED_TIMELINE_SPEC.md §3.
  handle_id         UUID REFERENCES identity_handles(id) ON DELETE SET NULL,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_id       UUID,                       -- public.customers.id, no FK (brain-owned); unused in Phase 2A

  -- What happened
  event_type        TEXT NOT NULL REFERENCES timeline_event_types(event_type),
  channel           TEXT NOT NULL,              -- 'instagram', 'web' in Phase 2A
  source             TEXT NOT NULL,              -- 'meta_webhook', 'web_sdk' in Phase 2A
  occurred_at       TIMESTAMPTZ NOT NULL,       -- when it happened in the world
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when we learned of it

  -- Context
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  session_id        UUID,                       -- public.sessions.id, no FK; unused in Phase 2A
  campaign_id       TEXT,
  ad_id             TEXT,
  creative_id       TEXT,

  -- Content: a pointer and a human-readable line. Never the payload itself.
  summary           TEXT NOT NULL,
  payload_ref       JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash      TEXT,                       -- integrity check for external blobs

  -- Governance
  confidence        TEXT NOT NULL DEFAULT 'verified'
                      CHECK (confidence IN
                        ('verified','strong','probable','unknown','rejected')),
  visibility        TEXT NOT NULL DEFAULT 'team'
                      CHECK (visibility IN ('team','restricted','sensitive','system')),
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_state      TEXT NOT NULL DEFAULT 'none'
                      CHECK (action_state IN
                        ('none','open','snoozed','done','dismissed')),
  snoozed_until     TIMESTAMPTZ,

  -- Corrections are new rows, never edits. Soft reference for the same
  -- reason identity_evidence.source_event_id (044) is soft — this
  -- column's target IS this table, so a self-referencing FK would need
  -- to be composite (id, occurred_at) too; kept as a plain UUID pointer
  -- instead, consistent with the pattern established in 044.
  corrects_event_id UUID,

  -- Idempotency: webhooks retry. Same fact must never appear twice.
  dedupe_key        TEXT NOT NULL,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- See this file's header comment for why both of these are composite.
  PRIMARY KEY (id, occurred_at),
  UNIQUE (account_id, dedupe_key, occurred_at)
);

COMMENT ON TABLE timeline_events IS
  'Append-only cross-channel event log. Facts (event_type, occurred_at, '
  'channel, source, summary, payload_ref, handle_id, dedupe_key) are '
  'immutable once written, enforced by trg_timeline_events_immutable '
  'below. Governance columns (contact_id, customer_id, action_state, '
  'snoozed_until, owner_user_id, visibility) may change. Primary key and '
  'the dedupe unique constraint are both composite for future '
  'partitioning readiness — see this file''s header comment. '
  'Phase 2A scope only: this migration seeds message.*/web.*/campaign.*/'
  'identity.*/system.correction event types. See '
  'docs/PHASE2_UNIFIED_TIMELINE_SPEC.md.';

CREATE INDEX IF NOT EXISTS idx_timeline_contact_time
  ON timeline_events (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_handle_time
  ON timeline_events (handle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_account_time
  ON timeline_events (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_open_actions
  ON timeline_events (account_id, action_state, occurred_at DESC)
  WHERE action_state IN ('open','snoozed');
CREATE INDEX IF NOT EXISTS idx_timeline_type_time
  ON timeline_events (account_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_campaign
  ON timeline_events (account_id, campaign_id) WHERE campaign_id IS NOT NULL;

-- ── Append-only enforcement ──────────────────────────────────
-- Grants alone are not enough — action_state, contact_id, customer_id,
-- snoozed_until, owner_user_id and visibility legitimately change. The
-- rule: governance columns are mutable, facts are not.
CREATE OR REPLACE FUNCTION timeline_events_immutable_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
BEGIN
  IF NEW.event_type  IS DISTINCT FROM OLD.event_type
  OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
  OR NEW.channel     IS DISTINCT FROM OLD.channel
  OR NEW.source      IS DISTINCT FROM OLD.source
  OR NEW.summary     IS DISTINCT FROM OLD.summary
  OR NEW.payload_ref IS DISTINCT FROM OLD.payload_ref
  OR NEW.handle_id   IS DISTINCT FROM OLD.handle_id
  OR NEW.dedupe_key  IS DISTINCT FROM OLD.dedupe_key THEN
    RAISE EXCEPTION
      'timeline_events is append-only: facts cannot be edited. Record a correction event instead (system.correction).';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger functions are invoked by the trigger mechanism as the table
-- owner; the invoking role never needs direct EXECUTE. Revoked anyway
-- for the same reason 041 revoked crm.contacts_link_customer_trigger()
-- and its siblings: PostgreSQL grants EXECUTE to PUBLIC by default on
-- every new function, and this project's rule (041's own comment) is
-- that every new function declares its own REVOKE/GRANT rather than
-- relying on a blanket statement elsewhere in the chain.
REVOKE ALL ON FUNCTION timeline_events_immutable_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_timeline_events_immutable ON timeline_events;
CREATE TRIGGER trg_timeline_events_immutable
  BEFORE UPDATE ON timeline_events
  FOR EACH ROW EXECUTE FUNCTION timeline_events_immutable_guard();

-- Belt-and-braces beyond the trigger: DELETE is blocked at the grant
-- layer for authenticated/anon, so "is this table append-only" does not
-- depend on every future RLS policy being written correctly. Mirrors
-- migration 041's own stated model: RLS is the authorization boundary,
-- grants are the prerequisite PostgREST needs before RLS is evaluated —
-- here the grant is doing extra, deliberate work.
REVOKE DELETE ON timeline_events FROM authenticated, anon;

ALTER TABLE timeline_event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;

-- timeline_event_types is global reference data, same shape as
-- identity_evidence_policy (044) — readable by any authenticated user,
-- no write policy (service-role/migration-seeded only).
DROP POLICY IF EXISTS timeline_event_types_read ON timeline_event_types;
CREATE POLICY timeline_event_types_read ON timeline_event_types
  FOR SELECT USING (true);

-- timeline_events: any account member may read and insert/update
-- (governance columns) within their own account. DELETE is already
-- blocked at the grant layer above regardless of this policy.
DROP POLICY IF EXISTS timeline_events_account_rw ON timeline_events;
CREATE POLICY timeline_events_account_rw ON timeline_events
  FOR ALL USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- No table-level grants restated — see 043's comment on ALTER DEFAULT
-- PRIVILEGES (041). The DELETE revoke above is the one deliberate
-- exception to "rely on the default", stated explicitly for this table.

-- ============================================================
-- ROLLBACK (local dev only):
--
--   DROP TRIGGER IF EXISTS trg_timeline_events_immutable ON timeline_events;
--   DROP FUNCTION IF EXISTS timeline_events_immutable_guard();
--   DROP POLICY IF EXISTS timeline_events_account_rw ON timeline_events;
--   DROP POLICY IF EXISTS timeline_event_types_read ON timeline_event_types;
--   DROP TABLE IF EXISTS timeline_events CASCADE;
--   DROP TABLE IF EXISTS timeline_event_types CASCADE;
--
-- Drop 046 first if it exists (continuation_tokens does not FK to
-- timeline_events, but keep the reverse-numeric order for consistency
-- across all four rollbacks).
-- ============================================================
