-- Phase 2 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 049_channel_threads
--
-- WHAT THIS IS
-- The operational Inbox read model for channels whose canonical facts
-- live in crm.timeline_events (Instagram, Messenger — and any future
-- handle-keyed channel). One row per (account, channel, handle): the
-- work-queue state for a thread, and NOTHING ELSE.
--
-- WHY IT HOLDS NO MESSAGE CONTENT
-- The locked split is: timeline_events is the canonical customer
-- history; the Inbox is an operational work queue over it. So this
-- table stores only what the queue owns and the timeline cannot express
-- — status, assignment, read position — and never a copy of a message.
-- Preview text and full history are always DERIVED from timeline_events
-- at read time, so the two can never disagree and no backfill can ever
-- be needed. Compare the join-not-backfill rule already load-bearing in
-- listTimelineEventsForContactViaHandles().
--
-- WHY KEYED BY handle_id, NOT contact_id
-- Instagram and Messenger handles are UNLINKED until a human approves
-- the link (see 044 identity_evidence_policy: auto_link is false for
-- every guessing-based signal). A thread must therefore be readable,
-- assignable and workable BEFORE any Contact exists. contact_id here is
-- nullable and late-bound, exactly as on timeline_events. When a handle
-- is later linked, that thread's entire history joins the customer's
-- Timeline with zero writes — and unlinking reverses it just as cheaply.
--
-- NOTHING IN THIS MIGRATION LINKS AN IDENTITY.
-- upsert_channel_thread() below deliberately takes no contact_id
-- parameter, so the projection write path is STRUCTURALLY incapable of
-- auto-linking a handle to a Contact. Cross-channel identity merging
-- stays a human decision, recorded through the identity_evidence
-- machinery. Never add a contact_id argument to that function.
--
-- WHY NOT crm.conversations
-- Three hard blockers, all verified against the live schema:
--   1. conversations.contact_id is NOT NULL (001:147) — an unlinked
--      thread cannot be represented at all.
--   2. idx_conversations_account_contact is UNIQUE (account_id,
--      contact_id) (036:128) — it exists because duplicate conversations
--      were a real production bug; widening it re-opens that surface.
--   3. At least six code paths assume one-conversation-per-contact
--      (two find-or-create implementations with 23505 re-resolution, the
--      WhatsApp send route, the /api/v1 contact filter, the pipelines
--      deal form). A miss there is silent.
-- So WhatsApp keeps crm.conversations UNCHANGED, this table serves the
-- handle-keyed channels, and the Inbox read model unions the two.
-- crm.messages stays channel-neutral and gains no channel column (a
-- locked decision, restated in CLAUDE.md).
--
-- REPLAY / IDEMPOTENCY
-- The fact layer is already idempotent: timeline_events has
-- UNIQUE (account_id, dedupe_key, occurred_at). This table adds the
-- second half — upsert_channel_thread() is idempotent on
-- (account_id, channel, handle_id) and advances last_activity_at with
-- GREATEST, never a bare assignment, so replaying an OLD event cannot
-- drag a thread backwards in the list and replaying the newest event
-- changes nothing observable. Unread is a TIMESTAMP, not a counter, so
-- it has no increment step to double-apply.
--
-- TENANCY
-- account_id only, following identity_handles (043), not the
-- account+tenant+brand triple used by timeline_events (045) and
-- continuation_tokens (046). Those carry tenant/brand because the Yali
-- brain joins against them; this table is CRM-operational state that the
-- brain never reads, and tenant/brand are derivable from
-- workspace_brand_map when ever needed. Isolation is enforced by RLS on
-- account_id, the same predicate as every other crm table.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Thread identity. handle_id is the immutable key; a handle belongs to
  -- exactly one account (043), which is what makes the account check
  -- below meaningful rather than decorative.
  channel           TEXT NOT NULL,
  handle_id         UUID NOT NULL REFERENCES identity_handles(id) ON DELETE CASCADE,

  -- Late-bound, human-approved only. Never written by the projection.
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Operational state. status mirrors conversations.status (001:148) so
  -- one Inbox filter can drive both sources without a translation layer.
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id UUID,

  -- Ordering key for the thread list. Denormalised on purpose: it is the
  -- ONLY value copied out of timeline_events, and it exists so the list
  -- can be ordered and keyset-paginated in the database instead of in
  -- the browser (the current inbox loads every conversation and sorts
  -- client-side; this read model must not inherit that).
  last_activity_at  TIMESTAMPTZ NOT NULL,

  -- Read position, NOT a counter. Unread is derived as
  -- count(inbound events WHERE occurred_at > last_read_at). A timestamp
  -- is idempotent under replay by construction; the existing
  -- conversations.unread_count is a read-modify-write from a value read
  -- earlier in the request, which is a live race this deliberately
  -- avoids. NULL means nothing has been read yet.
  last_read_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One thread per handle per channel. This is the idempotency key the
  -- projection upserts on.
  UNIQUE (account_id, channel, handle_id)
);

COMMENT ON TABLE channel_threads IS
  'Operational Inbox state for handle-keyed channels (Instagram, Messenger). '
  'Holds NO message content — preview and history are derived from '
  'crm.timeline_events at read time. contact_id is human-approved only; '
  'the projection never sets it. WhatsApp uses crm.conversations instead.';

COMMENT ON COLUMN channel_threads.last_read_at IS
  'Read position. Unread count is derived, never stored — see 049 header.';

