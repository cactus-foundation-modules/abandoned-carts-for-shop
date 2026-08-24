import { prisma } from '@/lib/db/prisma'

// The unsubscribe token, read on its own.
//
// Kept out of the shapes the admin screen and the API hand around, deliberately.
// The token is the one string that lets an unauthenticated caller act on a
// basket, and a value that never travels to a browser cannot leak from one -
// so the only thing that ever asks for it is the code about to put it in an
// email.

export async function getUnsubscribeToken(cartId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ unsubscribe_token: string }>>`
    SELECT "unsubscribe_token" FROM "abc_carts" WHERE "id" = ${cartId} LIMIT 1
  `.catch(() => [] as Array<{ unsubscribe_token: string }>)
  return rows[0]?.unsubscribe_token ?? null
}
