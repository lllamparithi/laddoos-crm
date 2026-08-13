'use client'

import { format, formatDistanceToNow, parseISO } from 'date-fns'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { TimelineEventRow } from '@/lib/timeline/events'

export type TimelineFeedStatus = 'loading' | 'ready' | 'error'

export interface TimelineFeedProps {
  status: TimelineFeedStatus
  events: TimelineEventRow[]
  onRetry: () => void
  /**
   * Empty-state copy. Defaults describe the account-wide /hub feed; the
   * contact tab overrides them because "no activity" and "no activity we
   * can attribute to this contact" are different claims, and only the
   * second one is true there.
   */
  emptyTitle?: string
  emptyBody?: string
}

/**
 * A summary is written by the anonymous, unauthenticated
 * POST /api/web-events, which validates only "non-empty string" — there
 * is no length cap at ingest. React escapes the text so there is no
 * injection here, but an oversized one would still ship megabytes into
 * the DOM, so it is cut before render. `line-clamp-2` handles the
 * ordinary long-but-sane case visually.
 */
const SUMMARY_MAX_CHARS = 300

/**
 * date-fns throws RangeError on an unparseable value, which would take
 * the whole feed down over a single bad row rather than degrading it.
 * occurred_at is TIMESTAMPTZ NOT NULL so this should be unreachable;
 * the fallback costs three lines and turns a white screen into one
 * ugly-looking row.
 */
function formatOccurredAt(value: string): { relative: string; absolute: string } {
  const date = parseISO(value)
  if (Number.isNaN(date.getTime())) return { relative: value, absolute: value }
  return {
    relative: formatDistanceToNow(date, { addSuffix: true }),
    absolute: format(date, 'PPpp'),
  }
}

function FeedNotice({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    // Neutral tokens on purpose, including for the error case. A
    // `text-destructive` on `bg-destructive/10` is the same hue-on-hue
    // pairing that measured 1.33:1 on the owner role chip (see
    // CLAUDE.md); this needs no new token to clear AA.
    <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/**
 * Read-only account activity feed for /hub. Purely presentational — the
 * page owns fetching and state, which keeps every branch here reachable
 * from a test without a database, a browser or a session.
 */
export function TimelineFeed({
  status,
  events,
  onRetry,
  emptyTitle = 'No activity yet',
  emptyBody = 'Website visits, chats and form submissions appear here as they happen. Nothing has been recorded for this account so far.',
}: TimelineFeedProps) {
  if (status === 'loading') {
    return (
      <div className="rounded-xl border border-border bg-card px-5" aria-busy="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex gap-4 border-b border-border py-4 last:border-0">
            <Skeleton className="h-3 w-24 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <FeedNotice
        title="Could not load activity"
        body="The timeline could not be read just now. This is a load failure, not an empty timeline."
        action={
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    )
  }

  if (events.length === 0) {
    return <FeedNotice title={emptyTitle} body={emptyBody} />
  }

  return (
    <ol className="rounded-xl border border-border bg-card px-5">
      {events.map((event) => {
        const { relative, absolute } = formatOccurredAt(event.occurred_at)
        return (
          <li
            key={event.id}
            className="flex flex-col gap-2 border-b border-border py-4 last:border-0 sm:flex-row sm:gap-4"
          >
            <time
              dateTime={event.occurred_at}
              title={absolute}
              className="shrink-0 text-xs text-muted-foreground sm:w-32"
            >
              {relative}
            </time>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm break-words text-foreground">
                {event.summary.slice(0, SUMMARY_MAX_CHARS)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{event.channel}</Badge>
                <span>{event.source}</span>
                {/* Only the exceptions are worth a chip. 045 defaults
                    confidence to 'verified' and every live row carries
                    it, so rendering it on each line would be noise that
                    hides the rows that genuinely are not verified. */}
                {event.confidence !== 'verified' ? (
                  <Badge variant="outline">{event.confidence}</Badge>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
