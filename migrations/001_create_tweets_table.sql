-- Migration: create tweets table
-- Run with: sqlite3 path/to/db.sqlite < migrations/001_create_tweets_table.sql

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS tweets (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  approved INTEGER DEFAULT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT NULL,
  humanDecision TEXT DEFAULT NULL CHECK(humanDecision IN ('APPROVED','REJECTED')),
  goldExampleType TEXT DEFAULT NULL CHECK(goldExampleType IN ('GOOD','BAD')),
  goldExampleCorrection TEXT DEFAULT NULL
);

-- Ensure id remains unique even if table definition changes
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweets_id ON tweets(id);
CREATE INDEX IF NOT EXISTS idx_tweets_gold_example ON tweets(goldExampleType)
  WHERE goldExampleType IS NOT NULL;

COMMIT;
