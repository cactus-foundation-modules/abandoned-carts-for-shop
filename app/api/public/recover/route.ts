import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromCookie } from '@/lib/members/session'
import { findLinesByRecoveryToken } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import type { CartLine } from '@/modules/abandoned-carts-for-shop/lib/types'
import { getGuestCart, saveGuestCart, GUEST_CART_MAX_LINES } from '@/modules/shop/lib/db/guest-cart'
import { getMemberCart, saveMemberCart, MEMBER_CART_MAX_LINES } from '@/modules/shop/lib/db/member-cart'
import {
  mintGuestCartId,
  readGuestCartId,
  setGuestCartCookie,
} from '@/modules/shop/lib/guest-cart-cookie'

// GET /api/m/abandoned-carts-for-shop/public/recover?t=<token>
//
// The "pick up where you left off" link, and the whole reason the reminder is
// worth sending.
//
// It used to point straight at the basket page, which quietly assumed the email
// would be opened in the same browser the basket was built in. On a phone that
// is almost never true: a mail app opens links in its own little browser, with
// its own cookies and its own storage, so the shopper arrived at an empty
// basket underneath a heading telling them their things were still there. The
// basket was never lost - it is in this module's own table - nothing was
// putting it back.
//
// So this route does that first and then redirects. By the time the basket page
// draws, the shop's own basket already holds the lines, and the browser picks
// them up on its next sync exactly as it would a basket left on another device.
//
// Lines only, and only ever into the basket. Nothing typed into the checkout -
// no name, address or phone - is handed back by this route, because these links
// get forwarded, pasted and prefetched by mail scanners, and a link that
// reprinted somebody's address into a stranger's browser would be a far worse
// bug than the one it fixes. Product names are all it can reveal, and they were
// in the email already.

export const dynamic = 'force-dynamic'

/** Where the shopper is sent, whatever happened. An expired or invented token
 *  lands on their own basket rather than an error page: they clicked a link
 *  about a basket, so the basket is the honest place to put them, and which of
 *  the three it was is not worth a page of explanation. */
const BASKET_PATH = '/shop/cart'

/** Union of what is already in the basket and what was left behind, the older
 *  lines first. A line in both keeps the LARGER quantity rather than the sum,
 *  the same bargain the shop's own sync strikes: the usual reason a line is in
 *  both is that it is the same line, and nobody who asked for two of something
 *  should find four. */
function merge(recovered: CartLine[], current: CartLine[]): CartLine[] {
  const key = (line: CartLine) => line.lineId ?? line.productId
  const merged = recovered.map((line) => ({ ...line }))
  const byKey = new Map(merged.map((line) => [key(line), line]))
  for (const line of current) {
    const hit = byKey.get(key(line))
    if (hit) hit.quantity = Math.max(hit.quantity, line.quantity)
    else merged.push({ ...line })
  }
  return merged
}

export async function GET(request: NextRequest) {
  const token = (new URL(request.url).searchParams.get('t') ?? '').trim().slice(0, 100)
  const response = NextResponse.redirect(new URL(BASKET_PATH, request.url), 303)
  // Never cached, never kept by a shared proxy: the redirect carries a
  // Set-Cookie naming one shopper's basket.
  response.headers.set('Cache-Control', 'no-store')

  const lines = token ? await findLinesByRecoveryToken(token).catch(() => null) : null
  if (!lines || lines.length === 0) return response

  // A signed-in shopper's basket belongs to their account, and the shop only
  // reads the guest row for somebody who is not signed in - writing there would
  // put the basket somewhere they will never be shown it.
  const member = await getMemberFromCookie().catch(() => null)
  if (member?.id) {
    const existing = await getMemberCart(member.id).catch(() => null)
    await saveMemberCart(member.id, merge(lines, existing?.lines ?? []).slice(0, MEMBER_CART_MAX_LINES))
      .catch(() => undefined)
    return response
  }

  const cartId = readGuestCartId(request) ?? mintGuestCartId()
  const existing = await getGuestCart(cartId).catch(() => null)
  const saved = await saveGuestCart(cartId, merge(lines, existing?.lines ?? []).slice(0, GUEST_CART_MAX_LINES))
    .catch(() => null)
  // The cookie only goes out if the row actually landed. A browser holding an
  // id for a basket that was never written would read as "your saved basket is
  // empty" and clear the one it already had.
  if (saved) setGuestCartCookie(response, cartId)
  return response
}
