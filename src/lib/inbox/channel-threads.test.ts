import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  ChannelThreadError,
  HANDLE_KEYED_CHANNELS,
  listChannelThreads,
  listThreadHistory,
  markThreadRead,
  projectTimelineEventToThread,
  updateChannelThreadState,
} from './channel-threads'

const ACCOUNT = 'acct-1'
const OTHER_ACCOUNT = 'acct-2'
const HANDLE = 'handle-1'

/**
 * Records every filter applied to every table so isolation and channel
 * separation can be asserted precisely, not just "it didn't throw".
 */
interface QueryRecord {
  table: string
  filters: Record<string, unknown>
  ins: Record<string, unknown[]>
  order?: { column: string; ascending: boolean }
  limit?: number
  lt: Record<string, unknown>
  gt: Record<string, unknown>
  update?: Record<string, unknown>
}

function captureDb(responses: {
  channel_threads?: unknown
  timeline_events?: unknown
  identity_handles?: unknown
  count?: number
  rpc?: { data?: unknown; error?: { message: string } | null }
} = {}) {
  const queries: QueryRecord[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(
        responses.rpc ?? { data: 'thread-1', error: null }
      )
    },
    from: (table: string) => {
      const rec: QueryRecord = { table, filters: {}, ins: {}, lt: {}, gt: {} }
      queries.push(rec)

      const result = () => {
        const data =
          table === 'channel_threads'
            ? responses.channel_threads ?? []
            : table === 'timeline_events'
              ? responses.timeline_events ?? []
              : responses.identity_handles ?? null
        return { data, error: null, count: responses.count ?? 0 }
      }

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => builder,
        update: (u: Record<string, unknown>) => {
          rec.update = u
          return builder
        },
        eq: (col: string, val: unknown) => {
          rec.filters[col] = val
          return builder
        },
        in: (col: string, vals: unknown[]) => {
          rec.ins[col] = vals
          return builder
        },
        lt: (col: string, val: unknown) => {
          rec.lt[col] = val
          return builder
        },
        gt: (col: string, val: unknown) => {
          rec.gt[col] = val
          return builder
        },
        order: (column: string, opts: { ascending: boolean }) => {
          rec.order = { column, ascending: opts.ascending }
          return builder
        },
        // Returns the builder (which is thenable) rather than a promise,
        // so a trailing .maybeSingle() can still chain after .limit().
        limit: (n: number) => {
          rec.limit = n
          return builder
        },
        maybeSingle: () => {
          const r = result()
          const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
          return Promise.resolve({ data: d, error: null })
        },
        single: () => {
          const r = result()
          const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
          return Promise.resolve({ data: d, error: null })
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { db: db as AnySupabaseClient, queries, rpcCalls }
}

function threadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    account_id: ACCOUNT,
    channel: 'instagram',
    handle_id: HANDLE,
    contact_id: null,
    status: 'open',
    assigned_agent_id: null,
    last_activity_at: '2026-01-02T00:00:00.000Z',
    last_read_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

// ── Handle-first threading ───────────────────────────────────

describe('projectTimelineEventToThread — handle-first threading', () => {
  it('keys the thread on account + channel + handle, never a contact', async () => {
    const { db, rpcCalls } = captureDb()
    await projectTimelineEventToThread(db, {
      accountId: ACCOUNT,
      channel: 'instagram',
      handleId: HANDLE,
      occurredAt: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('upsert_channel_thread')
    expect(rpcCalls[0].args).toEqual({
      p_account_id: ACCOUNT,
      p_channel: 'instagram',
      p_handle_id: HANDLE,
      p_occurred_at: '2026-01-02T00:00:00.000Z',
    })
  })

  it('passes NO contact parameter — the projection cannot auto-link', async () => {
    const { db, rpcCalls } = captureDb()
    await projectTimelineEventToThread(db, {
      accountId: ACCOUNT,
      channel: 'messenger',
      handleId: HANDLE,
      occurredAt: new Date(),
    })

    const argNames = Object.keys(rpcCalls[0].args)
    expect(argNames).not.toContain('p_contact_id')
    expect(argNames).not.toContain('contact_id')
    expect(argNames).not.toContain('contactId')
  })

  it('returns the thread id from the upsert', async () => {
    const { db } = captureDb({ rpc: { data: 'thread-xyz', error: null } })
    const id = await projectTimelineEventToThread(db, {
      accountId: ACCOUNT,
      channel: 'instagram',
      handleId: HANDLE,
      occurredAt: new Date(),
    })
    expect(id).toBe('thread-xyz')
  })

  it('throws when the upsert errors (e.g. the SQL cross-account guard fires)', async () => {
    const { db } = captureDb({
      rpc: { data: null, error: { message: 'identity handle belongs to a different account' } },
    })
    await expect(
      projectTimelineEventToThread(db, {
        accountId: OTHER_ACCOUNT,
        channel: 'instagram',
        handleId: HANDLE,
        occurredAt: new Date(),
      })
    ).rejects.toThrow(ChannelThreadError)
  })

  it('throws rather than silently succeeding when no thread id comes back', async () => {
    const { db } = captureDb({ rpc: { data: null, error: null } })
    await expect(
      projectTimelineEventToThread(db, {
        accountId: ACCOUNT,
        channel: 'instagram',
        handleId: HANDLE,
        occurredAt: new Date(),
      })
    ).rejects.toThrow(/did not run/)
  })
})

// ── Replay safety ────────────────────────────────────────────

describe('replay safety', () => {
  it('sends an identical RPC payload for a replayed event', async () => {
    const { db, rpcCalls } = captureDb()
    const input = {
      accountId: ACCOUNT,
      channel: 'messenger' as const,
      handleId: HANDLE,
      occurredAt: new Date('2026-01-02T00:00:00.000Z'),
    }
    await projectTimelineEventToThread(db, input)
    await projectTimelineEventToThread(db, input)

    // Same key AND same timestamp -> the ON CONFLICT upsert collides and
    // GREATEST() leaves last_activity_at unchanged. If the caller ever
    // stamped the clock instead of using the payload time, these would
    // differ and each replay would bump the thread.
    expect(rpcCalls[0].args).toEqual(rpcCalls[1].args)
  })

  it('passes the payload timestamp verbatim, never the clock', async () => {
    const { db, rpcCalls } = captureDb()
    const occurredAt = new Date('2025-06-01T12:34:56.000Z')
    await projectTimelineEventToThread(db, {
      accountId: ACCOUNT,
      channel: 'instagram',
      handleId: HANDLE,
      occurredAt,
    })
    expect(rpcCalls[0].args.p_occurred_at).toBe('2025-06-01T12:34:56.000Z')
  })

  it('markThreadRead is monotonic — an older timestamp does not rewind', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow({ last_read_at: '2026-01-05T00:00:00.000Z' })],
    })
    const result = await markThreadRead(
      db,
      ACCOUNT,
      'thread-1',
      new Date('2026-01-01T00:00:00.000Z')
    )

    expect(result.last_read_at).toBe('2026-01-05T00:00:00.000Z')
    // No update issued at all.
    expect(queries.filter((q) => q.update !== undefined)).toHaveLength(0)
  })

  it('markThreadRead advances when the new timestamp is newer', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow({ last_read_at: '2026-01-01T00:00:00.000Z' })],
    })
    await markThreadRead(db, ACCOUNT, 'thread-1', new Date('2026-01-09T00:00:00.000Z'))

    const updates = queries.filter((q) => q.update !== undefined)
    expect(updates).toHaveLength(1)
    expect(updates[0].update).toEqual({ last_read_at: '2026-01-09T00:00:00.000Z' })
  })
})

