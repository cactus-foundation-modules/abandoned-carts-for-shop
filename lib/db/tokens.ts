import { prisma } from '@/lib/db/prisma'

// The two tokens a reminder email carries, read on their own.
//
// Kept out of the shapes the admin screen and the API hand around, deliberately.
// These are the strings that let an unauthenticated caller stop the emails or
// fetch the basket back, and a value that never travels to a browser cannot leak
// from one - so the only thing that ever asks for them is the code about to put
// them in an email.

export type ReminderTokens = {
  unsubscribeToken: string
  recoveryToken: string
}

export async function getReminderTokens(cartId: string): Promise<ReminderTokens | null> {
  const rows = await prisma.$queryRaw<Array<{ unsubscribe_token: string; recovery_token: string }>>`
    SELECT "unsubscribe_token", "recovery_token" FROM "abc_carts" WHERE "id" = ${cartId} LIMIT 1
  `.catch(() => [] as Array<{ unsubscribe_token: string; recovery_token: string }>)
  const row = rows[0]
  if (!row?.unsubscribe_token || !row?.recovery_token) return null
  return { unsubscribeToken: row.unsubscribe_token, recoveryToken: row.recovery_token }
}
