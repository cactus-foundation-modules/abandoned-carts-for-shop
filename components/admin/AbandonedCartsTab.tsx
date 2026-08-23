import { getSessionFromCookie } from '@/lib/auth/session'
import { hasAbandonedCartsPermission } from '@/modules/abandoned-carts-for-shop/lib/access'
import { AbandonedCartsScreen } from '@/modules/abandoned-carts-for-shop/components/admin/AbandonedCartsScreen'

// This screen is a tab on Shop > Trading rather than a sidebar link of its own:
// an unfinished order belongs beside the finished ones, and the sidebar is
// already long enough.
//
// The permission check stays here rather than leaning on the host's. This is a
// component, and one that renders whatever it is handed is a refactor away from
// showing every shopper's name and address to a role that should never see them.
export async function AbandonedCartsTab() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasAbandonedCartsPermission(user, 'abandonedcarts.access', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to view abandoned baskets.</div>

  const canManage = await hasAbandonedCartsPermission(user, 'abandonedcarts.manage')
  return <AbandonedCartsScreen canManage={canManage} />
}
