-- Phase 2 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 048_yali_voice_config
--
-- One on/off switch for the storefront's browser voice widget
-- (laddoos-website's useVoiceRoom.ts -> /api/livekit-token), ported from
-- Kyochi's own Yali Control Room voice toggle. Deliberately NOT the
-- three-state Disabled/Test/Live model Kyochi uses, and no change-history
-- log — a straight switch is what was asked for; add either back if the
-- founder actually needs them.
--
-- Does NOT touch the telephony phone line (agent_gemini_live.py on the
-- VPS) — that's a separate always-on Python service with no config-poll
-- mechanism to receive this.
--
-- One row per account, matching the existing no-multi-tenant model
-- (CLAUDE.md: "Laddoos is the only account"). Read is public/cross-origin
-- (the storefront, a different origin, checks this before minting a
-- voice session); write is admin+ only, enforced in the API route the
-- same way ai_configs is.
-- ============================================================

CREATE TABLE IF NOT EXISTS yali_voice_config (
  account_id  UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE yali_voice_config IS
  'One row per account: whether the storefront browser voice widget is '
  'enabled. Read cross-origin by laddoos-website before minting a LiveKit '
  'token; written only from this app''s /agents "Voice" tab.';

ALTER TABLE yali_voice_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yali_voice_config_account_rw ON yali_voice_config;
CREATE POLICY yali_voice_config_account_rw ON yali_voice_config
  FOR ALL USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- No table-level grants restated — see 043's comment on ALTER DEFAULT
-- PRIVILEGES (041); the default already covers authenticated/anon per the
-- pattern every other Phase 2 table in this ledger follows.

-- ============================================================
-- ROLLBACK (local dev only):
--
--   DROP POLICY IF EXISTS yali_voice_config_account_rw ON yali_voice_config;
--   DROP TABLE IF EXISTS yali_voice_config;
-- ============================================================
