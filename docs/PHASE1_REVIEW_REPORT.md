# Phase 1 — Review Report

**For:** reviewing agent / engineer picking this up cold
**Branch:** `phase1/fresh-migration-validation` (off
`feat/founder-operations-dashboard`, off `main`)

```text
Implementation status:        complete in working tree
Isolated verification status: passed against final 42-migration chain
Commit/PR status:             not committed, not pushed, no PR
Production readiness:         BLOCKED
```

No production migration has been applied. Production was used read-only
(catalog inspection and one migration-ledger `SELECT`).

## Production blockers

Eight items. **Item 3 is engineering/architecture work, not a signature**
— an earlier draft of this report wrongly described the whole list as
"human-only". That was inaccurate and is corrected here.

> **Update 2026-08-01 — item 3 is now RESOLVED.** A1 is approved: apply
> via Supabase MCP `apply_migration` only, `supabase db push` forbidden
> (`PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`). Items 1, 2, 4, 5, 6, 7
> and 8 remain open. **Item 4 (backup) is the next blocker.** The
> "see below" analysis of item 3 is retained as the reasoning that led to
> the decision.

1. Phase 1 changes committed
2. Independent PR review completed
3. ~~**Shared migration-ledger application method approved**~~ — ✅
   **RESOLVED 2026-08-01: MCP `apply_migration` only**
4. Real production backup created and reference recorded ← **NEXT BLOCKER**
5. Restore procedure verified
6. `crm` added to hosted PostgREST exposed schemas
7. Deployment and rollback window approved
8. Immediately before deployment, re-confirm that no wacrm-owned objects
   or conflicting CRM migration records have appeared in production

### On blocker 3 — this is not a formality

`laddoos-crm` and the YALI brain repo share one Supabase project and
therefore one `supabase_migrations.schema_migrations` ledger. The brain
repo's four recorded migrations use 14-digit timestamp versions; this
repo's files would resolve to versions `001`–`042`. That is not a literal
key collision, but two repositories cannot safely run independent
migration histories against a single ledger — see
`PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md` for the full analysis.

**A concrete, reviewed application method must be selected before any
production apply.** Options that would each maintain one coherent ledger:

- Move the CRM migrations into the canonical YALI/shared migration
  repository.
- Renumber all still-unapplied CRM migrations with globally unique
  timestamps.
- Produce a reviewed production migration bundle applied by the canonical
  migration owner.
- Any other documented method that keeps the ledger coherent.

**No option is selected in this working tree.** The ledger document
records a *recommendation* (MCP-only applies, `supabase db push`
forbidden from this repo), not an approved decision. Selecting one is a
reviewer/owner decision.

Two non-blocking gaps are documented rather than hidden: abandoned-cart
idempotency is untested (that table belongs to the brain repo's chain,
not this one), and the app is verified against `AnySupabaseClient` rather
than the real generated types (58 mismatches — **pre-existing
schema-contract debt exposed by generated types**, tracked as Phase 1.1).

**Recommendation:** `NOT SAFE TO APPLY TO PRODUCTION`

Full verification evidence: `docs/PHASE1_TEST_REPORT.md`.

---

## 1. What this change is

The Laddoos founder CRM is a fork of [wacrm](https://github.com/ArnasDon/wacrm)
(Next.js 16 + Supabase WhatsApp CRM). It must share **one** Supabase
project (`ugjishankutgfegplrgq`) with an existing, already-live "Yali
brain" app that owns the `public` schema — so the two can share customer
identity without cross-project sync.

Problem: wacrm's 36 migrations create tables in `public` whose names
collide with the brain's existing tables (`messages`, `sessions`,
`leads`, `orders`, `customers`) with **incompatible shapes**. wacrm's
`messages` is WhatsApp-shaped (`external_message_id`, `direction`,
`delivery_status`); the brain's is a generic chat log (`session_id`,
`role`, `content`). `CREATE TABLE IF NOT EXISTS` would have silently
no-opped and left the app pointed at the wrong table.

Solution: move all wacrm objects into a dedicated `crm` Postgres schema
in the same database. Then add the commerce and identity-linking layer on
top.

