# Phase 1 — Migration Audit (`supabase/migrations/001`–`036`)

Every claim below comes from a full grep pass over all 36 files this
session, cross-checked against a live schema query on `ugjishankutgfegplrgq`
where relevant. Confirmed clean slate: **none of these 36 migrations have
ever been applied to `ugjishankutgfegplrgq`** (no wacrm table name exists
in `public` there) — they are being edited in place before their first
apply, not ported around a live collision.

## 1. `public.` references (80 matches)

- Function definitions: most functions are created as `public.foo`; four
  are created **unqualified** (`is_account_member`, `increment_automation_
  execution_count`, `increment_flow_execution_count`, `notify_conversation_
  assigned`) and rely entirely on `search_path` to land in `public` today —
  these are the highest-risk rename targets since nothing about their own
  `CREATE FUNCTION` statement says where they go.
- `INSERT INTO public.profiles/accounts` (001, 017), `SELECT ... FROM
  public.profiles p` in storage RLS policies (017, 020, 023).
- `ALTER FUNCTION public.xxx OWNER TO postgres` — 17 occurrences.
- `REVOKE ALL ON FUNCTION public.xxx FROM PUBLIC` — 10 occurrences.
- `GRANT EXECUTE ON FUNCTION public.xxx TO ...` — see §6.
- One-shot invocations: `SELECT public.merge_duplicate_contacts();` (022),
  `SELECT public.merge_duplicate_conversations();` (036).
- `PERFORM public.recompute_broadcast_counts(...)` inside a trigger body
  (003:69,75).
- `EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', ...)` —
  `017:380`, dynamic SQL with `public` hardcoded in the format string.

**Biggest risk class found:** DEFINER function bodies that call *other*
unqualified helper functions/tables (e.g. `_bcast_bump`/`_bcast_cols_for_
status` called unqualified from inside `broadcast_recipient_aggregate_
trigger()`). These only resolve correctly today because the *caller's*
`SET search_path = public` is in effect during execution — moving the
caller's search_path without also confirming the callee lands in the same
schema breaks it silently.

## 2. `SECURITY DEFINER` functions — 19 distinct (some superseded), all hardened

| Function | Final def | References (schema needs) |
|---|---|---|
| `handle_new_user()` | `017:659` | `accounts`, `profiles` → **crm** |
| `is_account_member(...)` | `017:136` | `profiles`, `auth.uid()` (qualified) → **crm** |
| `set_member_role(...)` | `018:37` | `profiles`, `account_role_enum` → **crm** |
| `remove_account_member(...)` | `018:127` | `profiles`, `accounts`, `account_role_enum` → **crm** |
| `transfer_account_ownership(...)` | `018:217` | `profiles` ×2, `accounts` → **crm** |
| `peek_invitation(...)` | `019:43` | `account_invitations`, `accounts` → **crm** |
| `redeem_invitation(...)` | `019:125` | 14 tables (`account_invitations`, `profiles`, `accounts`, `contacts`, `conversations`, `broadcasts`, `automations`, `flows`, `pipelines`, `message_templates`, `tags`, `custom_fields`, `contact_notes`, `whatsapp_config`) → **crm** |
| `merge_duplicate_contacts()` | `022:38` | 10 tables → **crm** |
| `touch_presence(...)` | `024:56` | `profiles`, `member_presence` → **crm** |
| `notify_conversation_assigned()` | `027:56` | `contacts`, `profiles`, `notifications` → **crm** |
| `record_webhook_failure(...)` | `028:91` | `webhook_endpoints` → **crm**. No REVOKE/GRANT follows this one — pre-existing gap, unrelated to the schema move, flagged for whoever owns hardening. |
| `claim_ai_reply_slot(...)` | `029:118` | `conversations` → **crm** |
| `match_ai_knowledge_fts/semantic` | `032:47,65` | `ai_knowledge_chunks` (**crm**) + `vector` type/`<=>` operator — **confirmed live: `vector` extension is installed in `public`, not `extensions`, on this project** → needs `public` in path too. Downgraded to `SECURITY INVOKER` by 032 (still needs the path fix for unqualified table refs). |
| `merge_duplicate_conversations()` | `036:41` | 7 tables → **crm** |
| `increment_automation_execution_count(...)` | `007:19` | `automations` (implicit via UPDATE) → **crm** |
| `increment_flow_execution_count(...)` | `012:20` | `flows` → **crm** |
| `_bcast_bump/_bcast_cols_for_status/broadcast_recipient_aggregate_trigger/recompute_broadcast_counts` | `005` | `broadcasts`, `broadcast_recipients` (one via dynamic `EXECUTE format()`, not visible to static grep) → **crm** |

**Hardened search_path applied (§ see migration diffs):** `pg_catalog,
crm, extensions, public, pg_temp` for every function above — `public` is
included (after `extensions`) specifically because the `vector` extension
lives there on this project, not because these functions should read
brain data; the two `ai_knowledge` functions are the only ones that
actually need it, but a uniform hardened path across all DEFINER
functions is simpler to reason about and both `public` and `extensions`
have `CREATE` revoked from `PUBLIC`/`authenticated`/`anon` (confirmed
live via `has_schema_privilege`), so including them in the path is not a
privilege-escalation risk.

## 3. `SET search_path` — 26 existing declarations, all `= public`

24 on the DEFINER functions above (one per version); 1 on a non-DEFINER
trigger function (`enforce_profile_privilege_columns`, 034); 4 plain
`updated_at`-bump triggers have **no** explicit search_path at all
(`update_updated_at_column`, `_bcast_cols_for_status`, `update_ai_configs_
updated_at`, `update_ai_knowledge_documents_updated_at`) — low risk (no
schema-qualified access, only `NEW`/pure computation) but given a hardened
path too for consistency.

