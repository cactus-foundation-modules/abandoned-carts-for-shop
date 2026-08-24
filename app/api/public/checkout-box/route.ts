import { NextResponse } from 'next/server'
import { shouldOfferOptOutBox } from '@/modules/abandoned-carts-for-shop/lib/checkout-box'
import { getAbandonedCartsSettings } from '@/modules/abandoned-carts-for-shop/lib/settings'

// GET /api/m/abandoned-carts-for-shop/public/checkout-box
//
// What the tickbox under the email box should say, and whether there should be
// one at all. Asked by the checkout, so it answers for everybody and holds
// nothing back that is not already printed on the page.
//
// Nothing here is gated on consent, and nothing here records anything: this is
// the wording of a question, not an answer to it. Gating the question itself
// would be the wrong way round - a shopper who has refused marketing cookies is
// exactly who should still be able to see they are not being emailed.

export const dynamic = 'force-dynamic'

export async function GET() {
  const settings = await getAbandonedCartsSettings().catch(() => null)
  if (!settings || !shouldOfferOptOutBox(settings)) {
    return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json(
    { enabled: true, statement: settings.optOutStatement },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
