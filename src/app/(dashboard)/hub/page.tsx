'use client'

import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'

import { useAuth } from '@/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import { listTimelineEventsForAccount, type TimelineEventRow } from '@/lib/timeline/events'
import {
  TimelineFeed,
  type TimelineFeedStatus,
} from '@/components/dashboard/timeline-feed'

/**
 * Timeline — the account-wide activity feed, and the first surface that
 * makes crm.timeline_events visible to a human. Reads through the
 * authenticated browser client, so the timeline_events_account_rw RLS
 * policy (045) is what scopes the rows; no service-role key and no API
 * route is involved.
 *
 * Account-scoped, not contact-scoped: every event the live web SDK
 * writes has contact_id = NULL, so a contact timeline would render empty
 * for all current data. It lands when identity linking does.
 */
export default function HubPage() {
  const { accountId, profileLoading } = useAuth()
  const [fetchState, setFetchState] = useState<TimelineFeedStatus>('loading')
  const [events, setEvents] = useState<TimelineEventRow[]>([])
  const [reloadToken, setReloadToken] = useState(0)

  // Derived during render rather than assigned from the effect. Both
  // pre-fetch conditions are already knowable here: profileLoading holds
  // the skeleton, and a settled profile with no account is the "profile
  // is not linked to an account" case that no retry can fix.
  const status: TimelineFeedStatus = profileLoading
    ? 'loading'
    : accountId
      ? fetchState
      : 'error'

  // Async IIFE + cancellation flag, same shape as the agents page. The
  // flag is not just lint hygiene: without it a slow response for a
  // previous accountId can land after a newer one and overwrite it.
  useEffect(() => {
    if (profileLoading || !accountId) return
    let cancelled = false

    void (async () => {
      try {
        const rows = await listTimelineEventsForAccount(createClient(), accountId)
        if (cancelled) return
        setEvents(rows)
        setFetchState('ready')
      } catch (error) {
        console.error('[hub] failed to load timeline:', error)
        if (!cancelled) setFetchState('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [accountId, profileLoading, reloadToken])

  function retry() {
    setFetchState('loading')
    setReloadToken((token) => token + 1)
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Timeline</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything your customers do across channels, newest first. Showing the
        latest 50 events.
      </p>

      <div className="mt-6">
        <TimelineFeed status={status} events={events} onRetry={retry} />
      </div>
    </div>
  )
}
