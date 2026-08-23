import { describe, expect, it } from 'vitest'
import { clampInt, normaliseEmail, tidy } from '@/modules/abandoned-carts-for-shop/lib/types'

// The three functions every piece of shopper-typed input passes through on its
// way into the table. Tested here rather than through a route because that is
// where the mistakes would be: a length cap that lets a paste of half a page
// through, or an address that suppresses under one spelling and sends under
// another.

describe('tidy', () => {
  it('trims and treats blank as nothing', () => {
    expect(tidy('  Jo  ')).toBe('Jo')
    expect(tidy('   ')).toBeNull()
    expect(tidy('')).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    expect(tidy(42)).toBeNull()
    expect(tidy(null)).toBeNull()
    expect(tidy({ line1: 'somewhere' })).toBeNull()
  })

  it('caps the length, because a form field is not an upload slot', () => {
    expect(tidy('x'.repeat(1000))).toHaveLength(300)
  })
})

describe('normaliseEmail', () => {
  it('folds case, so somebody who unsubscribed stays unsubscribed', () => {
    expect(normaliseEmail('Jo@Example.COM')).toBe('jo@example.com')
  })

  it('treats a half-typed address as no address at all', () => {
    // A shopper is captured mid-keystroke, so "jo@" arrives routinely. Storing
    // it would mean a reminder run trying to send to it.
    expect(normaliseEmail('jo@')).toBeNull()
    expect(normaliseEmail('jo')).toBeNull()
    expect(normaliseEmail('jo@example')).toBeNull()
    expect(normaliseEmail('')).toBeNull()
  })
})

describe('clampInt', () => {
  it('holds a setting inside its range whatever arrives', () => {
    expect(clampInt(5000, 1, 365, 90)).toBe(365)
    expect(clampInt(0, 1, 365, 90)).toBe(1)
    expect(clampInt('30', 1, 365, 90)).toBe(30)
  })

  it('falls back rather than storing a nonsense retention', () => {
    expect(clampInt('later', 1, 365, 90)).toBe(90)
    expect(clampInt(undefined, 1, 365, 90)).toBe(90)
    expect(clampInt(Number.NaN, 1, 365, 90)).toBe(90)
  })
})
