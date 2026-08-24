-- ---------------------------------------------------------------------------
-- The link in the reminder email that actually brings the basket back.
--
-- Until this, the reminder pointed at the bare basket page. That worked for
-- exactly one shopper: the one who opened the email in the same browser the
-- basket was built in. Everybody else - and on a phone that is nearly
-- everybody, because a mail app opens links in its own little browser with its
-- own cookies and its own storage - arrived at an empty basket under a heading
-- promising their things were still here. Worse than no email.
--
-- The basket itself is already in this table. The only missing piece was
-- something in the link naming which row to put back, so the route can hand the
-- lines to the shop's own basket before the page draws.
--
-- Its own token rather than the unsubscribe one. These links get forwarded,
-- pasted and prefetched, and a single token doing both jobs would mean anybody
-- holding a "here is your basket" link could also stop somebody else's emails.
-- ---------------------------------------------------------------------------

ALTER TABLE "abc_carts"
    ADD COLUMN IF NOT EXISTS "recovery_token" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- gen_random_uuid() is volatile, so the ADD COLUMN above gives every existing
-- row its own value rather than one value shared by the lot. The index states
-- that expectation rather than trusting it.
CREATE UNIQUE INDEX IF NOT EXISTS "abc_carts_recovery_token_key"
    ON "abc_carts" ("recovery_token");
