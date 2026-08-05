# Phase 1 — Test Report

---

## Review round 2 — results (latest run)

Full chain re-applied from zero after every change below.

```text
supabase db reset — 42 migrations — PASS
```

**42 executable migrations (`001`–`042`), plus the `000` test fixture =
43 files applied. 0 errors.** Log:
`docs/phase1-test-logs/db-reset-clean-run.log` (`grep -c "Applying
migration"` → 43; `grep -ci error` → 0; fixture contract emits
`Fixture contract OK`).
`typecheck` clean · `build` succeeds · `test` 67 files / 654 tests.

**Note on one intermediate run:** a reset immediately after the fixture's
comment-only edit exited 1 — but **all 43 files had already applied
successfully**; the failure was the CLI's post-migration container
restart (`No such container: supabase_storage_laddoos-crm`), a local
Docker/CLI flake with the daemon healthy and unrelated containers
untouched. Re-run from a fresh `supabase start`: exit 0, 43 applied, 0
errors. Recorded rather than silently overwritten, because "it passed the
second time" is only trustworthy if the first failure is explained.

### Two further real defects found and fixed this round

**1. Migration `041` was silently re-opening deliberately locked-down
functions.** Its `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO
authenticated` ran *after* migrations `007`/`012`/`039` had explicitly
`REVOKE`d those same functions from `authenticated` — so it undid them.
`007`'s own comment states the intent it was defeating: *"Explicitly lock
anon / authenticated out so an authenticated user can't juice someone
else's counter via RPC."* A blanket grant at the end of a chain overrides
every per-function decision made earlier in it. Replaced with explicit
per-function grants; the blanket grant and the default `EXECUTE ON
FUNCTIONS` privilege (which would have re-created the bug for every
*future* function) are both gone.

**2. The fixture contract test had a bug in itself**, found by writing a
negative control for it. `missing := missing || 'text'` resolves
ambiguously in PL/pgSQL — Postgres tried to parse the string as an array
literal, so a genuine contract violation would have produced
`malformed array literal` instead of the intended message. Fixed with
`array_append`. Re-verified in both directions: intended exception when
an element is missing, `Fixture contract OK` notice when present.

### Anonymous grants — before / after

| | before | after |
|---|---|---|
| `USAGE ON SCHEMA crm` | ✓ | ✓ (required for `peek_invitation`) |
| `SELECT ON ALL TABLES` | ✓ **(unnecessary)** | ✗ removed |
| default `SELECT` on future tables | ✓ **(unnecessary)** | ✗ removed |
| `EXECUTE crm.peek_invitation(TEXT)` | ✓ (via `019`) | ✓ re-asserted explicitly |
| everything else | — | ✗ |

`peek_invitation` is `SECURITY DEFINER`, so it reads its tables as the
function owner — anonymous callers need no table privileges at all.

### Function privilege audit (13 functions, live `has_function_privilege`)

| function | authenticated | anon | service_role |
|---|---|---|---|
| `_bcast_bump` | ✗ | ✗ | ✗ (owner only) |
| `merge_duplicate_contacts` | ✗ | ✗ | ✗ (owner only) |
| `resolve_customer_candidates` | ✗ | ✗ | ✗ (owner only) |
| `increment_automation_execution_count` | **✗** | ✗ | ✓ |
| `increment_flow_execution_count` | **✗** | ✗ | ✓ |
| `link_contact_to_customer` | ✗ | ✗ | ✓ |
| `recompute_broadcast_counts` | ✗ | ✗ | ✓ |
| `reconcile_contact_customer_links` | ✗ | ✗ | ✓ |
| `record_webhook_failure` | ✗ | ✗ | ✓ |
| `is_account_member` | ✓ | **✗** | ✓ |
| `touch_presence` | ✓ | ✗ | ✗ |
| `peek_invitation` | ✓ | **✓** | ✗ |
| `redeem_invitation` | ✓ | **✗** | ✗ |

