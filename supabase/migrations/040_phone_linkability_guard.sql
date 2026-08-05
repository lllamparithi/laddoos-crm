-- Phase 1 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 040_phone_linkability_guard
--
-- normalise_phone_e164() (038) intentionally matches the brain's JS
-- normalisePhoneE164() byte-for-byte, including values that are useless
-- as identity keys: '' -> '+', '12345' -> '+12345'. That parity is
-- correct and must not change — changing it would break hash
-- equivalence with public.customers.phone_hash.
--
-- What must NOT happen is treating those parity-preserved-but-useless
-- values as a basis for automatically linking a contact to a customer.
-- This migration adds a SEPARATE eligibility check, tested in isolation
-- via pg_temp against the live Postgres engine this session (12/12 cases,
-- see docs/PHASE1_TEST_REPORT.md) before being written here, and wires it
-- into link_contact_to_customer() so automatic linking additionally
-- requires the normalized value to actually look like a real E.164
-- number — not just successfully "normalize" to something.
--
-- Policy (structural E.164 limits only — no per-country validation
-- tables, per this phase's explicit instruction not to invent
-- country-specific rules):
--   ^\+[1-9]\d{7,14}$
--   - must start with '+'
--   - first digit 1-9 (a country code never starts with 0)
--   - 8 to 15 digits total (E.164's own max is 15; 8 is a structural
--     floor below which no real subscriber number exists)
--   - no other characters (spaces/hyphens mean the value fell through
--     normalise_phone_e164's "already has +, leave it alone" branch
--     un-canonicalized — such a value must not be auto-linked on)
-- ============================================================

CREATE OR REPLACE FUNCTION is_linkable_phone_e164(normalized TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
  SELECT normalized IS NOT NULL
    AND normalized ~ '^\+[1-9]\d{7,14}$';
$$;

COMMENT ON FUNCTION is_linkable_phone_e164(TEXT) IS
  'Identity-link eligibility gate, separate from normalise_phone_e164()''s '
  'JS-parity normalization. NULL, empty, bare "+", too-short, too-long, '
  'leading-zero-after-+, or unnormalized (contains spaces/punctuation) '
  'values are never linkable, even though they may be valid outputs of '
  'normalise_phone_e164(). See docs/PHASE1_TEST_REPORT.md for the 12-case '
  'verification this was tested against before being written here.';

-- Automatic linking now additionally requires is_linkable_phone_e164().
-- Manual-link protection, workspace-scoping, and 0/1/many matching logic
-- from 039 are otherwise unchanged — only the eligibility gate is new.
CREATE OR REPLACE FUNCTION link_contact_to_customer(p_contact_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
DECLARE
  v_contact contacts%ROWTYPE;
  v_tenant_id UUID;
  v_brand_id UUID;
  v_candidates UUID[];
  v_normalized TEXT;
  v_phone_hash TEXT;
BEGIN
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_contact.customer_link_source = 'manual' THEN
    RETURN; -- manual links are never overwritten by automatic linking
  END IF;

  IF v_contact.phone IS NULL OR btrim(v_contact.phone) = '' THEN
    RETURN; -- blank/invalid phone stays unlinked, not an error
  END IF;

  v_normalized := normalise_phone_e164(v_contact.phone);

  IF NOT is_linkable_phone_e164(v_normalized) THEN
    -- Normalization "succeeded" (parity-wise) but the result isn't a
    -- real identity key (e.g. '+', '+12345'). Never auto-link on this,
    -- and never record it as an ambiguous conflict either — it isn't
    -- ambiguous, it's just not a usable key.
    UPDATE contacts SET customer_id = NULL, customer_link_source = NULL,
      customer_linked_at = NULL, customer_link_confidence = NULL
      WHERE id = p_contact_id;
    DELETE FROM identity_link_conflicts WHERE contact_id = p_contact_id AND status = 'open';
    RETURN;
  END IF;

  SELECT wbm.tenant_id, wbm.brand_id INTO v_tenant_id, v_brand_id
  FROM workspace_brand_map wbm
  WHERE wbm.crm_workspace_id = v_contact.account_id AND wbm.is_active
  LIMIT 1; -- safe: partial unique index guarantees at most one active row

  IF v_tenant_id IS NULL THEN
    RETURN; -- no workspace->tenant/brand mapping yet; nothing to resolve against
  END IF;

  v_candidates := resolve_customer_candidates(v_contact.phone, v_tenant_id, v_brand_id);
  v_phone_hash := encode(digest(v_normalized, 'sha256'), 'hex');

  IF array_length(v_candidates, 1) IS NULL THEN
    UPDATE contacts SET customer_id = NULL, customer_link_source = NULL,
      customer_linked_at = NULL, customer_link_confidence = NULL
      WHERE id = p_contact_id;
    UPDATE identity_link_conflicts SET status = 'resolved', resolved_at = now(),
      resolution_notes = 'auto-resolved: candidate no longer matches'
      WHERE contact_id = p_contact_id AND status = 'open';
  ELSIF array_length(v_candidates, 1) = 1 THEN
    UPDATE contacts SET customer_id = v_candidates[1], customer_link_source = 'automatic',
      customer_linked_at = now(), customer_link_confidence = 'exact'
      WHERE id = p_contact_id;
    UPDATE identity_link_conflicts SET status = 'resolved', resolved_at = now(),
      resolution_notes = 'auto-resolved: narrowed to exactly one candidate'
      WHERE contact_id = p_contact_id AND status = 'open';
  ELSE
    -- MANY-MATCH BRANCH — currently unreachable, deliberately retained.
    --
    -- The many-match branch is unreachable under the current
    -- public.customers scoped unique constraint
    -- (customers_brand_phone_hash_unique on (brand_id, phone_hash)).
    -- It is retained as a fail-closed safeguard because that constraint
    -- belongs to another repository (the YALI brain — see
    -- docs/PHASE1_SCHEMA_OWNERSHIP.md) and could change independently
    -- without this repo being notified.
    --
    -- Fail-closed semantics if that ever happens: ambiguity NEVER
    -- auto-links. The contact is explicitly unlinked and a conflict row
    -- is recorded for human resolution. Note there is deliberately no
    -- `ORDER BY ... LIMIT 1` fallback anywhere on this path — picking an
    -- arbitrary "first" customer would silently attach a contact to the
    -- wrong person, which is worse than leaving it unlinked.
    UPDATE contacts SET customer_id = NULL, customer_link_source = NULL,
      customer_linked_at = NULL, customer_link_confidence = NULL
      WHERE id = p_contact_id;
    -- Idempotent: the partial unique index on (contact_id) WHERE
    -- status='open' means re-running reconciliation refreshes the
    -- existing open conflict instead of accumulating duplicates.
    INSERT INTO identity_link_conflicts
      (contact_id, normalized_phone_hash, tenant_id, brand_id, candidate_customer_ids)
    VALUES (p_contact_id, v_phone_hash, v_tenant_id, v_brand_id, v_candidates)
    ON CONFLICT (contact_id) WHERE status = 'open'
    DO UPDATE SET candidate_customer_ids = EXCLUDED.candidate_customer_ids,
                  normalized_phone_hash = EXCLUDED.normalized_phone_hash;
  END IF;
END;
$$;
