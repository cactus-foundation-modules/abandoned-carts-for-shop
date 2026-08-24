import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  normaliseEmail,
  type AbandonedCart,
  type AbandonedCartsStats,
  type CapturedAddress,
  type CartFilter,
  type CartLine,
  type CartQuery,
  type CartStage,
  type JobRunSummary,
  type PaymentStage,
  type ReminderLogEntry,
  type ReminderStatus,
  type ReminderTrigger,
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
    marketingOptOut: row.marketing_opt_out === true,
    paymentStage: (row.payment_stage as PaymentStage) ?? null,
    paymentAttemptedAt: asIso(row.payment_attempted_at),
    paymentFailureReason: (row.payment_failure_reason as string) ?? null,
    memberId: (row.member_id as string) ?? null,
    firstSeenAt: asIso(row.first_seen_at) ?? '',
    updatedAt: asIso(row.updated_at) ?? '',
    checkoutStartedAt: asIso(row.checkout_started_at),
    reminderCount: asNumber(row.reminder_count),
    reminderSentAt: asIso(row.reminder_sent_at),
    recoveredAt: asIso(row.recovered_at),
    recoveredOrderNumber: (row.recovered_order_number as string) ?? null,
    // Both arrive from the list query's own joins rather than a second round
    // trip per row; a list of 200 baskets asking two questions each is how a
    // screen that reads fine on a quiet shop falls over on a busy one.
    suppressed: row.suppressed === true,
    lastReminder: row.last_reminder_id ? mapLogRow({
      id: row.last_reminder_id,
      cart_id: row.id,
      email: row.last_reminder_email,
      attempt: row.last_reminder_attempt,
      status: row.last_reminder_status,
      detail: row.last_reminder_detail,
      trigger: row.last_reminder_trigger,
      sent_by: row.last_reminder_sent_by,
      sent_by_name: row.last_reminder_sent_by_name,
      subject: row.last_reminder_subject,
      item_count: row.last_reminder_item_count,
      subtotal: row.last_reminder_subtotal,
      created_at: row.last_reminder_created_at,
    }) : null,
  }
}

function mapLogRow(row: Row): ReminderLogEntry {
  return {
    id: row.id as string,
    cartId: row.cart_id as string,
    email: (row.email as string) ?? '',
    attempt: asNumber(row.attempt),
    status: (row.status as ReminderStatus) ?? 'SENT',
    detail: (row.detail as string) ?? null,
    trigger: (row.trigger as ReminderTrigger) ?? 'AUTOMATIC',
    sentBy: (row.sent_by as string) ?? null,
    sentByName: (row.sent_by_name as string) ?? null,
    subject: (row.subject as string) ?? null,
    itemCount: asNumber(row.item_count),
    subtotal: asNumber(row.subtotal),
    createdAt: asIso(row.created_at) ?? '',
  }
}

