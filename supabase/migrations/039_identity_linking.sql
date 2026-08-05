-- Phase 1 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 039_identity_linking
--
-- Links crm.contacts to public.customers (the Yali brain's DPDP-safe,
-- phone_hash-only identity table). Matching is always workspace-scoped:
-- crm workspace (accounts.id) -> workspace_brand_map -> tenant_id/brand_id
-- -> normalise_phone_e164(phone) -> sha256 -> public.customers.phone_hash.
-- Never a bare cross-database phone_hash match.
--
-- 0 matches  -> leave customer_id NULL
-- 1 match    -> link automatically (customer_link_source = 'automatic')
-- >1 matches -> do NOT auto-link; record identity_link_conflicts instead
--
-- Manual links (customer_link_source = 'manual') are never touched by
-- the trigger or the reconciliation function below — that's the
-- protection contract; the actual manual-resolution UI is future work,
-- this migration only guarantees the DB won't clobber a manual decision.
-- ============================================================

CREATE TABLE IF NOT EXISTS identity_link_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  normalized_phone_hash TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  brand_id UUID NOT NULL,
  candidate_customer_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_identity_link_conflicts_status
  ON identity_link_conflicts(status);
-- One OPEN conflict per contact — a resolved/ignored row doesn't block a
-- fresh conflict being recorded later if the underlying data changes again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_link_conflicts_open_contact
  ON identity_link_conflicts(contact_id) WHERE status = 'open';

ALTER TABLE identity_link_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identity_link_conflicts_account_rw ON identity_link_conflicts;
CREATE POLICY identity_link_conflicts_account_rw ON identity_link_conflicts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_account_member(c.account_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_account_member(c.account_id))
  );

-- Returns every public.customers.id matching (tenant, brand, normalized
-- phone) — 0, 1, or many. SECURITY DEFINER: crm has no direct SELECT
-- grant on public.customers otherwise, and never should (only this
-- narrow, id-only lookup is exposed).
CREATE OR REPLACE FUNCTION resolve_customer_candidates(
  p_phone TEXT, p_tenant_id UUID, p_brand_id UUID
) RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  FROM public.customers
  WHERE tenant_id = p_tenant_id
    AND brand_id = p_brand_id
    AND phone_hash = encode(digest(normalise_phone_e164(p_phone), 'sha256'), 'hex');
$$;

