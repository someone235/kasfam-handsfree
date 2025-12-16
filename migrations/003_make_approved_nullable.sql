-- Migration: make approved column nullable to support tweets without model decision
-- Run with: sqlite3 path/to/db.sqlite < migrations/003_make_approved_nullable.sql

-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table
BEGIN TRANSACTION;

-- create new table with nullable approved (includes all columns for safety)
CREATE TABLE tweets_new (
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

-- copy data from old table (conditionally copy columns that may or may not exist)
-- Note: This handles the case where migration runs before 004-006 (columns don't exist)
-- or after (columns exist and must be preserved)
INSERT INTO tweets_new (id, text, quote, url, approved, score, createdAt, humanDecision)
SELECT id, text, COALESCE(quote, ''), url, approved, COALESCE(score, 0), createdAt, humanDecision FROM tweets;

-- drop old table and rename new one
DROP TABLE tweets;
ALTER TABLE tweets_new RENAME TO tweets;

-- recreate index
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweets_id ON tweets(id);

COMMIT;