The bolded `authenticated ✗` rows are the ones defect #1 had wrongly set
to ✓.

### Invitation flow + anonymous denial (1 positive, 5 negatives)

| test | expected | result |
|---|---|---|
| anon `peek_invitation` on a real token | succeeds | **PASS** — returned account name, role, expiry |
| authenticated `redeem_invitation` | succeeds | **PASS** — user joined workspace A as `agent` |
| anon `SELECT` on `crm.contacts` | denied | **PASS** — `permission denied for table contacts` |
| anon `INSERT` into `crm.contacts` | denied | **PASS** — `permission denied for table contacts` |
| anon `redeem_invitation` | denied | **PASS** — `permission denied for function` |
| anon `resolve_customer_candidates` | denied | **PASS** — `permission denied for function` |
| **authenticated** `increment_automation_execution_count` | denied | **PASS** — proves defect #1 is fixed |

**Anonymous redemption is impossible by design, not a gap.**
`redeem_invitation` assigns the invitation to `auth.uid()`, which an
anonymous session does not have. It was not "made to pass" by granting
`anon`.

### RLS isolation

Three users across two workspaces (User B joined workspace A via the real
invitation flow, so a third user C was created for isolation testing):

- User A reads → only workspace A's contact. **PASS**
- User C reads → only workspace C's contact. **PASS**
- User B (joined A) reads → workspace A's contact. **PASS**
- User C inserts with a **literal** workspace-A `account_id` → `new row
  violates row-level security policy`. **PASS**
- User C inserts into their own workspace → succeeds. **PASS** (positive
  control)

The literal-ID variant matters: the first attempt used a subquery, which
returned no rows (RLS on `profiles` hid it) and produced `INSERT 0 1`
with nothing attempted — a false pass of the same class caught earlier in
this project. Re-run with a hard-coded ID to force a real policy
evaluation.

### Realtime UPDATE/DELETE — migration `042`

Subscription audit found the tables whose DELETE path depends on
`REPLICA IDENTITY FULL`:

| table | why | enabled |
|---|---|---|
| `crm.message_reactions` | subscription filters `conversation_id`, not in PK → DELETE events dropped entirely | ✓ |
| `crm.member_presence` | filters `account_id`, PK is `user_id` → DELETE dropped | ✓ |
| `crm.notifications` | `use-unread-notifications` reads `old.read_at` on DELETE | ✓ |
| `crm.conversations` | reads only `old.id` (PK) | ✗ not needed |
| `crm.messages` | no old-value dependency | ✗ not needed |

Verified live, 10/10:

```
PASS messages INSERT          PASS notification UPDATE
PASS conversations UPDATE     PASS notification DELETE   [042]
PASS reaction INSERT          PASS presence INSERT
PASS reaction UPDATE          PASS presence DELETE       [042]
PASS reaction DELETE  [042]   PASS cross-workspace isolation
```

An earlier run of this test failed 4 of 9 with a clear signature — only
the *last* event per table arrived, and out of call order. That was a
subscription warm-up race in the harness, **not** a product defect:
spacing the calls made every case pass with no product change. Recorded
here rather than quietly re-run, because "add a sleep until it passes" is
exactly how a real intermittent bug gets buried.

### Commerce + identity (re-run on the final chain)

| test | result |
|---|---|
| Comez order, 6× duplicate delivery | **PASS** — 1 row |
| exact single match | **PASS** — `automatic` / `exact` |
| zero matches | **PASS** — unlinked |
| unlinkable phone (`12345`) | **PASS** — unlinked, no conflict recorded |
| late-arriving customer + reconciliation | **PASS** — linked on reconcile |
| manual link survives a phone change | **PASS** |
| reconciliation idempotency (runs 2 and 3) | **PASS** — identical, 0 conflict rows |
| `ON DELETE SET NULL` | **PASS** |
| phone normalization, 10 cases (applied fn) | **PASS** |
| phone linkability, same 10 cases | **PASS** |

---

