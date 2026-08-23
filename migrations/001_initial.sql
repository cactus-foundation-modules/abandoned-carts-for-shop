-- ---------------------------------------------------------------------------
-- Abandoned baskets for the Shop
--
-- One row per shopper per unfinished basket. The row is written from the
-- browser as the basket and the checkout boxes change, and only ever when the
-- site's cookie banner says it may be: see lib/consent.ts. A basket that turns
-- into an order is marked recovered rather than deleted, so the owner can see
-- what the reminders are actually worth.
--
-- Everything a shopper typed lives here, which makes this table personal data
-- in the plain sense of the word. Two things follow, and both are enforced in
-- code rather than left to good intentions: nothing is written without consent,
-- and every row is deleted once it is older than the retention setting.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "abc_carts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

    -- The browser this basket belongs to. A random id in a first-party cookie,
    -- minted only once consent allows it, and never anything derived from the
    -- shopper (no fingerprint, no IP, no email hash).
    "visitor_id" TEXT NOT NULL,
    -- Set when the shopper was signed in as a member at the time. No FK: the
    -- Members side of core is optional as far as this module is concerned,
    -- exactly as shp_member_carts has it.
    "member_id" TEXT,

    -- 'BASKET'   - things in the basket, checkout never reached.
    -- 'CHECKOUT' - the shopper started filling the checkout in.
    -- The two are one table and one shopper's journey; the admin list filters
    -- between them rather than splitting them, because a basket that becomes a
    -- checkout is the same abandonment either way.
    "stage" TEXT NOT NULL DEFAULT 'BASKET',

    -- The basket exactly as the browser holds it: productId / quantity /
    -- optional lineId + meta. Display state, not money - the totals below are
    -- worked out server-side from the catalogue at capture time, and neither is
    -- trusted for anything beyond "this is roughly what was in it".
    "lines" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "subtotal" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',

    -- What they wrote in the checkout before they stopped. All optional: a
    -- basket abandoned before the contact step has none of it.
    "customer_email" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "shipping_address" JSONB,
    "coupon_code" TEXT,
    "shipping_rate_id" TEXT,
    "payment_method" TEXT,

    -- Which cookie category was granted when this row was written, recorded so
    -- an owner asked "on what basis do you hold this?" has an answer in the
    -- data rather than in somebody's memory. 'none' means the site has no
    -- banner offering the category at all, which is the owner's own decision.
    "consent_basis" TEXT NOT NULL DEFAULT 'none',

    -- The shopper's own answer, ticked in the checkout where the owner has
    -- switched that box on (see lib/checkout-box.ts). True means no reminder
    -- for this basket. Not a suppression: that is for good and is keyed on the
    -- address, whereas this is one basket, and unticking the box takes it back.
    "marketing_opt_out" BOOLEAN NOT NULL DEFAULT false,

    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkout_started_at" TIMESTAMP(3),

    -- The reminder, where the owner has switched them on.
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "reminder_sent_at" TIMESTAMP(3),
    -- Random, per row, and the only thing the unsubscribe link carries. A token
    -- that is a hash of the address would let anybody who knows the address
    -- unsubscribe it, and worse, confirm it exists here.
    "unsubscribe_token" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

    -- How far the payment itself got, where the basket can tell. Heard from the
    -- shop's own window events - the press of Place order, and a checkout error
    -- - so nothing is asked of the shop for it.
    --
    -- 'ATTEMPTED' - pressed Place order and nothing came back: handed over to a
    --               bank or a card page and never returned, or the tab went.
    -- 'FAILED'    - the checkout refused it. The sentence the shopper was shown
    --               is kept verbatim below rather than re-worded here.
    -- NULL        - never got that far.
    "payment_stage" TEXT,
    "payment_attempted_at" TIMESTAMP(3),
    "payment_failure_reason" TEXT,

    -- Set when an order was placed from this basket. The row stops being live
    -- at that moment: no more reminders, and a fresh basket starts a new row.
    "recovered_at" TIMESTAMP(3),
    "recovered_order_number" TEXT,

    CONSTRAINT "abc_carts_pkey" PRIMARY KEY ("id")
);

-- One live basket per browser. Partial, so a recovered basket stays as history
-- while the same shopper starts filling another one.
CREATE UNIQUE INDEX IF NOT EXISTS "abc_carts_visitor_open_key"
    ON "abc_carts" ("visitor_id") WHERE "recovered_at" IS NULL;

CREATE INDEX IF NOT EXISTS "abc_carts_updated_at_idx" ON "abc_carts" ("updated_at");
CREATE INDEX IF NOT EXISTS "abc_carts_stage_idx" ON "abc_carts" ("stage");
CREATE INDEX IF NOT EXISTS "abc_carts_customer_email_idx" ON "abc_carts" ("customer_email");
CREATE INDEX IF NOT EXISTS "abc_carts_member_id_idx" ON "abc_carts" ("member_id");
CREATE UNIQUE INDEX IF NOT EXISTS "abc_carts_unsubscribe_token_key" ON "abc_carts" ("unsubscribe_token");

-- ---------------------------------------------------------------------------
-- Addresses that have asked not to be reminded again. Kept after the basket
-- rows themselves are purged, because "do not email me" outlives the thing it
-- was said about - that is the whole point of it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "abc_suppressions" (
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribed',

    CONSTRAINT "abc_suppressions_pkey" PRIMARY KEY ("email")
);

-- ---------------------------------------------------------------------------
-- Settings. Single row, seeded here so the module has answers from the moment
-- it is installed. Capture is ON and reminders are OFF: watching baskets is
-- what the owner installed this for, emailing strangers is a decision they
-- should make deliberately.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "abc_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    -- How long a basket sits untouched before it counts as abandoned. Drives
    -- the admin badge and the earliest a reminder may go out.
    "abandon_after_minutes" INTEGER NOT NULL DEFAULT 60,
    -- Rows older than this are deleted by the daily job. Not nullable, and not
    -- allowed to be "for ever": a shopper's address sitting here indefinitely
    -- because nobody chose a number is exactly the failure this module must
    -- not have.
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    -- Baskets with nothing typed in the checkout are the noisy half. An owner
    -- who only wants the ones with a name on them switches this off.
    "capture_baskets" BOOLEAN NOT NULL DEFAULT true,

    "emails_enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_delay_minutes" INTEGER NOT NULL DEFAULT 240,
    "email_max_per_cart" INTEGER NOT NULL DEFAULT 1,

    -- Offer the shopper the chance to say no, in the checkout, before any of
    -- this happens. Off by default because it puts a line in somebody else's
    -- checkout, and the wording is the owner's to write.
    "optout_box_enabled" BOOLEAN NOT NULL DEFAULT false,
    "optout_statement" TEXT NOT NULL DEFAULT 'Don''t email me about offers and similar products.',

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abc_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "abc_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;
