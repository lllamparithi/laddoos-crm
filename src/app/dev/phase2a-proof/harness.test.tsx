import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Phase2AProofHarness } from './harness'

/**
 * Same pattern as src/components/ui/dropdown-menu-group-label.test.tsx —
 * the only React-component test precedent in this codebase, and it's
 * deliberately narrow: `renderToStaticMarkup` produces the component's
 * INITIAL synchronous render only. It does not run `useEffect` (so the
 * on-mount continuation-resolve call never fires here) and there's no
 * DOM/event loop to click the buttons with, so it cannot prove the SDK
 * is actually called. That proof is what the real-browser pass in
 * docs/PHASE2_WEB_SDK_INTEGRATION.md#local-end-to-end-proof is for —
 * this test's only job is pinning "the harness renders without
 * crashing before any interaction happens."
 */
describe('Phase2AProofHarness', () => {
  it('renders its initial static markup without throwing', () => {
    expect(() => renderToStaticMarkup(React.createElement(Phase2AProofHarness))).not.toThrow()
  })

  it('shows the loading placeholders before any effect has run', () => {
    const html = renderToStaticMarkup(React.createElement(Phase2AProofHarness))
    expect(html).toContain('(loading)')
    expect(html).toContain('Track page view')
    expect(html).toContain('Track product view')
  })

  it('defaults to same-origin when there is no window to read ?api= from', () => {
    const html = renderToStaticMarkup(React.createElement(Phase2AProofHarness))
    expect(html).toContain('same-origin')
    expect(html).not.toContain('CROSS-ORIGIN')
  })
})
