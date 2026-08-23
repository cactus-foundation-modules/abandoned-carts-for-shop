// Shared shapes and constants. Deliberately free of imports, so the server half
// (settings, routes, the RSC block) and the browser half (the tracker, the admin
// screen, the settings panel) can both read it without dragging Prisma into a
// client bundle.

/**
 * The cookie category this module waits for.
 *
 * Core's own stock "marketing" category rather than one invented here. Keeping
 * an unfinished basket in order to chase it is marketing by any reading of it,
 * and a site that already has a cookie banner already has this switch - one
 * more category with a near-identical description helps nobody decide anything.
 */
export const MARKETING_CATEGORY = 'marketing'

/** Core announces every consent decision on this event. */
export const CONSENT_CHANGE_EVENT = 'cactus:consent-change'

/** Shop's own client-side storage, read by the tracker. Shop writes both; this
 *  module only ever reads them, and treats anything unexpected as nothing at
 *  all. See the note in components/public/CartTracker.tsx about why the tracker
 *  reads these rather than shop growing an extension point for it. */
export const SHOP_CART_KEY = 'cactus_shop_cart'
export const SHOP_CHECKOUT_KEY = 'cactus_shop_checkout'
export const SHOP_CART_EVENT = 'cactus-shop-cart-changed'
export const SHOP_CHECKOUT_EVENT = 'cactus-shop-checkout-changed'

/**
 * Whether there is a cookie switch to wait for at all.
 *
 * 'category' - the site's banner carries the marketing category, so nothing is
 *              recorded until the shopper grants it.
 * 'allowed'  - there is nothing to wait for, because the banner is switched off
 *              or does not offer this category. Capture runs, and the settings
 *              panel says so in plain words rather than leaving the owner to
 *              find out: it is their decision and their exposure. Same rule the
 *              Google Tag and live chat modules follow, for the same reason -
 *              silence is the one answer a module must never invent on an
 *              owner's behalf.
 */
export type GateMode = 'allowed' | 'category'

/** What the site's banner actually looks like right now, for the settings panel. */
export type BannerState = {
  bannerEnabled: boolean
  hasMarketingCategory: boolean
}

export type AbandonedCartsSettings = {
  enabled: boolean
  abandonAfterMinutes: number
  retentionDays: number
  captureBaskets: boolean
  emailsEnabled: boolean
  emailDelayMinutes: number
  emailMaxPerCart: number
}

/** Everything the browser half of the tracker needs, handed down as props. */
export type TrackerConfig = {
  gate: GateMode
  captureBaskets: boolean
}

export type CartStage = 'BASKET' | 'CHECKOUT'

/** One basket line, in exactly the shape shop's own client storage holds. */
export type CartLine = {
  productId: string
  quantity: number
  lineId?: string
  meta?: Record<string, unknown>
}

export type CapturedAddress = {
  firstName?: string
  lastName?: string
  company?: string
  line1?: string
  line2?: string
  city?: string
  county?: string
  postcode?: string
  country?: string
  phone?: string
}

/** A row as the admin list and detail panel read it. */
export type AbandonedCart = {
  id: string
  stage: CartStage
  lines: CartLine[]
  itemCount: number
  subtotal: number
  currency: string
  customerEmail: string | null
  customerName: string | null
  customerPhone: string | null
  shippingAddress: CapturedAddress | null
  couponCode: string | null
  shippingRateId: string | null
  paymentMethod: string | null
  consentBasis: string
  memberId: string | null
  firstSeenAt: string
  updatedAt: string
  checkoutStartedAt: string | null
  reminderCount: number
  reminderSentAt: string | null
  recoveredAt: string | null
  recoveredOrderNumber: string | null
}

/** A line with the catalogue's own words on it, for the detail panel. Resolved
 *  when a row is opened rather than stored, so a product renamed since the
 *  basket was left reads as it is now. */
export type ResolvedCartLine = CartLine & {
  name: string | null
  sku: string | null
  slug: string | null
  unitPrice: number | null
}

export const STAGE_LABELS: Record<CartStage, string> = {
  BASKET: 'Basket only',
  CHECKOUT: 'Checkout started',
}

/** Sanity bounds, applied on the way in from the browser and again on the way in
 *  from the settings form. A basket is a shopper's shopping, not an upload
 *  slot. */
export const MAX_LINES = 100
export const MAX_FIELD_LENGTH = 300

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Trimmed, length-capped, and empty means null. Everything a shopper typed
 *  arrives through this. */
export function tidy(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, MAX_FIELD_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

/** Addresses are compared and suppressed case-insensitively, because a shopper
 *  who unsubscribed as Jo@example.com has unsubscribed jo@example.com. */
export function normaliseEmail(value: unknown): string | null {
  const tidied = tidy(value)
  if (!tidied) return null
  const lower = tidied.toLowerCase()
  return /^\S+@\S+\.\S+$/.test(lower) ? lower : null
}
