import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { requireAbandonedCartsUser } from '@/modules/abandoned-carts-for-shop/lib/access'
import { listSuppressions, unsuppressEmail } from '@/modules/abandoned-carts-for-shop/lib/db/carts'

// GET    /api/m/abandoned-carts-for-shop/admin/suppressions  - who has unsubscribed
// DELETE /api/m/abandoned-carts-for-shop/admin/suppressions  - put one back on
//
// Worth a screen of its own rather than being invisible plumbing: "why did that
// customer never get the email?" is the single most common thing to go and look
// up, and an unsubscribe list nobody can read is indistinguishable from a bug.

export async function GET() {
  const auth = await requireAbandonedCartsUser('abandonedcarts.access', { allowAccess: true })
  if (auth.error) return auth.error
  return NextResponse.json({ suppressions: await listSuppressions() })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAbandonedCartsUser('abandonedcarts.manage')
  if (auth.error) return auth.error

  const email = new URL(request.url).searchParams.get('email') ?? ''
  if (!email) return errorResponse('No address given', 400)

  await unsuppressEmail(email)
  return NextResponse.json({ ok: true })
}
