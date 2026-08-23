import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  normaliseEmail,
  type AbandonedCart,
  type CapturedAddress,
  type CartLine,
  type CartStage,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// Every read and write of this module's own tables. Raw SQL throughout, like
// every other module: these tables are this module's, not Prisma's, and the
// generated client has never heard of them.

type Row = Record<string, unknown>

function asNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value) return value
  return null
}

function asLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return []
  return value.filter((line): line is CartLine => {
    if (!line || typeof line !== 'object') return false
    const candidate = line as { productId?: unknown; quantity?: unknown }
    return typeof candidate.productId === 'string' && Number.isFinite(Number(candidate.quantity))
  })
}

function mapCart(row: Row): AbandonedCart {
  return {
    id: row.id as string,
    stage: (row.stage as CartStage) ?? 'BASKET',
    lines: asLines(row.lines),
    itemCount: asNumber(row.item_count),
    // NUMERIC arrives as a Prisma.Decimal; the admin screen wants a plain
    // number it can add up and format.
    subtotal: asNumber(row.subtotal),
    currency: (row.currency as string) ?? 'GBP',
    customerEmail: (row.customer_email as string) ?? null,
    customerName: (row.customer_name as string) ?? null,
    customerPhone: (row.customer_phone as string) ?? null,
    shippingAddress: (row.shipping_address as CapturedAddress) ?? null,
    couponCode: (row.coupon_code as string) ?? null,
    shippingRateId: (row.shipping_rate_id as string) ?? null,
    paymentMethod: (row.payment_method as string) ?? null,
    consentBasis: (row.consent_basis as string) ?? 'none',
    memberId: (row.member_id as string) ?? null,
    firstSeenAt: asIso(row.first_seen_at) ?? '',
    updatedAt: asIso(row.updated_at) ?? '',
    checkoutStartedAt: asIso(row.checkout_started_at),
    reminderCount: asNumber(row.reminder_count),
    reminderSentAt: asIso(row.reminder_sent_at),
    recoveredAt: asIso(row.recovered_at),
    recoveredOrderNumber: (row.recovered_order_number as string) ?? null,
  }
}

const COLUMNS = Prisma.sql`
  "id", "stage", "lines", "item_count", "subtotal", "currency",
  "customer_email", "customer_name", "customer_phone", "shipping_address",
  "coupon_code", "shipping_rate_id", "payment_method", "consent_basis",
  "member_id", "first_seen_at", "updated_at", "checkout_started_at",
  "reminder_count", "reminder_sent_at", "recovered_at", "recovered_order_number"
`

export type CaptureInput = {
  visitorId: string
  memberId: string | null
  stage: CartStage
  lines: CartLine[]
  itemCount: number
  subtotal: number
  currency: string
  consentBasis: string
  customerEmail: string | null
  customerName: string | null
  customerPhone: string | null
  shippingAddress: CapturedAddress | null
  couponCode: string | null
  shippingRateId: string | null
  paymentMethod: string | null
}

/**
 * Write what this browser is holding right now.
 *
 * COALESCE on every typed field, deliberately: the tracker sends whatever the
 * checkout boxes contain at that moment, and a shopper who steps back to the
 * basket page has a checkout that reads as empty for a moment. Losing the email
 * they typed two minutes ago because of a page they walked past is exactly the
 * detail this module exists to keep.
 *
 * The stage only ever climbs. A basket that reached the checkout is a checkout
 * abandonment for good, even if the last thing the shopper did was go back for
 * one more thing.
 */
