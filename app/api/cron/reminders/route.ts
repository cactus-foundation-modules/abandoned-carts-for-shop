// GET/POST /api/m/abandoned-carts-for-shop/cron/reminders
//
// Hourly Vercel cron: deletes baskets past their retention date, then sends the
// reminders that are due. Same CRON_SECRET bearer as every other module's cron.
//
// Hourly rather than daily because a basket reminder that lands the next morning
// is a different email from one that lands four hours later, and only one of
// them still catches somebody who was interrupted. A site on Vercel's Hobby plan
// gets one run a day whatever this says, which still purges and still reminds -
// just later.
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { recordFailedRun, runAbandonedCartJob } from '@/modules/abandoned-carts-for-shop/lib/reminders'

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)

  const startedAt = Date.now()
  try {
    const result = await runAbandonedCartJob()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'abandoned basket run failed'
    // Written down before the 500 goes back. A run that died at the first query
    // is the one an owner most needs to see on the screen, and a cron failure
    // nobody is watching the logs for is otherwise invisible.
    await recordFailedRun(startedAt, message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
