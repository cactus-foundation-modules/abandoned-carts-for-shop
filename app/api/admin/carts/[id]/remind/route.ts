import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import {
  getCart,
  logReminder,
  recordReminderSent,
} from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { sendBasketReminder } from '@/modules/abandoned-carts-for-shop/lib/emails'
import { hasOrderedSince } from '@/modules/abandoned-carts-for-shop/lib/orders'
import { resolveLines } from '@/modules/abandoned-carts-for-shop/lib/pricing'
import { getReminderTokens } from '@/modules/abandoned-carts-for-shop/lib/db/tokens'
import { reminderBlockedReason } from '@/modules/abandoned-carts-for-shop/lib/types'

// POST /api/m/abandoned-carts-for-shop/admin/carts/<id>/remind
//
// Send this one shopper their reminder now, rather than waiting for the hourly
// job. For the basket somebody has actually looked at and thinks is worth a
// nudge - a £2,000 order that fell over at the payment page does not want to
// sit in a queue behind a four-hour delay.
//
// It refuses exactly what the automatic run refuses, and for the same reasons:
// an unsubscribe, a ticked "don't email me", an address that never got typed,
// and a shopper who has already ordered. Being an owner pressing a button is
// not a reason those stop applying - if anything it is the moment they matter
// most, because the automatic run at least cannot be argued with.
//
// It does NOT refuse a basket that has already had its allowance of automatic
// reminders. That cap is there to stop a machine pestering somebody unattended;
// a person deciding to write to one shopper is a different thing. There is
// still a ceiling, because "a person decided" stops being a defence somewhere
// around the fifth email.
const HARD_CEILING = 5

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error

  const { id } = await context.params
  const cart = await getCart(id)
  if (!cart) return errorResponse('That basket is no longer here', 404)

  const blocked = reminderBlockedReason(cart)
  if (blocked) return errorResponse(blocked, 409)
  if (cart.reminderCount >= HARD_CEILING) {
    return errorResponse(`This shopper has already had ${cart.reminderCount} reminders about this basket. That is enough.`, 409)
  }

  const email = cart.customerEmail as string
  const attempt = cart.reminderCount + 1

  // The same last look the automatic run takes. An order placed on a phone ten
  // minutes ago will not have closed this basket yet, and "you left something
  // behind" landing after somebody has paid for it is the one mistake this
  // module must not make - button or no button.
  const ordered = await hasOrderedSince(email, new Date(cart.firstSeenAt || cart.updatedAt))
  if (ordered) {
    await logReminder({
      cartId: cart.id, email, attempt, status: 'SKIPPED', trigger: 'MANUAL', sentBy: auth.user.id,
      detail: `They had already ordered (${ordered.orderNumber}), so no reminder went out`,
      itemCount: cart.itemCount, subtotal: cart.subtotal,
    })
    return errorResponse(`They have already ordered - it went out as ${ordered.orderNumber}.`, 409)
  }

  const tokens = await getReminderTokens(cart.id)
  if (!tokens) return errorResponse('That basket is no longer here', 404)

  try {
    const lines = await resolveLines(cart.lines)
    const outcome = await sendBasketReminder({
      to: email,
      customerName: cart.customerName,
      lines,
      subtotal: cart.subtotal,
      unsubscribeToken: tokens.unsubscribeToken,
      recoveryToken: tokens.recoveryToken,
    })

    if (!outcome.ok) {
      await logReminder({
        cartId: cart.id, email, attempt, status: 'FAILED', trigger: 'MANUAL', sentBy: auth.user.id,
        detail: outcome.reason, itemCount: cart.itemCount, subtotal: cart.subtotal,
      })
      return errorResponse(outcome.reason, 422)
    }

    await recordReminderSent(cart.id)
    await logReminder({
      cartId: cart.id, email, attempt, status: 'SENT', trigger: 'MANUAL', sentBy: auth.user.id,
      subject: outcome.subject, itemCount: cart.itemCount, subtotal: cart.subtotal,
    })
    return NextResponse.json({ ok: true, sentTo: email })
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'The email would not send'
    await logReminder({
      cartId: cart.id, email, attempt, status: 'FAILED', trigger: 'MANUAL', sentBy: auth.user.id,
      detail: message, itemCount: cart.itemCount, subtotal: cart.subtotal,
    })
    return errorResponse(message, 500)
  }
}
