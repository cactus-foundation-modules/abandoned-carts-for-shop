import { NextRequest, NextResponse } from 'next/server'
import { findByUnsubscribeToken, suppressEmail } from '@/modules/abandoned-carts-for-shop/lib/db/carts'

// GET/POST /api/m/abandoned-carts-for-shop/public/unsubscribe?t=<token>
//
// The way out of the reminder emails, and the reason those emails are lawful to
// send at all.
//
// GET draws a page with a button; POST is what actually stops the reminders.
// That split is not ceremony: mail clients and security scanners fetch every
// link in an email before a human sees it, so an unsubscribe that acts on GET
// unsubscribes people who never asked, and (worse) confirms to whoever fetched
// it that the address is real. The page is plain HTML with inline styles - it is
// two paragraphs and a button, reached from an email by somebody who is done
// with us, and standing the site's whole layout up around it would be a poor use
// of their patience.
//
// The token names one captured basket and nothing else. It is not derived from
// the address, so it cannot be guessed from one, and this route never says whose
// address it is - a page that read "unsubscribe jo@example.com?" would be a way
// of confirming an address to anybody holding a stolen link.

function page(body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Basket reminders</title></head>
<body style="margin:0;padding:2.5rem 1.25rem;background:#f7f6f3;color:#1f1d1a;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif">
<main style="max-width:32rem;margin:0 auto;background:#fff;border:1px solid #e5e0d8;border-radius:12px;padding:1.75rem">
${body}
</main></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function tokenFrom(request: NextRequest): string {
  return (new URL(request.url).searchParams.get('t') ?? '').trim().slice(0, 100)
}

export async function GET(request: NextRequest) {
  const token = tokenFrom(request)
  const record = token ? await findByUnsubscribeToken(token) : null
  if (!record?.email) {
    // Expired, already purged, or invented. One wording for all three: which of
    // them it was is not a stranger's business.
    return page(`<h1 style="font-size:1.25rem;margin:0 0 0.75rem">This link has expired</h1>
<p style="margin:0;color:#6b6355">There are no reminders outstanding for it. Nothing further to do.</p>`, 404)
  }

  return page(`<h1 style="font-size:1.25rem;margin:0 0 0.75rem">Stop basket reminders?</h1>
<p style="margin:0 0 1.25rem;color:#6b6355">We will not email you about an unfinished basket again. Orders you place still get their confirmations, as they must.</p>
<form method="post">
  <input type="hidden" name="t" value="${token.replace(/"/g, '&quot;')}" />
  <button type="submit" style="appearance:none;border:0;border-radius:8px;padding:0.7rem 1.1rem;background:#1a4c3a;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">Stop the reminders</button>
</form>`)
}

export async function POST(request: NextRequest) {
  // The form posts the token in its body; a client that kept it on the URL is
  // accepted too, since it is the same token either way.
  const form = await request.formData().catch(() => null)
  const fromForm = typeof form?.get('t') === 'string' ? String(form.get('t')).trim().slice(0, 100) : ''
  const token = fromForm || tokenFrom(request)

  const record = token ? await findByUnsubscribeToken(token) : null
  if (!record?.email) {
    return page(`<h1 style="font-size:1.25rem;margin:0 0 0.75rem">This link has expired</h1>
<p style="margin:0;color:#6b6355">There are no reminders outstanding for it. Nothing further to do.</p>`, 404)
  }

  await suppressEmail(record.email)
  return page(`<h1 style="font-size:1.25rem;margin:0 0 0.75rem">Done</h1>
<p style="margin:0;color:#6b6355">That address will not get basket reminders from us again.</p>`)
}
