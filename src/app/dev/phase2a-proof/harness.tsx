'use client'

import { useEffect, useState } from 'react'
import { initYaliWebSdk, type ContinuationResolveOutcome } from '@/lib/web-sdk'

interface LogEntry {
  label: string
  status: 'pending' | 'ok' | 'failed'
  detail: string
}

/**
 * Reads the initial API base from `?api=`, so the on-mount continuation
 * resolve can go cross-origin too (state set after mount would be too
 * late for it).
 *
 * How to drive a REAL cross-origin proof with one dev server: browsers
 * treat `http://localhost:3000` and `http://127.0.0.1:3000` as different
 * origins even though they are the same server. So opening
 *
 *   http://127.0.0.1:3000/dev/phase2a-proof?api=http://localhost:3000
 *
 * makes every SDK call a genuine cross-origin request — preflight and
 * all — against the same local stack, with no second host, no tunnel,
 * and no DNS. Put `http://127.0.0.1:3000` in YALI_WEB_SDK_ALLOWED_ORIGINS
 * to watch it succeed, then remove it and watch the browser block it.
 *
 * `?api=` is only ever read on a dev server (../page.tsx 404s
 * everywhere else) and only causes this page's own browser to fetch a
 * URL its operator typed — it is a diagnostic knob, not an open redirect.
 */
function initialApiBaseUrl(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('api') ?? ''
}

export function Phase2AProofHarness() {
  const [visitorId, setVisitorId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(initialApiBaseUrl)
  const [log, setLog] = useState<LogEntry[]>([])

  function pushLog(entry: LogEntry) {
    setLog((prev) => [...prev, entry])
  }

  async function resolveContinuation(baseUrl: string) {
    const sdk = initYaliWebSdk({ apiBaseUrl: baseUrl })
    const outcome: ContinuationResolveOutcome = await sdk.resolveContinuationFromUrl()
    pushLog({
      label: `resolve_continuation (api="${baseUrl || 'same-origin'}")`,
      status: 'ok',
      detail: JSON.stringify(outcome),
    })
  }

  // Continuation resolution happens on mount, unconditionally — matching
  // real-world behaviour: whether a visitor arrived via a tracked link
  // isn't something a button click decides, it's a fact of how the page
  // was loaded. Page view / product view stay separate, explicit buttons
  // below so each call is individually observable while driving this
  // harness (network tab, then a direct DB check) rather than three
  // calls firing indistinguishably at once.
  //
  // Reads the query param directly rather than the state it seeded, so
  // this stays a genuine mount-only effect with no stale closure.
  //
  // The setApiBaseUrl() here is NOT redundant with the useState
  // initializer above, and removing it silently breaks the whole
  // cross-origin proof: a useState initializer runs during the SERVER
  // render (where there is no window, so it returns ''), and React
  // hydrates the client with that server value rather than re-running
  // it. Without this line the input stays blank and every button posts
  // same-origin no matter what ?api= says — which looks like CORS
  // "working" while never actually crossing an origin. Found by running
  // the harness, not by reading it.
  useEffect(() => {
    const baseUrl = initialApiBaseUrl()
    setApiBaseUrl(baseUrl)

    const sdk = initYaliWebSdk({ apiBaseUrl: baseUrl })
    setVisitorId(sdk.getVisitorId())
    setSessionId(sdk.getSessionId())

    void resolveContinuation(baseUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleTrackPageView() {
    const sdk = initYaliWebSdk({ apiBaseUrl })
    pushLog({ label: 'track_page_view', status: 'pending', detail: '' })
    const ok = await sdk.trackPageView({
      path: '/dev/phase2a-proof',
      title: 'Phase 2A Proof Harness',
    })
    pushLog({ label: 'track_page_view', status: ok ? 'ok' : 'failed', detail: String(ok) })
  }

  async function handleTrackProductView() {
    const sdk = initYaliWebSdk({ apiBaseUrl })
    pushLog({ label: 'track_product_view', status: 'pending', detail: '' })
    const ok = await sdk.trackProductView({
      productId: 'proof-sku-1',
      productName: 'Phase 2A Proof Product',
    })
    pushLog({ label: 'track_product_view', status: ok ? 'ok' : 'failed', detail: String(ok) })
  }

  const isCrossOrigin =
    typeof window !== 'undefined' && apiBaseUrl !== '' && !apiBaseUrl.startsWith(window.origin)

  return (
    <main style={{ fontFamily: 'monospace', padding: 24, maxWidth: 720 }}>
      <h1>Phase 2A Web SDK — Local Proof Harness</h1>
      <p>
        Dev-only. Calls <code>initYaliWebSdk()</code> against{' '}
        <code>/api/web-events</code> and{' '}
        <code>/api/continuation-tokens/resolve</code>. See{' '}
        <code>docs/PHASE2_WEB_SDK_INTEGRATION.md</code>.
      </p>

      <p>
        <label>
          API base URL{' '}
          <input
            data-testid="api-base-url"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="(blank = same-origin)"
            size={40}
          />
        </label>{' '}
        <span data-testid="origin-mode">{isCrossOrigin ? 'CROSS-ORIGIN' : 'same-origin'}</span>
      </p>
      <p>
        Blank calls the API same-origin. To prove CORS, open this page on{' '}
        <code>http://127.0.0.1:3000</code> and set this to{' '}
        <code>http://localhost:3000</code> (or vice versa) — different origins to the
        browser, same dev server.
      </p>

      <dl>
        <dt>visitor_id</dt>
        <dd data-testid="visitor-id">{visitorId ?? '(loading)'}</dd>
        <dt>session_id</dt>
        <dd data-testid="session-id">{sessionId ?? '(loading)'}</dd>
      </dl>

      <p>
        <button data-testid="trigger-page-view" onClick={() => void handleTrackPageView()}>
          Track page view
        </button>{' '}
        <button
          data-testid="trigger-product-view"
          onClick={() => void handleTrackProductView()}
        >
          Track product view
        </button>{' '}
        <button
          data-testid="trigger-resolve"
          onClick={() => void resolveContinuation(apiBaseUrl)}
        >
          Resolve continuation
        </button>
      </p>

      <h2>Call log</h2>
      <ul data-testid="call-log">
        {log.map((entry, i) => (
          <li key={i} data-testid={`log-entry-${i}`}>
            <strong>{entry.label}</strong> — {entry.status}
            {entry.detail ? `: ${entry.detail}` : ''}
          </li>
        ))}
      </ul>
    </main>
  )
}
