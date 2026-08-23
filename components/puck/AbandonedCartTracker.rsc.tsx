import { connection } from 'next/server'
import { gateFromBanner, getAbandonedCartsSettings, getBannerState } from '@/modules/abandoned-carts-for-shop/lib/settings'
import { CartTracker } from '@/modules/abandoned-carts-for-shop/components/public/CartTracker'
import { abandonedCartTrackerBlockComponent } from './AbandonedCartTracker'

async function AbandonedCartTrackerRsc() {
  // Read per request, not per build: an owner who switches basket watching off
  // expects the next page load to stop watching, not the next deploy.
  await connection()

  const settings = await getAbandonedCartsSettings()
  // Switched off, or installed and not migrated yet. Either way the page gets no
  // tracker at all - not a tracker that sits there deciding to do nothing.
  if (!settings.enabled) return null

  return <CartTracker config={{ gate: gateFromBanner(await getBannerState()), captureBaskets: settings.captureBaskets }} />
}

export const abandonedCartTrackerBlockRscComponent = {
  ...abandonedCartTrackerBlockComponent,
  render: AbandonedCartTrackerRsc,
}
