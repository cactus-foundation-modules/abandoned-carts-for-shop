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
  /** This address has unsubscribed, so nothing will ever go to it again -
   *  whatever this basket says. Read alongside the row rather than looked up
   *  per basket, so the list can say so plainly instead of leaving an owner to
   *  wonder why the reminder never went. */
  suppressed: boolean
  /** The most recent attempt, sent or otherwise. Null when nothing has ever
   *  been tried on this basket. */
  lastReminder: ReminderLogEntry | null
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

// ---------------------------------------------------------------------------
// Reminders: what happened, and what is going to
// ---------------------------------------------------------------------------

/** 'SKIPPED' is a first-class outcome, not a non-event. A reminder that was
 *  deliberately not sent - unsubscribed, asked not to be, already ordered - is
 *  exactly what an owner otherwise reads as a broken feature. */
export type ReminderStatus = 'SENT' | 'FAILED' | 'SKIPPED'

/** Who set it off: the hourly job, or somebody pressing the button. */
export type ReminderTrigger = 'AUTOMATIC' | 'MANUAL'

/** One attempt, as the detail panel lists it. */
export type ReminderLogEntry = {
  id: string
  cartId: string
  email: string
  attempt: number
  status: ReminderStatus
  detail: string | null
  trigger: ReminderTrigger
  /** The admin who pressed Send, resolved to a name where core still has one. */
  sentBy: string | null
  sentByName: string | null
  subject: string | null
  itemCount: number
  subtotal: number
  createdAt: string
}

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  SENT: 'Sent',
  FAILED: 'Did not send',
  SKIPPED: 'Not sent on purpose',
}

/**
 * The Reminder column, worked out rather than stored.
 *
 * Structured rather than a finished sentence so the dates are formatted once,
 * in the browser, in the reader's own locale - and so this can be tested
 * without a clock or a DOM. `tone` picks the badge colour; everything else is
 * words.
 */
export type ReminderState = {
  tone: 'sent' | 'failed' | 'blocked' | 'due' | 'none'
  label: string
  /** When the thing in `label` happened, where it has already happened. */
  at: string | null
  detail: string | null
  /** When the next one is owed, where one is. */
  nextDueAt: string | null
}

export type ReminderRules = {
  emailsEnabled: boolean
  emailDelayMinutes: number
  emailMaxPerCart: number
}

/** Why this basket will never be emailed, or null if it could be. Split out
 *  because the answer is wanted twice: on a basket nothing has been sent for,
 *  and on one where something has, to say whether another is coming. */
export function reminderBlockedReason(cart: AbandonedCart): string | null {
  if (cart.recoveredAt) return 'They came back and ordered'
  if (!cart.customerEmail) return 'No email address was typed'
  if (cart.suppressed) return 'This address has unsubscribed'
  if (cart.marketingOptOut) return 'They asked not to be emailed'
  if (cart.itemCount < 1) return 'Nothing left in the basket'
  return null
}

/**
 * What the Reminder column says for one basket.
 *
 * Reads in the order an owner asks: did the last one fail, has anything gone at
 * all, and if not, what is standing in the way. A failure outranks a success
 * because it is the one that needs somebody, and both outrank "due in three
 * hours", which needs nobody.
 */
export function describeReminder(cart: AbandonedCart, rules: ReminderRules): ReminderState {
  const blocked = reminderBlockedReason(cart)
  const last = cart.lastReminder

  const dueAt = (): string | null => {
    if (blocked || !rules.emailsEnabled) return null
    if (cart.reminderCount >= rules.emailMaxPerCart) return null
    const from = new Date(cart.reminderSentAt ?? cart.updatedAt).getTime()
    if (!Number.isFinite(from)) return null
    return new Date(from + rules.emailDelayMinutes * 60000).toISOString()
  }

  if (last?.status === 'FAILED') {
    return { tone: 'failed', label: 'Did not send', at: last.createdAt, detail: last.detail, nextDueAt: dueAt() }
  }

  if (cart.reminderCount > 0 || last?.status === 'SENT') {
    const at = last?.status === 'SENT' ? last.createdAt : cart.reminderSentAt
    const next = dueAt()
    const parts: string[] = []
    if (cart.reminderCount > 1) parts.push(`${cart.reminderCount} sent in all`)
    if (last?.trigger === 'MANUAL') parts.push(last.sentByName ? `Sent by hand by ${last.sentByName}` : 'Sent by hand')
    if (!next && blocked) parts.push(blocked)
    return { tone: 'sent', label: 'Sent', at, detail: parts.join(' · ') || null, nextDueAt: next }
  }

  if (blocked) {
    // A basket that was already ordered is not a blocked reminder, it is a
    // finished job. Saying "blocked" about it would put a warning badge on the
    // one outcome everybody wanted.
    const tone = cart.recoveredAt ? 'none' : 'blocked'
    return { tone, label: cart.recoveredAt ? 'Not needed' : 'Will not be sent', at: null, detail: blocked, nextDueAt: null }
  }

  if (!rules.emailsEnabled) {
    return { tone: 'none', label: 'Not sent', at: null, detail: 'Reminder emails are switched off', nextDueAt: null }
  }

  if (last?.status === 'SKIPPED') {
    return { tone: 'none', label: 'Not sent', at: last.createdAt, detail: last.detail, nextDueAt: dueAt() }
  }

  return { tone: 'due', label: 'Due', at: null, detail: null, nextDueAt: dueAt() }
}

