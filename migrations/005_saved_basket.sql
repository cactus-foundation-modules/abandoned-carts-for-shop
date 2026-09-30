-- ---------------------------------------------------------------------------
-- The shopper saved their basket.
--
-- Some shops let a shopper park a basket on purpose - save it, get a code, come
-- back for it later. A basket parked like that is not abandoned in the usual
-- sense, and an owner reading the list deserves to know which is which before
-- they chase anybody.
--
-- Heard in the browser from core's conversion seam (a 'saved-cart' event), so
-- whichever module offers the saving never has to know this one is installed.
-- The reference is whatever that module called the saved basket - a quote
-- number, today - kept as text and never looked up.
-- ---------------------------------------------------------------------------

ALTER TABLE "abc_carts" ADD COLUMN IF NOT EXISTS "saved_at" TIMESTAMP(3);
ALTER TABLE "abc_carts" ADD COLUMN IF NOT EXISTS "saved_reference" TEXT;
