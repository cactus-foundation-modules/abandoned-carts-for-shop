'use client'

import { useEffect, useState } from 'react'
import type { ShopCheckoutContactExtraProps } from '@/modules/shop/components/public/checkout-contact-extras'
import { getCheckoutState, updateCheckoutState } from '@/modules/shop/components/public/checkout-state'
import {
  DEFAULT_OPTOUT_STATEMENT,
  OPTOUT_AGREEMENT_ID,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// The permission box, under the email box it is about.
//
// Mounted through shop's 'shop.checkout-contact-extras' point, so shop knows
// nothing about this module beyond "something wants to say a word at the foot
// of the contact step". The answer is kept in shop's own checkout state, which
// is already shared across the checkout blocks and already what the tracker
// reads - see components/public/shop-storage.ts.
//
// It draws nothing until there is an email address in the box above it. A
// question about emailing somebody is unanswerable before there is an address,
// and a tickbox about nothing is one more thing to read past.

const CONFIG_URL = '/api/m/abandoned-carts-for-shop/public/checkout-box'

type BoxConfig = { enabled: boolean; statement?: string }

export function CheckoutOptOutBox({ customerEmail, preview = false }: ShopCheckoutContactExtraProps) {
  const [config, setConfig] = useState<BoxConfig | null>(preview ? { enabled: true, statement: DEFAULT_OPTOUT_STATEMENT } : null)
  const [ticked, setTicked] = useState(false)

  useEffect(() => {
    // The editor has no shopper and no settings worth fetching; it draws the
    // box at rest so the layout shows what the step will look like.
    if (preview) return
    let cancelled = false
    fetch(CONFIG_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BoxConfig | null) => {
        if (cancelled || !data?.enabled) return
        setConfig(data)
        // Whatever they answered earlier this visit - stepping back to this
        // block must not quietly untick it.
        setTicked(getCheckoutState().agreements?.[OPTOUT_AGREEMENT_ID] === true)
      })
      .catch(() => {
        // No answer, no box. A checkout must never be held up by this module.
      })
    return () => { cancelled = true }
  }, [preview])

  if (!config?.enabled) return null
  if (!preview && customerEmail.trim().length === 0) return null

  const statement = (config.statement ?? '').trim() || DEFAULT_OPTOUT_STATEMENT

  function onChange(next: boolean) {
    setTicked(next)
    // Shop's own map, which is where every other checkout tickbox lives. Written
    // in full rather than patched, because that is the shape shop stores.
    updateCheckoutState({ agreements: { ...getCheckoutState().agreements, [OPTOUT_AGREEMENT_ID]: next } })
  }

  return (
    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.9375rem' }}>
      <input
        type="checkbox"
        checked={ticked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: '0.2rem' }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>{statement}</span>
    </label>
  )
}
