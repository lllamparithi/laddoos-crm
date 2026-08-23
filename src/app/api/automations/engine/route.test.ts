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

function req(body: unknown) {
  return new Request('http://test/api/automations/engine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ accountId: 'account-1' })
  mocks.runAutomations.mockResolvedValue(undefined)
})

describe('POST /api/automations/engine', () => {
  // The forgery path this closes: this route takes trigger/contact/context
  // verbatim, so allowing conversation_assigned here would let an agent
  // fire real automation actions with no assignment behind them.
  it('refuses to fire conversation_assigned', async () => {
    const res = await POST(req({ trigger_type: 'conversation_assigned' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('/api/conversations/')
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })

  it('refuses even with a plausible contact and context attached', async () => {
    const res = await POST(
      req({
        trigger_type: 'conversation_assigned',
        contact_id: 'contact-1',
        context: { conversation_id: 'conv-1', agent_id: 'agent-1' },
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })

  // Existing supported use cases must keep working.
  it('still fires other trigger types', async () => {
    const res = await POST(
      req({ trigger_type: 'new_contact_created', contact_id: 'contact-1' }),
    )
    expect(res.status).toBe(200)
    expect(mocks.runAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        triggerType: 'new_contact_created',
        contactId: 'contact-1',
      }),
    )
  })

  it('still requires trigger_type', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect(mocks.runAutomations).not.toHaveBeenCalled()
  })
})
