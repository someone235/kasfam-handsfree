import { askTweetDecision } from "./gptClient.js";
import { createTweetStore, type TweetDecisionInput } from "./tweetStore.js";

type Tweet = {
  id: string;
  text: string;
  url: string;
  author: {
    username: string;
  };
};

type TweetStore = ReturnType<typeof createTweetStore>;

async function getKaspaTweets(limit?: number): Promise<Tweet[]> {
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

  // Apply client-side limiting if specified
  if (limit !== undefined && limit > 0) {
    return allTweets.slice(0, limit);
  }

  return allTweets;
}

function log(msg: string) {
  console.log(`\x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`);
}

type ParsedArgs = {
  limit: number | undefined;
};

function extractArguments(args: string[]): ParsedArgs {
  // how many tweets to send through to gpt for 'processing', default to no limit (all tweets)
  let limit: number | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') {
      if (i + 1 >= args.length) {
        throw new Error('--limit requires a value');
      }
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith('--')) {
      throw new Error(`Unknown argument: ${args[i]}`);
    } else if (i === 0 || !args[i - 1].startsWith('--')) {
      // standalone value that's not following a flag
      throw new Error(`Unexpected argument: ${args[i]}`);
    }
  }

  return { limit };
}

function validateArguments(parsed: ParsedArgs): void {
  if (parsed.limit !== undefined) {
    if (isNaN(parsed.limit) || parsed.limit <= 0) {
      throw new Error(`Invalid --limit value: must be a positive integer, got ${parsed.limit}`);
    }
  }
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed = extractArguments(args);
  validateArguments(parsed);
  return parsed;
}

async function main() {
  const { limit } = parseArgs();

  let store: TweetStore | null = null;
  try {
    store = createTweetStore();
    const tweets = await getKaspaTweets(limit);

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      log(`Reading tweet ${i + 1} of ${tweets.length}`);

      if (tweet.author.username == "kaspaunchained") {
        log(`Skipping self-tweet`);
        continue;
      }

      if (store.has(tweet.id)) {
        log(`Skipping tweet ${tweet.id} (already exists)`);
        continue;
      }

      log(`Sending question to GPT-5.1...`);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      const { quote, approved, score } = await askTweetDecision(tweet.text);

      const payload: TweetDecisionInput = {
        ...tweet,
        quote: quote ?? "",
        approved,
        score,
      };

      store.save(payload);

      if (!approved) {
        continue;
      }

      log(`Question: ${tweet.text}`);

      log(`Approved status: ${approved}`);

      if (!quote) {
        console.warn("No textual output returned by the model.");
        process.exitCode = 2;
        return;
      }

      log("=== GPT-5.1 Response ===");
      log(quote);
    }
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
