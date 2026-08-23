// GET/PATCH /api/m/abandoned-carts-for-shop/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import {
  getAbandonedCartsSettings,
  getBannerState,
  updateAbandonedCartsSettings,
} from '@/modules/abandoned-carts-for-shop/lib/settings'

async function view() {
  const [settings, banner, config] = await Promise.all([
    getAbandonedCartsSettings(),
    getBannerState(),
    prisma.siteConfig
      .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
      .catch(() => null),
  ])
  return {
    ...settings,
    banner,
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
})

export async function PATCH(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid settings', 400)

  await updateAbandonedCartsSettings(parsed.data)
  return NextResponse.json(await view())
}
