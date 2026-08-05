# Phase 0 — Repository Audit

Fork of `ArnasDon/wacrm` → `lllamparithi/laddoos-crm`, cloned fresh
2026-07-31. Baseline verified before any implementation:

```
npm install    → 688 packages, clean (11 high-severity advisories, see Risks)
npm run typecheck → clean, 0 errors
npm run test   → 67/67 files, 654/654 tests passing
```

## 1. Current architecture

Next.js 16 (App Router) + React 19 + Supabase (`@supabase/ssr`,
`supabase-js`) + Tailwind 4 + shadcn/ui + recharts. Account-scoped
single-CRM data model (not multi-tenant) — `profiles` +
`account_member` + role (owner/admin/agent/viewer), one WhatsApp
number per account (`whatsapp_config`).

36 migrations (`supabase/migrations/001`–`036`). Core tables:
`contacts, tags, contact_tags, custom_fields, contact_notes,
conversations, messages, whatsapp_config, message_templates,
pipelines, pipeline_stages, deals, broadcasts, broadcast_recipients,
automations, flows, api_keys, webhook_endpoints, ai_reply,
ai_knowledge, notifications`.

## 2. Reusable wacrm modules (don't rebuild these)

- **Shared inbox + conversation/message model** — this IS the unified
  inbox the build brief asks for. WhatsApp today; Instagram/website-chat
  ingestion is new work, not a rebuild.
- **AI-reply + knowledge base** (`ai_reply`, `ai_knowledge` migrations,
  pgvector hybrid retrieval) — the hook point for Yali's brain. Don't
  build a second AI-reply mechanism; redirect/extend this one via
  webhook per the locked baseline.
- **Automations/flows engine** (`automations`, `flows` — visual
  builder, `@xyflow/react`) — available if useful for follow-up-task
  automation later; not required for MVP.
- **Public REST API** (`/api/v1`, scoped bearer keys) + **outbound
  webhooks** (`webhook_endpoints`) — lets the founder-dashboard pages
  read wacrm data without touching its Postgres tables directly if we
  want that separation; equally fine to query Supabase directly since
  it's the same project. Decide per-page, not globally.
- **Dashboard/analytics scaffolding already present** (recharts,
  a `dashboard` area implied by the README's "real-time dashboard"
  feature) — check `src/app` before adding new chart components.
- **Team accounts / roles** — reuse for founder vs. operator access
  instead of building new auth.

## 3. Conflicts with the proposed architecture — resolved

Two research docs were reviewed against this repo and the locked
baseline (`docs/crm-dashboard-build-handoff.md`) in the prior session.
Both conflicts below are now decided — see that doc's "Decisions
locked" section for full reasoning:

- **WeWeb as a second frontend** (from the Founder Ops handoff) — cut.
  Dashboard pages (`/hub`, `/morning`) live inside this app.
- **Full multi-tenant scaffolding** (`tenant_id` everywhere, tenant
  RLS test matrix) — cut. This install stays single-account, matching
  wacrm's own model.

## 4. Missing environment variables / integrations

None of `.env.local.example`'s required vars are set yet (fresh
`.env.local` copied, all placeholders) — needed before this app runs
against real data:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — **decision needed**: new Supabase
  project for this CRM, or the existing Laddoos Yali-brain Supabase
  project (`ugjishankutgfegplrgq`, per laddoos-website's CLAUDE.md)?
  Sharing one project simplifies the "unified identity" goal (one
  `contacts`/`customers` table reachable by both the brain and the
  CRM) but couples their migration histories. Not decided yet — flag
  to founder before Phase 1.
- `ENCRYPTION_KEY` — generate fresh, store in Hostinger env vars, not
  `.env.local`.
- `META_APP_SECRET` (+ `META_APP_ID`) — Laddoos already has a Meta
  Developer App (per laddoos-website's CLAUDE.md, Meta integration
  session in progress) — reuse those credentials once Meta gap #1 in
  that repo lands, don't create a second Meta app.
- Comez webhook signing secret — per this repo's
  `docs/crm-dashboard-build-handoff.md`, shown once at creation in
  Comez admin, goes wherever the new Edge Function's secrets live
  (Supabase project secrets), never in `.env.local` here.
- No Instagram/website-chat/voice/Comez ingestion exists in this repo
  yet — all net-new, per Phase 2 below.

## 5. Phased implementation plan (adapted from the Founder Ops handoff, WeWeb/multi-tenant phases removed)

1. **Data foundation** — decide shared-vs-separate Supabase project
   (open item above); add `raw_provider_events` (idempotent webhook
   landing table) if adopting that pattern; add Comez-specific tables
   (`orders`, `abandoned_carts`, `products`/inventory cache) as
   additive migrations.
2. **Channel normalization** — Comez Edge Function receiver (webhook →
   Supabase, <5s ack per Comez's requirement); website-chat and voice
   ingestion into wacrm's `conversations`/`messages` shape (or a
   parallel `channel` dimension if their shape doesn't fit); Instagram
   once Meta gap #1 lands in laddoos-website.
3. **Founder metrics + `/hub` + `/morning`** — SQL views per the
   handoff doc's metric definitions; `/hub` activity feed +
   priority queue; `/morning` KPI digest. This is the actual dashboard
   deliverable.
4. **wacrm operational enhancements** — only what's missing (call
   transcript drill-down, order deep-links, AI-quality flag display).
5. **Attribution + Meta ad spend** — lowest priority; no ad spend data
   exists yet to attribute against.
6. **Hardening** — monitoring, sync-status page, retry/replay UI for
   failed webhooks.

## 6. Risks and assumptions

- **11 high-severity `npm audit` findings**, all transitive (eslint's
  `minimatch` chain — dev-only; `sharp`/`libvips` CVEs — image
  processing, prod-relevant). `npm audit fix --force` would downgrade
  Next.js to 14.2.35, a breaking change — **not applied**, left as a
  known risk. Revisit once Next 16's sharp dependency ships a patched
  range upstream, don't force a downgrade to silence an audit.
- **Assumed**: Laddoos will run this as a genuinely single-account
  install (no second brand). If that changes, the "no multi-tenant
  scaffolding" decision needs revisiting — flagged, not blocking.
- **Assumed**: reusing wacrm's `conversations`/`messages` tables for
  website-chat and voice transcripts is viable by extending whatever
  `channel`/`provider` enum they use today (need to read the actual
  column definitions in migration 001 + 035 before Phase 2 — not yet
  done, this audit stopped at the schema *names*, not full DDL review).
- **Not yet decided**: shared vs. separate Supabase project (§4) —
  this is the single biggest open call before Phase 1 can start for
  real, since it determines whether "one customer, one identity" is
  free (same DB) or requires cross-project sync (two DBs).
