// Both schemas are now REAL, tool-generated types (Phase 1 test report,
// Step 11 — verified against an isolated local Supabase instance, not
// hand-written approximations):
//   - `public`: types/public.generated.ts, generated via the Supabase
//     MCP against the live ugjishankutgfegplrgq project.
//   - `crm`: types/crm.generated.ts, generated via
//     `npx supabase gen types typescript --local --schema crm` against a
//     local Supabase stack with migrations 000-041 applied from zero.
//     Regenerate with `npm run gen:types:crm` (against the local stack)
//     whenever a new `crm` migration is added — see
//     docs/PHASE1_DEPLOYMENT_RUNBOOK.md for the equivalent against the
//     hosted project once `crm` is live there.
import type { Database as PublicDatabase } from './types/public.generated'
import type { Database as CrmDatabase } from './types/crm.generated'

export type Database = PublicDatabase & CrmDatabase

export type { Json } from './types/public.generated'
