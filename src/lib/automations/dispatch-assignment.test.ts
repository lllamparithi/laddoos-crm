import { describe, expect, it, vi } from 'vitest'

import {
  dispatchConversationAssigned,
  shouldDispatchConversationAssigned,
  type AutomationDispatcher,
} from './dispatch-assignment'

const ACCOUNT = 'acct-1'
const CONVERSATION = 'conv-1'
const CONTACT = 'contact-1'
const AGENT = 'agent-1'
const OTHER_AGENT = 'agent-2'

function base(overrides = {}) {
  return {
    accountId: ACCOUNT,
    conversationId: CONVERSATION,
    contactId: CONTACT,
    previousAgentId: null as string | null,
    nextAgentId: AGENT as string | null,
    origin: 'manual' as const,
    ...overrides,
  }
}

describe('shouldDispatchConversationAssigned', () => {
  it('fires on a genuine manual assignment', () => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: null,
        nextAgentId: AGENT,
        origin: 'manual',
      }),
    ).toBe(true)
  })

  it('fires on an AI take-over handoff', () => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: null,
        nextAgentId: AGENT,
        origin: 'ai_handoff',
      }),
    ).toBe(true)
  })

  it('fires when reassigning from one agent to another', () => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: OTHER_AGENT,
        nextAgentId: AGENT,
        origin: 'manual',
      }),
    ).toBe(true)
  })

  // Loop guard — an assign automation must not trigger assign automations.
  it('never fires for an automation-driven assignment', () => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: null,
        nextAgentId: AGENT,
        origin: 'automation',
      }),
    ).toBe(false)
  })

  it('the automation guard wins even over an otherwise valid change', () => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: OTHER_AGENT,
        nextAgentId: AGENT,
        origin: 'automation',
      }),
    ).toBe(false)
  })

  it('does not fire when re-selecting the current assignee (no-op)', () => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: AGENT,
        nextAgentId: AGENT,
        origin: 'manual',
      }),
    ).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('does not fire when unassigning (%s)', (_label, next) => {
    expect(
      shouldDispatchConversationAssigned({
        previousAgentId: AGENT,
        nextAgentId: next as string | null,
        origin: 'manual',
      }),
    ).toBe(false)
  })
})

describe('dispatchConversationAssigned', () => {
  it('dispatches with the agent and conversation in context', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined) as AutomationDispatcher
    const attempted = await dispatchConversationAssigned(base(), dispatch)

    expect(attempted).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      triggerType: 'conversation_assigned',
      contactId: CONTACT,
      context: { conversation_id: CONVERSATION, agent_id: AGENT },
    })
  })

  it('does not dispatch for an automation-origin assignment', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined) as AutomationDispatcher
    const attempted = await dispatchConversationAssigned(
      base({ origin: 'automation' }),
      dispatch,
    )
    expect(attempted).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch on unassign or a same-agent no-op', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined) as AutomationDispatcher
    expect(
      await dispatchConversationAssigned(base({ nextAgentId: null }), dispatch),
    ).toBe(false)
    expect(
      await dispatchConversationAssigned(
        base({ previousAgentId: AGENT, nextAgentId: AGENT }),
        dispatch,
      ),
    ).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  // Non-blocking contract: the assignment has already committed, so a
  // broken automation must never surface as a failed assignment.
  it('resolves without throwing when the dispatcher rejects', async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValue(new Error('automation exploded')) as AutomationDispatcher
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      dispatchConversationAssigned(base(), dispatch),
    ).resolves.toBe(true)

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('reports the attempt even when the dispatcher fails', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('boom')) as AutomationDispatcher
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await dispatchConversationAssigned(base(), dispatch)).toBe(true)
    spy.mockRestore()
  })
})
