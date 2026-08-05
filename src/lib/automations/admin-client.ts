// Re-exports the shared service-role client (Phase 1 consolidation — see
// docs/PHASE1_SCHEMA_OWNERSHIP.md). Kept as its own file so existing
// `from '@/lib/automations/admin-client'` imports don't need updating.
export { supabaseAdmin } from '@/lib/supabase/admin'
