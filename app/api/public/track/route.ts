import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMemberFromCookie } from '@/lib/members/session'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { consentBasis, mayCapture } from '@/modules/abandoned-carts-for-shop/lib/consent'
import { captureCart, deleteOpenCart, forgetVisitor } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { summariseLines } from '@/modules/abandoned-carts-for-shop/lib/pricing'
import { gateFromBanner, getAbandonedCartsSettings, getBannerState } from '@/modules/abandoned-carts-for-shop/lib/settings'
import { MAX_LINES, normaliseEmail, tidy, type CapturedAddress } from '@/modules/abandoned-carts-for-shop/lib/types'
import { clearVisitorCookie, mintVisitorId, readVisitorId, setVisitorCookie } from '@/modules/abandoned-carts-for-shop/lib/visitor'

// POST /api/m/abandoned-carts-for-shop/public/track
//
// The browser saying what is in the basket and what has been typed into the
// checkout. Called on a debounce, and again as the page is being left, so it has
// to be cheap and it has to be safe to call twice with the same thing.
//
// Nothing is written until this route has satisfied itself that it may - the
// tracker's own consent check is the half a shopper can see, this is the half
// that holds when somebody posts here by hand.

const Address = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
}).partial()

const Body = z.object({
  // The line list is capped generously and trimmed to MAX_LINES in the handler
  // rather than rejected at the cap: a shopper fitting out a whole office has a
  // genuinely long basket, and turning their capture into a 400 loses the very
  // order this module exists to notice.
  lines: z.array(z.object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(9999),
    lineId: z.string().max(100).optional(),
    // Whatever a companion module hung on the line (a delivery service, a
    // configured add-on). Kept verbatim and never interpreted here.
    meta: z.record(z.unknown()).optional(),
  })).max(1000),
  checkout: z.object({
    customerEmail: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    shippingAddress: Address.optional(),
    couponCode: z.string().nullable().optional(),
    shippingRateId: z.string().nullable().optional(),
    paymentMethod: z.string().nullable().optional(),
  }).nullable().optional(),
})

/** Whether the shopper has actually started filling the checkout in, as opposed
 *  to having merely walked past it. An empty form is not a checkout. */
function hasTypedSomething(checkout: z.infer<typeof Body>['checkout']): boolean {
  if (!checkout) return false
  const address = checkout.shippingAddress ?? {}
  return Boolean(
    tidy(checkout.customerEmail) ||
    tidy(checkout.customerName) ||
    tidy(checkout.customerPhone) ||
    tidy(address.line1) || tidy(address.postcode) || tidy(address.city) ||
    tidy(address.firstName) || tidy(address.lastName) || tidy(address.company)
  )
}

function tidyAddress(raw: CapturedAddress | undefined): CapturedAddress | null {
  if (!raw) return null
  const entries = Object.entries(raw)
    .map(([key, value]) => [key, tidy(value)] as const)
    .filter(([, value]) => value !== null)
  return entries.length > 0 ? (Object.fromEntries(entries) as CapturedAddress) : null
}

export async function POST(request: NextRequest) {
  const settings = await getAbandonedCartsSettings()
  // Switched off, or not migrated yet. Either way: no row, no cookie, no answer
  // worth the shopper's bandwidth.
  if (!settings.enabled) return new NextResponse(null, { status: 204 })

  const gate = gateFromBanner(await getBannerState())
  const existingVisitor = readVisitorId(request)

  if (!mayCapture(request, gate)) {
    // Not (or no longer) allowed. Anything already held for this browser goes,
    // and the cookie with it - a withdrawal that leaves the previous basket
    // sitting in the table is not a withdrawal.
    const response = new NextResponse(null, { status: 204 })
    if (existingVisitor) {
      await forgetVisitor(existingVisitor)
      clearVisitorCookie(response)
    }
    return response
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid tracking payload' }, { status: 400 })
  const { checkout } = parsed.data
  const lines = parsed.data.lines.slice(0, MAX_LINES)

  const stage = hasTypedSomething(checkout) ? 'CHECKOUT' : 'BASKET'

  // An owner who only wants the baskets with a name on them said so in the
  // settings; a plain basket from them is simply not our business.
  if (stage === 'BASKET' && !settings.captureBaskets) {
    return new NextResponse(null, { status: 204 })
  }

  const visitorId = existingVisitor ?? mintVisitorId()
  const response = new NextResponse(null, { status: 204 })
  setVisitorCookie(response, visitorId)

  // An empty basket is not an abandoned one, whatever they typed. The row goes
  // rather than lingering as a reminder about nothing.
  if (lines.length === 0) {
    await deleteOpenCart(visitorId)
    return response
  }

  const [{ itemCount, subtotal }, config, member] = await Promise.all([
    summariseLines(lines),
    getShopConfigCached(),
    // Signed in, where the shop has members. Only ever used to join this basket
    // to the account for the member's own data export.
    getMemberFromCookie().catch(() => null),
  ])

  await captureCart({
    visitorId,
    memberId: member?.id ?? null,
    stage,
    lines,
    itemCount,
    subtotal,
    currency: config.currency,
    consentBasis: consentBasis(gate),
    customerEmail: normaliseEmail(checkout?.customerEmail),
    customerName: tidy(checkout?.customerName),
    customerPhone: tidy(checkout?.customerPhone),
    shippingAddress: tidyAddress(checkout?.shippingAddress),
    couponCode: tidy(checkout?.couponCode),
    shippingRateId: tidy(checkout?.shippingRateId),
    paymentMethod: tidy(checkout?.paymentMethod),
  })

  return response
}
