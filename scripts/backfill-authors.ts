#!/usr/bin/env npx tsx
/**
 * Backfill author usernames for human-approved tweets.
 * Fetches author info from kaspa.news API first, falls back to X API.
 *
 * Usage: npx tsx scripts/backfill-authors.ts [--dry-run]
 */
import "dotenv/config";
import Database from "better-sqlite3";
import path from "path";
import { createXClient } from "../src/xClient.js";

const DB_PATH = process.env.SQLITE_DB_PATH || "data/app.db";
const KASPA_NEWS_URL = "https://kaspa.news/api/kaspa-tweets";
const DRY_RUN = process.argv.includes("--dry-run");

interface KaspaNewsTweet {
  id: string;
  author?: {
    username: string;
  };
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function fetchKaspaNewsTweets(): Promise<Map<string, string>> {
  log("Fetching kaspa.news tweets...");
  const res = await fetch(KASPA_NEWS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch kaspa.news: ${res.status}`);
  }
  const data = await res.json();
  const tweets = (data.tweets ?? []) as KaspaNewsTweet[];

  const authorMap = new Map<string, string>();
  for (const tweet of tweets) {
    if (tweet.author?.username) {
      authorMap.set(tweet.id, tweet.author.username);
    }
  }
  log(`Found ${authorMap.size} tweets with author info from kaspa.news`);
  return authorMap;
}

async function fetchAuthorsFromXApi(tweetIds: string[]): Promise<Map<string, string>> {
  if (tweetIds.length === 0) return new Map();

  log(`Fetching ${tweetIds.length} tweets from X API...`);
  try {
    const client = createXClient();
    const tweets = await client.getTweetsByIds(tweetIds);

    const authorMap = new Map<string, string>();
    for (const tweet of tweets) {
      if (tweet.author?.username && tweet.author.username !== "unknown") {
        authorMap.set(tweet.id, tweet.author.username);
      }
    }
    log(`Found ${authorMap.size} tweets with author info from X API`);
    return authorMap;
  } catch (error) {
    log(`X API error: ${error}`);
    return new Map();
  }
}

async function main(): Promise<void> {
  if (DRY_RUN) {
    log("DRY RUN - no changes will be made");
  }

  const db = new Database(path.resolve(DB_PATH));

  // Find human-approved tweets missing author
  const tweetsToBackfill = db
    .prepare(
      `SELECT id FROM tweets 
       WHERE humanDecision = 'APPROVED' 
       AND (authorUsername IS NULL OR authorUsername = '')`
    )
    .all() as { id: string }[];

  log(`Found ${tweetsToBackfill.length} human-approved tweets needing author backfill`);

  if (tweetsToBackfill.length === 0) {
    log("Nothing to backfill");
    db.close();
    return;
  }

  const tweetIds = tweetsToBackfill.map((t) => t.id);

  // Try kaspa.news first
  const kaspaNewsAuthors = await fetchKaspaNewsTweets();

  const foundInKaspaNews: string[] = [];
  const notFoundInKaspaNews: string[] = [];

  for (const id of tweetIds) {
    if (kaspaNewsAuthors.has(id)) {
      foundInKaspaNews.push(id);
    } else {
      notFoundInKaspaNews.push(id);
    }
  }

  log(
    `${foundInKaspaNews.length} found in kaspa.news, ${notFoundInKaspaNews.length} need X API lookup`
  );

  // Fetch remaining from X API
  const xApiAuthors = await fetchAuthorsFromXApi(notFoundInKaspaNews);

  // Merge results
  const allAuthors = new Map<string, string>();
  for (const [id, author] of kaspaNewsAuthors) {
    if (tweetIds.includes(id)) {
      allAuthors.set(id, author);
    }
  }
  for (const [id, author] of xApiAuthors) {
    allAuthors.set(id, author);
  }

  log(`Total authors resolved: ${allAuthors.size} of ${tweetIds.length}`);

  // Update database
  const updateStmt = db.prepare(`UPDATE tweets SET authorUsername = @author WHERE id = @id`);

  let updated = 0;
  let failed = 0;

  for (const id of tweetIds) {
    const author = allAuthors.get(id);
    if (author) {
      if (!DRY_RUN) {
        updateStmt.run({ id, author });
      }
      log(`  ${DRY_RUN ? "[DRY] " : ""}Updated ${id} -> @${author}`);
      updated++;
    } else {
      log(`  MISSING: ${id} - could not resolve author`);
      failed++;
    }
  }

  log(`\nBackfill complete: ${updated} updated, ${failed} unresolved`);
  db.close();
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
