# Phase 1 — Migration Manifest

Verified by direct file listing and grep this session (not taken from the
prior report's claimed count). `ls supabase/migrations/ | sort`:

- **Total: 42 files** (`001`-`042`; was 39 before review round 2 added `040`-`042`)
- **First**: `001_initial_schema.sql`
- **Last**: `042_realtime_replica_identity.sql`
- **Duplicate version numbers**: none
- **Missing sequence numbers**: none — `001`–`042` is fully contiguous
- **Naming convention**: all 42 match `NNN_description.sql`; no outliers
- **Confirms**: the chain is exactly `001`–`042` (it was `001`–`039` at
  the time of the first audit; `040`, `041` and `042` were added during
  the two review rounds — see the addenda at the end of this file).

## Manifest

| # | Filename | Primary objects | Schema | Depends on | SEC DEFINER | auth.users | storage | Realtime | Irreversible ops |
|---|---|---|---|---|---|---|---|---|---|
| 001 | initial_schema.sql | profiles, contacts, tags, contact_tags, custom_fields, contact_custom_values, contact_notes, conversations, messages, whatsapp_config, message_templates, pipelines, pipeline_stages, deals, broadcasts, broadcast_recipients | crm | none (first) | Yes (`handle_wacrm_user_created`, superseded by 017) | Yes (trigger + FKs) | No | Yes (messages, conversations) | No |
| 002 | pipelines_enhancements.sql | ALTER deals | crm | 001 | No | No | No | No | No |
| 003 | broadcast_recipient_wamid.sql | ALTER broadcast_recipients | crm | 001 | Yes (superseded by 005) | No | No | No | No |
| 004 | contact_delete_set_null.sql | ALTER broadcast_recipients, deals (FK ON DELETE SET NULL) | crm | 001 | No | No | No | No | FK constraint drop+recreate (schema change, not data loss) |
| 005 | broadcast_counts_incremental.sql | replaces 003's trigger body | crm | 001, 003 | Yes (`_bcast_bump`, `broadcast_recipient_aggregate_trigger`, `recompute_broadcast_counts`) | No | No | No | No |
| 006 | automations.sql | automations, automation_steps, automation_logs, automation_pending_executions | crm | 001 | No | Yes (FKs) | No | No | No |
| 007 | automations_increment_counter.sql | `increment_automation_execution_count()` | crm | 006 | Yes | No | No | No | No |
| 008 | profile_avatars_storage.sql | storage bucket `avatars` + policies | crm (policies reference crm.profiles) | 001 | No | No | Yes | No | No |
| 009 | message_actions.sql | message_reactions; ALTER messages (reply_to) | crm | 001 | No | No | No | Yes (message_reactions) | No |
| 010 | flows.sql | flows, flow_nodes, flow_runs, flow_run_events | crm | 001 | No | Yes (FKs) | No | Yes (flow_runs) | No |
| 011 | profile_beta_features.sql | ALTER profiles | crm | 001 | No | No | No | No | No |
| 012 | flows_increment_counter.sql | `increment_flow_execution_count()` | crm | 010 | Yes | No | No | No | No |
| 013 | whatsapp_config_phone_number_id_unique.sql | unique index | crm | 001 | No | No | No | No | No |
| 014 | message_templates_meta_integration.sql | ALTER message_templates | crm | 001 | No | No | No | No | No |
| 015 | whatsapp_config_registration.sql | ALTER whatsapp_config | crm | 001 | No | No | No | No | No |
| 016 | flow_media.sql | ALTER flow_nodes; storage policies | crm | 010 | No | No | Yes | No | No |
| 017 | account_sharing.sql | accounts, account_invitations; ALTERs ~15 tables (adds account_id) | crm | 001, 006, 010 | Yes (`is_account_member`, `handle_wacrm_user_created` final) | Yes (trigger replaces 001's, FKs) | No | No | Rewrites RLS policies (drop+recreate, not data loss) |
| 018 | account_member_rpcs.sql | `set_member_role`, `remove_account_member`, `transfer_account_ownership` | crm | 017 | Yes (×3) | Yes (`auth.uid()`) | No | No | No |
| 019 | invitation_rpcs.sql | `peek_invitation`, `redeem_invitation` | crm | 017 | Yes (×2) | No | No | No | `redeem_invitation` DELETEs an invitation row (by design) |
| 020 | account_sharing_followups.sql | storage policy updates | crm | 008, 016, 017 | No | No | Yes | No | No |
| 021 | account_default_currency.sql | ALTER accounts | crm | 017 | No | No | No | No | No |
| 022 | contact_phone_dedup.sql | ALTER contacts (generated column); `merge_duplicate_contacts()` | crm | 001, 017 | Yes | No | No | No | `merge_duplicate_contacts()` DELETEs duplicate rows (by design, one-time cleanup) |
| 023 | chat_media.sql | storage policies | crm | 017 | No | No | Yes | No | No |
| 024 | member_presence.sql | member_presence; `touch_presence()` | crm | 017 | Yes | Yes (`auth.uid()`) | No | Yes (member_presence) | No |
| 025 | filter_contacts_by_tags.sql | `filter_contacts_by_tags()` | crm | 001, 017 | No | No | No | No | No |
| 026 | api_keys.sql | api_keys | crm | 017 | No | Yes (FK `created_by`) | No | No | No |
| 027 | notifications.sql | notifications; `notify_conversation_assigned()` | crm | 017 | Yes | Yes (FKs, `auth.uid()`) | No | Yes (notifications) | No |
| 028 | webhook_endpoints.sql | webhook_endpoints; `record_webhook_failure()` | crm | 017 | Yes | Yes (FK `created_by`) | No | No | No |
| 029 | ai_reply.sql | ai_configs; ALTER conversations; `claim_ai_reply_slot()` | crm | 017 | Yes | Yes (FK `created_by`) | No | No | No |
| 030 | ai_knowledge.sql | ai_knowledge_documents, ai_knowledge_chunks; match functions | crm | 017, 029 | Yes (×2, later downgraded to INVOKER by 032) | Yes (FK `created_by`) | No | No | No |
| 031 | ai_reply_slot_grant.sql | re-asserts GRANT on `claim_ai_reply_slot` | crm | 029 | Yes (re-grant only) | No | No | No | No |
| 032 | fix_ai_knowledge_membership.sql | redefines match functions as SECURITY INVOKER | crm | 030 | Yes→No (downgrade, security fix GHSA-fg5p-2qc3-jmxr) | No | No | No | No |
| 033 | ai_reply_polish.sql | ai_usage_log; ALTER ai_configs, conversations, messages | crm | 029, 030 | No | Yes (FK `handoff_agent_id`) | No | No | No |
| 034 | fix_profiles_update_rls.sql | `enforce_profile_privilege_columns()` trigger (INVOKER, not DEFINER) | crm | 017 | Yes* (*listed by grep but is actually the trigger function only — not privileged, runs as invoker) | No | No | No | No |
| 035 | interactive_messages.sql | quick_replies; ALTER messages | crm | 001, 017 | No | Yes (FK `created_by`) | No | No | No |
| 036 | conversation_contact_dedup.sql | `merge_duplicate_conversations()` | crm | 001, 017 | Yes | No | No | No | DELETEs duplicate conversation rows (by design, one-time cleanup) |
| 037 | workspace_brand_map.sql | workspace_brand_map | crm | 017 (references `accounts`) | No | No | No | No | No |
| 038 | phone_normalization.sql | `normalise_phone_e164()`; ALTER contacts (customer_id, link cols) | crm | 001 (contacts); reads `public.customers` conceptually via 039 | No | No | No | No | No |
| 039 | identity_linking.sql | identity_link_conflicts; `resolve_customer_candidates`, `link_contact_to_customer`, `reconcile_contact_customer_links` | crm (reads `public.customers` read-only) | 001, 017, 037, 038 | Yes (×4) | No | No | No | No |

## Corrections to §2 grep in `034`

Grep flagged `034_fix_profiles_update_rls.sql` under `SECURITY DEFINER` in
the file-level search, but on inspection (see `PHASE1_MIGRATION_AUDIT.md`
§2) `enforce_profile_privilege_columns()` is **not** `SECURITY DEFINER` —
it runs as invoker and discriminates via `current_user = 'authenticated'`.
Corrected in the table above.

## Dependency graph (informal)

```
001 ─┬─> 002,003,004,005,009,010,011,013,014,015,022,038
     └─> 006 ─> 007,012
017 (needs 001,006,010) ─┬─> 018,019,020,021,023,024,025,026,027,028,
                          │   029,033,034,035,036,037
                          └─> 022 (needs 001 too)
029 ─> 030 ─> 031,032,033
037,038 ─> 039
```

No forward references found (every ALTER/FK targets a table created in an
earlier-numbered file) — consistent with a chain that can apply
strictly in order 001→042 with no reordering needed.

## Addendum — 040, 041 (added in the fresh-migration-validation session)

| # | Filename | Primary objects | Schema | Depends on | SEC DEFINER | auth.users | storage | Realtime | Irreversible ops |
|---|---|---|---|---|---|---|---|---|---|
| 040 | phone_linkability_guard.sql | `is_linkable_phone_e164()`; replaces `link_contact_to_customer()` | crm | 038, 039 | Yes (redefines `link_contact_to_customer`, already DEFINER) | No | No | No | No |
| 041 | crm_schema_grants.sql | `GRANT USAGE ON SCHEMA crm` + table/sequence/function grants + `ALTER DEFAULT PRIVILEGES` | crm | none (grants only) | No | No | No | No | No |

**Real chain is now `000` (test-fixture only, never committed as a
numbered migration) + `001`-`041`.** Migration `041` exists because a
real isolated-environment test caught a genuine gap: `crm` schema was
never granted `USAGE` to `anon`/`authenticated`/`service_role` anywhere
in `001`-`040` — see `PHASE1_TEST_REPORT.md` for the full story (found via
a real PostgREST request returning `42501 permission denied for schema
crm`, not by static review).

## Addendum 2 — migration 042 (review round 2)

| # | Filename | Primary objects | Schema | Depends on | SEC DEFINER | auth.users | storage | Realtime | Irreversible ops |
|---|---|---|---|---|---|---|---|---|---|
| 042 | realtime_replica_identity.sql | `ALTER TABLE ... REPLICA IDENTITY FULL` on `message_reactions`, `member_presence`, `notifications` | crm | 009, 024, 027 | No | No | No | Yes (affects WAL payload for published tables) | No |

**Chain is now `001`–`042` (42 executable migrations)**, plus the
non-committed `000` test fixture staged only during a local run
(`npm run db:test:reset`) — 43 files applied in a from-zero run.

### `042` rationale in full

Postgres sends only the columns in a table's REPLICA IDENTITY in the OLD
image of an UPDATE/DELETE (default: primary key). Supabase Realtime uses
that OLD image both for the client's `old` payload **and** for evaluating
a server-side subscription `filter:` on DELETE — so a subscription
filtering on a non-replica-identity column has its DELETE events dropped
silently.

| Table | Requirement | Enabled |
|---|---|---|
| `crm.message_reactions` | subscription filters `conversation_id`; PK is `id` → reaction removals never reach the client | ✓ |
| `crm.member_presence` | filters `account_id`; PK is `user_id` → a teammate going offline never clears | ✓ |
| `crm.notifications` | `use-unread-notifications` reads `old.read_at` on DELETE (non-PK) → unread badge drifts | ✓ |
| `crm.conversations` | unfiltered; reads only `old.id` (PK) | ✗ not needed |
| `crm.messages` | unfiltered; no old-value dependency | ✗ not needed |
| `crm.flow_runs` | published, but no app subscription | ✗ not needed |
| `crm.contacts`, `crm.broadcast_recipients` | not in the publication at all | ✗ not needed |

**Not applied globally on purpose.** `REPLICA IDENTITY FULL` writes every
column of every UPDATE/DELETE into the WAL — a permanent cost in WAL
volume, replication bandwidth and disk that scales with table churn. It
belongs only where a subscription actually depends on it. Each of the
three carries its reason inline in the migration.

**Verified paths:** reaction INSERT/UPDATE/DELETE, notification
INSERT/UPDATE/DELETE, presence INSERT/DELETE, message INSERT,
conversation UPDATE, and cross-workspace isolation — 10/10 live, see
`PHASE1_TEST_REPORT.md`.

Migration `041` was also substantially rewritten in round 2 — see
`docs/PHASE1_TEST_REPORT.md` for why the original version was a
privilege-escalation regression.
