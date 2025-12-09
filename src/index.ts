import "dotenv/config";
import {
  askTweetDecision,
  MalformedResponseError,
  type FewShotExample,
} from "./gptClient.js";
import { createTweetStore, type TweetDecisionInput, type TweetRawInput } from "./tweetStore.js";
import { createXClient } from "./xClient.js";

type Tweet = {
  id: string;
  text: string;
  url: string;
  author: {
    username: string;
  };
};

type TweetSource = "kaspa-news" | "x-api" | "both";

type TweetStore = ReturnType<typeof createTweetStore>;

const RESPONSE_ID_KEY = "previousResponseId";

function log(msg: string) {
  console.log(`\x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`);
}

async function getKaspaNewsFeed(limit?: number): Promise<Tweet[]> {
  const res = await fetch("https://kaspa.news/api/kaspa-tweets", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch kaspa tweets: ${res.status} ${res.statusText}`
    );
  }
  const response = await res.json();
  const allTweets = response.tweets ?? [];

  // apply client-side limiting if specified
  if (limit !== undefined && limit > 0) {
    return allTweets.slice(0, limit);
  }

  return allTweets;
}

// Returns { found, notFound } - does not throw on missing IDs
async function findTweetsInKaspaNews(tweetIds: string[]): Promise<{ found: Tweet[]; notFound: string[] }> {
  const res = await fetch("https://kaspa.news/api/kaspa-tweets", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch kaspa tweets: ${res.status} ${res.statusText}`
    );
  }
  const response = await res.json();
  const allTweets = response.tweets ?? [];

  const found = allTweets.filter((t: Tweet) => tweetIds.includes(t.id));
  const foundIds = found.map((t: Tweet) => t.id);
  const notFound = tweetIds.filter(id => !foundIds.includes(id));

  return { found, notFound };
}

async function getXApiFeed(): Promise<Tweet[]> {
  const client = createXClient();
  return await client.searchTweets();
}

async function getXApiTweetsByIds(tweetIds: string[]): Promise<Tweet[]> {
  const client = createXClient();
  return await client.getTweetsByIds(tweetIds);
}

// Fetch tweets by specific IDs based on source preference
async function getTweetsByIds(source: TweetSource, tweetIds: string[]): Promise<Tweet[]> {
  if (source === "kaspa-news") {
    // kaspa-news only: error if not found
    const { found, notFound } = await findTweetsInKaspaNews(tweetIds);
    if (notFound.length > 0) {
      throw new Error(`Tweet ID(s) not found in kaspa.news: ${notFound.join(', ')}`);
    }
    log(`Found ${found.length} tweets in kaspa.news`);
    return found;
  }

  if (source === "x-api") {
    // X API only: fetch directly by ID
    const tweets = await getXApiTweetsByIds(tweetIds);
    log(`Fetched ${tweets.length} tweets from X API`);
    if (tweets.length < tweetIds.length) {
      const foundIds = tweets.map(t => t.id);
      const notFound = tweetIds.filter(id => !foundIds.includes(id));
      throw new Error(`Tweet ID(s) not found in X API: ${notFound.join(', ')}`);
    }
    return tweets;
  }

  // source === "both": try kaspa.news first, fallback to X API for missing
  const { found, notFound } = await findTweetsInKaspaNews(tweetIds);
  if (found.length > 0) {
    log(`Found ${found.length} tweets in kaspa.news`);
  }

  if (notFound.length > 0) {
    log(`${notFound.length} tweets not in kaspa.news, checking X API...`);
    try {
      const xApiTweets = await getXApiTweetsByIds(notFound);
      log(`Fetched ${xApiTweets.length} tweets from X API`);
      found.push(...xApiTweets);

      // Check if any are still missing
      const allFoundIds = found.map(t => t.id);
      const stillMissing = tweetIds.filter(id => !allFoundIds.includes(id));
      if (stillMissing.length > 0) {
        throw new Error(`Tweet ID(s) not found in any source: ${stillMissing.join(', ')}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to fetch from X API: ${error}`);
    }
  }

  return found;
}

// Fetch tweets from feed (no specific IDs)
async function getTweetsFeed(source: TweetSource, limit?: number): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  const seenIds = new Set<string>();

  const addTweets = (newTweets: Tweet[]) => {
    for (const tweet of newTweets) {
      if (!seenIds.has(tweet.id)) {
        seenIds.add(tweet.id);
        tweets.push(tweet);
      }
    }
  };

  if (source === "kaspa-news" || source === "both") {
    try {
      const kaspaNewsTweets = await getKaspaNewsFeed();
      log(`Fetched ${kaspaNewsTweets.length} tweets from kaspa.news`);
      addTweets(kaspaNewsTweets);
    } catch (error) {
      if (source === "both") {
        console.warn(`Warning: Failed to fetch from kaspa.news: ${error}`);
      } else {
        throw error;
      }
    }
  }

  if (source === "x-api" || source === "both") {
    try {
      const xApiTweets = await getXApiFeed();
      log(`Fetched ${xApiTweets.length} tweets from X API`);
      addTweets(xApiTweets);
    } catch (error) {
      if (source === "both") {
        console.warn(`Warning: Failed to fetch from X API: ${error}`);
      } else {
        throw error;
      }
    }
  }

  log(`Total unique tweets: ${tweets.length}`);

  // Apply limit after combining all sources
  if (limit !== undefined && limit > 0 && tweets.length > limit) {
    log(`Limiting to ${limit} tweets`);
    return tweets.slice(0, limit);
  }

  return tweets;
}

