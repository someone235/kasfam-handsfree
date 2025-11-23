import OpenAI from "openai";
import { prompt as systemPrompt } from "./prompt.js";
import { createTweetStore, type TweetDecisionInput } from "./tweetStore.js";

const openAiClient = new OpenAI({ apiKey: assertApiKey() });

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

async function ask(
  question: string
): Promise<{ quote?: string; approved: boolean }> {
  const response = await openAiClient.responses.create({
    model: "gpt-5.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
  });

  const quote = response.output_text?.trim();
  const approved = !quote?.startsWith("Rejected");
  return {
    quote: quote,
    approved,
  };
}

type Tweet = {
  id: string;
  text: string;
  url: string;
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

async function main() {
  let store: TweetStore | null = null;
  try {
    store = createTweetStore();
    const tweets = await getKaspaTweets();

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      console.info(`Reading tweet ${i + 1} of ${tweets.length}`);

      if (store.has(tweet.id)) {
        console.info(`Skipping tweet ${tweet.id} (already exists)`);
        continue;
      }

      console.info(`\nSending question to GPT-5.1...`);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      const { quote, approved } = await ask(tweet.text);

      const payload: TweetDecisionInput = {
        ...tweet,
        quote: quote ?? "",
        approved,
      };

      store.save(payload);

      if (!approved) {
        continue;
      }

      console.info(`Question: ${tweet.text}`);

      console.log(`Approved status: ${approved}`);

      if (!quote) {
        console.warn("No textual output returned by the model.");
        process.exitCode = 2;
        return;
      }

      console.log("\n=== GPT-5.1 Response ===\n");
      console.log(quote);
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