// ---------------------------------------------------------------------------
// The list controls
// ---------------------------------------------------------------------------

/** How the list is sorted. Value first is the one an owner reaches for when
 *  they have ten minutes and forty baskets. */
export type CartSort = 'recent' | 'oldest' | 'value-high' | 'value-low' | 'items-high'

export const CART_SORTS: CartSort[] = ['recent', 'oldest', 'value-high', 'value-low', 'items-high']

export const CART_SORT_LABELS: Record<CartSort, string> = {
  recent: 'Newest activity',
  oldest: 'Oldest activity',
  'value-high': 'Worth the most',
  'value-low': 'Worth the least',
  'items-high': 'Most items',
}

export type ContactFilter = '' | 'with-email' | 'without-email'
export type RemindedFilter = '' | 'yes' | 'no' | 'failed' | 'blocked'
export type PaymentFilter = '' | 'attempted' | 'failed'

/** Everything the list is filtered by, which is also exactly what goes in the
 *  query string - so a filtered list is a link somebody can send. */
export type CartQuery = {
  filter: CartFilter
  search: string
  contact: ContactFilter
  reminded: RemindedFilter
  payment: PaymentFilter
  minValue: string
  dateFrom: string
  dateTo: string
  sort: CartSort
  page: number
  perPage: number
}

export type CartFilter = 'all' | 'basket' | 'checkout' | 'recovered'

export const CART_FILTERS: CartFilter[] = ['all', 'basket', 'checkout', 'recovered']

export const CART_FILTER_LABELS: Record<CartFilter, string> = {
  all: 'Everything',
  basket: 'Basket only',
  checkout: 'Checkout started',
  recovered: 'Came back',
}

export const DEFAULT_CART_QUERY: CartQuery = {
  filter: 'all', search: '', contact: '', reminded: '', payment: '', minValue: '',
  dateFrom: '', dateTo: '', sort: 'recent', page: 1, perPage: 25,
}

export function cartQueryToParams(query: CartQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.filter !== 'all') params.set('filter', query.filter)
  if (query.search) params.set('search', query.search)
  if (query.contact) params.set('contact', query.contact)
  if (query.reminded) params.set('reminded', query.reminded)
  if (query.payment) params.set('payment', query.payment)
  if (query.minValue) params.set('minValue', query.minValue)
  if (query.dateFrom) params.set('dateFrom', query.dateFrom)
  if (query.dateTo) params.set('dateTo', query.dateTo)
  if (query.sort !== DEFAULT_CART_QUERY.sort) params.set('sort', query.sort)
  if (query.page > 1) params.set('page', String(query.page))
  if (query.perPage !== DEFAULT_CART_QUERY.perPage) params.set('perPage', String(query.perPage))
  return params
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function paramsToCartQuery(params: URLSearchParams): CartQuery {
  return {
    filter: oneOf(params.get('filter'), CART_FILTERS, 'all'),
    search: params.get('search') ?? '',
    contact: oneOf(params.get('contact'), ['', 'with-email', 'without-email'] as const, ''),
    reminded: oneOf(params.get('reminded'), ['', 'yes', 'no', 'failed', 'blocked'] as const, ''),
    payment: oneOf(params.get('payment'), ['', 'attempted', 'failed'] as const, ''),
    // The leading number and nothing else. Stripping non-digits instead turns
    // "1' OR '1" into "11", which is harmless where it lands (the query is
    // parameterised either way) and wrong on the screen, which is worse: a
    // filter that quietly means something other than what the address bar says
    // is how an owner comes to trust a list that is not showing what they
    // asked for. Kept as a string rather than a number so an owner half way
    // through typing "100" does not watch the list jump to everything over a
    // pound and back.
    minValue: (/^\d{1,9}(\.\d{1,2})?/.exec(params.get('minValue') ?? '') ?? [''])[0],
    dateFrom: (params.get('dateFrom') ?? '').slice(0, 10),
    dateTo: (params.get('dateTo') ?? '').slice(0, 10),
    sort: oneOf(params.get('sort'), CART_SORTS, 'recent'),
    page: clampInt(params.get('page'), 1, 10000, 1),
    perPage: clampInt(params.get('perPage'), 5, 200, 25),
  }
}

/** True when anything is narrowing the list, so the screen can offer to clear
 *  it rather than leaving an owner staring at an empty table wondering why. */
export function cartQueryIsFiltered(query: CartQuery): boolean {
  return Boolean(
    query.filter !== 'all' || query.search || query.contact || query.reminded ||
    query.payment || query.minValue || query.dateFrom || query.dateTo,
  )
}

// ---------------------------------------------------------------------------
// The figures above the list
// ---------------------------------------------------------------------------

/** The tiles, and the health line under them. Money is a plain number: this is
 *  an indication worked out from the catalogue, never an invoice. */
export type AbandonedCartsStats = {
  openCount: number
  openValue: number
  checkoutCount: number
  checkoutValue: number
  withEmailCount: number
  recoveredCount: number
  recoveredValue: number
  /** Of the baskets first seen in the last 30 days, the share that ended in an
   *  order. Null when there were none, because 0% of nothing is a lie. */
  recoveryRate: number | null
  remindersSent30d: number
  remindersFailed30d: number
  unsubscribedCount: number
  lastRun: JobRunSummary | null
}

export type JobRunSummary = {
  ranAt: string
  durationMs: number
  purged: number
  considered: number
  sent: number
  skipped: number
  failed: number
  error: string | null
}