// ── Human-approved linking only ──────────────────────────────

describe('identity linking stays human-approved', () => {
  it('updateChannelThreadState cannot set contact_id', async () => {
    const { db, queries } = captureDb({ channel_threads: [threadRow()] })
    await updateChannelThreadState(db, ACCOUNT, 'thread-1', {
      status: 'closed',
      assignedAgentId: 'agent-9',
    })

    const update = queries.find((q) => q.update !== undefined)?.update ?? {}
    expect(update).toEqual({ status: 'closed', assigned_agent_id: 'agent-9' })
    expect(Object.keys(update)).not.toContain('contact_id')
  })

  it('a contactId smuggled into the patch object is ignored, not written', async () => {
    const { db, queries } = captureDb({ channel_threads: [threadRow()] })
    await updateChannelThreadState(db, ACCOUNT, 'thread-1', {
      status: 'open',
      // @ts-expect-error — proving the runtime ignores it, not just the type
      contactId: 'contact-should-not-be-set',
      contact_id: 'contact-should-not-be-set',
    })

    const update = queries.find((q) => q.update !== undefined)?.update ?? {}
    expect(update).toEqual({ status: 'open' })
    expect(JSON.stringify(update)).not.toContain('contact-should-not-be-set')
  })

  it('rejects an empty patch rather than issuing a no-op write', async () => {
    const { db } = captureDb({ channel_threads: [threadRow()] })
    await expect(updateChannelThreadState(db, ACCOUNT, 'thread-1', {})).rejects.toThrow(
      /No operational fields/
    )
  })

  it('an unlinked thread is still fully workable', async () => {
    const { db } = captureDb({ channel_threads: [threadRow({ contact_id: null })] })
    const updated = await updateChannelThreadState(db, ACCOUNT, 'thread-1', {
      assignedAgentId: 'agent-1',
    })
    expect(updated.contact_id).toBeNull()
  })
})

