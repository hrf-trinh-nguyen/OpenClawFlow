-- Allow email_status to be NULL (Apollo leads don't have it until Bouncer verifies)
-- Avoids NOT NULL violation when Apollo skill inserts leads without email_status
ALTER TABLE leads ALTER COLUMN email_status DROP NOT NULL;
