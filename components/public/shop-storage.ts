'use client'

import {
  SHOP_CART_KEY,
  SHOP_CHECKOUT_KEY,
  type CartLine,
  type CapturedAddress,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// Reading the shop's own browser storage.
//
// Why this rather than an extension point in shop: the shop's basket lives in
// the browser and nowhere else until an order is placed, so there is no
// server-side moment to hook. The alternative was asking shop to grow a
// reporting seam - new code, new events and a slightly heavier checkout on every
// site running the shop, including the many that will never install this module.
// That is precisely what module isolation is there to stop, so this module reads
// what shop already publishes instead and asks shop for nothing.
//
// The trade-off, stated plainly because it is real: these two keys and their two
// events are shop's, and a future shop release could rename them. Everything
// here is defensive - an unreadable or unexpected value reads as "nothing in the
// basket", which switches this module off rather than breaking a shopper's
// checkout. The wiki records the version of shop this was written against.

export type CheckoutSnapshot = {
  customerEmail?: string
  customerName?: string
  customerPhone?: string
  shippingAddress?: CapturedAddress
  couponCode?: string | null
  shippingRateId?: string | null
  paymentMethod?: string | null
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** The basket as shop holds it. Anything that is not a recognisable line is
 *  dropped rather than guessed at. */
export function readCartLines(): CartLine[] {
  if (typeof window === 'undefined') return []
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(SHOP_CART_KEY)
  } catch {
    // A browser refusing storage has no basket to report.
    return []
  }
  const parsed = parse<unknown>(raw)
  if (!Array.isArray(parsed)) return []
  const lines: CartLine[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const line = entry as { productId?: unknown; quantity?: unknown; lineId?: unknown; meta?: unknown }
    if (typeof line.productId !== 'string') continue
    const quantity = Math.round(Number(line.quantity))
    if (!Number.isFinite(quantity) || quantity < 1) continue
    lines.push({
      productId: line.productId,
      quantity: Math.min(9999, quantity),
      ...(typeof line.lineId === 'string' ? { lineId: line.lineId } : {}),
      ...(line.meta && typeof line.meta === 'object' && !Array.isArray(line.meta)
        ? { meta: line.meta as Record<string, unknown> }
        : {}),
    })
  }
  return lines
}

/** What has been typed into the checkout so far. Session storage, so it is only
 *  ever this visit's - which is the same span the shopper thinks of it as. */
export function readCheckout(): CheckoutSnapshot | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(SHOP_CHECKOUT_KEY)
  } catch {
    return null
  }
  const state = parse<Record<string, unknown>>(raw)
  if (!state) return null
  const address = (state.shippingAddress && typeof state.shippingAddress === 'object')
    ? (state.shippingAddress as CapturedAddress)
    : undefined
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)
  return {
    customerEmail: text(state.customerEmail),
    customerName: text(state.customerName),
    customerPhone: text(state.customerPhone),
    shippingAddress: address,
    couponCode: text(state.couponCode) ?? null,
    shippingRateId: text(state.shippingRateId) ?? null,
    paymentMethod: text(state.paymentMethod) ?? null,
  }
}
