import { getShopConfig, updateShopConfig } from '@/modules/shop/lib/config'
import {
  OPTOUT_AGREEMENT_ID,
  withOptOutBox,
  type AbandonedCartsSettings,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// The "don't email me" tickbox in the checkout.
//
// Why it is written into the shop's own settings rather than drawn by this
// module: the shop already carries a list of checkout tickboxes an owner can
// add, word and delete, and that list is exactly what this box is. Asking the
// shop to grow an extension point for it would put code in every shop on every
// site, including the vast majority that will never install this module - the
// thing module isolation exists to stop. So the box goes in as one of the
// owner's own, with an id that says whose it is.
//
// Two consequences, both stated out loud in the settings panel rather than left
// to be discovered: the owner can edit or delete it on the shop's own Checkout
// settings (deleting it there simply means no box, and the panel says so), and
// removing this module leaves the entry behind, because a module teardown drops
// this module's tables and cannot reach into the shop's settings.

/** Whether the box has any business being in the checkout at all. A permission
 *  question about emails nobody is sending is noise in somebody's checkout. */
export function shouldOfferOptOutBox(settings: AbandonedCartsSettings): boolean {
  return settings.enabled && settings.emailsEnabled && settings.optOutBoxEnabled
}

/**
 * Put the box in the shop's checkout, or take it out, so that the shop's
 * settings match this module's.
 *
 * Appended after whatever else is on the list, which is where it belongs: the
 * compulsory boxes are the ones holding the order up, and a question about
 * emails sits under them rather than in the middle of them. Never required -
 * a permission box that refuses the order is not a question.
 *
 * Read uncached deliberately: the shop's config read has a few seconds of cache
 * on it, and writing a whole array back from a stale copy would quietly undo
 * whatever else was saved in that window.
 */
export async function syncCheckoutOptOutBox(settings: AbandonedCartsSettings): Promise<void> {
  const config = await getShopConfig()
  const next = withOptOutBox(config.checkoutAgreements, {
    wanted: shouldOfferOptOutBox(settings),
    statement: settings.optOutStatement,
  })

  // Nothing to say is nothing to write. The shop's save invalidates its own
  // config cache and rewrites the whole row, so a no-op write is not free.
  if (JSON.stringify(next) === JSON.stringify(config.checkoutAgreements)) return
  await updateShopConfig({ checkoutAgreements: next })
}

/**
 * Whether the box is actually in the checkout right now, as opposed to being
 * switched on here. The owner can delete it from the shop's own tickbox list,
 * and an owner who has done that should be told rather than left believing
 * shoppers are being asked something they are not.
 */
export async function isCheckoutOptOutBoxLive(): Promise<boolean> {
  const config = await getShopConfig().catch(() => null)
  const entry = config?.checkoutAgreements.find((a) => a.id === OPTOUT_AGREEMENT_ID)
  return Boolean(entry?.enabled && entry.statement.trim())
}
