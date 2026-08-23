'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { onConversion, type Conversion } from '@/lib/analytics/conversion'
import {
  CONSENT_CHANGE_EVENT,
  MARKETING_CATEGORY,
  SHOP_CART_EVENT,
  SHOP_CHECKOUT_EVENT,
  type TrackerConfig,
} from '@/modules/abandoned-carts-for-shop/lib/types'
import { readCartLines, readCheckout } from '@/modules/abandoned-carts-for-shop/components/public/shop-storage'

// ---------------------------------------------------------------------------
// The browser half of abandoned baskets. Draws nothing, ever.
//
// What it does, in order:
//   1. Works out whether it is allowed to do anything at all. If the site's
//      banner carries the marketing category, nothing happens until the shopper
//      grants it - not a request, not a cookie, not a row.
//   2. Reports the basket and whatever has been typed into the checkout, on a
//      debounce, whenever either changes.
//   3. Reports once more as the page is being left, which is the visit that
//      matters most: somebody closing the tab mid-checkout is the definition of
//      an abandoned basket.
//   4. Tells the server to forget everything the moment consent is withdrawn.
//   5. Closes the row when core announces a sale, so a shopper who came back is
//      never chased for the basket they finished.
//
// Everything is claimed on `window` rather than in component state: the block
// can legitimately sit in the header layout and the footer layout at once, and
// two copies posting the same basket would double every request for no gain.
// ---------------------------------------------------------------------------

const BASE = '/api/m/abandoned-carts-for-shop/public'
const DEBOUNCE_MS = 2500

type TrackerWindow = {
  __cactusConsent?: Record<string, boolean>
  /** Held by whichever copy of the block is doing the work. */
  __cactusAbandonedCarts?: boolean
}

function trackerWindow(): TrackerWindow {
  return window as unknown as TrackerWindow
}

function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange)
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange)
}

// A one-character string rather than a boolean-bearing object:
// useSyncExternalStore compares snapshots by identity, and a fresh object every
// call is an infinite render.
function consentSnapshot(): string {
  return trackerWindow().__cactusConsent?.[MARKETING_CATEGORY] === true ? '1' : '0'
}

function serverSnapshot(): string {
  return '0'
}

export function CartTracker({ config }: { config: TrackerConfig }) {
  const { gate, captureBaskets } = config

  const snapshot = useSyncExternalStore(subscribeConsent, consentSnapshot, serverSnapshot)
  // 'allowed' means the site's banner has no switch for this, so there is
  // nothing to wait for. See GateMode in lib/types.ts - it is the owner's
  // decision, and the settings panel says out loud that they have made it.
  const allowed = gate === 'allowed' || snapshot === '1'

  // The last payload actually sent. A basket that has not changed is not worth a
  // request, and the checkout fires its change event on every keystroke.
  const lastSent = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const allowedRef = useRef(allowed)
  const capturedRef = useRef(false)

  const buildPayload = useCallback((): string | null => {
    const lines = readCartLines()
    const checkout = readCheckout()
    // An empty basket with nothing typed is not news. An empty basket after
    // something HAS been reported is: the shopper emptied it, and the server
    // takes that as "stop chasing this one".
    if (lines.length === 0 && !capturedRef.current) return null
    // An owner who only wants the baskets with a name on them said so in the
    // settings. The server enforces it too; this just saves the request.
    const typed = Boolean(
      checkout?.customerEmail || checkout?.customerName || checkout?.customerPhone ||
      checkout?.shippingAddress?.line1 || checkout?.shippingAddress?.postcode
    )
    if (!captureBaskets && !typed && !capturedRef.current) return null
    return JSON.stringify({ lines, checkout })
  }, [captureBaskets])

  const send = useCallback((body: string, beacon: boolean): void => {
    if (beacon && typeof navigator.sendBeacon === 'function') {
      // The page is going. fetch() would be cancelled with it; a beacon is
      // handed to the browser to deliver on its own time.
      navigator.sendBeacon(`${BASE}/track`, new Blob([body], { type: 'application/json' }))
      lastSent.current = body
      capturedRef.current = true
      return
    }
    void fetch(`${BASE}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // A basket that could not be reported is a basket that goes unreported.
      // Nothing here is worth showing a shopper an error about.
    })
    lastSent.current = body
    capturedRef.current = true
  }, [])

  const report = useCallback((beacon: boolean): void => {
    if (!allowedRef.current) return
    const body = buildPayload()
    if (!body || body === lastSent.current) return
    send(body, beacon)
  }, [buildPayload, send])

  const schedule = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => report(false), DEBOUNCE_MS)
  }, [report])

  // Consent, first and last. A grant starts everything; a withdrawal stops it and
  // deletes what was already stored, which is the only reading of "withdraw"
  // that means anything.
  useEffect(() => {
    const was = allowedRef.current
    allowedRef.current = allowed
    if (was && !allowed) {
      if (timer.current) clearTimeout(timer.current)
      lastSent.current = null
      capturedRef.current = false
      void fetch(`${BASE}/forget`, { method: 'POST', keepalive: true }).catch(() => {})
    }
  }, [allowed])

  // Only one copy of the block does the work, whichever mounts first.
  const owner = useRef(false)
  useEffect(() => {
    const w = trackerWindow()
    if (w.__cactusAbandonedCarts) return
    w.__cactusAbandonedCarts = true
    owner.current = true
    return () => {
      if (owner.current) w.__cactusAbandonedCarts = false
    }
  }, [])

  // The basket and the checkout boxes. Both are shop's own window events, so a
  // change made by any of its blocks is heard without polling anything.
  useEffect(() => {
    if (!owner.current || !allowed) return
    // A shopper who arrived with a basket already in the browser (yesterday's,
    // or one built before they answered the banner) is reported on arrival -
    // the first change event might be a long time coming, or never.
    schedule()
    window.addEventListener(SHOP_CART_EVENT, schedule)
    window.addEventListener(SHOP_CHECKOUT_EVENT, schedule)
    return () => {
      window.removeEventListener(SHOP_CART_EVENT, schedule)
      window.removeEventListener(SHOP_CHECKOUT_EVENT, schedule)
    }
  }, [allowed, schedule])

  // Leaving the page. pagehide rather than beforeunload, and visibilitychange as
  // well, because a phone browser backgrounding a tab often never fires either
  // an unload or a pagehide at all - and a checkout abandoned on a phone is the
  // single most common thing this module exists to catch.
  useEffect(() => {
    if (!owner.current || !allowed) return
    const flush = () => {
      if (timer.current) clearTimeout(timer.current)
      report(true)
    }
    const onHidden = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [allowed, report])

  // A sale. Announced by core, so the shop never has to know this module is
  // installed. Sent whatever the consent state: closing a record is not
  // collecting anything, and a shopper who withdrew consent has had their row
  // deleted already, in which case this closes nothing.
  useEffect(() => {
    if (!owner.current) return
    return onConversion((conversion: Conversion) => {
      if (conversion.type !== 'purchase') return
      if (timer.current) clearTimeout(timer.current)
      const checkout = readCheckout()
      void fetch(`${BASE}/recovered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: conversion.transactionId, email: checkout?.customerEmail }),
        keepalive: true,
      }).catch(() => {})
      lastSent.current = null
      capturedRef.current = false
    })
  }, [])

  // Nothing outstanding when the page goes.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return null
}
