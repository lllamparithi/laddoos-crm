-- Phase 2 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 043_identity_handles
--
-- Phase 2A scope only: Instagram -> Website -> Timeline. See
-- docs/PHASE2_SCOPE_REDUCTION.md and docs/PHASE2_CANONICAL_PLAN.md.
-- No WhatsApp, no phone, no public.customers linking happens in this
-- migration or the three that follow it (044-046) — that is Phase 2B.
--
-- WHAT THIS IS
-- identity_handles records an OBSERVED FACT: "this Instagram-scoped id
-- exists", "this browser visited". A handle is never edited or merged —
-- only re-clustered under a different contact_id. Contacts remain the
-- revisable hypothesis; handles are the immutable evidence a hypothesis
-- is built from. See docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §2.
--
-- handle_type is deliberately a bare TEXT column, not a CHECK-constrained
-- enum and not FK'd to a lookup table. Phase 2A only ever writes
-- 'instagram_scoped_id', 'web_visitor_id' and 'web_session_id', but
-- constraining the column now would require loosening it again the
-- moment Phase 2B (whatsapp_wa_id, phone_e164) or Phase 2C
-- (voice_caller_number) ships. The governing safety control in this
-- design is identity_evidence_policy (044), not this column.
-- ============================================================

CREATE TABLE IF NOT EXISTS identity_handles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle_type    TEXT NOT NULL,
  channel        TEXT NOT NULL,          -- 'instagram', 'web' in Phase 2A
  handle_value   TEXT,                   -- NULL when PII-minimised to hash only
  handle_hash    TEXT NOT NULL,          -- sha256(normalised value); the join key
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  confidence     TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (confidence IN
                     ('verified','strong','probable','unknown','rejected')),
  verified_at    TIMESTAMPTZ,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A given (type, hash) pair identifies one real-world handle within one
  -- workspace. Prevents the same Instagram user or browser being recorded
  -- as two unrelated handle rows through a race or a retried webhook.
  UNIQUE (account_id, handle_type, handle_hash)
);

COMMENT ON TABLE identity_handles IS
  'Immutable per-channel identity observations. Never merged in place — '
  'a handle''s contact_id is repointed on merge/split, the row itself '
  'is never edited beyond confidence/contact_id/last_seen_at. See '
  'docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §2.';

-- A handle detached from its contact (a split) keeps its history:
-- ON DELETE SET NULL follows the flow_runs / automation_logs convention
-- (022, 010) — deleting a contact must not erase the observation trail.
CREATE INDEX IF NOT EXISTS idx_identity_handles_contact
  ON identity_handles(contact_id);
CREATE INDEX IF NOT EXISTS idx_identity_handles_hash
  ON identity_handles(account_id, handle_hash);

ALTER TABLE identity_handles ENABLE ROW LEVEL SECURITY;

-- Same shape as contacts' own RLS (001/017): any account member may read
-- and write. Identity handles are operational data an agent works with
-- day to day (e.g. confirming a handle belongs to a contact), not a
-- governance setting like workspace_brand_map (037), which is
-- admin-only.
DROP POLICY IF EXISTS identity_handles_account_rw ON identity_handles;
CREATE POLICY identity_handles_account_rw ON identity_handles
  FOR ALL USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- Table-level grants are NOT restated here: migration 041's
-- ALTER DEFAULT PRIVILEGES already grants SELECT/INSERT/UPDATE/DELETE on
-- every future crm table to authenticated + service_role, and grants
-- nothing to anon. RLS above is the actual authorization boundary.

-- ============================================================
-- ROLLBACK (local dev only — no production rollback plan exists yet;
-- see docs/PHASE1_DEPLOYMENT_RUNBOOK.md for why production rollback is
-- handled separately from migration files in this project):
--
--   DROP POLICY IF EXISTS identity_handles_account_rw ON identity_handles;
--   DROP TABLE IF EXISTS identity_handles CASCADE;
--
-- CASCADE is required once 044/045/046 exist, since identity_evidence,
-- timeline_events and continuation_tokens all FK to this table. Drop
-- 046, 045, 044 first (in that order) for a clean, non-cascading
-- rollback instead.
-- ============================================================
