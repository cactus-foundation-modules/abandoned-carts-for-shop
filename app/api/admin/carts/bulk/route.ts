import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { deleteCarts } from '@/modules/abandoned-carts-for-shop/lib/db/carts'

// POST /api/m/abandoned-carts-for-shop/admin/carts/bulk
//
// One action, and one on purpose: delete the selected baskets. There is no
// "delete everything matching the current filter" here, because the filter can
// be a half-typed search box and an owner is one fat finger from the lot.
//
// A bulk "send them all a reminder" is deliberately absent too. Emailing forty
// strangers at once from a button nobody had to think about is how a shop ends
// up on a blocklist; the reminders go out on their own schedule, and the single
// manual send is for the one basket somebody has actually looked at.

export async function POST(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error

  const body = (await request.json().catch(() => null)) as { action?: string; ids?: unknown } | null
  if (!body || body.action !== 'delete') return errorResponse('Unknown action', 400)

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : []
  if (ids.length === 0) return errorResponse('Nothing was selected', 400)

  const deleted = await deleteCarts(ids)
  return NextResponse.json({ ok: true, deleted })
}
