-- Migration: add score column to tweets
-- Ensures legacy databases capture the new GPT confidence score

BEGIN TRANSACTION;

ALTER TABLE tweets
  ADD COLUMN score INTEGER NOT NULL DEFAULT 0;

COMMIT;