**Critical precondition, verified before any edit:** wacrm's migrations
had **never been applied** to this project (confirmed by live catalog
query — none of its table names existed in `public`). So they were edited
**in place** before their first-ever apply, not migrated around a live
collision. Reviewers should re-verify this is still true before applying
(runbook §2).

---

## 2. Change inventory

Regenerated from `git status --short` / `git diff --stat` at the time of
writing — **not carried over from an earlier draft** (an earlier version
of this section claimed 77/407/277, which is now stale):

```text
Modified files:   78
New (untracked):  26 entries
Deleted files:    0
git diff --stat:  78 files changed, 508 insertions(+), 277 deletions(-)
```

`git diff --stat` covers tracked modifications only; the 26 untracked
entries (new migrations, docs, generated types, fixtures, proposals) are
not counted in those insertion figures.

### Executable migrations — the substance of the change

```text
001–036: 36 rewritten wacrm migrations (moved public → crm)
037–042:  6 new Phase 1 migrations
Total executable migrations: 42
Final migration: 042_realtime_replica_identity.sql
```

| Group | Count | Lines | What |
|---|---|---|---|
| `001`–`036` (rewritten in place) | 36 | — | wacrm's own migrations, moved from `public` → `crm` |
| `037`–`042` (new) | 6 | 686 | workspace mapping · phone normalization · identity linking · linkability guard · schema grants · Realtime replica identity |
| `supabase/test-fixtures/` (**not** a migration) | 1 | 215 | stand-in for the brain's `public` tables + structural contract test; staged into `migrations/` only during a local run, gitignored there |
| `supabase/public-schema-proposals/` (**not** applied from here) | 2 | 98 | `abandoned_carts`, `comez_products_raw` — belong to the *other* repo's migration history |

The `001`–`036` rewrite is mechanical and repetitive (a file-level
`SET search_path`, `public.`→`crm.` qualification, hardened per-function
search paths). **The 6 new migrations are where the real design is** —
review those closely, skim the 36.

### New non-migration files (the 26 untracked entries)

| Category | Count | Files |
|---|---|---|
| New migrations | 6 | `037`–`042` |
| Phase 1 documentation | 11 | incl. `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md` and `PHASE1_1_GENERATED_TYPES_ADOPTION.md` (both added in round 2) |
| Generated types | 2 | `src/lib/supabase/types/{crm,public}.generated.ts` |
| New source files | 3 | `admin.ts`, `any-client.ts`, `database.types.ts` |
| Fixtures / proposals | 2 dirs | `test-fixtures/` (1 file), `public-schema-proposals/` (2 files) |
| Config | 1 | `supabase/config.toml` |
| Test logs | 1 dir | `docs/phase1-test-logs/db-reset-clean-run.log` |

### Application code

