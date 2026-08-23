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
 * Reminds a shopper what they left behind.
 *
 * Returns false when the site cannot send at all, or has no SITE_URL: a
 * reminder with no way back to the basket and no way to stop the reminders is
 * not a shorter email, it is a worse one. The caller uses the false to leave the
 * basket unmarked, so it is picked up again once the site is configured.
 */
export async function sendBasketReminder(params: {
  to: string
  customerName: string | null
  lines: ResolvedCartLine[]
  subtotal: number
  unsubscribeToken: string
}): Promise<boolean> {
  if (!isEmailConfigured()) return false
  const site = getSiteUrlOrNull()
  if (!site) return false

  const branding = await resolveBranding()
  const config = await getShopConfigCached()
  const urlStyle = config.productUrlStyle

  // Lines whose product has since gone are left out rather than listed as a
  // blank: an email about something the shop no longer sells sends somebody to
  // a 404 with our name on it.
  const listed = params.lines.filter((line) => line.name && line.slug)
  if (listed.length === 0) return false

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
    // The cart, not the checkout: a basket in the same browser is still there,
    // and one opened on a different device needs the things adding again - the
    // cart page is the page that makes sense in both cases.
    basketUrl: `${site}/shop/cart`,
    unsubscribeUrl: `${site}/api/m/abandoned-carts-for-shop/public/unsubscribe?t=${encodeURIComponent(params.unsubscribeToken)}`,
    itemCount: String(listed.reduce((sum, line) => sum + line.quantity, 0)),
    basketTotal: formatMoney(params.subtotal, config.currencySymbol),
  })
  if (!rendered) return false

  await sendEmail({ to: params.to, subject: rendered.subject, html: rendered.html, text: rendered.text })
  return true
}