## 4. `ALTER PUBLICATION supabase_realtime` — 6 `ADD TABLE` statements

`001` (messages, conversations), `009` (message_reactions), `010`
(flow_runs), `024` (member_presence), `027` (notifications). All wrapped
in `IF NOT EXISTS (SELECT ... FROM pg_publication_tables WHERE
pubname='supabase_realtime' AND tablename='x')` guards that **do not
filter by `schemaname`** — rewritten to `ALTER PUBLICATION supabase_
realtime ADD TABLE crm.x` with the guard's `WHERE` clause updated to also
check `schemaname = 'crm'`, closing a false-positive risk if a same-named
table ever existed in another schema during a transitional state.

## 5. `ALTER DEFAULT PRIVILEGES` — none found. No change needed.

## 6. `GRANT`/`REVOKE` — 16 grants, ~10 paired revokes, all function-scoped

Every one needs its function reference updated to `crm.function_name(...)`.
One exception: `027_notifications.sql:51` — `GRANT UPDATE (read_at) ON
notifications TO authenticated;` is a **column-level table grant**, not a
function grant — becomes `ON crm.notifications`.

## 7. `CREATE POLICY` — 155 statements, 34 distinct tables + 2 `storage.objects` policy sets

None of the 155 policies schema-qualify their target table (`CREATE
POLICY x ON tablename`, never `ON public.tablename`) — Postgres resolves
the target via `search_path` at apply time, so **no rewrite of the policy
statements themselves is needed**, only correct `search_path` in the
applying session (handled by the file-level `SET search_path` in every
migration). The two `storage.objects` policy sets (avatars — 008; flow
media — 016, 020; chat media — 023) stay attached to Supabase's built-in
`storage.objects` table (unmoved) but their `USING`/`WITH CHECK` clauses
reference `public.profiles` — rewritten to `crm.profiles`.

## 8. `CREATE TRIGGER` — 17 triggers, 2 on `auth.users`

`auth.users` stays in the `auth` schema (Supabase-managed, out of scope).
The two `on_auth_user_created` triggers (001, superseded by 017) are
**renamed** to `on_auth_user_created_wacrm` firing `crm.handle_wacrm_user_
created()` — see §9. All 15 other triggers are ordinary `updated_at`-bump
or business-logic triggers on wacrm's own tables, moving to `crm`
automatically via the schema move (trigger definitions don't schema-qualify
their own table, same resolution-via-search_path as policies).

## 9. Auth trigger namespacing

Original: `on_auth_user_created` / `public.handle_new_user()`. Generic
enough to collide with a future Yali-side Supabase Auth trigger on the
same `auth.users` table (confirmed via live `pg_trigger` query: zero
non-internal triggers exist on `auth.users` today, so this is a
preventive rename, not a live fix). Renamed in both `001` and `017`
(017's version supersedes 001's) to:

```text
on_auth_user_created_wacrm  →  crm.handle_wacrm_user_created()
```

## 10. `CREATE VIEW`/`MATERIALIZED VIEW` — none. `CREATE SEQUENCE` — none (all PKs are `uuid_generate_v4()`/`gen_random_uuid()`).

## 11. `REFERENCES public.` — none (all FKs unqualified except `auth.users(id)`, 19 occurrences — unaffected by the move, cross-schema FK syntax needs no change).

## 12. Extensions — verified live, not assumed

| Extension | Actual installed schema |
|---|---|
| `uuid-ossp` | `extensions` |
| `pgcrypto` | `extensions` |
| `vector` (pgvector 0.8.0) | **`public`** — not `extensions`, despite migration 030's own comment assuming otherwise |

This is why the hardened search_path includes `public` — it's the real
location of `vector`, verified via `list_extensions`, not inferred from
migration comments.

## 13. Local test tooling — confirmed absent in both repos

No `supabase/config.toml`, no CI workflow referencing Supabase, no
Postgres service in `docker-compose.yml` (single `app` service only, no
`db`). See `PHASE1_TEST_REPORT.md` for how this phase tested the rewrite
anyway.

## Corrections to the prior session's plan (`PHASE1_DATA_FOUNDATION_PLAN.md`)

Two claimed "gaps" were **false positives** from checking `pg_constraint`
instead of `pg_indexes` — `CREATE UNIQUE INDEX` (as opposed to `ALTER
TABLE ... ADD CONSTRAINT ... UNIQUE`) does not create a `pg_constraint`
row, only a `pg_indexes`/`pg_class` entry. Verified live via `pg_indexes`
this session:

- **`orders_comez_unique`** — `UNIQUE INDEX ON public.orders (brand_id,
  comez_order_id) WHERE comez_order_id IS NOT NULL` **already exists**
  (defined in `Yali Build 2.0/supabase/migrations/20260604120100_yali_
  extensions.sql:90`, confirmed applied live). No new idempotency
  migration needed — the prior plan's proposed `037_orders_comez_
  idempotency.sql` is dropped.
- **`customers_brand_phone_hash_unique`** — `UNIQUE INDEX ON public.
  customers (brand_id, phone_hash) WHERE phone_hash IS NOT NULL`
  **already exists** (`011_customers.sql:38-39`, confirmed applied live).
  The prior plan's "real gap, needs coordination" flag on this is
  withdrawn — it's already enforced at the DB level. `tenant_id`/`brand_id`
  on `orders` are also already `NOT NULL` at the column level (not
  nullable as the prior plan's CHECK-constraint proposal assumed), so the
  step-9-style CHECK constraint this phase's spec asked to consider is
  unnecessary — the constraint it would enforce already holds
  unconditionally.
