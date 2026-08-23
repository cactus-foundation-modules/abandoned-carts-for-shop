import { prisma } from '@/lib/db/prisma'
import { normaliseEmail } from '@/modules/abandoned-carts-for-shop/lib/types'

// Reads of the shop's own orders. Cross-module reads only - nothing here writes
// to shop's tables or asks shop to know this module exists.

/**
 * Does this order number really belong to this address?
 *
 * Asked before an unauthenticated caller is allowed to close somebody else's
 * basket by email. Without it, "this address has ordered" is a claim anybody can
 * make about anybody, which would let a passer-by silence a shop's reminders and
 * quietly inflate its recovery figures. With it, the caller has to know a real
 * order number and the address on it - which is what a shopper standing on their
 * own confirmation page has, and nobody else does.
 */
export async function orderBelongsTo(orderNumber: string, email: string): Promise<boolean> {
  const address = normaliseEmail(email)
  if (!address || !orderNumber) return false
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "shp_orders"
    WHERE "order_number" = ${orderNumber} AND LOWER("customer_email") = ${address}
    LIMIT 1
  `.catch(() => [] as Array<{ id: string }>)
  return rows.length > 0
}

/**
 * Has this address ordered since the basket was last touched?
 *
 * The reminder run's last check before it writes to somebody. The tracker
 * normally marks a basket recovered on the confirmation page, but that depends
 * on the shopper still having the page open in the browser that left the basket,
 * and neither is guaranteed - a payment finished on a phone, a tab closed on the
 * redirect back, a browser that dropped the cookie. Chasing somebody for a
 * basket they have already paid for is the one mistake this module must not
 * make, so the order table gets the final word.
 */
export async function hasOrderedSince(email: string, since: Date): Promise<{ orderNumber: string } | null> {
  const address = normaliseEmail(email)
  if (!address) return null
  const rows = await prisma.$queryRaw<Array<{ order_number: string }>>`
    SELECT "order_number" FROM "shp_orders"
    WHERE LOWER("customer_email") = ${address} AND "created_at" >= ${since}
    ORDER BY "created_at" DESC LIMIT 1
  `.catch(() => [] as Array<{ order_number: string }>)
  return rows[0] ? { orderNumber: rows[0].order_number } : null
}
