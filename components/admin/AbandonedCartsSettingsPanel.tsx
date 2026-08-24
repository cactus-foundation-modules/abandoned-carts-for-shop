'use client'

import { useCallback, useEffect, useState } from 'react'

const API_BASE = '/api/m/abandoned-carts-for-shop'

type Banner = {
  bannerEnabled: boolean
  hasMarketingCategory: boolean
}

type Settings = {
  enabled: boolean
  abandonAfterMinutes: number
  retentionDays: number
  captureBaskets: boolean
  emailsEnabled: boolean
  emailDelayMinutes: number
  emailMaxPerCart: number
  optOutBoxEnabled: boolean
  optOutStatement: string
  banner: Banner
  adminPath: string
}

type Draft = Omit<Settings, 'banner' | 'adminPath'>

function draftOf(s: Settings): Draft {
  return {
    enabled: s.enabled,
    abandonAfterMinutes: s.abandonAfterMinutes,
    retentionDays: s.retentionDays,
    captureBaskets: s.captureBaskets,
    emailsEnabled: s.emailsEnabled,
    emailDelayMinutes: s.emailDelayMinutes,
    emailMaxPerCart: s.emailMaxPerCart,
    optOutBoxEnabled: s.optOutBoxEnabled,
    optOutStatement: s.optOutStatement,
  }
}

// Everything the owner ought to know before they trust this, worked out from
// what is actually saved rather than from what they meant to save. The consent
// notes come first because they are the ones with a legal edge on them: this
// module holds names, addresses and phone numbers belonging to people who never
// placed an order, which is not the sort of thing to be vague about.
function advice(saved: Settings): Array<{ tone: 'warning' | 'danger' | 'info'; text: string; linkPrivacy?: boolean }> {
  const notes: Array<{ tone: 'warning' | 'danger' | 'info'; text: string; linkPrivacy?: boolean }> = []
  if (!saved.enabled) {
    notes.push({ tone: 'info', text: 'Switched off. Nothing is being recorded, and the reminders will not go out even if they are switched on below.' })
    return notes
  }

  const { bannerEnabled, hasMarketingCategory } = saved.banner

  if (!bannerEnabled) {
    notes.push({
      tone: 'warning',
      linkPrivacy: true,
      text: 'Your cookie banner is switched off, so no shopper is ever asked about marketing - and nothing is recorded here until one agrees. This is switched on but idle. Turn the banner on with a Marketing switch on it, on the Privacy tab, and baskets start arriving.',
    })
  } else if (!hasMarketingCategory) {
    notes.push({
      tone: 'warning',
      linkPrivacy: true,
      text: 'Your cookie banner has no Marketing switch on it, so there is nothing for a shopper to agree to and nothing is recorded here. This is switched on but idle. Add the Marketing category on the Privacy tab - this module offers it as a one-click suggestion there.',
    })
  } else {
    notes.push({
      tone: 'info',
      text: 'Nothing is recorded until a shopper agrees to Marketing cookies on your banner. A shopper who later changes their mind has everything of theirs deleted straight away, basket and typed details alike.',
    })
  }

  if (saved.emailsEnabled && (!bannerEnabled || !hasMarketingCategory)) {
    notes.push({
      tone: 'info',
      text: 'Reminder emails are switched on but have nothing to send: no basket is being recorded, so there is nobody to remind.',
    })
  }

  return notes
}