const COLUMNS = Prisma.sql`
  "id", "stage", "lines", "item_count", "subtotal", "currency",
  "customer_email", "customer_name", "customer_phone", "shipping_address",
  "coupon_code", "shipping_rate_id", "payment_method", "consent_basis",
  "marketing_opt_out", "payment_stage", "payment_attempted_at", "payment_failure_reason",
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
  /** The permission box in the checkout: true ticked, false unticked, null no
   *  box or no answer. Null leaves whatever the row already says alone - see
   *  captureCart. */
  marketingOptOut: boolean | null
  /** How far the payment got, where anything has happened to it. Null means
   *  nothing new to say, and never clears what the row already holds. */
  paymentStage: PaymentStage | null
  paymentFailureReason: string | null
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
      "marketing_opt_out", "payment_stage", "payment_attempted_at", "payment_failure_reason",
      "checkout_started_at", "updated_at"
    ) VALUES (
      ${input.visitorId}, ${input.memberId}, ${input.stage},
      ${JSON.stringify(input.lines)}::jsonb, ${input.itemCount}, ${input.subtotal.toFixed(2)}::numeric, ${input.currency},
      ${input.customerEmail}, ${input.customerName}, ${input.customerPhone},
      ${input.shippingAddress ? JSON.stringify(input.shippingAddress) : null}::jsonb,
      ${input.couponCode}, ${input.shippingRateId}, ${input.paymentMethod}, ${input.consentBasis},
      ${input.marketingOptOut ?? false},
      ${input.paymentStage}, ${input.paymentStage ? new Date() : null}, ${input.paymentFailureReason},
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
      -- Not a COALESCE like the typed fields above: an unticked box is a real
      -- answer and has to be able to undo a ticked one. It is the ABSENCE of a
      -- box, or of any answer to it, that leaves the row as it was.
      "marketing_opt_out" = CASE WHEN ${input.marketingOptOut !== null}
        THEN EXCLUDED."marketing_opt_out" ELSE "abc_carts"."marketing_opt_out" END,
      -- The payment's own story only ever moves when something has happened to
      -- it. An ordinary basket update says nothing about it and must not wipe a
      -- refusal recorded ten seconds ago; a fresh attempt after a refusal is
      -- the shopper trying again, and replaces it.
      "payment_stage" = COALESCE(EXCLUDED."payment_stage", "abc_carts"."payment_stage"),
      "payment_attempted_at" = CASE WHEN EXCLUDED."payment_stage" IS NULL
        THEN "abc_carts"."payment_attempted_at" ELSE EXCLUDED."payment_attempted_at" END,
      "payment_failure_reason" = CASE WHEN EXCLUDED."payment_stage" IS NULL
        THEN "abc_carts"."payment_failure_reason" ELSE EXCLUDED."payment_failure_reason" END,
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

function filterClause(filter: CartFilter): Prisma.Sql {
  switch (filter) {
    case 'basket':
      return Prisma.sql`c."recovered_at" IS NULL AND c."stage" = 'BASKET'`
    case 'checkout':
      return Prisma.sql`c."recovered_at" IS NULL AND c."stage" = 'CHECKOUT'`
    case 'recovered':
      return Prisma.sql`c."recovered_at" IS NOT NULL`
    default:
      return Prisma.sql`TRUE`
  }
}

/**
 * The last attempt on each basket, and whether the address has unsubscribed.
 *
 * A LATERAL rather than a GROUP BY: this wants the whole newest row, not an
 * aggregate of it, and a lateral limited to one is the only form that says so
 * without a window function over every attempt the shop has ever made.
 */
const LAST_REMINDER_JOIN = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT l."id" AS last_reminder_id, l."email" AS last_reminder_email,
           l."attempt" AS last_reminder_attempt, l."status" AS last_reminder_status,
           l."detail" AS last_reminder_detail, l."trigger" AS last_reminder_trigger,
           l."sent_by" AS last_reminder_sent_by, l."subject" AS last_reminder_subject,
           l."item_count" AS last_reminder_item_count, l."subtotal" AS last_reminder_subtotal,
           l."created_at" AS last_reminder_created_at,
           u."displayName" AS last_reminder_sent_by_name
    FROM "abc_reminder_log" l
    LEFT JOIN "User" u ON u."id" = l."sent_by"
    WHERE l."cart_id" = c."id"
    ORDER BY l."created_at" DESC
    LIMIT 1
  ) lr ON TRUE
  LEFT JOIN LATERAL (
    SELECT TRUE AS suppressed FROM "abc_suppressions" s
    WHERE c."customer_email" IS NOT NULL AND s."email" = LOWER(c."customer_email")
    LIMIT 1
  ) sup ON TRUE
`

const LIST_COLUMNS = Prisma.sql`
  c."id", c."stage", c."lines", c."item_count", c."subtotal", c."currency",
  c."customer_email", c."customer_name", c."customer_phone", c."shipping_address",
  c."coupon_code", c."shipping_rate_id", c."payment_method", c."consent_basis",
  c."marketing_opt_out", c."payment_stage", c."payment_attempted_at", c."payment_failure_reason",
  c."member_id", c."first_seen_at", c."updated_at", c."checkout_started_at",
  c."reminder_count", c."reminder_sent_at", c."recovered_at", c."recovered_order_number",
  COALESCE(sup.suppressed, FALSE) AS "suppressed",
  lr.last_reminder_id, lr.last_reminder_email, lr.last_reminder_attempt, lr.last_reminder_status,
  lr.last_reminder_detail, lr.last_reminder_trigger, lr.last_reminder_sent_by,
  lr.last_reminder_sent_by_name, lr.last_reminder_subject, lr.last_reminder_item_count,
  lr.last_reminder_subtotal, lr.last_reminder_created_at
`

/** Everything narrowing the list, as one WHERE fragment. Built once and used by
 *  the list, the count and the export, so a download can never quietly contain
 *  a different set of baskets from the screen that asked for it. */
