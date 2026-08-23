import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  runAutomations: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomations,
}))

import { POST } from './route'

const ACCOUNT = 'account-1'
const CONVERSATION = 'conv-1'
const STORED_CONTACT = 'contact-real'
const AGENT = 'agent-1'
const OTHER_AGENT = 'agent-2'

/**
 * Minimal chainable Supabase stub. `conversations` returns the stored row,
 * `profiles` decides whether the requested assignee is a member.
 */
function makeSupabase(opts: {
  conversation?: Record<string, unknown> | null
  memberExists?: boolean
  updateError?: unknown
}) {
  const updates: Record<string, unknown>[] = []
  const supabase = {
    from(table: string) {
      if (table === 'conversations') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: opts.conversation === undefined ? {
              id: CONVERSATION,
              assigned_agent_id: null,
              contact_id: STORED_CONTACT,
            } : opts.conversation,
            error: null,
          }),
          update(payload: Record<string, unknown>) {
            updates.push(payload)
            const u: Record<string, unknown> = {
              eq: () => u,
              then: (r: (v: unknown) => unknown) =>
                r({ error: opts.updateError ?? null }),
            }
            return u
          },
        }
        return chain
      }
      const p: Record<string, unknown> = {
        select: () => p,
        eq: () => p,
        maybeSingle: async () => ({
          data: opts.memberExists === false ? null : { user_id: AGENT },
          error: null,
        }),
      }
      return p
    },
  }
  return { supabase, updates }
}

function req(body: unknown) {
  return new Request('http://test/api/conversations/conv-1/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ id: CONVERSATION }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runAutomations.mockResolvedValue(undefined)
})

describe('POST /api/conversations/[id]/assign — trust boundary', () => {
  // The defect this endpoint exists to close: the browser must not be
  // able to name the contact an automation runs against.
  it('ignores a browser-supplied contact_id and uses the stored one', async () => {
    const { supabase } = makeSupabase({})
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    const res = await POST(
      req({ agent_id: AGENT, contact_id: 'contact-ATTACKER-CHOSE' }),
      params,
    )

    expect(res.status).toBe(200)
    expect(mocks.runAutomations).toHaveBeenCalledTimes(1)
    const arg = mocks.runAutomations.mock.calls[0][0]
    expect(arg.contactId).toBe(STORED_CONTACT)
    expect(JSON.stringify(arg)).not.toContain('ATTACKER')
  })

  it('ignores browser-supplied trigger_type and context', async () => {
    const { supabase } = makeSupabase({})
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    await POST(
      req({
        agent_id: AGENT,
        trigger_type: 'new_contact_created',
        context: { agent_id: 'spoofed', conversation_id: 'conv-ELSEWHERE' },
      }),
      params,
    )

    const arg = mocks.runAutomations.mock.calls[0][0]
    expect(arg.triggerType).toBe('conversation_assigned')
    expect(arg.context.conversation_id).toBe(CONVERSATION)
    expect(arg.context.agent_id).toBe(AGENT)
  })

  it('ignores a browser-supplied previous assignee', async () => {
    // Stored state says already assigned to AGENT. A caller claiming a
    // different previous value must not turn a no-op into a dispatch.
    const { supabase } = makeSupabase({
      conversation: { id: CONVERSATION, assigned_agent_id: AGENT, contact_id: STORED_CONTACT },
    })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    const res = await POST(
      req({ agent_id: AGENT, previous_agent_id: OTHER_AGENT }),
      params,
    )

    expect(await res.json()).toMatchObject({ changed: false, dispatched: false })
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })

  it('rejects an assignee outside the account', async () => {
    const { supabase, updates } = makeSupabase({ memberExists: false })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    const res = await POST(req({ agent_id: 'agent-other-tenant' }), params)

    expect(res.status).toBe(400)
    expect(updates).toHaveLength(0)
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })

  it('404s for a conversation outside the account', async () => {
    const { supabase } = makeSupabase({ conversation: null })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    const res = await POST(req({ agent_id: AGENT }), params)
    expect(res.status).toBe(404)
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })
})

describe('POST /api/conversations/[id]/assign — behaviour', () => {
  it('persists then dispatches on a real assignment', async () => {
    const { supabase, updates } = makeSupabase({})
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    const res = await POST(req({ agent_id: AGENT }), params)

    expect(await res.json()).toMatchObject({ changed: true, dispatched: true })
    expect(updates).toEqual([{ assigned_agent_id: AGENT }])
    expect(mocks.runAutomations).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch when unassigning', async () => {
    const { supabase, updates } = makeSupabase({
      conversation: { id: CONVERSATION, assigned_agent_id: AGENT, contact_id: STORED_CONTACT },
    })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

    const res = await POST(req({ agent_id: null }), params)

    expect(await res.json()).toMatchObject({ changed: true, dispatched: false })
    expect(updates).toEqual([{ assigned_agent_id: null }])
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })

  it('a failing automation still returns success', async () => {
    const { supabase } = makeSupabase({})
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })
    mocks.runAutomations.mockRejectedValue(new Error('automation exploded'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(req({ agent_id: AGENT }), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ changed: true })
    spy.mockRestore()
  })

  // Regression: `|| null` coerced "" to null, so malformed input silently
  // unassigned the conversation. Only a literal JSON null may unassign.
  describe('empty and whitespace agent_id', () => {
    it.each([
      ['empty string', ''],
      ['single space', ' '],
      ['tab and newline', String.fromCharCode(9, 10)],
      ['multiple spaces', '   '],
    ])('rejects %s without updating or dispatching', async (_label, value) => {
      const { supabase, updates } = makeSupabase({
        conversation: {
          id: CONVERSATION,
          assigned_agent_id: AGENT,
          contact_id: STORED_CONTACT,
        },
      })
      mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

      const res = await POST(req({ agent_id: value }), params)

      expect(res.status).toBe(400)
      // The conversation stays assigned — no silent release.
      expect(updates).toHaveLength(0)
      expect(mocks.runAutomations).not.toHaveBeenCalled()
    })

    it('still accepts a literal null as an explicit unassign', async () => {
      const { supabase, updates } = makeSupabase({
        conversation: {
          id: CONVERSATION,
          assigned_agent_id: AGENT,
          contact_id: STORED_CONTACT,
        },
      })
      mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

      const res = await POST(req({ agent_id: null }), params)

      expect(res.status).toBe(200)
      expect(updates).toEqual([{ assigned_agent_id: null }])
      expect(mocks.runAutomations).not.toHaveBeenCalled()
    })

    it('trims a padded agent id rather than rejecting it', async () => {
      const { supabase, updates } = makeSupabase({})
      mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })

      const res = await POST(req({ agent_id: `  ${AGENT}  ` }), params)

      expect(res.status).toBe(200)
      expect(updates).toEqual([{ assigned_agent_id: AGENT }])
      expect(mocks.runAutomations.mock.calls[0][0].context.agent_id).toBe(AGENT)
    })
  })

  it('rejects a malformed body', async () => {
    const { supabase } = makeSupabase({})
    mocks.requireRole.mockResolvedValue({ supabase, accountId: ACCOUNT })
    expect((await POST(req({}), params)).status).toBe(400)
    expect((await POST(req({ agent_id: 42 }), params)).status).toBe(400)
  })
})