export function AbandonedCartsSettingsPanel() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/settings`)
      if (!res.ok) return
      const s = await res.json() as Settings
      setSaved(s)
      setDraft(draftOf(s))
    } catch { /* retry on next open */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Yield a microtask first so the opening setState never runs synchronously
    // inside the effect.
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await load()
    })()
    return () => { cancelled = true }
  }, [load])

  const save = useCallback(async () => {
    if (!draft) return
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => null) as (Settings & { error?: string }) | null
      if (!res.ok) {
        setErr(body?.error ?? 'Could not save those settings.')
        return
      }
      if (body) {
        setSaved(body)
        // Re-seed from what was actually stored: a number outside the allowed
        // range comes back as the one that was kept, which is clearer than
        // leaving the typed one sitting there looking saved.
        setDraft(draftOf(body))
      }
      setMsg('Saved.')
    } catch {
      setErr('Could not reach the site to save those settings.')
    } finally {
      setBusy(false)
    }
  }, [draft])

  if (!saved || !draft) return <p className="field-hint">Loading…</p>

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })
  const number = (value: string, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.round(n) : fallback
  }
  const notes = advice(saved)

  return (
    <div>
      <p className="field-hint" style={{ marginBottom: '1.25rem' }}>
        Keeps the baskets nobody finished, along with whatever the shopper had typed into the
        checkout before they went. They are listed on <strong>Trading &rsaquo; Abandoned baskets</strong>.
      </p>

      {notes.map((note, i) => (
        <div key={i} className={`alert alert-${note.tone}`}>
          {note.text}
          {note.linkPrivacy && (
            <>
              {' '}
              <a href={`/${saved.adminPath}/config?tab=gdpr#gdpr-banner`}>Open the Privacy settings</a>.
            </>
          )}
        </div>
      ))}

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.25rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span>Keep unfinished baskets</span>
      </label>

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.25rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.captureBaskets} onChange={(e) => set('captureBaskets', e.target.checked)} />
        <span>Include baskets that never reached the checkout</span>
      </label>
      <p className="field-hint" style={{ marginTop: '-0.9rem', marginBottom: '1.25rem' }}>
        Switch this off and you only keep the ones where somebody started filling the checkout in -
        far fewer of them, and every one with a name or an email on it.
      </p>

      <div className="field">
        <label htmlFor="abc-abandon-after">Counts as abandoned after</label>
        <input
          id="abc-abandon-after"
          type="number"
          min={5}
          max={10080}
          value={draft.abandonAfterMinutes}
          onChange={(e) => set('abandonAfterMinutes', number(e.target.value, draft.abandonAfterMinutes))}
        />
        <p className="field-hint">Minutes of nothing happening. Somebody still adding things is not abandoning anything.</p>
      </div>

      <div className="field">
        <label htmlFor="abc-retention">Delete baskets after</label>
        <input
          id="abc-retention"
          type="number"
          min={1}
          max={365}
          value={draft.retentionDays}
          onChange={(e) => set('retentionDays', number(e.target.value, draft.retentionDays))}
        />
        <p className="field-hint">
          Days. Everything older goes, whether it was reminded, recovered or neither. Keeping a
          stranger&rsquo;s address for ever because nobody chose a number is how a tidy feature turns
          into an awkward letter.
        </p>
      </div>

      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid var(--color-border)' }} />

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.25rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.emailsEnabled} onChange={(e) => set('emailsEnabled', e.target.checked)} />
        <span>Email a reminder about unfinished baskets</span>
      </label>
      <p className="field-hint" style={{ marginTop: '-0.9rem', marginBottom: '1.25rem' }}>
        Only to shoppers who left an email address, never to somebody who has since ordered, and
        never again to anybody who has asked us to stop. The wording is yours to change under{' '}
        <a href={`/${saved.adminPath}/config?tab=email&sub=templates`}>Settings &rsaquo; Emails</a>.
      </p>

      {draft.emailsEnabled && (
        <>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.25rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.optOutBoxEnabled}
              onChange={(e) => set('optOutBoxEnabled', e.target.checked)}
            />
            <span>Add an email permission box to the checkout</span>
          </label>
          <p className="field-hint" style={{ marginTop: '-0.9rem', marginBottom: '1.25rem' }}>
            Adds one tickbox to your checkout, directly under the email box - which is what it is
            about, and the only place a shopper reads it as a question rather than as small print.
            It appears once they have typed an address, nobody has to tick it, and it never holds an
            order up. Anybody who does tick it is left alone, and asking beforehand is a good deal
            politer than a link at the bottom of an email they did not want.
          </p>

          {draft.optOutBoxEnabled && (
            <div className="field">
              <label htmlFor="abc-optout-statement">What the box says</label>
              <input
                id="abc-optout-statement"
                type="text"
                maxLength={200}
                value={draft.optOutStatement}
                onChange={(e) => set('optOutStatement', e.target.value)}
              />
              <p className="field-hint">
                Worded so that ticking it means <em>no</em>. Leave it blank and it goes back to the
                wording we ship with.
              </p>
            </div>
          )}
        </>
      )}

      <div className="field">
        <label htmlFor="abc-email-delay">Wait before the reminder</label>
        <input
          id="abc-email-delay"
          type="number"
          min={15}
          max={20160}
          value={draft.emailDelayMinutes}
          onChange={(e) => set('emailDelayMinutes', number(e.target.value, draft.emailDelayMinutes))}
        />
        <p className="field-hint">
          Minutes since they last touched the basket. Four hours is the usual: long enough that they
          have genuinely stopped, short enough that they still remember what they were buying.
        </p>
      </div>

      <div className="field">
        <label htmlFor="abc-email-max">Reminders per basket</label>
        <input
          id="abc-email-max"
          type="number"
          min={1}
          max={3}
          value={draft.emailMaxPerCart}
          onChange={(e) => set('emailMaxPerCart', number(e.target.value, draft.emailMaxPerCart))}
        />
        <p className="field-hint">One is a favour. Three is a habit somebody will report you for.</p>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