-- Core linking logic — callable directly (backfill/reconciliation) or via
-- the trigger below (immediate best-effort linking on write).
CREATE OR REPLACE FUNCTION link_contact_to_customer(p_contact_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
DECLARE
  v_contact contacts%ROWTYPE;
  v_tenant_id UUID;
  v_brand_id UUID;
  v_candidates UUID[];
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

  SELECT wbm.tenant_id, wbm.brand_id INTO v_tenant_id, v_brand_id
  FROM workspace_brand_map wbm
  WHERE wbm.crm_workspace_id = v_contact.account_id AND wbm.is_active
  LIMIT 1; -- LIMIT 1 here is safe: the partial unique index guarantees at
           -- most one active row per workspace, this isn't an arbitrary cut

  IF v_tenant_id IS NULL THEN
    RETURN; -- no workspace->tenant/brand mapping yet; nothing to resolve against
  END IF;

  v_candidates := resolve_customer_candidates(v_contact.phone, v_tenant_id, v_brand_id);
  v_phone_hash := encode(digest(normalise_phone_e164(v_contact.phone), 'sha256'), 'hex');

  IF array_length(v_candidates, 1) IS NULL THEN
    -- 0 matches
    UPDATE contacts SET customer_id = NULL, customer_link_source = NULL,
      customer_linked_at = NULL, customer_link_confidence = NULL
      WHERE id = p_contact_id;
    UPDATE identity_link_conflicts SET status = 'resolved', resolved_at = now(),
      resolution_notes = 'auto-resolved: candidate no longer matches'
      WHERE contact_id = p_contact_id AND status = 'open';
  ELSIF array_length(v_candidates, 1) = 1 THEN
    -- exactly 1 match
    UPDATE contacts SET customer_id = v_candidates[1], customer_link_source = 'automatic',
      customer_linked_at = now(), customer_link_confidence = 'exact'
      WHERE id = p_contact_id;
    UPDATE identity_link_conflicts SET status = 'resolved', resolved_at = now(),
      resolution_notes = 'auto-resolved: narrowed to exactly one candidate'
      WHERE contact_id = p_contact_id AND status = 'open';
  ELSE
    -- >1 match: never auto-link, record/update the conflict instead
    UPDATE contacts SET customer_id = NULL, customer_link_source = NULL,
      customer_linked_at = NULL, customer_link_confidence = NULL
      WHERE id = p_contact_id;
    INSERT INTO identity_link_conflicts
      (contact_id, normalized_phone_hash, tenant_id, brand_id, candidate_customer_ids)
    VALUES (p_contact_id, v_phone_hash, v_tenant_id, v_brand_id, v_candidates)
    ON CONFLICT (contact_id) WHERE status = 'open'
    DO UPDATE SET candidate_customer_ids = EXCLUDED.candidate_customer_ids,
                  normalized_phone_hash = EXCLUDED.normalized_phone_hash;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION contacts_link_customer_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
BEGIN
  PERFORM link_contact_to_customer(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_link_customer ON contacts;
CREATE TRIGGER trg_contacts_link_customer
  AFTER INSERT OR UPDATE OF phone, account_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_link_customer_trigger();

-- Backfill (existing contacts, run once post-deploy) AND reconciliation
-- (late-arriving public.customers rows — a contact created before its
-- matching customer existed never re-resolves on its own, since the
-- trigger only fires on crm.contacts writes). Same function serves both:
-- idempotent, safe to call repeatedly (cron, manual, or a future UI
-- "re-check" button) rather than a tightly-coupled reverse trigger on
-- public.customers, per this phase's explicit guidance to prefer
-- scheduled reconciliation over cross-repo trigger coupling.
CREATE OR REPLACE FUNCTION reconcile_contact_customer_links()
RETURNS TABLE(
  contacts_scanned INT, contacts_linked INT, contacts_unmatched INT,
  contacts_ambiguous INT, contacts_skipped_no_mapping INT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
DECLARE
  v_contact RECORD;
  v_scanned INT := 0;
  v_linked INT := 0;
  v_unmatched INT := 0;
  v_ambiguous INT := 0;
  v_skipped INT := 0;
  v_has_mapping BOOLEAN;
BEGIN
  FOR v_contact IN
    SELECT id, account_id FROM contacts
    WHERE customer_link_source IS DISTINCT FROM 'manual'
      AND phone IS NOT NULL AND btrim(phone) <> ''
  LOOP
    v_scanned := v_scanned + 1;

    SELECT EXISTS (
      SELECT 1 FROM workspace_brand_map
      WHERE crm_workspace_id = v_contact.account_id AND is_active
    ) INTO v_has_mapping;

    IF NOT v_has_mapping THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    PERFORM link_contact_to_customer(v_contact.id);

    IF EXISTS (SELECT 1 FROM contacts WHERE id = v_contact.id AND customer_id IS NOT NULL) THEN
      v_linked := v_linked + 1;
    ELSIF EXISTS (SELECT 1 FROM identity_link_conflicts WHERE contact_id = v_contact.id AND status = 'open') THEN
      v_ambiguous := v_ambiguous + 1;
    ELSE
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_scanned, v_linked, v_unmatched, v_ambiguous, v_skipped;
END;
$$;

ALTER FUNCTION reconcile_contact_customer_links() OWNER TO postgres;
REVOKE ALL ON FUNCTION reconcile_contact_customer_links() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_contact_customer_links() TO service_role;
