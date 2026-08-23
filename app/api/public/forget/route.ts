import { NextRequest, NextResponse } from 'next/server'
import { forgetVisitor } from '@/modules/abandoned-carts-for-shop/lib/db/carts'
import { clearVisitorCookie, readVisitorId } from '@/modules/abandoned-carts-for-shop/lib/visitor'

// POST /api/m/abandoned-carts-for-shop/public/forget
//
// The shopper has changed their mind at the cookie banner. Everything this
// browser has left here goes, and the cookie identifying it with it.
//
// No consent check and no settings check, on purpose: this route only ever
// deletes, and the one thing that must never fail is somebody asking to be
// forgotten. It needs no body either - the cookie is the whole request.

export async function POST(request: NextRequest) {
  const response = new NextResponse(null, { status: 204 })
  const visitorId = readVisitorId(request)
  if (!visitorId) return response
  await forgetVisitor(visitorId)
  clearVisitorCookie(response)
  return response
}
