import { resolveBranding } from '@/lib/config/branding'
import { getSiteUrlOrNull, isEmailConfigured } from '@/lib/config/env'
import { sendEmail } from '@/lib/email/index'
import { renderEmailTemplate } from '@/lib/email/render'
import { productHref } from '@/modules/shop/lib/product-url'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { formatMoney } from '@/modules/shop/lib/money'
import type { ResolvedCartLine } from '@/modules/abandoned-carts-for-shop/lib/types'

// The reminder. Its wording, its on/off switch and the design wrapped around it
// live with every other email on the site, in core's Settings > Emails; this
// file only works out the merge values and posts the result. The default wording
// is in lib/email-templates.ts.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * What became of one attempt.
 *
 * A plain false told the caller nothing, which is how a shop ends up with a
 * basket marked "not reminded" for three different reasons that need three
 * different things doing about them. The reason is written as the owner would
 * have to be told it, because it goes straight onto the screen and into the
 * log.
 */
export type ReminderSendResult =
  | { ok: true; subject: string }
  | { ok: false; reason: string; permanent: boolean }

/**
 * Reminds a shopper what they left behind.
 *
 * Fails rather than sends when the site cannot email at all, or has no
 * SITE_URL: a reminder with no way back to the basket and no way to stop the
 * reminders is not a shorter email, it is a worse one. `permanent` says whether
 * trying again in an hour could possibly help - a missing email provider is
 * worth retrying, a basket of products the shop has since deleted is not.
 */
export async function sendBasketReminder(params: {
  to: string
  customerName: string | null
  lines: ResolvedCartLine[]
  subtotal: number
  unsubscribeToken: string
  recoveryToken: string
}): Promise<ReminderSendResult> {
  if (!isEmailConfigured()) {
    return { ok: false, reason: 'This site has no email provider set up yet', permanent: false }
  }
  const site = getSiteUrlOrNull()
  if (!site) {
    return { ok: false, reason: 'This site has no web address set, so the email would have no link back', permanent: false }
  }

  const branding = await resolveBranding()
  const config = await getShopConfigCached()
  const urlStyle = config.productUrlStyle

  // Lines whose product has since gone are left out rather than listed as a
  // blank: an email about something the shop no longer sells sends somebody to
  // a 404 with our name on it.
  const listed = params.lines.filter((line) => line.name && line.slug)
  if (listed.length === 0) {
    return { ok: false, reason: 'Nothing in this basket is still in the catalogue', permanent: true }
  }

  const itemList = listed
    .map((line) => {
      const href = `${site}${productHref(line.slug as string, urlStyle)}`
      const quantity = line.quantity > 1 ? ` &times; ${line.quantity}` : ''
      return `<li><a href="${href}">${escapeHtml(line.name as string)}</a>${quantity}</li>`
    })
    .join('\n')

  const firstName = (params.customerName ?? '').trim().split(/\s+/)[0] ?? ''

  const rendered = await renderEmailTemplate('abandoned-carts-for-shop.reminder', {
    siteName: branding.name,
    firstName,
    hasName: firstName ? 'true' : 'false',
    itemList,
    // Through the recover route rather than straight at the basket page. The
    // direct link only ever worked for somebody opening the email in the same
    // browser the basket was built in, which on a phone is almost nobody - a
    // mail app opens links in its own little browser with its own storage, so
    // the shopper landed on an empty basket under a heading promising their
    // things were still here. The route puts the lines back first and then
    // sends them to the same page.
    basketUrl: `${site}/api/m/abandoned-carts-for-shop/public/recover?t=${encodeURIComponent(params.recoveryToken)}`,
    unsubscribeUrl: `${site}/api/m/abandoned-carts-for-shop/public/unsubscribe?t=${encodeURIComponent(params.unsubscribeToken)}`,
    itemCount: String(listed.reduce((sum, line) => sum + line.quantity, 0)),
    basketTotal: formatMoney(params.subtotal, config.currencySymbol),
  })
  if (!rendered) {
    return { ok: false, reason: 'The reminder email is switched off in Settings > Emails', permanent: false }
  }

  await sendEmail({ to: params.to, subject: rendered.subject, html: rendered.html, text: rendered.text })
  return { ok: true, subject: rendered.subject }
}
