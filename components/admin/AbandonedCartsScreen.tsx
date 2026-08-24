'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { formatMoney } from '@/modules/shop/lib/money'
import {
  PAYMENT_STAGE_LABELS,
  STAGE_LABELS,
  type AbandonedCart,
  type ResolvedCartLine,
} from '@/modules/abandoned-carts-for-shop/lib/types'

// The Abandoned baskets list: every basket nobody finished, newest activity
// first, with what the shopper had typed before they went.
//
// Baskets and started checkouts share one table on purpose. They are the same
// shopper at two points in the same journey, and an owner opening this screen
// wants one answer to "what nearly happened today?" rather than two lists to
// reconcile. The filter above the table is there for when they want one or the
// other.

const card = { border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' } as const
const cell = { padding: '0.5rem 0.75rem 0.5rem 0', borderBottom: '1px solid var(--color-border)' } as const
const muted = { color: 'var(--color-text-secondary)' } as const

type Filter = 'all' | 'basket' | 'checkout' | 'recovered'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Everything',
  basket: 'Basket only',
  checkout: 'Checkout started',
  recovered: 'Came back',
}

const PER_PAGE = 25

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "20 minutes ago", "3 days ago". The age is the column an owner reads first:
 *  a basket left four minutes ago is somebody still shopping, and one left four
 *  days ago is a different conversation entirely.
 *
 *  "Now" is passed in rather than read from the clock, because reading the clock
 *  while rendering makes the same row render differently on a re-render nobody
 *  asked for. It is stamped once per load, which is also when the figures it is
 *  compared against were true. */
