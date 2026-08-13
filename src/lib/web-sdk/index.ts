// ============================================================
// Phase 2A web SDK — public entry point.
//
// One explicit init call, not an auto-running side effect on import —
// the website integrating this decides when tracking starts, matching
// how real embeddable SDKs (Segment, Amplitude) expose an init step
// rather than executing on module load. See
// docs/PHASE2_WEB_SDK_INTEGRATION.md for the integration guide this
// module is written to match.
// ============================================================

import { getOrCreateVisitorId, getOrCreateSessionId } from './identity'
import {
  trackPageView,
  trackProductView,
  trackCtaClick,
  type TrackPageViewInput,
  type TrackProductViewInput,
  type WebSdkOptions,
} from './events'
import {
  resolveContinuationFromUrl,
  type ResolveContinuationOptions,
  type ContinuationResolveOutcome,
} from './continuation'

export type { WebEventType } from '@/lib/timeline/ingest'
export type { ContinuationResolveOutcome, ResolvedContinuationData } from './continuation'
export type { TrackPageViewInput, TrackProductViewInput, WebSdkOptions } from './events'

export type YaliWebSdkConfig = WebSdkOptions

export interface YaliWebSdk {
  getVisitorId(): string
  getSessionId(): string
  trackPageView(input: TrackPageViewInput): Promise<boolean>
  trackProductView(input: TrackProductViewInput): Promise<boolean>
  /** Not yet supported server-side — see events.ts's module comment. Always resolves false. */
  trackCtaClick(): Promise<boolean>
  resolveContinuationFromUrl(
    overrides?: Omit<ResolveContinuationOptions, keyof WebSdkOptions>
  ): Promise<ContinuationResolveOutcome>
}

export function initYaliWebSdk(config: YaliWebSdkConfig = {}): YaliWebSdk {
  const baseOpts: WebSdkOptions = { apiBaseUrl: config.apiBaseUrl, fetchImpl: config.fetchImpl }

  return {
    getVisitorId: getOrCreateVisitorId,
    getSessionId: getOrCreateSessionId,
    trackPageView: (input) => trackPageView(input, baseOpts),
    trackProductView: (input) => trackProductView(input, baseOpts),
    trackCtaClick,
    // The visitor id is supplied here rather than left to the caller, so
    // the identity link works by default. An explicit override still
    // wins; passing visitorId: undefined opts out of binding entirely.
    resolveContinuationFromUrl: (overrides = {}) =>
      resolveContinuationFromUrl({
        ...baseOpts,
        visitorId: getOrCreateVisitorId(),
        ...overrides,
      }),
  }
}
