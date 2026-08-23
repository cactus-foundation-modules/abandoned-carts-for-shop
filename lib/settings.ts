import { prisma } from '@/lib/db/prisma'
import {
  clampInt,
  MARKETING_CATEGORY,
  type AbandonedCartsSettings,
  type BannerState,
  type GateMode,
} from '@/modules/abandoned-carts-for-shop/lib/types'

type SettingsRow = {
  enabled: boolean
  abandon_after_minutes: number
  retention_days: number
  capture_baskets: boolean
  emails_enabled: boolean
  email_delay_minutes: number
  email_max_per_cart: number
}

// What the module does before its migration has run, or if the singleton row is
// somehow missing: nothing at all. A half-installed module that starts recording
// shoppers on default settings nobody chose is the wrong way round.
const BLANK: AbandonedCartsSettings = {
  enabled: false,
  abandonAfterMinutes: 60,
  retentionDays: 90,
  captureBaskets: true,
  emailsEnabled: false,
  emailDelayMinutes: 240,
  emailMaxPerCart: 1,
}

export async function getAbandonedCartsSettings(): Promise<AbandonedCartsSettings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "enabled", "abandon_after_minutes", "retention_days", "capture_baskets",
           "emails_enabled", "email_delay_minutes", "email_max_per_cart"
    FROM "abc_settings" WHERE "id" = 'singleton'
  `.catch(() => [] as SettingsRow[])
  const row = rows[0]
  if (!row) return BLANK
  return {
    enabled: row.enabled,
    // Bounded on the way out as well as on the way in: a row edited by hand, or
    // written by an older version of this module, must not put a retention of
    // zero days or ten years into the purge.
    abandonAfterMinutes: clampInt(row.abandon_after_minutes, 5, 60 * 24 * 7, 60),
    retentionDays: clampInt(row.retention_days, 1, 365, 90),
    captureBaskets: row.capture_baskets,
    emailsEnabled: row.emails_enabled,
    emailDelayMinutes: clampInt(row.email_delay_minutes, 15, 60 * 24 * 14, 240),
    emailMaxPerCart: clampInt(row.email_max_per_cart, 1, 3, 1),
  }
}

export async function updateAbandonedCartsSettings(patch: Partial<AbandonedCartsSettings>): Promise<void> {
  if (patch.enabled !== undefined) {
    await prisma.$executeRaw`UPDATE "abc_settings" SET "enabled" = ${patch.enabled}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.abandonAfterMinutes !== undefined) {
    const value = clampInt(patch.abandonAfterMinutes, 5, 60 * 24 * 7, 60)
    await prisma.$executeRaw`UPDATE "abc_settings" SET "abandon_after_minutes" = ${value}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.retentionDays !== undefined) {
    const value = clampInt(patch.retentionDays, 1, 365, 90)
    await prisma.$executeRaw`UPDATE "abc_settings" SET "retention_days" = ${value}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.captureBaskets !== undefined) {
    await prisma.$executeRaw`UPDATE "abc_settings" SET "capture_baskets" = ${patch.captureBaskets}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.emailsEnabled !== undefined) {
    await prisma.$executeRaw`UPDATE "abc_settings" SET "emails_enabled" = ${patch.emailsEnabled}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.emailDelayMinutes !== undefined) {
    const value = clampInt(patch.emailDelayMinutes, 15, 60 * 24 * 14, 240)
    await prisma.$executeRaw`UPDATE "abc_settings" SET "email_delay_minutes" = ${value}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.emailMaxPerCart !== undefined) {
    const value = clampInt(patch.emailMaxPerCart, 1, 3, 1)
    await prisma.$executeRaw`UPDATE "abc_settings" SET "email_max_per_cart" = ${value}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

type StoredBanner = {
  enabled?: boolean
  categories?: Array<{ key?: string }>
} | null

/**
 * What the site's cookie banner currently offers. Read from core's own config
 * rather than assumed: a category can be renamed, removed, or never added, and
 * every one of those changes what this module is allowed to do.
 */
export async function getBannerState(): Promise<BannerState> {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { consentBannerConfig: true } })
    .catch(() => null)
  const banner = config?.consentBannerConfig as StoredBanner
  const keys = new Set((banner?.categories ?? []).map((c) => c?.key).filter(Boolean) as string[])
  return {
    bannerEnabled: banner?.enabled === true,
    hasMarketingCategory: keys.has(MARKETING_CATEGORY),
  }
}

/** Whether there is a switch to wait for. See GateMode for why 'allowed' is not
 *  the same as "granted". */
export function gateFromBanner(banner: BannerState): GateMode {
  if (!banner.bannerEnabled) return 'allowed'
  return banner.hasMarketingCategory ? 'category' : 'allowed'
}
