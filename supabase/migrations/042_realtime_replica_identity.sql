-- Phase 1 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 042_realtime_replica_identity
--
-- Postgres logical replication sends only the columns covered by a
-- table's REPLICA IDENTITY in the OLD image of an UPDATE/DELETE. The
-- default is the primary key. Supabase Realtime uses that OLD image for
-- two separate things:
--
--   (a) the `old` payload the client handler reads, and
--   (b) evaluating a server-side subscription `filter:` on DELETE.
--
-- (b) is the one that bites: if a subscription filters on a column that
-- isn't in the replica identity, the filter can never match on DELETE,
-- so the event is DROPPED ENTIRELY — silently, with no error anywhere.
--
-- Enabled per-table below, with the specific reason each one needs it.
-- Deliberately NOT applied blanket: REPLICA IDENTITY FULL writes every
-- column of every UPDATE/DELETE to the WAL, so it has a real ongoing
-- cost and belongs only where a subscription actually depends on it.
--
-- Verified empirically against a local stack, not reasoned about — see
-- docs/PHASE1_TEST_REPORT.md ("Realtime UPDATE/DELETE").
-- ============================================================

-- src/components/inbox/message-thread.tsx subscribes to INSERT/UPDATE/
-- DELETE with `filter: conversation_id=eq.<id>`. PK is `id`, so
-- `conversation_id` is absent from the default OLD image and every
-- reaction-removal event would be filtered out — reactions would appear
-- when added and never disappear when removed.
ALTER TABLE crm.message_reactions REPLICA IDENTITY FULL;

-- src/hooks/use-presence.ts subscribes to '*' with
-- `filter: account_id=eq.<id>`. PK is `user_id`, so `account_id` is
-- absent from the default OLD image — a teammate going offline (row
-- deleted) would never clear from the presence list.
ALTER TABLE crm.member_presence REPLICA IDENTITY FULL;

-- src/hooks/use-unread-notifications.ts reads `payload.old.read_at` on
-- DELETE to decide whether to decrement the unread badge. `read_at` is
-- not the PK, so without FULL the badge drifts permanently on deletion.
-- (That file's own comment already anticipated this requirement.)
ALTER TABLE crm.notifications REPLICA IDENTITY FULL;

-- NOT enabled, deliberately — checked and confirmed unnecessary:
--   crm.conversations  — use-realtime.ts / use-total-unread.ts subscribe
--                        unfiltered and read only `old.id` on DELETE (the
--                        PK, present by default).
--   crm.messages       — unfiltered; the handler forwards eventType and
--                        consumers use `new` for INSERT/UPDATE.
--   crm.flow_runs      — in the publication but no app subscription.
--   crm.contacts,
--   crm.broadcast_recipients
--                      — not in the supabase_realtime publication at all;
--                        no app code subscribes to them.