-- ── Indexes ──────────────────────────────────────────────────
-- The thread list is "this account, newest first, optionally filtered by
-- channel", so account_id leads and last_activity_at descends. The
-- partial index serves the default Inbox view (open threads) without
-- paying for closed ones.
CREATE INDEX IF NOT EXISTS idx_channel_threads_account_activity
  ON channel_threads (account_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_threads_account_channel_activity
  ON channel_threads (account_id, channel, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_threads_contact
  ON channel_threads (contact_id) WHERE contact_id IS NOT NULL;

-- No new index on timeline_events: idx_timeline_handle_time
-- (handle_id, occurred_at DESC) from 045 already serves both the thread
-- history read and the unread count, which filter on handle_id and
-- range/order on occurred_at.

-- ── updated_at ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at ON channel_threads;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channel_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Projection write path ────────────────────────────────────
-- Idempotent upsert. Takes NO contact_id — see the header. Returns the
-- thread id so the caller can correlate without a second round trip.
--
-- GREATEST() on last_activity_at is the replay guard: an out-of-order or
-- redelivered older event must not move a thread's position in the list.
-- A bare EXCLUDED assignment would.
CREATE OR REPLACE FUNCTION upsert_channel_thread(
  p_account_id  UUID,
  p_channel     TEXT,
  p_handle_id   UUID,
  p_occurred_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
DECLARE
  v_thread_id UUID;
  v_handle_account UUID;
BEGIN
  -- Cross-account guard. The projection runs under the service-role
  -- client, which BYPASSES RLS entirely, so channel_threads_* policies
  -- cannot help here — this check is the only thing stopping a handle
  -- from one account being threaded under another. Same reasoning as
  -- link-visitor.ts's account check; do not remove it or move a write
  -- above it.
  SELECT account_id INTO v_handle_account
    FROM identity_handles WHERE id = p_handle_id;

  IF v_handle_account IS NULL THEN
    RAISE EXCEPTION 'identity handle % does not exist', p_handle_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_handle_account IS DISTINCT FROM p_account_id THEN
    RAISE EXCEPTION 'identity handle % belongs to a different account', p_handle_id
      USING ERRCODE = 'raise_exception';
  END IF;

  INSERT INTO channel_threads (account_id, channel, handle_id, last_activity_at)
  VALUES (p_account_id, p_channel, p_handle_id, p_occurred_at)
  ON CONFLICT (account_id, channel, handle_id) DO UPDATE
    SET last_activity_at = GREATEST(
          channel_threads.last_activity_at,
          EXCLUDED.last_activity_at
        )
  RETURNING id INTO v_thread_id;

  RETURN v_thread_id;
END;
$$;

-- Per 041's rule, every new function declares its own lockdown. The
-- projection is a server-side write path only: authenticated users reach
-- channel_threads through RLS on the table, never through this function.
REVOKE ALL ON FUNCTION upsert_channel_thread(UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_channel_thread(UUID, TEXT, UUID, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_channel_thread(UUID, TEXT, UUID, TIMESTAMPTZ) TO service_role;

-- ── RLS ──────────────────────────────────────────────────────
-- Split policies matching crm.conversations (017:416-420) rather than
-- the single FOR ALL used by identity_handles/timeline_events: this is
-- an operational table like conversations, so reads are viewer-level and
-- every mutation requires 'agent'. A viewer can see the queue; only an
-- agent can claim, close or mark it read.
ALTER TABLE channel_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_threads_select ON channel_threads;
CREATE POLICY channel_threads_select ON channel_threads
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS channel_threads_insert ON channel_threads;
CREATE POLICY channel_threads_insert ON channel_threads
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS channel_threads_update ON channel_threads;
CREATE POLICY channel_threads_update ON channel_threads
  FOR UPDATE USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS channel_threads_delete ON channel_threads;
CREATE POLICY channel_threads_delete ON channel_threads
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Table grants are intentionally omitted: 041's
-- ALTER DEFAULT PRIVILEGES IN SCHEMA crm already grants
-- SELECT/INSERT/UPDATE/DELETE on future crm tables to authenticated and
-- service_role, and RLS above is what actually constrains them.

-- ── Realtime ─────────────────────────────────────────────────
-- The Inbox needs live thread updates. Subscribing to channel_threads is
-- sufficient: any new event bumps last_activity_at through the
-- projection, which the client sees as an UPDATE and can refetch from.
-- timeline_events is deliberately NOT added to the publication — it is
-- append-only and high-volume, and the thread bump already carries the
-- signal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'crm'
      AND tablename = 'channel_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE crm.channel_threads;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (local dev only):
--
--   DO $$
--   BEGIN
--     IF EXISTS (
--       SELECT 1 FROM pg_publication_tables
--       WHERE pubname = 'supabase_realtime'
--         AND schemaname = 'crm' AND tablename = 'channel_threads'
--     ) THEN
--       ALTER PUBLICATION supabase_realtime DROP TABLE crm.channel_threads;
--     END IF;
--   END $$;
--
--   DROP FUNCTION IF EXISTS upsert_channel_thread(UUID, TEXT, UUID, TIMESTAMPTZ);
--
--   DROP POLICY IF EXISTS channel_threads_select ON channel_threads;
--   DROP POLICY IF EXISTS channel_threads_insert ON channel_threads;
--   DROP POLICY IF EXISTS channel_threads_update ON channel_threads;
--   DROP POLICY IF EXISTS channel_threads_delete ON channel_threads;
--   DROP TABLE IF EXISTS channel_threads;
--
-- SAFETY: this migration is ADDITIVE ONLY. It creates one new table, one
-- new function and three new indexes, and touches no existing table,
-- column, constraint, policy or row. Dropping channel_threads loses only
-- operational state (status, assignment, read position) — every message
-- fact survives untouched in timeline_events, so a rollback costs the
-- work queue's bookkeeping, never customer history. crm.conversations,
-- crm.messages and the WhatsApp path are not modified in any way.
-- ============================================================
