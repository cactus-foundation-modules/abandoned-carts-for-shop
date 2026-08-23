import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { markRecovered, markRecoveredByEmail } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { orderBelongsTo } from '@/modules/abandoned-carts-for-shop/lib/orders'
import { normaliseEmail, tidy } from '@/modules/abandoned-carts-for-shop/lib/types'
import { readVisitorId } from '@/modules/abandoned-carts-for-shop/lib/visitor'

// POST /api/m/abandoned-carts-for-shop/public/recovered
//
// An order was placed. Announced by core's conversion seam on the confirmation
// page, which is how this module hears about a sale without the shop having to
// know it exists.
//
// Closing a row records nothing new, so this needs no consent check: it can only
// ever end a record early, which is the direction that never needs permission.
// It does need to know the caller is not closing a stranger's row, hence the two
// paths below - their own cookie, or a real order number with the address that
// is actually on it.

const Body = z.object({
  orderNumber: z.string().max(100).optional(),
  // Where the confirmation page knows it. A shopper who left a basket on the
  // laptop and finished on the phone is the same person, and their laptop's
  // cookie is not on this request.
  email: z.string().max(320).optional(),
})

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return new NextResponse(null, { status: 204 })

  const orderNumber = tidy(parsed.data.orderNumber)

  // This browser's own row: the cookie is proof enough, because it is the row
  // this browser wrote in the first place.
  const visitorId = readVisitorId(request)
  if (visitorId) await markRecovered(visitorId, orderNumber)

  // Anybody else's: only on a matching order number and address, so "this
  // address has ordered" cannot be asserted about a stranger by somebody who
  // fancies silencing a shop's reminders.
  const email = normaliseEmail(parsed.data.email)
  if (email && orderNumber && (await orderBelongsTo(orderNumber, email))) {
    await markRecoveredByEmail(email, orderNumber)
  }

  return new NextResponse(null, { status: 204 })
}
