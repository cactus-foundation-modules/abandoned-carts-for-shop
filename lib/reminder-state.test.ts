import { describe, expect, it } from 'vitest'
import {
  cartQueryIsFiltered,
  cartQueryToParams,
  DEFAULT_CART_QUERY,
  describeReminder,
  paramsToCartQuery,
  reminderBlockedReason,
  type AbandonedCart,
  type ReminderLogEntry,
  type ReminderRules,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// The Reminder column, and the filters that drive the list.
//
// Tested here rather than through the screen because this is the half that can
// be wrong without looking wrong: a basket that says "sent" when nothing went,
// or "due in 4 hours" for somebody who unsubscribed last week, is a screen an
// owner will believe.

const RULES: ReminderRules = { emailsEnabled: true, emailDelayMinutes: 240, emailMaxPerCart: 2 }

function cart(patch: Partial<AbandonedCart> = {}): AbandonedCart {
  return {
    id: 'c1',
    stage: 'CHECKOUT',
    lines: [],
    itemCount: 3,
    subtotal: 120,
    currency: 'GBP',
    customerEmail: 'jo@example.com',
    customerName: 'Jo Bloggs',
    customerPhone: null,
    shippingAddress: null,
    couponCode: null,
    shippingRateId: null,
    paymentMethod: null,
    consentBasis: 'marketing',
    memberId: null,
    firstSeenAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    checkoutStartedAt: '2026-08-01T09:30:00.000Z',
    marketingOptOut: false,
    paymentStage: null,
    paymentAttemptedAt: null,
    paymentFailureReason: null,
    reminderCount: 0,
    reminderSentAt: null,
    recoveredAt: null,
    recoveredOrderNumber: null,
    suppressed: false,
    lastReminder: null,
    ...patch,
  }
}

function log(patch: Partial<ReminderLogEntry> = {}): ReminderLogEntry {
  return {
    id: 'l1',
    cartId: 'c1',
    email: 'jo@example.com',
    attempt: 1,
    status: 'SENT',
    detail: null,
    trigger: 'AUTOMATIC',
    sentBy: null,
    sentByName: null,
    subject: 'You left something behind',
    itemCount: 3,
    subtotal: 120,
    createdAt: '2026-08-01T14:00:00.000Z',
    ...patch,
  }
}

describe('reminderBlockedReason', () => {
  it('lets an ordinary basket with an address through', () => {
    expect(reminderBlockedReason(cart())).toBeNull()
  })

  it('stops on an unsubscribe, a ticked box, no address, and an empty basket', () => {
    expect(reminderBlockedReason(cart({ suppressed: true }))).toMatch(/unsubscribed/i)
    expect(reminderBlockedReason(cart({ marketingOptOut: true }))).toMatch(/not to be emailed/i)
    expect(reminderBlockedReason(cart({ customerEmail: null }))).toMatch(/no email/i)
    expect(reminderBlockedReason(cart({ itemCount: 0 }))).toMatch(/nothing left/i)
  })

  // The one that matters most: chasing somebody for a basket they have paid for
  // is the single mistake this module must not make.
  it('stops on a basket that turned into an order', () => {
    expect(reminderBlockedReason(cart({ recoveredAt: '2026-08-02T09:00:00.000Z' }))).toMatch(/came back/i)
  })
})

describe('describeReminder', () => {
  it('says when one was sent, and when the next is owed', () => {
    const state = describeReminder(
      cart({ reminderCount: 1, reminderSentAt: '2026-08-01T14:00:00.000Z', lastReminder: log() }),
      RULES,
    )
    expect(state.tone).toBe('sent')
    expect(state.at).toBe('2026-08-01T14:00:00.000Z')
    // Four hours after the one that went, not after the basket was last touched.
    expect(state.nextDueAt).toBe('2026-08-01T18:00:00.000Z')
  })

  it('names who sent one by hand', () => {
    const state = describeReminder(
      cart({ reminderCount: 1, lastReminder: log({ trigger: 'MANUAL', sentByName: 'Chris' }) }),
      RULES,
    )
    expect(state.detail).toMatch(/by hand by Chris/)
  })

  it('leads with a failure, and keeps the reason', () => {
    const state = describeReminder(
      cart({ lastReminder: log({ status: 'FAILED', detail: 'This site has no email provider set up yet' }) }),
      RULES,
    )
    expect(state.tone).toBe('failed')
    expect(state.detail).toMatch(/no email provider/)
  })

  it('never promises another to somebody who has unsubscribed', () => {
    const state = describeReminder(
      cart({ suppressed: true, reminderCount: 1, lastReminder: log() }),
      RULES,
    )
    expect(state.nextDueAt).toBeNull()
    expect(state.detail).toMatch(/unsubscribed/i)
  })

  it('stops promising once the allowance is used up', () => {
    const state = describeReminder(
      cart({ reminderCount: 2, reminderSentAt: '2026-08-01T14:00:00.000Z', lastReminder: log({ attempt: 2 }) }),
      RULES,
    )
    expect(state.nextDueAt).toBeNull()
    expect(state.detail).toMatch(/2 sent in all/)
  })

  it('does not badge a basket that came back as a problem', () => {
    const state = describeReminder(cart({ recoveredAt: '2026-08-02T09:00:00.000Z' }), RULES)
    expect(state.tone).toBe('none')
    expect(state.label).toBe('Not needed')
  })

  it('says the emails are off rather than inventing a due date', () => {
    const state = describeReminder(cart(), { ...RULES, emailsEnabled: false })
    expect(state.nextDueAt).toBeNull()
    expect(state.detail).toMatch(/switched off/i)
  })

  it('counts the delay from when the basket was last touched, before anything has gone', () => {
    const state = describeReminder(cart(), RULES)
    expect(state.tone).toBe('due')
    expect(state.nextDueAt).toBe('2026-08-01T14:00:00.000Z')
  })
})

describe('the list query', () => {
  it('survives a round trip through the address bar', () => {
    const query = {
      ...DEFAULT_CART_QUERY,
      filter: 'checkout' as const,
      search: 'jo@example.com',
      contact: 'with-email' as const,
      reminded: 'failed' as const,
      payment: 'failed' as const,
      minValue: '250',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-24',
      sort: 'value-high' as const,
      page: 3,
      perPage: 50,
    }
    expect(paramsToCartQuery(cartQueryToParams(query))).toEqual(query)
  })

  it('writes nothing for the defaults, so a plain list has a plain address', () => {
    expect(cartQueryToParams(DEFAULT_CART_QUERY).toString()).toBe('')
    expect(cartQueryIsFiltered(DEFAULT_CART_QUERY)).toBe(false)
  })

  it('refuses anything it does not recognise rather than passing it to SQL', () => {
    const params = new URLSearchParams({
      filter: 'everything', sort: 'price DESC; DROP TABLE', reminded: 'maybe',
      minValue: "1' OR '1", page: '-4', perPage: '99999',
    })
    const query = paramsToCartQuery(params)
    expect(query.filter).toBe('all')
    expect(query.sort).toBe('recent')
    expect(query.reminded).toBe('')
    expect(query.minValue).toBe('1')
    expect(query.page).toBe(1)
    expect(query.perPage).toBe(200)
  })
})
