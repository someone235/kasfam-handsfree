-- Migration: add authorUsername column
-- Stores the tweet author's username for frequency tracking

BEGIN TRANSACTION;

ALTER TABLE tweets ADD COLUMN authorUsername TEXT;

CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(authorUsername)
  WHERE authorUsername IS NOT NULL;

COMMIT;