function whereClause(query: Pick<CartQuery, 'filter' | 'search' | 'contact' | 'reminded' | 'payment' | 'minValue' | 'dateFrom' | 'dateTo'>): Prisma.Sql {
  const parts: Prisma.Sql[] = [filterClause(query.filter)]

  const search = query.search.trim().toLowerCase()
  if (search) {
    const like = `%${search}%`
    parts.push(Prisma.sql`(LOWER(COALESCE(c."customer_email", '')) LIKE ${like}
      OR LOWER(COALESCE(c."customer_name", '')) LIKE ${like}
      OR LOWER(COALESCE(c."customer_phone", '')) LIKE ${like}
      OR LOWER(COALESCE(c."coupon_code", '')) LIKE ${like}
      OR LOWER(COALESCE(c."recovered_order_number", '')) LIKE ${like}
      OR LOWER(COALESCE(c."shipping_address"->>'postcode', '')) LIKE ${like}
      OR LOWER(COALESCE(c."shipping_address"->>'company', '')) LIKE ${like})`)
  }

  if (query.contact === 'with-email') parts.push(Prisma.sql`c."customer_email" IS NOT NULL`)
  if (query.contact === 'without-email') parts.push(Prisma.sql`c."customer_email" IS NULL`)

  if (query.reminded === 'yes') parts.push(Prisma.sql`c."reminder_count" > 0`)
  if (query.reminded === 'no') parts.push(Prisma.sql`c."reminder_count" = 0`)
  if (query.reminded === 'failed') {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "abc_reminder_log" f WHERE f."cart_id" = c."id" AND f."status" = 'FAILED')`)
  }
  // "Cannot be emailed" is the same question the screen answers per row, asked
  // of the whole table: no address, unsubscribed, or asked not to be. Kept in
  // step with reminderBlockedReason in lib/types.ts by hand - there is no way
  // to share one expression between SQL and the browser, so the comment is the
  // only thing holding them together.
  if (query.reminded === 'blocked') {
    parts.push(Prisma.sql`c."recovered_at" IS NULL AND (
      c."customer_email" IS NULL
      OR c."marketing_opt_out" = TRUE
      OR EXISTS (SELECT 1 FROM "abc_suppressions" s2 WHERE s2."email" = LOWER(c."customer_email"))
    )`)
  }

  if (query.payment === 'attempted') parts.push(Prisma.sql`c."payment_stage" = 'ATTEMPTED'`)
  if (query.payment === 'failed') parts.push(Prisma.sql`c."payment_stage" = 'FAILED'`)

  const min = Number(query.minValue)
  if (Number.isFinite(min) && min > 0) parts.push(Prisma.sql`c."subtotal" >= ${min.toFixed(2)}::numeric`)

  // Dates arrive as plain days from a date input and are read in the server's
  // own zone, which is the zone every other timestamp on this screen is shown
  // in. "To" covers the whole of its day rather than stopping at midnight,
  // because an owner picking today means today.
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom)) {
    parts.push(Prisma.sql`c."updated_at" >= ${new Date(`${query.dateFrom}T00:00:00`)}`)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)) {
    parts.push(Prisma.sql`c."updated_at" <= ${new Date(`${query.dateTo}T23:59:59.999`)}`)
  }

  return parts.reduce((acc, part, index) => (index === 0 ? part : Prisma.sql`${acc} AND ${part}`))
}

function orderClause(sort: CartQuery['sort']): Prisma.Sql {
  switch (sort) {
    case 'oldest':
      return Prisma.sql`c."updated_at" ASC`
    case 'value-high':
      return Prisma.sql`c."subtotal" DESC, c."updated_at" DESC`
    case 'value-low':
      return Prisma.sql`c."subtotal" ASC, c."updated_at" DESC`
    case 'items-high':
      return Prisma.sql`c."item_count" DESC, c."updated_at" DESC`
    default:
      return Prisma.sql`c."updated_at" DESC`
  }
}

export async function listCarts(query: CartQuery): Promise<{ carts: AbandonedCart[]; total: number }> {
  const where = whereClause(query)
  const offset = Math.max(0, (query.page - 1) * query.perPage)
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT ${LIST_COLUMNS} FROM "abc_carts" c ${LAST_REMINDER_JOIN}
    WHERE ${where}
    ORDER BY ${orderClause(query.sort)}
    LIMIT ${query.perPage} OFFSET ${offset}
  `
  const counted = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "abc_carts" c WHERE ${where}
  `
  return { carts: rows.map(mapCart), total: Number(counted[0]?.count ?? 0) }
}

/**
 * The same list with no paging, for the CSV.
 *
 * Capped rather than unbounded: one click must never try to stream a shop's
 * whole history into a spreadsheet. The cap is reported back so the route can
 * say so in the file rather than silently handing over the first five thousand
 * and letting an owner believe that is all there was.
 */
export const EXPORT_LIMIT = 5000

export async function listCartsForExport(query: CartQuery): Promise<{ carts: AbandonedCart[]; total: number }> {
  const { total } = await listCarts({ ...query, page: 1, perPage: 1 })
  const { carts } = await listCarts({ ...query, page: 1, perPage: EXPORT_LIMIT })
  return { carts, total }
}

/** The counts beside each entry in the Show menu. One query, because three
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

/**
 * The tiles above the list.
 *
 * Deliberately not filtered by whatever the screen is currently showing: these
 * are the shop's figures, and a tile that changes when you search for somebody
 * is a tile nobody can quote. The recovery rate is measured over the last 30
 * days by when the basket was first seen, which is the only window in which
 * "how many came back" means anything - a basket left this morning has not had
 * its chance yet.
 */
export async function getStats(): Promise<AbandonedCartsStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [totals, recent, reminders, suppressed, lastRun] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        COUNT(*) FILTER (WHERE "recovered_at" IS NULL)::bigint AS open_count,
        COALESCE(SUM("subtotal") FILTER (WHERE "recovered_at" IS NULL), 0) AS open_value,
        COUNT(*) FILTER (WHERE "recovered_at" IS NULL AND "stage" = 'CHECKOUT')::bigint AS checkout_count,
        COALESCE(SUM("subtotal") FILTER (WHERE "recovered_at" IS NULL AND "stage" = 'CHECKOUT'), 0) AS checkout_value,
        COUNT(*) FILTER (WHERE "recovered_at" IS NULL AND "customer_email" IS NOT NULL)::bigint AS with_email_count,
        COUNT(*) FILTER (WHERE "recovered_at" IS NOT NULL)::bigint AS recovered_count,
        COALESCE(SUM("subtotal") FILTER (WHERE "recovered_at" IS NOT NULL), 0) AS recovered_value
      FROM "abc_carts"
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COUNT(*)::bigint AS seen,
             COUNT(*) FILTER (WHERE "recovered_at" IS NOT NULL)::bigint AS came_back
      FROM "abc_carts" WHERE "first_seen_at" >= ${since}
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COUNT(*) FILTER (WHERE "status" = 'SENT')::bigint AS sent,
             COUNT(*) FILTER (WHERE "status" = 'FAILED')::bigint AS failed
      FROM "abc_reminder_log" WHERE "created_at" >= ${since}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "abc_suppressions"`,
    getLastJobRun(),
  ])

  const t = totals[0] ?? {}
  const seen = asNumber(recent[0]?.seen)
  const cameBack = asNumber(recent[0]?.came_back)

  return {
    openCount: asNumber(t.open_count),
    openValue: asNumber(t.open_value),
    checkoutCount: asNumber(t.checkout_count),
    checkoutValue: asNumber(t.checkout_value),
    withEmailCount: asNumber(t.with_email_count),
    recoveredCount: asNumber(t.recovered_count),
    recoveredValue: asNumber(t.recovered_value),
    recoveryRate: seen > 0 ? Math.round((cameBack / seen) * 1000) / 10 : null,
    remindersSent30d: asNumber(reminders[0]?.sent),
    remindersFailed30d: asNumber(reminders[0]?.failed),
    unsubscribedCount: asNumber(suppressed[0]?.count),
    lastRun,
  }
}