function formatAge(value: string, now: number): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then) || now === 0) return ''
  const minutes = Math.max(0, Math.round((now - then) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function addressLines(cart: AbandonedCart): string[] {
  const a = cart.shippingAddress
  if (!a) return []
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ')
  return [name, a.company, a.line1, a.line2, a.city, a.county, a.postcode, a.country]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
}

export function AbandonedCartsScreen({ canManage }: { canManage: boolean }) {
  const [carts, setCarts] = useState<AbandonedCart[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [symbol, setSymbol] = useState('£')
  const [abandonAfter, setAbandonAfter] = useState(60)
  // The clock as it stood when the list was last fetched. See formatAge.
  const [now, setNow] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  // What is actually queried, kept apart from what is being typed so the list
  // does not fire a query per keystroke.
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [openLines, setOpenLines] = useState<ResolvedCartLine[]>([])
  const [openLoading, setOpenLoading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter, page: String(page), perPage: String(PER_PAGE) })
      if (appliedSearch) params.set('search', appliedSearch)
      const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts?${params.toString()}`)
      if (!response.ok) { setError('Could not load the abandoned baskets.'); return }
      const data = await response.json()
      setCarts(data.carts ?? [])
      setCounts(data.counts ?? {})
      setTotal(data.total ?? 0)
      setSymbol(data.currencySymbol ?? '£')
      setAbandonAfter(data.abandonAfterMinutes ?? 60)
      setNow(Date.now())
      setError(null)
    } catch {
      setError('Could not load the abandoned baskets.')
    } finally {
      setLoading(false)
    }
  }, [filter, appliedSearch, page])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async loader; every setState runs after an await
  useEffect(() => { void load() }, [load])

  // Narrowing the list puts you back on page one; staying on page 4 of a filter
  // with one page of results shows an empty table and looks broken.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting a dependent control, not deriving render state
  useEffect(() => { setPage(1) }, [filter, appliedSearch])

  const open = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    setOpenLines([])
    setOpenLoading(true)
    try {
      const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts/${id}`)
      if (response.ok) {
        const data = await response.json()
        setOpenLines(data.lines ?? [])
      }
    } catch {
      // The row's own details are already on screen; the item names are the
      // only thing missing, and an error box over the whole list for that would
      // be out of proportion.
    } finally {
      setOpenLoading(false)
    }
  }, [openId])

  const remove = useCallback(async (id: string) => {
    if (!window.confirm('Delete this basket and everything the shopper typed? This cannot be undone.')) return
    const response = await fetch(`/api/m/abandoned-carts-for-shop/admin/carts/${id}`, { method: 'DELETE' })
    if (!response.ok) { setError('Could not delete that basket.'); return }
    if (openId === id) setOpenId(null)
    await load()
  }, [load, openId])

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))
  const firstOnPage = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const lastOnPage = Math.min(page * PER_PAGE, total)

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <label htmlFor="abc-filter" style={{ fontSize: '0.8125rem', ...muted }}>Show</label>
            <select id="abc-filter" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
                <option key={key} value={key}>{FILTER_LABELS[key]} ({counts[key] ?? 0})</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gap: '0.25rem', flex: '1 1 220px' }}>
            <label htmlFor="abc-search" style={{ fontSize: '0.8125rem', ...muted }}>Search</label>
            <input
              id="abc-search"
              value={search}
              placeholder="Name, email, phone or order number"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>
          {loading
            ? 'Loading…'
            : total > PER_PAGE
              ? `${firstOnPage}-${lastOnPage} of ${total} baskets`
              : `${total} basket${total === 1 ? '' : 's'}`}
        </h2>

        {!loading && carts.length === 0 && (
          <p style={{ margin: 0, ...muted }}>
            Nothing here. Either everybody is finishing what they started, or nobody has agreed to
            the cookie that lets us watch - the settings tab says which.
          </p>
        )}

        {carts.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  {['Shopper', 'Stage', 'Items', 'Worth', 'Last seen', ''].map((heading) => (
                    <th
                      key={heading}
                      style={{ ...cell, textAlign: heading === 'Worth' || heading === 'Items' ? 'right' : 'left', ...muted, fontWeight: 600, whiteSpace: 'nowrap' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {carts.map((cart) => {
                  const isOpen = openId === cart.id
                  const stale = now > 0 && now - new Date(cart.updatedAt).getTime() > abandonAfter * 60000
                  const address = addressLines(cart)
                  return (
                    <Fragment key={cart.id}>
                      <tr>
                        <td style={cell}>
                          <button
                            type="button"
                            onClick={() => void open(cart.id)}
                            style={{ appearance: 'none', background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-link, var(--color-text))', cursor: 'pointer', textAlign: 'left' }}
                            aria-expanded={isOpen}
                          >
                            {cart.customerName || cart.customerEmail || 'Not given'}
                          </button>
                          {cart.customerEmail && cart.customerName && (
                            <span style={{ display: 'block', ...muted }}>{cart.customerEmail}</span>
                          )}
                          {!cart.customerEmail && !cart.customerName && (
                            <span style={{ display: 'block', ...muted }}>Nothing typed yet</span>
                          )}
                        </td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                          {cart.recoveredAt
                            ? <span>Came back{cart.recoveredOrderNumber ? ` (${cart.recoveredOrderNumber})` : ''}</span>
                            : <span>{STAGE_LABELS[cart.stage]}</span>}
                          {!cart.recoveredAt && stale && (
                            <span style={{ display: 'block', ...muted }}>Abandoned</span>
                          )}
                          {cart.reminderCount > 0 && (
                            <span style={{ display: 'block', ...muted }}>
                              Reminded {cart.reminderCount === 1 ? 'once' : `${cart.reminderCount} times`}
                            </span>
                          )}
                          {!cart.recoveredAt && cart.paymentStage && (
                            <span style={{ display: 'block', ...muted }}>
                              {PAYMENT_STAGE_LABELS[cart.paymentStage]}
                            </span>
                          )}
                          {!cart.recoveredAt && cart.marketingOptOut && (
                            <span style={{ display: 'block', ...muted }}>No emails, please</span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>{cart.itemCount}</td>
                        <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(cart.subtotal, symbol)}</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                          {formatAge(cart.updatedAt, now)}
                          <span style={{ display: 'block', ...muted }}>{formatWhen(cart.updatedAt)}</span>
                        </td>
                        <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canManage && (
                            <button type="button" className="btn" onClick={() => void remove(cart.id)}>Delete</button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{ ...cell, background: 'var(--color-surface-subtle, transparent)' }}>
                            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', padding: '0.5rem 0' }}>
                              <div>
                                <h3 style={{ fontSize: '0.8125rem', margin: '0 0 0.35rem', ...muted }}>What they typed</h3>
                                <div>{cart.customerName || <span style={muted}>No name</span>}</div>
                                {cart.customerEmail && <div>{cart.customerEmail}</div>}
                                {cart.customerPhone && <div>{cart.customerPhone}</div>}
                                {address.length > 0 && (
                                  <div style={{ marginTop: '0.5rem' }}>
                                    {address.map((line) => <div key={line}>{line}</div>)}
                                  </div>
                                )}
                                {cart.couponCode && <div style={{ marginTop: '0.5rem' }}>Discount code: {cart.couponCode}</div>}
                                {cart.paymentMethod && <div>Was paying by: {cart.paymentMethod}</div>}
                              </div>
                              <div>
                                <h3 style={{ fontSize: '0.8125rem', margin: '0 0 0.35rem', ...muted }}>In the basket</h3>
                                {openLoading && <div style={muted}>Loading…</div>}
                                {!openLoading && openLines.length === 0 && <div style={muted}>Nothing left in it.</div>}
                                {!openLoading && openLines.map((line, index) => (
                                  <div key={line.lineId ?? `${line.productId}-${index}`}>
                                    {line.quantity} × {line.name ?? 'Product no longer in the catalogue'}
                                    {line.unitPrice !== null && (
                                      <span style={muted}> · {formatMoney(line.unitPrice, symbol)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div>
                                <h3 style={{ fontSize: '0.8125rem', margin: '0 0 0.35rem', ...muted }}>History</h3>
                                <div>First seen {formatWhen(cart.firstSeenAt)}</div>
                                {cart.checkoutStartedAt && <div>Reached checkout {formatWhen(cart.checkoutStartedAt)}</div>}
                                {cart.paymentAttemptedAt && (
                                  <div>
                                    Pressed Place order {formatWhen(cart.paymentAttemptedAt)}
                                    {cart.paymentStage === 'ATTEMPTED' && ' - and never came back'}
                                  </div>
                                )}
                                {cart.paymentStage === 'FAILED' && (
                                  <div>
                                    The payment was refused
                                    {cart.paymentFailureReason ? `: “${cart.paymentFailureReason}”` : '.'}
                                  </div>
                                )}
                                {cart.reminderSentAt && <div>Last reminded {formatWhen(cart.reminderSentAt)}</div>}
                                {cart.recoveredAt && <div>Ordered {formatWhen(cart.recoveredAt)}</div>}
                                {cart.marketingOptOut && (
                                  <div style={{ marginTop: '0.5rem' }}>
                                    Asked not to be emailed about this one, in the checkout. No
                                    reminder will go out on it.
                                  </div>
                                )}
                                <div style={{ marginTop: '0.5rem', ...muted }}>
                                  {/* 'none' is only ever an older row: this module used to
                                      record when a site's banner asked nothing. It no longer
                                      does, and a row that predates that says so plainly rather
                                      than being quietly relabelled. */}
                                  {cart.consentBasis === 'none'
                                    ? 'Recorded before this site asked about marketing cookies'
                                    : `Recorded with ${cart.consentBasis} consent`}
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
        )}

        {pageCount > 1 && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
            <button type="button" className="btn" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </button>
            <span style={{ fontSize: '0.875rem', ...muted }}>Page {page} of {pageCount}</span>
            <button type="button" className="btn" disabled={page >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