async function getTweets(source: TweetSource, limit?: number, tweetIds?: string[]): Promise<Tweet[]> {
  // If specific tweet IDs requested, use ID-based lookup
  if (tweetIds !== undefined && tweetIds.length > 0) {
    return getTweetsByIds(source, tweetIds);
  }

  // Otherwise fetch from feed
  return getTweetsFeed(source, limit);
}

type ParsedArgs = {
  source: TweetSource;
  limit: number | undefined;
  tweetIds: string[] | undefined;
};

function getDefaultSource(): TweetSource {
  const envSource = process.env.DEFAULT_SOURCE;
  if (envSource === "kaspa-news" || envSource === "x-api" || envSource === "both") {
    return envSource;
  }
  return "kaspa-news";
}

function extractArguments(args: string[]): ParsedArgs {
  let source: TweetSource = getDefaultSource();
  let limit: number | undefined = undefined;
  let tweetIds: string[] | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') {
      if (i + 1 >= args.length) {
        throw new Error('--source requires a value');
      }
      const value = args[i + 1];
      if (value === "kaspa-news" || value === "x-api" || value === "both") {
        source = value;
      } else {
        throw new Error(`Invalid source: ${value}. Use: kaspa-news, x-api, or both`);
      }
      i++;
    } else if (args[i] === '--limit') {
      if (i + 1 >= args.length) {
        throw new Error('--limit requires a value');
      }
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--tweet-id') {
      if (i + 1 >= args.length) {
        throw new Error('--tweet-id requires a value');
      }
      tweetIds = args[i + 1].split(',').map(id => id.trim()).filter(id => id.length > 0);
      i++;
    } else if (args[i].startsWith('--')) {
      throw new Error(`Unknown argument: ${args[i]}`);
    } else if (i === 0 || !args[i - 1].startsWith('--')) {
      // standalone value that's not following a flag
      throw new Error(`Unexpected argument: ${args[i]}`);
    }
  }

  return { source, limit, tweetIds };
}

function validateArguments(parsed: ParsedArgs): void {
  if (parsed.limit !== undefined) {
    if (isNaN(parsed.limit) || parsed.limit <= 0) {
      throw new Error(`Invalid --limit value: must be a positive integer, got ${parsed.limit}`);
    }
  }

  if (parsed.tweetIds !== undefined) {
    if (parsed.tweetIds.length === 0) {
      throw new Error('--tweet-id cannot be empty');
    }
    for (const id of parsed.tweetIds) {
      if (id.trim() === '') {
        throw new Error('--tweet-id contains empty values');
      }
    }
  }

  // warn if both limit and tweetIds are provided (tweetIds takes precedence)
  if (parsed.limit !== undefined && parsed.tweetIds !== undefined) {
    console.warn('Warning: both --limit and --tweet-id provided. --tweet-id takes precedence, --limit will be ignored.');
  }
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed = extractArguments(args);
  validateArguments(parsed);
  return parsed;
}