// ── Cross-channel separation ─────────────────────────────────

describe('cross-channel separation', () => {
  it('filters by channel when one is requested', async () => {
    const { db, queries } = captureDb({ channel_threads: [] })
    await listChannelThreads(db, ACCOUNT, { channel: 'messenger' })

    const q = queries.find((x) => x.table === 'channel_threads')!
    expect(q.filters.channel).toBe('messenger')
    expect(q.filters.account_id).toBe(ACCOUNT)
  })

  it('does not filter by channel when none is requested', async () => {
    const { db, queries } = captureDb({ channel_threads: [] })
    await listChannelThreads(db, ACCOUNT)

    const q = queries.find((x) => x.table === 'channel_threads')!
    expect(q.filters.channel).toBeUndefined()
  })

  it('treats instagram and messenger as distinct threads for the same handle', async () => {
    const { db, rpcCalls } = captureDb()
    await projectTimelineEventToThread(db, {
      accountId: ACCOUNT,
      channel: 'instagram',
      handleId: HANDLE,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await projectTimelineEventToThread(db, {
      accountId: ACCOUNT,
      channel: 'messenger',
      handleId: HANDLE,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    // Different channel => different unique key => two threads, never merged.
    expect(rpcCalls[0].args.p_channel).toBe('instagram')
    expect(rpcCalls[1].args.p_channel).toBe('messenger')
    expect(rpcCalls[0].args).not.toEqual(rpcCalls[1].args)
  })

  it('exposes exactly the handle-keyed channels — WhatsApp is not one', () => {
    expect(HANDLE_KEYED_CHANNELS).toEqual(['instagram', 'messenger'])
    expect(HANDLE_KEYED_CHANNELS as readonly string[]).not.toContain('whatsapp')
  })
})

// ── Tenant / account isolation ───────────────────────────────

describe('account isolation', () => {
  it('every read filters on account_id explicitly, not RLS alone', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow()],
      timeline_events: [{ summary: 'hi' }],
      identity_handles: { handle_value: 'psid-1' },
    })
    await listChannelThreads(db, ACCOUNT)

    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) {
      expect(q.filters.account_id).toBe(ACCOUNT)
    }
  })

  it('thread history filters on account_id and handle_id together', async () => {
    const { db, queries } = captureDb({ timeline_events: [] })
    await listThreadHistory(db, ACCOUNT, HANDLE)

    const q = queries.find((x) => x.table === 'timeline_events')!
    expect(q.filters.account_id).toBe(ACCOUNT)
    expect(q.filters.handle_id).toBe(HANDLE)
  })

  it('mark-read scopes its write to the account', async () => {
    const { db, queries } = captureDb({ channel_threads: [threadRow()] })
    await markThreadRead(db, ACCOUNT, 'thread-1', new Date('2026-02-01T00:00:00.000Z'))

    for (const q of queries) {
      expect(q.filters.account_id).toBe(ACCOUNT)
    }
  })

  it('state updates scope their write to the account', async () => {
    const { db, queries } = captureDb({ channel_threads: [threadRow()] })
    await updateChannelThreadState(db, ACCOUNT, 'thread-1', { status: 'closed' })

    const q = queries.find((x) => x.update !== undefined)!
    expect(q.filters.account_id).toBe(ACCOUNT)
    expect(q.filters.id).toBe('thread-1')
  })

  it('a thread from another account is reported not-found, not returned', async () => {
    const { db } = captureDb({ channel_threads: [] })
    await expect(
      markThreadRead(db, OTHER_ACCOUNT, 'thread-1', new Date())
    ).rejects.toThrow(/not found/i)
  })
})

// ── Derived reads: preview, unread, pagination ───────────────

