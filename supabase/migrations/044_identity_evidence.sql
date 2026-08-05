-- Phase 2 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 044_identity_evidence
--
-- The governing rule for all of Phase 2: never assume two identities
-- belong to the same customer without sufficient evidence. This
-- migration is where that rule becomes structural rather than a
-- convention someone has to remember.
--
-- identity_evidence_policy is the complete, authoritative allowlist of
-- what evidence may ever justify a link, and at what confidence ceiling.
-- It is seeded ONCE, deliberately, as a safety control — not
-- incrementally per phase the way identity_handles' handle_type or
-- timeline_events' event_type vocabulary grows. The six evidence types
-- the design explicitly forbids (name, IP address, city, language,
-- device fingerprint, timing proximity) are enforced by being absent
-- from this seed, not by a runtime check. See
-- docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §2.3.
--
-- Seeded here: only the evidence types Phase 2A's own mechanisms (a
-- continuation token redemption, a phone typed into web chat, an
-- agent's manual decision) can actually produce. Phone/voice/order/
-- WhatsApp-specific evidence types (OTP verification, caller ID,
-- ctwa_clid) are Phase 2B/2C concepts and are added by those phases'
-- own migrations when those channels exist — not pre-seeded here as
-- unused rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS identity_evidence_policy (
  evidence_type   TEXT PRIMARY KEY,
  max_confidence  TEXT NOT NULL
                    CHECK (max_confidence IN
                      ('verified','strong','probable','unknown','rejected')),
  auto_link       BOOLEAN NOT NULL DEFAULT false,
  description     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity_evidence_policy IS
  'The complete allowlist of evidence types permitted to justify an '
  'identity link, and their confidence ceiling. A code path may not '
  'write an identity_evidence row whose evidence_type is absent here — '
  'that absence is how name/IP/city/language/fingerprint/timing are '
  'permanently forbidden as link evidence. See '
  'docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §2.3.';

INSERT INTO identity_evidence_policy (evidence_type, max_confidence, auto_link, description) VALUES
  ('continuation_token_first_use', 'strong', true,
    'Single-use signed continuation token, first redemption. Proves '
    'attribution to the originating conversation; identity binding is '
    'still only probable until an independent signal corroborates it — '
    'see docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.3.'),
  ('continuation_token_repeat_use', 'probable', false,
    'A continuation token redeemed a second or later time. Attribution '
    'only; never sufficient for auto-link on its own.'),
  ('customer_typed_phone', 'probable', false,
    'Customer typed their own phone number into a chat widget. '
    'Self-reported and unverified; never sufficient for auto-link alone.'),
  ('agent_manual_link', 'verified', true,
    'An account member explicitly linked this handle to this contact. '
    'Always attributed to the acting user and reversible.'),
  ('agent_manual_unlink', 'rejected', false,
    'An account member explicitly unlinked this handle from this '
    'contact. Blocks future automatic re-linking of the same pair.'),
  ('customer_denial', 'rejected', false,
    'The customer denied this identity link when asked. Blocks future '
    'automatic re-linking of the same pair.')
ON CONFLICT (evidence_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS identity_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle_id       UUID NOT NULL REFERENCES identity_handles(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  evidence_type   TEXT NOT NULL REFERENCES identity_evidence_policy(evidence_type),
  confidence      TEXT NOT NULL
                    CHECK (confidence IN
                      ('verified','strong','probable','unknown','rejected')),
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft reference only, deliberately no FK. timeline_events (045) is
  -- created after this migration, and even once it exists its primary
  -- key is composite (id, occurred_at) for future partitioning
  -- readiness (see 045's own comment) — a bare single-column FK to
  -- timeline_events(id) is not valid against a composite key. A table
  -- that only needs to display/audit an event id, not enforce
  -- referential integrity against it, should do exactly what this
  -- column does: store the UUID, no FK.
  source_event_id UUID,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('system','agent','customer')),
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes           TEXT,
  expires_at      TIMESTAMPTZ            -- token-derived evidence can age out
);

COMMENT ON COLUMN identity_evidence.source_event_id IS
  'References timeline_events.id by value only, no FK constraint — see '
  'the column-level comment in this migration for why a hard FK is not '
  'valid here.';

CREATE INDEX IF NOT EXISTS idx_identity_evidence_handle
  ON identity_evidence(handle_id);
CREATE INDEX IF NOT EXISTS idx_identity_evidence_contact
  ON identity_evidence(contact_id);

ALTER TABLE identity_evidence_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_evidence ENABLE ROW LEVEL SECURITY;

-- identity_evidence_policy is global reference data, not account-scoped
-- (no account_id column) — it is the same allowlist for every workspace.
-- Readable by any authenticated user; no write policy is defined, so
-- only service-role (which bypasses RLS) or a future migration can
-- change it. This is deliberate: the policy table is a safety control,
-- not something the app should ever write to at runtime.
DROP POLICY IF EXISTS identity_evidence_policy_read ON identity_evidence_policy;
CREATE POLICY identity_evidence_policy_read ON identity_evidence_policy
  FOR SELECT USING (true);

DROP POLICY IF EXISTS identity_evidence_account_rw ON identity_evidence;
CREATE POLICY identity_evidence_account_rw ON identity_evidence
  FOR ALL USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- No table-level grants restated — see 043's comment on why
-- ALTER DEFAULT PRIVILEGES (041) already covers this. No new functions
-- in this migration, so no REVOKE/GRANT to declare.

-- ============================================================
-- ROLLBACK (local dev only):
--
--   DROP POLICY IF EXISTS identity_evidence_account_rw ON identity_evidence;
--   DROP POLICY IF EXISTS identity_evidence_policy_read ON identity_evidence_policy;
--   DROP TABLE IF EXISTS identity_evidence CASCADE;
--   DROP TABLE IF EXISTS identity_evidence_policy CASCADE;
--
-- Drop identity_evidence before identity_evidence_policy — the former
-- FKs to the latter. Drop 046/045 first if they exist, for the same
-- reason given in 043's rollback note.
-- ============================================================
