import {
  listDueReminders,
  markRecoveredByEmail,
  purgeOlderThan,
  recordReminderSent,
} from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { sendBasketReminder } from '@/modules/abandoned-carts-for-shop/lib/emails'
import { hasOrderedSince } from '@/modules/abandoned-carts-for-shop/lib/orders'
import { resolveLines } from '@/modules/abandoned-carts-for-shop/lib/pricing'
import { getAbandonedCartsSettings } from '@/modules/abandoned-carts-for-shop/lib/settings'

// The hourly job: tidy up first, then remind.
//
// The purge runs whether or not reminders are switched on, and before anything
// else, because it is the half that must never be skipped: it is the only thing
// standing between "we keep unfinished baskets for 90 days" and keeping them for
// ever. An owner who never turns the emails on still gets the retention they
// were promised.

// A shop with a busy day should not turn one cron tick into a thousand emails.
// The rest wait for the next hour, which for a basket that has already sat for
// four hours is neither here nor there.
const MAX_PER_RUN = 200

export type ReminderRunResult = {
  purged: number
  considered: number
  sent: number
  skippedOrdered: number
  failed: number
}

export async function runAbandonedCartJob(): Promise<ReminderRunResult> {
  const settings = await getAbandonedCartsSettings()
  const result: ReminderRunResult = { purged: 0, considered: 0, sent: 0, skippedOrdered: 0, failed: 0 }

  const retentionCutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000)
  result.purged = await purgeOlderThan(retentionCutoff)

  if (!settings.enabled || !settings.emailsEnabled) return result

  const olderThan = new Date(Date.now() - settings.emailDelayMinutes * 60 * 1000)
  const due = await listDueReminders({ olderThan, maxPerCart: settings.emailMaxPerCart, limit: MAX_PER_RUN })
  result.considered = due.length

  for (const cart of due) {
    const email = cart.customerEmail
    if (!email) continue

    // Last check before we write to somebody. The tracker usually closes a
    // recovered basket on the confirmation page, but that needs the shopper to
    // still be in the browser that left it - and a payment finished on a phone,
    // or a tab closed on the redirect back, is neither rare nor their fault.
    // Chasing somebody for a basket they have already paid for is the one
    // mistake this module must not make.
    const ordered = await hasOrderedSince(email, new Date(cart.firstSeenAt || cart.updatedAt))
    if (ordered) {
      await markRecoveredByEmail(email, ordered.orderNumber)
      result.skippedOrdered += 1
      continue
    }

    try {
      const lines = await resolveLines(cart.lines)
      const sent = await sendBasketReminder({
        to: email,
        customerName: cart.customerName,
        lines,
        subtotal: cart.subtotal,
        unsubscribeToken: cart.unsubscribeToken,
      })
      if (sent) {
        await recordReminderSent(cart.id)
        result.sent += 1
      } else {
        // Not sent, and deliberately not recorded as sent: the site has no email
        // provider yet, or every product in the basket has since been deleted.
        // Both are worth trying again rather than silently writing off.
        result.failed += 1
      }
    } catch {
      result.failed += 1
    }
  }

  return result
}
