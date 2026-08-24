-- ---------------------------------------------------------------------------
-- What actually happened to each reminder, and whether the job that sends them
-- is running at all.
--
-- Before this, a basket carried two numbers - how many reminders had gone and
-- when the last one was - and nothing else. That is enough to say "reminded
-- once" and nothing at all to answer the two questions an owner actually asks:
-- did it go, and if it did not, why not. A send that failed left no trace, a
-- send skipped because the shopper had unsubscribed looked identical to one
-- that was simply not due yet, and a cron job that had never fired in its life
-- looked exactly like a shop where nobody abandons anything.
--
-- So: one row per attempt, kept beside the basket it was about, and one row per
-- run of the hourly job.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "abc_reminder_log" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

    -- The basket the attempt was about. Cascades, deliberately: this row holds
    -- an email address, so it is personal data on the same footing as the
    -- basket, and it must not outlive the retention purge that deletes it.
    "cart_id" TEXT NOT NULL,

    -- The address as it stood at the time. Kept rather than joined back to the
    -- basket, because the basket's address can change afterwards and "we
    -- emailed this person" has to stay true about the person we emailed.
    "email" TEXT NOT NULL,

    -- Which nudge this was: 1 for the first, 2 for the second. Recorded rather
    -- than counted, so a log read back years later still says which.
    "attempt" INTEGER NOT NULL DEFAULT 1,

    -- 'SENT'    - handed to the email provider without complaint.
    -- 'FAILED'  - we tried and it did not go. The reason is in "detail".
    -- 'SKIPPED' - we deliberately did not try. Also in "detail": unsubscribed,
    --             asked not to be emailed, already ordered, nothing left in the
    --             basket that we still sell.
    --
    -- SKIPPED earns a row of its own because a reminder that never went is the
    -- thing an owner is most likely to mistake for a broken feature.
    "status" TEXT NOT NULL,
    "detail" TEXT,

    -- 'AUTOMATIC' - the hourly job. 'MANUAL' - somebody pressed the button on
    -- the admin screen, and "sent_by" says who.
    "trigger" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "sent_by" TEXT,

    -- What the email said and what the basket was worth at the time, so a row
    -- read back still makes sense after the wording has been rewritten and the
    -- prices have moved.
    "subject" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "subtotal" NUMERIC(10,2) NOT NULL DEFAULT 0,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abc_reminder_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abc_reminder_log_cart_fkey" FOREIGN KEY ("cart_id")
        REFERENCES "abc_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "abc_reminder_log_cart_idx" ON "abc_reminder_log" ("cart_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "abc_reminder_log_created_idx" ON "abc_reminder_log" ("created_at");
CREATE INDEX IF NOT EXISTS "abc_reminder_log_status_idx" ON "abc_reminder_log" ("status");

-- ---------------------------------------------------------------------------
-- One row per run of the hourly job.
--
-- No personal data in it, so it is not on the retention clock the baskets are
-- on - but it is trimmed to the last hundred runs on write, because "did this
-- run last night?" is the only question it exists to answer and a year of
-- hourly rows answers it no better.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "abc_job_runs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,

    "purged" INTEGER NOT NULL DEFAULT 0,
    "considered" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    -- Set when the run itself fell over, as opposed to individual sends failing.
    "error" TEXT,

    CONSTRAINT "abc_job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "abc_job_runs_ran_at_idx" ON "abc_job_runs" ("ran_at" DESC);

-- ---------------------------------------------------------------------------
-- Backfill: every basket that already carries a reminder count gets one log row
-- standing in for it, so the new column on the admin screen is not blank for
-- every basket reminded before this migration ran. Marked as such in "detail" -
-- inventing a subject line for an email we have no record of would be worse
-- than admitting we only know it happened.
-- ---------------------------------------------------------------------------

INSERT INTO "abc_reminder_log" ("cart_id", "email", "attempt", "status", "detail", "trigger", "created_at")
SELECT c."id", LOWER(c."customer_email"), GREATEST(1, c."reminder_count"), 'SENT',
       'Recorded before this site kept a full history', 'AUTOMATIC',
       COALESCE(c."reminder_sent_at", c."updated_at")
FROM "abc_carts" c
WHERE c."reminder_count" > 0
  AND c."customer_email" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "abc_reminder_log" l WHERE l."cart_id" = c."id");
