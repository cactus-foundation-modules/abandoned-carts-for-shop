import { NextRequest, NextResponse } from 'next/server'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { countCarts, getStats, listCarts } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { getAbandonedCartsSettings } from '@/modules/abandoned-carts-for-shop/lib/settings'
import { paramsToCartQuery } from '@/modules/abandoned-carts-for-shop/lib/types'

// GET /api/m/abandoned-carts-for-shop/admin/carts        - the list behind the tab
// GET /api/m/abandoned-carts-for-shop/admin/carts?stats=1 - just the tiles
//
// The tiles are their own call rather than part of every list response: they
// cover the whole shop rather than the current filter, so paging through a list
// has no business re-running them. Same split the shop's own orders screen uses.

export async function GET(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.access', { allowAccess: true })
  if (auth.error) return auth.error

  const params = new URL(request.url).searchParams

  if (params.get('stats') === '1') {
    const [stats, config] = await Promise.all([getStats(), getShopConfigCached()])
    return NextResponse.json({ stats, currencySymbol: config.currencySymbol })
  }

  const query = paramsToCartQuery(params)
  const { carts, total } = await listCarts(query)

  const [counts, settings, config] = await Promise.all([
    countCarts(),
    getAbandonedCartsSettings(),
    getShopConfigCached(),
  ])

  return NextResponse.json({
    carts,
    total,
    counts,
    currencySymbol: config.currencySymbol,
    // The screen draws its "Abandoned" badge and its "next reminder due" line
    // off these rather than deciding for itself, so the badge, the countdown
    // and the job that actually sends all agree on what abandoned means.
    settings: {
      abandonAfterMinutes: settings.abandonAfterMinutes,
      emailsEnabled: settings.emailsEnabled,
      emailDelayMinutes: settings.emailDelayMinutes,
      emailMaxPerCart: settings.emailMaxPerCart,
      retentionDays: settings.retentionDays,
    },
  })
}
