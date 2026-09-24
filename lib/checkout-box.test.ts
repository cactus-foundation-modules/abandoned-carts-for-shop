import { describe, expect, it } from 'vitest'
import { shouldOfferOptOutBox } from '@/modules/abandoned-carts-for-shop/lib/checkout-box'
import type { AbandonedCartsSettings } from '@/modules/abandoned-carts-for-shop/lib/types'

// Whether the tickbox belongs in somebody's checkout.
//
// Two lines of predicate, and the only thing standing between a shopper and a
// permission question about emails that are not being sent - or, worse, no
// question at all on a site that wanted one. The reminders deliberately do not
// come into it: an owner may ask for months before they send anything, and the
// answers count from the day they start.

function settings(over: Partial<AbandonedCartsSettings> = {}): AbandonedCartsSettings {
  return {
    enabled: true,
    abandonAfterMinutes: 60,
    retentionDays: 90,
    captureBaskets: true,
    emailsEnabled: true,
    emailDelayMinutes: 240,
    emailMaxPerCart: 1,
    optOutBoxEnabled: true,
    optOutStatement: 'No thanks.',
    ...over,
  }
}

describe('shouldOfferOptOutBox', () => {
  it('offers the box when the module and the box are both on', () => {
    expect(shouldOfferOptOutBox(settings())).toBe(true)
  })

  it('offers the box with the reminders switched off', () => {
    expect(shouldOfferOptOutBox(settings({ emailsEnabled: false }))).toBe(true)
  })

  it('keeps the box out when the box itself is off', () => {
    expect(shouldOfferOptOutBox(settings({ optOutBoxEnabled: false }))).toBe(false)
    expect(shouldOfferOptOutBox(settings({ optOutBoxEnabled: false, emailsEnabled: false }))).toBe(false)
  })

  it('keeps the box out when the module is off, however the rest is set', () => {
    expect(shouldOfferOptOutBox(settings({ enabled: false }))).toBe(false)
    expect(shouldOfferOptOutBox(settings({ enabled: false, emailsEnabled: false }))).toBe(false)
  })
})
