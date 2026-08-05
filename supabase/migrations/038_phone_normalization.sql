-- Phase 1 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 038_phone_normalization
--
-- Exact SQL port of normalisePhoneE164()/hashPhone() from Yali Build 2.0
-- src/brain/memory/customer.ts:51-64. Verified byte-for-byte parity this
-- session against 10 fixture cases + NULL (see docs/PHASE1_TEST_REPORT.md)
-- by running this exact function body in pg_temp against the live
-- ugjishankutgfegplrgq project (self-cleaning, nothing persisted).
--
-- This exists because crm.contacts.phone_normalized (migration 022) is a
-- plain digits-only strip with no India E.164 country-code logic — it
-- CANNOT be compared to public.customers.phone_hash directly. This
-- function is the one place that logic is ported, so every future write
-- path (trigger, backfill, manual UI) uses the same normalization.
-- ============================================================

CREATE OR REPLACE FUNCTION normalise_phone_e164(raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
DECLARE
  digits TEXT;
BEGIN
  -- Intentional divergence from the JS source: the JS function's type
  -- signature is `(raw: string)` and is never called with null in
  -- practice, so it has no null guard. A SQL trigger CAN see NULL
  -- (contacts.phone is nullable), so NULL -> NULL here rather than
  -- reproducing a TypeError that could never actually occur upstream.
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(raw, '\D', '', 'g');

  IF length(digits) = 10 AND digits ~ '^[6-9]' THEN
    RETURN '+91' || digits;
  ELSIF length(digits) = 12 AND left(digits, 2) = '91' THEN
    RETURN '+' || digits;
  ELSIF length(digits) = 11 AND digits ~ '^0[6-9]' THEN
    RETURN '+91' || substring(digits FROM 2);
  ELSIF left(raw, 1) = '+' THEN
    -- Matches the JS fallback exactly: returns the RAW input unchanged
    -- (not the stripped digits) when it already starts with '+' and no
    -- length rule matched — e.g. a UK number keeps its original spacing.
    RETURN raw;
  ELSE
    RETURN '+' || digits;
  END IF;
END;
$$;

COMMENT ON FUNCTION normalise_phone_e164(TEXT) IS
  'Exact port of normalisePhoneE164() in Yali Build 2.0 src/brain/memory/'
  'customer.ts:51-60. NULL input -> NULL output is an intentional addition '
  '(see function body comment); every other branch matches the JS source '
  'line for line. Verified against 10 fixture cases, see '
  'docs/PHASE1_TEST_REPORT.md.';

-- Column shape for crm.contacts <-> public.customers linking (migration 039).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_link_source TEXT
    CHECK (customer_link_source IN ('automatic', 'manual') OR customer_link_source IS NULL),
  ADD COLUMN IF NOT EXISTS customer_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_link_confidence TEXT
    CHECK (customer_link_confidence IN ('exact', 'ambiguous') OR customer_link_confidence IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_customer_id ON contacts(customer_id);
