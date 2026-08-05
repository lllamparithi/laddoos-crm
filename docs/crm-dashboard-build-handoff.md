# Handoff — Founder's CRM + Dashboard Build (new session)

**Read this first in that session.** This doc captures everything decided in the
2026-07-30 brainstorm (Meta integration session). That session stays scoped to
Meta wiring + persistent memory only — this is a **separate build track**.

The user will paste additional research from GPT, Gemini, and prior JEM-project
learnings into that new session for review before implementation starts. Treat
this doc as the locked baseline those inputs get layered onto, not a finished spec.

---

## What this is

A single-tenant (Laddoos only, no multi-tenancy) founder's operations dashboard
+ unified inbox, combining:
- WhatsApp + Instagram conversations (via wacrm)
- Website chat (text + voice)
- Telephony (VoiceLink/LiveKit calls + transcripts)
- Orders, inventory, abandoned carts (via Comez)
- Website traffic (GA4 + Search Console)
- A 7AM founder digest — yesterday's numbers across all of the above

Mental model: BlackBerry Hub-style unification — one place the founder looks,
not necessarily one database everything lives in.

---

## Architecture decisions LOCKED this session

### 1. Base platform: fork `wacrm`, not build from scratch
- `github.com/ArnasDon/wacrm` — MIT license, self-hosted, uses official Meta
  Cloud API (not browser automation, no ban risk)
- Ships: shared inbox, contact hub, pipelines, broadcast campaigns, no-code
  flow builder, AI reply (BYO key), real-time analytics
- Plan: fork it, reskin to Laddoos branding, wire Yali brain via webhook
  (bypass their flow builder for AI logic — Yali is the intelligence layer,
  wacrm is the UI shell), keep their inbox for human escalation

### 2. Hosting: separate subdomain, not embedded in the public site
- e.g. `admin.laddoosdotcom.in` — keep the marketing site (`laddoosdotcom.in`)
  and the operations dashboard as separate deployments/auth boundaries
- Exact subdomain name — open, decide in the new session

### 3. Comez webhook receiver: owned separately, NOT inside wacrm
- Comez commerce events (`order.received`, `cart.abandoned`) are a different
  concern from WhatsApp/IG conversations — don't couple them to wacrm
- Build a small dedicated receiver (Next.js API route on the Laddoos site, or
  a Supabase Edge Function). Its only job: verify HMAC signature, write to
  Supabase, respond 200 fast (<5s, Comez requirement)
- wacrm, the voice agent, the website chat, and the dashboard all read
  **only from Supabase** — none of them call Comez directly during a live
  conversation (latency + coupling risk)

### 4. Supabase is the read cache for everything commerce-related
- **Orders + abandoned carts**: real-time via Comez webhooks (push) → Supabase
- **Products/inventory**: Comez has no "stock changed" webhook — periodic pull
  via n8n cron (10-15 min interval) into Supabase
- **Dispatch/delivery status**: Comez has no `order.shipped`/`order.delivered`
  webhook either — poll `getorderdetails` (by order IDs already known from the
  `order.received` webhook) until `delivery_status` reaches a terminal state
- Every channel (voice, chat, WhatsApp) reads product/stock/order data from
  Supabase only — never live from Comez. A 10-15 min staleness window on stock
  counts is an acceptable tradeoff for a D2C food brand; tighten the interval
  if it ever isn't, don't change the architecture

---

## Comez API reference (condensed — full PDFs in `Comez Docs` folder on desktop)

### Auth / headers (all requests)
| Header | Required | Notes |
|---|---|---|
| `storename` | Yes | store slug or custom domain |
| `x-custom-domain` | No | `true` if `storename` is a custom domain |
| `Authorization` | On protected routes | `Bearer <JWT>` |
| `adminauthtoken` | No | alt header for admin JWT |

### REST endpoints (read-only, no order/cart mutation via API)
- `GET /editor/ecommerce/getallproducts` — public, all products + variants + stock
- `GET /editor/ecommerce/inventory` — admin auth, granular on-hand/committed/available per variant
- `POST /editor/ecommerce/getorderdetails` `{id}` — admin auth, full order + shipping + tax + discount + `delivery_status` + `tracking_id` + `shiprocket_order_id`
- `POST /editor/ecommerce/getcustomerbyid` `{id}` — admin auth, customer + non-failed order history
- `POST /editor/ecommerce/searchcustomersdetail` `{search}` — admin auth, name search

**Known gap: no bulk "list all orders today" endpoint, no shipment-status-change webhook.** Design around this with the webhook-then-poll pattern above.

### Webhooks
- Configured in Comez admin; signing secret shown **once** at creation — store in `.env.local` / secret manager immediately, never in chat
- `POST` to your endpoint, `Content-Type: application/json`
- Headers: `X-Comez-Event` (`order.received` | `cart.abandoned`), `X-Comez-Signature: sha256=<hmac_hex>` (HMAC-SHA256 of **raw body**), `X-Comez-Delivery-Id` (use for idempotency)
- **Must respond 2xx within 5 seconds** — do heavy work after acknowledging
- Retries: 6 attempts, exponential backoff from 30s; auto-disables after 19 consecutive failures (re-enable manually in Comez admin after fixing)
- Verify with `crypto.timingSafeEqual` / `hmac.compare_digest` on raw bytes — never re-serialize JSON before checking

