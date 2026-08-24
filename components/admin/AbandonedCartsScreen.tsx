'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { formatMoney } from '@/modules/shop/lib/money'
import { useAlert, useConfirm } from '@/modules/shop/components/admin/dialogs'
import { abandonedCartsCss } from '@/modules/abandoned-carts-for-shop/components/admin/abandoned-carts-css'
import {
  CART_FILTERS,
  CART_FILTER_LABELS,
  CART_SORTS,
  CART_SORT_LABELS,
  DEFAULT_CART_QUERY,
  PAYMENT_STAGE_LABELS,
  REMINDER_STATUS_LABELS,
  STAGE_LABELS,
  cartQueryIsFiltered,
  cartQueryToParams,
  describeReminder,
  paramsToCartQuery,
  reminderBlockedReason,
  type AbandonedCart,
  type AbandonedCartsStats,
  type CartFilter,
  type CartQuery,
  type CartSort,
  type ReminderLogEntry,
  type ReminderRules,
  type ReminderState,
  type ResolvedCartLine,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// The Abandoned baskets list: every basket nobody finished, with what the
// shopper had typed before they went, what it was worth, and - the column this
// screen was missing for its first two versions - whether a reminder about it
// ever actually went, when, and if not, why not.
//
// Baskets and started checkouts share one table on purpose. They are the same
// shopper at two points in the same journey, and an owner opening this screen
// wants one answer to "what nearly happened today?" rather than two lists to
// reconcile. The filters are there for when they want one or the other.
//
// Every control lives in one object, which is also exactly what goes in the
// query string - that is what makes a filtered list linkable, gives the back
// button something sensible to do, and lets a tile at the top set two filters
// at once without a special case per tile.

type Suppression = { email: string; reason: string; createdAt: string }

const DATE_PRESETS: Array<{ value: string; label: string; days: number | null }> = [
  { value: '', label: 'Any date', days: null },
  { value: '1', label: 'Last 24 hours', days: 1 },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
]

const TONE_BADGE: Record<ReminderState['tone'], string> = {
  sent: 'badge badge-success',
  failed: 'badge badge-error',
  blocked: 'badge badge-warning',
  due: 'badge badge-primary',
  none: 'badge badge-default',
}

function isoDay(daysAgo: number): string {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

function formatWhen(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "20 minutes ago", "3 days ago", and forwards as well: "in 2 hours".
 *
 *  The age is the column an owner reads first - a basket left four minutes ago
 *  is somebody still shopping, and one left four days ago is a different
 *  conversation entirely - and the same arithmetic answers "when is the next
 *  reminder due", which is the same question pointing the other way.
 *
 *  "Now" is passed in rather than read from the clock, because reading the
 *  clock while rendering makes the same row render differently on a re-render
 *  nobody asked for. It is stamped once per load, which is also when the
 *  figures it is compared against were true. */
function formatAge(value: string | null, now: number): string {
  if (!value || now === 0) return ''
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const forward = then > now
  const minutes = Math.round(Math.abs(now - then) / 60000)
  const say = (amount: string) => (forward ? `in ${amount}` : `${amount} ago`)
  if (minutes < 1) return forward ? 'any moment' : 'just now'
  if (minutes < 60) return say(`${minutes} min`)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return say(`${hours} hour${hours === 1 ? '' : 's'}`)
  const days = Math.round(hours / 24)
  return say(`${days} day${days === 1 ? '' : 's'}`)
}

function addressLines(cart: AbandonedCart): string[] {
  const address = cart.shippingAddress
  if (!address) return []
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ')
  return [name, address.company, address.line1, address.line2, address.city, address.county, address.postcode, address.country]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
}

export function AbandonedCartsScreen({ canManage }: { canManage: boolean }) {
  const adminPath = useAdminPath()
  const [alert, alertNode] = useAlert()
  const [confirm, confirmNode] = useConfirm()

  // Read straight from the address bar on first render, so a link to a filtered
  // list opens on that list rather than flashing the default one first.
  const [query, setQuery] = useState<CartQuery>(() =>
    typeof window === 'undefined' ? DEFAULT_CART_QUERY : paramsToCartQuery(new URLSearchParams(window.location.search)),
  )
  const [searchBox, setSearchBox] = useState(query.search)
  const [minValueBox, setMinValueBox] = useState(query.minValue)

  const [carts, setCarts] = useState<AbandonedCart[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [symbol, setSymbol] = useState('£')
  const [rules, setRules] = useState<ReminderRules & { abandonAfterMinutes: number; retentionDays: number }>({
    emailsEnabled: false, emailDelayMinutes: 240, emailMaxPerCart: 1, abandonAfterMinutes: 60, retentionDays: 90,
  })
  const [stats, setStats] = useState<AbandonedCartsStats | null>(null)
  // The clock as it stood when the list was last fetched. See formatAge.
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [openLines, setOpenLines] = useState<ResolvedCartLine[]>([])
  const [openLog, setOpenLog] = useState<ReminderLogEntry[]>([])
  const [openLoading, setOpenLoading] = useState(false)

  const [showUnsubscribed, setShowUnsubscribed] = useState(false)
  const [suppressions, setSuppressions] = useState<Suppression[]>([])

  // Bumped whenever something changes a basket, so the tiles are re-read rather
  // than sitting there stale after a delete or a send.
  const [statsToken, setStatsToken] = useState(0)

  function update(patch: Partial<CartQuery>) {
    // Any change to what is being looked at goes back to page one - staying on
    // page 4 of a list that now has two pages shows an empty screen and reads
    // as "no baskets".
    setQuery((current) => ({ ...current, page: 1, ...patch }))
  }

  // The two typed boxes are debounced into the query object, so the list does
  // not fire a request per keystroke.
  useEffect(() => {
    if (searchBox === query.search) return
    const timer = setTimeout(() => update({ search: searchBox }), 300)
    return () => clearTimeout(timer)
  }, [searchBox, query.search])

  useEffect(() => {
    if (minValueBox === query.minValue) return
    const timer = setTimeout(() => update({ minValue: minValueBox }), 400)
    return () => clearTimeout(timer)
  }, [minValueBox, query.minValue])

  // Keep the address bar in step, without pushing a history entry per keystroke.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = cartQueryToParams(query)
    // The tab this screen lives on is itself a query parameter of the shop's
    // orders page. Dropping it would send the back button to the orders list.
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab) params.set('tab', tab)
    const search = params.toString()
    window.history.replaceState(null, '', search ? `${window.location.pathname}?${search}` : window.location.pathname)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = cartQueryToParams(query)
      params.set('page', String(query.page))
      params.set('perPage', String(query.perPage))
      const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts?${params.toString()}`)
      if (!response.ok) { setError('Could not load the abandoned baskets.'); return }
      const data = await response.json()
      setCarts(data.carts ?? [])
      setCounts(data.counts ?? {})
      setTotal(data.total ?? 0)
      setSymbol(data.currencySymbol ?? '£')
      if (data.settings) setRules(data.settings)
      setNow(Date.now())
      // Drop the selection whenever the view changes - a bulk delete must never
      // touch a basket that is no longer on screen.
      setSelected(new Set())
      setError(null)
    } catch {
      setError('Could not load the abandoned baskets.')
    } finally {
      setLoading(false)
    }
  }, [query])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  // The tiles are their own call: they cover the whole shop rather than the
  // current filter, so paging through a list has no business re-running them.
  useEffect(() => {
    let live = true
    fetch('/api/m/abandoned-carts-for-shop/admin/carts?stats=1')
      .then(async (response) => {
        if (!response.ok || !live) return
        const data = await response.json()
        setStats(data.stats ?? null)
      })
      .catch(() => {})
    return () => { live = false }
  }, [statsToken])

  const open = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    setOpenLines([])
    setOpenLog([])
    setOpenLoading(true)
    try {
      const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts/${id}`)
      if (response.ok) {
        const data = await response.json()
        setOpenLines(data.lines ?? [])
        setOpenLog(data.reminders ?? [])
      }
    } catch {
      // The row's own details are already on screen; the item names and the
      // reminder history are the only things missing, and an error box over the
      // whole list for that would be out of proportion.
    } finally {
      setOpenLoading(false)
    }
  }, [openId])

  const remove = useCallback(async (cart: AbandonedCart) => {
    const who = cart.customerName || cart.customerEmail || 'this shopper'
    if (!(await confirm({
      title: 'Delete this basket?',
      message: `Everything ${who} typed goes with it, along with the record of any reminder sent about it. This cannot be undone.`,
      confirmLabel: 'Delete it',
      danger: true,
    }))) return
    const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts/${cart.id}`, { method: 'DELETE' })
    if (!response.ok) { setError('Could not delete that basket.'); return }
    if (openId === cart.id) setOpenId(null)
    setStatsToken((n) => n + 1)
    await load()
  }, [confirm, load, openId])

  const removeSelected = useCallback(async () => {
    const ids = [...selected]
    if (!(await confirm({
      title: `Delete ${ids.length} basket${ids.length === 1 ? '' : 's'}?`,
      message: 'Everything those shoppers typed goes with them, along with the record of any reminders sent. This cannot be undone.',
      confirmLabel: 'Delete them',
      danger: true,
    }))) return
    setBusy(true)
    const response = await fetch('/api/m/abandoned-carts-for-shop/admin/carts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', ids }),
    })
    setBusy(false)
    if (!response.ok) { setError('Those baskets could not be deleted.'); return }
    setOpenId(null)
    setStatsToken((n) => n + 1)
    await load()
  }, [confirm, load, selected])

  const remind = useCallback(async (cart: AbandonedCart) => {
    const already = cart.reminderCount > 0
      ? `They have already had ${cart.reminderCount === 1 ? 'one reminder' : `${cart.reminderCount} reminders`} about this basket. `
      : ''
    if (!(await confirm({
      title: 'Send the reminder now?',
      message: `${already}The basket reminder goes to ${cart.customerEmail}, worded as you have it in Settings > Emails.`,
      confirmLabel: 'Send it',
    }))) return
    setBusy(true)
    const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts/${cart.id}/remind`, { method: 'POST' })
    setBusy(false)
    const data = (await response.json().catch(() => ({}))) as { error?: string; sentTo?: string }
    if (!response.ok) {
      await alert(data.error ?? 'That reminder could not be sent.', 'Nothing was sent')
      await load()
      return
    }
    await alert(`Sent to ${data.sentTo}.`, 'On its way')
    setStatsToken((n) => n + 1)
    if (openId === cart.id) {
      const refreshed = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts/${cart.id}`)
      if (refreshed.ok) setOpenLog(((await refreshed.json()) as { reminders?: ReminderLogEntry[] }).reminders ?? [])
    }
    await load()
  }, [alert, confirm, load, openId])

  const loadSuppressions = useCallback(async () => {
    const response = await fetch('/api/m/abandoned-carts-for-shop/admin/suppressions')
    if (!response.ok) return
    const data = (await response.json()) as { suppressions?: Suppression[] }
    setSuppressions(data.suppressions ?? [])
  }, [])

  const unsuppress = useCallback(async (email: string) => {
    if (!(await confirm({
      title: 'Put this address back on?',
      message: `${email} asked not to be reminded again. Only do this if they have asked you to - it does not undo a "don't email me" ticked in the checkout.`,
      confirmLabel: 'Put them back on',
    }))) return
    const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/suppressions?email=${encodeURIComponent(email)}`, { method: 'DELETE' })
    if (!response.ok) { setError('That address could not be taken off the list.'); return }
    setStatsToken((n) => n + 1)
    await loadSuppressions()
    await load()
  }, [confirm, load, loadSuppressions])

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((current) => (carts.every((cart) => current.has(cart.id)) ? new Set() : new Set(carts.map((cart) => cart.id))))
  }

  function sortBy(column: CartSort, alternate: CartSort) {
    update({ sort: query.sort === column ? alternate : column })
  }

  function clearFilters() {
    setSearchBox('')
    setMinValueBox('')
    setQuery({ ...DEFAULT_CART_QUERY, perPage: query.perPage, sort: query.sort })
  }

  const pageCount = Math.max(1, Math.ceil(total / query.perPage))
  const firstOnPage = total === 0 ? 0 : (query.page - 1) * query.perPage + 1
  const lastOnPage = Math.min(query.page * query.perPage, total)
  const filtered = cartQueryIsFiltered(query)
  const allOnPage = carts.length > 0 && carts.every((cart) => selected.has(cart.id))
  const datePreset = useMemo(() => {
    const match = DATE_PRESETS.find((preset) => preset.days != null && query.dateFrom === isoDay(preset.days) && !query.dateTo)
    if (match) return match.value
    return query.dateFrom || query.dateTo ? 'custom' : ''
  }, [query.dateFrom, query.dateTo])

  // The tiles are only "on" when the list is showing exactly what they count,
  // so an owner can tell at a glance whether they are looking at the whole shop
  // or at the slice a tile put them in.
  const tileActive = {
    checkout: query.filter === 'checkout' && !hasNarrowingFilters(query),
    recovered: query.filter === 'recovered' && !hasNarrowingFilters(query),
    failed: query.reminded === 'failed',
  }

  const jobLine = describeJob(stats, now)

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: abandonedCartsCss }} />
      {alertNode}
      {confirmNode}

      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <div className="page-header">
        <div>
          <h1 className="page-title">Abandoned baskets</h1>
          <p className="abc-count">
            {loading ? 'Loading…' : `${total} basket${total === 1 ? '' : 's'}${filtered ? ' match these filters' : ''}`}
            {!loading && ` · kept for ${rules.retentionDays} days`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setShowUnsubscribed((current) => !current)
              if (!showUnsubscribed) void loadSuppressions()
            }}
          >
            {showUnsubscribed ? 'Hide unsubscribes' : `Unsubscribes${stats ? ` (${stats.unsubscribedCount})` : ''}`}
          </button>
          <a className="btn btn-secondary btn-sm" href={`/api/m/abandoned-carts-for-shop/admin/carts/export?${cartQueryToParams(query)}`}>
            Export CSV
          </a>
        </div>
      </div>

      {stats && (
        <div className="abc-tiles">
          <div className="abc-tile">
            <span className="abc-tile-label">Left behind</span>
            <span className="abc-tile-value">{formatMoney(stats.openValue, symbol)}</span>
            <span className="abc-tile-note">{stats.openCount} basket{stats.openCount === 1 ? '' : 's'} nobody finished</span>
          </div>
          <button
            type="button"
            className={`abc-tile${tileActive.checkout ? ' is-active' : ''}`}
            onClick={() => update({ ...DEFAULT_CART_QUERY, perPage: query.perPage, sort: query.sort, filter: 'checkout' })}
          >
            <span className="abc-tile-label">Got as far as checkout</span>
            <span className="abc-tile-value">{stats.checkoutCount}</span>
            <span className="abc-tile-note">worth {formatMoney(stats.checkoutValue, symbol)}</span>
          </button>
          <button
            type="button"
            className={`abc-tile${tileActive.recovered ? ' is-active' : ''}`}
            onClick={() => update({ ...DEFAULT_CART_QUERY, perPage: query.perPage, sort: query.sort, filter: 'recovered' })}
          >
            <span className="abc-tile-label">Came back</span>
            <span className="abc-tile-value">{stats.recoveryRate === null ? '—' : `${stats.recoveryRate}%`}</span>
            <span className="abc-tile-note">
              {stats.recoveryRate === null
                ? 'nothing to measure yet'
                : `${stats.recoveredCount} in all, worth ${formatMoney(stats.recoveredValue, symbol)}`}
            </span>
          </button>
          <div className="abc-tile">
            <span className="abc-tile-label">Reminders, 30 days</span>
            <span className="abc-tile-value">{stats.remindersSent30d}</span>
            <span className="abc-tile-note">
              {rules.emailsEnabled ? `${stats.withEmailCount} baskets have an address on them` : 'reminder emails are switched off'}
            </span>
          </div>
          <button
            type="button"
            className={`abc-tile${stats.remindersFailed30d > 0 ? ' is-attention' : ''}${tileActive.failed ? ' is-active' : ''}`}
            onClick={() => update({ reminded: query.reminded === 'failed' ? '' : 'failed' })}
          >
            <span className="abc-tile-label">Would not send</span>
            <span className="abc-tile-value">{stats.remindersFailed30d}</span>
            <span className="abc-tile-note">{stats.remindersFailed30d > 0 ? 'worth a look' : 'nothing has bounced'}</span>
          </button>
        </div>
      )}

      {jobLine && (
        <div className={`abc-health${jobLine.warning ? ' is-warning' : ''}`}>
          <span>{jobLine.text}</span>
          <span className="abc-health-spacer" />
        </div>
      )}

      {showUnsubscribed && (
        <div className="abc-wrap" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.8125rem', margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            Asked us to stop
          </h2>
          <p className="abc-muted" style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem' }}>
            Addresses that have used the link at the bottom of a reminder. Nothing goes to any of them again, whatever
            baskets they leave in future.
          </p>
          {suppressions.length === 0 && <p className="abc-muted" style={{ margin: 0 }}>Nobody, so far.</p>}
          <ul className="abc-supp">
            {suppressions.map((entry) => (
              <li key={entry.email}>
                <span>
                  {entry.email}
                  <span className="abc-sub">{formatWhen(entry.createdAt)}</span>
                </span>
                {canManage && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void unsuppress(entry.email)}>
                    Put back on
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="abc-toolbar">
        <input
          className="abc-search"
          value={searchBox}
          placeholder="Name, email, phone, postcode, discount code or order number"
          aria-label="Search abandoned baskets"
          onChange={(event) => setSearchBox(event.target.value)}
        />
        <div className="abc-seg" role="group" aria-label="Which baskets">
          {CART_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={query.filter === key ? 'is-active' : ''}
              onClick={() => update({ filter: key as CartFilter })}
            >
              {CART_FILTER_LABELS[key]} ({counts[key] ?? 0})
            </button>
          ))}
        </div>
        <select
          className="abc-select"
          value={query.sort}
          aria-label="Sort by"
          onChange={(event) => update({ sort: event.target.value as CartSort })}
        >
          {CART_SORTS.map((sort) => <option key={sort} value={sort}>{CART_SORT_LABELS[sort]}</option>)}
        </select>
      </div>

      <div className="abc-filters">
        <span className="abc-filters-label">Narrow it down</span>
        <select
          className="abc-select"
          value={datePreset}
          aria-label="Last seen"
          onChange={(event) => {
            const preset = DATE_PRESETS.find((entry) => entry.value === event.target.value)
            update({ dateFrom: preset?.days ? isoDay(preset.days) : '', dateTo: '' })
          }}
        >
          {DATE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          {datePreset === 'custom' && <option value="custom">Between two dates</option>}
        </select>
        <input
          className="abc-date"
          type="date"
          value={query.dateFrom}
          aria-label="Last seen from"
          onChange={(event) => update({ dateFrom: event.target.value })}
        />
        <input
          className="abc-date"
          type="date"
          value={query.dateTo}
          aria-label="Last seen to"
          onChange={(event) => update({ dateTo: event.target.value })}
        />
        <select
          className="abc-select"
          value={query.contact}
          aria-label="Contact details"
          onChange={(event) => update({ contact: event.target.value as CartQuery['contact'] })}
        >
          <option value="">Anyone</option>
          <option value="with-email">Left an email address</option>
          <option value="without-email">No email address</option>
        </select>
        <select
          className="abc-select"
          value={query.reminded}
          aria-label="Reminder"
          onChange={(event) => update({ reminded: event.target.value as CartQuery['reminded'] })}
        >
          <option value="">Reminded or not</option>
          <option value="yes">Has been reminded</option>
          <option value="no">Never reminded</option>
          <option value="failed">A reminder would not send</option>
          <option value="blocked">Cannot be emailed</option>
        </select>
        <select
          className="abc-select"
          value={query.payment}
          aria-label="Payment"
          onChange={(event) => update({ payment: event.target.value as CartQuery['payment'] })}
        >
          <option value="">However it ended</option>
          <option value="attempted">Sent to pay, never came back</option>
          <option value="failed">Payment refused</option>
        </select>
        <input
          className="abc-number"
          inputMode="decimal"
          value={minValueBox}
          placeholder={`Worth ${symbol}0+`}
          aria-label="Worth at least"
          onChange={(event) => setMinValueBox(event.target.value.replace(/[^0-9.]/g, ''))}
        />
        {filtered && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {canManage && selected.size > 0 && (
        <div className="abc-bulkbar">
          <span className="abc-bulkbar-count">{selected.size} selected</span>
          <span className="abc-bulkbar-spacer" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void removeSelected()}>
            Delete them
          </button>
        </div>
      )}

      <div className="abc-wrap">
        <table className="abc-table">
          <thead>
            <tr>
              {canManage && (
                <th className="abc-check">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    aria-label="Select every basket on this page"
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th>Shopper</th>
              <th>Stage</th>
              <th
                className="abc-sortable abc-right"
                tabIndex={0}
                role="button"
                onClick={() => sortBy('items-high', 'recent')}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sortBy('items-high', 'recent') } }}
              >
                Items{query.sort === 'items-high' && <span className="abc-sort-arrow">▼</span>}
              </th>
              <th
                className="abc-sortable abc-right"
                tabIndex={0}
                role="button"
                onClick={() => sortBy('value-high', 'value-low')}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sortBy('value-high', 'value-low') } }}
              >
                Worth{query.sort === 'value-high' && <span className="abc-sort-arrow">▼</span>}{query.sort === 'value-low' && <span className="abc-sort-arrow">▲</span>}
              </th>
              <th>Reminder</th>
              <th
                className="abc-sortable"
                tabIndex={0}
                role="button"
                onClick={() => sortBy('recent', 'oldest')}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sortBy('recent', 'oldest') } }}
              >
                Last seen{query.sort === 'recent' && <span className="abc-sort-arrow">▼</span>}{query.sort === 'oldest' && <span className="abc-sort-arrow">▲</span>}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && carts.length === 0 && (
              <tr>
                <td colSpan={canManage ? 8 : 7}>
                  <div className="abc-empty">
                    {filtered
                      ? 'No basket matches that. Try widening the dates, or clearing the filters.'
                      : 'Nothing here. Either everybody is finishing what they started, or nobody has agreed to the cookie that lets us watch - the settings tab says which.'}
                  </div>
                </td>
              </tr>
            )}
            {carts.map((cart) => {
              const isOpen = openId === cart.id
              const stale = now > 0 && !cart.recoveredAt && now - new Date(cart.updatedAt).getTime() > rules.abandonAfterMinutes * 60000
              const state = describeReminder(cart, rules)
              const address = addressLines(cart)
              const canRemind = canManage && !reminderBlockedReason(cart)
              return (
                <Fragment key={cart.id}>
                  <tr className={isOpen ? 'is-open' : ''}>
                    {canManage && (
                      <td className="abc-check">
                        <input
                          type="checkbox"
                          checked={selected.has(cart.id)}
                          aria-label={`Select the basket left by ${cart.customerName || cart.customerEmail || 'an unknown shopper'}`}
                          onChange={() => toggle(cart.id)}
                        />
                      </td>
                    )}
                    <td>
                      <button type="button" className="abc-name" aria-expanded={isOpen} onClick={() => void open(cart.id)}>
                        {cart.customerName || cart.customerEmail || 'Not given'}
                      </button>
                      {cart.customerEmail && cart.customerName && <span className="abc-sub">{cart.customerEmail}</span>}
                      {!cart.customerEmail && !cart.customerName && <span className="abc-sub">Nothing typed yet</span>}
                      {cart.customerPhone && <span className="abc-sub">{cart.customerPhone}</span>}
                    </td>
                    <td className="abc-nowrap">
                      {cart.recoveredAt ? (
                        <span className="badge badge-success">Came back</span>
                      ) : (
                        <span className={stale ? 'badge badge-warning' : 'badge badge-default'}>
                          {stale ? 'Abandoned' : STAGE_LABELS[cart.stage]}
                        </span>
                      )}
                      {cart.recoveredAt && cart.recoveredOrderNumber && (
                        <a className="abc-sub" href={`/${adminPath}/shop/orders?search=${encodeURIComponent(cart.recoveredOrderNumber)}`}>
                          {cart.recoveredOrderNumber}
                        </a>
                      )}
                      {!cart.recoveredAt && stale && <span className="abc-sub">{STAGE_LABELS[cart.stage]}</span>}
                      {!cart.recoveredAt && cart.paymentStage && (
                        <span className="abc-sub">{PAYMENT_STAGE_LABELS[cart.paymentStage]}</span>
                      )}
                    </td>
                    <td className="abc-right">{cart.itemCount}</td>
                    <td className="abc-right abc-nowrap">{formatMoney(cart.subtotal, symbol)}</td>
                    <td>
                      <span className={TONE_BADGE[state.tone]}>{state.label}</span>
                      {state.at && <span className="abc-sub">{formatWhen(state.at)}</span>}
                      {state.detail && <span className="abc-sub">{state.detail}</span>}
                      {!state.at && state.nextDueAt && <span className="abc-sub">{formatAge(state.nextDueAt, now)}</span>}
                      {state.at && state.nextDueAt && <span className="abc-sub">Next {formatAge(state.nextDueAt, now)}</span>}
                    </td>
                    <td className="abc-nowrap">
                      {formatAge(cart.updatedAt, now)}
                      <span className="abc-sub">{formatWhen(cart.updatedAt)}</span>
                    </td>
                    <td className="abc-right abc-nowrap">
                      {canRemind && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void remind(cart)}>
                          Remind
                        </button>
                      )}
                      {canManage && (
                        <button type="button" className="btn btn-sm" style={{ marginLeft: '0.375rem' }} onClick={() => void remove(cart)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="is-open">
                      <td colSpan={canManage ? 8 : 7}>
                        <div className="abc-detail">
                          <div>
                            <h3>What they typed</h3>
                            <p className="abc-detail-line">{cart.customerName || <span className="abc-muted">No name</span>}</p>
                            {cart.customerEmail && (
                              <p className="abc-detail-line">
                                <a href={`mailto:${cart.customerEmail}`}>{cart.customerEmail}</a>
                              </p>
                            )}
                            {cart.customerPhone && <p className="abc-detail-line">{cart.customerPhone}</p>}
                            {address.length > 0 && (
                              <div style={{ marginTop: '0.5rem' }}>
                                {address.map((line) => <p key={line} className="abc-detail-line">{line}</p>)}
                              </div>
                            )}
                            {cart.couponCode && <p className="abc-detail-line" style={{ marginTop: '0.5rem' }}>Discount code: {cart.couponCode}</p>}
                            {cart.paymentMethod && <p className="abc-detail-line">Was paying by: {cart.paymentMethod}</p>}
                          </div>

                          <div>
                            <h3>In the basket</h3>
                            {openLoading && <p className="abc-muted abc-detail-line">Loading…</p>}
                            {!openLoading && openLines.length === 0 && <p className="abc-muted abc-detail-line">Nothing left in it.</p>}
                            {!openLoading && openLines.map((line, index) => (
                              <p className="abc-detail-line" key={line.lineId ?? `${line.productId}-${index}`}>
                                {line.quantity} × {line.name ?? 'Product no longer in the catalogue'}
                                {line.unitPrice !== null && <span className="abc-muted"> · {formatMoney(line.unitPrice, symbol)}</span>}
                              </p>
                            ))}
                          </div>

                          <div>
                            <h3>What happened</h3>
                            <p className="abc-detail-line">First seen {formatWhen(cart.firstSeenAt)}</p>
                            {cart.checkoutStartedAt && <p className="abc-detail-line">Reached checkout {formatWhen(cart.checkoutStartedAt)}</p>}
                            {cart.paymentAttemptedAt && (
                              <p className="abc-detail-line">
                                Pressed Place order {formatWhen(cart.paymentAttemptedAt)}
                                {cart.paymentStage === 'ATTEMPTED' && ' - and never came back'}
                              </p>
                            )}
                            {cart.paymentStage === 'FAILED' && (
                              <p className="abc-detail-line">
                                The payment was refused
                                {cart.paymentFailureReason ? `: “${cart.paymentFailureReason}”` : '.'}
                              </p>
                            )}
                            {cart.recoveredAt && <p className="abc-detail-line">Ordered {formatWhen(cart.recoveredAt)}</p>}
                            <p className="abc-detail-line abc-muted" style={{ marginTop: '0.5rem' }}>
                              {/* 'none' is only ever an older row: this module used to record when a
                                  site's banner asked nothing. It no longer does, and a row that
                                  predates that says so plainly rather than being quietly relabelled. */}
                              {cart.consentBasis === 'none'
                                ? 'Recorded before this site asked about marketing cookies'
                                : `Recorded with ${cart.consentBasis} consent`}
                            </p>
                          </div>

                          <div>
                            <h3>Reminders</h3>
                            {openLoading && <p className="abc-muted abc-detail-line">Loading…</p>}
                            {!openLoading && openLog.length === 0 && (
                              <p className="abc-muted abc-detail-line">
                                Nothing has been sent about this basket.
                                {state.detail ? ` ${state.detail}.` : ''}
                              </p>
                            )}
                            {!openLoading && openLog.length > 0 && (
                              <ul className="abc-log">
                                {openLog.map((entry) => (
                                  <li key={entry.id} className={entry.status === 'SENT' ? 'tone-sent' : entry.status === 'FAILED' ? 'tone-failed' : 'tone-none'}>
                                    <span>
                                      {REMINDER_STATUS_LABELS[entry.status]}
                                      {entry.trigger === 'MANUAL' && (entry.sentByName ? ` by ${entry.sentByName}` : ' by hand')}
                                    </span>
                                    <span className="abc-log-when">{formatWhen(entry.createdAt)} · to {entry.email}</span>
                                    {entry.subject && <span className="abc-log-detail">“{entry.subject}”</span>}
                                    {entry.detail && <span className="abc-log-detail">{entry.detail}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {state.nextDueAt && (
                              <p className="abc-detail-line abc-muted" style={{ marginTop: '0.5rem' }}>
                                Next one due {formatAge(state.nextDueAt, now)}.
                              </p>
                            )}
                            {cart.marketingOptOut && (
                              <p className="abc-detail-line abc-muted" style={{ marginTop: '0.5rem' }}>
                                They ticked the box in the checkout asking not to be emailed about this one.
                              </p>
                            )}
                            {cart.suppressed && (
                              <p className="abc-detail-line abc-muted" style={{ marginTop: '0.5rem' }}>
                                This address has unsubscribed. Nothing will go to it again, on this basket or any other.
                              </p>
                            )}
                            <div className="abc-actions">
                              {canRemind && (
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void remind(cart)}>
                                  Send a reminder now
                                </button>
                              )}
                              {cart.customerEmail && (
                                <a className="btn btn-secondary btn-sm" href={`mailto:${cart.customerEmail}`}>Write to them yourself</a>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="abc-pager">
        <span className="abc-muted" style={{ fontSize: '0.8125rem' }}>
          {total === 0 ? 'Nothing to show' : `${firstOnPage}-${lastOnPage} of ${total}`}
        </span>
        <span className="abc-pager-spacer" />
        <select
          className="abc-select"
          value={String(query.perPage)}
          aria-label="Baskets per page"
          onChange={(event) => update({ perPage: Number(event.target.value) })}
        >
          {[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size} per page</option>)}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={query.page <= 1 || loading}
          onClick={() => setQuery((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
        >
          Previous
        </button>
        <span className="abc-muted" style={{ fontSize: '0.8125rem' }}>Page {query.page} of {pageCount}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={query.page >= pageCount || loading}
          onClick={() => setQuery((current) => ({ ...current, page: Math.min(pageCount, current.page + 1) }))}
        >
          Next
        </button>
      </div>
    </div>
  )
}

/** True when anything OTHER than the stage filter is narrowing the list. Used
 *  only to decide whether a tile counts as "on": a tile that lights up while a
 *  search box is also filtering the list is claiming to show a figure it is not
 *  showing. */
function hasNarrowingFilters(query: CartQuery): boolean {
  return Boolean(query.search || query.contact || query.reminded || query.payment || query.minValue || query.dateFrom || query.dateTo)
}

/**
 * The line under the tiles: is the thing that sends the reminders alive?
 *
 * Worth its own line because there is no other way to tell. A cron that has
 * silently stopped firing, a CRON_SECRET nobody set, a site on a plan that only
 * runs the job once a day - all three look exactly like a shop where nothing is
 * due, and an owner would happily wait a fortnight for emails that were never
 * going to go.
 */
function describeJob(stats: AbandonedCartsStats | null, now: number): { text: string; warning: boolean } | null {
  if (!stats) return null
  const run = stats.lastRun
  if (!run) {
    return {
      text: 'The hourly tidy-up has not run yet. It goes off on its own once the site has been live for an hour; if this is still here tomorrow, something is stopping it.',
      warning: true,
    }
  }
  const age = formatAge(run.ranAt, now)
  if (run.error) {
    return { text: `The last tidy-up, ${age}, did not finish: ${run.error}`, warning: true }
  }
  const bits: string[] = []
  if (run.sent > 0) bits.push(`${run.sent} reminder${run.sent === 1 ? '' : 's'} sent`)
  if (run.failed > 0) bits.push(`${run.failed} would not send`)
  if (run.skipped > 0) bits.push(`${run.skipped} skipped`)
  if (run.purged > 0) bits.push(`${run.purged} old basket${run.purged === 1 ? '' : 's'} cleared out`)
  const stale = now > 0 && now - new Date(run.ranAt).getTime() > 26 * 60 * 60 * 1000
  return {
    text: `Last tidy-up ${age}${bits.length > 0 ? `: ${bits.join(', ')}` : ' - nothing needed doing'}.`,
    warning: stale || run.failed > 0,
  }
}
