import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalExportBearer } from '@/lib/members/export'
import { listCartsForMember } from '@/modules/abandoned-carts-for-shop/lib/db/carts'

// Internal bearer only - called self-origin by core's assembleMemberExport(),
// never reachable with a browser session (memberExtensions.dataExportPath).
//
// A signed-in shopper's unfinished baskets are their data as much as their
// orders are, and a subject access request that quietly leaves out the table
// holding their address and phone number is not an answer to it.
export async function GET(request: NextRequest) {
  if (!verifyInternalExportBearer(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const memberId = request.headers.get('x-cactus-member-id')
  if (!memberId) return NextResponse.json({ error: 'Missing member id' }, { status: 400 })

  const carts = await listCartsForMember(memberId)
  return NextResponse.json({ abandonedBaskets: carts })
}