**PRODUCTION APPLY PERMITTED: NO** — but the core blocking gap from the
prior two sessions is now closed. The full migration chain has been
applied from zero in a real isolated environment, real bugs were found
and fixed, and extensive real (not static) verification passed. What's
left is narrower and listed explicitly at the end.

## Environment used

**Path A (local Supabase) — succeeded**, after a real environment fix:

- Docker Desktop's engine repeatedly crash-looped on startup
  (`starting services: initializing Inference manager` / `Secrets
  Engine`, both failing with `The file cannot be accessed by the system`)
  — root-caused to corrupted stale runtime socket files
  (`%LOCALAPPDATA%\Docker\run\dockerInference`,
  `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`) left over from an
  earlier crash. `rm`/`Remove-Item`/`cmd del`/`fsutil reparsepoint
  delete`, and a full `wsl --shutdown`, all failed identically on the
  specific files (Windows error 1920 — the reparse-point metadata itself
  was corrupted, not merely locked). **Fix**: renaming the *parent*
  directories (`Docker\run`, `docker-secrets-engine`) succeeded where
  deleting the specific corrupted children did not — this let Docker
  Desktop recreate clean versions on next launch. Also disabled
  `EnableDockerAI` in `%APPDATA%\Docker\settings-store.json` after the
  Inference manager's socket corrupted itself again immediately on a
  fresh recreate (this Docker Desktop feature appears to reliably fail in
  this environment; disabling it was sufficient without needing to touch
  the underlying cause further).
- Docker 29.2.1, Supabase CLI 2.111.0 (`npx supabase`)
- Full local stack: `supabase_db_laddoos-crm`, `supabase_auth`, `supabase_rest`
  (PostgREST), `supabase_realtime`, `supabase_storage`, `supabase_kong`,
  `supabase_studio`, `supabase_pg_meta`, `supabase_analytics`,
  `supabase_edge_runtime`, `supabase_inbucket`, `supabase_vector`
- Ports shifted to 55321-55323 (API/DB/Studio) to avoid colliding with a
  pre-existing, unrelated local Supabase project on the same machine
  (`supabase_db_YALI_OS_3.0`) — that project was never touched.

**Path B (Supabase branch)**: not needed — Path A succeeded.

## The full chain, applied from zero — with one real failure, fixed, then a clean rerun

**Attempt 1 (`supabase start`, first-ever local apply): FAILED**, exactly
as rule 1 exists to catch:

```
Applying migration 038_phone_normalization.sql...
ERROR: relation "public.customers" does not exist (SQLSTATE 42P01)
```

Root cause: `038` (and `039`) FK to `public.customers`, which exists on
the real shared target (`ugjishankutgfegplrgq`, owned by the Yali Build
2.0 repo) but not on a truly blank Postgres. This is not a bug in the
migration — the dependency is real and intentional (documented in
`PHASE1_SCHEMA_OWNERSHIP.md`). The fix was a **test-fixture-only** file
(`supabase/test-fixtures/000_public_schema_fixture.sql`, copied to
`migrations/000_...` for the test run and removed afterward — never
committed as a real numbered migration) reproducing the load-bearing
shape of `public.tenants`/`brands`/`customers`/`orders` from the real
target's actual DDL, so the isolated test accurately represents the real
deployment target instead of an unrealistically empty database.

**Attempt 2 (fixture added): got further, found a second real bug via a
real PostgREST request, not static review:**

```
{"code":"42501","message":"permission denied for schema crm"}
```

Both an anon-key and a **service-role-key** request to `crm.contacts`
were rejected. Root cause: `public` schema gets `USAGE` granted to
`anon`/`authenticated`/`service_role` by default in every Supabase
project; a newly-created schema like `crm` does not — nothing in
migrations 001-040 ever granted it. Fixed with
`041_crm_schema_grants.sql` (`GRANT USAGE ON SCHEMA crm`, table/sequence/
function grants, `ALTER DEFAULT PRIVILEGES` for future objects). Per rule
7, the database was reset and the **entire chain reapplied from zero**
rather than patching the running instance.

