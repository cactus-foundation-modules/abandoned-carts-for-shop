import type { NextRequest } from 'next/server'
import { MARKETING_CATEGORY, type GateMode } from '@/modules/abandoned-carts-for-shop/lib/types'

// The server's own reading of the shopper's consent.
//
// The tracker in the browser already refuses to send anything without a grant,
// and that is the half a shopper can see working. This is the half that matters
// when somebody posts to the endpoint directly: a consent gate that only exists
// in the browser is a request away from not existing at all, and what would be
// stored is a name, an address and a phone number.
//
// Core's cookie is read, never written, and only its `decision` map is looked
// at. The payload's shape belongs to core (lib/consent/client.ts); anything
// unreadable is treated as "no decision", which denies.

const CONSENT_COOKIE = 'cactus-consent'

type ConsentPayload = { decision?: Record<string, boolean> } | null

export function readConsentDecision(request: NextRequest): Record<string, boolean> | null {
  const raw = request.cookies.get(CONSENT_COOKIE)?.value
  if (!raw) return null
  try {
    const payload = JSON.parse(decodeURIComponent(raw)) as ConsentPayload
    if (!payload || typeof payload !== 'object' || !payload.decision) return null
    return payload.decision
  } catch {
    return null
  }
}

/**
 * May this request be recorded?
 *
 * One answer, and it is the shopper's: the marketing category has to have been
 * granted. A shopper who has not answered the banner yet counts as not granted,
 * exactly as a refusal does, and a site whose banner never asks the question
 * ('unavailable') can never get a yes - so it never records anything.
 */
export function mayCapture(request: NextRequest, gate: GateMode): boolean {
  if (gate !== 'category') return false
  return readConsentDecision(request)?.[MARKETING_CATEGORY] === true
}

/** What was relied on, recorded with the row so the answer to "why do you hold
 *  this?" lives in the data rather than in somebody's memory. Only ever the one
 *  thing now, and kept as a stored column rather than assumed, because rows
 *  written by an older version of this module say something else. */
export function consentBasis(): string {
  return MARKETING_CATEGORY
}
