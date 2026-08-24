import {
  listDueReminders,
  logReminder,
  markRecoveredByEmail,
  purgeOlderThan,
  recordJobRun,
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
//
// Every outcome is written to the reminder log, including the ones where
// nothing was sent, and the run itself is written down too. Between them they
// answer the two questions the admin screen used to have no answer to: did this
// email go, and is the thing that sends them running at all.

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
  const startedAt = Date.now()
  const settings = await getAbandonedCartsSettings()
  const result: ReminderRunResult = { purged: 0, considered: 0, sent: 0, skippedOrdered: 0, failed: 0 }

  const retentionCutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000)
  result.purged = await purgeOlderThan(retentionCutoff)

  if (!settings.enabled || !settings.emailsEnabled) {
    // Still written down. A run that did nothing because the switch is off is
    // exactly the run an owner needs to see, rather than a screen that looks
    // identical to one where the cron has silently stopped firing.
    await recordJobRun({ ...toRun(result), durationMs: Date.now() - startedAt, error: null })
    return result
  }

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
      await logReminder({
        cartId: cart.id,
        email,
        attempt: cart.reminderCount + 1,
        status: 'SKIPPED',
        detail: `They had already ordered (${ordered.orderNumber}), so no reminder went out`,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
      })
      result.skippedOrdered += 1
      continue
    }

    try {
      const lines = await resolveLines(cart.lines)
      const outcome = await sendBasketReminder({
        to: email,
        customerName: cart.customerName,
        lines,
        subtotal: cart.subtotal,
        unsubscribeToken: cart.unsubscribeToken,
      })
      if (outcome.ok) {
        await recordReminderSent(cart.id)
        await logReminder({
          cartId: cart.id,
          email,
          attempt: cart.reminderCount + 1,
          status: 'SENT',
          subject: outcome.subject,
          itemCount: cart.itemCount,
          subtotal: cart.subtotal,
        })
        result.sent += 1
      } else {
        // Not sent, and deliberately not counted as sent: the site has no email
        // provider yet, or every product in the basket has since been deleted.
        // Both are worth trying again rather than silently writing off - the
        // difference is only that one of them will keep failing until somebody
        // does something, which is precisely why it is now written down.
        await logReminder({
          cartId: cart.id,
          email,
          attempt: cart.reminderCount + 1,
          status: outcome.permanent ? 'SKIPPED' : 'FAILED',
          detail: outcome.reason,
          itemCount: cart.itemCount,
          subtotal: cart.subtotal,
        })
        result.failed += 1
      }
    } catch (err) {
      await logReminder({
        cartId: cart.id,
        email,
        attempt: cart.reminderCount + 1,
        status: 'FAILED',
        detail: err instanceof Error ? err.message.slice(0, 300) : 'The email would not send',
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
      })
      result.failed += 1
    }
  }

  await recordJobRun({ ...toRun(result), durationMs: Date.now() - startedAt, error: null })
  return result
}

/** The run as the job-runs table holds it. "Skipped" there is the wider word:
 *  everything we deliberately did not send, not only the already-ordered ones. */
function toRun(result: ReminderRunResult) {
  return {
    purged: result.purged,
    considered: result.considered,
    sent: result.sent,
    skipped: result.skippedOrdered,
    failed: result.failed,
  }
}

/** Written when the run itself falls over, rather than when a single send does.
 *  Called from the cron route's catch, so a job that died at the first query
 *  still leaves a record saying so. */
export async function recordFailedRun(startedAt: number, message: string): Promise<void> {
  await recordJobRun({
    durationMs: Date.now() - startedAt,
    purged: 0, considered: 0, sent: 0, skipped: 0, failed: 0,
    error: message.slice(0, 500),
  })
}
