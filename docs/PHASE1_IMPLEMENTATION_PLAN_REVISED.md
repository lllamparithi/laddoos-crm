# Phase 1 — Core Data Foundation: Revised Implementation Plan

## Session 2 addendum

A follow-up validation session added `040_phone_linkability_guard.sql`
(the chain is now `001`-`040`, not `001`-`039`), fixed two more ad-hoc
Supabase clients this doc's own consolidation had missed
(`src/app/api/whatsapp/config/route.ts`, `src/lib/dashboard/queries.ts`),
and produced `PHASE1_MIGRATION_MANIFEST.md` (full per-migration
inventory). The fresh-database full-chain test is **still** the one open
gap — see `PHASE1_TEST_REPORT.md` for two more attempts, both blocked
(Docker Desktop's engine won't boot in this sandbox; a Supabase branch
was offered and explicitly declined on cost). Gate stays **NO** in
`PHASE1_DEPLOYMENT_RUNBOOK.md`.

Supersedes the prior session's `PHASE1_DATA_FOUNDATION_PLAN.md` (kept for
history — two of its claims were corrected this session, see
`PHASE1_MIGRATION_AUDIT.md`'s "Corrections" section). This doc is the
top-level index; the detail lives in the docs it links to.

## Companion documents

- **`PHASE1_SCHEMA_OWNERSHIP.md`** — which repo owns `public` vs `crm`,
  how migrations are applied, why there's no CI/local-stack in either
  repo today.
- **`PHASE1_MIGRATION_AUDIT.md`** — the formal audit of all 36 original
  wacrm migrations (every `public.` reference, every `SECURITY DEFINER`
  function + its hardened search_path, Realtime publications, grants,
  the two corrected "gaps" from the prior session).
- **`PHASE1_TEST_REPORT.md`** — what was and wasn't verified, and why
  (honest — the one blocking gap is a full fresh-database apply test).
- **`PHASE1_DEPLOYMENT_RUNBOOK.md`** — the ordered steps for actually
  shipping this, gated on the test-report gap being closed first.

## What shipped this session

### Schema isolation
All 36 original wacrm migrations rewritten in place (never applied
anywhere before this — confirmed live) to create their tables/functions/
triggers/policies in a new `crm` Postgres schema instead of `public`,
inside the same `ugjishankutgfegplrgq` Supabase project the Yali brain
app already uses. `public` stays exactly as the brain app owns it —
untouched by any of these 36 rewrites.

### 3 new migrations (`037`-`039`, in `laddoos-crm/supabase/migrations/`)
- `037_workspace_brand_map.sql` — explicit crm-workspace → tenant/brand
  scope mapping (one active mapping per workspace).
- `038_phone_normalization.sql` — `normalise_phone_e164()`, an exact,
  tested SQL port of the brain's `normalisePhoneE164()`/`hashPhone()`
  (`Yali Build 2.0/src/brain/memory/customer.ts:51-64`), plus the new
  `crm.contacts` columns (`customer_id`, `customer_link_source`,
  `customer_linked_at`, `customer_link_confidence`).
- `039_identity_linking.sql` — `identity_link_conflicts` table,
  `resolve_customer_candidates()`/`link_contact_to_customer()` (0/1/many
  matching, manual-link protection), a trigger for immediate best-effort
  linking, and `reconcile_contact_customer_links()` for backfill +
  late-arriving-customer reconciliation (callable repeatedly, not a
  tightly-coupled reverse trigger on `public.customers`).

### 2 proposed migrations for the OTHER repo (`supabase/public-schema-proposals/`)
`abandoned_carts` and `comez_products_raw` (a raw staging table, not a
guessed normalized products model — the Comez adapter is confirmed
unimplemented in the brain repo, so no real payload exists to design
against yet). Committed here as ready-to-apply SQL per this phase's rule
4, but belong in `Yali Build 2.0`'s own migration history per the
ownership split — see the deployment runbook §7.