**Attempt 3 (with 041): full chain applied cleanly, zero errors.**
43 files applied (the `000` test fixture + 42 executable migrations
`001`-`042`), full log retained at
`docs/phase1-test-logs/db-reset-clean-run.log`.

| Migration | Result |
|---|---|
| `000` (test fixture) | ✅ |
| `001`-`037` | ✅ (no issues found or expected — the crm-schema rewrite itself) |
| `038_phone_normalization` | ✅ on rerun (failed attempt 1 for the reason above) |
| `039_identity_linking` | ✅ |
| `040_phone_linkability_guard` | ✅ |
| `041_crm_schema_grants` | ✅ (new this session, fixes the PostgREST grant gap) |

## What was verified for real (not statically) against the isolated instance

**Schema isolation** — direct catalog queries:
- `public` schema: exactly `tenants`, `brands`, `customers`, `orders` (the fixture) — **zero** wacrm objects.
- `crm` schema: 38 tables, 0 sequences, 0 views, 0 materialized views — matches the migration audit's expectations.
- `auth.users` triggers: exactly `on_auth_user_created_wacrm` — no generic name claimed, no collision.
- 22 `SECURITY DEFINER` functions confirmed in `crm` via `pg_proc`.
- Realtime publication (`supabase_realtime`): exactly `crm.conversations`, `crm.flow_runs`, `crm.member_presence`, `crm.message_reactions`, `crm.messages`, `crm.notifications` — schema-qualified, no `public.*` duplicates.

**Auth trigger** — real signup, not simulated: inserted a real row into
`auth.users`; confirmed a matching `crm.profiles` row + a freshly-created
`crm.accounts` row were created atomically in the same transaction, with
the correct `full_name`/`email` populated from `raw_user_meta_data`.

**PostgREST + grants**:
- First attempt: both anon and service-role requests to `crm.contacts` denied with `42501` (the bug above).
- After `041`: anon request → `[]` (correctly RLS-scoped, not schema-denied). Service-role request → succeeds.

