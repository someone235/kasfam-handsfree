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

async function getKaspaTweets(): Promise<Tweet[]> {
  const res = await fetch("https://kaspa.news/api/kaspa-tweets", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch kaspa tweets: ${res.status} ${res.statusText}`
    );
  }
  const response = await res.json();
  return response.tweets ?? [];
}

function log(msg: string) {
  console.log(`\x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`);
}

async function main() {
  let store: TweetStore | null = null;
  try {
    store = createTweetStore();
    const tweets = await getKaspaTweets();

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
      const { quote, approved } = await askTweetDecision(tweet.text);

      const payload: TweetDecisionInput = {
        ...tweet,
        quote: quote ?? "",
        approved,
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