**`order.received` payload** — fires after order creation (COD) or payment verification (online). Contains `order_id`, `payment_status`, `payment_type`, `total`, `final_amount`, `customer{id,name,email,phone}` (id can be null for guests — use name/email/phone), `items[]`.

**`cart.abandoned` payload** — fires on inactive cart or failed checkout. Contains `customer_id` (null for guests), `cart_token`, `is_guest`, `reason`, `products[]`, `abandoned_at`. This directly satisfies the "abandoned cart feedback" requirement from the dashboard brainstorm.

---

## Dashboard scope (from 2026-07-30 brainstorm, organize into the build)

| Section | Metrics | Source |
|---|---|---|
| Website traffic | Daily visitors (new/returning), page views, traffic source split | GA4 API + Search Console API |
| Channel engagement | Website chat (text/voice), IG DMs, WhatsApp convos — daily | Supabase + wacrm DB |
| Telephony | Inbound/outbound calls, transcripts, outcome tags, avg duration | Supabase (voice agent already logs) |
| Leads | New leads/day by channel, lead→order conversion | Supabase `leads` table |
| Orders & fulfillment | Placed, dispatched, delivered, pending | Comez webhook + poll (see above) |
| Abandoned cart recovery | Detected, follow-up sent, recovered | Comez `cart.abandoned` webhook |
| Follow-up loops | Post-sale feedback, follow-ups done/pending, enquiry response time | Supabase + n8n |
| 7AM Founder Digest | Rollup of all the above, pushed via WhatsApp/Telegram/email | n8n cron, same pattern as AE's WF-EMAIL |

---

## Decisions locked — 2026-07-31 continuation session

Reviewed two research docs (`Laddoos_Dashboard_Design_Brief.md`, leaner/matches
this baseline; `LADDOOS_FOUNDER_OPS_CLAUDE_CODE_HANDOFF.md`, heavier/introduces
WeWeb + full multi-tenant scaffolding) against the actual wacrm repo (fetched
live via `gh api`, not assumed from its README).

**wacrm — verified facts:** Next.js 16 + React 19 + Supabase (`@supabase/ssr`),
Tailwind 4 + shadcn/ui + recharts (so the Design Brief's Tremor suggestion is
redundant — recharts is already there). 36 migrations; tables include
`contacts, conversations, messages, whatsapp_config, message_templates,
pipelines, deals, broadcasts, automations, flows, api_keys, webhook_endpoints,
ai_reply, ai_knowledge`. **Already ships an AI-reply layer + knowledge base**
(pgvector hybrid retrieval, BYO key) — this is the seam Yali's brain plugs into
via webhook, don't build a parallel mechanism. **Already has a scoped public
REST API** (`/api/v1`, bearer keys, scopes like `messages:send`/`contacts:read`)
**and outbound event webhooks** — the founder dashboard can read via this API
instead of touching wacrm's Postgres tables directly. Data model is
**account-scoped, not `tenant_id` multi-tenant** — one install = one CRM,
optionally team-shared (`account_member`, roles owner/admin/agent/viewer).
Recommended deploy is Hostinger Managed Node.js (low-friction, same account as
the voice-agent VPS), but it's plain Node/MIT — runs anywhere.

**Founder confirmed, both against the "Recommended" option:**
1. **Founder dashboard is one app, not two.** Build `/hub` (live activity +
   priority triage, per the Founder Ops doc's Section 25 BlackBerry-Hub
   concept) and `/morning` (KPI digest) as pages **inside the wacrm fork
   itself** — NOT a separate WeWeb app. Kills the WeWeb thread from the
   Founder Ops doc entirely: no second frontend, no cross-app data-contract
   doc, no second auth/RLS surface to test.
2. **No multi-tenant scaffolding now.** Skip `tenant_id` on every table, skip
   `tenants`/`tenant_memberships`/cross-tenant RLS tests from the Founder Ops
   doc. Matches wacrm's own account-scoped model AND the already-locked
   single-tenant decision above. Laddoos is the only tenant — revisit only if
   a second brand actually onboards (same pattern as JEM Motrek vs. Laddoos
   being separate Yali 2.0 deployments today, not rows in a shared table).

**Comez webhook receiver → Supabase Edge Function** (not a Next.js API route
on either app). Keeps it decoupled from both the wacrm fork's and the
marketing site's release cycles, matches the sub-5s-response requirement, and
was already the alternative this doc's own §3 left open.

**Subdomain → `admin.laddoosdotcom.in`**, the example already named in this
doc's §2 (Hosting). No competing name proposed; treat as locked unless the
founder overrides it later — cheap to change before DNS is actually wired.

## Open items for the new session

1. ~~Exact subdomain name~~ — **DONE**, `admin.laddoosdotcom.in`
2. Supabase schema design for `orders`, `abandoned_carts`, `products`/
   `inventory` cache tables (field mapping from Comez payloads above) — build
   as additive tables Supabase-side; do NOT touch wacrm's own migrations for
   these, they're commerce data wacrm has no concept of
3. ~~Comez webhook receiver location~~ — **DONE**, Supabase Edge Function
4. ~~Review GPT/Gemini/JEM research~~ — **DONE**, see Decisions above
5. wacrm fork setup — clone, strip unneeded features, reskin, deploy to
   `admin.laddoosdotcom.in`; add `/hub` + `/morning` per the Founder Ops doc's
   Section 25 (adapted — no WeWeb, no multi-tenant scaffolding)
