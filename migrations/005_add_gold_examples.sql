-- Add gold example tracking to tweets table
-- goldExampleType: NULL = not a gold example, 'GOOD' = approved example, 'BAD' = rejected example

ALTER TABLE tweets ADD COLUMN goldExampleType TEXT DEFAULT NULL
  CHECK(goldExampleType IN ('GOOD', 'BAD'));

CREATE INDEX IF NOT EXISTS idx_tweets_gold_example ON tweets(goldExampleType)
  WHERE goldExampleType IS NOT NULL;
