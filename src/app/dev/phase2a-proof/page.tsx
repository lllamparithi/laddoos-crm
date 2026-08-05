// ============================================================
// /dev/phase2a-proof — a production-404 diagnostic route.
//
// NOT "a page that never ships" — that earlier claim overstated things.
// What a production build actually does with this file, verified by
// inspecting .next/ after a clean `npm run build`, not assumed:
//
//   - The route IS in the production route manifest. Both
//     .next/routes-manifest.json and .next/server/app-paths-manifest.json
//     list /dev/phase2a-proof, and it appears in `next build`'s own route
//     table. It does not disappear from the build.
//   - It prerenders to a STATIC 404. .next/server/app/dev/
//     phase2a-proof.meta records `"status": 404`, and the emitted HTML
//     contains zero occurrences of the harness markup. `NODE_ENV` is
//     substituted at build time, so the guard below goes dead-true and
//     the harness is never rendered, hydrated, or reachable.
//   - The harness's client chunk IS still emitted — ~6.5 KB at
//     .next/static/chunks/<hash>.js. It is orphaned: the only thing
//     referencing it is the 404'd route's own client-reference manifest,
//     so no live page ever loads it. It remains publicly fetchable by
//     direct URL, which is harmless (it is UI code calling the two
//     endpoints that are already public and anonymous by design), but
//     "it ships" is the accurate word, not "it doesn't."
//
//     Making the import dynamic and putting it below the guard was tried
//     specifically to drop that chunk. It did not — Turbopack emits the
//     chunk for a dynamic import regardless of the dead branch — so the
//     plain static import is back, being simpler and exactly as effective.
//
// The route is kept rather than deleted because it is the only way to
// re-run a real browser-driven proof of the Phase 2A endpoints,
// including the cross-origin CORS path (see ./harness.tsx). Re-verifying
// beats trusting a prose record of a verification someone did once.
//
// The guard is `!== 'development'`, not `=== 'production'`, on purpose:
// a deny-list guard leaves the harness live whenever NODE_ENV is unset
// or unexpected — a `next build` run without NODE_ENV set, then
// `next start`, bakes in `'development' === 'production'` → false and
// serves the harness for real. A positive allow-list closes that: only
// an actual dev server serves it, every other environment 404s.
//
// See docs/PHASE2_WEB_SDK_INTEGRATION.md#local-end-to-end-proof.
// ============================================================

import { notFound } from 'next/navigation'
import { Phase2AProofHarness } from './harness'

export default function Phase2AProofPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <Phase2AProofHarness />
}
