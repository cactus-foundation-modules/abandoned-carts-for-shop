import { NextRequest, NextResponse } from 'next/server'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { toCsvRow } from '@/modules/shop/lib/csv'
import { EXPORT_LIMIT, listCartsForExport } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { getAbandonedCartsSettings } from '@/modules/abandoned-carts-for-shop/lib/settings'
import {
  describeReminder,
  paramsToCartQuery,
  type AbandonedCart,
  type CapturedAddress,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// GET /api/m/abandoned-carts-for-shop/admin/carts/export
//
// A download of whatever the screen is currently showing - same filters, same
// order, read through the same parser as the list, so the file cannot quietly
// contain a different set of baskets than the screen does.
//
// This is a spreadsheet of people who never placed an order, several of whom
// have asked not to be contacted. The columns say so, in as many words, because
// the thing an owner is most likely to do with this file is paste a column of
// addresses into something that sends emails.
//
// Amounts go out unformatted and unsymbolled (7.99, not £7.99) so a spreadsheet
// reads them as numbers.

const COLUMNS = [
  'first_seen', 'last_seen', 'stage', 'abandoned', 'items', 'estimated_value', 'currency',
  'customer_name', 'customer_email', 'customer_phone',
  'may_we_email', 'reminder_state', 'reminders_sent', 'last_reminder_at', 'last_reminder_result', 'last_reminder_detail',
  'payment_stage', 'payment_failure_reason', 'coupon_code',
  'delivery_company', 'delivery_line1', 'delivery_line2', 'delivery_city', 'delivery_county', 'delivery_postcode', 'delivery_country',
  'came_back', 'order_number', 'consent_basis',
] as const

function iso(value: string | null): string {
  return value ? new Date(value).toISOString() : ''
}

function addressPart(address: CapturedAddress | null, key: keyof CapturedAddress): string {
  return (address?.[key] as string | undefined) ?? ''
}

/** The one column an owner reading this file has to get right. Spelled out as a
 *  sentence rather than a true/false, because "false" in a spreadsheet cell is
 *  exactly the sort of thing that gets filtered out and then ignored. */
function mayWeEmail(cart: AbandonedCart): string {
  if (!cart.customerEmail) return 'no address'
  if (cart.suppressed) return 'NO - unsubscribed'
  if (cart.marketingOptOut) return 'NO - asked not to be emailed'
  return 'yes'
}

export async function GET(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.access', { allowAccess: true })
  if (auth.error) return auth.error

  const query = paramsToCartQuery(request.nextUrl.searchParams)
  const settings = await getAbandonedCartsSettings()
  // Paging belongs to the screen, not to the file: an export of "page 2 of the
  // baskets over £500" is nobody's idea of a useful spreadsheet.
  const { carts, total } = await listCartsForExport(query)
  const now = Date.now()

  const rows = carts.map((cart) => {
    const state = describeReminder(cart, settings)
    const stale = now - new Date(cart.updatedAt).getTime() > settings.abandonAfterMinutes * 60000
    return toCsvRow([
      iso(cart.firstSeenAt),
      iso(cart.updatedAt),
      cart.stage === 'CHECKOUT' ? 'checkout started' : 'basket only',
      cart.recoveredAt ? 'no' : stale ? 'yes' : 'not yet',
      String(cart.itemCount),
      cart.subtotal.toFixed(2),
      cart.currency,
      cart.customerName ?? '',
      cart.customerEmail ?? '',
      cart.customerPhone ?? '',
      mayWeEmail(cart),
      state.label,
      String(cart.reminderCount),
      iso(cart.lastReminder?.createdAt ?? cart.reminderSentAt),
      cart.lastReminder?.status ?? '',
      cart.lastReminder?.detail ?? '',
      cart.paymentStage ?? '',
      cart.paymentFailureReason ?? '',
      cart.couponCode ?? '',
      addressPart(cart.shippingAddress, 'company'),
      addressPart(cart.shippingAddress, 'line1'),
      addressPart(cart.shippingAddress, 'line2'),
      addressPart(cart.shippingAddress, 'city'),
      addressPart(cart.shippingAddress, 'county'),
      addressPart(cart.shippingAddress, 'postcode'),
      addressPart(cart.shippingAddress, 'country'),
      cart.recoveredAt ? iso(cart.recoveredAt) : '',
      cart.recoveredOrderNumber ?? '',
      cart.consentBasis,
    ])
  })

  // A truncated file says so in the file. Handing over the first five thousand
  // and letting an owner believe that was all of them is the sort of quiet lie
  // that only shows up in a reconciliation months later.
  if (total > carts.length) {
    rows.push(toCsvRow([`Only the first ${EXPORT_LIMIT} of ${total} baskets are in this file. Narrow the dates and download again for the rest.`]))
  }

  const csv = [toCsvRow([...COLUMNS]), ...rows].join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="abandoned-baskets.csv"',
    },
  })
}