export async function captureCart(input: CaptureInput): Promise<void> {
  const checkoutStarted = input.stage === 'CHECKOUT'
  await prisma.$executeRaw`
    INSERT INTO "abc_carts" (
      "visitor_id", "member_id", "stage", "lines", "item_count", "subtotal", "currency",
      "customer_email", "customer_name", "customer_phone", "shipping_address",
      "coupon_code", "shipping_rate_id", "payment_method", "consent_basis",
      "checkout_started_at", "updated_at"
    ) VALUES (
      ${input.visitorId}, ${input.memberId}, ${input.stage},
      ${JSON.stringify(input.lines)}::jsonb, ${input.itemCount}, ${input.subtotal.toFixed(2)}::numeric, ${input.currency},
      ${input.customerEmail}, ${input.customerName}, ${input.customerPhone},
      ${input.shippingAddress ? JSON.stringify(input.shippingAddress) : null}::jsonb,
      ${input.couponCode}, ${input.shippingRateId}, ${input.paymentMethod}, ${input.consentBasis},
      ${checkoutStarted ? new Date() : null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("visitor_id") WHERE "recovered_at" IS NULL DO UPDATE SET
      "member_id" = COALESCE(EXCLUDED."member_id", "abc_carts"."member_id"),
      "stage" = CASE WHEN "abc_carts"."stage" = 'CHECKOUT' THEN 'CHECKOUT' ELSE EXCLUDED."stage" END,
      "lines" = EXCLUDED."lines",
      "item_count" = EXCLUDED."item_count",
      "subtotal" = EXCLUDED."subtotal",
      "currency" = EXCLUDED."currency",
      "customer_email" = COALESCE(EXCLUDED."customer_email", "abc_carts"."customer_email"),
      "customer_name" = COALESCE(EXCLUDED."customer_name", "abc_carts"."customer_name"),
      "customer_phone" = COALESCE(EXCLUDED."customer_phone", "abc_carts"."customer_phone"),
      "shipping_address" = COALESCE(EXCLUDED."shipping_address", "abc_carts"."shipping_address"),
      "coupon_code" = COALESCE(EXCLUDED."coupon_code", "abc_carts"."coupon_code"),
      "shipping_rate_id" = COALESCE(EXCLUDED."shipping_rate_id", "abc_carts"."shipping_rate_id"),
      "payment_method" = COALESCE(EXCLUDED."payment_method", "abc_carts"."payment_method"),
      "consent_basis" = EXCLUDED."consent_basis",
      "checkout_started_at" = COALESCE("abc_carts"."checkout_started_at", EXCLUDED."checkout_started_at"),
      "updated_at" = CURRENT_TIMESTAMP
  `
}

/** An emptied basket is not an abandoned one. Called when the tracker reports no
 *  lines left, so a shopper who cleared their basket stops being chased for it. */
export async function deleteOpenCart(visitorId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "abc_carts" WHERE "visitor_id" = ${visitorId} AND "recovered_at" IS NULL`
}

/** Everything this browser has ever left here. Called when consent is withdrawn,
 *  where "everything" is the only honest reading of withdrawing it. */
export async function forgetVisitor(visitorId: string): Promise<number> {
  return prisma.$executeRaw`DELETE FROM "abc_carts" WHERE "visitor_id" = ${visitorId}`
}

/**
 * An order was placed from this browser. The open row closes and keeps the order
 * number, which is what turns the admin list from a pile of missed sales into a
 * measure of how many came back.
 */
export async function markRecovered(visitorId: string, orderNumber: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "abc_carts"
    SET "recovered_at" = CURRENT_TIMESTAMP, "recovered_order_number" = ${orderNumber}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "visitor_id" = ${visitorId} AND "recovered_at" IS NULL
  `
}

/** The same, by address rather than by browser: somebody who came back on their
 *  phone and ordered has still recovered the basket they left on the laptop. */
export async function markRecoveredByEmail(email: string, orderNumber: string | null): Promise<void> {
  const address = normaliseEmail(email)
  if (!address) return
  await prisma.$executeRaw`
    UPDATE "abc_carts"
    SET "recovered_at" = CURRENT_TIMESTAMP, "recovered_order_number" = ${orderNumber}, "updated_at" = CURRENT_TIMESTAMP
    WHERE LOWER("customer_email") = ${address} AND "recovered_at" IS NULL
  `
}

export type CartFilter = 'all' | 'basket' | 'checkout' | 'recovered'

function filterClause(filter: CartFilter): Prisma.Sql {
  switch (filter) {
    case 'basket':
      return Prisma.sql`"recovered_at" IS NULL AND "stage" = 'BASKET'`
    case 'checkout':
      return Prisma.sql`"recovered_at" IS NULL AND "stage" = 'CHECKOUT'`
    case 'recovered':
      return Prisma.sql`"recovered_at" IS NOT NULL`
    default:
      return Prisma.sql`TRUE`
  }
}

export async function listCarts(opts: {
  filter: CartFilter
  search: string
  page: number
  perPage: number
}): Promise<{ carts: AbandonedCart[]; total: number }> {
  const where = filterClause(opts.filter)
  const search = opts.search.trim().toLowerCase()
  const searchClause = search
    ? Prisma.sql`AND (LOWER(COALESCE("customer_email", '')) LIKE ${`%${search}%`}
        OR LOWER(COALESCE("customer_name", '')) LIKE ${`%${search}%`}
        OR LOWER(COALESCE("customer_phone", '')) LIKE ${`%${search}%`}
        OR LOWER(COALESCE("recovered_order_number", '')) LIKE ${`%${search}%`})`
    : Prisma.empty

  const offset = Math.max(0, (opts.page - 1) * opts.perPage)
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT ${COLUMNS} FROM "abc_carts"
    WHERE ${where} ${searchClause}
    ORDER BY "updated_at" DESC
    LIMIT ${opts.perPage} OFFSET ${offset}
  `
  const counted = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "abc_carts" WHERE ${where} ${searchClause}
  `
  return { carts: rows.map(mapCart), total: Number(counted[0]?.count ?? 0) }
}

