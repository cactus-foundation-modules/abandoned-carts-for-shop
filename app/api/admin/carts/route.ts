import { NextRequest, NextResponse } from 'next/server'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { countCarts, listCarts, type CartFilter } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { getAbandonedCartsSettings } from '@/modules/abandoned-carts-for-shop/lib/settings'
import { clampInt } from '@/modules/abandoned-carts-for-shop/lib/types'

// GET /api/m/abandoned-carts-for-shop/admin/carts
// The list behind the Abandoned baskets tab.

const FILTERS: CartFilter[] = ['all', 'basket', 'checkout', 'recovered']

export async function GET(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.access', { allowAccess: true })
  if (auth.error) return auth.error

  const params = new URL(request.url).searchParams
  const requested = params.get('filter') as CartFilter | null
  const filter: CartFilter = requested && FILTERS.includes(requested) ? requested : 'all'

  const { carts, total } = await listCarts({
    filter,
    search: params.get('search') ?? '',
    page: clampInt(params.get('page'), 1, 10000, 1),
    perPage: clampInt(params.get('perPage'), 5, 100, 25),
  })

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
    // The screen draws an "Abandoned" badge off this rather than deciding for
    // itself, so the badge and the reminders agree on what abandoned means.
    abandonAfterMinutes: settings.abandonAfterMinutes,
  })
}
