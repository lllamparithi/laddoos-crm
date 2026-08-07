import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TimelineFeed, type TimelineFeedProps } from './timeline-feed'
import type { TimelineEventRow } from '@/lib/timeline/events'

/**
 * Rendered with `renderToStaticMarkup` rather than a DOM testing
 * library — vitest runs on `environment: "node"` here and the same
 * approach already pins DropdownMenuLabel (see
 * src/components/ui/dropdown-menu-group-label.test.tsx). TimelineFeed is
 * deliberately hook-free so every branch is reachable this way, with no
 * jsdom dependency, no database and no session.
 */
const baseEvent: TimelineEventRow = {
  id: 'evt-1',
  account_id: 'acct-1',
  tenant_id: 'tenant-1',
  brand_id: 'brand-1',
  handle_id: 'handle-1',
  contact_id: null,
  customer_id: null,
  event_type: 'web.page_view',
  channel: 'web',
  source: 'web_sdk',
  occurred_at: '2026-08-07T03:08:54.081Z',
  recorded_at: '2026-08-07T03:08:54.200Z',
  conversation_id: null,
  session_id: null,
  campaign_id: null,
  ad_id: null,
  creative_id: null,
  summary: 'Viewed /collections/festive-boxes',
  payload_ref: {},
  payload_hash: null,
  confidence: 'verified',
  visibility: 'team',
  owner_user_id: null,
  action_state: 'none',
  snoozed_until: null,
  corrects_event_id: null,
  dedupe_key: 'web:sess-1:web.page_view:1',
  created_by: null,
}

function render(props: Partial<TimelineFeedProps> = {}) {
  return renderToStaticMarkup(
    React.createElement(TimelineFeed, {
      status: 'ready',
      events: [],
      onRetry: () => {},
      ...props,
    }),
  )
}

describe('TimelineFeed states', () => {
  it('loading renders placeholders and no empty-state copy', () => {
    const html = render({ status: 'loading' })
    expect(html).toContain('animate-pulse')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('No activity yet')
  })

  it('error is distinguishable from an empty timeline and offers a retry', () => {
    const html = render({ status: 'error' })
    expect(html).toContain('Could not load activity')
    expect(html).toContain('Try again')
    // The distinction the founder actually needs: a failed read must
    // never read as "you have no customers".
    expect(html).not.toContain('No activity yet')
  })

  it('empty renders the empty state, not an error and not a spinner', () => {
    const html = render({ status: 'ready', events: [] })
    expect(html).toContain('No activity yet')
    expect(html).not.toContain('Could not load activity')
    expect(html).not.toContain('animate-pulse')
  })

  it('populated renders the summary, channel and source', () => {
    const html = render({ status: 'ready', events: [baseEvent] })
    expect(html).toContain('Viewed /collections/festive-boxes')
    expect(html).toContain('web_sdk')
    // React's SSR keeps the camelCase attribute name here.
    expect(html).toContain('dateTime="2026-08-07T03:08:54.081Z"')
    expect(html).not.toContain('No activity yet')
  })
})

describe('TimelineFeed row rendering', () => {
  it('omits the confidence chip when the event is verified', () => {
    const html = render({ status: 'ready', events: [baseEvent] })
    expect(html).not.toContain('verified')
  })

  it('shows the confidence chip when the event is not verified', () => {
    const html = render({
      status: 'ready',
      events: [{ ...baseEvent, confidence: 'probable' }],
    })
    expect(html).toContain('probable')
  })

  it('escapes a summary containing markup', () => {
    const html = render({
      status: 'ready',
      events: [{ ...baseEvent, summary: '<img src=x onerror="alert(1)">' }],
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('caps an oversized summary from the anonymous ingest route', () => {
    const html = render({
      status: 'ready',
      events: [{ ...baseEvent, summary: 'A'.repeat(5000) }],
    })
    expect(html).toContain('A'.repeat(300))
    expect(html).not.toContain('A'.repeat(301))
  })

  it('degrades to the raw value instead of throwing on an unparseable occurred_at', () => {
    expect(() =>
      render({ status: 'ready', events: [{ ...baseEvent, occurred_at: 'not-a-date' }] }),
    ).not.toThrow()
    expect(
      render({ status: 'ready', events: [{ ...baseEvent, occurred_at: 'not-a-date' }] }),
    ).toContain('not-a-date')
  })

  it('renders one row per event', () => {
    const html = render({
      status: 'ready',
      events: [baseEvent, { ...baseEvent, id: 'evt-2', summary: 'Second event' }],
    })
    expect(html.match(/<li/g) ?? []).toHaveLength(2)
    expect(html).toContain('Second event')
  })
})
