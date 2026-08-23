import { prisma } from '@/lib/db/prisma'
import type { CartLine, ResolvedCartLine } from '@/modules/abandoned-carts-for-shop/lib/types'

// What the basket was worth, and what was in it, read from the shop's own
// catalogue.
//
// A cross-module READ, which is the one direction module isolation allows: this
// module hard-depends on shop, so shop's tables are guaranteed to be there, and
// nothing here writes to them or asks shop to change. It is the same raw-SQL
// read shop's own untyped code does on its own tables.
//
// The figure is an indication, not an invoice. Delivery, tax, discounts and
// anything a companion module does to a line are all left out on purpose: the
// only honest total for an order nobody placed is "roughly this much", and
// dressing it up as a real one would have an owner reconciling it against
// takings that never happened.

type ProductRow = {
  id: string
  name: string
  sku: string | null
  slug: string
  price: string | number
  sale_price: string | number | null
}

async function loadProducts(ids: string[]): Promise<Map<string, ProductRow>> {
  if (ids.length === 0) return new Map()
  // Capped rather than trusted: the ids arrive from a browser, and a list of ten
  // thousand of them is not a basket.
  const wanted = ids.slice(0, 200)
  const rows = await prisma.$queryRaw<ProductRow[]>`
    SELECT "id", "name", "sku", "slug", "price", "sale_price"
    FROM "shp_products" WHERE "id" = ANY(${wanted})
  `.catch(() => [] as ProductRow[])
  return new Map(rows.map((row) => [row.id, row]))
}

function unitPrice(row: ProductRow): number {
  // Sale price is the one that would actually have been charged, so it is the
  // one the basket is worth. Every other price type on a product is a display
  // decision the shop makes elsewhere.
  const sale = Number(row.sale_price)
  const full = Number(row.price)
  if (Number.isFinite(sale) && sale > 0) return sale
  return Number.isFinite(full) ? full : 0
}

/** Item count and rough value for a basket, for the list column and the sort. */
export async function summariseLines(lines: CartLine[]): Promise<{ itemCount: number; subtotal: number }> {
  const products = await loadProducts(lines.map((line) => line.productId))
  let itemCount = 0
  let subtotal = 0
  for (const line of lines) {
    const quantity = Math.max(0, Math.min(9999, Math.round(Number(line.quantity) || 0)))
    itemCount += quantity
    const row = products.get(line.productId)
    // A line whose product has since been deleted still counts as a thing they
    // wanted; it just cannot be priced.
    if (row) subtotal += unitPrice(row) * quantity
  }
  return { itemCount, subtotal: Math.round(subtotal * 100) / 100 }
}

/** The same lines with the catalogue's own words on them, for the detail panel
 *  and the reminder email. Resolved on read rather than stored, so a product
 *  renamed since the basket was left reads as it is called now. */
export async function resolveLines(lines: CartLine[]): Promise<ResolvedCartLine[]> {
  const products = await loadProducts(lines.map((line) => line.productId))
  return lines.map((line) => {
    const row = products.get(line.productId)
    return {
      ...line,
      name: row?.name ?? null,
      sku: row?.sku ?? null,
      slug: row?.slug ?? null,
      unitPrice: row ? unitPrice(row) : null,
    }
  })
}