export async function getCart(id: string): Promise<AbandonedCart | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT ${LIST_COLUMNS} FROM "abc_carts" c ${LAST_REMINDER_JOIN} WHERE c."id" = ${id} LIMIT 1
  `
  return rows[0] ? mapCart(rows[0]) : null
}

export async function deleteCart(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "abc_carts" WHERE "id" = ${id}`
}

/** Bin a selection in one go. Ids come from a browser, so the list is capped
 *  and the query is parameterised; there is no "delete everything matching the
 *  current filter" on purpose, because the filter can be a search box and one
 *  fat finger away from the lot. */
export async function deleteCarts(ids: string[]): Promise<number> {
  const wanted = ids.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 500)
  if (wanted.length === 0) return 0
  return prisma.$executeRaw`DELETE FROM "abc_carts" WHERE "id" = ANY(${wanted})`
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

export type ReminderCandidate = AbandonedCart & { unsubscribeToken: string; recoveryToken: string }

/**
 * Baskets a reminder is owed on: left alone for longer than the delay, with an
 * address on them, not already reminded as often as the owner allows, not
 * belonging to somebody who has asked us to stop, and not ticked "don't email
 * me" in the checkout where the owner offers that box.
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
    SELECT ${COLUMNS}, "unsubscribe_token", "recovery_token" FROM "abc_carts"
    WHERE "recovered_at" IS NULL
      AND "customer_email" IS NOT NULL
      AND "item_count" > 0
      AND "updated_at" < ${opts.olderThan}
      AND "marketing_opt_out" = false
      AND "reminder_count" < ${opts.maxPerCart}
      AND ("reminder_sent_at" IS NULL OR "reminder_sent_at" < ${opts.olderThan})
      AND NOT EXISTS (
        SELECT 1 FROM "abc_suppressions" s WHERE s."email" = LOWER("abc_carts"."customer_email")
      )
    ORDER BY "updated_at" ASC
    LIMIT ${opts.limit}
  `
  return rows.map((row) => ({
    ...mapCart(row),
    unsubscribeToken: row.unsubscribe_token as string,
    recoveryToken: row.recovery_token as string,
  }))
}

export async function recordReminderSent(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "abc_carts"
    SET "reminder_count" = "reminder_count" + 1, "reminder_sent_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
}

// ---------------------------------------------------------------------------
// The reminder log
// ---------------------------------------------------------------------------

export type ReminderLogInput = {
  cartId: string
  email: string
  attempt: number
  status: ReminderStatus
  detail?: string | null
  trigger?: ReminderTrigger
  sentBy?: string | null
  subject?: string | null
  itemCount?: number
  subtotal?: number
}

/**
 * Write down what happened to one attempt, sent or not.
 *
 * Never throws. A log write that falls over must not take the send with it: the
 * email has already gone by the time this runs, and turning a delivered
 * reminder into a failed job because a row would not insert is the wrong way
 * round in every direction.
 */
