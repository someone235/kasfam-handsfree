-- Migration: create tweets table
-- Run with: sqlite3 path/to/db.sqlite < migrations/001_create_tweets_table.sql

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS tweets (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  quote TEXT NOT NULL,
  url TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ensure id remains unique even if table definition changes
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweets_id ON tweets(id);

COMMIT;
