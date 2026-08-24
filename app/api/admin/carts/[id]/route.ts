import { NextRequest, NextResponse } from 'next/server'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { deleteCart, getCart, listRemindersForCart } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { resolveLines } from '@/modules/abandoned-carts-for-shop/lib/pricing'

// GET    /api/m/abandoned-carts-for-shop/admin/carts/<id>  - one basket, with its
//                                                            lines named from the
//                                                            catalogue and every
//                                                            reminder ever tried
// DELETE /api/m/abandoned-carts-for-shop/admin/carts/<id>  - bin it
//
// The delete is the manual half of this module's data handling: retention takes
// care of the rest, and somebody who writes in asking to be removed should not
// have to be waited out. The reminder log goes with the basket, because it
// holds the same address.

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.access', { allowAccess: true })
  if (auth.error) return auth.error

  const { id } = await context.params
  const cart = await getCart(id)
  if (!cart) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [lines, reminders, config] = await Promise.all([
    resolveLines(cart.lines),
    listRemindersForCart(id),
    getShopConfigCached(),
  ])
  return NextResponse.json({ cart, lines, reminders, currencySymbol: config.currencySymbol })
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error

  const { id } = await context.params
  await deleteCart(id)
  return NextResponse.json({ ok: true })
}