export async function logReminder(input: ReminderLogInput): Promise<void> {
  const address = normaliseEmail(input.email) ?? input.email.slice(0, 300)
  await prisma.$executeRaw`
    INSERT INTO "abc_reminder_log" (
      "cart_id", "email", "attempt", "status", "detail", "trigger", "sent_by",
      "subject", "item_count", "subtotal"
    ) VALUES (
      ${input.cartId}, ${address}, ${Math.max(1, Math.round(input.attempt))}, ${input.status},
      ${input.detail ?? null}, ${input.trigger ?? 'AUTOMATIC'}, ${input.sentBy ?? null},
      ${input.subject ?? null}, ${Math.max(0, Math.round(input.itemCount ?? 0))},
      ${(input.subtotal ?? 0).toFixed(2)}::numeric
    )
  `.catch(() => 0)
}

/** Everything ever tried on one basket, newest first. Read when a row is opened
 *  rather than carried in the list, because it is the answer to a question only
 *  asked about one basket at a time. */
export async function listRemindersForCart(cartId: string): Promise<ReminderLogEntry[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT l."id", l."cart_id", l."email", l."attempt", l."status", l."detail", l."trigger",
           l."sent_by", u."displayName" AS "sent_by_name", l."subject",
           l."item_count", l."subtotal", l."created_at"
    FROM "abc_reminder_log" l
    LEFT JOIN "User" u ON u."id" = l."sent_by"
    WHERE l."cart_id" = ${cartId}
    ORDER BY l."created_at" DESC
    LIMIT 50
  `.catch(() => [] as Row[])
  return rows.map(mapLogRow)
}

// ---------------------------------------------------------------------------
// Unsubscribes, as a list somebody can actually look at
// ---------------------------------------------------------------------------

export type Suppression = { email: string; reason: string; createdAt: string }

export async function listSuppressions(limit = 200): Promise<Suppression[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "email", "reason", "created_at" FROM "abc_suppressions"
    ORDER BY "created_at" DESC LIMIT ${Math.max(1, Math.min(1000, limit))}
  `.catch(() => [] as Row[])
  return rows.map((row) => ({
    email: (row.email as string) ?? '',
    reason: (row.reason as string) ?? 'unsubscribed',
    createdAt: asIso(row.created_at) ?? '',
  }))
}

