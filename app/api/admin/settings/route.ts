// GET/PATCH /api/m/abandoned-carts-for-shop/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { isCheckoutOptOutBoxLive, syncCheckoutOptOutBox } from '@/modules/abandoned-carts-for-shop/lib/checkout-box'
import {
  getAbandonedCartsSettings,
  getBannerState,
  updateAbandonedCartsSettings,
} from '@/modules/abandoned-carts-for-shop/lib/settings'
import { MAX_STATEMENT_LENGTH } from '@/modules/abandoned-carts-for-shop/lib/types'

async function view() {
  const [settings, banner, config, checkoutBoxLive] = await Promise.all([
    getAbandonedCartsSettings(),
    getBannerState(),
    prisma.siteConfig
      .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
      .catch(() => null),
    // Whether the box is really in the checkout, rather than merely switched on
    // here: it lives on the shop's own tickbox list and can be deleted there.
    isCheckoutOptOutBoxLive(),
  ])
  return {
    ...settings,
    banner,
    checkoutBoxLive,
    // So the panel can link straight to the cookie settings and the email
    // wording it talks about, rather than describing where they are and hoping.
    adminPath: config?.adminPath ?? 'cactus-admin',
  }
}

export async function GET() {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error
  return NextResponse.json(await view())
}

// Bounds are re-applied in lib/settings on the way to the column; these caps
// only stop something absurd arriving in the first place.
const Body = z.object({
  enabled: z.boolean().optional(),
  abandonAfterMinutes: z.number().int().min(5).max(60 * 24 * 7).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  captureBaskets: z.boolean().optional(),
  emailsEnabled: z.boolean().optional(),
  emailDelayMinutes: z.number().int().min(15).max(60 * 24 * 14).optional(),
  emailMaxPerCart: z.number().int().min(1).max(3).optional(),
  optOutBoxEnabled: z.boolean().optional(),
  optOutStatement: z.string().max(MAX_STATEMENT_LENGTH).optional(),
})

export async function PATCH(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid settings', 400)

  await updateAbandonedCartsSettings(parsed.data)
  // The checkout box follows the settings rather than being switched on
  // separately: switching the reminders off, or the whole module off, takes the
  // question out of the checkout with them.
  await syncCheckoutOptOutBox(await getAbandonedCartsSettings()).catch(() => {
    // The shop's settings would not save. The module's own settings are stored
    // either way, and the panel reports the box as missing from the checkout,
    // which is exactly what it would be.
  })
  return NextResponse.json(await view())
}