### Application code
- `src/lib/supabase/admin.ts` — new shared service-role client
  (`supabaseAdmin()`, crm-scoped; `supabasePublicAdmin()`, public-scoped,
  fully typed against the real generated `public` schema), replacing 4
  duplicated ad-hoc singletons (`src/lib/flows/admin-client.ts`,
  `src/lib/automations/admin-client.ts`, `src/lib/ai/admin-client.ts`,
  and an inline one in `src/app/api/whatsapp/webhook/route.ts` — the
  first three now just re-export the shared one, imports elsewhere
  didn't need to change).
- `src/lib/supabase/client.ts`, `server.ts`, `src/middleware.ts` — all
  three Supabase client-construction sites now pass
  `{ db: { schema: 'crm' } }`.
- `src/lib/supabase/database.types.ts` — real generated `public` types
  (`types/public.generated.ts`, via the Supabase MCP
  `generate_typescript_types`) wired in; `crm` deliberately left untyped
  for now (see that file's header — a placeholder typed schema was tried
  and hit real postgrest-js type-inference edge cases with no genuinely
  generated row shapes; reverted in favor of the same untyped convention
  this whole codebase already used everywhere pre-Phase-1).
- `src/lib/supabase/any-client.ts` — new `AnySupabaseClient` type alias,
  applied across ~23 files that previously declared function parameters
  as the bare `SupabaseClient` (which silently means schema `'public'`) —
  these functions are genuinely schema-agnostic internally (they just
  call `.from()`/`.rpc()` on whatever client they're given), so this is
  the honest fix, not a bypass of a real mismatch.
- `package.json` — added `gen:types:public`/`gen:types:crm` scripts.
- `supabase/config.toml` — new (didn't exist before), exposes `crm`
  through the local Supabase CLI's PostgREST config — unvalidated against
  a real `supabase start` (no CLI installed in this session's
  environment), flagged in the file itself.

**Verified clean**: `npm run typecheck`, `npm run build`, `npm run test`
(654/654) all pass with these changes.

## Unresolved decisions (need a person, not an engineering call)

1. **`public.customers` has no unique index gap** — false alarm, corrected
   this session. It already exists (`customers_brand_phone_hash_unique`).
   No decision needed after all.
2. **wacrm↔Yali two-hop webhook shape** (wacrm's `dispatchWebhookEvent` is
   fire-and-forget; the brain would call back via `POST /api/v1/messages`)
   — still open, still explicitly out of scope for Phase 1 (belongs to
   "channel normalization", the next phase).
3. **Where does `crm.workspace_brand_map`'s Laddoos row get seeded?** —
   answered operationally in the deployment runbook §6 (manual, post
   first-signup), but nobody's actually signed up yet, so this is
   unexecuted, not just undecided.

## Assumptions verified against code (not taken on faith)

- wacrm's 36 migrations were never applied to `ugjishankutgfegplrgq` —
  confirmed via live schema query before editing anything.
- `public.orders`/`public.customers`' actual uniqueness constraints —
  confirmed via `pg_indexes` (not `pg_constraint`, which missed them) and
  by reading `Yali Build 2.0`'s own migration source directly.
- `vector` extension lives in `public`, not `extensions`, on this
  project — confirmed via `list_extensions`, contradicting migration
  `030`'s own comment.
- `authenticated`/`anon`/`PUBLIC` all have `CREATE` revoked on both
  `public` and `extensions` on this project — confirmed via
  `has_schema_privilege`, before deciding the hardened search_path
  ordering was safe.
- The phone-normalization SQL port matches the JS source byte-for-byte on
  11 cases including edge cases (blank, already-E.164 with spaces
  preserved, non-Indian numbers) — see `PHASE1_TEST_REPORT.md`.

## Assumptions still awaiting external payloads or a full test (not resolved here)

- `comez_products_raw`'s column shape (placeholder pending a real Comez
  `getallproducts`/`inventory` response).
- `orders.total` vs Comez's `final_amount` semantics (same — needs a real
  `order.received` sample).
- The full 39-migration chain has not been applied end-to-end on any
  database — see `PHASE1_TEST_REPORT.md`, this is the actual blocker
  before production.

## Migration application order

```
037, 038, 039 — parallelizable with each other and with the 001-036
                 rewrite (different objects, no dependency either way)
001-036 (rewritten) — must land together as one unit (schema creation +
                 every table/function/policy in it)
039 (identity_linking) is the only HARD dependency: it ALTERs crm.contacts,
                 which doesn't exist until 001-036 have applied
```

Full detail (why, plus the client-code deploy-ordering constraint) in
`PHASE1_DEPLOYMENT_RUNBOOK.md`.

## Rollback

Schema-isolated by design. See `PHASE1_DEPLOYMENT_RUNBOOK.md` §12 —
short version: `DROP SCHEMA crm CASCADE` plus one explicit
`DROP TRIGGER ... ON auth.users` undoes everything Phase 1 touches in the
shared project, without affecting a single `public` table.