function loadFewShotExamples(store: TweetStore): FewShotExample[] {
  const goldExamples = store.getGoldExamples();
  return goldExamples.map(ex => ({
    tweetText: ex.text,
    response: ex.quote,
    correction: ex.goldExampleCorrection ?? undefined,
    type: ex.goldExampleType!,
  }));
}

async function main() {
  const { source, limit, tweetIds } = parseArgs();
  log(`Using source: ${source}`);

  let store: TweetStore | null = null;
  try {
    store = createTweetStore();
    const tweets = await getTweets(source, limit, tweetIds);

    // save all tweets to db first (without model decision)
    for (const tweet of tweets) {
      const rawInput: TweetRawInput = {
        id: tweet.id,
        text: tweet.text,
        url: tweet.url,
      };
      store.saveRaw(rawInput);
    }
    log(`Saved ${tweets.length} tweets to database`);

    // load gold examples for few-shot learning
    const fewShotExamples = loadFewShotExamples(store);
    if (fewShotExamples.length > 0) {
      log(`Loaded ${fewShotExamples.length} gold examples for few-shot learning`);
    }

    // Filter tweets that need processing
    const tweetsToProcess: Tweet[] = [];
    for (const tweet of tweets) {
      if (tweet.author.username === "kaspaunchained") {
        log(`Skipping self-tweet: ${tweet.id}`);
        continue;
      }
      if (store.hasModelDecision(tweet.id)) {
        log(`Skipping tweet ${tweet.id} (already has model decision)`);
        continue;
      }
      tweetsToProcess.push(tweet);
    }

    if (tweetsToProcess.length === 0) {
      log("No new tweets to process.");
      return;
    }

    log(`Found ${tweetsToProcess.length} tweets needing evaluation`);

    // Load persistent conversation memory from database
    let previousResponseId = store.getConfig(RESPONSE_ID_KEY);
    if (previousResponseId) {
      log(`Resuming conversation chain from: ${previousResponseId.slice(-8)}`);
    } else {
      log(`Starting new conversation chain`);
    }

    // Process tweets one at a time (conversation memory accumulates context)
    let approvedCount = 0;
    let rejectedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < tweetsToProcess.length; i++) {
      const tweet = tweetsToProcess[i];
      log(`\n[${i + 1}/${tweetsToProcess.length}] Evaluating tweet...`);

      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      try {
        const { quote, approved, score, responseId } = await askTweetDecision(tweet.text, {
          examples: fewShotExamples,
          previousResponseId,
        });

        // Update conversation chain
        previousResponseId = responseId;
        store.setConfig(RESPONSE_ID_KEY, responseId);

        log(`  [chain: ${responseId.slice(-8)}]`);  // Last 8 chars of response ID for brevity

        const payload: TweetDecisionInput = {
          id: tweet.id,
          text: tweet.text,
          url: tweet.url,
          quote: quote ?? "",
          approved,
          score,
        };

        store.save(payload);

        // Log result
        if (approved) {
          approvedCount++;
          const qtMatch = quote.match(/QT:\s*(.+?)(?=\nPercentile:|$)/is);
          const qt = qtMatch ? qtMatch[1].trim() : "";
          log(`✓ APPROVED (Percentile: ${score})`);
          log(`  Tweet: ${tweet.text.slice(0, 60)}...`);
          log(`  QT: ${qt}`);
        } else {
          rejectedCount++;
          log(`✗ REJECTED: ${quote}`);
          log(`  Tweet: ${tweet.text.slice(0, 60)}...`);
        }
      } catch (error) {
        if (error instanceof MalformedResponseError) {
          skippedCount++;
          log(`⚠ MALFORMED RESPONSE for tweet ${tweet.id}: ${error.message}`);
          log(`  Raw response: ${error.rawResponse.slice(0, 100)}...`);
          // Don't save - leave tweet unprocessed for retry
          continue;
        }
        throw error;
      }
    }

    const processedCount = approvedCount + rejectedCount;
    log(`\n━━━ Summary ━━━`);
    log(`Processed ${processedCount} of ${tweetsToProcess.length} tweets`);
    log(`Approved: ${approvedCount} | Rejected: ${rejectedCount}${skippedCount > 0 ? ` | Skipped: ${skippedCount}` : ""}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Unknown error", error);
    }
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

main();
