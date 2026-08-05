-- Phase 2 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 046_continuation_tokens
--
-- Opaque, HMAC-signed, expiring reference carried across a channel
-- boundary (e.g. an Instagram DM containing a product link). The raw
-- token is never stored — only sha256(token_id) in token_hash, following
-- the phone_hash precedent already set by the brain. Signing, HMAC
-- verification, issuance and resolution are application-level (Next.js
-- route) concerns, not database functions — this migration is the table
-- only. See docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.
--
-- Phase 2A only issues 'ig_to_web' tokens. The CHECK constraint below
-- lists all five eventual purposes (matching the reviewed design)
-- rather than just 'ig_to_web', so Phase 2B/2C do not need to ALTER
-- this constraint later — widening a CHECK is exactly the kind of
-- migration this project's own numbering conflict (see
-- docs/PHASE2_DOCUMENT_AUDIT.md §1) exists to avoid repeating. No
-- application code in this repo issues anything but 'ig_to_web' today;
-- that is an application-layer fact, not a schema one.
-- ============================================================

CREATE TABLE IF NOT EXISTS continuation_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  brand_id            UUID NOT NULL,
  token_hash          TEXT NOT NULL UNIQUE,     -- sha256(token_id). Raw never stored
  purpose             TEXT NOT NULL CHECK (purpose IN
                        ('ig_to_web','messenger_to_web','web_to_wa','email_to_web','voice_to_web')),
  origin_channel      TEXT NOT NULL,
  origin_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  origin_contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  origin_handle_id    UUID REFERENCES identity_handles(id) ON DELETE SET NULL,
  campaign_id         TEXT,
  ad_id               TEXT,
  creative_id         TEXT,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  max_uses            INTEGER NOT NULL DEFAULT 5,
  use_count           INTEGER NOT NULL DEFAULT 0,
  first_used_at       TIMESTAMPTZ,
  binds_identity      BOOLEAN NOT NULL DEFAULT true,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  CHECK (expires_at > issued_at)
);

COMMENT ON TABLE continuation_tokens IS
  'Opaque signed references carried across a channel boundary. Identity '
  'binds only on first redemption (application-level rule, not enforced '
  'in this table) — see '
  'docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.1, §4.3 for why a '
  'redeemed token proves attribution, not identity, even on repeat use.';

COMMENT ON COLUMN continuation_tokens.token_hash IS
  'sha256 of the 16-byte random token_id. The raw token is never '
  'recoverable from this row, matching the phone_hash precedent (038).';

CREATE INDEX IF NOT EXISTS idx_continuation_tokens_origin
  ON continuation_tokens(origin_conversation_id);
CREATE INDEX IF NOT EXISTS idx_continuation_tokens_account
  ON continuation_tokens(account_id, issued_at DESC);

ALTER TABLE continuation_tokens ENABLE ROW LEVEL SECURITY;

-- Any account member may issue and view tracked links as part of normal
-- conversation work (e.g. an agent sending a product link in reply to an
-- Instagram DM) — not restricted to admins, unlike workspace_brand_map
-- (037), which is a tenant-identity governance setting rather than
-- routine day-to-day activity.
DROP POLICY IF EXISTS continuation_tokens_account_rw ON continuation_tokens;
CREATE POLICY continuation_tokens_account_rw ON continuation_tokens
  FOR ALL USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- No table-level grants restated — see 043's comment on ALTER DEFAULT
-- PRIVILEGES (041). No new functions in this migration.

-- ============================================================
-- ROLLBACK (local dev only):
--
--   DROP POLICY IF EXISTS continuation_tokens_account_rw ON continuation_tokens;
--   DROP TABLE IF EXISTS continuation_tokens CASCADE;
--
-- continuation_tokens FKs to identity_handles (043) and conversations/
-- contacts (Phase 1) but nothing FKs to continuation_tokens itself, so
-- this drop is independent of 045/044/043's own rollback order.
-- ============================================================
