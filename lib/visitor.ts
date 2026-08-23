import { randomUUID } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'

// The one cookie this module sets.
//
// A random id and nothing else - no fingerprint, no address, nothing derived
// from the shopper - so a browser that clears it is genuinely a new visitor and
// there is no back door that re-identifies them. HttpOnly because only the
// server ever needs to read it, which also means a stray script on the page
// cannot lift it.
//
// It is set only once consent has actually been given (or the site has no
// banner switch to give). That is the whole reason it is minted here, on the
// response to a capture that was already allowed, rather than by the tracker in
// the browser: a cookie that appears before the answer to the banner is exactly
// the thing the banner is for.

export const VISITOR_COOKIE = 'cactus_ac_visitor'
const MAX_AGE_DAYS = 30

export function readVisitorId(request: NextRequest): string | null {
  const value = request.cookies.get(VISITOR_COOKIE)?.value?.trim()
  if (!value) return null
  // Anything that is not one of ours is treated as absent rather than trusted:
  // the value goes into a query, and a UUID is the only shape we ever wrote.
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

export function mintVisitorId(): string {
  return randomUUID()
}

export function setVisitorCookie(response: NextResponse, visitorId: string): void {
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60,
  })
}

/** Dropped the moment consent is withdrawn, alongside the rows themselves. A
 *  site that stops being allowed to remember somebody should not still be
 *  holding the label it remembered them by. */
export function clearVisitorCookie(response: NextResponse): void {
  response.cookies.set(VISITOR_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}
