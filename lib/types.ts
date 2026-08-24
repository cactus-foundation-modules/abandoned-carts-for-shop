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

/** Shop announces the press of Place order on this one, and a checkout refusal
 *  on the other. Read for the same reason the storage keys above are: the shop's
 *  own checkout already says both out loud, so this module listens rather than
 *  asking the shop to grow anything. */
export const SHOP_PLACE_ORDER_EVENT = 'cactus-shop-place-order'
export const SHOP_ORDER_ERROR_EVENT = 'cactus-shop-order-error'

/**
 * The id of the checkout tickbox this module asks the shop to carry.
 *
 * The shop already lets an owner add their own tickboxes to the checkout, so
 * the permission box is one of those rather than anything new in the shop: this
 * module writes the entry into the shop's own settings when the owner switches
 * it on, and takes it out again when they switch it off. Prefixed so it is
 * obvious in the shop's tickbox list whose it is.
 */
export const OPTOUT_AGREEMENT_ID = 'abc-marketing-optout'

/** What the box says until the owner writes something better. Plain, negative,
 *  and ticked by the shopper who wants to be left alone - so a shopper who
 *  ignores it entirely is left exactly where they were. */
export const DEFAULT_OPTOUT_STATEMENT = "Don't email me about offers and similar products."

/** Nobody needs a paragraph beside a tickbox. */
export const MAX_STATEMENT_LENGTH = 200

/** One of the shop's checkout tickboxes, in the shape the shop stores them.
 *  Declared structurally rather than imported so this file stays free of
 *  imports and the browser half can read it. */
export type CheckoutTickbox = {
  id: string
  statement: string
  linkUrl: string
  required: boolean
  enabled: boolean
}

/**
 * The shop's tickbox list with this module's permission box put in, or taken
 * out. The list arrives as the owner has it and leaves in the same order, with
 * ours appended: the compulsory boxes are the ones holding the order up, and a
 * question about emails belongs under them rather than among them.
 *
 * Never required, whatever else is on the list. A permission box that refuses
 * the order is not a question, it is a toll.
 */
export function withOptOutBox(
  current: CheckoutTickbox[],
  options: { wanted: boolean; statement: string },
): CheckoutTickbox[] {
  const others = current.filter((box) => box.id !== OPTOUT_AGREEMENT_ID)
  if (!options.wanted) return others
  return [
    ...others,
    {
      id: OPTOUT_AGREEMENT_ID,
      statement: options.statement,
      linkUrl: '',
      required: false,
      enabled: true,
    },
  ]
}

/**
 * Whether a shopper is in a position to agree to this at all.
 *
 * 'category'    - the site's banner carries the marketing category, so nothing
 *                 is recorded until the shopper grants it.
 * 'unavailable' - the banner is switched off, or carries no marketing category,
 *                 so there is no question for a shopper to answer. Nothing is
 *                 recorded. Not "nothing to wait for, so go ahead": a shopper
 *                 who was never asked has not agreed, and this module holds
 *                 names, addresses and phone numbers belonging to people who
 *                 never placed an order. The settings panel tells the owner why
 *                 it is idle and what to switch on.
 *
 * This is where this module parts company with Google Tag and live chat, which
 * do run when a site has no banner. They can: a tag that fires or a chat widget
 * that loads is visible on the page and stops the moment the shopper says so.
 * A row holding somebody's address is neither.
 */
export type GateMode = 'category' | 'unavailable'

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
  /** Whether the checkout carries the "don't email me" box. */
  optOutBoxEnabled: boolean
  /** The owner's wording for it. */
  optOutStatement: string
}

/** Everything the browser half of the tracker needs, handed down as props. */
export type TrackerConfig = {
  gate: GateMode
  captureBaskets: boolean
}

export type CartStage = 'BASKET' | 'CHECKOUT'

/**
 * How far the payment got.
 *
 * 'ATTEMPTED' - Place order was pressed and nothing came back. Either the
 *               shopper was handed over to a bank or a hosted card page and
 *               never returned, or the tab went mid-payment.
 * 'FAILED'    - the checkout came back with a refusal. The wording is kept as
 *               the shopper was shown it.
 * null        - never got that far.
 *
 * Worth having because the methods this catches (Square, open banking) write no
 * order at all until the money is committed - by design - so a refused card
 * leaves no trace anywhere else on the site.
 */
export type PaymentStage = 'ATTEMPTED' | 'FAILED'

/** What the tracker reports about the payment. Absent means nothing new to say,
 *  which never clears what the row already holds. */
export type PaymentReport = {
  stage: PaymentStage
  reason?: string | null
}

/** Long enough for the sentence a checkout shows a shopper, short enough that a
 *  stack trace posted here is not stored. */
export const MAX_REASON_LENGTH = 300

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
  /** The shopper ticked the checkout box asking not to be emailed. No reminder
   *  goes out on this basket while it is true. */
  marketingOptOut: boolean
  paymentStage: PaymentStage | null
  paymentAttemptedAt: string | null
  paymentFailureReason: string | null
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

/** How the list says what became of the payment. Worded as what happened to the
 *  shopper, not as a status: "ATTEMPTED" means they were sent off to pay and
 *  never came back, which is a different missed sale from a refused card and is
 *  chased differently. */
export const PAYMENT_STAGE_LABELS: Record<PaymentStage, string> = {
  ATTEMPTED: 'Sent to pay, never came back',
  FAILED: 'Tried to pay, refused',
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