/**
 * Take an address off the unsubscribe list.
 *
 * There for the shopper who writes in asking to be put back on, and for the
 * owner who unsubscribed their own test address while setting the thing up. It
 * does NOT untick the per-basket "don't email me" box: that was the shopper's
 * own answer in the checkout, and an owner reversing it from the admin screen
 * is not a thing this module is going to help with.
 */
export async function unsuppressEmail(email: string): Promise<void> {
  const address = normaliseEmail(email)
  if (!address) return
  await prisma.$executeRaw`DELETE FROM "abc_suppressions" WHERE "email" = ${address}`
}

// ---------------------------------------------------------------------------
// Job runs
// ---------------------------------------------------------------------------

/** How many runs are kept. Enough to see a pattern - "it has run every hour
 *  since Tuesday" - and not enough to become a table in its own right. */
const JOB_RUNS_KEPT = 100

export async function recordJobRun(run: Omit<JobRunSummary, 'ranAt'>): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "abc_job_runs" ("duration_ms", "purged", "considered", "sent", "skipped", "failed", "error")
    VALUES (${Math.max(0, Math.round(run.durationMs))}, ${run.purged}, ${run.considered},
            ${run.sent}, ${run.skipped}, ${run.failed}, ${run.error})
  `.catch(() => 0)
  await prisma.$executeRaw`
    DELETE FROM "abc_job_runs" WHERE "id" NOT IN (
      SELECT "id" FROM "abc_job_runs" ORDER BY "ran_at" DESC LIMIT ${JOB_RUNS_KEPT}
    )
  `.catch(() => 0)
}

export async function getLastJobRun(): Promise<JobRunSummary | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "ran_at", "duration_ms", "purged", "considered", "sent", "skipped", "failed", "error"
    FROM "abc_job_runs" ORDER BY "ran_at" DESC LIMIT 1
  `.catch(() => [] as Row[])
  const row = rows[0]
  if (!row) return null
  return {
    ranAt: asIso(row.ran_at) ?? '',
    durationMs: asNumber(row.duration_ms),
    purged: asNumber(row.purged),
    considered: asNumber(row.considered),
    sent: asNumber(row.sent),
    skipped: asNumber(row.skipped),
    failed: asNumber(row.failed),
    error: (row.error as string) ?? null,
  }
}

/** The row an unsubscribe link names, if it still exists. Only the address is
 *  wanted; the link is not a way to read anybody's basket back. */
export async function findByUnsubscribeToken(token: string): Promise<{ email: string | null } | null> {
  const rows = await prisma.$queryRaw<Array<{ customer_email: string | null }>>`
    SELECT "customer_email" FROM "abc_carts" WHERE "unsubscribe_token" = ${token} LIMIT 1
  `
  return rows[0] ? { email: rows[0].customer_email } : null
}

/**
 * The basket behind a "here is your basket" link.
 *
 * Lines and nothing else. The route that calls this hands them to the shop's own
 * basket and redirects, so it has no business with the address, the name or
 * anything else typed into the checkout - and a link that got forwarded, pasted
 * into a group chat or fetched by a scanner should not be able to read those
 * back out.
 *
 * A basket that has since been paid for hands back nothing: the shopper who
 * clicks last week's reminder after ordering wants their current basket, not a
 * finished one pushed back into it.
 */
export async function findLinesByRecoveryToken(token: string): Promise<CartLine[] | null> {
  const rows = await prisma.$queryRaw<Array<{ lines: unknown }>>`
    SELECT "lines" FROM "abc_carts"
    WHERE "recovery_token" = ${token} AND "recovered_at" IS NULL
    LIMIT 1
  `
  return rows[0] ? asLines(rows[0].lines) : null
}

export async function suppressEmail(email: string): Promise<void> {
  const address = normaliseEmail(email)
  if (!address) return
  await prisma.$executeRaw`
    INSERT INTO "abc_suppressions" ("email") VALUES (${address}) ON CONFLICT ("email") DO NOTHING
  `
}

/**
 * Mark every basket held for this address as "do not email".
 *
 * What the unsubscribe link does beyond suppressing the address: the two say the
 * same thing, and a list showing "reminded once" with nothing to explain why the
 * next one never went is how an owner ends up believing the emails are broken.
 * Suppression is still the thing that enforces it - this is the same answer,
 * written where it can be read.
 */
export async function optOutEmail(email: string): Promise<void> {
  const address = normaliseEmail(email)
  if (!address) return
  await prisma.$executeRaw`
    UPDATE "abc_carts" SET "marketing_opt_out" = true
    WHERE LOWER("customer_email") = ${address}
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
