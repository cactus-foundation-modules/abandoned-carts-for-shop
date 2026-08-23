-- ---------------------------------------------------------------------------
-- The checkout tickbox that says "not for me".
--
-- A reminder about an unfinished basket is a marketing email, and the shopper
-- is standing right there in the checkout when we could simply ask. The box is
-- optional, off until the owner switches it on, and worded by them.
--
-- The box itself lives in the shop's own checkout tickboxes (see
-- lib/checkout-box.ts): the shop already lets an owner add a tickbox, so this
-- module uses that rather than asking the shop to grow anything for it.
-- ---------------------------------------------------------------------------

ALTER TABLE "abc_settings"
    ADD COLUMN IF NOT EXISTS "optout_box_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "abc_settings"
    ADD COLUMN IF NOT EXISTS "optout_statement" TEXT NOT NULL
    DEFAULT 'Don''t email me about offers and similar products.';

-- Ticked by the shopper, on the row their basket is held in. Not a suppression:
-- suppressions are for good and are keyed on the address, whereas this is one
-- shopper's answer about one basket, and unticking it takes it back.
ALTER TABLE "abc_carts"
    ADD COLUMN IF NOT EXISTS "marketing_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Why this basket stopped, where the basket itself can tell us.
--
-- Square and open banking both draft the order rather than creating it, so a
-- refused card and a shopper who wandered off at their bank leave no order row
-- anywhere - which is right, but it left this list unable to tell either of them
-- apart from somebody who simply closed the tab in the aisle.
--
-- Both are heard from the shop's own window events: it announces the press of
-- Place order, and it announces a checkout error. Nothing is asked of the shop.
--
-- 'ATTEMPTED' - they pressed Place order and nothing came back. Either they were
--               handed over to a bank or a card page and never returned, or the
--               tab went mid-payment.
-- 'FAILED'    - the checkout came back with a refusal, kept verbatim in
--               "payment_failure_reason" because it is already the sentence the
--               shopper was shown.
-- NULL        - never got that far.
-- ---------------------------------------------------------------------------

ALTER TABLE "abc_carts" ADD COLUMN IF NOT EXISTS "payment_stage" TEXT;
ALTER TABLE "abc_carts" ADD COLUMN IF NOT EXISTS "payment_attempted_at" TIMESTAMP(3);
ALTER TABLE "abc_carts" ADD COLUMN IF NOT EXISTS "payment_failure_reason" TEXT;