| Change | Files | Why |
|---|---|---|
| Realtime subscriptions `schema: "public"` → `"crm"` | 6 | **Bug fix** — see §3.3 |
| Supabase client consolidation | 6 | 6 duplicated ad-hoc service-role singletons → one `src/lib/supabase/admin.ts` |
| `SupabaseClient` → `AnySupabaseClient` type alias | ~24 | Bare `SupabaseClient` implicitly means schema `'public'`; these helpers are genuinely schema-agnostic |
| Generated types | 3 new | Real `public` + real `crm` types (see §4 for why they're not yet adopted) |
| Config | 3 | `supabase/config.toml` (new), `package.json` type-gen scripts, `.gitignore` |

### Documentation (8 files)

`PHASE1_IMPLEMENTATION_PLAN_REVISED.md` (index) ·
`PHASE1_SCHEMA_OWNERSHIP.md` · `PHASE1_MIGRATION_AUDIT.md` ·
`PHASE1_MIGRATION_MANIFEST.md` · `PHASE1_TEST_REPORT.md` ·
`PHASE1_DEPLOYMENT_RUNBOOK.md` · `PHASE0_REPOSITORY_AUDIT.md` ·
`docs/phase1-test-logs/db-reset-clean-run.log`

---

## 3. The five real bugs found — and what each says about the review surface

All five were found by **executing** things, and **none** would have been
caught by typecheck, the 654-test suite, or schema catalog inspection.
This is the most important section for a reviewer. §3.1–3.3 were found in
round 1; §3.4–3.5 were found in round 2, in work round 1 itself produced.

### 3.1 Migration `038` failed on a genuinely blank database

```
Applying migration 038_phone_normalization.sql...
ERROR: relation "public.customers" does not exist (SQLSTATE 42P01)
```

Not a migration defect — `038`/`039` intentionally FK to the brain's
`public.customers`. The *test* was unrealistic: a bare Postgres isn't the
real target. Fixed with a test-only fixture reproducing the brain's
tables from their real DDL, so the isolated test represents the actual
deployment environment.

**Review question:** is `supabase/test-fixtures/000_public_schema_fixture.sql`
an accurate enough stand-in? It was transcribed from the brain repo's
real migrations, but only the load-bearing columns/indexes.

### 3.2 The `041` grants story — full sequence, three states

This migration went through three distinct states. The final one is what
is in the working tree; the two earlier ones are recorded because each
was a real defect and the sequence is the point.

**State 1 — `001`–`040` created `crm` but never granted schema `USAGE`.**
Every PostgREST request against `crm.*` failed, including service-role:

```
{"code":"42501","message":"permission denied for schema crm"}
```

`public` gets `USAGE` granted to `anon`/`authenticated`/`service_role` by
default in every Supabase project; a newly-created schema does not.
Nothing in `001`–`040` granted it. Found by a real HTTP request, not by
review.

**State 2 — the first `041` restored access, but too broadly.** It
granted `SELECT ON ALL TABLES IN SCHEMA crm TO anon`, a matching
`ALTER DEFAULT PRIVILEGES` for future tables, and — most seriously —
`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO authenticated`.

**State 3 (current) — round 2 narrowed it, and found the real bug.**

The blanket function grant ran *after* migrations `007`, `012` and `039`
had each explicitly done `REVOKE ALL ... FROM authenticated` on specific
functions — so it **silently re-enabled every one of them**. `007`'s own
comment states the intent it was defeating:

> *"Explicitly lock anon / authenticated out so an authenticated user
> can't juice someone else's counter via RPC."*

A blanket grant at the end of a chain overrides every per-function
decision made earlier in that chain. That is a privilege-escalation
regression introduced by the round-1 fix, not a pre-existing wacrm issue.

The final `041` therefore:

- grants `anon` only `USAGE ON SCHEMA crm` plus `EXECUTE` on
  `crm.peek_invitation(TEXT)` — the single pre-auth entry point. It is
  `SECURITY DEFINER`, so it reads its tables as the function owner and
  anonymous callers need **no table privileges at all**;
- **removes** the broad `anon` table grant and the `anon` default
  future-table privilege;
- **removes** the blanket function grant *and* the default
  `EXECUTE ON FUNCTIONS` privilege (which would have re-created the same
  bug for every future function);
- replaces them with an **explicit per-function grant matrix**, and
  closes the Postgres `PUBLIC`-by-default hole on nine `SECURITY DEFINER`
  functions that had no explicit `REVOKE` (including
  `resolve_customer_candidates`, which reads `public.customers` and was
  therefore a customer-enumeration oracle).

Anonymous invitation flow and all anonymous denial controls pass — see
`PHASE1_TEST_REPORT.md` for the 1 positive + 5 negative controls,
including one that specifically proves `authenticated` can no longer
execute `increment_automation_execution_count`.

> **Reviewer instruction:** independently verify the final explicit
> role/function privilege matrix in migration `041`. Do not take the
> test-report table on trust — re-derive it with
> `has_function_privilege()` against a locally migrated database.

### 3.3 All 9 Realtime subscriptions were silently broken

Every `postgres_changes` subscription hardcoded `schema: "public"`:

```
src/app/(dashboard)/notifications/page.tsx    notifications
src/components/inbox/message-thread.tsx       message_reactions (×3)
src/hooks/use-presence.ts                     member_presence
src/hooks/use-realtime.ts                     messages, conversations
src/hooks/use-total-unread.ts                 conversations
src/hooks/use-unread-notifications.ts         notifications
```

`db: { schema: 'crm' }` on the client does **not** apply to Realtime
filters — those take their own `schema` argument. In production this
would have been a permanently stale inbox and notification panel with
**no error, no exception, no failing test**. The earlier client audit
missed it because it only checked client *construction*, never
subscription filter arguments.

**Resolved:** a follow-up sweep looked for *any* API taking a schema or
relation name separately from the client default — `schema:` literals,
`supabase.schema(`, all 13 `.rpc()` call sites, `.storage`, raw
PostgREST fetches (`Accept-Profile`/`Content-Profile`/`/rest/v1`), and
tests asserting `public`. **No additional site was found.** RPC inherits
the client's schema; Storage is a separate service unaffected by
`db.schema` (its policies reference `crm.profiles`, updated in the
migrations); the two anon-reachable invitation routes use the
`crm`-scoped `createClient()` from `server.ts`, which is correct because
`peek_invitation` lives in `crm`.

### 3.4 Migration `041` re-opened deliberately locked-down functions

Covered in full in §3.2 (State 2 → 3). Called out separately here because
it is the most serious of the five: a **privilege-escalation regression
introduced by round 1's own fix**, invisible to every automated check in
the repo, and only found by auditing `has_function_privilege()` output
role by role.

### 3.5 The fixture contract test contained a bug in itself

The structural contract test added to
`000_public_schema_fixture.sql` used `missing := missing || 'text'`.
In PL/pgSQL `text[] || text` resolves ambiguously — Postgres tried to
parse the string as an array literal. A genuine contract violation would
therefore have reported `malformed array literal` instead of the actual
missing element.

Found **only** by writing a negative control for the test (dropping the
unique index inside a rolled-back transaction to confirm it actually
fails). Fixed with `array_append`, then re-verified in both directions:
the intended `FIXTURE CONTRACT VIOLATION — missing: ...` exception when
an element is absent, and the `Fixture contract OK` notice when present
(visible in the current clean-run log).

The lesson generalises: **a test that has never been observed failing is
not known to work.**

### 3.6 Migration `042` — Realtime `REPLICA IDENTITY FULL`

Not a bug found, but the fix that §3.3 made necessary to reason about:
once the subscriptions pointed at `crm`, their **DELETE** paths had to be
checked too.

Postgres sends only the columns in a table's REPLICA IDENTITY in the OLD
image of an UPDATE/DELETE (default: the primary key). Supabase Realtime
uses that OLD image both for the `old` payload *and* for evaluating a
server-side subscription `filter:` on DELETE. If a subscription filters
on a column absent from the replica identity, **the event is dropped
entirely** — silently.

Three tables need `FULL`:

| Table | Why |
|---|---|
| `crm.message_reactions` | subscription filters `conversation_id`; PK is `id`, so DELETE events would be filtered out — reactions would appear on add and never disappear on remove |
| `crm.member_presence` | filters `account_id`; PK is `user_id` — a teammate going offline would never clear from the presence list |
| `crm.notifications` | `use-unread-notifications` reads `old.read_at` on DELETE (a non-PK column) to decide whether to decrement the badge |

**Not applied to `crm.conversations` or `crm.messages`** — they subscribe
unfiltered and read only `old.id` (the PK, present by default). Not
applied to `crm.flow_runs` (published, no app subscription) or
`crm.contacts`/`crm.broadcast_recipients` (not published at all).

**Why not globally:** `REPLICA IDENTITY FULL` writes every column of
every UPDATE/DELETE into the WAL. On high-churn tables that is a real and
permanent cost in WAL volume, replication bandwidth and disk. It belongs
only where a subscription actually depends on it, and each of the three
carries its reason inline in the migration.

**Verified**, not reasoned about: reaction INSERT/UPDATE/DELETE,
notification UPDATE/DELETE, presence INSERT/DELETE, message INSERT and
conversation UPDATE — 10/10 event families, plus cross-workspace
isolation. An earlier run of that test failed 4 of 9 with a distinctive
signature (only the *last* event per table arriving, out of order); that
was a subscription warm-up race in the harness, proven by the fact that
spacing the calls made every case pass with **no product change**. It is
recorded rather than quietly re-run, because "add a sleep until it
passes" is how a real intermittent bug gets buried.

---

## 4. Decisions taken (previously listed as open questions)

These were open in earlier drafts. They are decided; they are recorded
here so a reviewer can disagree deliberately rather than rediscover them.

### 4.1 Generated types — Phase 1 proceeds without wiring them in

`npm run gen:types:crm` produced real `crm` types
(`src/lib/supabase/types/crm.generated.ts`) from the migrated local DB,
satisfying the "no hand-written approximations" requirement. Both
generated files are **present in the working tree and ready to be
included in the Phase 1 commit** — nothing is committed yet.

Wiring them into `client.ts`/`server.ts`/`admin.ts` was attempted and
reverted: it surfaces **58 errors** across ~15 dashboard components.

**These are pre-existing schema-contract debt exposed by generated
types** — not frontend type hygiene. Each is a place where the code
asserts something the database does not guarantee: a `created_at: string`
that is really nullable is a runtime crash the first time a null appears;
a `Json` column claimed as a structured array crashes on `.map()`; a
narrowed status union makes exhaustive switches believe they cover cases
the DB can still produce.

**Decision:** Phase 1 may proceed. The work is tracked in
`docs/PHASE1_1_GENERATED_TYPES_ADOPTION.md` with mismatch classes,
affected domains, sequencing and a definition of done. No `any` casts
were introduced to suppress them.

### 4.2 Anonymous grants — narrowed, not open for re-litigation

Already narrowed (§3.2 State 3): `anon` receives `USAGE ON SCHEMA crm`
and `EXECUTE` on `crm.peek_invitation(TEXT)`, nothing else. Broad table
grants and default future-object grants are removed.

> **Reviewer decision:** confirm that migration `041`'s final explicit
> privilege matrix is minimal and correct.

### 4.3 Identity conflicts — keep the fail-closed branch

**Decision:** keep `crm.identity_link_conflicts` and the many-match
branch in `link_contact_to_customer()`.

It is currently unreachable: `public.customers` carries a unique index on
`(brand_id, phone_hash)` (verified live), so more than one match cannot
occur. It is retained as a **fail-closed safeguard** because that
constraint belongs to another repository and can change independently of
this one. There is deliberately no `ORDER BY ... LIMIT 1` fallback —
attaching a contact to an arbitrary "first" customer is worse than
leaving it unlinked. The rationale is also recorded in migration `040`
itself, next to the code.

This is **not** unresolved architecture.

### 4.4 Public-schema proposals — ownership decided, coordination open

**Decision:** `abandoned_carts` and `comez_products_raw` belong to the
YALI brain / `public`-schema migration owner and **must not be applied
from `laddoos-crm`**. Both files carry a `PROPOSAL ONLY / DO NOT APPLY`
header and live outside `supabase/migrations/`, so no CLI command can
execute them from here.

The remaining question is coordination, not architecture:

> **Who owns the coordination issue, and when will the proposals be
> ported into the YALI brain migration history?**

### 4.5 Not tested: abandoned-cart idempotency

Follows from 4.4 — that table is not part of the `001`–`042` chain
applied here, so its idempotency cannot be exercised from this repo.

---

## 5. Verification evidence

Environment: local Supabase stack (Docker 29.2.1, Supabase CLI 2.111.0),
ports shifted to 55321–55323 to avoid an unrelated pre-existing local
Supabase project on the same machine. Full clean-run log:
`docs/phase1-test-logs/db-reset-clean-run.log`.

| Check | Method | Result |
|---|---|---|
| Full chain from zero | `supabase db reset` — 42 migrations (+ the `000` fixture = 43 applied files) | **PASS** — 0 errors |
| Function privilege matrix | `has_function_privilege()` across 13 sensitive functions × 3 roles | **PASS** — matches intent exactly |
| Anonymous surface | 1 positive + 5 negative controls | **PASS** — `peek_invitation` only |
| Invitation flow | anon peek → authenticated redeem → membership check | **PASS** — user joined with correct role |
| Realtime UPDATE/DELETE (`042`) | 10 event families incl. 3 `REPLICA IDENTITY FULL` DELETE paths | **PASS** — 10/10 |
| No wacrm object in `public` | `information_schema` query | **PASS** — `public` has only the 4 fixture tables |
| `crm` contents | catalog query | 38 tables, 0 sequences, 0 views, 0 matviews |
| Auth trigger | real `auth.users` INSERT | **PASS** — `crm.profiles` + `crm.accounts` created atomically |
| Trigger namespacing | `pg_trigger` | **PASS** — only `on_auth_user_created_wacrm`, generic name not claimed |
| PostgREST | real HTTP, anon + service-role | **PASS** after `041` |
| RLS read isolation | 2 real workspaces, real JWT claims | **PASS** — each user sees only their own |
| RLS write isolation | cross-workspace INSERT attempt | **PASS** — rejected by policy |
| Realtime delivery | real WebSocket subscribe + insert | **PASS** — events received on `conversations` + `messages` |
| Realtime RLS | positive + negative control | **PASS** — A receives, B does not |
| Comez order idempotency | 6× duplicate upsert | **PASS** — exactly 1 row |
| Identity linking | 7 live scenarios | **PASS** (see test report) |
| Phone normalization parity | 11 fixtures vs. JS source | **PASS** |
| Phone linkability guard | 12 fixtures | **PASS** |
| App suite | `typecheck` / `build` / `test` | **PASS** — 0 errors, 654/654 |

### One methodological note worth reviewing

The first Realtime RLS test produced a **false pass**: the insert hit a
409 unique-constraint conflict, so nothing was emitted, and "Workspace B
received nothing" proved nothing. It was rewritten with a positive
control (Workspace A *must* receive the event) so the test can
distinguish "RLS blocked it" from "nothing happened." Reviewers should
apply the same skepticism to any other negative-result test in this work.

---

## 6. Suggested review order

1. **`docs/PHASE1_SCHEMA_OWNERSHIP.md`** — the ownership split. If you
   disagree with this, everything downstream changes.
2. **`docs/PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`** — production
   blocker 3. No apply method is approved yet.
3. **Migrations `037`–`042`** (686 lines) — the actual new design.
4. **Migration `041`'s final privilege matrix** — re-derive it yourself
   with `has_function_privilege()`; don't trust the table.
5. **Migration `042`'s Realtime rationale** — including why it is *not*
   applied globally.
6. **`src/lib/supabase/admin.ts` + `any-client.ts`** — the client
   consolidation and the typing compromise.
7. **`docs/PHASE1_TEST_REPORT.md`** — full verification detail.
8. **Test fixture provenance + contract test**
   (`supabase/test-fixtures/000_public_schema_fixture.sql`).
9. **Migrations `001`–`036`** — skim. Mechanical, repetitive; spot-check
   2–3 `SECURITY DEFINER` functions for correct `search_path`.

## 7. Remaining questions for a human

Decisions already taken are in §4 and are not re-litigated here. What
genuinely still needs a person:

1. **Which migration-ledger application method?** (production blocker 3 —
   nothing is selected; see §"On blocker 3")
2. **Who owns porting the two `public`-schema proposals into the YALI
   brain migration history, and when?** (§4.4)
3. Should the Phase 1.1 generated-types work be scheduled before or after
   Phase 2, given it is real schema-contract debt rather than cosmetic?

## 8. Explicitly not done

- Nothing committed, pushed, PR'd, or deployed.
- No migration applied to `ugjishankutgfegplrgq`. Production was used
  **read-only** (catalog inspection) plus two `pg_temp`-scoped,
  self-cleaning pure-function tests — no persistent DDL, verified.
- No paid Supabase branch created (cost disclosed, declined by the user;
  the local stack made it unnecessary).

---

## 9. Commit readiness

```text
READY TO COMMIT AND OPEN FOR INDEPENDENT PR REVIEW
```

```text
NOT SAFE TO APPLY TO PRODUCTION
```

The two are independent. The working tree is internally consistent, its
counts derive from live `git` output, and every claim in it maps to a
retained log or a re-runnable command. Production remains blocked on the
eight items at the top of this document — most importantly blocker 3,
which is unfinished engineering work, not a signature.
