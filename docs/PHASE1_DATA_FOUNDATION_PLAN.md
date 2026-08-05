# Phase 1 — Core Data Foundation: Implementation Plan

Everything below was verified live this session (schema queries against
`ugjishankutgfegplrgq`, direct reads of wacrm's migrations and the Yali
brain's `customer.ts`/commerce code) — not assumed from the research docs.
See `docs/PHASE0_REPOSITORY_AUDIT.md` for the full 6-phase roadmap this
is Phase 1 of.

**Key fact that changes the plan for the better:** none of wacrm's table
names exist yet in `ugjishankutgfegplrgq` — migrations 001–036 have never
been applied to this project. They don't need to be "ported" around an
existing collision; they get **edited in place, once, before their first
apply**. No double-numbering, no migration-of-a-migration.

## 1. Schema isolation — put wacrm in a `crm` schema, not `public`

The brain's `public` schema already owns `messages`, `sessions`, `leads`,
`orders`, `customers` (real data, live writers — see below). wacrm's own
`public.messages`/`conversations`/etc. would collide by name with
incompatible shapes. Fix: every one of wacrm's 36 migrations gets
`SET search_path = crm, public, extensions;` prepended (with
`CREATE SCHEMA IF NOT EXISTS crm;` first, only in migration 001) — `extensions`
is required because `pgvector` (migration 030) lives in `public`, not
`crm`, on this project.

That session-level `SET` does **not** reach inside `SECURITY DEFINER`
functions (their own `SET search_path = public` is baked in at
`CREATE FUNCTION` time). 27 occurrences across 18 files need the same
`public` → `crm, public, extensions` swap:
`001, 003(×2), 005(×3), 007, 012, 017(×2), 018(×3), 019(×2), 022, 024,
025, 027, 028, 029, 030(×2), 032(×2), 034, 036`.

Checked the one project-wide-not-schema-scoped risk: migration 017
replaces a trigger on `auth.users` (`on_auth_user_created`). Live-queried
`pg_trigger` — zero non-internal triggers exist there today, safe to
apply. Note for whoever later builds Laddoos' own Supabase Auth signup
flow: don't reuse that trigger name, it's wacrm's now.

**Fork code changes, same PR as the migration rewrite (a half-applied
state — schema created but client still pointed at `public` — breaks the
whole app):**

| File | Change |
|---|---|
| `src/lib/supabase/client.ts`, `server.ts` | add `db: { schema: 'crm' }` |
| `src/lib/flows/admin-client.ts`, `src/lib/automations/admin-client.ts`, `src/lib/ai/admin-client.ts` | three byte-identical ad-hoc admin-client singletons — consolidate into one new `src/lib/supabase/admin.ts` |
| `src/app/api/whatsapp/webhook/route.ts:23-34` | a **fourth** inline copy of the same singleton — replace with an import from the new shared helper |

Unverified — check before calling this step done: whether
`src/lib/auth/api-context.ts` (`requireApiKey()`, backs `/api/v1`) is a
fifth ad-hoc client needing the same fix.

**Manual, one-time, not a migration:** Supabase dashboard → Settings →
API → Exposed schemas → add `crm`. Must happen atomically with deploying
the client-code change (PostgREST 404s `crm`-scoped requests otherwise).

## 2. New commerce tables (`public` schema, additive)

**`public.orders` already exists** (0 rows, matches Comez's `order.received`
shape closely: `comez_order_id, razorpay_order_id/payment_id, total,
currency, status (pending/paid/fulfilled/cancelled/refunded/failed),
line_items jsonb, shipping_address jsonb, metadata jsonb`, all the
Comez-specific columns nullable). One real gap found: **no unique
constraint on `comez_order_id`** — Comez retries webhooks up to 6×, so
Phase 2's Edge Function has nothing to `ON CONFLICT` against yet. New
migration:

```sql
-- 037_orders_comez_idempotency.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_comez_order_id
  ON public.orders (tenant_id, brand_id, comez_order_id)
  WHERE comez_order_id IS NOT NULL;
```

**`public.abandoned_carts`** — new, mirrors `orders`' shape/RLS
convention (`tenant_id`/`brand_id`-scoped even though Laddoos is the only
tenant, for consistency with the existing tables it sits next to):
`comez_cart_token` (unique per tenant/brand — the natural idempotency
key), `is_guest`, `reason`, `products jsonb`, `abandoned_at`,
`customer_id` nullable FK. Deliberately **no `recovered_order_id` column
yet** — that's Phase 3 dashboard-metric scope and its join shape isn't
designed; cheap `ALTER TABLE ADD COLUMN` later beats guessing now.

**`public.products`** — new, placeholder shape (`comez_product_id`,
`comez_variant_id` nullable, `name`, `sku`, `price`, stock columns, a
`raw jsonb` catch-all). The handoff doc names the Comez endpoints
(`getallproducts`, `inventory`) but has no sample JSON — column names
here are a reasonable placeholder pending one real response, flagged as
a Phase 2 verification step, not a Phase 1 blocker.

Full migration SQL for all three is in the Plan agent's original output
(this session's transcript) — write out `037`/`038`/`039` verbatim from
there when implementing, don't re-derive.

## 3. Identity linking — `crm.contacts` ↔ `public.customers`

**Verified, not assumed:** live-queried 5 `public.customers` rows — raw
`phone`/`email`/`full_name` columns are all `NULL` on every row; only
`phone_hash` is populated. Confirmed in `customer.ts`: `phone_hash =
sha256(normalisePhoneE164(rawPhone))`, and `normalisePhoneE164` is an
**India-specific heuristic** (10-digit `[6-9]xxxxxxxxx` → `+91…`, 12-digit
`91…` → `+…`, 11-digit `0[6-9]…` → strip leading 0 + `+91`, already-`+`
→ unchanged), not a generic digit-strip.

**Real mismatch caught:** `crm.contacts.phone_normalized` (wacrm's own
migration 022) is plain `regexp_replace(phone, '\D', '', 'g')` — no
country-code logic. A contact stored as `"9876543210"` and the brain's
hash of `"+919876543210"` are different strings pre-normalization — you
cannot join `contacts.phone_normalized` to `customers.phone_hash`
directly.

**Design:** port the exact `normalisePhoneE164` heuristic into a Postgres
function (`crm.normalise_phone_e164`), hash with `pgcrypto` (already
installed), add nullable `crm.contacts.customer_id → public.customers.id`,
populate it via a `BEFORE INSERT OR UPDATE OF phone` trigger — one place
covers every write path (webhook, public API, CSV import, manual UI),
no app-code changes in either repo. This keeps the DPDP boundary intact
on both sides: `customers` still never stores a raw phone, `contacts`
still stores the raw phone it needs to actually send WhatsApp messages.

## 4. Sequencing

```
037 orders idempotency  ⎫
038 abandoned_carts     ⎬  independent of the crm-schema rewrite,
039 products            ⎭  parallelizable, no ordering constraint

[001–036 edited in place: crm schema + search_path fixes +
 client.ts/server.ts/admin.ts consolidation, one PR]
        │
        ▼
040 crm.contacts.customer_id + link trigger   (hard-blocked: crm.contacts
                                                doesn't exist until 001–036
                                                land)
```

## 5. Open questions — flagged, not resolved here

1. **`public.customers` has no unique index on `(brand_id, phone_hash)`.**
   Confirmed via `pg_constraint` — zero duplicates today (16 clean rows),
   so not an active emergency, but the brain's own
   `upsertCustomerAfterTurn()` does lookup-then-insert with no DB
   backstop (the exact race class wacrm's own migration 022 fixed for
   `contacts`). Fixing it means a migration against a table owned by
   `Yali Build 2.0`'s migration history, not this repo's — a
   coordination call, not something to do unilaterally from here.
2. **wacrm↔Yali two-hop webhook shape** (wacrm's `dispatchWebhookEvent`
   confirmed fire-and-forget, one attempt, no synchronous reply channel
   → brain would need to call back via `POST /api/v1/messages`) — out of
   scope for Phase 1, belongs to Phase 2 "channel normalization."
3. **`orders.total` vs Comez's `final_amount`** — the handoff doc lists
   both without defining the delta (discount? tax?). Needs one real
   sample `order.received` payload before Phase 2 locks the mapping.
4. **`products`/`inventory` field names** — placeholder pending a real
   Comez API response.
5. **`requireApiKey()`/`api-context.ts`** — unread this session, confirm
   it's not a 5th ad-hoc Supabase client before calling §1's
   consolidation complete.
