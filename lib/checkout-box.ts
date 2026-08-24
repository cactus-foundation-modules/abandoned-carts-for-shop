import { getShopConfig, updateShopConfig } from '@/modules/shop/lib/config'
import {
  OPTOUT_AGREEMENT_ID,
  withOptOutBox,
  type AbandonedCartsSettings,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// The "don't email me" tickbox in the checkout.
//
// The box itself is drawn by this module, through shop's
// 'shop.checkout-contact-extras' point, directly under the email box - see
// components/public/CheckoutOptOutBox.tsx. A question about emails belongs
// beside the address it is about, not three steps away under the total.
//
// What lives here is the clean-up. v0.1.2 of this module put the box in as one
// of shop's own checkout tickboxes, written into shop's settings; that worked,
// but it left the entry behind on an uninstall and let it be deleted somewhere
// this module could not see. Sites that took that version still have the entry,
// so it is taken back out on the first settings read - otherwise they would get
// the question twice, once in each place.

/** Whether the box has any business being in the checkout at all. A permission
 *  question about emails nobody is sending is noise in somebody's checkout. */
export function shouldOfferOptOutBox(settings: AbandonedCartsSettings): boolean {
  return settings.enabled && settings.emailsEnabled && settings.optOutBoxEnabled
}

/**
 * Take the old shop-settings tickbox out, if this site ever had one.
 *
 * Idempotent and silent: a site that never ran v0.1.2, or that has already been
 * tidied, writes nothing at all. Shop's config read is cached for a few seconds,
 * so the uncached read matters here - writing a whole array back from a stale
 * copy would quietly undo whatever else was saved in that window.
 */
export async function removeLegacyCheckoutBox(): Promise<void> {
  const config = await getShopConfig()
  if (!config.checkoutAgreements.some((a) => a.id === OPTOUT_AGREEMENT_ID)) return
  await updateShopConfig({
    checkoutAgreements: withOptOutBox(config.checkoutAgreements, { wanted: false, statement: '' }),
  })
}