describe('derived read model', () => {
  it('derives preview from the newest message event, not a stored column', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow()],
      timeline_events: [{ summary: 'most recent message' }],
      identity_handles: { handle_value: 'psid-1' },
    })
    const items = await listChannelThreads(db, ACCOUNT)

    expect(items[0].preview).toBe('most recent message')
    const previewQuery = queries.find(
      (q) => q.table === 'timeline_events' && q.order?.column === 'occurred_at'
    )!
    expect(previewQuery.order).toEqual({ column: 'occurred_at', ascending: false })
    expect(previewQuery.ins.event_type).toEqual(['message.inbound', 'message.outbound'])
  })

  it('counts every inbound event as unread when nothing has been read', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow({ last_read_at: null })],
      timeline_events: [],
      identity_handles: { handle_value: 'psid-1' },
      count: 7,
    })
    const items = await listChannelThreads(db, ACCOUNT)

    expect(items[0].unreadCount).toBe(7)
    const unreadQuery = queries.find((q) => q.filters.event_type === 'message.inbound')!
    // No occurred_at lower bound when last_read_at is null.
    expect(unreadQuery.gt.occurred_at).toBeUndefined()
  })

  it('bounds the unread count by last_read_at when one exists', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow({ last_read_at: '2026-01-03T00:00:00.000Z' })],
      timeline_events: [],
      identity_handles: { handle_value: 'psid-1' },
      count: 2,
    })
    await listChannelThreads(db, ACCOUNT)

    const unreadQuery = queries.find((q) => q.filters.event_type === 'message.inbound')!
    expect(unreadQuery.gt.occurred_at).toBe('2026-01-03T00:00:00.000Z')
  })

  it('counts only inbound events toward unread', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow()],
      timeline_events: [],
      identity_handles: { handle_value: 'psid-1' },
    })
    await listChannelThreads(db, ACCOUNT)

    const unreadQuery = queries.find((q) => q.filters.event_type === 'message.inbound')!
    expect(unreadQuery.filters.event_type).toBe('message.inbound')
  })

  it('surfaces the raw handle value as a fallback label when unlinked', async () => {
    const { db } = captureDb({
      channel_threads: [threadRow({ contact_id: null })],
      timeline_events: [{ summary: 'hi' }],
      identity_handles: { handle_value: 'psid-abc' },
      count: 0,
    })
    const items = await listChannelThreads(db, ACCOUNT)

    expect(items[0].handleValue).toBe('psid-abc')
    expect(items[0].contactId).toBeNull()
  })

  it('orders newest-first and applies a keyset cursor', async () => {
    const { db, queries } = captureDb({ channel_threads: [] })
    await listChannelThreads(db, ACCOUNT, {
      before: new Date('2026-01-05T00:00:00.000Z'),
      limit: 10,
    })

    const q = queries.find((x) => x.table === 'channel_threads')!
    expect(q.order).toEqual({ column: 'last_activity_at', ascending: false })
    expect(q.lt.last_activity_at).toBe('2026-01-05T00:00:00.000Z')
    expect(q.limit).toBe(10)
  })

  it('paginates thread history with a keyset cursor, newest first', async () => {
    const { db, queries } = captureDb({ timeline_events: [] })
    await listThreadHistory(db, ACCOUNT, HANDLE, {
      before: new Date('2026-01-04T00:00:00.000Z'),
      limit: 25,
    })

    const q = queries.find((x) => x.table === 'timeline_events')!
    expect(q.order).toEqual({ column: 'occurred_at', ascending: false })
    expect(q.lt.occurred_at).toBe('2026-01-04T00:00:00.000Z')
    expect(q.limit).toBe(25)
  })

  it('returns an empty list without extra queries when no threads exist', async () => {
    const { db, queries } = captureDb({ channel_threads: [] })
    const items = await listChannelThreads(db, ACCOUNT)

    expect(items).toEqual([])
    expect(queries.filter((q) => q.table === 'timeline_events')).toHaveLength(0)
  })
})

// ── crm.messages / WhatsApp non-regression ───────────────────

describe('WhatsApp and crm.messages are untouched', () => {
  it('never reads or writes conversations or messages', async () => {
    const { db, queries } = captureDb({
      channel_threads: [threadRow()],
      timeline_events: [{ summary: 'hi' }],
      identity_handles: { handle_value: 'psid-1' },
    })
    await listChannelThreads(db, ACCOUNT)
    await listThreadHistory(db, ACCOUNT, HANDLE)
    await markThreadRead(db, ACCOUNT, 'thread-1', new Date('2030-01-01T00:00:00.000Z'))
    await updateChannelThreadState(db, ACCOUNT, 'thread-1', { status: 'closed' })

    const tables = new Set(queries.map((q) => q.table))
    expect(tables).not.toContain('conversations')
    expect(tables).not.toContain('messages')
    expect(tables).not.toContain('contacts')
  })

  it('the module source references no inbox-table writes', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./channel-threads.ts', import.meta.url), 'utf8')

    for (const forbidden of [
      "from('conversations')",
      "from('messages')",
      "from('contacts')",
      'unread_count',
      'last_message_text',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
