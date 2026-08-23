import { getSessionFromCookie, type SessionUser } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'

// Permission gate for this module's admin surfaces, in the same shape shop's own
// requireShopUser has - so a route reads the same whichever module it belongs to.
//
// Two keys: abandonedcarts.access to look, abandonedcarts.manage to change
// anything. Shop's own keys are deliberately not accepted, even though the tab
// sits inside shop's Trading page: this list is every unfinished shopper's name,
// address and phone number, and whoever may edit the catalogue is not
// automatically somebody who should be reading that. An owner who wants both
// grants both keys, which is a decision rather than an accident.

export type AbandonedCartsPermissionKey = 'abandonedcarts.access' | 'abandonedcarts.manage'

export async function hasAbandonedCartsPermission(
  user: SessionUser,
  key: AbandonedCartsPermissionKey,
  opts?: { allowAccess?: boolean },
): Promise<boolean> {
  if (await hasPermission(user, 'abandonedcarts.manage')) return true
  if (opts?.allowAccess && (await hasPermission(user, 'abandonedcarts.access'))) return true
  return hasPermission(user, key)
}

export async function requireAbandonedCartsUser(
  key: AbandonedCartsPermissionKey,
  opts?: { allowAccess?: boolean },
): Promise<{ user: SessionUser; error?: undefined } | { user?: undefined; error: Response }> {
  const user = await getSessionFromCookie()
  if (!user) return { error: errorResponse('Not authenticated', 401) }
  if (!(await hasAbandonedCartsPermission(user, key, opts))) return { error: errorResponse('Forbidden', 403) }
  return { user }
}