**RLS cross-workspace isolation** — real fixtures, not mocked:
- Created two real users → two real accounts (workspaces) via the real auth trigger.
- One contact per workspace.
- `SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '{"sub":"<user-a>"}'` (inside an explicit transaction — `SET LOCAL` silently no-ops outside one, a real gotcha hit and fixed during this test) → User A's query returned **only** Workspace A's contact.
- Same for User B → **only** Workspace B's contact.
- **Unauthorized cross-tenant INSERT attempt** (User A inserting a contact under Workspace B's `account_id`) → correctly rejected: `ERROR: new row violates row-level security policy for table "contacts"`.

**Identity linking end-to-end** — real data, real trigger, real functions, covering the scenarios from the original spec that are actually reachable given the real schema's own constraints (see note below on scenario 7):
1. 1 exact match → auto-linked (`customer_link_source='automatic'`, `confidence='exact'`) — contact phone `9876543210` (digits-only, as WhatsApp webhooks deliver it) correctly resolved to `+919876543210` and matched a pre-seeded customer.
2. 0 matches → stays unlinked, no error.
3. Unlinkable value (`12345`, too short) → stays unlinked, correctly distinguished from "0 matches" (not recorded as ambiguous either).
4. **Late-arriving customer**: contact created first with no match, matching customer added afterward, `reconcile_contact_customer_links()` called → contact became linked. Reported `contacts_scanned=4, contacts_linked=2, contacts_unmatched=2, contacts_ambiguous=0, contacts_skipped_no_mapping=0`.
5. **Manual-link protection**: manually linked a contact, then changed its phone (which fires the trigger) → link survived unchanged, still `source='manual'`.
6. **Reconciliation idempotency**: ran twice, second run correctly excluded the manually-linked contact from rescanning (`contacts_scanned` dropped from 4 to 3), zero duplicate `identity_link_conflicts` rows.
7. **`ON DELETE SET NULL`**: deleted a linked customer → the contact's `customer_id` correctly nulled, no FK error.
8. Comez order idempotency (6x duplicate delivery of the same `comez_order_id` via the real `ON CONFLICT (brand_id, comez_order_id) WHERE comez_order_id IS NOT NULL DO UPDATE` form) → exactly 1 row.

**Note on the "many matches" scenario**: the original spec asked to test
0/1/many-match handling, including "same phone across two brands." Real
finding: `public.customers` has a genuine unique index on `(brand_id,
phone_hash)` (confirmed live), so **more than one match for a given
(tenant, brand, phone) combination cannot occur** under the current data
model — the "ambiguous, record a conflict" branch in `link_contact_to_
customer()` is defensive code for a state the schema's own constraints
already prevent, not a reachable production scenario. This isn't a gap —
it's the constraint doing its job — but it means that branch is exercised
by inspection/reasoning, not a live many-row fixture, since one couldn't
be constructed without first violating a real constraint.

## Realtime — resolved in a follow-up session, and it found a real app bug

The earlier inconclusive result was **my test being wrong, not the
system**: it subscribed to `crm.contacts`, which is not in the
`supabase_realtime` publication — and correctly shouldn't be, because
nothing in the app subscribes to it.

Auditing what the app *actually* subscribes to (grep for
`postgres_changes` across `src/`) surfaced **a genuine Phase 1 bug the
earlier client audit missed entirely**: all 9 Realtime subscriptions
hardcoded `schema: "public"`:

```
src/app/(dashboard)/notifications/page.tsx    notifications
src/components/inbox/message-thread.tsx       message_reactions (×3)
src/hooks/use-presence.ts                     member_presence
src/hooks/use-realtime.ts                     messages, conversations
src/hooks/use-total-unread.ts                 conversations
src/hooks/use-unread-notifications.ts         notifications
```

The `db: { schema: 'crm' }` client option does **not** apply to Realtime
`postgres_changes` filters — those take their own explicit `schema`
argument. Every one of these would have silently received zero events in
production after the schema move: no error, no crash, just a permanently
stale inbox/notification UI. The earlier audit only checked client
*construction*, never the subscription filter arguments. All 9 fixed to
`schema: "crm"`.

The 5 distinct tables the app subscribes to (`notifications`,
`message_reactions`, `member_presence`, `messages`, `conversations`) are
all already correctly in the publication — so publication membership,
verified by catalog query, needed no change. (`crm.flow_runs` is also
published but not currently subscribed to by any app code; harmless,
left as-is.)

**Realtime live delivery — PASS.** Subscribed to `crm.conversations` and
`crm.messages`, inserted a row into each via the REST API, both
`postgres_changes` INSERT events received.

**Realtime RLS isolation — PASS, with a positive control.** First attempt
at this test produced a **false pass** worth recording: the Workspace-A
insert hit a 409 (the unique index from migration 036 — that contact
already had a conversation), so nothing was emitted at all, and
"Workspace B received nothing" proved nothing. Rewritten with both
controls, using an UPDATE instead of a conflicting INSERT:

- Workspace-A authenticated user (real signed HS256 JWT, `role:
  authenticated`) → **received** the Workspace-A `UPDATE` event.
- Workspace-B authenticated user, subscribed to the same table at the
  same time → **received nothing**.

That combination is what actually proves RLS-scoped Realtime: events flow,
and they flow only to the right workspace.

## TypeScript type generation (Step 11) — real types generated, adoption deliberately deferred

`npm run gen:types:crm` (against the local isolated stack, migrations
000-041 applied) produced real, tool-generated `crm` schema types
(`src/lib/supabase/types/crm.generated.ts`, 2231 lines) — not a
hand-written approximation, satisfying this phase's explicit rule against
that.

**Wiring them into the actual client-construction sites (`client.ts`,
`server.ts`, `admin.ts`) was attempted and reverted.** Doing so surfaces
**58 real, pre-existing type errors** across ~15 dashboard page
components — hand-written domain interfaces (`Contact`, `Broadcast`,
`Pipeline`, `Tag`, etc.) that don't precisely match real column
nullability (e.g. a hand-written `created_at: string` vs. the real
`string | null`). This is genuine latent debt confirmed by the migration
audit ("this codebase never had generated types before Phase 1") — not
something Phase 1's schema work introduced, but real work Phase 1's
correct completion has now honestly exposed for the first time. Given the
scope (~15 unrelated frontend files, no schema/migration involvement),
fixing all 58 is out of Phase 1's scope. `database.types.ts` merges the
real `public` + real `crm` types and is available for whoever picks up
that follow-up pass; the three client-construction sites stay on
`AnySupabaseClient` (an honest, reviewed choice — see each file's own
comment — not a schema-mismatch bypass) until that pass happens.

## Verification-level breakdown (updated)

| Claim | Verified by |
|---|---|
| Full migration chain applies from zero | **Isolated PostgreSQL execution** — 2 real failures found+fixed, clean 3rd run |
| Schema isolation (no wacrm object in `public`) | **Isolated PostgreSQL execution** (catalog queries) |
| Auth trigger creates expected CRM records | **Isolated PostgreSQL execution** (real signup) |
| PostgREST grants correct | **Isolated PostgreSQL + PostgREST execution** (real HTTP requests, 1 bug found+fixed) |
| RLS blocks cross-workspace reads/writes | **Isolated PostgreSQL execution** (real fixtures, real reject) |
| Comez order idempotency | **Isolated PostgreSQL execution** (real 6x upsert) |
| Identity-linking scenarios (7 of the original list; "many-match" shown structurally unreachable) | **Isolated PostgreSQL execution** |
| Realtime delivers events, RLS-scoped | **Realtime execution** — live delivery PASS; cross-workspace isolation PASS with positive control; 9 hardcoded `schema: "public"` subscriptions found+fixed |
| Real `crm` TypeScript types generated | **Isolated PostgreSQL + Supabase CLI execution** — real, not hand-written |
| Adopting real types app-wide | **Not done** — 58 pre-existing mismatches, out of scope, deferred |
| Application code (existing suite) | `npm run typecheck` (0 errors), `npm run build` (succeeds), `npm run test` (654/654) |
| Abandoned-cart idempotency | **Not tested** — that table belongs to the other repo's migration history, not part of the `001`–`042` chain actually applied here |

## Remaining risks before the deployment gate can go fully green

1. **No production migration application method is approved yet** — the
   shared-ledger hazard (`PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`) is
   production blocker 3 and is *unfinished architecture work*, not a
   signature. `supabase db push` is forbidden from this repo; nothing
   replaces it yet.
2. **A fresh production backup immediately before applying** — a
   production-side action, not doable from a test session.
3. The 58 mismatches are **pre-existing schema-contract debt exposed by
   generated types** — real latent bugs in the app today, independent of
   Phase 1. Tracked as `PHASE1_1_GENERATED_TYPES_ADOPTION.md`.
4. Abandoned-cart idempotency untested (different repo's migration set —
   that table isn't part of the `001`–`042` chain applied here).
5. This was tested locally. The real target (`ugjishankutgfegplrgq`) is a
   live project with real data (46 leads, 16 customers) that the local
   fixture only approximates — the deployment runbook's own post-apply
   smoke-test step is not optional, even after this local success.
6. The Realtime subscription bug (all 9 hardcoding `schema: "public"`) is
   a reminder that the schema move can break things that neither
   typecheck, nor the 654-test suite, nor a schema catalog query would
   ever catch — because a silently-empty event stream is not a type
   error, not an exception, and not a schema defect. Worth one focused
   post-deploy manual pass through the live UI (open the inbox, send a
   message from a second window, confirm it appears without a refresh)
   rather than assuming green tests mean a working app.
