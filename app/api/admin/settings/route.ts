// GET/PATCH /api/m/abandoned-carts-for-shop/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { removeLegacyCheckoutBox } from '@/modules/abandoned-carts-for-shop/lib/checkout-box'
import { getLastJobRun } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import {
  getAbandonedCartsSettings,
  getBannerState,
  updateAbandonedCartsSettings,
} from '@/modules/abandoned-carts-for-shop/lib/settings'
import { MAX_STATEMENT_LENGTH } from '@/modules/abandoned-carts-for-shop/lib/types'

async function view() {
  // Sites that ran v0.1.2 have the old tickbox sitting in shop's own settings,
  // where this module no longer puts anything. Taken out here rather than on
  // save, so it goes without anybody having to know it was there. Writes
  // nothing on a site that never had one.
  await removeLegacyCheckoutBox().catch(() => {})
  const [settings, banner, config, lastRun] = await Promise.all([
    getAbandonedCartsSettings(),
    getBannerState(),
    prisma.siteConfig
      .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
      .catch(() => null),
    getLastJobRun(),
  ])
  return {
    ...settings,
    banner,
    // So the panel can link straight to the cookie settings and the email
    // wording it talks about, rather than describing where they are and hoping.
    adminPath: config?.adminPath ?? 'cactus-admin',
    // The settings page describes how often reminders go out. Describing the
    // schedule alone would be describing an intention: a site whose scheduled job
    // has never fired looks exactly like a site where nothing was ever due. Same
    // source as the line on the baskets list, so the two screens cannot disagree.
    lastRun,
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
  return NextResponse.json(await view())
}