/** The four numbers on the strip above the list. One query, because three
 *  separate counts that disagree with each other is worse than none. */
export async function countCarts(): Promise<Record<CartFilter, number>> {
  const rows = await prisma.$queryRaw<Array<{ stage: string; recovered: boolean; count: bigint }>>`
    SELECT "stage", ("recovered_at" IS NOT NULL) AS recovered, COUNT(*)::bigint AS count
    FROM "abc_carts" GROUP BY "stage", ("recovered_at" IS NOT NULL)
  `
  const counts: Record<CartFilter, number> = { all: 0, basket: 0, checkout: 0, recovered: 0 }
  for (const row of rows) {
    const n = Number(row.count)
    counts.all += n
    if (row.recovered) counts.recovered += n
    else if (row.stage === 'CHECKOUT') counts.checkout += n
    else counts.basket += n
  }
  return counts
}

export async function getCart(id: string): Promise<AbandonedCart | null> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT ${COLUMNS} FROM "abc_carts" WHERE "id" = ${id} LIMIT 1`
  return rows[0] ? mapCart(rows[0]) : null
}

export async function deleteCart(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "abc_carts" WHERE "id" = ${id}`
}

export async function listCartsForMember(memberId: string): Promise<AbandonedCart[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT ${COLUMNS} FROM "abc_carts" WHERE "member_id" = ${memberId} ORDER BY "updated_at" DESC
  `
  return rows.map(mapCart)
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export type ReminderCandidate = AbandonedCart & { unsubscribeToken: string }

/**
 * Baskets a reminder is owed on: left alone for longer than the delay, with an
 * address on them, not already reminded as often as the owner allows, and not
 * belonging to somebody who has asked us to stop.
 *
 * The suppression check is a NOT EXISTS rather than a filter applied afterwards,
 * so a list capped at 200 can never come back full of rows that will all be
 * dropped, leaving a genuinely due basket unsent for another hour.
 */
export async function listDueReminders(opts: {
  olderThan: Date
  maxPerCart: number
  limit: number
}): Promise<ReminderCandidate[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT ${COLUMNS}, "unsubscribe_token" FROM "abc_carts"
    WHERE "recovered_at" IS NULL
      AND "customer_email" IS NOT NULL
      AND "item_count" > 0
      AND "updated_at" < ${opts.olderThan}
      AND "reminder_count" < ${opts.maxPerCart}
      AND ("reminder_sent_at" IS NULL OR "reminder_sent_at" < ${opts.olderThan})
      AND NOT EXISTS (
        SELECT 1 FROM "abc_suppressions" s WHERE s."email" = LOWER("abc_carts"."customer_email")
      )
    ORDER BY "updated_at" ASC
    LIMIT ${opts.limit}
  `
  return rows.map((row) => ({ ...mapCart(row), unsubscribeToken: row.unsubscribe_token as string }))
}

export async function recordReminderSent(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "abc_carts"
    SET "reminder_count" = "reminder_count" + 1, "reminder_sent_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
}

/** The row an unsubscribe link names, if it still exists. Only the address is
 *  wanted; the link is not a way to read anybody's basket back. */
export async function findByUnsubscribeToken(token: string): Promise<{ email: string | null } | null> {
  const rows = await prisma.$queryRaw<Array<{ customer_email: string | null }>>`
    SELECT "customer_email" FROM "abc_carts" WHERE "unsubscribe_token" = ${token} LIMIT 1
  `
  return rows[0] ? { email: rows[0].customer_email } : null
}

export async function suppressEmail(email: string): Promise<void> {
  const address = normaliseEmail(email)
  if (!address) return
  await prisma.$executeRaw`
    INSERT INTO "abc_suppressions" ("email") VALUES (${address}) ON CONFLICT ("email") DO NOTHING
  `
}

export async function isSuppressed(email: string): Promise<boolean> {
  const address = normaliseEmail(email)
  if (!address) return false
  const rows = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT "email" FROM "abc_suppressions" WHERE "email" = ${address} LIMIT 1
  `
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Deletes everything older than the owner's retention setting, recovered rows
 *  included. Runs on the same hourly job as the reminders, so the purge cannot
 *  be forgotten by an owner who never switched the emails on. */
export async function purgeOlderThan(cutoff: Date): Promise<number> {
  return prisma.$executeRaw`DELETE FROM "abc_carts" WHERE "updated_at" < ${cutoff}`
}
