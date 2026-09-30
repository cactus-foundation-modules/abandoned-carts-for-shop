import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  connectionUri,
  createTestDatabase,
  createTestRole,
  dropStaleTestObjects,
  dropTestDatabase,
  dropTestRole,
  testServerFromEnv,
  type TestRole,
  type TestServer,
} from '@/lib/backup/test-database'
import { DEFAULT_CART_QUERY } from '@/modules/abandoned-carts-for-shop/lib/types'

// "They saved their basket", against a real Postgres.
//
// The save rides on the same upsert as everything else the tracker reports, and
// the tracker repeats it on every report after it. Whether the recorded time
// stays put while the reference is unchanged - and moves when a new save comes
// in - is decided entirely by a CASE inside ON CONFLICT DO UPDATE, which is raw
// SQL that tsc, eslint and the build gate never execute.
//
// Gated like the other live suites: it needs the OVH server, makes cactus_rt_*
// databases and drops them afterwards.
const ENABLED = process.env.RUN_LEDGER_GUARDS === '1' || process.env.RUN_BACKUP_ROUNDTRIP === '1'
if (ENABLED) {
  try {
    ;(process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile('.env')
  } catch {
    // No .env - testServerFromEnv below fails the suite loudly rather than here.
  }
}
const suite = ENABLED ? describe : describe.skip

suite('saved baskets, against a real database', () => {
  let server: TestServer
  let role: TestRole
  let client: Client
  const databaseName = `cactus_rt_abcsave_${process.pid}`
  const roleName = `cactus_rt_role_abcsave_${process.pid}`

  // Imported after DATABASE_URL is set, because lib/db/prisma reads it when the
  // client is built.
  let carts: typeof import('./carts')

  const base = {
    memberId: null,
    stage: 'BASKET' as const,
    lines: [{ productId: 'p1', quantity: 2 }],
    itemCount: 2,
    subtotal: 40,
    currency: 'GBP',
    consentBasis: 'marketing',
    customerEmail: null,
    customerName: null,
    customerPhone: null,
    shippingAddress: null,
    couponCode: null,
    shippingRateId: null,
    paymentMethod: null,
    marketingOptOut: null,
    paymentStage: null,
    paymentFailureReason: null,
    saved: null,
  }

  async function row(visitorId: string): Promise<{ saved_at: Date | null; saved_reference: string | null }> {
    const result = await client.query(
      'SELECT "saved_at", "saved_reference" FROM "abc_carts" WHERE "visitor_id" = $1',
      [visitorId],
    )
    return result.rows[0]
  }

  beforeAll(async () => {
    server = testServerFromEnv()
    await dropStaleTestObjects(server)
    role = await createTestRole(server, roleName)
    await createTestDatabase(server, databaseName, role)

    const uri = connectionUri(server, databaseName, role)
    client = new Client({ connectionString: `${uri}&uselibpqcompat=true` })
    await client.connect()
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')

    // Core's schema first: the admin list joins core's users to name whoever
    // sent a reminder by hand.
    const coreInit = join(process.cwd(), 'prisma', 'migrations', '20260626000000_init', 'migration.sql')
    await client.query(readFileSync(coreInit, 'utf8'))

    // Every migration in order, 001 included - which already carries the new
    // columns - so the numbered file is proven idempotent on top of it too.
    const directory = join(__dirname, '..', '..', 'migrations')
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
      await client.query(readFileSync(join(directory, file), 'utf8'))
    }

    process.env.DATABASE_URL = uri
    carts = await import('./carts')
  }, 120_000)

  afterAll(async () => {
    await import('@/lib/db/prisma')
      .then((module) => module.prisma.$disconnect())
      .catch(() => undefined)
    await client?.end().catch(() => undefined)
    if (server) {
      await dropTestDatabase(server, databaseName).catch(() => undefined)
      await dropTestRole(server, roleName).catch(() => undefined)
    }
  }, 120_000)

  it('records nothing for an ordinary basket', async () => {
    await carts.captureCart({ ...base, visitorId: 'v-plain' })
    expect(await row('v-plain')).toEqual({ saved_at: null, saved_reference: null })
  })

  it('records a save, keeps its time while the same save is repeated, and never clears it', async () => {
    await carts.captureCart({ ...base, visitorId: 'v-save' })
    await carts.captureCart({ ...base, visitorId: 'v-save', saved: { reference: 'Q-0001' } })
    const first = await row('v-save')
    expect(first.saved_reference).toBe('Q-0001')
    expect(first.saved_at).toBeInstanceOf(Date)

    await new Promise((resolve) => setTimeout(resolve, 20))
    await carts.captureCart({ ...base, visitorId: 'v-save', saved: { reference: 'Q-0001' }, itemCount: 3 })
    expect(await row('v-save')).toEqual(first)

    await carts.captureCart({ ...base, visitorId: 'v-save' })
    expect(await row('v-save')).toEqual(first)
  })

  it('moves to a new save when the reference changes', async () => {
    const before = await row('v-save')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await carts.captureCart({ ...base, visitorId: 'v-save', saved: { reference: 'Q-0002' } })
    const after = await row('v-save')
    expect(after.saved_reference).toBe('Q-0002')
    expect(after.saved_at!.getTime()).toBeGreaterThan(before.saved_at!.getTime())
  })

  it('records a save on a brand new row', async () => {
    await carts.captureCart({ ...base, visitorId: 'v-new', saved: { reference: 'Q-0003' } })
    const fresh = await row('v-new')
    expect(fresh.saved_reference).toBe('Q-0003')
    expect(fresh.saved_at).toBeInstanceOf(Date)
  })

  it('leaves saved baskets out of the automatic reminder run', async () => {
    const withEmail = { ...base, customerEmail: 'jo@example.com' }
    await carts.captureCart({ ...withEmail, visitorId: 'v-due' })
    await carts.captureCart({ ...withEmail, visitorId: 'v-due-saved', saved: { reference: 'Q-0009' } })
    const due = await carts.listDueReminders({ olderThan: new Date(Date.now() + 60_000), maxPerCart: 3, limit: 50 })
    const references = due.map((cart) => cart.savedReference)
    expect(due.some((cart) => cart.savedAt === null && cart.customerEmail === 'jo@example.com')).toBe(true)
    expect(references).not.toContain('Q-0009')
  })

  it('hands the save to the admin list and the single-basket read', async () => {
    const { carts: listed } = await carts.listCarts(DEFAULT_CART_QUERY)
    const saved = listed.find((cart) => cart.savedReference === 'Q-0002')
    expect(saved?.savedAt).toEqual(expect.any(String))
    expect(listed.find((cart) => cart.savedReference === null && cart.savedAt === null)).toBeDefined()

    const one = await carts.getCart(saved!.id)
    expect(one?.savedReference).toBe('Q-0002')
    expect(one?.savedAt).toBe(saved!.savedAt)
  })
})
